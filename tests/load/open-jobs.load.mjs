import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';

const SIZES = (process.env.LOAD_SIZES || '100,500,1000').split(',').map(Number);
const STATUSES = ['Pending', 'Assigned', 'On Site', 'Ready for Signoff'];
const TECHS = Array.from({ length: 5 }, (_, i) => `tech${i}@test.dev`);

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-smart-hands-ops',
  firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
});

const admin = testEnv.authenticatedContext('admin-uid', { role: 'admin', email: 'admin@test.dev', email_verified: true }).firestore();

async function seed(count) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    let batch = writeBatch(db);
    let ops = 0;
    const commit = async () => { await batch.commit(); batch = writeBatch(db); ops = 0; };
    for (let i = 0; i < count; i += 1) {
      const id = `load-${i}`;
      batch.set(doc(db, 'jobs', id), {
        client: `Client ${i % 50}`, clientEmail: `client${i % 50}@test.dev`,
        assignedTechEmail: TECHS[i % TECHS.length], status: STATUSES[i % STATUSES.length],
        billingMigrated: true, invoiceSent: false, clientSignedOff: false,
        createdAt: new Date(Date.now() - i * 60000),
      });
      batch.set(doc(db, 'jobs', id, 'consumables', 'c1'), { description: 'Part', qty: 1, unitPrice: 10 });
      batch.set(doc(db, 'jobBilling', id), { serviceFee: 75, consumablePrices: {} });
      ops += 3;
      if (ops >= 450) await commit();
    }
    if (ops > 0) await commit();
  });
}

async function measure() {
  const t0 = performance.now();
  const openSnap = await getDocs(query(collection(admin, 'jobs'), where('status', '!=', 'Completed')));
  const jobsMs = performance.now() - t0;

  const ids = openSnap.docs.map((d) => d.id);
  const t1 = performance.now();
  let subDocs = 0;
  let subQueries = 0;
  await Promise.all(ids.flatMap((id) => [
    getDocs(collection(admin, 'jobs', id, 'consumables')).then((s) => { subDocs += s.size; subQueries += 1; }),
    getDoc(doc(admin, 'jobBilling', id)).then((s) => { subDocs += s.exists() ? 1 : 0; subQueries += 1; }),
    getDocs(collection(admin, 'jobs', id, 'payments')).then((s) => { subDocs += s.size; subQueries += 1; }),
  ]));
  const subMs = performance.now() - t1;

  return { openJobs: openSnap.size, jobsMs, subQueries, subDocs, subMs };
}

const rows = [];
for (const size of SIZES) {
  await seed(size);
  const r = await measure();
  rows.push({
    seeded: size,
    openJobs: r.openJobs,
    openQueryMs: Math.round(r.jobsMs),
    perJobQueries: r.subQueries,
    perJobDocsRead: r.subDocs,
    perJobMs: Math.round(r.subMs),
  });
}

console.table(rows);
await testEnv.cleanup();
