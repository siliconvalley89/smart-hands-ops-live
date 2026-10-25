import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
} from 'firebase/firestore';

const ADMIN = 'admin@test.dev';
const ASSISTANT = 'assistant@test.dev';
const TECH = 'tech@test.dev';
const SENIOR = 'senior@test.dev';
const CLIENT = 'client@test.dev';
const OTHER_CLIENT = 'other-client@test.dev';

const SEED = [
  ['users/admin-uid', { uid: 'admin-uid', email: ADMIN, role: 'admin' }],
  ['users/tech-uid', { uid: 'tech-uid', email: TECH, role: 'tech' }],
  ['technicians/tech-uid', { uid: 'tech-uid', email: TECH, name: 'Tia', profilePhotoUrl: '' }],
  ['jobs/job-open', {
    client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'Assigned',
    billingMigrated: true, invoiceSent: false, clientSignedOff: false,
  }],
  ['jobs/job-ready', {
    client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'Ready for Signoff',
    billingMigrated: true, invoiceSent: false, clientSignedOff: false,
  }],
  ['jobs/job-done', {
    client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'Completed',
    billingMigrated: true, invoiceSent: true, clientSignedOff: true,
  }],
  ['jobs/job-invoiced', {
    client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'Assigned',
    billingMigrated: true, invoiceSent: true, clientSignedOff: false,
  }],
  ['jobs/job-onsite', {
    client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'On Site',
    billingMigrated: true, invoiceSent: false, clientSignedOff: false,
  }],
  ['jobs/job-open/consumables/c1', { description: 'Cable', qty: 1 }],
  ['jobs/job-done/consumables/c2', { description: 'Clamp', qty: 2 }],
  ['jobs/job-open/photos/ph-seed', { type: 'before', url: 'https://x/seed.jpg', path: 'jobs/job-open/seed.jpg', uploadedAt: new Date(), uploadedBy: TECH }],
  ['jobs/job-done/photos/ph-done', { type: 'after', url: 'https://x/done.jpg', path: 'jobs/job-done/done.jpg', uploadedAt: new Date(), uploadedBy: TECH }],
  ['jobs/job-open/files/fi-seed', { name: 'manual.pdf', url: 'https://x/manual.pdf', size: 1000, type: 'application/pdf', path: 'jobs/job-open/manual.pdf', uploadedAt: new Date(), uploadedBy: TECH }],
  ['parts/part-cable', { name: 'Cable', sku: 'CBL-1', onHand: 10, reorderPoint: 2 }],
  ['jobs/job-open/consumables/c-part', { description: 'Cable', qty: 1, partId: 'part-cable' }],
  ['jobs/job-open/payments/p1', {
    amount: 250, method: 'check', reference: '#101', receivedAt: new Date(), recordedAt: new Date(),
    recordedBy: ADMIN, voided: false,
  }],
  ['jobBilling/job-open', { total: 500 }],
  ['invoiceBilling/invoice_details', { companyName: 'Silicon Valley Smart Hands LLC' }],
  ['systemMetadata/billingMigration', { done: true }],
  ['badges/tech-uid', { role: 'tech' }],
  ['auditLog/seed-1', { entityType: 'job', jobId: 'job-open', action: 'created', actorEmail: ADMIN, createdAt: new Date() }],
];

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-smart-hands-ops',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [path, data] of SEED) {
      await setDoc(doc(db, path), data);
    }
  });
});

const verified = (uid, role, email) => testEnv
  .authenticatedContext(uid, { role, email, email_verified: true }).firestore();
const unverified = (uid, role, email) => testEnv
  .authenticatedContext(uid, { role, email, email_verified: false }).firestore();

const as = {
  admin: () => verified('admin-uid', 'admin', ADMIN),
  assistant: () => verified('assistant-uid', 'adminAssistant', ASSISTANT),
  tech: () => verified('tech-uid', 'tech', TECH),
  unverifiedTech: () => unverified('tech-uid', 'tech', TECH),
  senior: () => verified('senior-uid', 'seniorConsultant', SENIOR),
  client: () => verified('client-uid', 'client', CLIENT),
  unverifiedClient: () => unverified('client-uid', 'client', CLIENT),
  otherClient: () => verified('other-client-uid', 'client', OTHER_CLIENT),
  noRole: () => testEnv.authenticatedContext('nobody-uid', { email: 'nobody@test.dev', email_verified: true }).firestore(),
  anon: () => testEnv.unauthenticatedContext().firestore(),
};

