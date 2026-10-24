import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

export default function useUsers(profile) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (profile?.role !== 'admin') return () => {};
    const q = query(collection(db, 'users'), orderBy('displayName', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setUsers(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
      },
      (error) => console.error('Unable to load users', error),
    );
    return () => {
      unsubscribe();
      setUsers([]);
    };
  }, [profile?.role]);

  return users;
}
