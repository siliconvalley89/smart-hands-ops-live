import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

export default function useTechs(enabled) {
  const [techs, setTechs] = useState([]);

  useEffect(() => {
    if (!enabled) return () => {};
    const q = query(collection(db, 'technicians'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setTechs(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
      },
      (error) => console.error('Unable to load technicians', error),
    );
    return () => {
      unsubscribe();
      setTechs([]);
    };
  }, [enabled]);

  return techs;
}
