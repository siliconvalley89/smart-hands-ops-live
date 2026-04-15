const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
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
    'Dispatched':        `${job.assignedTechName || 'A technician'} has been assigned to your request.`,
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
// Fires on job creation — marks the assigned technician as busy using Admin SDK
exports.manageTechStatusOnJobCreated = onDocumentCreated('jobs/{jobId}', async (event) => {
  const job = event.data.data();
  if (!job.assignedTechEmail) return null;
  const db = admin.firestore();
  const snap = await db.collection('technicians').where('email', '==', job.assignedTechEmail).limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.update({ status: 'busy', lastAssignedAt: new Date() });
  }
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
  const db = admin.firestore();

  const getTechDoc = async (email) => {
    if (!email) return null;
    const snap = await db.collection('technicians').where('email', '==', email).limit(1).get();
    return snap.empty ? null : snap.docs[0];
  };

  // Technician reassigned to a different person
  if (before.assignedTechEmail !== after.assignedTechEmail) {
    if (before.assignedTechEmail) {
      const oldDoc = await getTechDoc(before.assignedTechEmail);
      if (oldDoc) await oldDoc.ref.update({ status: 'available' });
    }
    if (after.assignedTechEmail) {
      const newDoc = await getTechDoc(after.assignedTechEmail);
      if (newDoc) await newDoc.ref.update({ status: 'busy', lastAssignedAt: new Date() });
    }
  }

  // Job completed — free up the technician
  if (before.status !== 'Completed' && after.status === 'Completed' && after.assignedTechEmail) {
    const techDoc = await getTechDoc(after.assignedTechEmail);
    if (techDoc) await techDoc.ref.update({ status: 'available' });
  }

  // Email client on meaningful status transitions
  const notifyStatuses = ['Dispatched', 'On Site', 'Ready for Signoff', 'Completed'];
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
    consumables:       [],
    serviceFee:        0,
    serviceFeeDescription: '',
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