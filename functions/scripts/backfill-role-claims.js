const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'smart-hands-live',
});

(async () => {
  const snap = await admin.firestore().collection('users').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const role = doc.data().role;
    const user = await admin.auth().getUser(doc.id).catch(() => null);
    if (!role || !user || user.customClaims?.role === role) {
      skipped += 1;
      continue;
    }
    await admin.auth().setCustomUserClaims(doc.id, { ...(user.customClaims || {}), role });
    updated += 1;
  }

  console.log(`Role claims set for ${updated} user(s); ${skipped} skipped out of ${snap.size}.`);
})();
