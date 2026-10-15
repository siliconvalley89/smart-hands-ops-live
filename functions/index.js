const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
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

  const usersSnapshot = await admin
    .firestore()
    .collection('users')
    .where('email', '==', job.assignedTechEmail)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.log(`User doc not found for tech email: ${job.assignedTechEmail}`);
    return;
  }

  const tech = usersSnapshot.docs[0].data();
  const fcmToken = tech.fcmToken;

  if (!fcmToken) {
    console.log(`No FCM token stored for tech: ${job.assignedTechEmail}`);
    return;
  }

  const title = `Dispatch: ${job.task || 'New Job'}`;
  const bodyParts = [job.location || 'See app for site location'];
  if (job.serialNumber) bodyParts.push(`S/N: ${job.serialNumber}`);
  const body = bodyParts.join('  |  ');

  const message = {
    token: fcmToken,
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
    const result = await admin.messaging().send(message);
    console.log('FCM dispatch notification sent:', result);
  } catch (err) {
    console.error('FCM send failed:', err.code, err.message);
  }
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
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:   serviceId,
        template_id:  templateId,
        user_id:      publicKey,
        accessToken:  privateKey,
        template_params: {
          to_email:       job.clientEmail,
          to_name:        job.client || 'Valued Customer',
          job_status:     newStatus,
          job_task:       job.task || '',
          job_location:   job.location || '',
          tech_name:      job.assignedTechName || '',
          status_message: statusMessage,
          job_id:         jobId,
        },
      }),
    });
    if (!response.ok) {
      console.error('EmailJS error:', response.status, await response.text());
    } else {
      console.log(`Status email sent to ${job.clientEmail} — status: ${newStatus}`);
    }
  } catch (err) {
    console.error('EmailJS fetch failed:', err.message);
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

exports.migrateJobBilling = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in as an admin to migrate job billing data.');
  }

  const db = admin.firestore();
  const userSnapshot = await db.collection('users').doc(request.auth.uid).get();
  if (!userSnapshot.exists || userSnapshot.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can migrate job billing data.');
  }

  const cursor = request.data?.cursor ?? null;
  if (cursor != null && typeof cursor !== 'string') {
    throw new HttpsError('invalid-argument', 'The migration cursor must be a job ID.');
  }
  let migrated = 0;
  const pageSize = 20;
  let jobsQuery = db.collection('jobs')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(pageSize);
  if (cursor) jobsQuery = jobsQuery.startAfter(cursor);
  const snapshot = await jobsQuery.get();

  for (const jobDocument of snapshot.docs) {
      const jobRef = jobDocument.ref;
      const billingRef = db.collection('jobBilling').doc(jobDocument.id);
      const wasMigrated = await db.runTransaction(async (transaction) => {
        const liveJobSnapshot = await transaction.get(jobRef);
        if (!liveJobSnapshot.exists) return false;
        const job = liveJobSnapshot.data();
        const legacyItems = Array.isArray(job.consumables) ? job.consumables : [];
        const hasLegacyBilling = Object.prototype.hasOwnProperty.call(job, 'serviceFee')
          || Object.prototype.hasOwnProperty.call(job, 'serviceFeeDescription')
          || Object.prototype.hasOwnProperty.call(job, 'consumables');
        if (job.billingMigrated === true && !hasLegacyBilling) return false;
        if (legacyItems.length > 450) {
          throw new HttpsError('failed-precondition', `Job ${jobDocument.id} has too many consumable lines to migrate safely.`);
        }

        const billingSnapshot = await transaction.get(billingRef);
        const existingBilling = billingSnapshot.exists ? billingSnapshot.data() : {};
        const consumablePrices = { ...(existingBilling.consumablePrices || {}) };
        const itemsToWrite = legacyItems.map((item, index) => {
          const itemId = `legacy-${index}`;
          const qty = Number(item.qty ?? 1);
          const unitPrice = Number(consumablePrices[itemId] ?? item.unitPrice ?? 0);
          if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new HttpsError('failed-precondition', `Job ${jobDocument.id} has invalid consumable quantities or prices.`);
          }
          if (consumablePrices[itemId] == null) consumablePrices[itemId] = unitPrice;
          return {
            ref: jobRef.collection('consumables').doc(itemId),
            data: {
              description: String(item.description || ''),
              qty,
              createdAt: item.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            },
          };
        });

        const serviceFee = Number(existingBilling.serviceFee ?? job.serviceFee ?? 0);
        if (!Number.isFinite(serviceFee) || serviceFee < 0) {
          throw new HttpsError('failed-precondition', `Job ${jobDocument.id} has an invalid service fee.`);
        }
        itemsToWrite.forEach(({ ref, data }) => transaction.set(ref, data));
        transaction.set(billingRef, {
          serviceFee,
          serviceFeeDescription: existingBilling.serviceFeeDescription ?? job.serviceFeeDescription ?? '',
          consumablePrices,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.update(jobRef, {
          consumables: admin.firestore.FieldValue.delete(),
          serviceFee: admin.firestore.FieldValue.delete(),
          serviceFeeDescription: admin.firestore.FieldValue.delete(),
          billingMigrated: true,
        });
        return true;
      });
    if (wasMigrated) migrated += 1;
  }

  const nextCursor = snapshot.size === pageSize ? snapshot.docs[snapshot.docs.length - 1].id : null;
  if (!nextCursor) {
    await db.collection('systemMetadata').doc('billingMigration').set({
      completed: true,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    migrated,
    nextCursor,
  };
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