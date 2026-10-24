const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
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
const emailjsInvoiceTemplateId = defineSecret('EMAILJS_INVOICE_TEMPLATE_ID');

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

// Fires when a job's start time changes for the tech already on it; reassignment is covered by notifyTechOnJobAssigned
exports.notifyTechOnJobRescheduled = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (!after.assignedTechEmail || before.assignedTechEmail !== after.assignedTechEmail) return null;
  const newStart = toMillisValue(after.scheduledFor);
  if (newStart == null || toMillisValue(before.scheduledFor) === newStart) return null;

  const when = new Date(newStart).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const targets = await getPushTargets(
    admin.firestore().collection('users').where('email', '==', after.assignedTechEmail).limit(1)
  );
  await sendJobPush(targets, event.params.jobId, {
    title: `Rescheduled: ${after.task || 'Job'}`,
    body: `New time: ${when} at ${after.location || 'site'}`,
    tag: `reschedule-${event.params.jobId}`,
  });
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

// Photos and files live in jobs/{id}/photos and jobs/{id}/files; legacy array fields are read until migrated
function legacyPhotoUrls(job, type) {
  const list = Array.isArray(job[`${type}Photos`]) ? job[`${type}Photos`] : [];
  const legacy = job[`${type}PhotoUrl`];
  return legacy && !list.includes(legacy) ? [legacy, ...list] : list;
}

function legacyAttachments(job) {
  return Array.isArray(job.attachments) ? job.attachments : [];
}

async function refreshJobMediaCounts(jobId) {
  const jobRef = admin.firestore().collection('jobs').doc(jobId);
  const [jobSnap, photosSnap, filesSnap] = await Promise.all([
    jobRef.get(),
    jobRef.collection('photos').get(),
    jobRef.collection('files').get(),
  ]);
  if (!jobSnap.exists) return;
  const job = jobSnap.data();
  const photoDocs = photosSnap.docs.map((d) => d.data());
  const photoCounts = {};
  for (const type of ['before', 'after']) {
    const urls = new Set([
      ...photoDocs.filter((p) => p.type === type).map((p) => p.url),
      ...legacyPhotoUrls(job, type),
    ]);
    photoCounts[type] = urls.size;
  }
  const fileUrls = new Set([
    ...filesSnap.docs.map((d) => d.data().url),
    ...legacyAttachments(job).map((f) => f.url),
  ]);
  photoCounts.files = fileUrls.size;
  await jobRef.update({ photoCounts });
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

  for (const alert of alerts) await notifyAdmins(jobId, alert);
  return null;
});

async function jobAlertContext(jobId) {
  const job = (await admin.firestore().collection('jobs').doc(jobId).get()).data() || {};
  return {
    who: job.assignedTechName || 'A technician',
    site: job.location || job.client || 'a job',
  };
}

exports.refreshPhotoCountsOnPhotoWrite = onDocumentWritten('jobs/{jobId}/photos/{photoId}', async (event) => {
  await refreshJobMediaCounts(event.params.jobId);
  return null;
});

exports.refreshPhotoCountsOnFileWrite = onDocumentWritten('jobs/{jobId}/files/{fileId}', async (event) => {
  await refreshJobMediaCounts(event.params.jobId);
  return null;
});

exports.notifyAdminsOnPhotoAdded = onDocumentCreated('jobs/{jobId}/photos/{photoId}', async (event) => {
  if (event.data.data().migrated) return null;
  const jobId = event.params.jobId;
  const { who, site } = await jobAlertContext(jobId);
  await notifyAdmins(jobId, { title: 'Photo uploaded', body: `${who} added a photo at ${site}`, tag: `photos-${jobId}` });
  return null;
});

exports.notifyAdminsOnFileAdded = onDocumentCreated('jobs/{jobId}/files/{fileId}', async (event) => {
  if (event.data.data().migrated) return null;
  const jobId = event.params.jobId;
  const { who, site } = await jobAlertContext(jobId);
  await notifyAdmins(jobId, { title: 'File uploaded', body: `${who} added a file at ${site}`, tag: `files-${jobId}` });
  return null;
});

const LEGACY_MEDIA_FIELDS = ['beforePhotos', 'afterPhotos', 'beforePhotoUrl', 'afterPhotoUrl', 'attachments'];

