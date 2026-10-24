import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
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
  ['jobs/job-open/payments/p1', {
    amount: 250, method: 'check', reference: '#101', receivedAt: new Date(), recordedAt: new Date(),
    recordedBy: ADMIN, voided: false,
  }],
  ['jobBilling/job-open', { total: 500 }],
  ['invoiceBilling/invoice_details', { companyName: 'Silicon Valley Smart Hands LLC' }],
  ['systemMetadata/billingMigration', { done: true }],
  ['badges/tech-uid', { role: 'tech' }],
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
  invoiceSent: false, createdByRole: 'adminAssistant', ...overrides,
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
    await assertSucceeds(setDoc(doc(as.client(), 'jobs/new-client-1'), newJob({ createdByRole: 'client' })));
  });

  it('client cannot create a job with a status other than Pending', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-2'), newJob({ createdByRole: 'client', status: 'Assigned' })));
  });

  it('client cannot pick a technician when creating a job', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-3'), newJob({
      createdByRole: 'client', assignedTechEmail: TECH, assignedTechName: 'Tia',
    })));
  });

  it('client cannot create a job for another client or as admin', async () => {
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-4'), newJob({ createdByRole: 'client', clientEmail: OTHER_CLIENT })));
    await assertFails(setDoc(doc(as.client(), 'jobs/new-client-5'), newJob({ createdByRole: 'admin' })));
  });

  it('assigned tech advances status', async () => {
    await assertSucceeds(updateDoc(doc(as.tech(), 'jobs/job-open'), { status: 'En Route' }));
  });

  it('assigned tech cannot change client-only or billing fields', async () => {
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open'), { clientSignedOff: true }));
    await assertFails(updateDoc(doc(as.tech(), 'jobs/job-open'), { serviceFee: 1 }));
  });

  it('assistant can reassign a tech on an open job but not close it', async () => {
    await assertSucceeds(updateDoc(doc(as.assistant(), 'jobs/job-open'), {
      assignedTechEmail: SENIOR, assignedTechName: 'Sam',
    }));
    await assertFails(updateDoc(doc(as.assistant(), 'jobs/job-open'), { status: 'Completed' }));
  });

  it('owner client signs off a ready job only, without completing it', async () => {
    await assertSucceeds(updateDoc(doc(as.client(), 'jobs/job-ready'), { clientSignedOff: true }));
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-open'), { clientSignedOff: true }));
    await assertFails(updateDoc(doc(as.otherClient(), 'jobs/job-ready'), { clientSignedOff: true }));
  });

  it('owner client cannot set status to Completed', async () => {
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-ready'), { status: 'Completed', clientSignedOff: true }));
    await assertFails(updateDoc(doc(as.client(), 'jobs/job-ready'), { status: 'Completed' }));
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
    await assertSucceeds(updateDoc(doc(as.assistant(), 'jobs/job-open'), { scheduledFor: start, scheduledEnd: end, updatedAt: new Date() }));
  });

  it('assistant reassigns and reschedules an open job in one write', async () => {
    await assertSucceeds(updateDoc(doc(as.assistant(), 'jobs/job-open'), {
      assignedTechName: 'Sam', assignedTechEmail: SENIOR, assignedTechDistanceMiles: null, assignedTechDistanceKm: null,
      status: 'Assigned', statusUpdatedByRole: 'adminAssistant', scheduledFor: start, scheduledEnd: end, updatedAt: new Date(),
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
