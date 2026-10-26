const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('crypto');
const { partStockAdjustments, stockChangeAlerts } = require('./stock');
const { reminderStageFor } = require('./reminders');
const { quoteTotalCents, quoteAcceptProblem, buildQuoteJob } = require('./quote');
const Stripe = require('stripe');
const { checkoutAction, checkoutProblem, checkoutSessionParams, paymentFromCheckoutSession } = require('./stripe');
const { validateWebsiteIntake } = require('./websiteIntake');
const { REVERT_FIELDS, getTargetWindowMs, hasTechConflict, needsConflictCheck, toMillisValue } = require('./schedule');
const { parseStaffAccount } = require('./accounts');
const { FREQUENCIES, advanceOccurrence, dueOccurrences } = require('./contracts');

const WEBSITE_INTAKE_LIMIT = 10;
const WEBSITE_INTAKE_GLOBAL_LIMIT = 50;
const WEBSITE_INTAKE_WINDOW_MS = 60 * 60 * 1000;

function nextIntakeWindow(current, limit, now) {
  const windowOpen = current && now - current.windowStartMs < WEBSITE_INTAKE_WINDOW_MS;
  const count = windowOpen ? current.count : 0;
  if (count >= limit) return null;
  return { count: count + 1, windowStartMs: windowOpen ? current.windowStartMs : now };
}

// Cloud Functions appends the real client IP last; earlier entries are client-supplied and can be spoofed.
const websiteIntakeAllowed = (db, req) => {
  const clientIp = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',').pop().trim();
  const ipRef = db.collection('websiteIntakeLimits').doc(crypto.createHash('sha256').update(clientIp).digest('hex'));
  const globalRef = db.collection('websiteIntakeLimits').doc('global');
  return db.runTransaction(async (tx) => {
    const [ipSnap, globalSnap] = await Promise.all([tx.get(ipRef), tx.get(globalRef)]);
    const now = Date.now();
    const ip = nextIntakeWindow(ipSnap.data(), WEBSITE_INTAKE_LIMIT, now);
    const global = nextIntakeWindow(globalSnap.data(), WEBSITE_INTAKE_GLOBAL_LIMIT, now);
    if (!ip || !global) return false;
    tx.set(ipRef, ip);
    tx.set(globalRef, global);
    return true;
  });
};

initializeApp();

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
// Stripe: firebase functions:secrets:set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

/**
 * Looks up the assigned tech's FCM token and sends a push notification
 * with the full dispatch payload: task, serial number, site location, details.
 */
async function sendDispatchNotification(jobId, job) {
  if (!job.assignedTechEmail) return;

  const targets = await getPushTargets(
    getFirestore().collection('users').where('email', '==', job.assignedTechEmail).limit(1)
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
    const response = await getMessaging().sendEachForMulticast({ ...message, tokens: targets.map((t) => t.token) });
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
    getFirestore().collection('users').where('email', '==', after.assignedTechEmail).limit(1)
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
      ? { fcmTokens: FieldValue.arrayRemove(token) }
      : { fcmToken: FieldValue.delete() };
    return ref.update(update);
  }));
}