// Admin-only, idempotent: copies legacy job arrays into subcollections, then removes the arrays
exports.migrateJobPhotos = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  if (request.auth?.token?.role !== 'admin') throw new HttpsError('permission-denied', 'Admins only.');
  const db = admin.firestore();
  const summary = { jobs: 0, photos: 0, files: 0 };
  let cursor = null;

  for (;;) {
    let pageQuery = db.collection('jobs').orderBy(admin.firestore.FieldPath.documentId()).limit(200);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    if (page.empty) break;
    cursor = page.docs[page.docs.length - 1];

    for (const jobDoc of page.docs) {
      const job = jobDoc.data();
      if (!LEGACY_MEDIA_FIELDS.some((field) => field in job)) continue;

      const batch = db.batch();
      let photoWrites = 0;
      for (const type of ['before', 'after']) {
        legacyPhotoUrls(job, type).filter(Boolean).forEach((url, index) => {
          const id = `legacy-${type}-${String(index).padStart(4, '0')}`;
          batch.set(jobDoc.ref.collection('photos').doc(id), {
            type, url, uploadedAt: job.createdAt || null, uploadedBy: 'migration', migrated: true,
          });
          photoWrites += 1;
        });
      }
      const fileWrites = legacyAttachments(job).filter((f) => f.url).map((file, index) => {
        const id = `legacy-file-${String(index).padStart(4, '0')}`;
        batch.set(jobDoc.ref.collection('files').doc(id), {
          name: file.name || '', url: file.url, size: file.size || 0, type: file.type || '',
          uploadedAt: job.createdAt || null, uploadedBy: 'migration', migrated: true,
        });
        return file;
      });

      const removals = Object.fromEntries(LEGACY_MEDIA_FIELDS.filter((field) => field in job).map((field) => [field, admin.firestore.FieldValue.delete()]));
      batch.update(jobDoc.ref, removals);
      await batch.commit();
      await refreshJobMediaCounts(jobDoc.id);

      summary.jobs += 1;
      summary.photos += photoWrites;
      summary.files += fileWrites.length;
    }
  }
  return summary;
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

// ── Auto-assign: nearest technician with no overlapping job ──────────────────
const JOB_WINDOW_MS = 2 * 60 * 60 * 1000;
const APP_CREATOR_ROLES = ['client', 'adminAssistant', 'admin'];

