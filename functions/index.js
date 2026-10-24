const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

// ── EmailJS secrets ───────────────────────────────────────────────────────────
// Set once via:
//   firebase functions:secrets:set EMAILJS_SERVICE_ID
//   firebase functions:secrets:set EMAILJS_STATUS_TEMPLATE_ID
//   firebase functions:secrets:set EMAILJS_PUBLIC_KEY
//   firebase functions:secrets:set EMAILJS_PRIVATE_KEY
const emailjsServiceId  = defineSecret('EMAILJS_SERVICE_ID');
const emailjsTemplateId = defineSecret('EMAILJS_STATUS_TEMPLATE_ID');
const emailjsPublicKey  = defineSecret('EMAILJS_PUBLIC_KEY');
const emailjsPrivateKey = defineSecret('EMAILJS_PRIVATE_KEY');

/**
 * Looks up the assigned tech's FCM token and sends a push notification
 * with the full dispatch payload: task, serial number, site location, details.
 */
async function sendDispatchNotification(jobId, job) {
  if (!job.assignedTechEmail) return;

  const targets = await getPushTargets(
    admin.firestore().collection('users').where('email', '==', job.assignedTechEmail).limit(1)
  );

  if (!targets.length) {
    console.log(`No FCM token stored for tech: ${job.assignedTechEmail}`);
    return;
  }

  const title = `Dispatch: ${job.task || 'New Job'}`;
  const bodyParts = [job.location || 'See app for site location'];
  if (job.serialNumber) bodyParts.push(`S/N: ${job.serialNumber}`);
  const body = bodyParts.join('  |  ');

  const message = {
    notification: { title, body },
    // data fields are all strings — available even when app is in background
    data: {
      jobId: String(jobId),
      task: String(job.task || ''),
      location: String(job.location || ''),
      serialNumber: String(job.serialNumber || ''),
      details: String(job.details || ''),
      client: String(job.client || ''),
      clientPhone: String(job.clientPhone || ''),
    },
    webpush: {
      notification: {
        title,
        body,
        requireInteraction: true,
        tag: `job-${jobId}`,
      },
      fcmOptions: { link: '/' },
    },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast({ ...message, tokens: targets.map((t) => t.token) });
    await pruneInvalidTokens(targets, response.responses);
    console.log('FCM dispatch notification sent to', response.successCount, 'device(s)');
  } catch (err) {
    console.error('FCM send failed:', err.code, err.message);
  }
}

async function sendEmailJs(serviceId, templateId, publicKey, privateKey, templateParams) {
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id:   serviceId,
      template_id:  templateId,
      user_id:      publicKey,
      accessToken:  privateKey,
      template_params: templateParams,
    }),
  });
  if (!response.ok) throw new Error(`EmailJS ${response.status}: ${await response.text()}`);
}

// Sends a status-change email to the client via EmailJS REST API.
// Only fires for the statuses that are meaningful to the client.
async function sendClientStatusEmail(serviceId, templateId, publicKey, privateKey, jobId, job, newStatus) {
  if (!job.clientEmail) return;

  const statusMessages = {
    'Assigned':          `${job.assignedTechName || 'A technician'} has been assigned to your request.`,
    'Dispatched':        `${job.assignedTechName || 'A technician'} has been assigned to your request.`,
    'En Route':          `${job.assignedTechName || 'Your technician'} is on the way to your location.`,
    'On Site':           `${job.assignedTechName || 'Your technician'} has arrived on site and work is underway.`,
    'Ready for Signoff': 'Your technician has completed the work. Please log in to review and sign off.',
    'Completed':         'Your service request has been completed. Thank you for choosing Silicon Valley Smart Hands LLC.',
  };

  const statusMessage = statusMessages[newStatus];
  if (!statusMessage) return;

  try {
    await sendEmailJs(serviceId, templateId, publicKey, privateKey, {
      to_email:       job.clientEmail,
      to_name:        job.client || 'Valued Customer',
      job_status:     newStatus,
      job_task:       job.task || '',
      job_location:   job.location || '',
      tech_name:      job.assignedTechName || '',
      status_message: statusMessage,
      job_id:         jobId,
    });
    console.log(`Status email sent to ${job.clientEmail} — status: ${newStatus}`);
  } catch (err) {
    console.error('EmailJS send failed:', err.message);
  }
}

