import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, arrayUnion, deleteField } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { getToken } from 'firebase/messaging';
import { db, auth, messaging, VAPID_KEY } from '../firebase';
import { isFieldRole } from '../lib/roles';

export default function useAuthProfile(setAppError) {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [adminSetupAllowed, setAdminSetupAllowed] = useState(false);
  const suppressAuthStateRef = useRef(false);

  useEffect(() => {
    const authUnsub = onAuthStateChanged(auth, async (user) => {
      if (suppressAuthStateRef.current) return;
      try {
        if (user) setAuthReady(false);
        setFirebaseUser(user);
        if (user) {
          const userRef = doc(db, 'users', user.uid);
          const userSnapshot = await getDoc(userRef);
          if (userSnapshot.exists()) {
            setProfile({ id: userSnapshot.id, ...userSnapshot.data() });
          } else {
            const usersQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
            const querySnapshot = await getDocs(usersQuery);
            if (!querySnapshot.empty) {
              setProfile({ id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() });
            } else {
              setProfile(null);
            }
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('Auth state load failed', error);
        setAppError('Unable to load account data.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => authUnsub();
  }, [setAppError]);

  // Register this device's FCM push token whenever a tech or admin logs in
  useEffect(() => {
    if (!firebaseUser || !profile) return;
    if (!isFieldRole(profile.role) && profile.role !== 'admin') return;
    if (!VAPID_KEY || VAPID_KEY === 'PASTE_YOUR_VAPID_KEY_HERE') return;

    const registerFcmToken = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'denied') {
          setAppError('Notifications are blocked for this browser. Allow them in site settings to get job alerts on this device.');
        }
        if (permission !== 'granted') return;
        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (!token) return;
        const userRef = doc(db, 'users', firebaseUser.uid);
        await updateDoc(userRef, { fcmTokens: arrayUnion(token), fcmToken: deleteField() });
      } catch (err) {
        console.warn('FCM token registration failed:', err.message);
        setAppError('Unable to turn on job notifications on this device.');
      }
    };
    registerFcmToken();
  }, [firebaseUser, profile, setAppError]);

  useEffect(() => {
    if (firebaseUser) {
      setAdminSetupAllowed(false);
      return;
    }

    const checkUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'));
        setAdminSetupAllowed(snapshot.empty);
      } catch (error) {
        console.error('Unable to check users collection', error);
        setAdminSetupAllowed(false);
      }
    };
    checkUsers();
  }, [firebaseUser]);

  return {
    authReady,
    firebaseUser,
    setFirebaseUser,
    profile,
    setProfile,
    adminSetupAllowed,
    setAdminSetupAllowed,
    suppressAuthStateRef,
  };
}
