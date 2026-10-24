import React, { useState, useEffect } from 'react';
import { db, storage, auth } from './firebase';
import { collection, addDoc, deleteDoc, doc, updateDoc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import logoPath from './assets/sv-smart-dispatch-logo.jpg';
import { isJobDispatched, isJobAssigned, formatSchedule, findTechConflict } from './lib/jobTime';
import { calculateDistanceMiles } from './lib/geo';
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_ACCEPT, PHOTO_MAX_DIMENSION, PHOTO_JPEG_QUALITY, downloadPhotoFile, fileToSquareDataUrl, compressPhotoForUpload } from './lib/media';
import { prepareBadge, generateBadgePdf } from './lib/badge';
import { uploadInvoicePdf } from './lib/invoice';
import ReceivablesSection from './features/ReceivablesSection';
import useAuthProfile from './hooks/useAuthProfile';
import useJobs from './hooks/useJobs';
import useTechs from './hooks/useTechs';
import useUsers from './hooks/useUsers';
import { getCheckoutBlockReason } from './lib/jobDisplay';
import TechNameWithPhoto from './features/TechNameWithPhoto';
import ActiveJobs from './features/ActiveJobs';
import CompletedJobs from './features/CompletedJobs';
import RequestForm from './features/RequestForm';
import Accounts from './features/Accounts';
import { isFieldRole } from './lib/roles';
import { BUSINESS_NAME, APP_DISPLAY_NAME } from './lib/branding';
import {
  Briefcase,
  Wrench,
  Clock,
  MapPin,
  Trash2,
  Camera,
  Loader2,
  Lock,
  LogOut,
  List,
  CheckCircle,
  FileText,
  Shield,
  Download,
} from 'lucide-react';



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
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const { authReady, firebaseUser, setFirebaseUser, profile, setProfile, suppressAuthStateRef } = useAuthProfile(setAppError);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const askConfirm = (message, confirmLabel = 'Delete') => new Promise((resolve) => {
    setConfirmDialog({ message, confirmLabel, resolve });
  });
  const closeConfirm = (result) => {
    confirmDialog?.resolve(result);
    setConfirmDialog(null);
  };
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
  const [userRoleEdits, setUserRoleEdits] = useState({});
  const [showAddUserPanel, setShowAddUserPanel] = useState(false);
  const [showUsersPanel, setShowUsersPanel] = useState(false);
  const [expandedJobIds, setExpandedJobIds] = useState([]);
  const [completedLimit, setCompletedLimit] = useState(25);
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

  const { jobs, loading, jobBilling, jobPayments, jobConsumables, completedJobsData, completedLoading, completedTotal } = useJobs({ profile, firebaseUser, sessionRestoreCount, showCompletedJobsPanel, completedLimit, setAppError, suppressAuthStateRef });
  const COMPLETED_PAGE_SIZE = 25;

  const techs = useTechs(firebaseUser);

  useEffect(() => {
    if (!isFieldRole(profile?.role) || !profile.profilePhotoUrl || !firebaseUser?.uid) return;
    const mine = techs.find((t) => t.id === firebaseUser.uid);
    if (mine && mine.profilePhotoUrl !== profile.profilePhotoUrl) {
      updateDoc(doc(db, 'technicians', firebaseUser.uid), { profilePhotoUrl: profile.profilePhotoUrl }).catch((e) => console.warn('Tech photo sync failed', e));
    }
  }, [techs, profile?.role, profile?.profilePhotoUrl, firebaseUser?.uid]);

  const users = useUsers(profile);

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
      // The assignTechOnJobCreate function assigns the technician after the job is created
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
        status: 'Pending',
        createdByRole: profile.role,
        billingMigrated: true,
        invoiceSent: false,
        clientSignedOff: false,
        createdAt: new Date(),
      });
      setRequestSuccess('Request submitted.');
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
    await updateDoc(doc(db, 'jobs', job.id), { clientSignedOff: true });
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
        return { url: await getDownloadURL(storageRef), path: storageRef.fullPath };
      }));
      const uploaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (uploaded.length) {
        const batch = writeBatch(db);
        for (const item of uploaded) {
          batch.set(doc(collection(db, 'jobs', jobId, 'photos')), {
            type, url: item.url, path: item.path, uploadedAt: new Date(), uploadedBy: firebaseUser.email,
          });
        }
        await batch.commit();
      }
      if (uploaded.length < files.length) setAppError(`${files.length - uploaded.length} photo(s) failed to upload.`);
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
        return {
          name: file.name, url: await getDownloadURL(storageRef), path: storageRef.fullPath, size: file.size, type: file.type || '',
        };
      }));
      const uploaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (uploaded.length) {
        const batch = writeBatch(db);
        for (const item of uploaded) {
          batch.set(doc(collection(db, 'jobs', job.id, 'files')), { ...item, uploadedAt: new Date(), uploadedBy: firebaseUser.email });
        }
        await batch.commit();
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
      await deleteDoc(doc(db, 'jobs', job.id, 'files', file.id));
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

  const deletePhoto = async (job, photo) => {
    if (!(await askConfirm(`Are you sure you want to delete this ${photo.type} photo? This action cannot be undone.`))) return;
    try {
      await deleteDoc(doc(db, 'jobs', job.id, 'photos', photo.id));
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
    if (!(Number(job.serviceFee) > 0)) {
      setAppError('Enter a service fee before signing off.');
      return;
    }
    try {
      const signedOffAt = new Date();
      const updates = { adminSignedOff: true, adminSignedOffAt: signedOffAt };
      if (!job.invoicePdfPath) {
        updates.invoicePdfPath = await uploadInvoicePdf(job, signedOffAt);
        updates.invoiceSent = true;
        updates.invoiceSentAt = signedOffAt;
      }
      if (job.status !== 'Completed') {
        updates.status = 'Completed';
        updates.statusUpdatedByRole = profile.role;
        updates.completedAt = signedOffAt;
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
          <RequestForm
            profile={profile}
            requestFormOpen={requestFormOpen}
            setRequestFormOpen={setRequestFormOpen}
            requestForm={requestForm}
            setRequestForm={setRequestForm}
            requestError={requestError}
            requestSuccess={requestSuccess}
            submitRequest={submitRequest}
          />
        )}

        {canStaffManage && (
          <Accounts
            isAdmin={isAdmin}
            profile={profile}
            users={users}
            newAccount={newAccount}
            setNewAccount={setNewAccount}
            accountMessage={accountMessage}
            createAccount={createAccount}
            showAddUserPanel={showAddUserPanel}
            setShowAddUserPanel={setShowAddUserPanel}
            showUsersPanel={showUsersPanel}
            setShowUsersPanel={setShowUsersPanel}
            userRoleEdits={userRoleEdits}
            setUserRoleEdits={setUserRoleEdits}
            savedRoles={savedRoles}
            setSavedRoles={setSavedRoles}
            updateUserRole={updateUserRole}
            deleteUser={deleteUser}
          />
        )}

        {isAdmin && (
          <ReceivablesSection
            showReceivablesPanel={showReceivablesPanel}
            setShowReceivablesPanel={setShowReceivablesPanel}
            recordedBy={firebaseUser?.email || ''}
            setAppError={setAppError}
          />
        )}

        <ActiveJobs
          profile={profile}
          showJobsPanel={showJobsPanel}
          setShowJobsPanel={setShowJobsPanel}
          jobSearch={jobSearch}
          setJobSearch={setJobSearch}
          jobStatusFilter={jobStatusFilter}
          setJobStatusFilter={setJobStatusFilter}
          loading={loading}
          activeJobs={activeJobs}
          filteredActiveJobs={filteredActiveJobs}
          expandedJobIds={expandedJobIds}
          setExpandedJobIds={setExpandedJobIds}
          editingJobId={editingJobId}
          setEditingJobId={setEditingJobId}
          jobEdits={jobEdits}
          setJobEdits={setJobEdits}
          jobPayments={jobPayments}
          techs={techs}
          uploadingId={uploadingId}
          uploadingFilesId={uploadingFilesId}
          consumableEdits={consumableEdits}
          newConsumable={newConsumable}
          setNewConsumable={setNewConsumable}
          serviceFeeInputs={serviceFeeInputs}
          setServiceFeeInputs={setServiceFeeInputs}
          assignments={assignments}
          setAssignments={setAssignments}
          canViewInvoice={canViewInvoice}
          canEditConsumables={canEditConsumables}
          canDownloadPhotos={canDownloadPhotos}
          canStaffManage={canStaffManage}
          geoEventBusyJobId={geoEventBusyJobId}
          setAppError={setAppError}
          downloadPhotos={downloadPhotos}
          deletePhoto={deletePhoto}
          handlePhotoUpload={handlePhotoUpload}
          handleAttachmentUpload={handleAttachmentUpload}
          deleteAttachment={deleteAttachment}
          updateConsumableField={updateConsumableField}
          saveConsumableChange={saveConsumableChange}
          deleteConsumable={deleteConsumable}
          addConsumable={addConsumable}
          addServiceFee={addServiceFee}
          deleteServiceFee={deleteServiceFee}
          assignTechnicianToJob={assignTechnicianToJob}
          saveJobEdits={saveJobEdits}
          recordTechGeoEvent={recordTechGeoEvent}
          requestClientSignoff={requestClientSignoff}
          handleClientSignoff={handleClientSignoff}
          adminSignOffWork={adminSignOffWork}
          handleDelete={handleDelete}
        />

        {!isAssistant && (
          <CompletedJobs
            profile={profile}
            loading={loading}
            completedLoading={completedLoading}
            completedJobs={completedJobs}
            filteredCompletedJobs={filteredCompletedJobs}
            completedSearch={completedSearch}
            setCompletedSearch={setCompletedSearch}
            showCompletedJobsPanel={showCompletedJobsPanel}
            setShowCompletedJobsPanel={setShowCompletedJobsPanel}
            completedLimit={completedLimit}
            completedTotal={completedTotal}
            onLoadMore={() => setCompletedLimit((prev) => prev + COMPLETED_PAGE_SIZE)}
            techs={techs}
            jobPayments={jobPayments}
            canViewInvoice={canViewInvoice}
            canDownloadPhotos={canDownloadPhotos}
            downloadPhotos={downloadPhotos}
            setAppError={setAppError}
            adminSignOffWork={adminSignOffWork}
            handleDelete={handleDelete}
          />
        )}
      </main>
      <LegalFooter />
    </div>
  );
}

export default App;