const newPayment = (overrides = {}) => ({
  amount: 100, method: 'card', reference: '', receivedAt: new Date(), recordedAt: new Date(),
  recordedBy: ADMIN, voided: false, ...overrides,
});

const newJob = (overrides = {}) => ({
  client: 'Globex', clientEmail: CLIENT, status: 'Pending', billingMigrated: true,
  invoiceSent: false, createdByRole: 'adminAssistant', updatedBy: ASSISTANT, ...overrides,
});

describe('jobs', () => {
  it('admin reads any job', async () => {
    await assertSucceeds(getDoc(doc(as.admin(), 'jobs/job-done')));
  });

  it('assistant reads open migrated jobs but not completed ones', async () => {
    await assertSucceeds(getDoc(doc(as.assistant(), 'jobs/job-open')));
    await assertFails(getDoc(doc(as.assistant(), 'jobs/job-done')));
  });

  it('verified assigned tech and senior consultant read their job', async () => {
    await assertSucceeds(getDoc(doc(as.tech(), 'jobs/job-open')));
    await assertSucceeds(getDoc(doc(verified('senior-uid', 'seniorConsultant', TECH), 'jobs/job-open')));
  });

  it('unverified or unassigned tech cannot read the job', async () => {
    await assertFails(getDoc(doc(as.unverifiedTech(), 'jobs/job-open')));
    await assertFails(getDoc(doc(verified('other-tech', 'tech', 'other-tech@test.dev'), 'jobs/job-open')));
  });

  it('verified owner client reads own job only', async () => {
    await assertSucceeds(getDoc(doc(as.client(), 'jobs/job-open')));
    await assertFails(getDoc(doc(as.otherClient(), 'jobs/job-open')));
    await assertFails(getDoc(doc(as.unverifiedClient(), 'jobs/job-open')));
  });

  it('no-role, anonymous, and unverified users read nothing', async () => {
    await assertFails(getDoc(doc(as.noRole(), 'jobs/job-open')));
    await assertFails(getDoc(doc(as.anon(), 'jobs/job-open')));
  });

  it('assistant creates a pending job with no embedded billing', async () => {
    await assertSucceeds(setDoc(doc(as.assistant(), 'jobs/new-1'), newJob()));
  });

  it('assistant cannot create a job as completed or with invoiceSent', async () => {
    await assertFails(setDoc(doc(as.assistant(), 'jobs/new-2'), newJob({ status: 'Completed' })));
    await assertFails(setDoc(doc(as.assistant(), 'jobs/new-3'), newJob({ invoiceSent: true })));
  });

  it('client creates a pending request for self without tech fields', async () => {
    await assertSucceeds(setDoc(doc(as.client(), 'jobs/new-client-1'), newJob({ createdByRole: 'client', updatedBy: CLIENT })));
  });

  it('client cannot create a job with a status other than Pending', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-2'), newJob({ createdByRole: 'client', updatedBy: CLIENT, status: 'Assigned' })));
  });

  it('client cannot pick a technician when creating a job', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-3'), newJob({
      createdByRole: 'client', updatedBy: CLIENT, assignedTechEmail: TECH, assignedTechName: 'Tia',
    })));
  });

  it('client cannot create a job for another client or as admin', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-4'), newJob({ createdByRole: 'client', updatedBy: CLIENT, clientEmail: OTHER_CLIENT })));
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-5'), newJob({ createdByRole: 'admin', updatedBy: CLIENT })));
  });

  it('creates must be attributed to the signed-in user', async () => {
    await assertFails(setDoc(doc(as.assistant(), 'jobs/new-4'), newJob({ updatedBy: ADMIN })));
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-6'), newJob({ createdByRole: 'client' })));
  });

  it('assigned tech advances status when attributed to themself', async () => {
    await assertSucceeds(updateDoc(doc(as.tech(), 'jobs/job-open'), { status: 'En Route', updatedBy: TECH, updatedAt: new Date() }));
  });

  it('tech status writes must be attributed to themself', async () => {
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open'), { status: 'En Route', updatedAt: new Date() }));
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open'), { status: 'En Route', updatedBy: ADMIN, updatedAt: new Date() }));
  });

  it('assigned tech cannot change client-only or billing fields', async () => {
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open'), { clientSignedOff: true, updatedBy: TECH }));
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open'), { serviceFee: 1, updatedBy: TECH }));
  });

  it('assistant can reassign a tech on an open job but not close it', async () => {
    await assertSucceeds(updateDoc(doc(as.assistant(), 'jobs/job-open'), {
      assignedTechEmail: SENIOR, assignedTechName: 'Sam', updatedBy: ASSISTANT, updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(as.assistant(), 'jobs/job-open'), { status: 'Completed', updatedBy: ASSISTANT }));
    await assertFails(updateDoc(doc(as.assistant(), 'jobs/job-open'), { assignedTechEmail: SENIOR, updatedBy: ADMIN }));
  });

  it('owner client signs off a ready job only, without completing it', async () => {
    await assertSucceeds(updateDoc(doc(as.client(), 'jobs/job-ready'), { clientSignedOff: true, updatedBy: CLIENT, updatedAt: new Date() }));
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-open'), { clientSignedOff: true, updatedBy: CLIENT, updatedAt: new Date() }));
    await assertFails(updateDoc(doc(as.otherClient(), 'jobs/job-ready'), { clientSignedOff: true, updatedBy: OTHER_CLIENT, updatedAt: new Date() }));
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-ready'), { clientSignedOff: true, updatedBy: ADMIN, updatedAt: new Date() }));
  });

  it('owner client cannot set status to Completed', async () => {
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-ready'), { status: 'Completed', clientSignedOff: true, updatedBy: CLIENT }));
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-ready'), { status: 'Completed', updatedBy: CLIENT }));
  });

  it('only admin deletes jobs', async () => {
    await assertFails(deleteDoc(doc(as.assistant(), 'jobs/job-open')));
    await assertSucceeds(deleteDoc(doc(as.admin(), 'jobs/job-open')));
  });
});