// Fires when a new job document is created (auto-dispatch or admin creation)
exports.notifyTechOnJobCreated = onDocumentCreated('jobs/{jobId}', async (event) => {
  await sendDispatchNotification(event.params.jobId, event.data.data());
  return null;
});

// Fires when an existing job is updated — notifies tech only when assignedTechEmail changes
exports.notifyTechOnJobAssigned = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (!after.assignedTechEmail) return null;
  if (before.assignedTechEmail === after.assignedTechEmail) return null;

  await sendDispatchNotification(event.params.jobId, after);
  return null;
});

const STAFF_ROLES = ['admin', 'adminAssistant', 'seniorConsultant'];

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

async function getPushTargets(query) {
  const snapshot = await query.get();
  const seen = new Set();
  const targets = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const entries = [
      ...(data.fcmTokens || []).map((token) => ({ token, field: 'fcmTokens' })),
      ...(data.fcmToken ? [{ token: data.fcmToken, field: 'fcmToken' }] : []),
    ];
    for (const entry of entries) {
      if (seen.has(entry.token)) continue;
      seen.add(entry.token);
      targets.push({ ref: doc.ref, ...entry });
    }
  }
  return targets;
}

async function pruneInvalidTokens(targets, responses) {
  await Promise.all(responses.map((response, index) => {
    if (response.success || !INVALID_TOKEN_CODES.has(response.error?.code)) return null;
    const { ref, token, field } = targets[index];
    const update = field === 'fcmTokens'
      ? { fcmTokens: admin.firestore.FieldValue.arrayRemove(token) }
      : { fcmToken: admin.firestore.FieldValue.delete() };
    return ref.update(update);
  }));
}

async function sendJobPush(targets, jobId, { title, body, tag }) {
  if (!targets.length) return;
  const response = await admin.messaging().sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    notification: { title, body },
    data: { jobId: String(jobId) },
    webpush: {
      notification: { title, body, requireInteraction: true, tag },
      fcmOptions: { link: '/' },
    },
  });
  response.responses.forEach((r) => {
    if (!r.success) console.error('FCM send failed:', r.error?.code, r.error?.message);
  });
  await pruneInvalidTokens(targets, response.responses);
}

async function notifyAdmins(jobId, alert) {
  const targets = await getPushTargets(admin.firestore().collection('users').where('role', '==', 'admin'));
  await sendJobPush(targets, jobId, alert);
}

function photoCount(job) {
  return ['before', 'after'].reduce((total, type) => {
    const list = Array.isArray(job[`${type}Photos`]) ? job[`${type}Photos`] : [];
    const legacy = job[`${type}PhotoUrl`];
    return total + list.length + (legacy && !list.includes(legacy) ? 1 : 0);
  }, 0);
}

function fileCount(job) {
  return Array.isArray(job.attachments) ? job.attachments.length : 0;
}

// Admins hear about requests from clients, assistants, and the website; admin-created jobs are excluded
exports.notifyAdminsOnNewRequest = onDocumentCreated('jobs/{jobId}', async (event) => {
  const job = event.data.data();
  if (job.createdByRole === 'admin') return null;
  await notifyAdmins(event.params.jobId, {
    title: `New job request: ${job.task || 'Service'}`,
    body: [job.client, job.location].filter(Boolean).join('  |  ') || 'Open the app for details',
    tag: `request-${event.params.jobId}`,
  });
  return null;
});

