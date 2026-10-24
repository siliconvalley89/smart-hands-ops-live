import React, { useState, useEffect, useRef } from 'react';
import { db, storage, auth, messaging, VAPID_KEY } from './firebase';
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, updateDoc, getDocs, getDoc, setDoc, where, limit, getCountFromServer, writeBatch, arrayUnion, deleteField } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getToken } from 'firebase/messaging';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import logoPath from './assets/sv-smart-dispatch-logo.jpg';
import { toMillis, isJobDispatched, isJobAssigned, getJobStatusLabel, formatSchedule, findTechConflict } from './lib/jobTime';
import { calculateDistanceMiles } from './lib/geo';
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_ACCEPT, PHOTO_MAX_DIMENSION, PHOTO_JPEG_QUALITY, downloadPhotoFile, formatFileSize, fileToSquareDataUrl, compressPhotoForUpload } from './lib/media';
import { prepareBadge, generateBadgePdf } from './lib/badge';
import { calcInvoiceTotal, generateInvoicePdf } from './lib/invoice';
import { getReceivableStatus } from './lib/payments';
import Receivables from './features/Receivables';
import { BUSINESS_NAME, APP_DISPLAY_NAME } from './lib/branding';
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
  Download,
} from 'lucide-react';

const formatDate = (value) => {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString();
  return new Date(value).toLocaleString();
};

// Returns all photo URLs for a job, including the legacy single-photo field.
const isFieldRole = (role) => role === 'tech' || role === 'seniorConsultant';

const getJobPhotos = (job, type) => {
  const list = Array.isArray(job?.[`${type}Photos`]) ? job[`${type}Photos`] : [];
  const legacy = job?.[`${type}PhotoUrl`];
  return legacy && !list.includes(legacy) ? [legacy, ...list] : list;
};

const MIN_CHECKOUT_BREAK_MS = 30 * 60 * 1000;
const LONG_SHIFT_MS = 5 * 60 * 60 * 1000;

const getCheckoutBlockReason = (job) => {
  if (getJobPhotos(job, 'after').length === 0) return 'Upload at least one after photo before checking out.';
  if (job.checkInAt && Date.now() - toMillis(job.checkInAt) >= LONG_SHIFT_MS) {
    const hasLongBreak = (job.breaks || []).some((b) => b.startAt && b.endAt && toMillis(b.endAt) - toMillis(b.startAt) >= MIN_CHECKOUT_BREAK_MS);
    if (!hasLongBreak) return 'After 5 hours on site, take a 30-minute break before checking out.';
  }
  return '';
};

const TechNameWithPhoto = ({ job, techs }) => {
  const tech = (techs || []).find((t) => t.email && t.email === job.assignedTechEmail);
  const photo = tech?.profilePhotoUrl;
  return (
    <div className="flex items-center justify-end gap-2">
      {job.assignedTechName && (photo ? (
        <img src={photo} alt={job.assignedTechName} className="h-9 w-9 rounded-full object-cover ring-2 ring-slate-600" />
      ) : (
        <div className="h-9 w-9 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center text-sm font-semibold">
          {job.assignedTechName.trim().charAt(0).toUpperCase()}
        </div>
      ))}
      <div className="font-semibold">{job.assignedTechName || 'Unassigned'}</div>
    </div>
  );
};


const legalContent = {
  terms: {
    title: 'Terms and Conditions',
    body: 'Use of SV Smart Aide is subject to these terms. You agree to provide accurate request and account information, keep your login credentials secure, and use the service only for lawful business purposes. Service availability, scheduling, pricing, and job completion are subject to confirmation by Silicon Valley Smart Hands LLC.',
  },
  sms: {
    title: 'SMS Consent',
    body: 'By providing your phone number and submitting a service request, you consent to receive service-related text messages from Silicon Valley Smart Hands LLC, including scheduling updates, technician arrival notices, and job status messages. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase, and you can withdraw it at any time.',
  },
  privacy: {
    title: 'Privacy Policy',
    body: 'We collect the information needed to manage service requests, accounts, scheduling, payments, and communications. We use it to provide and improve our services, protect accounts, and communicate about requested work. We do not sell personal information. We may share information with service providers when needed to operate the service or comply with the law. Contact Silicon Valley Smart Hands LLC with privacy questions or requests.',
  },
};