describe('scheduling', () => {
  const start = new Date('2026-11-02T17:00:00Z');
  const end = new Date('2026-11-02T19:00:00Z');

  it('assistant sets a time on an open job', async () => {
    await assertSucceeds(updateDoc(doc(as.assistant(), 'jobs/job-open'), { scheduledFor: start, scheduledEnd: end, updatedBy: ASSISTANT, updatedAt: new Date() }));
  });

  it('assistant reassigns and reschedules an open job in one write', async () => {
    await assertSucceeds(updateDoc(doc(as.assistant(), 'jobs/job-open'), {
      assignedTechName: 'Sam', assignedTechEmail: SENIOR, assignedTechDistanceMiles: null, assignedTechDistanceKm: null,
      status: 'Assigned', statusUpdatedByRole: 'adminAssistant', scheduledFor: start, scheduledEnd: end, updatedBy: ASSISTANT, updatedAt: new Date(),
    }));
  });

  it('assistant cannot set a time on a completed job', async () => {
    await assertFails(updateDoc(doc(as.assistant(), 'jobs/job-done'), { scheduledFor: start, scheduledEnd: end }));
  });

  it('assistant cannot change the time of a job that is already on site', async () => {
    await assertFails(updateDoc(doc(as.assistant(), 'jobs/job-onsite'), { scheduledFor: start, scheduledEnd: end }));
  });

  it('admin sets a time on any job', async () => {
    await assertSucceeds(updateDoc(doc(as.admin(), 'jobs/job-onsite'), { scheduledFor: start, scheduledEnd: end }));
  });
});

describe('consumables', () => {
  it('assigned verified tech adds a consumable on an open job', async () => {
    await assertSucceeds(setDoc(doc(as.tech(), 'jobs/job-open/consumables/c-new'), { description: 'Cable', qty: 2 }));
  });

  it('rejects qty below 1 and extra fields', async () => {
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/consumables/c-bad'), { description: 'Cable', qty: 0 }));
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/consumables/c-bad2'), { description: 'Cable', qty: 1, cost: 5 }));
  });

  it('tech and admin can edit an existing consumable', async () => {
    await assertSucceeds(updateDoc(doc(as.tech(), 'jobs/job-open/consumables/c1'), { description: 'Cable 2', qty: 2, updatedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(as.admin(), 'jobs/job-open/consumables/c1'), { description: 'Cable 3', qty: 3, updatedAt: new Date() }));
  });

  it('tech and admin can edit a consumable that has createdAt', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'jobs/job-open/consumables/c3'), { description: 'Clip', qty: 1, createdAt: new Date() });
    });
    await assertSucceeds(updateDoc(doc(as.tech(), 'jobs/job-open/consumables/c3'), { description: 'Clip', qty: 4, updatedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(as.admin(), 'jobs/job-open/consumables/c3'), { description: 'Clip', qty: 5, updatedAt: new Date() }));
  });

  it('nobody edits consumables once the job is invoiced, admin included', async () => {
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-invoiced/consumables/c-new'), { description: 'Cable', qty: 1 }));
    await assertFails(setDoc(doc(as.admin(), 'jobs/job-invoiced/consumables/c-new'), { description: 'Cable', qty: 1 }));
  });

  it('assistant cannot write consumables', async () => {
    await assertFails(setDoc(doc(as.assistant(), 'jobs/job-open/consumables/c-a'), { description: 'Cable', qty: 1 }));
  });

  it('owner client and assistant read consumables on open jobs', async () => {
    await assertSucceeds(getDoc(doc(as.client(), 'jobs/job-open/consumables/c1')));
    await assertSucceeds(getDoc(doc(as.assistant(), 'jobs/job-open/consumables/c1')));
    await assertFails(getDoc(doc(as.otherClient(), 'jobs/job-open/consumables/c1')));
  });

  it('assistant cannot read consumables on completed jobs', async () => {
    await assertFails(getDoc(doc(as.assistant(), 'jobs/job-done/consumables/c2')));
    await assertSucceeds(getDoc(doc(as.admin(), 'jobs/job-done/consumables/c2')));
  });

  it('collection group read is admin only', async () => {
    await assertSucceeds(getDocs(collectionGroup(as.admin(), 'consumables')));
    await assertFails(getDocs(collectionGroup(as.assistant(), 'consumables')));
  });
});