// Admins hear when a technician checks in or out, requests sign-off, or adds photos or files
exports.notifyAdminsOnTechActivity = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const jobId = event.params.jobId;
  const who = after.assignedTechName || 'A technician';
  const site = after.location || after.client || 'a job';
  const alerts = [];

  if (!before.checkInAt && after.checkInAt) {
    alerts.push({ title: 'Technician checked in', body: `${who} checked in at ${site}`, tag: `checkin-${jobId}` });
  }
  if (!before.checkOutAt && after.checkOutAt) {
    alerts.push({ title: 'Technician checked out', body: `${who} checked out from ${site}`, tag: `checkout-${jobId}` });
  }
  if (before.status !== 'Ready for Signoff' && after.status === 'Ready for Signoff') {
    alerts.push({ title: 'Sign-off requested', body: `${who} requested sign-off for ${site}`, tag: `signoff-${jobId}` });
  }
  const newPhotos = photoCount(after) - photoCount(before);
  if (newPhotos > 0) {
    alerts.push({ title: 'Photos uploaded', body: `${who} added ${newPhotos} photo(s) at ${site}`, tag: `photos-${jobId}` });
  }
  const newFiles = fileCount(after) - fileCount(before);
  if (newFiles > 0) {
    alerts.push({ title: 'Files uploaded', body: `${who} added ${newFiles} file(s) at ${site}`, tag: `files-${jobId}` });
  }

  for (const alert of alerts) await notifyAdmins(jobId, alert);
  return null;
});

// Technicians hear about status changes made by staff; their own changes are excluded
exports.notifyTechOnStaffStatusChange = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after.status || before.status === after.status) return null;
  if (before.assignedTechEmail !== after.assignedTechEmail) return null;
  if (!after.assignedTechEmail || !STAFF_ROLES.includes(after.statusUpdatedByRole)) return null;

  const targets = await getPushTargets(
    admin.firestore().collection('users').where('email', '==', after.assignedTechEmail).limit(1)
  );
  await sendJobPush(targets, event.params.jobId, {
    title: `Job update: ${after.status}`,
    body: `${after.task || 'Your job'} at ${after.location || 'site'} is now ${after.status}`,
    tag: `status-${event.params.jobId}`,
  });
  return null;
});
// A technician is busy only while en route or on site; future scheduled/assigned jobs do not make them busy.
const ACTIVE_FIELD_STATUSES = ['En Route', 'On Site'];

async function syncTechAvailability(email) {
  if (!email) return;
  const db = admin.firestore();
  const techSnap = await db.collection('technicians').where('email', '==', email).limit(1).get();
  if (techSnap.empty) return;
  const jobsSnap = await db.collection('jobs')
    .where('assignedTechEmail', '==', email)
    .where('status', 'in', ACTIVE_FIELD_STATUSES)
    .get();
  const busy = jobsSnap.docs.some((d) => {
    const j = d.data();
    return ACTIVE_FIELD_STATUSES.includes(j.status) && !j.checkOutAt;
  });
  await techSnap.docs[0].ref.update(busy ? { status: 'busy', lastAssignedAt: new Date() } : { status: 'available' });
}

// Fires on job creation — recomputes the assigned technician's availability
exports.manageTechStatusOnJobCreated = onDocumentCreated('jobs/{jobId}', async (event) => {
  const job = event.data.data();
  await syncTechAvailability(job.assignedTechEmail);
  return null;
});