function LegalFooter() {
  const [activeDocument, setActiveDocument] = useState(null);

  return (
    <>
      <footer className="border-t border-slate-700 bg-slate-950 px-4 py-6 text-center text-sm text-slate-400">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <button type="button" onClick={() => setActiveDocument('terms')} className="hover:text-white transition">Terms and Conditions</button>
          <button type="button" onClick={() => setActiveDocument('sms')} className="hover:text-white transition">SMS Consent</button>
          <button type="button" onClick={() => setActiveDocument('privacy')} className="hover:text-white transition">Privacy Policy</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">(c) {new Date().getFullYear()} {BUSINESS_NAME}</p>
      </footer>

      {activeDocument && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={() => setActiveDocument(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-document-title"
            className="w-full max-w-2xl rounded-3xl border border-slate-700 bg-slate-900 p-6 text-left shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="legal-document-title" className="text-xl font-bold text-white">{legalContent[activeDocument].title}</h2>
              <button type="button" onClick={() => setActiveDocument(null)} className="text-slate-400 hover:text-white" aria-label="Close legal document">Close</button>
            </div>
            <p className="mt-5 leading-7 text-slate-300">{legalContent[activeDocument].body}</p>
          </section>
        </div>
      )}
    </>
  );
}

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
  const [confirmDialog, setConfirmDialog] = useState(null);
  const askConfirm = (message, confirmLabel = 'Delete') => new Promise((resolve) => {
    setConfirmDialog({ message, confirmLabel, resolve });
  });
  const closeConfirm = (result) => {
    confirmDialog?.resolve(result);
    setConfirmDialog(null);
  };
  const [jobs, setJobs] = useState([]);
  const [jobBilling, setJobBilling] = useState({});
  const [jobPayments, setJobPayments] = useState({});
  const [jobConsumables, setJobConsumables] = useState({});
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [uploadingFilesId, setUploadingFilesId] = useState(null);
  const [requestForm, setRequestForm] = useState({ name: '', email: '', phone: '', location: '', service: '', details: '', serialNumber: '', scheduledFor: '', scheduledEndTime: '' });
  const [requestSuccess, setRequestSuccess] = useState('');
  const [requestError, setRequestError] = useState('');
  const [newConsumable, setNewConsumable] = useState({ description: '', qty: 1, unitPrice: '' });
  const [serviceFeeInputs, setServiceFeeInputs] = useState({});
  const [consumableEdits, setConsumableEdits] = useState({});
  const [newAccount, setNewAccount] = useState({ name: '', email: '', password: '', role: 'tech', phone: '', location: '', adminPassword: '' });
  const [accountMessage, setAccountMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const [assignments, setAssignments] = useState({});
  const [users, setUsers] = useState([]);
  const [userRoleEdits, setUserRoleEdits] = useState({});
  const [showAddUserPanel, setShowAddUserPanel] = useState(false);
  const [showUsersPanel, setShowUsersPanel] = useState(false);
  const [expandedJobIds, setExpandedJobIds] = useState([]);
  const [completedJobsData, setCompletedJobsData] = useState([]);
  const [completedLimit, setCompletedLimit] = useState(25);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [showJobsPanel, setShowJobsPanel] = useState(false);
  const [showReceivablesPanel, setShowReceivablesPanel] = useState(false);
  const [showCompletedJobsPanel, setShowCompletedJobsPanel] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState('All');
  const [completedSearch, setCompletedSearch] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');
  const [showResetForm, setShowResetForm] = useState(false);
  const [profilePhotoUploadBusy, setProfilePhotoUploadBusy] = useState(false);
  const [badgeViewUrl, setBadgeViewUrl] = useState(null);
  const [geoEventBusyJobId, setGeoEventBusyJobId] = useState(null);
  const [sessionRestoreCount, setSessionRestoreCount] = useState(0);
  const [savedRoles, setSavedRoles] = useState({});
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState(null);
  const [jobEdits, setJobEdits] = useState({});
  const [verifyMessage, setVerifyMessage] = useState('');
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
  }, []);

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
    if (!profile?.role) {
      setJobs([]);
      setLoading(false);
      return () => {};
    }

    setLoading(true);

    // Only open jobs are streamed live; completed jobs are loaded on demand in pages
    let jobsQuery;
    // Security rules cannot be evaluated per-document for list queries, so tech/assistant queries must filter on billingMigrated
    if (profile.role === 'admin') {
      jobsQuery = query(collection(db, 'jobs'), where('status', '!=', 'Completed'));
    } else if (profile.role === 'adminAssistant') {
      jobsQuery = query(collection(db, 'jobs'), where('billingMigrated', '==', true), where('status', '!=', 'Completed'));
    } else if (isFieldRole(profile.role)) {
      jobsQuery = query(collection(db, 'jobs'), where('assignedTechEmail', '==', profile.email || firebaseUser?.email || ''), where('billingMigrated', '==', true), where('status', '!=', 'Completed'));
    } else {
      jobsQuery = query(collection(db, 'jobs'), where('clientEmail', '==', profile.email || firebaseUser?.email || ''), where('status', '!=', 'Completed'));
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
  }, [profile?.role, profile?.email, firebaseUser?.email, sessionRestoreCount]);

  const COMPLETED_PAGE_SIZE = 25;
  const scopedCompletedConstraints = () => {
    const email = profile?.email || firebaseUser?.email || '';
    if (isFieldRole(profile?.role)) return [where('assignedTechEmail', '==', email), where('billingMigrated', '==', true), where('status', '==', 'Completed')];
    if (profile?.role === 'client') return [where('clientEmail', '==', email), where('status', '==', 'Completed')];
    return [where('status', '==', 'Completed')];
  };

  // Closed-jobs total via a cheap server-side count; refreshed whenever the open set changes size
  useEffect(() => {
    if (!profile?.role || profile.role === 'adminAssistant') return;
    getCountFromServer(query(collection(db, 'jobs'), ...scopedCompletedConstraints()))
      .then((snap) => setCompletedTotal(snap.data().count))
      .catch((error) => console.error('Unable to count completed jobs', error));
  }, [profile?.role, profile?.email, firebaseUser?.email, jobs.length]);

  // Completed jobs: subscribe only while the panel is expanded, newest first, one page at a time
  useEffect(() => {
    if (!profile?.role || profile.role === 'adminAssistant' || !showCompletedJobsPanel) return () => {};
    setCompletedLoading(true);
    const completedQuery = query(
      collection(db, 'jobs'),
      ...scopedCompletedConstraints(),
      orderBy('createdAt', 'desc'),
      limit(completedLimit),
    );
    const unsubscribe = onSnapshot(
      completedQuery,
      (snapshot) => {
        setCompletedJobsData(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
        setCompletedLoading(false);
      },
      (error) => {
        console.error('Unable to load completed jobs', error);
        setCompletedLoading(false);
      }
    );
    return () => unsubscribe();
  }, [profile?.role, profile?.email, firebaseUser?.email, showCompletedJobsPanel, completedLimit, sessionRestoreCount]);

  const observedJobIds = [...new Set([...jobs, ...completedJobsData].map((job) => job.id))].sort();
  const observedJobIdsKey = observedJobIds.join('|');

  useEffect(() => {
    if (!profile?.role) return () => {};
    const jobIds = observedJobIdsKey ? observedJobIdsKey.split('|') : [];
    const subscriptions = [];
    setJobBilling({});
    setJobPayments({});
    setJobConsumables({});

    jobIds.forEach((jobId) => {
      subscriptions.push(onSnapshot(
        collection(db, 'jobs', jobId, 'consumables'),
        (snapshot) => {
          setJobConsumables((prev) => ({
            ...prev,
            [jobId]: snapshot.docs.map((itemDoc) => ({ ...itemDoc.data(), id: itemDoc.id })),
          }));
        },
        (error) => {
          console.error(`Unable to load consumables for job ${jobId}`, error);
          // Access is lost when a job is reassigned or completed; the jobs listener removes it shortly after
          if (error?.code === 'permission-denied') {
            setJobConsumables((prev) => ({ ...prev, [jobId]: [] }));
            return;
          }
          if (!suppressAuthStateRef.current) setAppError('Unable to load job consumables.');
        },
      ));

      if (profile.role === 'admin' || profile.role === 'client') {
        subscriptions.push(onSnapshot(
          doc(db, 'jobBilling', jobId),
          (snapshot) => {
            setJobBilling((prev) => ({
              ...prev,
              [jobId]: snapshot.exists() ? snapshot.data() : {},
            }));
          },
          (error) => {
            console.error(`Unable to load billing data for job ${jobId}`, error);
            if (!suppressAuthStateRef.current) setAppError('Unable to load job billing data.');
          },
        ));

        subscriptions.push(onSnapshot(
          collection(db, 'jobs', jobId, 'payments'),
          (snapshot) => {
            setJobPayments((prev) => ({
              ...prev,
              [jobId]: snapshot.docs.map((paymentDoc) => ({ ...paymentDoc.data(), id: paymentDoc.id })),
            }));
          },
          (error) => {
            console.error(`Unable to load payments for job ${jobId}`, error);
          },
        ));
      }
    });

    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [observedJobIdsKey, profile?.role, sessionRestoreCount]);

  useEffect(() => {
    const q = query(collection(db, 'technicians'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const techItems = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setTechs(techItems);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isFieldRole(profile?.role) || !profile.profilePhotoUrl || !firebaseUser?.uid) return;
    const mine = techs.find((t) => t.id === firebaseUser.uid);
    if (mine && mine.profilePhotoUrl !== profile.profilePhotoUrl) {
      updateDoc(doc(db, 'technicians', firebaseUser.uid), { profilePhotoUrl: profile.profilePhotoUrl }).catch((e) => console.warn('Tech photo sync failed', e));
    }
  }, [techs, profile?.role, profile?.profilePhotoUrl, firebaseUser?.uid]);

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

  const sendReset = async () => {
    setResetError('');
    setResetSent(false);
    if (!resetEmail.trim()) { setResetError('Enter your email address.'); return; }
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetSent(true);
    } catch (error) {
      console.error('Password reset failed', error);
      setResetError('Could not send reset email. Check the address and try again.');
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
    setShowAddUserPanel(false);
    setShowUsersPanel(false);
    setExpandedJobIds([]);
    setShowJobsPanel(false);
    setShowCompletedJobsPanel(false);
    setRequestFormOpen(false);
    await firebaseSignOut(auth);
    setProfile(null);
    setFirebaseUser(null);
  };

  const geocodeAddress = async (address) => {
    const search = async (query) => {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const results = await response.json();
      return results && results.length > 0 ? results[0] : null;
    };

    // Floor/suite/unit details confuse the geocoder, so retry without them
    const unitPattern = /[,\s]*(?:#\s*\w+|\b(?:suite|ste|unit|apt|apartment|floor|fl|room|rm|bldg|building)\b\.?\s*#?\s*\w+|\b\d+(?:st|nd|rd|th)\s+floor\b)/gi;
    const unitParts = address.match(unitPattern) || [];
    const stripped = address.replace(unitPattern, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();

    let location = await search(address);
    let unitSuffix = '';
    if (!location && stripped && stripped !== address) {
      location = await search(stripped);
      unitSuffix = unitParts.map((part) => part.replace(/^[,\s]+/, '')).join(', ');
    }
    if (!location) {
      throw new Error('Unable to locate that address.');
    }
    return {
      lat: Number(location.lat),
      lng: Number(location.lon),
      displayName: unitSuffix ? `${unitSuffix}, ${location.display_name}` : location.display_name,
    };
  };

  const findNearestTechnician = (clientLat, clientLng, targetJob) => {
    const availableTechs = techs.filter((tech) => tech.lat != null && tech.lng != null && !findTechConflict(targetJob, tech.email, jobs));
    if (availableTechs.length === 0) return null;

    return availableTechs.reduce((nearest, tech) => {
      const distanceMiles = calculateDistanceMiles(clientLat, clientLng, tech.lat, tech.lng);
      if (!nearest || distanceMiles < nearest.distanceMiles) {
        return { ...tech, distanceMiles };
      }
      return nearest;
    }, null);
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
      // Auto-assign the nearest tech with no overlapping job; techs are only marked busy once en route / on site
      const scheduledDate = requestForm.scheduledFor ? new Date(requestForm.scheduledFor) : null;
      let scheduledEndDate = null;
      if (scheduledDate && requestForm.scheduledEndTime) {
        const [h, m] = requestForm.scheduledEndTime.split(':').map(Number);
        scheduledEndDate = new Date(scheduledDate);
        scheduledEndDate.setHours(h, m, 0, 0);
        // An end time at or before the start time means the job rolls overnight into the next day
        if (scheduledEndDate <= scheduledDate) {
          scheduledEndDate.setDate(scheduledEndDate.getDate() + 1);
        }
      }
      const nearest = findNearestTechnician(geo.lat, geo.lng, { scheduledFor: scheduledDate, scheduledEnd: scheduledEndDate });
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
        scheduledFor: scheduledDate,
        scheduledEnd: scheduledEndDate,
        status: nearest ? 'Assigned' : 'Pending',
        createdByRole: profile.role,
        assignedTechName: nearest?.name || '',
        assignedTechEmail: nearest?.email || '',
        assignedTechDistanceMiles: nearest?.distanceMiles || null,
        assignedTechDistanceKm: nearest?.distanceKm || null,
        billingMigrated: true,
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
        scheduledEndTime: '',
      });
    } catch (error) {
      console.error('Submit request failed', error);
      setRequestError(error.message || 'Failed to submit request.');
    }
  };

  const createAccount = async () => {
    setAccountMessage('');
    if (!newAccount.name || !newAccount.email || !newAccount.password || !newAccount.role || !newAccount.adminPassword) {
      setAccountMessage('Please fill all required account fields, including your own password.');
      return;
    }
    if (newAccount.role === 'tech' && !newAccount.location) {
      setAccountMessage('Please enter a base location for technician accounts.');
      return;
    }
    const adminEmail = profile?.email;
    const adminPassword = newAccount.adminPassword;
    const adminUid = firebaseUser?.uid;

    // Locate the base address first so a failed lookup can't leave a half-created technician
    let techGeo = null;
    if (newAccount.role === 'tech') {
      try {
        techGeo = await geocodeAddress(newAccount.location);
      } catch (error) {
        console.error('Technician address lookup failed', error);
        setAccountMessage('Unable to locate that base address. Include the street, city, and state, then try again.');
        return;
      }
    }

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
      if (newAccount.role === 'client' || newAccount.role === 'tech') {
        await sendEmailVerification(user).catch((err) => console.warn('Verification email failed', err.message));
      }

      if (newAccount.role === 'tech') {
        await setDoc(doc(db, 'technicians', user.uid), {
          uid: user.uid,
          name: newAccount.name,
          email: newAccount.email.trim(),
          phone: newAccount.phone || '',
          location: techGeo.displayName,
          rawLocation: newAccount.location,
          lat: techGeo.lat,
          lng: techGeo.lng,
          status: 'available',
          createdAt: new Date(),
        });
      }

      await firebaseSignOut(auth);
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      // Manually restore admin state � avoids UI flicker from onAuthStateChanged
      const adminDocSnap = await getDoc(doc(db, 'users', adminUid));
      setFirebaseUser(auth.currentUser);
      if (adminDocSnap.exists()) setProfile({ id: adminDocSnap.id, ...adminDocSnap.data() });
      setAppError('');
      setSessionRestoreCount((count) => count + 1);
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
          setAppError('');
          setSessionRestoreCount((count) => count + 1);
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
    if (eventType === 'checkOut') {
      const blockReason = getCheckoutBlockReason(job);
      if (blockReason) {
        setAppError(blockReason);
        return;
      }
    }
    try {
      setGeoEventBusyJobId(job.id);
      const coords = await getCurrentCoordinates();

      // Geofence: require tech to be within 1,000 ft of the job site for check-in / check-out (admins can override per job)
      if ((eventType === 'checkIn' || eventType === 'checkOut') && job.lat != null && job.lng != null && !job.geofenceOverride) {
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
        payload.status = 'On Site';
        payload.statusUpdatedByRole = profile.role;
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

      if (isFieldRole(userItem.role) && !isFieldRole(nextRole)) {
        await deleteDoc(doc(db, 'technicians', userItem.id));
      }

      if (!isFieldRole(userItem.role) && isFieldRole(nextRole)) {
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
    if (!(await askConfirm('Are you sure you want to delete this user? This action cannot be undone.'))) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'users', userId));
      await deleteDoc(doc(db, 'badges', userId)).catch(() => {});
      if (isFieldRole(userRole)) {
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
    try {
      const itemRef = doc(collection(db, 'jobs', job.id, 'consumables'));
      const batch = writeBatch(db);
      batch.set(itemRef, {
        description: newConsumable.description,
        qty: Number(newConsumable.qty),
        createdAt: new Date(),
      });
      if (profile?.role === 'admin') {
        batch.set(doc(db, 'jobBilling', job.id), {
          consumablePrices: { [itemRef.id]: Number(newConsumable.unitPrice || 0) },
          updatedAt: new Date(),
        }, { merge: true });
      }
      await batch.commit();
      setNewConsumable({ description: '', qty: 1, unitPrice: '' });
    } catch (error) {
      console.error('Add consumable failed', error);
      setAppError('Unable to add consumable.');
    }
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
    try {
      await setDoc(doc(db, 'jobBilling', job.id), {
        serviceFee: Number(serviceInput.amount),
        serviceFeeDescription: serviceInput.description || '',
        updatedAt: new Date(),
      }, { merge: true });
      setServiceFeeInputs((prev) => ({ ...prev, [job.id]: { amount: '', description: '' } }));
    } catch (error) {
      console.error('Save service fee failed', error);
      setAppError('Unable to save service fee.');
    }
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
    if (!(await askConfirm('Are you sure you want to delete the service fee? This action cannot be undone.'))) {
      return;
    }
    try {
      await setDoc(doc(db, 'jobBilling', job.id), {
        serviceFee: 0,
        serviceFeeDescription: '',
        updatedAt: new Date(),
      }, { merge: true });
      setServiceFeeInputs((prev) => ({ ...prev, [job.id]: { amount: '', description: '' } }));
    } catch (error) {
      console.error('Delete service fee failed', error);
      setAppError('Unable to delete service fee.');
    }
  };

  const updateConsumableField = (jobId, itemId, field, value) => {
    setConsumableEdits((prev) => ({
      ...prev,
      [jobId]: {
        ...(prev[jobId] || {}),
        [itemId]: {
          ...(prev[jobId]?.[itemId] || {}),
          [field]: value,
        },
      },
    }));
  };

  const saveConsumableChange = async (job, itemId) => {
    if (job.invoiceSent) {
      setAppError('Cannot modify consumables after the invoice has been sent.');
      return;
    }
    const itemEdit = consumableEdits[job.id]?.[itemId];
    if (!itemEdit) return;
    const item = (job.consumables || []).find((line) => line.id === itemId);
    if (!item) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'jobs', job.id, 'consumables', item.id), {
        description: itemEdit.description ?? item.description,
        qty: Number(itemEdit.qty ?? item.qty),
        updatedAt: new Date(),
      });
      if (profile?.role === 'admin' && itemEdit.unitPrice != null) {
        batch.set(doc(db, 'jobBilling', job.id), {
          consumablePrices: { [item.id]: Number(itemEdit.unitPrice) },
          updatedAt: new Date(),
        }, { merge: true });
      }
      await batch.commit();
      setConsumableEdits((prev) => {
        const jobEdits = { ...(prev[job.id] || {}) };
        delete jobEdits[itemId];
        return { ...prev, [job.id]: jobEdits };
      });
    } catch (error) {
      console.error('Save consumable change failed', error);
      setAppError('Unable to save consumable changes.');
    }
  };

  const deleteConsumable = async (job, itemId) => {
    if (job.invoiceSent) {
      setAppError('Cannot delete consumables after the invoice has been sent.');
      return;
    }
    if (!(await askConfirm('Are you sure you want to delete this consumable? This action cannot be undone.'))) return;
    const item = (job.consumables || []).find((line) => line.id === itemId);
    if (!item) return;
    try {
      await deleteDoc(doc(db, 'jobs', job.id, 'consumables', item.id));
      setConsumableEdits((prev) => {
        const jobEdits = { ...(prev[job.id] || {}) };
        delete jobEdits[itemId];
        return { ...prev, [job.id]: jobEdits };
      });
    } catch (error) {
      console.error('Delete consumable failed', error);
      setAppError('Unable to delete consumable.');
    }
  };

  const requestClientSignoff = async (job) => {
    if (!job.checkInAt) {
      setAppError('You must check in on site before requesting sign-off.');
      return;
    }
    await updateDoc(doc(db, 'jobs', job.id), {
      status: 'Ready for Signoff',
      statusUpdatedByRole: profile.role,
      signoffRequestedAt: new Date(),
    });
  };

  const handleClientSignoff = async (job) => {
    await updateDoc(doc(db, 'jobs', job.id), {
      clientSignedOff: true,
      status: 'Completed',
      statusUpdatedByRole: profile.role,
      completedAt: new Date(),
    });
  };

  const handlePhotoUpload = async (event, job, type) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    // Reset the input so the same files can be re-selected
    event.target.value = '';
    const jobId = job.id;
    try {
      setUploadingId(jobId);
      const results = await Promise.allSettled(files.map(async (file, i) => {
        const upload = await compressPhotoForUpload(file);
        const safeName = upload.name.replace(/[^\w.-]/g, '_');
        const storageRef = ref(storage, `jobs/${jobId}/${type}-${Date.now()}-${i}-${safeName}`);
        await uploadBytes(storageRef, upload);
        return getDownloadURL(storageRef);
      }));
      const urls = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (urls.length) {
        // Re-read the latest job so concurrent uploads aren't overwritten
        const snap = await getDoc(doc(db, 'jobs', jobId));
        const current = snap.exists() ? snap.data() : job;
        await updateDoc(doc(db, 'jobs', jobId), {
          [`${type}Photos`]: [...getJobPhotos(current, type), ...urls],
          [`${type}PhotoUrl`]: '',
          updatedAt: new Date(),
        });
      }
      if (urls.length < files.length) setAppError(`${files.length - urls.length} photo(s) failed to upload.`);
    } catch (error) {
      console.error('Photo upload failed', error);
      setAppError('Photo upload failed.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleAttachmentUpload = async (event, job) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const tooBig = files.filter((f) => f.size >= MAX_ATTACHMENT_BYTES);
    const valid = files.filter((f) => f.size < MAX_ATTACHMENT_BYTES);
    if (tooBig.length) setAppError(`Skipped ${tooBig.length} file(s) over 10 MB.`);
    if (!valid.length) return;
    try {
      setUploadingFilesId(job.id);
      const results = await Promise.allSettled(valid.map(async (file, i) => {
        const safeName = file.name.replace(/[^\w.-]/g, '_');
        const storageRef = ref(storage, `jobs/${job.id}/file-${Date.now()}-${i}-${safeName}`);
        await uploadBytes(storageRef, file);
        return { name: file.name, url: await getDownloadURL(storageRef), size: file.size, type: file.type || '' };
      }));
      const uploaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (uploaded.length) {
        const snap = await getDoc(doc(db, 'jobs', job.id));
        const current = snap.exists() ? snap.data() : job;
        await updateDoc(doc(db, 'jobs', job.id), {
          attachments: [...(current.attachments || []), ...uploaded],
          updatedAt: new Date(),
        });
      }
      if (uploaded.length < valid.length) setAppError(`${valid.length - uploaded.length} file(s) failed to upload.`);
    } catch (error) {
      console.error('File upload failed', error);
      setAppError('File upload failed.');
    } finally {
      setUploadingFilesId(null);
    }
  };

  const deleteAttachment = async (job, file) => {
    if (!(await askConfirm(`Delete "${file.name}"? This action cannot be undone.`))) return;
    try {
      const snap = await getDoc(doc(db, 'jobs', job.id));
      const current = snap.exists() ? snap.data() : job;
      await updateDoc(doc(db, 'jobs', job.id), {
        attachments: (current.attachments || []).filter((a) => a.url !== file.url),
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('Delete file failed', error);
      setAppError('Unable to delete file.');
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
      const profilePhotoData = await fileToSquareDataUrl(file, 400);
      await updateDoc(doc(db, 'users', firebaseUser.uid), { profilePhotoUrl: url, profilePhotoData });
      setProfile((prev) => ({ ...prev, profilePhotoUrl: url, profilePhotoData }));
      if (isFieldRole(profile?.role)) {
        // Mirror to the technicians doc so clients can see the photo
        await updateDoc(doc(db, 'technicians', firebaseUser.uid), { profilePhotoUrl: url }).catch((e) => console.warn('Tech photo sync failed', e));
      }
    } catch (error) {
      console.error('Profile photo upload failed', error);
      setAppError('Profile photo upload failed.');
    } finally {
      setProfilePhotoUploadBusy(false);
    }
  };

  const downloadPhotos = async (urls) => {
    setAppError('');
    try {
      for (const url of urls) await downloadPhotoFile(url);
    } catch (error) {
      console.error('Photo download failed', error);
      setAppError('Unable to download photo.');
    }
  };

  const deletePhoto = async (job, type, url) => {
    if (!(await askConfirm(`Are you sure you want to delete this ${type} photo? This action cannot be undone.`))) return;
    try {
      const snap = await getDoc(doc(db, 'jobs', job.id));
      const current = snap.exists() ? snap.data() : job;
      await updateDoc(doc(db, 'jobs', job.id), {
        [`${type}Photos`]: getJobPhotos(current, type).filter((u) => u !== url),
        [`${type}PhotoUrl`]: '',
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('Delete photo failed', error);
      setAppError('Unable to delete photo.');
    }
  };

  const handleDelete = async (jobId) => {
    if (!(await askConfirm('Are you sure you want to delete this job? This action cannot be undone.'))) return;
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
      const updates = { adminSignedOff: true, adminSignedOffAt: new Date() };
      if (job.status !== 'Completed') {
        updates.status = 'Completed';
        updates.statusUpdatedByRole = profile.role;
        updates.completedAt = new Date();
      }
      await updateDoc(doc(db, 'jobs', job.id), updates);
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

    const conflict = canStaffManage ? findTechConflict(job, tech.email, jobs) : null;
    if (conflict) {
      const when = conflict.scheduledFor ? formatSchedule(conflict) : 'now';
      const confirmed = await askConfirm(`${tech.name} is already assigned to another job (${conflict.client || conflict.task || 'job'}, ${when}) during this window. Assign them to this job anyway?`, 'Assign anyway');
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
        status: 'Assigned',
        statusUpdatedByRole: profile.role,
      });
      // Cloud Function (manageTechStatusOnJobUpdated) marks techs busy only while en route / on site

      setAppError('');
    } catch (error) {
      console.error('Manual assignment failed', error);
      setAppError('Unable to assign technician.');
    }
  };

  const isAdmin = profile?.role === 'admin';
  const isAssistant = profile?.role === 'adminAssistant';
  const canStaffManage = isAdmin || isAssistant;
  const roleLabel = isAssistant ? 'Admin Assistant' : profile?.role;

  const withPrivateData = (job) => {
    const billing = jobBilling[job.id] || {};
    const items = jobConsumables[job.id] || [];
    return {
      ...job,
      ...(profile?.role === 'admin' || profile?.role === 'client' ? billing : {}),
      consumables: items.map((item) => (
        profile?.role === 'admin' || profile?.role === 'client'
          ? { ...item, unitPrice: billing.consumablePrices?.[item.id] ?? 0 }
          : item
      )),
    };
  };

  const jobsWithPrivateData = jobs.map(withPrivateData);
  const currentJobs = profile
    ? canStaffManage
      ? jobsWithPrivateData
      : isFieldRole(profile.role)
        ? jobsWithPrivateData.filter((job) => job.assignedTechEmail === (profile.email || firebaseUser?.email))
        : jobsWithPrivateData.filter((job) => job.clientEmail === (profile.email || firebaseUser?.email))
    : [];

  const canViewInvoice = profile?.role === 'admin' || profile?.role === 'client';
  const canEditConsumables = profile?.role === 'admin' || isFieldRole(profile?.role);
  const canDownloadPhotos = canViewInvoice;
  const activeJobsCount = currentJobs.filter((job) => job.status !== 'Completed' && !job.assignedTechEmail && !isJobDispatched(job)).length;
  const assignedJobsCount = currentJobs.filter(isJobAssigned).length;
  const dispatchedJobsCount = currentJobs.filter(isJobDispatched).length;
  const completedJobsCount = completedTotal;
  const activeJobs = currentJobs.filter((job) => job.status !== 'Completed');
  const completedJobs = completedJobsData.map(withPrivateData);
  const filteredActiveJobs = activeJobs.filter((job) => {
    const matchesStatus = jobStatusFilter === 'All'
      || (jobStatusFilter === 'Assigned' ? isJobAssigned(job)
        : jobStatusFilter === 'Dispatched' ? isJobDispatched(job)
        : job.status === jobStatusFilter);
    const q = jobSearch.toLowerCase();
    const matchesSearch = !q ||
      (job.client || '').toLowerCase().includes(q) ||
      (job.location || '').toLowerCase().includes(q) ||
      (job.task || '').toLowerCase().includes(q) ||
      (job.assignedTechName || '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });
  const filteredCompletedJobs = completedJobs.filter((job) => {
    const q = completedSearch.toLowerCase();
    return !q ||
      (job.client || '').toLowerCase().includes(q) ||
      (job.location || '').toLowerCase().includes(q) ||
      (job.task || '').toLowerCase().includes(q) ||
      (job.assignedTechName || '').toLowerCase().includes(q);
  });

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">Loading�</div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-3xl p-8 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="bg-violet-700 p-3 rounded-xl"><Lock size={24} /></div>
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
            <button onClick={login} className="w-full rounded-2xl bg-teal-600 px-4 py-3 text-white font-semibold hover:bg-teal-500 transition">
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setShowResetForm((v) => !v); setResetSent(false); setResetError(''); }}
              className="w-full text-sm text-slate-400 hover:text-slate-200 transition text-center"
            >
              Forgot password?
            </button>
            {showResetForm && (
              <div className="space-y-3 rounded-2xl bg-slate-800 border border-slate-700 p-4">
                <p className="text-slate-300 text-sm">Enter your email and we'll send a reset link.</p>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none text-sm"
                />
                {resetError && <div className="text-red-300 text-sm">{resetError}</div>}
                {resetSent
                  ? <div className="rounded-2xl bg-emerald-900/50 p-3 text-emerald-200 text-sm">Reset link sent — check your inbox.</div>
                  : <button onClick={sendReset} className="w-full rounded-2xl bg-teal-600 px-4 py-2 text-white text-sm font-semibold hover:bg-teal-500 transition">Send reset link</button>
                }
              </div>
            )}
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

  if ((profile?.role === 'client' || isFieldRole(profile?.role)) && !firebaseUser?.emailVerified) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-700 rounded-3xl p-8 shadow-2xl text-center">
          <h1 className="text-2xl font-bold">Verify your email</h1>
          <p className="text-slate-400 mt-4">We sent a verification link to {firebaseUser?.email}. Open it, then continue. Your jobs appear after verification.</p>
          {verifyMessage && <p className="text-amber-300 mt-4 text-sm">{verifyMessage}</p>}
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={async () => {
                try {
                  await firebaseUser.reload();
                  await firebaseUser.getIdToken(true);
                  if (firebaseUser.emailVerified) {
                    window.location.reload();
                  } else {
                    setVerifyMessage('Not verified yet. Open the link in your email, then try again.');
                  }
                } catch (error) {
                  console.error('Verification check failed', error);
                  setVerifyMessage('Unable to check verification. Try again.');
                }
              }}
              className="rounded-2xl bg-teal-600 px-4 py-3 text-white font-semibold hover:bg-teal-500 transition"
            >
              I've verified, continue
            </button>
            <button
              onClick={async () => {
                try {
                  await sendEmailVerification(firebaseUser);
                  setVerifyMessage('Verification email sent.');
                } catch (error) {
                  console.error('Resend verification failed', error);
                  setVerifyMessage('Please wait a few minutes before requesting another email.');
                }
              }}
              className="rounded-2xl border border-slate-600 bg-slate-800 px-4 py-3 text-slate-200 font-semibold hover:bg-slate-700 transition"
            >
              Resend verification email
            </button>
            <button onClick={logout} className="text-slate-400 text-sm hover:text-slate-200">
              Sign out
            </button>
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
          <button onClick={logout} className="mt-6 rounded-2xl bg-teal-600 px-4 py-3 text-white font-semibold hover:bg-teal-500 transition">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-20">
      {confirmDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => closeConfirm(false)}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-slate-100 text-base leading-relaxed">{confirmDialog.message}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" autoFocus onClick={() => closeConfirm(false)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition">
                Cancel
              </button>
              <button type="button" onClick={() => closeConfirm(true)} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition">
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
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
        {badgeViewUrl && (
          <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-3" onClick={() => setBadgeViewUrl(null)}>
            <img src={badgeViewUrl} alt="Staff badge" className="max-h-[calc(100dvh-4rem)] max-w-full object-contain rounded-xl" />
            <button type="button" className="mt-3 rounded-xl bg-slate-700 px-6 py-2 text-white text-sm font-semibold">Close</button>
          </div>
        )}
        {appError && (
          <div className="rounded-3xl bg-red-900/20 border border-red-700 p-4 text-red-100">
            {appError}
          </div>
        )}
        <section className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
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
                <div className="text-3xl font-bold capitalize">{roleLabel}</div>
                <div className="mt-1 text-slate-400 text-sm">{profile.displayName}</div>
              </div>
            </div>
            {profile.role !== 'client' && !profile.profilePhotoUrl && (
              <div className="mt-2 text-amber-400 text-xs">Photo required</div>
            )}
            {profile.role !== 'client' && profile.profilePhotoUrl && (
              <button
                type="button"
                onClick={() => generateBadgePdf(profile, firebaseUser.uid, setAppError)}
                className="mt-3 inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200"
              >
                <Download size={12} /> Download badge
              </button>
            )}
            {profile.role !== 'client' && profile.profilePhotoUrl && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setBadgeViewUrl(await prepareBadge(profile, firebaseUser.uid));
                  } catch (error) {
                    console.error('Badge display failed', error);
                    setAppError('Badge generation failed. Please re-upload your profile photo and try again.');
                  }
                }}
                className="mt-3 ml-2 inline-flex items-center gap-1 rounded-xl bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Show on phone
              </button>
            )}
          </div>
          {!isAssistant && (
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Closed jobs</div>
            <div className="mt-4 text-4xl font-bold text-emerald-400">{completedJobsCount}</div>
            <div className="mt-2 text-slate-400">Total completed jobs</div>
          </div>
          )}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Assigned jobs</div>
            <div className="mt-4 text-4xl font-bold">{assignedJobsCount}</div>
            <div className="mt-2 text-slate-400">Scheduled / not started</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Dispatched jobs</div>
            <div className="mt-4 text-4xl font-bold">{dispatchedJobsCount}</div>
            <div className="mt-2 text-slate-400">Tech en route or on site</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Open jobs</div>
            <div className="mt-4 text-4xl font-bold text-red-400">{activeJobsCount}</div>
            <div className="mt-2 text-slate-400">Not yet assigned</div>
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
            {passwordMessage && <div className="rounded-2xl bg-violet-900/50 p-3 text-violet-200">{passwordMessage}</div>}
            <button onClick={changeMyPassword} type="button" className="rounded-2xl bg-amber-600 px-5 py-3 text-white font-semibold hover:bg-amber-500 transition flex items-center justify-center gap-2">
              <Lock size={16} /> Update my password
            </button>
          </section>
        )}

        {(canStaffManage || profile.role === 'client') && (
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Scheduled date &amp; start time <span className="text-slate-500 text-xs">(optional, leave blank for immediate dispatch)</span></span>
                  <input
                    type="datetime-local"
                    value={requestForm.scheduledFor}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, scheduledFor: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">End time <span className="text-slate-500 text-xs">(earlier than start = next day)</span></span>
                  <input
                    type="time"
                    value={requestForm.scheduledEndTime}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, scheduledEndTime: e.target.value }))}
                    disabled={!requestForm.scheduledFor}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 disabled:opacity-50"
                  />
                </label>
              </div>
              {requestError && <div className="rounded-2xl bg-red-900/50 p-3 text-red-200">{requestError}</div>}
              {requestSuccess && <div className="rounded-2xl bg-emerald-900/50 p-3 text-emerald-200">{requestSuccess}</div>}
              <button type="submit" className="rounded-2xl bg-teal-600 px-5 py-3 text-white font-semibold hover:bg-teal-500 transition">
                Submit request
              </button>
            </form>}
          </section>
        )}

        {canStaffManage && (
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
                placeholder="Your own password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
              />
              <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-400 flex items-center">
                This is required to restore your session after creating the new account.
              </div>
            </div>

            {accountMessage && <div className="rounded-2xl bg-violet-900/50 p-3 text-violet-200">{accountMessage}</div>}
            <button onClick={createAccount} type="button" className="rounded-2xl bg-indigo-600 px-5 py-3 text-white font-semibold hover:bg-indigo-500 transition flex items-center justify-center gap-2">
              <Plus size={16} /> Create account
            </button>
          </section>

          {isAdmin && (
          <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Existing users</h2>
                <p className="text-slate-400 mt-1">Manage role assignments and remove users from app access.</p>
              </div>
              <button type="button" onClick={() => setShowUsersPanel((prev) => !prev)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                {showUsersPanel ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {!showUsersPanel ? null : users.length === 0 ? (
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
                        disabled={userItem.id === (profile?.uid || profile?.id) || savedRoles[userItem.id] !== false}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-slate-100"
                      >
                        <option value="admin">Admin</option>
                        <option value="adminAssistant">Admin Assistant</option>
                        <option value="tech">Technician</option>
                        <option value="seniorConsultant">Senior Consultant</option>
                        <option value="client">Client</option>
                      </select>

                      {savedRoles[userItem.id] !== false ? (
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
          )}
              </>
            )}
          </section>
          </>
        )}

        {isAdmin && (
          <section className="grid gap-4">
            <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Receivables</h2>
                <p className="text-slate-400 text-sm mt-1">Invoices awaiting payment, aging, and manual payment recording.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowReceivablesPanel((prev) => !prev)}
                className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
              >
                {showReceivablesPanel ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {showReceivablesPanel && <Receivables recordedBy={firebaseUser?.email || ''} setAppError={setAppError} />}
          </section>
        )}

        <section className="grid gap-4">
          <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Active jobs</h2>

              <p className="text-slate-400 text-sm mt-1">Jobs currently in progress or awaiting dispatch.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowJobsPanel((prev) => !prev)}
                className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
              >
                {showJobsPanel ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>

          {showJobsPanel && (
          <div className="grid gap-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Search client, location, task, tech�"
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                className="flex-1 rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
              />
              <div className="flex flex-wrap gap-2">
                {['All', 'Pending', 'Assigned', 'Dispatched', 'On Site', 'Ready for Signoff'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setJobStatusFilter(s)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      jobStatusFilter === s
                        ? 'bg-teal-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          {loading ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs�</div>
          ) : filteredActiveJobs.length === 0 ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">{activeJobs.length === 0 ? 'No active jobs.' : 'No jobs match your filter.'}</div>
          ) : (
            <div className="space-y-6">
              {filteredActiveJobs.map((job) => {
                const total = calcInvoiceTotal(job.consumables || [], job.serviceFee);
                const receivable = getReceivableStatus(job, jobPayments[job.id] || []);
                const beforeReady = getJobPhotos(job, 'before').length > 0;
                const afterReady = getJobPhotos(job, 'after').length > 0;
                const canRequestSignoff = isFieldRole(profile.role) && ['Assigned', 'Dispatched', 'En Route', 'On Site'].includes(job.status) && beforeReady && afterReady && Boolean(job.checkInAt);
                const canClientSignoff = profile.role === 'client' && job.status === 'Ready for Signoff' && !job.clientSignedOff;

                const isExpanded = expandedJobIds.includes(job.id);
                const toggleExpanded = () => setExpandedJobIds((prev) => (prev.includes(job.id) ? prev.filter((id) => id !== job.id) : [...prev, job.id]));

                if (!isExpanded) {
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={toggleExpanded}
                      className="w-full text-left bg-slate-800 rounded-2xl border border-slate-700 px-5 py-3 hover:bg-slate-700/60 transition flex flex-wrap items-center gap-x-4 gap-y-1"
                    >
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${job.status === 'Ready for Signoff' ? 'bg-orange-500/10 text-orange-300' : 'bg-teal-500/10 text-teal-300'}`}>
                        {getJobStatusLabel(job)}
                      </span>
                      <span className="font-semibold text-white">{job.client}</span>
                      <span className="text-slate-300 text-sm truncate max-w-xs">{job.task}</span>
                      <span className="text-slate-400 text-sm">{job.assignedTechName || 'Unassigned'}</span>
                      {job.scheduledFor && <span className="text-amber-300 text-sm">{formatSchedule(job)}</span>}
                      <span className="ml-auto text-xs text-slate-400">Expand</span>
                    </button>
                  );
                }

                return (
                  <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400 mb-3">
                          <button type="button" onClick={toggleExpanded} className="mr-2 rounded-xl border border-slate-600 px-2 py-1 text-xs normal-case tracking-normal text-slate-300 hover:bg-slate-700 transition">Collapse</button>
                          <span className={`inline-flex rounded-full px-3 py-1 ${job.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-300' : job.status === 'Ready for Signoff' ? 'bg-orange-500/10 text-orange-300' : 'bg-teal-500/10 text-teal-300'}`}>
                            {getJobStatusLabel(job)}
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
                        <TechNameWithPhoto job={job} techs={techs} />
                        {(job.assignedTechDistanceMiles ?? job.assignedTechDistanceKm) != null && (
                          <div className="text-slate-400 text-sm">{(job.assignedTechDistanceMiles ?? job.assignedTechDistanceKm).toFixed(1)} mi away</div>
                        )}
                        {job.scheduledFor && (
                          <div>
                            <div className="text-slate-400 text-sm mt-3">Scheduled for</div>
                            <div className="text-amber-300 text-sm font-semibold">{formatSchedule(job)}</div>
                          </div>
                        )}
                        <div className="text-slate-400 text-sm mt-3">Created</div>
                        <div className="text-slate-200 text-sm">{formatDate(job.createdAt)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                      <div className="rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
                        <div className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em] mb-4">
                          <Camera size={16} /> Job photos
                          {uploadingId === job.id && <span className="text-teal-300 normal-case tracking-normal">Uploading photo...</span>}
                        </div>
                        <div className="grid gap-3">
                          {['before', 'after'].map((type) => {
                            const photos = getJobPhotos(job, type);
                            const label = type === 'before' ? 'Before' : 'After';
                            return (
                              <div key={type} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="text-slate-300 text-sm">{label} photos {photos.length > 0 && `(${photos.length})`}</div>
                                  {canDownloadPhotos && photos.length > 0 && (
                                    <button type="button" onClick={() => downloadPhotos(photos)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition">
                                      <Download size={12} /> Download all
                                    </button>
                                  )}
                                </div>
                                {photos.length ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    {photos.map((url) => (
                                      <div key={url} className="relative">
                                        <a href={url} target="_blank" rel="noreferrer">
                                          <img src={url} alt={label} loading="lazy" decoding="async" className="w-full aspect-square rounded-xl object-cover" />
                                        </a>
                                        {['tech', 'admin'].includes(profile.role) && (
                                          <button type="button" aria-label={`Delete ${type} photo`} onClick={() => deletePhoto(job, type, url)} className="absolute top-1 right-1 rounded-full border border-red-800 bg-red-950/80 p-1.5 text-red-300 hover:bg-red-900 transition">
                                            <Trash2 size={13} />
                                          </button>
                                        )}
                                        {canDownloadPhotos && (
                                          <button type="button" aria-label={`Download ${type} photo`} title="Download photo" onClick={() => downloadPhotos([url])} className="absolute bottom-1 left-1 rounded-full border border-slate-600 bg-slate-900/80 p-1.5 text-slate-200 hover:bg-slate-800 transition">
                                            <Download size={13} />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No photos yet</div>
                                )}
                                {['tech', 'admin'].includes(profile.role) && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <label htmlFor={`${type}-cam-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                      <Camera size={15} /> Take photo
                                    </label>
                                    <input id={`${type}-cam-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job, type)} />
                                    <label htmlFor={`${type}-file-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                      <Plus size={15} /> Add from gallery
                                    </label>
                                    <input id={`${type}-file-${job.id}`} type="file" multiple className="hidden" accept="image/*" onChange={(e) => handlePhotoUpload(e, job, type)} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                            <div className="text-slate-300 text-sm mb-2 flex items-center gap-2">
                              <FileText size={15} /> Files &amp; documents {(job.attachments || []).length > 0 && `(${job.attachments.length})`}
                              {uploadingFilesId === job.id && <span className="text-teal-300 text-xs">Uploading...</span>}
                            </div>
                            {(job.attachments || []).length ? (
                              <ul className="space-y-2">
                                {job.attachments.map((file) => (
                                  <li key={file.url} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                                    <a href={file.url} target="_blank" rel="noreferrer" download={file.name} className="flex-1 min-w-0 truncate text-teal-300 hover:underline">{file.name}</a>
                                    <span className="text-slate-500 text-xs shrink-0">{formatFileSize(file.size)}</span>
                                    {['tech', 'admin'].includes(profile.role) && (
                                      <button type="button" aria-label={`Delete ${file.name}`} onClick={() => deleteAttachment(job, file)} className="text-red-300 hover:text-red-200">
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-700 p-4 text-center text-slate-500 text-sm">No files yet</div>
                            )}
                            {['tech', 'admin'].includes(profile.role) && (
                              <div className="mt-3">
                                <label htmlFor={`attach-${job.id}`} className="cursor-pointer inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                  <Plus size={15} /> Add files
                                </label>
                                <input id={`attach-${job.id}`} type="file" multiple className="hidden" accept={ATTACHMENT_ACCEPT} onChange={(e) => handleAttachmentUpload(e, job)} />
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
                              {job.consumables.map((item) => {
                                const edit = consumableEdits[job.id]?.[item.id] || {};
                                const itemDescription = edit.description ?? item.description;
                                const itemQty = edit.qty ?? item.qty;
                                const itemUnitPrice = edit.unitPrice ?? item.unitPrice;
                                return (
                                  <div key={item.id} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                                    <div className="flex flex-col gap-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          {job.invoiceSent || !canEditConsumables ? (
                                            <p className="text-slate-100">{item.description}</p>
                                          ) : (
                                            <input
                                              value={itemDescription}
                                              onChange={(e) => updateConsumableField(job.id, item.id, 'description', e.target.value)}
                                              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                            />
                                          )}
                                          <p className="text-slate-500 text-sm">Qty: {itemQty}</p>
                                        </div>
                                        {canViewInvoice && (
                                          <div className="text-right text-slate-200">
                                            <div>${Number(itemUnitPrice).toFixed(2)} each</div>
                                            <div className="text-slate-400 text-sm">${(Number(itemQty) * Number(itemUnitPrice)).toFixed(2)}</div>
                                          </div>
                                        )}
                                      </div>
                                      {!job.invoiceSent && canEditConsumables && (
                                        <div className={`grid gap-2 ${profile.role === 'admin' ? 'sm:grid-cols-[1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto]'}`}>
                                          <input
                                            type="number"
                                            min="1"
                                            value={itemQty}
                                            onChange={(e) => updateConsumableField(job.id, item.id, 'qty', e.target.value)}
                                            className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                          />
                                          {profile.role === 'admin' && (
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={itemUnitPrice}
                                              onChange={(e) => updateConsumableField(job.id, item.id, 'unitPrice', e.target.value)}
                                              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                                            />
                                          )}
                                          <button
                                            onClick={() => saveConsumableChange(job, item.id)}
                                            className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition"
                                          >
                                            Save
                                          </button>
                                        </div>
                                      )}
                                      {!job.invoiceSent && canEditConsumables && (
                                        <button
                                          onClick={() => deleteConsumable(job, item.id)}
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
                        {canEditConsumables && (
                          <div className="mt-4 space-y-3">
                            <input
                              value={newConsumable.description}
                              onChange={(e) => setNewConsumable((prev) => ({ ...prev, description: e.target.value }))}
                              placeholder="Item description"
                              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                            />
                            <div className={`grid gap-3 ${profile.role === 'admin' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                              <input
                                type="number"
                                min="1"
                                value={newConsumable.qty}
                                onChange={(e) => setNewConsumable((prev) => ({ ...prev, qty: e.target.value }))}
                                placeholder="Qty"
                                className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                              />
                              {profile.role === 'admin' && (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={newConsumable.unitPrice}
                                  onChange={(e) => setNewConsumable((prev) => ({ ...prev, unitPrice: e.target.value }))}
                                  placeholder="Unit price"
                                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
                                />
                              )}
                            </div>
                            <button onClick={() => addConsumable(job)} className="w-full rounded-2xl bg-teal-600 px-4 py-3 text-white font-semibold hover:bg-teal-500 transition flex items-center justify-center gap-2">
                              <Plus size={16} /> Add consumable
                            </button>
                          </div>
                        )}
                        {(job.serviceFee || job.serviceFee === 0) && canViewInvoice && (
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
                            {job.invoiceSent && (
                              <>
                                <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                                  <span>Paid</span>
                                  <span className="font-semibold text-slate-100">${receivable.paid.toFixed(2)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm mb-2">
                                  <span className="text-slate-400">Balance due</span>
                                  <span className={`font-semibold ${receivable.balance > 0 ? 'text-amber-300' : 'text-teal-300'}`}>${receivable.balance.toFixed(2)} · {receivable.status}</span>
                                </div>
                              </>
                            )}
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                              {job.status !== 'Pending' && (
                                profile.role === 'admin' || job.adminSignedOff ? (
                                  <button onClick={() => generateInvoicePdf(job, setAppError)} className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">
                                    Download invoice
                                  </button>
                                ) : null
                              )}
                            </div>
                          </div>
                        )}
                        {canStaffManage && job.status !== 'Completed' && (
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
                        {job.checkInAt && <div>Check-in: {formatDate(job.checkInAt)}</div>}
                        {job.checkInLat && job.checkInLng && (
                          <div className="mt-2">
                            <div className="text-xs text-slate-500 mb-1">Tech check-in location</div>
                            <div className="rounded-2xl overflow-hidden border border-slate-600" style={{height: '180px'}}>
                              <iframe
                                title="Tech check-in location"
                                width="100%"
                                height="180"
                                loading="lazy"
                                src={`https://www.openstreetmap.org/export/embed.html?bbox=${job.checkInLng - 0.003},${job.checkInLat - 0.003},${job.checkInLng + 0.003},${job.checkInLat + 0.003}&layer=mapnik&marker=${job.checkInLat},${job.checkInLng}`}
                                style={{border: 0, display: 'block'}}
                              />
                            </div>
                            <a
                              href={`https://www.google.com/maps?q=${job.checkInLat},${job.checkInLng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-teal-400 hover:text-teal-300 mt-1 inline-block"
                            >
                              Open in Google Maps ?
                            </a>
                          </div>
                        )}
                        {(job.breaks || []).map((brk, idx) => {
                          const durationMs = brk.endAt
                            ? (brk.endAt?.toDate ? brk.endAt.toDate() : new Date(brk.endAt)) - (brk.startAt?.toDate ? brk.startAt.toDate() : new Date(brk.startAt))
                            : null;
                          const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                          const short = durationMin != null && durationMin < 30;
                          return (
                            <div key={idx} className={short ? 'text-red-400' : ''}>
                              Break {idx + 1}: out {formatDate(brk.startAt)}{brk.endAt ? ` ? back ${formatDate(brk.endAt)} (${durationMin} min${short ? ' ? under 30 min' : ''})` : ' � on break'}
                            </div>
                          );
                        })}
                        {job.checkOutAt && <div>Check-out: {formatDate(job.checkOutAt)} ({Number(job.checkOutLat || 0).toFixed(5)}, {Number(job.checkOutLng || 0).toFixed(5)})</div>}
                        {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                        {job.adminSignedOff && <div className="text-teal-300">Admin signed off{job.adminSignedOffAt ? ` � ${formatDate(job.adminSignedOffAt)}` : ''}</div>}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {isFieldRole(profile.role) && !job.checkInAt && job.status !== 'En Route' && (
                          <button
                            onClick={() => updateDoc(doc(db, 'jobs', job.id), { status: 'En Route', statusUpdatedByRole: profile.role, enRouteAt: new Date(), updatedAt: new Date() })}
                            className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 transition flex items-center gap-2"
                          >
                            <MapPin size={16} /> Start en route
                          </button>
                        )}
                        {isFieldRole(profile.role) && !job.checkInAt && (
                          <button
                            onClick={() => recordTechGeoEvent(job, 'checkIn')}
                            disabled={geoEventBusyJobId === job.id}
                            className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition flex items-center gap-2 disabled:opacity-60"
                          >
                            <MapPin size={16} /> {geoEventBusyJobId === job.id ? 'Checking in...' : 'Check in on site'}
                          </button>
                        )}
                        {isFieldRole(profile.role) && job.checkInAt && !job.checkOutAt && (() => {
                          const hasActiveBreak = (job.breaks || []).some(b => b.startAt && !b.endAt);
                          const checkoutBlockReason = getCheckoutBlockReason(job);
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
                                disabled={geoEventBusyJobId === job.id || Boolean(checkoutBlockReason)}
                                className="rounded-2xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                <MapPin size={16} /> {geoEventBusyJobId === job.id ? 'Checking out...' : 'Check out from site'}
                              </button>
                              {checkoutBlockReason && <span className="self-center text-xs text-amber-300">{checkoutBlockReason}</span>}
                            </>
                          );
                        })()}
                        {profile.role === 'admin' && !job.checkOutAt && (
                          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(job.geofenceOverride)}
                              onChange={(e) => updateDoc(doc(db, 'jobs', job.id), { geofenceOverride: e.target.checked, updatedAt: new Date() }).catch(() => setAppError('Unable to update site check-in override.'))}
                            />
                            Allow check-in from anywhere (remote job)
                          </label>
                        )}
                        {isFieldRole(profile.role) && canRequestSignoff && (
                          <button onClick={() => requestClientSignoff(job)} className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition flex items-center gap-2">
                            <FileText size={16} /> Request sign-off
                          </button>
                        )}
                        {profile.role === 'client' && canClientSignoff && (
                          <button onClick={() => handleClientSignoff(job)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition flex items-center gap-2">
                            <CheckCircle size={16} /> Sign off work
                          </button>
                        )}
                        {profile.role === 'admin' && job.status === 'Ready for Signoff' && !job.adminSignedOff && (
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

        {!isAssistant && (
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
              <input
                type="text"
                placeholder="Search client, location, task, tech�"
                value={completedSearch}
                onChange={(e) => setCompletedSearch(e.target.value)}
                className="rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
              />
              {loading || (completedLoading && completedJobs.length === 0) ? (
                <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs...</div>
              ) : filteredCompletedJobs.length === 0 ? (
                <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">{completedJobs.length === 0 ? 'No completed jobs yet.' : 'No loaded jobs match your search. Try loading more.'}</div>
              ) : (
                <div className="space-y-6">
                  {filteredCompletedJobs.map((job) => (
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
                          <TechNameWithPhoto job={job} techs={techs} />
                          <div className="text-slate-400 text-sm mt-3">Completed</div>
                          <div className="text-slate-200 text-sm">{formatDate(job.completedAt || job.createdAt)}</div>
                        </div>
                      </div>
                      {(getJobPhotos(job, 'before').length > 0 || getJobPhotos(job, 'after').length > 0) && (
                        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {['before', 'after'].map((type) => {
                            const photos = getJobPhotos(job, type);
                            if (!photos.length) return null;
                            return (
                              <div key={type} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="text-slate-300 text-sm">{type === 'before' ? 'Before' : 'After'} photos</div>
                                  {canDownloadPhotos && (
                                    <button type="button" onClick={() => downloadPhotos(photos)} className="inline-flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition">
                                      <Download size={12} /> Download all
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {photos.map((url) => (
                                    <div key={url} className="relative">
                                      <a href={url} target="_blank" rel="noreferrer">
                                        <img src={url} alt={type} loading="lazy" decoding="async" className="w-full aspect-square rounded-xl object-cover" />
                                      </a>
                                      {canDownloadPhotos && (
                                        <button type="button" aria-label={`Download ${type} photo`} title="Download photo" onClick={() => downloadPhotos([url])} className="absolute bottom-1 left-1 rounded-full border border-slate-600 bg-slate-900/80 p-1.5 text-slate-200 hover:bg-slate-800 transition">
                                          <Download size={13} />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {canViewInvoice && (
                        <div className="mt-6 rounded-2xl bg-slate-900 p-4 border border-slate-700">
                          <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                            <span>Total</span>
                            <span className="font-semibold text-slate-100">${calcInvoiceTotal(job.consumables || [], job.serviceFee).toFixed(2)}</span>
                          </div>
                          {job.invoiceSent && (() => {
                            const receivable = getReceivableStatus(job, jobPayments[job.id] || []);
                            return (
                              <>
                                <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                                  <span>Paid</span>
                                  <span className="font-semibold text-slate-100">${receivable.paid.toFixed(2)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm mb-2">
                                  <span className="text-slate-400">Balance due</span>
                                  <span className={`font-semibold ${receivable.balance > 0 ? 'text-amber-300' : 'text-teal-300'}`}>${receivable.balance.toFixed(2)} · {receivable.status}</span>
                                </div>
                              </>
                            );
                          })()}
                          {(profile.role === 'admin' || job.adminSignedOff) && (
                            <button onClick={() => generateInvoicePdf(job, setAppError)} className="mt-2 rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition">
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
                          {job.checkInLat && job.checkInLng && (
                            <div className="mt-2">
                              <div className="text-xs text-slate-500 mb-1">Tech check-in location</div>
                              <div className="rounded-2xl overflow-hidden border border-slate-600" style={{height: '180px'}}>
                                <iframe
                                  title="Tech check-in location"
                                  width="100%"
                                  height="180"
                                  loading="lazy"
                                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${job.checkInLng - 0.003},${job.checkInLat - 0.003},${job.checkInLng + 0.003},${job.checkInLat + 0.003}&layer=mapnik&marker=${job.checkInLat},${job.checkInLng}`}
                                  style={{border: 0, display: 'block'}}
                                />
                              </div>
                              <a
                                href={`https://www.google.com/maps?q=${job.checkInLat},${job.checkInLng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-teal-400 hover:text-teal-300 mt-1 inline-block"
                              >
                                Open in Google Maps ?
                              </a>
                            </div>
                          )}
                          {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                          {job.adminSignedOff && <div className="text-teal-300">Admin signed off{job.adminSignedOffAt ? ` � ${formatDate(job.adminSignedOffAt)}` : ''}</div>}
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
                  {completedJobs.length >= completedLimit && completedJobs.length < completedTotal && (
                    <button
                      type="button"
                      onClick={() => setCompletedLimit((prev) => prev + COMPLETED_PAGE_SIZE)}
                      className="w-full rounded-2xl border border-slate-600 px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition"
                    >
                      Load more ({completedJobs.length} of {completedTotal})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
        )}
      </main>
      <LegalFooter />
    </div>
  );
}

export default App;
