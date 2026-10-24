import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes, deleteObject } from 'firebase/storage';

const ADMIN = 'admin@test.dev';
const ASSISTANT = 'assistant@test.dev';
const TECH = 'tech@test.dev';
const OTHER_TECH = 'other-tech@test.dev';
const CLIENT = 'client@test.dev';
const OTHER_CLIENT = 'other-client@test.dev';

const JOB_FIELDS = { client: 'Acme', clientEmail: CLIENT, assignedTechEmail: TECH, status: 'Assigned', billingMigrated: true, invoiceSent: false };
const JOBS = {
  'job-open': JOB_FIELDS,
  'job-invoiced': { ...JOB_FIELDS, invoiceSent: true },
  'job-done': { ...JOB_FIELDS, status: 'Completed', invoiceSent: true },
  'job-legacy': { ...JOB_FIELDS, billingMigrated: false },
};

const FILE_PATHS = ['jobs/job-open/seed.jpg', 'jobs/job-done/seed.jpg', 'jobs/job-legacy/seed.jpg'];
const bytes = (size = 16) => new Uint8Array(size);

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    // Must match the emulators:exec --project; storage rules' firestore.get resolves against it
    projectId: 'demo-smart-hands-ops',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: readFileSync('storage.rules', 'utf8'),
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, data] of Object.entries(JOBS)) {
      await setDoc(doc(db, 'jobs', id), data);
    }
    for (const path of FILE_PATHS) {
      await uploadBytes(ref(ctx.storage(), path), bytes());
    }
  });
});

const staff = (role, email, verified = true) => testEnv.authenticatedContext(`${role}-uid`, {
  role, email, email_verified: verified,
});

describe('job media uploads', () => {
  it('admin can upload to any job', async () => {
    const storage = staff('admin', ADMIN).storage();
    await assertSucceeds(uploadBytes(ref(storage, 'jobs/job-invoiced/before-1.jpg'), bytes()));
  });

  it('assigned verified tech can upload to an open job', async () => {
    const storage = staff('tech', TECH).storage();
    await assertSucceeds(uploadBytes(ref(storage, 'jobs/job-open/before-1.jpg'), bytes()));
  });

  it('assigned tech cannot upload after the job is invoiced', async () => {
    const storage = staff('tech', TECH).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-invoiced/before-1.jpg'), bytes()));
  });

  it('assigned tech cannot upload to a job that has not been migrated to billing', async () => {
    const storage = staff('tech', TECH).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-legacy/before-1.jpg'), bytes()));
  });

  it('unassigned tech cannot upload', async () => {
    const storage = staff('tech', OTHER_TECH).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-open/before-1.jpg'), bytes()));
  });

  it('unverified assigned tech cannot upload', async () => {
    const storage = staff('tech', TECH, false).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-open/before-1.jpg'), bytes()));
  });

  it('admin assistant cannot upload', async () => {
    const storage = staff('adminAssistant', ASSISTANT).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-open/before-1.jpg'), bytes()));
  });

  it('client cannot upload to their own job', async () => {
    const storage = staff('client', CLIENT).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-open/before-1.jpg'), bytes()));
  });

  it('rejects files of 10 MB or more', async () => {
    const storage = staff('admin', ADMIN).storage();
    await assertFails(uploadBytes(ref(storage, 'jobs/job-open/big.bin'), bytes(10 * 1024 * 1024)));
  });

  it('assigned tech cannot delete media after invoicing', async () => {
    const storage = staff('tech', TECH).storage();
    await assertFails(deleteObject(ref(storage, 'jobs/job-done/seed.jpg')));
  });

  it('assigned tech can delete media on an open job', async () => {
    const storage = staff('tech', TECH).storage();
    await assertSucceeds(deleteObject(ref(storage, 'jobs/job-open/seed.jpg')));
  });
});

describe('job media reads', () => {
  it('admin can read any job file', async () => {
    const storage = staff('admin', ADMIN).storage();
    await assertSucceeds(getBytes(ref(storage, 'jobs/job-done/seed.jpg')));
  });

  it('assigned client can read their own job file', async () => {
    const storage = staff('client', CLIENT).storage();
    await assertSucceeds(getBytes(ref(storage, 'jobs/job-open/seed.jpg')));
  });

  it('other client cannot read the job file', async () => {
    const storage = staff('client', OTHER_CLIENT).storage();
    await assertFails(getBytes(ref(storage, 'jobs/job-open/seed.jpg')));
  });

  it('unauthenticated user cannot read job files', async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(storage, 'jobs/job-open/seed.jpg')));
  });

  it('assigned tech can read a migrated job file', async () => {
    const storage = staff('tech', TECH).storage();
    await assertSucceeds(getBytes(ref(storage, 'jobs/job-open/seed.jpg')));
  });

  it('assigned tech cannot read a job that has not been migrated', async () => {
    const storage = staff('tech', TECH).storage();
    await assertFails(getBytes(ref(storage, 'jobs/job-legacy/seed.jpg')));
  });

  it('admin assistant can read an open job file but not a completed one', async () => {
    const storage = staff('adminAssistant', ASSISTANT).storage();
    await assertSucceeds(getBytes(ref(storage, 'jobs/job-open/seed.jpg')));
    await assertFails(getBytes(ref(storage, 'jobs/job-done/seed.jpg')));
  });
});