// Fires on job update — syncs technician availability when assignment changes or job completes
// Also sends EmailJS status emails to the client on key status transitions.
exports.manageTechStatusOnJobUpdated = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  // Recompute availability for affected techs when assignment, status, or check-out changes
  const changed = before.assignedTechEmail !== after.assignedTechEmail
    || before.status !== after.status
    || Boolean(before.checkOutAt) !== Boolean(after.checkOutAt);
  if (changed) {
    const emails = new Set([before.assignedTechEmail, after.assignedTechEmail].filter(Boolean));
    for (const email of emails) await syncTechAvailability(email);
  }
  // Email client on meaningful status transitions
  const notifyStatuses = ['Assigned', 'Dispatched', 'En Route', 'On Site', 'Ready for Signoff', 'Completed'];
  if (before.status !== after.status && notifyStatuses.includes(after.status)) {
    await sendClientStatusEmail(
      emailjsServiceId.value().trim(),
      emailjsTemplateId.value().trim(),
      emailjsPublicKey.value().trim(),
      emailjsPrivateKey.value().trim(),
      event.params.jobId,
      after,
      after.status,
    );
  }

  return null;
});

// ── Receivables: client reminders on day 1, 7 and 14 past due, plus a daily admin digest ──
const DAY_MS = 24 * 60 * 60 * 1000;
const NET_TERMS_DAYS = 30;
const REMINDER_STAGES = [
  { afterDays: 1, message: 'Your invoice is past due. Please submit payment using the bank details on your invoice.' },
  { afterDays: 7, message: 'Your invoice is now 7 days past due. Please submit payment as soon as possible.' },
  { afterDays: 14, message: 'Final reminder: your invoice is 14 days past due. Please contact us today to arrange payment.' },
];

async function getInvoiceBalance(jobId) {
  const db = admin.firestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const [billingSnap, consumablesSnap, paymentsSnap] = await Promise.all([
    db.collection('jobBilling').doc(jobId).get(),
    jobRef.collection('consumables').get(),
    jobRef.collection('payments').get(),
  ]);
  const billing = billingSnap.data() || {};
  const prices = billing.consumablePrices || {};
  const totalCents = Math.round(Number(billing.serviceFee || 0) * 100) + consumablesSnap.docs.reduce(
    (sum, item) => sum + Math.round(Number(item.data().qty || 0) * Number(prices[item.id] || 0) * 100),
    0,
  );
  const paidCents = paymentsSnap.docs
    .map((item) => item.data())
    .filter((payment) => !payment.voided)
    .reduce((sum, payment) => sum + Math.round(Number(payment.amount || 0) * 100), 0);
  return { billing, balance: Math.max(0, totalCents - paidCents) / 100 };
}

exports.sendPaymentReminders = onSchedule(
  {
    schedule: '15 9 * * *',
    timeZone: 'America/Los_Angeles',
    secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const serviceId = emailjsServiceId.value().trim();
    const templateId = emailjsTemplateId.value().trim();
    const publicKey = emailjsPublicKey.value().trim();
    const privateKey = emailjsPrivateKey.value().trim();

    const cutoff = admin.firestore.Timestamp.fromMillis(now - NET_TERMS_DAYS * DAY_MS);
    const signedOffSnap = await db.collection('jobs').where('adminSignedOffAt', '<', cutoff).get();

    const overdue = [];
    for (const jobDoc of signedOffSnap.docs) {
      const job = jobDoc.data();
      if (job.invoiceSent !== true) continue;

      const { billing, balance } = await getInvoiceBalance(jobDoc.id);
      if (balance <= 0) continue;

      const dueMs = job.adminSignedOffAt.toMillis() + NET_TERMS_DAYS * DAY_MS;
      const daysOverdue = Math.floor((now - dueMs) / DAY_MS);
      overdue.push({ jobId: jobDoc.id, job, balance, daysOverdue });

      const stageNumber = REMINDER_STAGES.findIndex((stage) => stage.afterDays === daysOverdue) + 1;
      if (stageNumber === 0 || stageNumber <= (billing.paymentReminderStage || 0) || !job.clientEmail) continue;

      try {
        await sendEmailJs(serviceId, templateId, publicKey, privateKey, {
          to_email:       job.clientEmail,
          to_name:        job.client || 'Valued Customer',
          job_status:     'Payment reminder',
          job_task:       job.task || '',
          job_location:   job.location || '',
          tech_name:      '',
          status_message: `${REMINDER_STAGES[stageNumber - 1].message} Balance due: $${balance.toFixed(2)}.`,
          job_id:         jobDoc.id,
        });
        await db.collection('jobBilling').doc(jobDoc.id).set({
          paymentReminderStage: stageNumber,
          paymentRemindedAt: new Date(),
        }, { merge: true });
      } catch (err) {
        console.error(`Payment reminder failed for job ${jobDoc.id}:`, err.message);
      }
    }

    if (overdue.length === 0) return;

    const total = overdue.reduce((sum, item) => sum + item.balance, 0);
    const lines = overdue
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((item) => `${item.job.client || 'Unnamed client'} (${item.jobId}): $${item.balance.toFixed(2)}, ${item.daysOverdue} day(s) overdue`);
    const digestMessage = `${overdue.length} overdue invoice(s), $${total.toFixed(2)} total:\n${lines.join('\n')}`;

    const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
    for (const adminDoc of adminsSnap.docs) {
      const adminEmail = adminDoc.data().email;
      if (!adminEmail) continue;
      try {
        await sendEmailJs(serviceId, templateId, publicKey, privateKey, {
          to_email:       adminEmail,
          to_name:        adminDoc.data().displayName || 'Admin',
          job_status:     'Receivables digest',
          job_task:       '',
          job_location:   '',
          tech_name:      '',
          status_message: digestMessage,
          job_id:         '',
        });
      } catch (err) {
        console.error(`Receivables digest failed for ${adminEmail}:`, err.message);
      }
    }
  },
);