function toMillisValue(value) {
  if (!value) return null;
  const ms = typeof value.toMillis === 'function' ? value.toMillis() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getJobWindowMs(job, now) {
  const scheduled = toMillisValue(job.scheduledFor);
  if (scheduled != null) {
    const end = toMillisValue(job.scheduledEnd);
    return { start: scheduled, end: end != null && end > scheduled ? end : scheduled + JOB_WINDOW_MS };
  }
  if (job.status === 'En Route' || (job.status === 'On Site' && !job.checkOutAt)) {
    return { start: now, end: now + JOB_WINDOW_MS };
  }
  return null;
}

function hasTechConflict(target, techEmail, openJobs, now) {
  const targetWindow = getJobWindowMs(target, now) || { start: now, end: now + JOB_WINDOW_MS };
  return openJobs.some((other) => {
    if (other.id === target.id || other.assignedTechEmail !== techEmail) return false;
    const otherWindow = getJobWindowMs(other, now);
    return otherWindow && otherWindow.start < targetWindow.end && targetWindow.start < otherWindow.end;
  });
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.assignTechOnJobCreate = onDocumentCreated('jobs/{jobId}', async (event) => {
  const job = event.data.data();
  if (!APP_CREATOR_ROLES.includes(job.createdByRole)) return null;
  if (job.status !== 'Pending' || job.assignedTechEmail) return null;
  if (typeof job.lat !== 'number' || typeof job.lng !== 'number') return null;

  const db = admin.firestore();
  const jobId = event.params.jobId;
  const [techsSnap, openSnap] = await Promise.all([
    db.collection('technicians').get(),
    db.collection('jobs').where('status', '!=', 'Completed').get(),
  ]);

  const now = Date.now();
  const target = { id: jobId, ...job };
  const openJobs = openSnap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

  let nearest = null;
  for (const techDoc of techsSnap.docs) {
    const tech = techDoc.data();
    if (!tech.email || typeof tech.lat !== 'number' || typeof tech.lng !== 'number') continue;
    if (hasTechConflict(target, tech.email, openJobs, now)) continue;
    const miles = distanceMiles(job.lat, job.lng, tech.lat, tech.lng);
    if (!nearest || miles < nearest.miles) nearest = { name: tech.name || '', email: tech.email, miles };
  }
  if (!nearest) return null;

  const ref = db.collection('jobs').doc(jobId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data();
    if (current.status !== 'Pending' || current.assignedTechEmail) return;
    tx.update(ref, {
      status: 'Assigned',
      statusUpdatedByRole: 'system',
      assignedTechName: nearest.name,
      assignedTechEmail: nearest.email,
      assignedTechDistanceMiles: nearest.miles,
      assignedTechDistanceKm: null,
    });
  });
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

// Emails the signed-off invoice to the client; retries link-only if EmailJS rejects the PDF attachment
exports.sendInvoiceEmailOnSignOff = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    secrets: [emailjsServiceId, emailjsInvoiceTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after.invoicePdfPath || after.invoicePdfPath === before.invoicePdfPath || !after.clientEmail) return;

    const jobId = event.params.jobId;
    const serviceId = emailjsServiceId.value().trim();
    const templateId = emailjsInvoiceTemplateId.value().trim();
    const publicKey = emailjsPublicKey.value().trim();
    const privateKey = emailjsPrivateKey.value().trim();

    const [[pdfBytes], { balance }] = await Promise.all([
      admin.storage().bucket().file(after.invoicePdfPath).download(),
      getInvoiceBalance(jobId),
    ]);
    const templateParams = {
      to_email:         after.clientEmail,
      to_name:          after.client || 'Valued Customer',
      job_id:           jobId,
      amount_due:       `$${balance.toFixed(2)}`,
      invoice_link:     'https://smart-hands-live.web.app',
      invoice_filename: `SV-Smart-Dispatch-Invoice-${jobId}.pdf`,
    };

    const billingRef = admin.firestore().collection('jobBilling').doc(jobId);
    let sentWith = 'attachment';
    try {
      await sendEmailJs(serviceId, templateId, publicKey, privateKey, {
        ...templateParams,
        invoice_pdf: pdfBytes.toString('base64'),
      });
    } catch (err) {
      console.error(`Invoice email with attachment failed for job ${jobId}, sending link only:`, err.message);
      sentWith = 'link';
      try {
        await sendEmailJs(serviceId, templateId, publicKey, privateKey, templateParams);
      } catch (linkErr) {
        console.error(`Invoice email failed for job ${jobId}:`, linkErr.message);
        await billingRef.set({ invoiceEmailError: linkErr.message, invoiceEmailAttemptedAt: new Date() }, { merge: true });
        return;
      }
    }
    await billingRef.set({ invoiceEmailSentAt: new Date(), invoiceEmailSentWith: sentWith }, { merge: true });
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
// Staff-only serial number lookup; returns just the fields asset history needs, including completed visits
exports.lookupAssetHistory = onCall(async (request) => {
  const role = request.auth?.token?.role;
  if (!['admin', 'adminAssistant'].includes(role)) {
    throw new HttpsError('permission-denied', 'Staff only.');
  }
  const serialNumber = String(request.data?.serialNumber || '').trim();
  if (!serialNumber || serialNumber.length > 64) {
    throw new HttpsError('invalid-argument', 'Enter a serial number.');
  }

  const snapshot = await admin.firestore().collection('jobs').where('serialNumber', '==', serialNumber).get();
  const toIso = (value) => (value?.toDate ? value.toDate().toISOString() : null);
  const visits = snapshot.docs.map((doc) => {
    const job = doc.data();
    return {
      id: doc.id,
      client: job.client || '',
      location: job.location || '',
      task: job.task || '',
      details: job.details || '',
      status: job.status || '',
      assignedTechName: job.assignedTechName || '',
      createdAt: toIso(job.createdAt),
      scheduledFor: toIso(job.scheduledFor),
      completedAt: toIso(job.completedAt),
    };
  }).sort((a, b) => (b.scheduledFor || b.createdAt || '').localeCompare(a.scheduledFor || a.createdAt || ''));

  return { serialNumber, visits };
});

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