describe('parts and stock', () => {
  const newPart = (overrides = {}) => ({ name: 'Patch cord', sku: 'PC-6', onHand: 5, reorderPoint: 1, createdAt: new Date(), ...overrides });

  it('admin creates a valid part and rejects a negative count', async () => {
    await assertSucceeds(setDoc(doc(as.admin(), 'parts/part-new'), newPart()));
    await assertFails(setDoc(doc(as.admin(), 'parts/part-bad'), newPart({ onHand: -1 })));
    await assertFails(setDoc(doc(as.admin(), 'parts/part-bad2'), newPart({ cost: 3 })));
  });

  it('assistant and verified tech read parts; clients and unverified techs do not', async () => {
    await assertSucceeds(getDoc(doc(as.assistant(), 'parts/part-cable')));
    await assertSucceeds(getDoc(doc(as.tech(), 'parts/part-cable')));
    await assertFails(getDoc(doc(as.client(), 'parts/part-cable')));
    await assertFails(getDoc(doc(as.unverifiedTech(), 'parts/part-cable')));
  });

  it('only admin changes parts, including the on-hand count', async () => {
    await assertFails(setDoc(doc(as.tech(), 'parts/part-new'), newPart()));
    await assertFails(updateDoc(doc(as.tech(), 'parts/part-cable'), { onHand: 0 }));
    await assertSucceeds(updateDoc(doc(as.admin(), 'parts/part-cable'), { onHand: 8, updatedAt: new Date() }));
  });

  it('a consumable may reference an existing part', async () => {
    await assertSucceeds(setDoc(doc(as.tech(), 'jobs/job-open/consumables/c-new-part'), { description: 'Cable', qty: 2, partId: 'part-cable' }));
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/consumables/c-ghost'), { description: 'Cable', qty: 2, partId: 'part-ghost' }));
  });

  it('a part-linked consumable can still be edited', async () => {
    await assertSucceeds(updateDoc(doc(as.tech(), 'jobs/job-open/consumables/c-part'), { description: 'Cable', qty: 2, updatedAt: new Date() }));
  });

  it('stock events are never readable or writable from the client', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'stockEvents/evt-1'), { createdAt: new Date() });
    });
    await assertFails(getDoc(doc(as.admin(), 'stockEvents/evt-1')));
    await assertFails(setDoc(doc(as.admin(), 'stockEvents/evt-2'), { createdAt: new Date() }));
  });
});

