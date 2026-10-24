import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getLegacyPhotoUrls } from '../lib/jobDisplay';

const millis = (value) => {
  if (!value) return 0;
  if (value?.toMillis) return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const byUpload = (a, b) => millis(a.uploadedAt) - millis(b.uploadedAt) || a.id.localeCompare(b.id);

// Subscribes to a job's photo and file subcollections; legacy array entries are merged in until migrated
export default function useJobPhotos(job) {
  const jobId = job.id;
  const [photoDocs, setPhotoDocs] = useState([]);
  const [fileDocs, setFileDocs] = useState([]);

  useEffect(() => {
    const toItems = (snapshot) => snapshot.docs.map((itemDoc) => ({ ...itemDoc.data(), id: itemDoc.id }));
    const onError = (label) => (error) => console.error(`Unable to load ${label} for job ${jobId}`, error);
    const unsubscribePhotos = onSnapshot(collection(db, 'jobs', jobId, 'photos'), (snapshot) => setPhotoDocs(toItems(snapshot)), onError('photos'));
    const unsubscribeFiles = onSnapshot(collection(db, 'jobs', jobId, 'files'), (snapshot) => setFileDocs(toItems(snapshot)), onError('files'));
    return () => {
      unsubscribePhotos();
      unsubscribeFiles();
    };
  }, [jobId]);

  return useMemo(() => {
    const photos = { before: [], after: [] };
    for (const type of ['before', 'after']) {
      const migrated = photoDocs.filter((p) => p.type === type).map((p) => ({ ...p, legacy: false }));
      const migratedUrls = new Set(migrated.map((p) => p.url));
      const legacy = getLegacyPhotoUrls(job, type)
        .filter((url) => !migratedUrls.has(url))
        .map((url, index) => ({ id: `legacy-${type}-${index}`, type, url, uploadedAt: null, legacy: true }));
      photos[type] = [...legacy, ...migrated].sort(byUpload);
    }

    const legacyFiles = (Array.isArray(job.attachments) ? job.attachments : [])
      .map((file, index) => ({ ...file, id: `legacy-file-${index}`, legacy: true }));
    const fileUrls = new Set(fileDocs.map((f) => f.url));
    const files = [
      ...legacyFiles.filter((file) => !fileUrls.has(file.url)),
      ...fileDocs.map((f) => ({ ...f, legacy: false })),
    ].sort(byUpload);

    return { photos, files };
  }, [photoDocs, fileDocs, job]);
}
