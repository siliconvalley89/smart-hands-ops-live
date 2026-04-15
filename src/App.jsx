import React, { useState, useEffect, useRef } from 'react';
import { db, storage, auth, messaging, VAPID_KEY } from './firebase';
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, updateDoc, getDocs, getDoc, setDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getToken } from 'firebase/messaging';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { jsPDF } from 'jspdf';
import logoPath from './assets/sv-smart-dispatch-logo.jpg';
import {
  Briefcase,
  Wrench,
  Clock,
  Calendar,
  MapPin,
  Trash2,
  Camera,
  Loader2,
  Lock,
  LogOut,
  List,
  CheckCircle,
  Plus,
  FileText,
  Shield,
} from 'lucide-react';

const formatDate = (value) => {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString();
  return new Date(value).toLocaleString();
};

const calcInvoiceTotal = (items = [], serviceFee = 0) => {
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitPrice || 0)), 0) + Number(serviceFee || 0);
};

const APP_DISPLAY_NAME = 'SV Smart Dispatch';
const BUSINESS_NAME = 'Silicon Valley Smart Hands LLC';

const loadImageDataUrl = async (url) => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const generateInvoicePdf = async (job) => {
  try {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const logoDataUrl = await loadImageDataUrl(logoPath);
    doc.addImage(logoDataUrl, 'JPEG', 40, 40, 120, 40);
    doc.setFontSize(18);
    doc.text(BUSINESS_NAME, 40, 100);
    doc.setFontSize(12);
    doc.text(`Invoice ID: ${job.id}`, 40, 125);
    doc.text(`Date: ${formatDate(job.createdAt)}`, 40, 145);
    doc.text(`Client: ${job.client}`, 40, 165);
    doc.text(`Location: ${job.location}`, 40, 185);
    doc.text(`Assigned Tech: ${job.assignedTechName || 'N/A'}`, 40, 205);
    doc.text(`Service: ${job.task}`, 40, 225);
    doc.text(`Service fee: $${Number(job.serviceFee || 0).toFixed(2)}`, 40, 245);
    doc.setFontSize(11);
    doc.text(`Service fee description: ${job.serviceFeeDescription || 'N/A'}`, 40, 262);
    let y = 282;
    doc.setFontSize(12);
    doc.text('Service details:', 40, y);
    y += 18;
    doc.setFontSize(11);
    doc.text(job.details || 'N/A', 40, y);
    y += 28;
    doc.setFontSize(12);
    doc.text('Consumables:', 40, y);

    let yConsumables = y + 20;
    const consumables = job.consumables || [];
    if (consumables.length === 0) {
      doc.text('None', 40, yConsumables);
      yConsumables += 20;
    } else {
      doc.setFontSize(11);
      consumables.forEach((item) => {
        const amount = Number(item.qty || 0) * Number(item.unitPrice || 0);
        doc.text(`${item.description} - ${item.qty} x $${Number(item.unitPrice || 0).toFixed(2)} = $${amount.toFixed(2)}`, 40, yConsumables);
        yConsumables += 18;
      });
      yConsumables += 10;
    }

    doc.setFontSize(12);
    doc.text(`Total: $${calcInvoiceTotal(consumables, job.serviceFee).toFixed(2)}`, 40, yConsumables + 10);
    const footerY = doc.internal.pageSize.height - 40;
    doc.setFontSize(10);
    doc.text('Thank you for choosing Silicon Valley Smart Hands LLC.', 40, footerY);
    doc.save(`SV-Smart-Dispatch-Invoice-${job.id}.pdf`);
    await updateDoc(doc(db, 'jobs', job.id), {
      invoiceSent: true,
      invoiceSentAt: new Date(),
    });
  } catch (error) {
    console.error('Invoice generation failed', error);
    setAppError('Unable to generate invoice PDF.');
  }
};

const calculateDistanceMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [initialAdminOpen, setInitialAdminOpen] = useState(false);
  const [adminSetupAllowed, setAdminSetupAllowed] = useState(false);
  const [adminSetup, setAdminSetup] = useState({ name: '', email: '', password: '' });
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [requestForm, setRequestForm] = useState({ name: '', email: '', phone: '', location: '', service: '', details: '', serialNumber: '', scheduledFor: '' });
  const [requestSuccess, setRequestSuccess] = useState('');
  const [requestError, setRequestError] = useState('');
  const [newTech, setNewTech] = useState({ name: '', email: '', phone: '', location: '' });
  const [techMessage, setTechMessage] = useState('');
  const [newConsumable, setNewConsumable] = useState({ description: '', qty: 1, unitPrice: '' });
  const [serviceFeeInputs, setServiceFeeInputs] = useState({});
  const [consumableEdits, setConsumableEdits] = useState({});
  const [newAccount, setNewAccount] = useState({ name: '', email: '', password: '', role: 'tech', phone: '', location: '', adminPassword: '' });
  const [accountMessage, setAccountMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordSectionHidden, setPasswordSectionHidden] = useState(false);
  const [assignments, setAssignments] = useState({});
  const [users, setUsers] = useState([]);
  const [userRoleEdits, setUserRoleEdits] = useState({});
  const [showAddUserPanel, setShowAddUserPanel] = useState(true);
  const [showJobsPanel, setShowJobsPanel] = useState(false);
  const [showCompletedJobsPanel, setShowCompletedJobsPanel] = useState(false);
  const [profilePhotoUploadBusy, setProfilePhotoUploadBusy] = useState(false);
  const [geoEventBusyJobId, setGeoEventBusyJobId] = useState(null);
  const [savedRoles, setSavedRoles] = useState({});
  const [requestFormOpen, setRequestFormOpen] = useState(true);
  const [editingJobId, setEditingJobId] = useState(null);
  const [jobEdits, setJobEdits] = useState({});
  const suppressAuthStateRef = useRef(false);

  useEffect(() => {
    const authUnsub = onAuthStateChanged(auth, async (user) => {
      if (suppressAuthStateRef.current) return;
      try {
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
  }, []);

  // Register this device's FCM push token whenever a tech or admin logs in
  useEffect(() => {
    if (!firebaseUser || !profile) return;
    if (profile.role !== 'tech' && profile.role !== 'admin') return;
    if (!VAPID_KEY || VAPID_KEY === 'PASTE_YOUR_VAPID_KEY_HERE') return;

    const registerFcmToken = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (!token) return;
        const userRef = doc(db, 'users', firebaseUser.uid);
        await updateDoc(userRef, { fcmToken: token });
      } catch (err) {
        console.warn('FCM token registration failed:', err.message);
      }
    };
    registerFcmToken();
  }, [firebaseUser, profile]);

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

  useEffect(() => {
    if (!profile) {
      setJobs([]);
      setLoading(false);
      return () => {};
    }

    setLoading(true);

    let jobsQuery;
    if (profile.role === 'admin') {
      jobsQuery = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    } else if (profile.role === 'tech') {
      jobsQuery = query(collection(db, 'jobs'), where('assignedTechEmail', '==', profile.email || firebaseUser?.email || ''));
    } else {
      jobsQuery = query(collection(db, 'jobs'), where('clientEmail', '==', profile.email || firebaseUser?.email || ''));
    }

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const toTime = (value) => {
          if (!value) return 0;
          if (value?.toDate) return value.toDate().getTime();
          const parsed = new Date(value).getTime();
          return Number.isNaN(parsed) ? 0 : parsed;
        };

        const jobItems = snapshot.docs
          .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
          .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));

        setJobs(jobItems);
        setLoading(false);
      },
      (error) => {
        console.error('Unable to load jobs snapshot', error);
        setJobs([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [profile?.role, profile?.email, firebaseUser?.email]);

  useEffect(() => {
    const q = query(collection(db, 'technicians'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const techItems = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setTechs(techItems);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (profile?.role !== 'admin') {
      setUsers([]);
      return () => {};
    }

    const q = query(collection(db, 'users'), orderBy('displayName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userItems = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setUsers(userItems);
    });
    return () => unsubscribe();
  }, [profile?.role]);

  useEffect(() => {
    if (profile?.role === 'client') {
      setRequestForm((prev) => ({
        ...prev,
        name: profile.displayName || prev.name,
        email: profile.email || firebaseUser?.email || prev.email,
      }));
    }
  }, [profile?.role, profile?.displayName, profile?.email, firebaseUser?.email]);

  const login = async () => {
    setLoginError('');
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword.trim());
      setLoginEmail('');
      setLoginPassword('');
    } catch (error) {
      console.error('Login failed', error);
      setLoginError('Login failed. Check your email and password.');
    }
  };

  const setupInitialAdmin = async () => {
    setLoginError('');
    if (!adminSetup.name || !adminSetup.email || !adminSetup.password) {
      setLoginError('Please fill all admin fields.');
      return;
    }
    try {
      const result = await createUserWithEmailAndPassword(auth, adminSetup.email.trim(), adminSetup.password.trim());
      const user = result.user;
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        displayName: adminSetup.name,
        email: adminSetup.email.trim(),
        role: 'admin',
      });
      setAdminSetup({ name: '', email: '', password: '' });
      setAdminSetupAllowed(false);
      setInitialAdminOpen(false);
    } catch (error) {
      console.error('Admin setup failed', error);
      let message = 'Could not create admin account.';
      if (error?.code) {
        switch (error.code) {
          case 'auth/email-already-in-use':
            message = 'This email is already in use.';
            break;
          case 'auth/invalid-email':
            message = 'Invalid email address.';
            break;
          case 'auth/weak-password':
            message = 'Password too weak. Use at least 6 characters.';
            break;
          case 'auth/operation-not-allowed':
            message = 'Email/password sign-in is disabled in Firebase Auth. Enable it in the Firebase console.';
            break;
          default:
            message = error.message || message;
        }
      } else if (error?.message) {
        message = error.message;
      }
      setLoginError(message);
    }
  };

  const logout = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setFirebaseUser(null);
  };

  const geocodeAddress = async (address) => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
    const results = await response.json();
    if (!results || results.length === 0) {
      throw new Error('Unable to locate that address.');
    }
    const location = results[0];
    return {
      lat: Number(location.lat),
      lng: Number(location.lon),
      displayName: location.display_name,
    };
  };

  const findNearestTechnician = (clientLat, clientLng) => {
    const availableTechs = techs.filter((tech) => tech.status === 'available' && tech.lat != null && tech.lng != null);
    if (availableTechs.length === 0) return null;

    return availableTechs.reduce((nearest, tech) => {
      const distanceMiles = calculateDistanceMiles(clientLat, clientLng, tech.lat, tech.lng);
      if (!nearest || distanceMiles < nearest.distanceMiles) {
        return { ...tech, distanceMiles };
      }
      return nearest;
    }, null);
  };

  const assignNearestTechnician = async (clientLat, clientLng) => {
    const nearest = findNearestTechnician(clientLat, clientLng);
    if (!nearest) return null;
    await updateDoc(doc(db, 'technicians', nearest.id), { status: 'busy', lastAssignedAt: new Date() });
    return nearest;
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    setRequestError('');
    setRequestSuccess('');

    const resolvedClientEmail = profile?.role === 'client'
      ? (profile.email || firebaseUser?.email || '')
      : requestForm.email;
    const resolvedClientName = profile?.role === 'client'
      ? (profile.displayName || requestForm.name)
      : requestForm.name;

    if (!resolvedClientName || !resolvedClientEmail || !requestForm.phone || !requestForm.location || !requestForm.service) {
      setRequestError('Please complete all required fields.');
      return;
    }

    try {
      const geo = await geocodeAddress(requestForm.location);
      // Find nearest available tech; Cloud Function marks them busy after job creation
      const nearest = findNearestTechnician(geo.lat, geo.lng);
      await addDoc(collection(db, 'jobs'), {
        client: resolvedClientName,
        clientEmail: resolvedClientEmail,
        clientPhone: requestForm.phone,
        location: geo.displayName,
        rawLocation: requestForm.location,
        lat: geo.lat,
        lng: geo.lng,
        task: requestForm.service,
        details: requestForm.details,
        serialNumber: requestForm.serialNumber || '',
        scheduledFor: requestForm.scheduledFor ? new Date(requestForm.scheduledFor) : null,
        status: nearest ? 'Dispatched' : 'Pending',
        assignedTechName: nearest?.name || '',
        assignedTechEmail: nearest?.email || '',
        assignedTechDistanceMiles: nearest?.distanceMiles || null,
        assignedTechDistanceKm: nearest?.distanceKm || null,
        consumables: [],
        serviceFee: 0,
        serviceFeeDescription: '',
        invoiceSent: false,
        beforePhotoUrl: '',
        afterPhotoUrl: '',
        clientSignedOff: false,
        createdAt: new Date(),
      });
      setRequestSuccess(nearest ? `Assigned to ${nearest.name}` : 'Request submitted. No available tech found yet.');
      setRequestForm({
        name: profile?.role === 'client' ? (profile.displayName || '') : '',
        email: profile?.role === 'client' ? (profile.email || firebaseUser?.email || '') : '',
        phone: '',
        location: '',
        service: '',
        details: '',
        serialNumber: '',
        scheduledFor: '',
      });
    } catch (error) {
      console.error('Submit request failed', error);
      setRequestError(error.message || 'Failed to submit request.');
    }
  };

  const addTechnician = async (event) => {
    event.preventDefault();
    setTechMessage('');
    if (!newTech.name || !newTech.email || !newTech.location) {
      setTechMessage('Please enter name, email, and location.');
      return;
    }

    try {
      const geo = await geocodeAddress(newTech.location);
      await addDoc(collection(db, 'technicians'), {
        name: newTech.name,
        email: newTech.email,
        phone: newTech.phone,
        location: geo.displayName,
        rawLocation: newTech.location,
        lat: geo.lat,
        lng: geo.lng,
        status: 'available',
        createdAt: new Date(),
      });
      setNewTech({ name: '', email: '', phone: '', location: '' });
      setTechMessage('Technician added and ready for dispatch.');
    } catch (error) {
      console.error('Add technician failed', error);
      setTechMessage('Could not add technician. Please check the location.');
    }
  };

  const createAccount = async () => {
    setAccountMessage('');
    if (!newAccount.name || !newAccount.email || !newAccount.password || !newAccount.role || !newAccount.adminPassword) {
      setAccountMessage('Please fill all required account fields, including your admin password.');
      return;
    }
    if (newAccount.role === 'tech' && !newAccount.location) {
      setAccountMessage('Please enter a base location for technician accounts.');
      return;
    }
    const adminEmail = profile?.email;
    const adminPassword = newAccount.adminPassword;
    const adminUid = firebaseUser?.uid;

    suppressAuthStateRef.current = true;
    try {
      const result = await createUserWithEmailAndPassword(auth, newAccount.email.trim(), newAccount.password.trim());
      const user = result.user;
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        displayName: newAccount.name,
        email: newAccount.email.trim(),
        role: newAccount.role,
        mustChangePassword: true,
      });

      if (newAccount.role === 'tech') {
        const geo = await geocodeAddress(newAccount.location);
        await setDoc(doc(db, 'technicians', user.uid), {
          uid: user.uid,
          name: newAccount.name,
          email: newAccount.email.trim(),
          phone: newAccount.phone || '',
          location: geo.displayName,
          rawLocation: newAccount.location,
          lat: geo.lat,
          lng: geo.lng,
          status: 'available',
          createdAt: new Date(),
        });
      }

      await firebaseSignOut(auth);
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      // Manually restore admin state — avoids UI flicker from onAuthStateChanged
      const adminDocSnap = await getDoc(doc(db, 'users', adminUid));
      setFirebaseUser(auth.currentUser);
      if (adminDocSnap.exists()) setProfile({ id: adminDocSnap.id, ...adminDocSnap.data() });
      setAccountMessage(`${newAccount.role === 'tech' ? 'Technician' : 'Client'} account created successfully.`);
      setNewAccount({ name: '', email: '', password: '', role: 'tech', phone: '', location: '', adminPassword: '' });
    } catch (error) {
      console.error('Create account failed', error);
      try {
        await firebaseSignOut(auth);
        if (adminEmail && adminPassword) {
          await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
          const adminDocSnap = await getDoc(doc(db, 'users', adminUid));
          setFirebaseUser(auth.currentUser);
          if (adminDocSnap.exists()) setProfile({ id: adminDocSnap.id, ...adminDocSnap.data() });
        }
      } catch (recoveryError) {
        console.error('Admin session recovery failed', recoveryError);
      }
      setAccountMessage(error.message || 'Unable to create account.');
    } finally {
      suppressAuthStateRef.current = false;
    }
  };

  const changeMyPassword = async () => {
    setPasswordMessage('');
    if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) {
      setPasswordMessage('Please fill current and new password fields.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordMessage('New password and confirmation do not match.');
      return;
    }
    if (passwordForm.next.length < 6) {
      setPasswordMessage('New password must be at least 6 characters.');
      return;
    }

    try {
      const currentUser = auth.currentUser;
      if (!currentUser?.email) {
        setPasswordMessage('No signed-in user was found. Please sign in again.');
        return;
      }
      const credential = EmailAuthProvider.credential(currentUser.email, passwordForm.current);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, passwordForm.next);
      // Clear the flag permanently in Firestore so section stays hidden after refresh
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, { mustChangePassword: false });
      setProfile((prev) => ({ ...prev, mustChangePassword: false }));
      setPasswordForm({ current: '', next: '', confirm: '' });
      setPasswordMessage('Password updated successfully.');
      setPasswordSectionHidden(true);
    } catch (error) {
      console.error('Password update failed', error);
      setPasswordMessage('Unable to update password. Verify your current password and try again.');
    }
  };

  const getCurrentCoordinates = async () => {
    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported by this browser.');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
      );
    });
  };

  const recordTechGeoEvent = async (job, eventType) => {
    setAppError('');
    try {
      setGeoEventBusyJobId(job.id);
      const coords = await getCurrentCoordinates();

      // Geofence: require tech to be within 1,000 ft of the job site for check-in / check-out
      if ((eventType === 'checkIn' || eventType === 'checkOut') && job.lat != null && job.lng != null) {
        const distMiles = calculateDistanceMiles(job.lat, job.lng, coords.lat, coords.lng);
        const distFeet = Math.round(distMiles * 5280);
        if (distFeet > 1000) {
          setAppError(`You must be within 1,000 ft of the site to ${eventType === 'checkIn' ? 'check in' : 'check out'}. You are currently ${distFeet.toLocaleString()} ft away.`);
          return;
        }
      }

      const payload = {
        updatedAt: new Date(),
      };

      if (eventType === 'checkIn') {
        payload.checkInAt = new Date();
        payload.checkInLat = coords.lat;
        payload.checkInLng = coords.lng;
      }

      if (eventType === 'checkOut') {
        payload.checkOutAt = new Date();
        payload.checkOutLat = coords.lat;
        payload.checkOutLng = coords.lng;
      }

      if (eventType === 'breakStart') {
        const existing = Array.isArray(job.breaks) ? job.breaks : [];
        payload.breaks = [...existing, { startAt: new Date(), startLat: coords.lat, startLng: coords.lng }];
      }

      if (eventType === 'breakEnd') {
        const existing = Array.isArray(job.breaks) ? [...job.breaks] : [];
        let lastOpenIdx = -1;
        for (let i = existing.length - 1; i >= 0; i--) {
          if (existing[i].startAt && !existing[i].endAt) { lastOpenIdx = i; break; }
        }
        if (lastOpenIdx >= 0) {
          existing[lastOpenIdx] = { ...existing[lastOpenIdx], endAt: new Date(), endLat: coords.lat, endLng: coords.lng };
        }
        payload.breaks = existing;
      }

      await updateDoc(doc(db, 'jobs', job.id), payload);
    } catch (error) {
      console.error('Unable to record geotag event', error);
      setAppError('Unable to record geotag event. Please allow location access and retry.');
    } finally {
      setGeoEventBusyJobId(null);
    }
  };

  const updateUserRole = async (userItem) => {
    const nextRole = userRoleEdits[userItem.id] || userItem.role;
    // Always lock the row to show 'Edit role' even if the selection didn't change
    setSavedRoles((prev) => ({ ...prev, [userItem.id]: true }));
    if (!nextRole || nextRole === userItem.role) return;

    try {
      await updateDoc(doc(db, 'users', userItem.id), { role: nextRole });

      if (userItem.role === 'tech' && nextRole !== 'tech') {
        await deleteDoc(doc(db, 'technicians', userItem.id));
      }

      if (userItem.role !== 'tech' && nextRole === 'tech') {
        await setDoc(doc(db, 'technicians', userItem.id), {
          uid: userItem.uid || userItem.id,
          name: userItem.displayName || userItem.email,
          email: userItem.email,
          phone: '',
          location: '',
          rawLocation: '',
          status: 'available',
          createdAt: new Date(),
        }, { merge: true });
      }

      setAccountMessage(`Updated role for ${userItem.displayName || userItem.email}.`);
    } catch (error) {
      console.error('Update user role failed', error);
      setSavedRoles((prev) => ({ ...prev, [userItem.id]: false }));
      setAccountMessage('Unable to update user role.');
    }
  };

  const deleteUser = async (userId, userRole) => {
    if (userId === (profile?.uid || profile?.id)) {
      setAccountMessage('You cannot delete your own admin account from this panel.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'users', userId));
      if (userRole === 'tech') {
        await deleteDoc(doc(db, 'technicians', userId));
      }
      setAccountMessage('User deleted successfully.');
      setTimeout(() => setAccountMessage(''), 3000);
    } catch (error) {
      console.error('Delete user failed', error);
      setAccountMessage('Unable to delete user.');
    }
  };

  const addConsumable = async (job) => {
    if (!newConsumable.description || !newConsumable.qty) return;
    const item = {
      description: newConsumable.description,
      qty: Number(newConsumable.qty),
      unitPrice: Number(newConsumable.unitPrice || 0),
    };
    await updateDoc(doc(db, 'jobs', job.id), {
      consumables: [...(job.consumables || []), item],
    });
    setNewConsumable({ description: '', qty: 1, unitPrice: '' });
  };

  const addServiceFee = async (job) => {
    if (profile?.role !== 'admin') {
      setAppError('Only admins can add or change the service fee.');
      return;
    }
    const serviceInput = serviceFeeInputs[job.id] || { amount: '', description: '' };
    if (!serviceInput.amount) return;
    if (job.invoiceSent) {
      setAppError('Cannot update service fee after the invoice has been sent.');
      return;
    }
    await updateDoc(doc(db, 'jobs', job.id), {
      serviceFee: Number(serviceInput.amount),
      serviceFeeDescription: serviceInput.description || '',
    });
    setServiceFeeInputs((prev) => ({ ...prev, [job.id]: { amount: '', description: '' } }));
  };

  const deleteServiceFee = async (job) => {
    if (profile?.role !== 'admin') {
      setAppError('Only admins can delete the service fee.');
      return;
    }
    if (job.invoiceSent) {
      setAppError('Cannot delete service fee after the invoice has been sent.');
      return;
    }
    await updateDoc(doc(db, 'jobs', job.id), {
      serviceFee: 0,
      serviceFeeDescription: '',
    });
    setServiceFeeInputs((prev) => ({ ...prev, [job.id]: { amount: '', description: '' } }));
  };

  const updateConsumableField = (jobId, index, field, value) => {
    setConsumableEdits((prev) => ({
      ...prev,
      [jobId]: {
        ...(prev[jobId] || {}),
        [index]: {
          ...(prev[jobId]?.[index] || {}),
          [field]: value,
        },
      },
    }));
  };

  const saveConsumableChange = async (job, index) => {
    if (job.invoiceSent) {
      setAppError('Cannot modify consumables after the invoice has been sent.');
      return;
    }
    const itemEdit = consumableEdits[job.id]?.[index];
    if (!itemEdit) return;
    const updatedConsumables = (job.consumables || []).map((item, idx) =>
      idx === index
        ? {
            ...item,
            description: itemEdit.description ?? item.description,
            qty: Number(itemEdit.qty ?? item.qty),
            unitPrice: Number(itemEdit.unitPrice ?? item.unitPrice),
          }
        : item
    );
    await updateDoc(doc(db, 'jobs', job.id), {
      consumables: updatedConsumables,
    });
    setConsumableEdits((prev) => {
      const jobEdits = { ...(prev[job.id] || {}) };
      delete jobEdits[index];
      return { ...prev, [job.id]: jobEdits };
    });
  };

  const deleteConsumable = async (job, index) => {
    if (job.invoiceSent) {
      setAppError('Cannot delete consumables after the invoice has been sent.');
      return;
    }
    const updatedConsumables = (job.consumables || []).filter((_, idx) => idx !== index);
    await updateDoc(doc(db, 'jobs', job.id), {
      consumables: updatedConsumables,
    });
    setConsumableEdits((prev) => {
      const jobEdits = { ...(prev[job.id] || {}) };
      delete jobEdits[index];
      return { ...prev, [job.id]: jobEdits };
    });
  };

  const requestClientSignoff = async (job) => {
    await updateDoc(doc(db, 'jobs', job.id), {
      status: 'Ready for Signoff',
      signoffRequestedAt: new Date(),
    });
  };

  const handleClientSignoff = async (job) => {
    await updateDoc(doc(db, 'jobs', job.id), {
      clientSignedOff: true,
      status: 'Completed',
      completedAt: new Date(),
    });
  };

  const handlePhotoUpload = async (event, jobId, type) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected after a replace
    event.target.value = '';
    try {
      setUploadingId(jobId);
      const storageRef = ref(storage, `jobs/${jobId}/${type}-${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'jobs', jobId), {
        [`${type}PhotoUrl`]: url,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('Photo upload failed', error);
      setAppError('Photo upload failed.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleProfilePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      setProfilePhotoUploadBusy(true);
      const storageRef = ref(storage, `users/${firebaseUser.uid}/profile-photo`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', firebaseUser.uid), { profilePhotoUrl: url });
      setProfile((prev) => ({ ...prev, profilePhotoUrl: url }));
    } catch (error) {
      console.error('Profile photo upload failed', error);
      setAppError('Profile photo upload failed.');
    } finally {
      setProfilePhotoUploadBusy(false);
    }
  };

  const deletePhoto = async (jobId, type) => {
    try {
      await updateDoc(doc(db, 'jobs', jobId), {
        [`${type}PhotoUrl`]: '',
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('Delete photo failed', error);
      setAppError('Unable to delete photo.');
    }
  };

  const handleDelete = async (jobId) => {
    try {
      await deleteDoc(doc(db, 'jobs', jobId));
    } catch (error) {
      console.error('Delete job failed', error);
      setAppError('Unable to delete job.');
    }
  };

  const saveJobEdits = async (job) => {
    const edits = jobEdits[job.id];
    if (!edits || Object.keys(edits).length === 0) { setEditingJobId(null); return; }
    try {
      await updateDoc(doc(db, 'jobs', job.id), { ...edits, updatedAt: new Date() });
      setEditingJobId(null);
      setJobEdits((prev) => { const next = { ...prev }; delete next[job.id]; return next; });
    } catch (error) {
      console.error('Save job edits failed', error);
      setAppError('Unable to save job edits.');
    }
  };

  const adminSignOffWork = async (job) => {
    try {
      await updateDoc(doc(db, 'jobs', job.id), {
        adminSignedOff: true,
        adminSignedOffAt: new Date(),
      });
    } catch (error) {
      console.error('Admin sign-off failed', error);
      setAppError('Unable to sign off work.');
    }
  };

  const assignTechnicianToJob = async (job) => {
    const techId = assignments[job.id];
    if (!techId) {
      setAppError('Select a technician first to assign this job.');
      return;
    }

    const tech = techs.find((item) => item.id === techId);
    if (!tech) {
      setAppError('Selected technician not found.');
      return;
    }

    if (tech.status === 'busy') {
      const confirmed = window.confirm(`${tech.name} is currently assigned to another job. Assign them to this job anyway?`);
      if (!confirmed) return;
    }

    try {
      const jobRef = doc(db, 'jobs', job.id);
      const distanceMiles = job.lat != null && job.lng != null && tech.lat != null && tech.lng != null
        ? calculateDistanceMiles(job.lat, job.lng, tech.lat, tech.lng)
        : null;

      await updateDoc(jobRef, {
        assignedTechName: tech.name,
        assignedTechEmail: tech.email,
        assignedTechDistanceMiles: distanceMiles,
        assignedTechDistanceKm: distanceMiles,
        status: 'Dispatched',
      });
      // Cloud Function (manageTechStatusOnJobUpdated) handles marking old/new tech busy/available

      setAppError('');
    } catch (error) {
      console.error('Manual assignment failed', error);
      setAppError('Unable to assign technician.');
    }
  };

  const currentJobs = profile
    ? profile.role === 'admin'
      ? jobs
      : profile.role === 'tech'
        ? jobs.filter((job) => job.assignedTechEmail === (profile.email || firebaseUser?.email))
        : jobs.filter((job) => job.clientEmail === (profile.email || firebaseUser?.email))
    : [];

  const openRequestForm = profile?.role === 'client';
  const canViewInvoice = profile?.role === 'admin' || profile?.role === 'client';
  const activeJobsCount = currentJobs.filter((job) => job.status !== 'Completed').length;
  const completedJobsCount = currentJobs.filter((job) => job.status === 'Completed').length;
  const activeJobs = currentJobs.filter((job) => job.status !== 'Completed');
  const completedJobs = currentJobs.filter((job) => job.status === 'Completed');

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">Loading…</div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-3xl p-8 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="bg-blue-600 p-3 rounded-xl"><Lock size={24} /></div>
            <div>
              <h1 className="text-2xl font-bold">{APP_DISPLAY_NAME} Login</h1>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-slate-300 text-sm">Email</label>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
            />
            <label className="block text-slate-300 text-sm">Password</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
            />
            {loginError && <div className="rounded-2xl bg-red-900/50 p-3 text-red-200">{loginError}</div>}
            <button onClick={login} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 transition">
              Sign in
            </button>
            {adminSetupAllowed && !initialAdminOpen && (
              <button onClick={() => setInitialAdminOpen(true)} className="w-full rounded-2xl border border-slate-700 px-4 py-3 text-slate-200 hover:bg-slate-800 transition">
                Create initial admin account
              </button>
            )}
            {initialAdminOpen && (
              <div className="space-y-4">
                <label className="block text-slate-300 text-sm">Name</label>
                <input
                  value={adminSetup.name}
                  onChange={(e) => setAdminSetup((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Admin Name"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
                />
                <label className="block text-slate-300 text-sm">Email</label>
                <input
                  value={adminSetup.email}
                  onChange={(e) => setAdminSetup((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="admin@example.com"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
                />
                <label className="block text-slate-300 text-sm">Password</label>
                <input
                  type="password"
                  value={adminSetup.password}
                  onChange={(e) => setAdminSetup((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Create password"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
                />
                <button onClick={setupInitialAdmin} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-white font-semibold hover:bg-emerald-500 transition">
                  Create admin account
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-700 rounded-3xl p-8 shadow-2xl text-center">
          <h1 className="text-2xl font-bold">Account not set up yet</h1>
          <p className="text-slate-400 mt-4">Your Firebase user exists, but no role profile was found.</p>
          <p className="text-slate-400 mt-2">Create a record in the Firestore users collection with your UID, displayName, email, and role.</p>
          <button onClick={logout} className="mt-6 rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 transition">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-20">
      <nav className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-50">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src={logoPath} alt={APP_DISPLAY_NAME} className="h-10 w-auto rounded-lg" />
            {profile.profilePhotoUrl ? (
              <img src={profile.profilePhotoUrl} alt="Profile" className="h-9 w-9 rounded-full object-cover ring-2 ring-slate-600" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-sm font-bold select-none">
                {(profile.displayName || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <div className="text-slate-400 text-sm">Signed in as {profile.displayName}</div>
              <h1 className="text-xl font-bold">{APP_DISPLAY_NAME}</h1>
            </div>
          </div>
          <button onClick={logout} className="rounded-2xl bg-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-600 flex items-center gap-2">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        {appError && (
          <div className="rounded-3xl bg-red-900/20 border border-red-700 p-4 text-red-100">
            {appError}
          </div>
        )}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`rounded-3xl border p-5 ${(profile.role !== 'client' && !profile.profilePhotoUrl) ? 'bg-amber-900/20 border-amber-700' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex items-center justify-between">
              <div className="text-slate-400 uppercase tracking-[0.2em] text-xs">Role</div>
              <label htmlFor="profile-photo-upload" className={`cursor-pointer inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-semibold transition ${profilePhotoUploadBusy ? 'opacity-60 cursor-not-allowed' : ''} ${(profile.role !== 'client' && !profile.profilePhotoUrl) ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
                <Camera size={12} /> {profilePhotoUploadBusy ? 'Uploading...' : profile.profilePhotoUrl ? 'Change' : 'Upload photo'}
              </label>
              <input id="profile-photo-upload" type="file" className="hidden" accept="image/*" onChange={handleProfilePhotoUpload} disabled={profilePhotoUploadBusy} />
            </div>
            <div className="mt-4 flex items-center gap-4">
              {profile.profilePhotoUrl ? (
                <img src={profile.profilePhotoUrl} alt="Profile" className="h-14 w-14 rounded-full object-cover ring-2 ring-slate-600 shrink-0" />
              ) : (
                <div className={`h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold select-none shrink-0 ${profile.role !== 'client' ? 'bg-amber-900/50 text-amber-300 ring-2 ring-amber-700' : 'bg-slate-700 text-slate-300'}`}>
                  {(profile.displayName || '?')[0].toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-3xl font-bold capitalize">{profile.role}</div>
                <div className="mt-1 text-slate-400 text-sm">{profile.displayName}</div>
              </div>
            </div>
            {profile.role !== 'client' && !profile.profilePhotoUrl && (
              <div className="mt-2 text-amber-400 text-xs">Photo required</div>
            )}
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Closed jobs</div>
            <div className="mt-4 text-4xl font-bold">{completedJobsCount}</div>
            <div className="mt-2 text-slate-400">Total completed jobs</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Open jobs</div>
            <div className="mt-4 text-4xl font-bold">{activeJobsCount}</div>
            <div className="mt-2 text-slate-400">Not yet completed</div>
          </div>
        </section>

        {profile.mustChangePassword === true && (
          <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Change password</h2>
              <p className="text-slate-400 mt-1">Users can replace the temporary password on first login from here.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <input
                type="password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, current: e.target.value }))}
                placeholder="Current password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <input
                type="password"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, next: e.target.value }))}
                placeholder="New password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm: e.target.value }))}
                placeholder="Confirm new password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
            </div>
            {passwordMessage && <div className="rounded-2xl bg-blue-900/50 p-3 text-blue-200">{passwordMessage}</div>}
            <button onClick={changeMyPassword} type="button" className="rounded-2xl bg-amber-600 px-5 py-3 text-white font-semibold hover:bg-amber-500 transition flex items-center justify-center gap-2">
              <Lock size={16} /> Update my password
            </button>
          </section>
        )}

        {(profile.role === 'admin' || profile.role === 'client') && (
          <section className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-lg font-semibold"><Calendar size={20} /> {profile.role === 'client' ? 'Request service' : 'Client request form'}</div>
              <button type="button" onClick={() => setRequestFormOpen((prev) => !prev)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                {requestFormOpen ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {requestFormOpen && <form onSubmit={submitRequest} className="grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Name</span>
                  <input
                    value={requestForm.name}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Client name"
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">Email</span>
                  <input
                    value={requestForm.email}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="client@example.com"
                    readOnly={profile.role === 'client'}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Phone</span>
                  <input
                    value={requestForm.phone}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="(408) 409-8115"
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">Location</span>
                  <input
                    value={requestForm.location}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, location: e.target.value }))}
                    placeholder="123 Main St, San Jose, CA"
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-slate-300 text-sm">Service requested</span>
                <input
                  value={requestForm.service}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, service: e.target.value }))}
                  placeholder="Network repair, server install, etc."
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Hardware serial number</span>
                  <input
                    value={requestForm.serialNumber}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, serialNumber: e.target.value }))}
                    placeholder="e.g. SRV-2A4F8B"
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">Failure / fault details</span>
                  <input
                    value={requestForm.details}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, details: e.target.value }))}
                    placeholder="Power supply failed, NIC unreachable, etc."
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-slate-300 text-sm">Scheduled date &amp; time <span className="text-slate-500 text-xs">(optional — leave blank for immediate dispatch)</span></span>
                <input
                  type="datetime-local"
                  value={requestForm.scheduledFor}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, scheduledFor: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              </label>
              {requestError && <div className="rounded-2xl bg-red-900/50 p-3 text-red-200">{requestError}</div>}
              {requestSuccess && <div className="rounded-2xl bg-emerald-900/50 p-3 text-emerald-200">{requestSuccess}</div>}
              <button type="submit" className="rounded-2xl bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-500 transition">
                Submit request
              </button>
            </form>}
          </section>
        )}

        {profile.role === 'admin' && (
          <>
          <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">User management</h2>
                <p className="text-slate-400 mt-1">Use this panel to create and manage technician/client accounts.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUserPanel((prev) => !prev)}
                className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
              >
                {showAddUserPanel ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {showAddUserPanel && (
              <>
              <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Create user account</h2>
                <p className="text-slate-400 mt-1">Create a technician or client login directly from the admin panel.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                value={newAccount.name}
                onChange={(e) => setNewAccount((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Full name"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <input
                value={newAccount.email}
                onChange={(e) => setNewAccount((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Email"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <input
                type="password"
                value={newAccount.password}
                onChange={(e) => setNewAccount((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Account password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <select
                value={newAccount.role}
                onChange={(e) => setNewAccount((prev) => ({ ...prev, role: e.target.value }))}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              >
                <option value="tech">Technician</option>
                <option value="client">Client</option>
              </select>
            </div>

            {newAccount.role === 'tech' && (
              <div className="grid gap-4 md:grid-cols-2">
                <input
                  value={newAccount.phone}
                  onChange={(e) => setNewAccount((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="Phone"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
                <input
                  value={newAccount.location}
                  onChange={(e) => setNewAccount((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="Base location"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="password"
                value={newAccount.adminPassword}
                onChange={(e) => setNewAccount((prev) => ({ ...prev, adminPassword: e.target.value }))}
                placeholder="Your admin password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-400 flex items-center">
                This is required to restore your admin session after creating the new account.
              </div>
            </div>

            {accountMessage && <div className="rounded-2xl bg-blue-900/50 p-3 text-blue-200">{accountMessage}</div>}
            <button onClick={createAccount} type="button" className="rounded-2xl bg-indigo-600 px-5 py-3 text-white font-semibold hover:bg-indigo-500 transition flex items-center justify-center gap-2">
              <Plus size={16} /> Create account
            </button>
          </section>

          <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Existing users</h2>
              <p className="text-slate-400 mt-1">Manage role assignments and remove users from app access.</p>
            </div>

            {users.length === 0 ? (
              <div className="rounded-2xl bg-slate-900 p-4 text-slate-400">No users found.</div>
            ) : (
              <div className="space-y-3">
                {users.map((userItem) => (
                  <div key={userItem.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
                    <div className="grid gap-3 md:grid-cols-[1.5fr_1.2fr_auto_auto] md:items-center">
                      <div>
                        <div className="font-semibold text-slate-100">{userItem.displayName || 'Unnamed user'}</div>
                        <div className="text-slate-400 text-sm">{userItem.email || 'No email'}</div>
                        <div className="text-slate-500 text-xs mt-1">UID: {userItem.uid || userItem.id}</div>
                      </div>

                      <select
                        value={userRoleEdits[userItem.id] || userItem.role || 'client'}
                        onChange={(e) => setUserRoleEdits((prev) => ({ ...prev, [userItem.id]: e.target.value }))}
                        disabled={userItem.id === (profile?.uid || profile?.id) || !!savedRoles[userItem.id]}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-slate-100"
                      >
                        <option value="admin">Admin</option>
                        <option value="tech">Technician</option>
                        <option value="client">Client</option>
                      </select>

                      {savedRoles[userItem.id] ? (
                        <button
                          type="button"
                          onClick={() => setSavedRoles((prev) => ({ ...prev, [userItem.id]: false }))}
                          className="rounded-2xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500 transition"
                        >
                          Edit role
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateUserRole(userItem)}
                          disabled={userItem.id === (profile?.uid || profile?.id)}
                          className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Save role
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => deleteUser(userItem.id, userItem.role)}
                        disabled={userItem.id === (profile?.uid || profile?.id)}
                        className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
              </>
            )}
          </section>
          </>
        )}

        <section className="grid gap-4">
          <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Active jobs</h2>
              <p className="text-slate-400 text-sm mt-1">Jobs currently in progress or awaiting dispatch.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowJobsPanel((prev) => !prev)}
              className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
            >
              {showJobsPanel ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {showJobsPanel && (
          <div className="grid gap-6">
          {loading ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs…</div>
          ) : activeJobs.length === 0 ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">No active jobs.</div>
          ) : (
            <div className="space-y-6">
              {activeJobs.map((job) => {
                const total = calcInvoiceTotal(job.consumables || [], job.serviceFee);
                const beforeReady = Boolean(job.beforePhotoUrl);
                const afterReady = Boolean(job.afterPhotoUrl);
                const canRequestSignoff = profile.role === 'tech' && job.status === 'Dispatched' && beforeReady && afterReady;
                const canClientSignoff = profile.role === 'client' && job.status === 'Ready for Signoff' && !job.clientSignedOff;

                return (
                  <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400 mb-3">
                          <span className={`inline-flex rounded-full px-3 py-1 ${job.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-300' : job.status === 'Ready for Signoff' ? 'bg-orange-500/10 text-orange-300' : 'bg-blue-500/10 text-blue-300'}`}>
                            {job.status}
                          </span>
                          {profile.role === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setEditingJobId((prev) => prev === job.id ? null : job.id)}
                              className="ml-2 inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 transition"
                            >
                              <Wrench size={12} /> {editingJobId === job.id ? 'Cancel edit' : 'Edit details'}
                            </button>
                          )}
                        </div>
                        {editingJobId === job.id ? (
                          <div className="grid gap-3 mt-2">
                            <input value={jobEdits[job.id]?.client ?? job.client ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], client: e.target.value } }))} placeholder="Client name" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                            <input value={jobEdits[job.id]?.clientPhone ?? job.clientPhone ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], clientPhone: e.target.value } }))} placeholder="Client phone" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                            <input value={jobEdits[job.id]?.clientEmail ?? job.clientEmail ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], clientEmail: e.target.value } }))} placeholder="Client email" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                            <input value={jobEdits[job.id]?.location ?? job.rawLocation ?? job.location ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], location: e.target.value, rawLocation: e.target.value } }))} placeholder="Location" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                            <input value={jobEdits[job.id]?.task ?? job.task ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], task: e.target.value } }))} placeholder="Service / task" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                            <input value={jobEdits[job.id]?.serialNumber ?? job.serialNumber ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], serialNumber: e.target.value } }))} placeholder="Serial number" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 font-mono" />
                            <input value={jobEdits[job.id]?.details ?? job.details ?? ''} onChange={(e) => setJobEdits((prev) => ({ ...prev, [job.id]: { ...prev[job.id], details: e.target.value } }))} placeholder="Fault / details" className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
                            <button type="button" onClick={() => saveJobEdits(job)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition">Save changes</button>
                          </div>
                        ) : (
                          <>
                            <h2 className="text-xl font-semibold text-white">{job.client}</h2>
                            <p className="text-slate-400 mt-2">{job.location}</p>
                            <p className="text-slate-300 mt-3">{job.task}</p>
                            {job.serialNumber && (
                              <p className="text-slate-300 mt-2 font-mono text-sm">S/N: <span className="text-amber-300">{job.serialNumber}</span></p>
                            )}
                            {job.details && <p className="text-slate-400 mt-2">{job.details}</p>}
                          </>
                        )}
                      </div>
                      <div className="space-y-2 text-right">
                        <div className="text-slate-400 text-sm">Assigned tech</div>
                        <div className="font-semibold">{job.assignedTechName || 'Unassigned'}</div>
                        {(job.assignedTechDistanceMiles ?? job.assignedTechDistanceKm) != null && (
                          <div className="text-slate-400 text-sm">{(job.assignedTechDistanceMiles ?? job.assignedTechDistanceKm).toFixed(1)} mi away</div>
                        )}
                        {job.scheduledFor && (
                          <div>
                            <div className="text-slate-400 text-sm mt-3">Scheduled for</div>
                            <div className="text-amber-300 text-sm font-semibold">{formatDate(job.scheduledFor)}</div>
                          </div>
                        )}
                        <div className="text-slate-400 text-sm mt-3">Created</div>
                        <div className="text-slate-200 text-sm">{formatDate(job.createdAt)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                      <div className="rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
                        <div className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em] mb-4"><Camera size={16} /> Job photos</div>
                        <div className="grid gap-3">
                          <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                            <div className="text-slate-300 text-sm mb-2">Before photo</div>
                            {job.beforePhotoUrl ? (
                              <img src={job.beforePhotoUrl} alt="Before" className="w-full rounded-2xl object-cover" />
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No photo yet</div>
                            )}
                            {['tech', 'admin'].includes(profile.role) && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <label htmlFor={`before-cam-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                  <Camera size={15} /> {job.beforePhotoUrl ? 'Retake' : 'Take photo'}
                                </label>
                                <input id={`before-cam-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job.id, 'before')} />
                                <label htmlFor={`before-file-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                  <Plus size={15} /> {job.beforePhotoUrl ? 'Replace from gallery' : 'From gallery'}
                                </label>
                                <input id={`before-file-${job.id}`} type="file" className="hidden" accept="image/*" onChange={(e) => handlePhotoUpload(e, job.id, 'before')} />
                                {job.beforePhotoUrl && (
                                  <button type="button" onClick={() => deletePhoto(job.id, 'before')} className="inline-flex items-center gap-2 rounded-2xl border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300 hover:bg-red-900/50 transition">
                                    <Trash2 size={15} /> Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                            <div className="text-slate-300 text-sm mb-2">After photo</div>
                            {job.afterPhotoUrl ? (
                              <img src={job.afterPhotoUrl} alt="After" className="w-full rounded-2xl object-cover" />
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No photo yet</div>
                            )}
                            {['tech', 'admin'].includes(profile.role) && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <label htmlFor={`after-cam-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                  <Camera size={15} /> {job.afterPhotoUrl ? 'Retake' : 'Take photo'}
                                </label>
                                <input id={`after-cam-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job.id, 'after')} />
                                <label htmlFor={`after-file-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                  <Plus size={15} /> {job.afterPhotoUrl ? 'Replace from gallery' : 'From gallery'}
                                </label>
                                <input id={`after-file-${job.id}`} type="file" className="hidden" accept="image/*" onChange={(e) => handlePhotoUpload(e, job.id, 'after')} />
                                {job.afterPhotoUrl && (
                                  <button type="button" onClick={() => deletePhoto(job.id, 'after')} className="inline-flex items-center gap-2 rounded-2xl border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300 hover:bg-red-900/50 transition">
                                    <Trash2 size={15} /> Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
                        <div className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em] mb-4"><List size={16} /> Consumables</div>
                        <div className="space-y-3">
                          {(job.consumables || []).length === 0 ? (
                            <div className="text-slate-500">No consumables yet.</div>
                          ) : (
                            <div className="space-y-2">
                              {job.consumables.map((item, index) => {
                                const edit = consumableEdits[job.id]?.[index] || {};
                                const itemDescription = edit.description ?? item.description;
                                const itemQty = edit.qty ?? item.qty;
                                const itemUnitPrice = edit.unitPrice ?? item.unitPrice;
                                return (
                                  <div key={`${job.id}-${index}`} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                                    <div className="flex flex-col gap-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          {job.invoiceSent ? (
                                            <p className="text-slate-100">{item.description}</p>
                                          ) : (
                                            <input
                                              value={itemDescription}
                                              onChange={(e) => updateConsumableField(job.id, index, 'description', e.target.value)}
                                              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                            />
                                          )}
                                          <p className="text-slate-500 text-sm">Qty: {itemQty}</p>
                                        </div>
                                        {canViewInvoice ? (
                                          <div className="text-right text-slate-200">
                                            <div>${Number(itemUnitPrice).toFixed(2)} each</div>
                                            <div className="text-slate-400 text-sm">${(Number(itemQty) * Number(itemUnitPrice)).toFixed(2)}</div>
                                          </div>
                                        ) : (
                                          <div className="text-slate-400 text-sm">Amount hidden</div>
                                        )}
                                      </div>
                                      {!job.invoiceSent && ['tech', 'admin'].includes(profile.role) && (
                                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                                          <input
                                            type="number"
                                            min="1"
                                            value={itemQty}
                                            onChange={(e) => updateConsumableField(job.id, index, 'qty', e.target.value)}
                                            className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                          />
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={itemUnitPrice}
                                            onChange={(e) => updateConsumableField(job.id, index, 'unitPrice', e.target.value)}
                                            className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                          />
                                          <button
                                            onClick={() => saveConsumableChange(job, index)}
                                            className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition"
                                          >
                                            Save
                                          </button>
                                        </div>
                                      )}
                                      {!job.invoiceSent && ['tech', 'admin'].includes(profile.role) && (
                                        <button
                                          onClick={() => deleteConsumable(job, index)}
                                          className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition"
                                        >
                                          Delete
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {['tech', 'admin'].includes(profile.role) && (
                          <div className="mt-4 space-y-3">
                            <input
                              value={newConsumable.description}
                              onChange={(e) => setNewConsumable((prev) => ({ ...prev, description: e.target.value }))}
                              placeholder="Item description"
                              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                            />
                            <div className="grid grid-cols-2 gap-3">
                              <input
                                type="number"
                                min="1"
                                value={newConsumable.qty}
                                onChange={(e) => setNewConsumable((prev) => ({ ...prev, qty: e.target.value }))}
                                placeholder="Qty"
                                className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                              />
                              <input
                                type="number"
                                min="0"
                                value={newConsumable.unitPrice}
                                onChange={(e) => setNewConsumable((prev) => ({ ...prev, unitPrice: e.target.value }))}
                                placeholder="Unit price"
                                className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                              />
                            </div>
                            <button onClick={() => addConsumable(job)} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 transition flex items-center justify-center gap-2">
                              <Plus size={16} /> Add consumable
                            </button>
                          </div>
                        )}
                        {(job.serviceFee || job.serviceFee === 0) && profile?.role !== 'tech' && (
                          <div className="mt-4 rounded-2xl bg-slate-900 p-3 border border-slate-700 text-slate-200">
                            <div className="text-slate-400 text-sm">Service fee</div>
                            <div className="font-semibold text-slate-100">${Number(job.serviceFee || 0).toFixed(2)}</div>
                            {job.serviceFeeDescription && (
                              <div className="text-slate-400 text-sm mt-2">{job.serviceFeeDescription}</div>
                            )}
                          </div>
                        )}
                        {!job.invoiceSent && profile?.role === 'admin' && (
                          <div className="mt-4 space-y-3">
                            <div className="text-slate-400 text-sm">Admin service management</div>
                            <input
                              type="text"
                              value={serviceFeeInputs[job.id]?.description ?? job.serviceFeeDescription ?? ''}
                              onChange={(e) => setServiceFeeInputs((prev) => ({
                                ...prev,
                                [job.id]: {
                                  ...prev[job.id],
                                  description: e.target.value,
                                },
                              }))}
                              placeholder="Service fee description"
                              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={serviceFeeInputs[job.id]?.amount ?? (job.serviceFee != null ? String(job.serviceFee) : '')}
                              onChange={(e) => setServiceFeeInputs((prev) => ({
                                ...prev,
                                [job.id]: {
                                  ...prev[job.id],
                                  amount: e.target.value,
                                },
                              }))}
                              placeholder="Service fee amount"
                              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <button onClick={() => addServiceFee(job)} className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-white font-semibold hover:bg-violet-500 transition flex items-center justify-center gap-2">
                                <Plus size={16} /> Add / update service fee
                              </button>
                              <button onClick={() => deleteServiceFee(job)} className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-white font-semibold hover:bg-rose-500 transition">
                                Delete service fee
                              </button>
                            </div>
                          </div>
                        )}
                        {canViewInvoice && (
                          <div className="mt-4 rounded-2xl bg-slate-900 p-4 border border-slate-700">
                            <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                              <span>Total</span>
                              <span className="font-semibold text-slate-100">${total.toFixed(2)}</span>
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                              {job.status !== 'Pending' && (
                                profile.role === 'admin' || job.adminSignedOff ? (
                                  <button onClick={() => generateInvoicePdf(job)} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition">
                                    Download invoice
                                  </button>
                                ) : null
                              )}
                            </div>
                          </div>
                        )}
                        {profile.role === 'admin' && job.status !== 'Completed' && (
                          <div className="mt-4 rounded-2xl bg-slate-950/80 border border-slate-700 p-4">
                            <div className="text-slate-400 text-sm mb-3">Assign or reassign technician</div>
                            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                              <select
                                value={assignments[job.id] || ''}
                                onChange={(e) => setAssignments((prev) => ({ ...prev, [job.id]: e.target.value }))}
                                className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                              >
                                <option value="">Select technician</option>
                                {techs.map((tech) => (
                                  <option key={tech.id} value={tech.id}>
                                    {tech.name} {tech.status === 'busy' ? '(busy)' : '(available)'}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => assignTechnicianToJob(job)}
                                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition"
                              >
                                Assign / Reassign
                              </button>
                            </div>
                            <div className="text-slate-500 text-xs mt-2">Use this to assign or reassign the job when auto-dispatch does not match the field requirements.</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2 text-slate-400 text-sm">
                        {job.clientPhone && <div>Phone: {job.clientPhone}</div>}
                        {job.clientEmail && <div>Email: {job.clientEmail}</div>}
                        {job.checkInAt && <div>Check-in: {formatDate(job.checkInAt)} ({Number(job.checkInLat || 0).toFixed(5)}, {Number(job.checkInLng || 0).toFixed(5)})</div>}
                        {(job.breaks || []).map((brk, idx) => {
                          const durationMs = brk.endAt
                            ? (brk.endAt?.toDate ? brk.endAt.toDate() : new Date(brk.endAt)) - (brk.startAt?.toDate ? brk.startAt.toDate() : new Date(brk.startAt))
                            : null;
                          const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                          const short = durationMin != null && durationMin < 30;
                          return (
                            <div key={idx} className={short ? 'text-red-400' : ''}>
                              Break {idx + 1}: out {formatDate(brk.startAt)}{brk.endAt ? ` → back ${formatDate(brk.endAt)} (${durationMin} min${short ? ' ⚠ under 30 min' : ''})` : ' — on break'}
                            </div>
                          );
                        })}
                        {job.checkOutAt && <div>Check-out: {formatDate(job.checkOutAt)} ({Number(job.checkOutLat || 0).toFixed(5)}, {Number(job.checkOutLng || 0).toFixed(5)})</div>}
                        {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                        {job.adminSignedOff && <div className="text-teal-300">Admin signed off{job.adminSignedOffAt ? ` · ${formatDate(job.adminSignedOffAt)}` : ''}</div>}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {profile.role === 'tech' && !job.checkInAt && (
                          <button
                            onClick={() => recordTechGeoEvent(job, 'checkIn')}
                            disabled={geoEventBusyJobId === job.id}
                            className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition flex items-center gap-2 disabled:opacity-60"
                          >
                            <MapPin size={16} /> {geoEventBusyJobId === job.id ? 'Checking in...' : 'Check in on site'}
                          </button>
                        )}
                        {profile.role === 'tech' && job.checkInAt && !job.checkOutAt && (() => {
                          const hasActiveBreak = (job.breaks || []).some(b => b.startAt && !b.endAt);
                          return hasActiveBreak ? (
                            <button
                              onClick={() => recordTechGeoEvent(job, 'breakEnd')}
                              disabled={geoEventBusyJobId === job.id}
                              className="rounded-2xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition flex items-center gap-2 disabled:opacity-60"
                            >
                              <Clock size={16} /> {geoEventBusyJobId === job.id ? 'Clocking in...' : 'Clock back in from break'}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => recordTechGeoEvent(job, 'breakStart')}
                                disabled={geoEventBusyJobId === job.id}
                                className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition flex items-center gap-2 disabled:opacity-60"
                              >
                                <Clock size={16} /> {geoEventBusyJobId === job.id ? 'Clocking out...' : 'Start meal break'}
                              </button>
                              <button
                                onClick={() => recordTechGeoEvent(job, 'checkOut')}
                                disabled={geoEventBusyJobId === job.id}
                                className="rounded-2xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 transition flex items-center gap-2 disabled:opacity-60"
                              >
                                <MapPin size={16} /> {geoEventBusyJobId === job.id ? 'Checking out...' : 'Check out from site'}
                              </button>
                            </>
                          );
                        })()}
                        {profile.role === 'tech' && canRequestSignoff && (
                          <button onClick={() => requestClientSignoff(job)} className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition flex items-center gap-2">
                            <FileText size={16} /> Request sign-off
                          </button>
                        )}
                        {profile.role === 'client' && canClientSignoff && (
                          <button onClick={() => handleClientSignoff(job)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition flex items-center gap-2">
                            <CheckCircle size={16} /> Sign off work
                          </button>
                        )}
                        {profile.role === 'admin' && job.status === 'Completed' && !job.adminSignedOff && (
                          <button onClick={() => adminSignOffWork(job)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition flex items-center gap-2">
                            <Shield size={16} /> Sign off work
                          </button>
                        )}
                        {profile.role === 'admin' && job.adminSignedOff && (
                          <div className="rounded-2xl bg-teal-500/10 px-4 py-2 text-sm text-teal-200 flex items-center gap-2"><Shield size={14} /> Admin signed off</div>
                        )}
                        {profile.role === 'admin' && (
                          <button onClick={() => handleDelete(job.id)} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition flex items-center gap-2">
                            <Trash2 size={16} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
          )}
        </section>

        <section className="grid gap-4">
          <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Completed jobs</h2>
              <p className="text-slate-400 text-sm mt-1">Jobs that have been signed off and closed.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCompletedJobsPanel((prev) => !prev)}
              className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
            >
              {showCompletedJobsPanel ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {showCompletedJobsPanel && (
            <div className="grid gap-6">
              {loading ? (
                <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs…</div>
              ) : completedJobs.length === 0 ? (
                <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">No completed jobs yet.</div>
              ) : (
                <div className="space-y-6">
                  {completedJobs.map((job) => (
                    <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400 mb-3">
                            <span className="inline-flex rounded-full px-3 py-1 bg-emerald-500/10 text-emerald-300">{job.status}</span>
                          </div>
                          <h2 className="text-xl font-semibold text-white">{job.client}</h2>
                          <p className="text-slate-400 mt-2">{job.location}</p>
                          <p className="text-slate-300 mt-3">{job.task}</p>
                          {job.serialNumber && <p className="text-slate-300 mt-2 font-mono text-sm">S/N: <span className="text-amber-300">{job.serialNumber}</span></p>}
                          {job.details && <p className="text-slate-400 mt-2">{job.details}</p>}
                        </div>
                        <div className="space-y-2 text-right">
                          <div className="text-slate-400 text-sm">Assigned tech</div>
                          <div className="font-semibold">{job.assignedTechName || 'Unassigned'}</div>
                          <div className="text-slate-400 text-sm mt-3">Completed</div>
                          <div className="text-slate-200 text-sm">{formatDate(job.completedAt || job.createdAt)}</div>
                        </div>
                      </div>
                      {(job.beforePhotoUrl || job.afterPhotoUrl) && (
                        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {job.beforePhotoUrl && (
                            <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                              <div className="text-slate-300 text-sm mb-2">Before photo</div>
                              <img src={job.beforePhotoUrl} alt="Before" className="w-full rounded-2xl object-cover" />
                            </div>
                          )}
                          {job.afterPhotoUrl && (
                            <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                              <div className="text-slate-300 text-sm mb-2">After photo</div>
                              <img src={job.afterPhotoUrl} alt="After" className="w-full rounded-2xl object-cover" />
                            </div>
                          )}
                        </div>
                      )}
                      {canViewInvoice && (
                        <div className="mt-6 rounded-2xl bg-slate-900 p-4 border border-slate-700">
                          <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                            <span>Total</span>
                            <span className="font-semibold text-slate-100">${calcInvoiceTotal(job.consumables || [], job.serviceFee).toFixed(2)}</span>
                          </div>
                          {(profile.role === 'admin' || job.adminSignedOff) && (
                            <button onClick={() => generateInvoicePdf(job)} className="mt-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition">
                              Download invoice
                            </button>
                          )}
                        </div>
                      )}
                      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-2 text-slate-400 text-sm">
                          {job.clientPhone && <div>Phone: {job.clientPhone}</div>}
                          {job.clientEmail && <div>Email: {job.clientEmail}</div>}
                          {job.checkInAt && <div>Check-in: {formatDate(job.checkInAt)}</div>}
                          {job.checkOutAt && <div>Check-out: {formatDate(job.checkOutAt)}</div>}
                          {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                          {job.adminSignedOff && <div className="text-teal-300">Admin signed off{job.adminSignedOffAt ? ` · ${formatDate(job.adminSignedOffAt)}` : ''}</div>}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {profile.role === 'admin' && !job.adminSignedOff && (
                            <button onClick={() => adminSignOffWork(job)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition flex items-center gap-2">
                              <Shield size={16} /> Sign off work
                            </button>
                          )}
                          {profile.role === 'admin' && job.adminSignedOff && (
                            <div className="rounded-2xl bg-teal-500/10 px-4 py-2 text-sm text-teal-200 flex items-center gap-2"><Shield size={14} /> Admin signed off</div>
                          )}
                          {profile.role === 'admin' && (
                            <button onClick={() => handleDelete(job.id)} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition flex items-center gap-2">
                              <Trash2 size={16} /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