describe('job photos and files', () => {
  const newPhoto = (overrides = {}) => ({
    type: 'before', url: 'https://x/new.jpg', path: 'jobs/job-open/new.jpg', uploadedAt: new Date(), uploadedBy: TECH, ...overrides,
  });
  const newFile = (overrides = {}) => ({
    name: 'spec.pdf', url: 'https://x/spec.pdf', path: 'jobs/job-open/spec.pdf', size: 2048, type: 'application/pdf',
    uploadedAt: new Date(), uploadedBy: ADMIN, ...overrides,
  });

  it('assigned tech adds a photo on an open job', async () => {
    await assertSucceeds(setDoc(doc(as.tech(), 'jobs/job-open/photos/ph-new'), newPhoto()));
  });

  it('tech cannot add photos to another tech job or to an invoiced job', async () => {
    const otherTech = verified('other-tech', 'tech', 'other-tech@test.dev');
    await assertFails(setDoc(doc(otherTech, 'jobs/job-open/photos/ph-x'), newPhoto({ uploadedBy: 'other-tech@test.dev' })));
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-invoiced/photos/ph-y'), newPhoto()));
  });

  it('client and unverified users cannot add photos or files', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/job-open/photos/ph-c'), newPhoto({ uploadedBy: CLIENT })));
    await assertFails(setDoc(doc(as.client(), 'jobs/job-open/files/fi-c'), newFile({ uploadedBy: CLIENT })));
    await assertFails(setDoc(doc(as.unverifiedTech(), 'jobs/job-open/photos/ph-u'), newPhoto()));
  });

  it('rejects unknown photo types and spoofed uploaders', async () => {
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/photos/ph-a'), newPhoto({ type: 'during' })));
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/photos/ph-b'), newPhoto({ uploadedBy: ADMIN })));
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/photos/ph-c'), newPhoto({ extra: true })));
  });

  it('photos and files are never edited after upload', async () => {
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open/photos/ph-seed'), { type: 'after' }));
    await assertFails(updateDoc(doc(as.admin(), 'jobs/job-open/files/fi-seed'), { name: 'renamed.pdf' }));
  });

  it('tech and admin delete photos and files; client cannot', async () => {
    await assertFails(deleteDoc(doc(as.client(), 'jobs/job-open/photos/ph-seed')));
    await assertSucceeds(deleteDoc(doc(as.tech(), 'jobs/job-open/photos/ph-seed')));
    await assertSucceeds(deleteDoc(doc(as.admin(), 'jobs/job-open/files/fi-seed')));
  });

  it('owner client and assistant read photos on open jobs; other clients read none', async () => {
    await assertSucceeds(getDoc(doc(as.client(), 'jobs/job-open/photos/ph-seed')));
    await assertSucceeds(getDoc(doc(as.assistant(), 'jobs/job-open/photos/ph-seed')));
    await assertSucceeds(getDoc(doc(as.client(), 'jobs/job-open/files/fi-seed')));
    await assertFails(getDoc(doc(as.otherClient(), 'jobs/job-open/photos/ph-seed')));
    await assertFails(getDoc(doc(as.unverifiedClient(), 'jobs/job-open/files/fi-seed')));
  });

  it('assistant cannot read photos on completed jobs; admin can', async () => {
    await assertFails(getDoc(doc(as.assistant(), 'jobs/job-done/photos/ph-done')));
    await assertSucceeds(getDoc(doc(as.admin(), 'jobs/job-done/photos/ph-done')));
  });

  it('files over 10 MB are rejected', async () => {
    await assertFails(setDoc(doc(as.admin(), 'jobs/job-open/files/fi-big'), newFile({ size: 11 * 1024 * 1024 })));
  });
});

describe('payments', () => {
  it('admin records a valid payment', async () => {
    await assertSucceeds(setDoc(doc(as.admin(), 'jobs/job-open/payments/p-new'), newPayment()));
  });

  it('rejects invalid payment payloads', async () => {
    const db = as.admin();
    await assertFails(setDoc(doc(db, 'jobs/job-open/payments/p-a'), newPayment({ amount: 0 })));
    await assertFails(setDoc(doc(db, 'jobs/job-open/payments/p-b'), newPayment({ method: 'bitcoin' })));
    await assertFails(setDoc(doc(db, 'jobs/job-open/payments/p-c'), newPayment({ recordedBy: OTHER_CLIENT })));
    await assertFails(setDoc(doc(db, 'jobs/job-open/payments/p-d'), newPayment({ voided: true })));
    await assertFails(setDoc(doc(db, 'jobs/job-open/payments/p-e'), newPayment({ note: 'extra' })));
  });

  it('non-admins cannot record payments', async () => {
    await assertFails(setDoc(doc(as.tech(), 'jobs/job-open/payments/p-t'), newPayment({ recordedBy: TECH })));
    await assertFails(setDoc(doc(as.assistant(), 'jobs/job-open/payments/p-s'), newPayment({ recordedBy: ASSISTANT })));
  });

  it('admin voids a payment but cannot edit or delete it', async () => {
    const ref = doc(as.admin(), 'jobs/job-open/payments/p1');
    await assertSucceeds(updateDoc(ref, { voided: true, voidReason: 'typo', voidedBy: ADMIN, voidedAt: new Date() }));
    await assertFails(updateDoc(doc(as.admin(), 'jobs/job-open/payments/p1'), { amount: 999 }));
    await assertFails(deleteDoc(doc(as.admin(), 'jobs/job-open/payments/p1')));
  });

  it('owner client reads payments; others do not', async () => {
    await assertSucceeds(getDoc(doc(as.client(), 'jobs/job-open/payments/p1')));
    await assertFails(getDoc(doc(as.otherClient(), 'jobs/job-open/payments/p1')));
    await assertFails(getDoc(doc(as.unverifiedClient(), 'jobs/job-open/payments/p1')));
    await assertFails(getDoc(doc(as.assistant(), 'jobs/job-open/payments/p1')));
  });

  it('collection group read is admin only', async () => {
    await assertSucceeds(getDocs(collectionGroup(as.admin(), 'payments')));
    await assertFails(getDocs(collectionGroup(as.assistant(), 'payments')));
  });
});