async function sendJobPush(targets, jobId, { title, body, tag }) {
  if (!targets.length) return;
  const response = await getMessaging().sendEachForMulticast({
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
  const targets = await getPushTargets(getFirestore().collection('users').where('role', '==', 'admin'));
  await sendJobPush(targets, jobId, alert);
}

async function refreshJobMediaCounts(jobId) {
  const jobRef = getFirestore().collection('jobs').doc(jobId);
  const [jobSnap, photosSnap, filesSnap] = await Promise.all([
    jobRef.get(),
    jobRef.collection('photos').get(),
    jobRef.collection('files').get(),
  ]);
  if (!jobSnap.exists) return;
  const photoDocs = photosSnap.docs.map((d) => d.data());
  const photoCounts = {};
  for (const type of ['before', 'after']) {
    photoCounts[type] = new Set(photoDocs.filter((p) => p.type === type).map((p) => p.url)).size;
  }
  photoCounts.files = new Set(filesSnap.docs.map((d) => d.data().url)).size;
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
  const job = (await getFirestore().collection('jobs').doc(jobId).get()).data() || {};
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

exports.syncPartStockOnConsumableWrite = onDocumentWritten('jobs/{jobId}/consumables/{itemId}', async (event) => {
  const adjustments = partStockAdjustments(event.data?.before?.data(), event.data?.after?.data());
  const partIds = Object.keys(adjustments);
  if (!partIds.length) return null;
  const db = getFirestore();
  const markerRef = db.collection('stockEvents').doc(event.id);
  const changes = await db.runTransaction(async (tx) => {
    if ((await tx.get(markerRef)).exists) return [];
    const partRefs = partIds.map((partId) => db.collection('parts').doc(partId));
    const partSnaps = await Promise.all(partRefs.map((ref) => tx.get(ref)));
    const applied = [];
    partSnaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const partId = partIds[index];
      const delta = adjustments[partId];
      const data = snap.data();
      const before = Number(data.onHand) || 0;
      tx.update(partRefs[index], { onHand: FieldValue.increment(delta) });
      applied.push({ partId, name: data.name, delta, before, after: before + delta, reorderPoint: Number(data.reorderPoint) || 0 });
    });
    tx.set(markerRef, { createdAt: new Date() });
    return applied;
  });
  const alerts = stockChangeAlerts(changes, event.params.jobId);
  if (!alerts.length) return null;
  const targets = await getPushTargets(db.collection('users').where('role', 'in', ['admin', 'adminAssistant']));
  for (const alert of alerts) {
    await sendJobPush(targets, event.params.jobId, alert);
  }
  return null;
});

exports.notifyAdminsOnPhotoAdded = onDocumentCreated('jobs/{jobId}/photos/{photoId}', async (event) => {
  const jobId = event.params.jobId;
  const { who, site } = await jobAlertContext(jobId);
  await notifyAdmins(jobId, { title: 'Photo uploaded', body: `${who} added a photo at ${site}`, tag: `photos-${jobId}` });
  return null;
});

exports.notifyAdminsOnFileAdded = onDocumentCreated('jobs/{jobId}/files/{fileId}', async (event) => {
  const jobId = event.params.jobId;
  const { who, site } = await jobAlertContext(jobId);
  await notifyAdmins(jobId, { title: 'File uploaded', body: `${who} added a file at ${site}`, tag: `files-${jobId}` });
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
    getFirestore().collection('users').where('email', '==', after.assignedTechEmail).limit(1)
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
  const db = getFirestore();
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
const APP_CREATOR_ROLES = ['client', 'adminAssistant', 'admin'];

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

  const db = getFirestore();
  const jobId = event.params.jobId;
  const now = Date.now();
  const target = { id: jobId, ...job };
  const [techsSnap, openJobs] = await Promise.all([
    db.collection('technicians').get(),
    openJobsNearWindow(db, getTargetWindowMs(target, now)),
  ]);

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

// Open jobs that could overlap a window: scheduled up to a day before it or later, or already underway
const SCHEDULE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const UNDERWAY_STATUSES = ['En Route', 'On Site'];

async function openJobsNearWindow(db, span, techEmail = null) {
  const scope = (query) => (techEmail ? query.where('assignedTechEmail', '==', techEmail) : query);
  const jobs = db.collection('jobs');
  const [scheduledSnap, underwaySnap] = await Promise.all([
    scope(jobs)
      .where('scheduledFor', '>=', new Date(span.start - SCHEDULE_LOOKBACK_MS))
      .where('scheduledFor', '<=', new Date(span.end))
      .get(),
    scope(jobs).where('status', 'in', UNDERWAY_STATUSES).get(),
  ]);
  const byId = new Map();
  for (const docItem of [...scheduledSnap.docs, ...underwaySnap.docs]) {
    const job = docItem.data();
    if (job.status !== 'Completed') byId.set(docItem.id, { id: docItem.id, ...job });
  }
  return [...byId.values()];
}

// Undoes a schedule or technician change that double-books someone, since rules cannot query other jobs
exports.revertConflictingScheduleChanges = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!needsConflictCheck(before, after)) return null;
  const jobId = event.params.jobId;

  const now = Date.now();
  const target = { id: jobId, ...after };
  const openJobs = await openJobsNearWindow(getFirestore(), getTargetWindowMs(target, now), after.assignedTechEmail);
  if (!hasTechConflict(target, after.assignedTechEmail, openJobs, now)) return null;

  const revert = { conflictRevertedAt: FieldValue.serverTimestamp() };
  for (const field of REVERT_FIELDS) {
    revert[field] = before[field] === undefined ? FieldValue.delete() : before[field];
  }
  await event.data.after.ref.update(revert);
  await notifyAdmins(jobId, {
    title: 'Schedule change undone',
    body: `${after.assignedTechName || 'The technician'} is already booked then, so ${after.client || 'this job'} went back to its previous schedule.`,
    tag: `conflict-revert-${jobId}-${Date.now()}`,
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
const REMINDER_PAGE_SIZE = 200;
const REMINDER_STAGES = [
  { afterDays: 1, message: 'Your invoice is past due. Please submit payment using the bank details on your invoice.' },
  { afterDays: 7, message: 'Your invoice is now 7 days past due. Please submit payment as soon as possible.' },
  { afterDays: 14, message: 'Final reminder: your invoice is 14 days past due. Please contact us today to arrange payment.' },
];

async function getInvoiceBalance(jobId) {
  const db = getFirestore();
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
    timeoutSeconds: 540,
    secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const serviceId = emailjsServiceId.value().trim();
    const templateId = emailjsTemplateId.value().trim();
    const publicKey = emailjsPublicKey.value().trim();
    const privateKey = emailjsPrivateKey.value().trim();

    const cutoff = Timestamp.fromMillis(now - NET_TERMS_DAYS * DAY_MS);
    const overdue = [];
    let lastDoc = null;
    for (;;) {
      let pageQuery = db.collection('jobs')
        .where('adminSignedOffAt', '<', cutoff)
        .orderBy('adminSignedOffAt')
        .limit(REMINDER_PAGE_SIZE);
      if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
      const page = await pageQuery.get();

      for (const jobDoc of page.docs) {
        const job = jobDoc.data();
        if (job.invoiceSent !== true) continue;

        const { billing, balance } = await getInvoiceBalance(jobDoc.id);
        if (balance <= 0) continue;

        const dueMs = job.adminSignedOffAt.toMillis() + NET_TERMS_DAYS * DAY_MS;
        const daysOverdue = Math.floor((now - dueMs) / DAY_MS);
        overdue.push({ jobId: jobDoc.id, job, balance, daysOverdue });

        const stageNumber = reminderStageFor(daysOverdue, REMINDER_STAGES);
        if (stageNumber <= (billing.paymentReminderStage || 0) || !job.clientEmail) continue;

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

      if (page.size < REMINDER_PAGE_SIZE) break;
      lastDoc = page.docs[page.docs.length - 1];
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

// Emails the job's saved invoice PDF to the client; retries link-only if EmailJS rejects the attachment
async function sendInvoiceEmail(jobId, job) {
  const serviceId = emailjsServiceId.value().trim();
  const templateId = emailjsInvoiceTemplateId.value().trim();
  const publicKey = emailjsPublicKey.value().trim();
  const privateKey = emailjsPrivateKey.value().trim();

  const [[pdfBytes], { balance }] = await Promise.all([
    getStorage().bucket().file(job.invoicePdfPath).download(),
    getInvoiceBalance(jobId),
  ]);
  const templateParams = {
    to_email:         job.clientEmail,
    to_name:          job.client || 'Valued Customer',
    job_id:           jobId,
    amount_due:       `$${balance.toFixed(2)}`,
    invoice_link:     'https://smart-hands-live.web.app',
    invoice_filename: `SV-Smart-Dispatch-Invoice-${jobId}.pdf`,
  };

  const billingRef = getFirestore().collection('jobBilling').doc(jobId);
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
      throw linkErr;
    }
  }
  await billingRef.set({ invoiceEmailSentAt: new Date(), invoiceEmailSentWith: sentWith }, { merge: true });
}

exports.sendInvoiceEmailOnSignOff = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    secrets: [emailjsServiceId, emailjsInvoiceTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after.invoicePdfPath || after.invoicePdfPath === before.invoicePdfPath || !after.clientEmail) return;
    await sendInvoiceEmail(event.params.jobId, after).catch(() => {});
  },
);

exports.resendInvoiceEmail = onCall(
  { secrets: [emailjsServiceId, emailjsInvoiceTemplateId, emailjsPublicKey, emailjsPrivateKey] },
  async (request) => {
    if (request.auth?.token?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can resend invoices.');
    const jobId = request.data?.jobId;
    if (!jobId) throw new HttpsError('invalid-argument', 'Missing job.');
    const snap = await getFirestore().collection('jobs').doc(jobId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Job not found.');
    const job = snap.data();
    if (!job.adminSignedOff || !job.invoicePdfPath) throw new HttpsError('failed-precondition', 'Sign off the work before sending the invoice.');
    if (!job.clientEmail) throw new HttpsError('failed-precondition', 'This job has no client email.');
    try {
      await sendInvoiceEmail(jobId, job);
    } catch (err) {
      throw new HttpsError('internal', `Invoice email failed: ${err.message}`);
    }
    return { sentTo: job.clientEmail };
  },
);

// Returns the saved invoice PDF to the admin or the job's own client; clients never read invoiceBilling
exports.getInvoicePdf = onCall(async (request) => {
  const token = request.auth?.token;
  const jobId = request.data?.jobId;
  if (!jobId) throw new HttpsError('invalid-argument', 'Missing job.');
  const snap = await getFirestore().collection('jobs').doc(jobId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Job not found.');
  const job = snap.data();
  const isOwnerClient = token?.role === 'client' && token.email_verified === true && job.clientEmail === token.email;
  if (token?.role !== 'admin' && !isOwnerClient) throw new HttpsError('permission-denied', 'You cannot access this invoice.');
  if (!job.adminSignedOff || !job.invoicePdfPath) throw new HttpsError('failed-precondition', 'This invoice is not available yet.');
  const [pdfBytes] = await getStorage().bucket().file(job.invoicePdfPath).download();
  return { base64: pdfBytes.toString('base64') };
});

// Removes the login account and its staff records; admins only, never their own account
exports.deleteStaffAccount = onCall(async (request) => {
  if (request.auth?.token?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can delete accounts.');
  const uid = request.data?.uid;
  if (!uid || typeof uid !== 'string') throw new HttpsError('invalid-argument', 'Missing user.');
  if (uid === request.auth.uid) throw new HttpsError('failed-precondition', 'You cannot delete your own account.');
  await getAuth().deleteUser(uid).catch((err) => {
    if (err.code !== 'auth/user-not-found') throw err;
  });
  const db = getFirestore();
  await Promise.all([
    db.collection('users').doc(uid).delete(),
    db.collection('technicians').doc(uid).delete(),
    db.collection('badges').doc(uid).delete(),
  ]);
  return { deleted: true };
});

// Admins create every login here; profile, technician record, and verification email are written server-side
exports.createStaffAccount = onCall(
  { secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey] },
  async (request) => {
    if (request.auth?.token?.role !== 'admin') throw new HttpsError('permission-denied', 'Only admins can create accounts.');
    const { account, error } = parseStaffAccount(request.data);
    if (error) throw new HttpsError('invalid-argument', error);

    const db = getFirestore();
    const user = await getAuth().createUser({
      email: account.email,
      password: account.password,
      displayName: account.name,
    }).catch((err) => {
      if (err.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'An account with that email already exists.');
      throw err;
    });

    try {
      const batch = db.batch();
      batch.set(db.collection('users').doc(user.uid), {
        uid: user.uid,
        displayName: account.name,
        email: account.email,
        role: account.role,
        mustChangePassword: true,
      });
      if (account.role === 'tech') {
        batch.set(db.collection('technicians').doc(user.uid), {
          uid: user.uid,
          name: account.name,
          email: account.email,
          phone: account.phone,
          location: account.location,
          rawLocation: account.rawLocation,
          lat: account.lat,
          lng: account.lng,
          status: 'available',
          createdAt: new Date(),
        });
      }
      await batch.commit();
    } catch (err) {
      await getAuth().deleteUser(user.uid).catch(() => {});
      throw err;
    }

    try {
      const link = await getAuth().generateEmailVerificationLink(account.email);
      await sendEmailJs(
        emailjsServiceId.value().trim(),
        emailjsTemplateId.value().trim(),
        emailjsPublicKey.value().trim(),
        emailjsPrivateKey.value().trim(),
        {
          to_email:       account.email,
          to_name:        account.name,
          job_status:     'Verify your email',
          job_task:       '',
          job_location:   '',
          tech_name:      '',
          status_message: `Confirm your email address to finish setting up your account: ${link}`,
          job_id:         '',
        },
      );
    } catch (err) {
      console.error('Verification email failed', err.message);
    }
    return { uid: user.uid };
  },
);

const CONTRACT_LEAD_MS = 7 * 24 * 60 * 60 * 1000;
const CONTRACT_JOBS_PER_RUN = 12;

// Creates one visit only if the contract is still due at that time, so retries and overlapping runs cannot duplicate it
async function createContractJob(db, contractId, occurrenceMs) {
  const contractRef = db.collection('maintenanceContracts').doc(contractId);
  const jobRef = db.collection('jobs').doc(`${contractId}_${occurrenceMs}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(contractRef);
    if (!snap.exists) return false;
    const contract = snap.data();
    if (contract.active !== true || toMillisValue(contract.nextRunAt) !== occurrenceMs) return false;
    tx.set(jobRef, {
      client: contract.client || '',
      clientEmail: contract.clientEmail || '',
      clientPhone: contract.clientPhone || '',
      location: contract.location || '',
      rawLocation: contract.rawLocation || '',
      lat: contract.lat,
      lng: contract.lng,
      task: contract.task || '',
      details: contract.details || '',
      serialNumber: contract.serialNumber || '',
      scheduledFor: new Date(occurrenceMs),
      scheduledEnd: null,
      status: 'Pending',
      createdByRole: 'admin',
      maintenanceContractId: contractId,
      billingMigrated: true,
      invoiceSent: false,
      clientSignedOff: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: 'maintenance-contract',
    });
    tx.update(contractRef, { nextRunAt: new Date(advanceOccurrence(occurrenceMs, contract.frequency)) });
    return true;
  });
}

// Creates visits for active maintenance contracts that fall within the next week
exports.createMaintenanceJobs = onSchedule(
  { schedule: 'every day 06:00', timeZone: 'America/Los_Angeles' },
  async () => {
    const db = getFirestore();
    const contracts = await db.collection('maintenanceContracts').where('active', '==', true).get();
    const horizon = Date.now() + CONTRACT_LEAD_MS;
    for (const contract of contracts.docs) {
      const data = contract.data();
      const nextRunMs = toMillisValue(data.nextRunAt);
      if (!nextRunMs || !FREQUENCIES.includes(data.frequency)) continue;
      for (const occurrenceMs of dueOccurrences(nextRunMs, data.frequency, horizon, CONTRACT_JOBS_PER_RUN)) {
        if (!(await createContractJob(db, contract.id, occurrenceMs))) break;
      }
    }
  },
);

// Emails the client when staff send a quote; the client accepts it in the app
exports.sendQuoteEmailOnSend = onDocumentUpdated(
  {
    document: 'quotes/{quoteId}',
    secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (after.status !== 'Sent' || before.status === 'Sent' || !after.clientEmail) return;

    const quoteId = event.params.quoteId;
    const total = quoteTotalCents(after.lines, after.serviceFee) / 100;
    const validUntil = after.validUntil.toDate().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
    });
    try {
      await sendEmailJs(
        emailjsServiceId.value().trim(),
        emailjsTemplateId.value().trim(),
        emailjsPublicKey.value().trim(),
        emailjsPrivateKey.value().trim(),
        {
          to_email:       after.clientEmail,
          to_name:        after.client || 'Valued Customer',
          job_status:     'Quote ready',
          job_task:       after.task || '',
          job_location:   after.location || '',
          tech_name:      '',
          status_message: `Your quote is ready. Total: $${total.toFixed(2)}. Valid until ${validUntil}. Sign in to review and accept it.`,
          job_id:         quoteId,
        },
      );
    } catch (err) {
      console.error(`Quote email failed for quote ${quoteId}:`, err.message);
    }
  },
);

// Client accepts a sent quote; creates the pending job and its billing in one transaction
exports.acceptQuote = onCall(async (request) => {
  const token = request.auth?.token;
  if (token?.role !== 'client' || token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Only verified clients can accept quotes.');
  }
  const quoteId = String(request.data?.quoteId || '').trim();
  if (!quoteId) throw new HttpsError('invalid-argument', 'Missing quote.');

  const db = getFirestore();
  const quoteRef = db.collection('quotes').doc(quoteId);
  const jobRef = db.collection('jobs').doc();
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(quoteRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Quote not found.');
    const quote = snap.data();
    if (quote.clientEmail !== token.email) {
      throw new HttpsError('permission-denied', 'This quote is not yours.');
    }
    const problem = quoteAcceptProblem(quote, now.getTime());
    if (problem) throw new HttpsError('failed-precondition', problem);

    const { job, billing, consumables } = buildQuoteJob(quote, { quoteId, acceptedBy: token.email, now });
    tx.set(jobRef, job);
    const consumablePrices = {};
    for (const item of consumables) {
      const itemRef = jobRef.collection('consumables').doc();
      tx.set(itemRef, { description: item.description, qty: item.qty, createdAt: now });
      consumablePrices[itemRef.id] = item.unitPrice;
    }
    tx.set(db.collection('jobBilling').doc(jobRef.id), { ...billing, consumablePrices });
    tx.update(quoteRef, { status: 'Accepted', acceptedAt: now, jobId: jobRef.id, updatedBy: token.email, updatedAt: now });
  });

  return { jobId: jobRef.id };
});

// Staff hear when a client asks for a new time
exports.notifyAdminsOnRescheduleRequest = onDocumentCreated('rescheduleRequests/{requestId}', async (event) => {
  const request = event.data.data();
  await notifyAdmins(request.jobId, {
    title: 'Client asked to reschedule',
    body: String(request.note || '').slice(0, 120) || 'Open the app for details',
    tag: `reschedule-${event.params.requestId}`,
  });
  return null;
});

// Clients hear the outcome of their reschedule request by email
exports.emailClientOnRescheduleDecision = onDocumentUpdated(
  {
    document: 'rescheduleRequests/{requestId}',
    secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.status !== 'Open' || after.status === 'Open' || !after.clientEmail) return;

    const jobSnap = await getFirestore().collection('jobs').doc(after.jobId).get();
    const job = jobSnap.data() || {};
    const start = job.scheduledFor?.toDate ? job.scheduledFor.toDate() : null;
    const when = start
      ? start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
      : '';
    const approved = after.status === 'Approved';
    try {
      await sendEmailJs(
        emailjsServiceId.value().trim(),
        emailjsTemplateId.value().trim(),
        emailjsPublicKey.value().trim(),
        emailjsPrivateKey.value().trim(),
        {
          to_email:       after.clientEmail,
          to_name:        job.client || 'Valued Customer',
          job_status:     approved ? 'Rescheduled' : 'Reschedule declined',
          job_task:       job.task || '',
          job_location:   job.location || '',
          tech_name:      job.assignedTechName || '',
          status_message: approved
            ? `Your reschedule request was approved. New time: ${when || 'to be confirmed'}.`
            : 'Your reschedule request could not be approved. Please contact us to discuss other times.',
          job_id:         after.jobId,
        },
      );
    } catch (err) {
      console.error(`Reschedule email failed for request ${event.params.requestId}:`, err.message);
    }
  },
);

// Clients pay the full open balance; Stripe Checkout collects the card and the webhook records it
exports.createPaymentCheckout = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const token = request.auth?.token;
  if (token?.role !== 'client' || token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Only verified clients can pay online.');
  }
  const jobId = String(request.data?.jobId || '').trim();
  if (!jobId) throw new HttpsError('invalid-argument', 'Missing job.');
  const snap = await getFirestore().collection('jobs').doc(jobId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Job not found.');
  const job = snap.data();
  if (job.clientEmail !== token.email) throw new HttpsError('permission-denied', 'This job is not yours.');

  const { balance } = await getInvoiceBalance(jobId);
  const balanceCents = Math.round(balance * 100);
  const problem = checkoutProblem({ job, balanceCents });
  if (problem) throw new HttpsError('failed-precondition', problem);

  const db = getFirestore();
  const billingRef = db.collection('jobBilling').doc(jobId);
  const stripe = new Stripe(stripeSecretKey.value());
  const openCheckout = await claimCheckout(billingRef);
  try {
    let previous = null;
    if (openCheckout.sessionId) {
      previous = await stripe.checkout.sessions.retrieve(openCheckout.sessionId);
      const paymentRecorded = (await snap.ref.collection('payments').doc(`stripe_${previous.id}`).get()).exists;
      const action = checkoutAction(previous, {
        amountCents: balanceCents,
        paymentRecorded,
        paymentFailed: openCheckout.paymentFailed === true || (await bankTransferFailed(stripe, previous)),
      });
      if (action === 'reuse') {
        await releaseCheckout(billingRef);
        return { url: previous.url };
      }
      if (action === 'block') {
        throw new HttpsError('failed-precondition', 'A payment for this invoice is already processing. Your balance will update once it posts.');
      }
      if (action === 'expire') await stripe.checkout.sessions.expire(previous.id);
    }

    const session = await stripe.checkout.sessions.create(
      checkoutSessionParams({ jobId, job, amountCents: balanceCents }),
      { idempotencyKey: `checkout-${jobId}-${balanceCents}-${previous?.id || 'none'}-${Math.floor(Date.now() / (10 * 60 * 1000))}` },
    );
    // An idempotent replay can return a session that has already settled; the client should retry in a few minutes
    if (session.status !== 'open') throw new HttpsError('unavailable', 'Please try again in a few minutes.');
    await billingRef.update({ openCheckout: { sessionId: session.id } });
    return { url: session.url };
  } catch (err) {
    await releaseCheckout(billingRef);
    throw err;
  }
});

// Only one request at a time may decide and create a checkout session for an invoice
const CHECKOUT_LOCK_MS = 60 * 1000;

async function claimCheckout(billingRef) {
  return getFirestore().runTransaction(async (tx) => {
    const openCheckout = (await tx.get(billingRef)).data()?.openCheckout || {};
    if (Date.now() - (toMillisValue(openCheckout.lockedAt) ?? 0) < CHECKOUT_LOCK_MS) {
      throw new HttpsError('failed-precondition', 'Your payment is already being prepared. Please try again in a moment.');
    }
    tx.update(billingRef, { 'openCheckout.lockedAt': FieldValue.serverTimestamp() });
    return openCheckout;
  });
}

async function releaseCheckout(billingRef) {
  await billingRef.update({ 'openCheckout.lockedAt': FieldValue.delete() }).catch(() => {});
}

// A bank transfer that failed leaves the session complete and unpaid, and its payment intent needs a new method
async function bankTransferFailed(stripe, session) {
  if (session.status !== 'complete' || session.payment_status !== 'unpaid' || !session.payment_intent) return false;
  const intent = await stripe.paymentIntents.retrieve(session.payment_intent);
  return intent.status === 'requires_payment_method';
}

async function paymentMethodTypeOf(stripe, session) {
  const intent = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['payment_method'] });
  return intent.payment_method?.type || 'card';
}

// Returns true only the first time a session is recorded, so Stripe retries never double-count
async function recordCheckoutPayment(session, paymentMethodType) {
  const jobId = session.metadata?.jobId || session.client_reference_id;
  if (!jobId) return false;
  const db = getFirestore();
  const jobRef = db.collection('jobs').doc(jobId);
  const paymentRef = jobRef.collection('payments').doc(`stripe_${session.id}`);
  return db.runTransaction(async (tx) => {
    const [jobSnap, existing] = await Promise.all([tx.get(jobRef), tx.get(paymentRef)]);
    if (!jobSnap.exists) throw new Error(`Paid job ${jobId} not found`);
    if (existing.exists) return false;
    tx.set(paymentRef, {
      ...paymentFromCheckoutSession(session, paymentMethodType),
      recordedAt: FieldValue.serverTimestamp(),
      recordedBy: 'stripe',
      voided: false,
    });
    return true;
  });
}

exports.stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  const stripe = new Stripe(stripeSecretKey.value());
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.get('stripe-signature'), stripeWebhookSecret.value());
  } catch {
    res.status(400).send('Invalid signature');
    return;
  }
  const session = event.data.object;
  const jobId = session.metadata?.jobId || session.client_reference_id;
  if (event.type === 'checkout.session.async_payment_failed') {
    await getFirestore().collection('jobBilling').doc(jobId).update({ 'openCheckout.paymentFailed': true }).catch((err) => {
      if (err.code !== 5) throw err;
      console.warn('Bank payment failed for a job with no billing record', jobId);
    });
    await notifyAdmins(jobId, {
      title: 'Bank payment failed',
      body: 'A bank transfer for an invoice did not clear.',
      tag: `payment-failed-${session.id}`,
    });
  } else if (
    (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
    session.payment_status === 'paid'
  ) {
    const methodType = await paymentMethodTypeOf(stripe, session);
    if (await recordCheckoutPayment(session, methodType)) {
      const { amount, method } = paymentFromCheckoutSession(session, methodType);
      await notifyAdmins(jobId, {
        title: 'Online payment received',
        body: `$${amount.toFixed(2)} paid by ${method === 'ach' ? 'bank transfer' : 'card'}`,
        tag: `payment-${session.id}`,
      });
    }
  }
  res.json({ received: true });
});

// Mirrors users/{uid}.role into the Auth token so security rules can read it without get() calls
exports.syncRoleClaim = onDocumentWritten('users/{uid}', async (event) => {
  const uid = event.params.uid;
  const role = event.data.after.exists ? event.data.after.data().role || null : null;

  const user = await getAuth().getUser(uid).catch((err) => {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  });
  if (!user || (user.customClaims?.role ?? null) === role) return null;

  const claims = { ...(user.customClaims || {}) };
  if (role) claims.role = role;
  else delete claims.role;
  await getAuth().setCustomUserClaims(uid, claims);
  return null;
});

// ── Website form → Firestore job ──────────────────────────────────────────────
// Called by your business website's contact/service form.
// Replace the cors origin with your website's actual domain for tighter security.
// ── Audit log: job changes and payment events, written server-side and readable by admins only ──
const AUDIT_IGNORED_JOB_FIELDS = ['updatedAt', 'updatedBy', 'photoCounts'];
const AUDIT_DETAIL_FIELDS = ['client', 'task', 'status', 'scheduledFor'];

function auditValue(value) {
  if (value === undefined) return null;
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  return '(object)';
}

function auditDetails(data) {
  return Object.fromEntries(AUDIT_DETAIL_FIELDS.map((field) => [field, auditValue(data[field])]));
}

exports.auditJobWrites = onDocumentWritten('jobs/{jobId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const base = { entityType: 'job', jobId: event.params.jobId, createdAt: FieldValue.serverTimestamp() };

  if (!before && after) {
    await getFirestore().collection('auditLog').add({ ...base, action: 'created', actorEmail: after.updatedBy || null, details: auditDetails(after) });
    return null;
  }
  if (before && !after) {
    // Deletes are preceded by a client stamp of updatedBy, so the last editor is recorded
    await getFirestore().collection('auditLog').add({ ...base, action: 'deleted', actorEmail: before.updatedBy || null, details: auditDetails(before) });
    return null;
  }

  const changes = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (AUDIT_IGNORED_JOB_FIELDS.includes(key)) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changes[key] = { from: auditValue(before[key]), to: auditValue(after[key]) };
  }
  if (Object.keys(changes).length === 0) return null;

  // Client writes always bump updatedAt together with updatedBy; server writes leave both alone
  const clientWrite = auditValue(before.updatedAt) !== auditValue(after.updatedAt);
  await getFirestore().collection('auditLog').add({
    ...base,
    action: 'updated',
    actorEmail: clientWrite ? (after.updatedBy || null) : null,
    changes,
  });
  return null;
});

exports.auditPaymentWrites = onDocumentWritten('jobs/{jobId}/payments/{paymentId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return null;

  const base = { entityType: 'payment', jobId: event.params.jobId, paymentId: event.params.paymentId, createdAt: FieldValue.serverTimestamp() };
  if (!before) {
    await getFirestore().collection('auditLog').add({
      ...base,
      action: 'recorded',
      actorEmail: after.recordedBy || null,
      details: { amount: after.amount, method: after.method, reference: after.reference || '' },
    });
  } else if (!before.voided && after.voided) {
    await getFirestore().collection('auditLog').add({
      ...base,
      action: 'voided',
      actorEmail: after.voidedBy || null,
      details: { amount: after.amount, method: after.method, reason: after.voidReason || '' },
    });
  }
  return null;
});

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

  const snapshot = await getFirestore().collection('jobs').where('serialNumber', '==', serialNumber).get();
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

exports.pruneWebsiteIntakeLimits = onSchedule(
  { schedule: 'every day 03:17', timeZone: 'America/Los_Angeles' },
  async () => {
    const db = getFirestore();
    const cutoff = Date.now() - WEBSITE_INTAKE_WINDOW_MS;
    let snap;
    do {
      snap = await db.collection('websiteIntakeLimits').where('windowStartMs', '<', cutoff).limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    } while (snap.size === 500);
  },
);

exports.createJobFromWebsite = onRequest({ cors: ['https://www.siliconvalleysmarthands.com'] }, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getFirestore();
  if (!(await websiteIntakeAllowed(db, req))) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const body = req.body || {};
  const validationError = validateWebsiteIntake(body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { fullName, companyName, serviceType, email, urgencyLevel, preferredStartDate, scopeOfWork } = body;

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