import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

export default function useParts(enabled) {
  const [parts, setParts] = useState([]);

  useEffect(() => {
    if (!enabled) return () => {};
    const q = query(collection(db, 'parts'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => setParts(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))),
      (error) => console.error('Unable to load parts', error),
    );
    return () => {
      unsubscribe();
      setParts([]);
    };
  }, [enabled]);

  return parts;
}
