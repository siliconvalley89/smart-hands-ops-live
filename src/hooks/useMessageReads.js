import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { toMillis } from '../lib/jobTime';

export default function useMessageReads(uid) {
  const [state, setState] = useState({ readAtByJob: {}, loaded: false });

  useEffect(() => {
    if (!uid) return () => {};
    return onSnapshot(
      collection(db, 'users', uid, 'messageReads'),
      (snapshot) => {
        const readAtByJob = Object.fromEntries(
          snapshot.docs.map((item) => [item.id, toMillis(item.data({ serverTimestamps: 'estimate' }).readAt)])
        );
        setState({ readAtByJob, loaded: true });
      },
      (error) => {
        console.error('Unable to load message read markers', error);
        setState({ readAtByJob: {}, loaded: true });
      },
    );
  }, [uid]);

  return state;
}
