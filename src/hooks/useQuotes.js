import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export default function useQuotes({ staff = false, clientEmail = '' }) {
  const [quotes, setQuotes] = useState([]);

  useEffect(() => {
    if (!staff && !clientEmail) return () => {};
    const quotesRef = collection(db, 'quotes');
    const q = staff
      ? query(quotesRef, orderBy('createdAt', 'desc'))
      : query(quotesRef, where('clientEmail', '==', clientEmail), where('status', 'in', ['Sent', 'Accepted']));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => setQuotes(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))),
      (error) => console.error('Unable to load quotes', error),
    );
    return () => {
      unsubscribe();
      setQuotes([]);
    };
  }, [staff, clientEmail]);

  return quotes;
}