describe('audit log', () => {
  it('admin reads entries for one job', async () => {
    await assertSucceeds(getDocs(query(collection(as.admin(), 'auditLog'), where('jobId', '==', 'job-open'))));
  });

  it('no one but admin reads the audit log', async () => {
    await assertFails(getDocs(collection(as.assistant(), 'auditLog')));
    await assertFails(getDocs(collection(as.tech(), 'auditLog')));
    await assertFails(getDocs(collection(as.client(), 'auditLog')));
  });

  it('no client can write or delete audit entries, admin included', async () => {
    await assertFails(setDoc(doc(as.admin(), 'auditLog/forged'), { entityType: 'job', jobId: 'job-open', action: 'deleted', actorEmail: TECH }));
    await assertFails(deleteDoc(doc(as.admin(), 'auditLog/seed-1')));
  });
});

describe('billing documents', () => {
  it('jobBilling: admin writes, owner client reads, others read nothing', async () => {
    await assertSucceeds(setDoc(doc(as.admin(), 'jobBilling/job-open'), { total: 600 }));
    await assertSucceeds(getDoc(doc(as.client(), 'jobBilling/job-open')));
    await assertFails(getDoc(doc(as.otherClient(), 'jobBilling/job-open')));
    await assertFails(getDoc(doc(as.tech(), 'jobBilling/job-open')));
    await assertFails(setDoc(doc(as.client(), 'jobBilling/job-open'), { total: 1 }));
  });

  it('invoiceBilling: any client reads company details, only admin writes', async () => {
    await assertSucceeds(getDoc(doc(as.client(), 'invoiceBilling/invoice_details')));
    await assertSucceeds(getDoc(doc(as.admin(), 'invoiceBilling/invoice_details')));
    await assertFails(getDoc(doc(as.anon(), 'invoiceBilling/invoice_details')));
    await assertFails(setDoc(doc(as.client(), 'invoiceBilling/invoice_details'), { companyName: 'x' }));
    await assertSucceeds(setDoc(doc(as.admin(), 'invoiceBilling/invoice_details'), { companyName: 'Silicon Valley Smart Hands LLC' }));
  });

  it('systemMetadata: admin reads, nobody writes', async () => {
    await assertSucceeds(getDoc(doc(as.admin(), 'systemMetadata/billingMigration')));
    await assertFails(getDoc(doc(as.assistant(), 'systemMetadata/billingMigration')));
    await assertFails(setDoc(doc(as.admin(), 'systemMetadata/billingMigration'), { done: false }));
  });
});

describe('users', () => {
  it('admin reads any user; others read only themselves', async () => {
    await assertSucceeds(getDoc(doc(as.admin(), 'users/tech-uid')));
    await assertSucceeds(getDoc(doc(as.tech(), 'users/tech-uid')));
    await assertFails(getDoc(doc(as.tech(), 'users/admin-uid')));
  });

  it('user may update only push tokens and profile fields on their own doc', async () => {
    await assertSucceeds(updateDoc(doc(as.tech(), 'users/tech-uid'), { fcmTokens: ['tok-1'] }));
    await assertFails(updateDoc(doc(as.tech(), 'users/tech-uid'), { role: 'admin' }));
  });

  it('user cannot update another user doc', async () => {
    await assertFails(updateDoc(doc(as.tech(), 'users/admin-uid'), { fcmTokens: ['tok-1'] }));
  });

  it('self-create allows tech or client, never admin', async () => {
    const signedUp = () => testEnv.authenticatedContext('new-uid', { email: 'new@test.dev', email_verified: true }).firestore();
    await assertSucceeds(setDoc(doc(signedUp(), 'users/new-uid'), { uid: 'new-uid', email: 'new@test.dev', role: 'tech' }));
    await assertFails(setDoc(doc(signedUp(), 'users/new-uid'), { uid: 'new-uid', email: 'new@test.dev', role: 'admin' }));
  });
});

