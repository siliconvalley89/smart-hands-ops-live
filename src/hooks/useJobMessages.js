import { addDoc, collection, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { cleanMessageText } from '../lib/messages';

const CHANNELS = {
  team: { messages: 'messages', reads: 'messageReads' },
  client: { messages: 'clientMessages', reads: 'clientMessageReads' },
};

export default function useJobMessages(jobId, profile, enabled, channel = 'team') {
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState('');
  const { messages: messagesCollection, reads: readsCollection } = CHANNELS[channel];

  useEffect(() => {
    if (!enabled) return () => {};
    const messagesQuery = query(collection(db, 'jobs', jobId, messagesCollection), orderBy('createdAt', 'asc'), limitToLast(100));
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
  }, [enabled, jobId, messagesCollection]);

  const markRead = useCallback(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return Promise.resolve();
    return setDoc(doc(db, 'users', uid, readsCollection, jobId), { readAt: serverTimestamp() });
  }, [jobId, readsCollection]);

  const send = useCallback(async (rawText) => {
    const text = cleanMessageText(rawText);
    if (!text) return false;
    const user = auth.currentUser;
    await addDoc(collection(db, 'jobs', jobId, messagesCollection), {
      text,
      authorEmail: user.email,
      authorName: profile?.displayName || user.email,
      authorRole: profile.role,
      createdAt: serverTimestamp(),
    });
    return true;
  }, [jobId, messagesCollection, profile]);

  return { messages, loadError, send, markRead };
}
