import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { toMillis } from '../lib/jobTime';

const readAtMap = (snapshot) => Object.fromEntries(
  snapshot.docs.map((item) => [item.id, toMillis(item.data({ serverTimestamps: 'estimate' }).readAt)])
);

export default function useMessageReads(uid) {
  const [state, setState] = useState({ readAtByJob: {}, clientReadAtByJob: {}, teamLoaded: false, clientLoaded: false });

  useEffect(() => {
    if (!uid) return () => {};
    const onError = (label) => (error) => {
      console.error(`Unable to load ${label} read markers`, error);
    };
    const unsubscribeTeam = onSnapshot(
      collection(db, 'users', uid, 'messageReads'),
      (snapshot) => setState((prev) => ({ ...prev, readAtByJob: readAtMap(snapshot), teamLoaded: true })),
      (error) => {
        onError('team')(error);
        setState((prev) => ({ ...prev, teamLoaded: true }));
      },
    );
    const unsubscribeClient = onSnapshot(
      collection(db, 'users', uid, 'clientMessageReads'),
      (snapshot) => setState((prev) => ({ ...prev, clientReadAtByJob: readAtMap(snapshot), clientLoaded: true })),
      (error) => {
        onError('client')(error);
        setState((prev) => ({ ...prev, clientLoaded: true }));
      },
    );
    return () => {
      unsubscribeTeam();
      unsubscribeClient();
    };
  }, [uid]);

  return { ...state, loaded: state.teamLoaded && state.clientLoaded };
}