describe('technicians and badges', () => {
  it('tech updates own profile photo only', async () => {
    await assertSucceeds(updateDoc(doc(as.tech(), 'technicians/tech-uid'), { profilePhotoUrl: 'https://x/y.jpg' }));
    await assertFails(updateDoc(doc(as.tech(), 'technicians/tech-uid'), { name: 'Hacked' }));
    await assertFails(updateDoc(doc(as.assistant(), 'technicians/tech-uid'), { profilePhotoUrl: 'https://x/y.jpg' }));
  });

  it('badges: tech writes own badge, client cannot, anyone reads', async () => {
    await assertSucceeds(setDoc(doc(as.tech(), 'badges/tech-uid'), { role: 'tech' }));
    await assertFails(setDoc(doc(as.client(), 'badges/client-uid'), { role: 'client' }));
    await assertFails(setDoc(doc(as.tech(), 'badges/other-uid'), { role: 'tech' }));
    await assertSucceeds(getDoc(doc(as.anon(), 'badges/tech-uid')));
  });
});

describe('quotes', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const validQuote = (overrides = {}) => ({
    client: 'Acme', clientEmail: CLIENT, clientPhone: '', location: '1 Main St', task: 'Rack install',
    details: '', lines: [{ description: 'Cable', qty: 1, unitPrice: 10 }], serviceFee: 0, serviceFeeDescription: '',
    status: 'Draft', validUntil: new Date(Date.now() + 30 * DAY_MS), createdAt: new Date(),
    createdBy: ASSISTANT, updatedBy: ASSISTANT, ...overrides,
  });

  const seedQuote = (id, overrides = {}) => testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `quotes/${id}`), validQuote(overrides));
  });

  it('assistant and admin create a draft attributed to themselves', async () => {
    await assertSucceeds(setDoc(doc(as.assistant(), 'quotes/q-new'), validQuote()));
    await assertSucceeds(setDoc(doc(as.admin(), 'quotes/q-new-admin'), validQuote({ createdBy: ADMIN, updatedBy: ADMIN })));
  });

  it('rejects creates that are not drafts, misattributed, or malformed', async () => {
    await assertFails(setDoc(doc(as.assistant(), 'quotes/q-sent'), validQuote({ status: 'Sent' })));
    await assertFails(setDoc(doc(as.assistant(), 'quotes/q-spoof'), validQuote({ createdBy: ADMIN })));
    await assertFails(setDoc(doc(as.assistant(), 'quotes/q-empty'), validQuote({ lines: [] })));
    await assertFails(setDoc(doc(as.assistant(), 'quotes/q-price'), validQuote({ serviceFee: -5 })));
    await assertFails(setDoc(doc(as.assistant(), 'quotes/q-extra'), validQuote({ jobId: 'job-x', status: 'Draft', total: 1 })));
  });

  it('client reads only their own sent or accepted quotes, never drafts', async () => {
    await seedQuote('q-draft');
    await seedQuote('q-sent', { status: 'Sent' });
    await seedQuote('q-accepted', { status: 'Accepted', jobId: 'job-x' });
    await seedQuote('q-withdrawn', { status: 'Withdrawn' });
    await assertFails(getDoc(doc(as.client(), 'quotes/q-draft')));
    await assertFails(getDoc(doc(as.client(), 'quotes/q-withdrawn')));
    await assertSucceeds(getDoc(doc(as.client(), 'quotes/q-sent')));
    await assertSucceeds(getDoc(doc(as.client(), 'quotes/q-accepted')));
    await assertFails(getDoc(doc(as.otherClient(), 'quotes/q-sent')));
    await assertFails(getDoc(doc(as.unverifiedClient(), 'quotes/q-sent')));
  });

  it('staff read every quote; techs and anonymous users read none', async () => {
    await seedQuote('q-draft');
    await assertSucceeds(getDoc(doc(as.admin(), 'quotes/q-draft')));
    await assertSucceeds(getDoc(doc(as.assistant(), 'quotes/q-draft')));
    await assertFails(getDoc(doc(as.tech(), 'quotes/q-draft')));
    await assertFails(getDoc(doc(as.anon(), 'quotes/q-draft')));
  });

  it('clients cannot create, edit, or accept quotes', async () => {
    await seedQuote('q-sent', { status: 'Sent' });
    await assertFails(setDoc(doc(as.client(), 'quotes/q-client'), validQuote({ createdBy: CLIENT, updatedBy: CLIENT })));
    await assertFails(updateDoc(doc(as.client(), 'quotes/q-sent'), { status: 'Accepted' }));
  });

  it('draft is edited freely and sent; sent terms are fixed', async () => {
    await seedQuote('q-draft');
    await assertSucceeds(updateDoc(doc(as.assistant(), 'quotes/q-draft'), {
      lines: [{ description: 'Cable', qty: 3, unitPrice: 10 }], updatedBy: ASSISTANT,
    }));
    await assertSucceeds(updateDoc(doc(as.assistant(), 'quotes/q-draft'), { status: 'Sent', sentAt: new Date(), updatedBy: ASSISTANT }));
    await assertFails(updateDoc(doc(as.assistant(), 'quotes/q-draft'), { lines: [], updatedBy: ASSISTANT }));
    await assertFails(updateDoc(doc(as.admin(), 'quotes/q-draft'), { status: 'Accepted', updatedBy: ADMIN }));
  });

  it('a sent quote can only be withdrawn, not reworded', async () => {
    await seedQuote('q-sent', { status: 'Sent' });
    await assertFails(updateDoc(doc(as.admin(), 'quotes/q-sent'), { lines: [{ description: 'Gold cable', qty: 1, unitPrice: 1 }], updatedBy: ADMIN }));
    await assertSucceeds(updateDoc(doc(as.admin(), 'quotes/q-sent'), { status: 'Withdrawn', updatedBy: ADMIN, updatedAt: new Date() }));
  });

  it('only admin deletes, and never an accepted quote', async () => {
    await seedQuote('q-draft');
    await seedQuote('q-accepted', { status: 'Accepted', jobId: 'job-x' });
    await assertFails(deleteDoc(doc(as.assistant(), 'quotes/q-draft')));
    await assertFails(deleteDoc(doc(as.admin(), 'quotes/q-accepted')));
    await assertSucceeds(deleteDoc(doc(as.admin(), 'quotes/q-draft')));
  });
});

