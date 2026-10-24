import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const millis = (value) => {
  if (!value) return 0;
  if (value?.toMillis) return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const byUpload = (a, b) => millis(a.uploadedAt) - millis(b.uploadedAt) || a.id.localeCompare(b.id);

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

  return useMemo(() => ({
    photos: {
      before: photoDocs.filter((p) => p.type === 'before').sort(byUpload),
      after: photoDocs.filter((p) => p.type === 'after').sort(byUpload),
    },
    files: [...fileDocs].sort(byUpload),
  }), [photoDocs, fileDocs]);
}
