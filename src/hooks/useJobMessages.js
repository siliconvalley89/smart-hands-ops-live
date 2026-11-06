import { addDoc, collection, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { cleanMessageText } from '../lib/messages';

export default function useJobMessages(jobId, profile, enabled) {
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!enabled) return () => {};
    const messagesQuery = query(collection(db, 'jobs', jobId, 'messages'), orderBy('createdAt', 'asc'), limitToLast(100));
    return onSnapshot(
      messagesQuery,
      (snapshot) => {
        setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoadError('');
      },
      (error) => {
        console.error('Unable to load job messages', error);
        setMessages([]);
        setLoadError('Unable to load messages for this job.');
      },
    );
  }, [enabled, jobId]);

  const markRead = useCallback(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return Promise.resolve();
    return setDoc(doc(db, 'users', uid, 'messageReads', jobId), { readAt: serverTimestamp() });
  }, [jobId]);

  const send = useCallback(async (rawText) => {
    const text = cleanMessageText(rawText);
    if (!text) return false;
    const user = auth.currentUser;
    await addDoc(collection(db, 'jobs', jobId, 'messages'), {
      text,
      authorEmail: user.email,
      authorName: profile?.displayName || user.email,
      authorRole: profile.role,
      createdAt: serverTimestamp(),
    });
    return true;
  }, [jobId, profile]);

  return { messages, loadError, send, markRead };
}