describe('tech breaks', () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const closedBreak = (startAt) => ({ startAt, endAt: new Date(startAt.getTime() + 30 * MIN) });
  const setBreaks = (breaks, checkInAt = new Date()) => testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'jobs/job-onsite'), {
      client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'On Site',
      billingMigrated: true, invoiceSent: false, clientSignedOff: false, checkInAt, breaks,
    });
  });
  const techUpdate = (fields) => updateDoc(doc(as.tech(), 'jobs/job-onsite'), {
    status: 'On Site', updatedBy: TECH, updatedAt: new Date(), ...fields,
  });

  it('tech can start a break', async () => {
    await setBreaks([]);
    await assertSucceeds(techUpdate({ breaks: [{ startAt: new Date() }] }));
  });

  it('tech cannot clock back in less than 30 minutes after clocking out', async () => {
    await setBreaks([{ startAt: new Date(Date.now() - 5 * MIN) }]);
    await assertFails(techUpdate({ breaks: [{ startAt: new Date(Date.now() - 5 * MIN), endAt: new Date() }] }));
  });

  it('tech can clock back in once 30 minutes have passed', async () => {
    await setBreaks([{ startAt: new Date(Date.now() - 31 * MIN) }]);
    await assertSucceeds(techUpdate({ breaks: [{ startAt: new Date(Date.now() - 31 * MIN), endAt: new Date() }] }));
  });

  it('a status update during an open break is still allowed', async () => {
    await setBreaks([{ startAt: new Date(Date.now() - 5 * MIN) }]);
    await assertSucceeds(techUpdate({}));
  });

  it('tech cannot take a second break before 12 hours on site', async () => {
    const first = closedBreak(new Date(Date.now() - 2 * HOUR));
    await setBreaks([first], new Date(Date.now() - 3 * HOUR));
    await assertFails(techUpdate({ breaks: [first, { startAt: new Date() }] }));
  });

  it('tech can take a second break after 12 hours on site', async () => {
    const first = closedBreak(new Date(Date.now() - 6 * HOUR));
    await setBreaks([first], new Date(Date.now() - (12 * HOUR + MIN)));
    await assertSucceeds(techUpdate({ breaks: [first, { startAt: new Date() }] }));
  });

  it('tech cannot take a third break', async () => {
    const first = closedBreak(new Date(Date.now() - 14 * HOUR));
    const second = closedBreak(new Date(Date.now() - 1 * HOUR));
    await setBreaks([first, second], new Date(Date.now() - 15 * HOUR));
    await assertFails(techUpdate({ breaks: [first, second, { startAt: new Date() }] }));
  });
});