// Mirrors users/{uid}.role into the Auth token so security rules can read it without get() calls
exports.syncRoleClaim = onDocumentWritten('users/{uid}', async (event) => {
  const uid = event.params.uid;
  const role = event.data.after.exists ? event.data.after.data().role || null : null;

  const user = await admin.auth().getUser(uid).catch((err) => {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  });
  if (!user || (user.customClaims?.role ?? null) === role) return null;

  const claims = { ...(user.customClaims || {}) };
  if (role) claims.role = role;
  else delete claims.role;
  await admin.auth().setCustomUserClaims(uid, claims);
  return null;
});

// ── Website form → Firestore job ──────────────────────────────────────────────
// Called by your business website's contact/service form.
// Replace the cors origin with your website's actual domain for tighter security.
exports.createJobFromWebsite = onRequest({ cors: ['https://www.siliconvalleysmarthands.com'] }, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fullName, companyName, serviceType, email, urgencyLevel, preferredStartDate, scopeOfWork } = req.body;

  // Basic validation
  if (!fullName || !email || !serviceType) {
    return res.status(400).json({ error: 'fullName, email, and serviceType are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const db = admin.firestore();

  const jobData = {
    client:            fullName,
    clientCompany:     companyName || '',
    clientEmail:       email,
    clientPhone:       '',
    location:          '',
    rawLocation:       '',
    lat:               null,
    lng:               null,
    task:              serviceType,
    details:           scopeOfWork || '',
    serialNumber:      '',
    urgency:           urgencyLevel || '',
    scheduledFor:      preferredStartDate ? new Date(preferredStartDate) : null,
    status:            'Pending',
    assignedTechName:  '',
    assignedTechEmail: '',
    assignedTechDistanceMiles: null,
    assignedTechDistanceKm:    null,
    billingMigrated:   true,
    invoiceSent:       false,
    beforePhotoUrl:    '',
    afterPhotoUrl:     '',
    clientSignedOff:   false,
    source:            'website',
    createdAt:         new Date(),
  };

  try {
    const docRef = await db.collection('jobs').add(jobData);
    return res.status(200).json({ success: true, jobId: docRef.id });
  } catch (err) {
    console.error('createJobFromWebsite failed:', err.message);
    return res.status(500).json({ error: 'Failed to create job' });
  }
});