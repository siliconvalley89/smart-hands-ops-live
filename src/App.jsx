import React, { useState, useEffect } from 'react';
import { db, storage, auth } from './firebase';
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, updateDoc, getDocs, setDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import { jsPDF } from 'jspdf';
import logoPath from './assets/logo.jpg';
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
} from 'lucide-react';

const formatDate = (value) => {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString();
  return new Date(value).toLocaleString();
};

const calcInvoiceTotal = (items = []) => {
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitPrice || 0)), 0);
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
    doc.text('Consumables:', 40, 255);

    let y = 275;
    const consumables = job.consumables || [];
    if (consumables.length === 0) {
      doc.text('None', 40, y);
      y += 20;
    } else {
      doc.setFontSize(11);
      consumables.forEach((item) => {
        const amount = Number(item.qty || 0) * Number(item.unitPrice || 0);
        doc.text(`${item.description} - ${item.qty} x $${Number(item.unitPrice || 0).toFixed(2)} = $${amount.toFixed(2)}`, 40, y);
        y += 18;
      });
      y += 10;
    }

    doc.setFontSize(12);
    doc.text(`Total: $${calcInvoiceTotal(consumables).toFixed(2)}`, 40, y + 10);
    doc.setFontSize(10);
    doc.text('Thank you for choosing Silicon Valley Smart Hands LLC.', 40, y + 35);
    doc.save(`SV-Smart-Dispatch-Invoice-${job.id}.pdf`);
  } catch (error) {
    console.error('Invoice generation failed', error);
    setAppError('Unable to generate invoice PDF.');
  }
};

const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
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
  const [requestForm, setRequestForm] = useState({ name: '', email: '', phone: '', location: '', service: '', details: '' });
  const [requestSuccess, setRequestSuccess] = useState('');
  const [requestError, setRequestError] = useState('');
  const [newTech, setNewTech] = useState({ name: '', email: '', phone: '', location: '' });
  const [techMessage, setTechMessage] = useState('');
  const [newConsumable, setNewConsumable] = useState({ description: '', qty: 1, unitPrice: '' });

  useEffect(() => {
    const authUnsub = onAuthStateChanged(auth, async (user) => {
      try {
        setFirebaseUser(user);
        if (user) {
          const usersQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
          const userSnapshot = await getDocs(usersQuery);
          if (!userSnapshot.empty) {
            setProfile({ id: userSnapshot.docs[0].id, ...userSnapshot.docs[0].data() });
          } else {
            setProfile(null);
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

  useEffect(() => {
    const checkUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'));
        setAdminSetupAllowed(snapshot.empty);
      } catch (error) {
        console.error('Unable to check users collection', error);
        setAppError('Unable to check admin setup status.');
      }
    };
    checkUsers();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobItems = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setJobs(jobItems);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'technicians'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const techItems = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setTechs(techItems);
    });
    return () => unsubscribe();
  }, []);

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
      const distanceKm = calculateDistanceKm(clientLat, clientLng, tech.lat, tech.lng);
      if (!nearest || distanceKm < nearest.distanceKm) {
        return { ...tech, distanceKm };
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

    if (!requestForm.name || !requestForm.email || !requestForm.phone || !requestForm.location || !requestForm.service) {
      setRequestError('Please complete all required fields.');
      return;
    }

    try {
      const geo = await geocodeAddress(requestForm.location);
      const nearest = await assignNearestTechnician(geo.lat, geo.lng);
      await addDoc(collection(db, 'jobs'), {
        client: requestForm.name,
        clientEmail: requestForm.email,
        clientPhone: requestForm.phone,
        location: geo.displayName,
        rawLocation: requestForm.location,
        lat: geo.lat,
        lng: geo.lng,
        task: requestForm.service,
        details: requestForm.details,
        status: nearest ? 'Dispatched' : 'Pending',
        assignedTechName: nearest?.name || '',
        assignedTechEmail: nearest?.email || '',
        assignedTechDistanceKm: nearest?.distanceKm || null,
        consumables: [],
        beforePhotoUrl: '',
        afterPhotoUrl: '',
        clientSignedOff: false,
        createdAt: new Date(),
      });
      setRequestSuccess(nearest ? `Assigned to ${nearest.name}` : 'Request submitted. No available tech found yet.');
      setRequestForm({ name: '', email: '', phone: '', location: '', service: '', details: '' });
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

  const handleDelete = async (jobId) => {
    try {
      await deleteDoc(doc(db, 'jobs', jobId));
    } catch (error) {
      console.error('Delete job failed', error);
      setAppError('Unable to delete job.');
    }
  };

  const currentJobs = profile
    ? profile.role === 'admin'
      ? jobs
      : profile.role === 'tech'
        ? jobs.filter((job) => job.assignedTechEmail === profile.email || job.assignedTechName === profile.displayName)
        : jobs.filter((job) => job.clientEmail === profile.email || job.client === profile.displayName)
    : [];

  const openRequestForm = profile?.role === 'client';
  const canViewInvoice = profile?.role === 'admin' || profile?.role === 'client';
  const activeJobsCount = currentJobs.filter((job) => job.status !== 'Completed').length;

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
            <div className="bg-blue-600 p-2 rounded-lg"><Briefcase size={24} className="text-white" /></div>
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
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Role</div>
            <div className="mt-4 text-4xl font-bold capitalize">{profile.role}</div>
            <div className="mt-2 text-slate-400">Platform access level</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Visible jobs</div>
            <div className="mt-4 text-4xl font-bold">{currentJobs.length}</div>
            <div className="mt-2 text-slate-400">Jobs available to you</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Open jobs</div>
            <div className="mt-4 text-4xl font-bold">{activeJobsCount}</div>
            <div className="mt-2 text-slate-400">Not yet completed</div>
          </div>
        </section>

        {(profile.role === 'admin' || profile.role === 'client') && (
          <section className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 mb-4 text-lg font-semibold"><Calendar size={20} /> {profile.role === 'client' ? 'Request service' : 'Client request form'}</div>
            <form onSubmit={submitRequest} className="grid gap-4">
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
              <label className="block">
                <span className="text-slate-300 text-sm">Details</span>
                <textarea
                  value={requestForm.details}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, details: e.target.value }))}
                  rows={3}
                  placeholder="Describe the issue or service request"
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              </label>
              {requestError && <div className="rounded-2xl bg-red-900/50 p-3 text-red-200">{requestError}</div>}
              {requestSuccess && <div className="rounded-2xl bg-emerald-900/50 p-3 text-emerald-200">{requestSuccess}</div>}
              <button type="submit" className="rounded-2xl bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-500 transition">
                Submit request
              </button>
            </form>
          </section>
        )}

        {profile.role === 'admin' && (
          <section className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 mb-4 text-lg font-semibold"><Wrench size={20} /> Add technician</div>
            <form onSubmit={addTechnician} className="grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  value={newTech.name}
                  onChange={(e) => setNewTech((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Technician name"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
                <input
                  value={newTech.email}
                  onChange={(e) => setNewTech((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="technician@example.com"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  value={newTech.phone}
                  onChange={(e) => setNewTech((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="Phone number"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
                <input
                  value={newTech.location}
                  onChange={(e) => setNewTech((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="Technician base location"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              </div>
              {techMessage && <div className="rounded-2xl bg-blue-900/50 p-3 text-blue-200">{techMessage}</div>}
              <button type="submit" className="rounded-2xl bg-emerald-600 px-5 py-3 text-white font-semibold hover:bg-emerald-500 transition flex items-center justify-center gap-2">
                <Plus size={16} /> Add tech
              </button>
            </form>
          </section>
        )}

        <section className="grid gap-6">
          {loading ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs…</div>
          ) : currentJobs.length === 0 ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">No jobs found.</div>
          ) : (
            <div className="space-y-6">
              {currentJobs.map((job) => {
                const total = calcInvoiceTotal(job.consumables || []);
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
                        </div>
                        <h2 className="text-xl font-semibold text-white">{job.client}</h2>
                        <p className="text-slate-400 mt-2">{job.location}</p>
                        <p className="text-slate-300 mt-3">{job.task}</p>
                        {job.details && <p className="text-slate-400 mt-2">{job.details}</p>}
                      </div>
                      <div className="space-y-2 text-right">
                        <div className="text-slate-400 text-sm">Assigned tech</div>
                        <div className="font-semibold">{job.assignedTechName || 'Unassigned'}</div>
                        {job.assignedTechDistanceKm != null && <div className="text-slate-400 text-sm">{job.assignedTechDistanceKm.toFixed(1)} km away</div>}
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
                              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">Missing</div>
                            )}
                            {profile.role === 'tech' && (
                              <label htmlFor={`before-${job.id}`} className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                <Camera size={16} /> Upload before
                              </label>
                            )}
                            <input id={`before-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job.id, 'before')} />
                          </div>
                          <div className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                            <div className="text-slate-300 text-sm mb-2">After photo</div>
                            {job.afterPhotoUrl ? (
                              <img src={job.afterPhotoUrl} alt="After" className="w-full rounded-2xl object-cover" />
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">Missing</div>
                            )}
                            {profile.role === 'tech' && (
                              <label htmlFor={`after-${job.id}`} className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
                                <Camera size={16} /> Upload after
                              </label>
                            )}
                            <input id={`after-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job.id, 'after')} />
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
                              {job.consumables.map((item, index) => (
                                <div key={`${job.id}-${index}`} className="rounded-2xl bg-slate-900 p-3 border border-slate-700">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-slate-100">{item.description}</p>
                                      <p className="text-slate-500 text-sm">Qty: {item.qty}</p>
                                    </div>
                                    {canViewInvoice ? (
                                      <div className="text-right text-slate-200">
                                        <div>${item.unitPrice.toFixed(2)} each</div>
                                        <div className="text-slate-400 text-sm">${(item.qty * item.unitPrice).toFixed(2)}</div>
                                      </div>
                                    ) : (
                                      <div className="text-slate-400 text-sm">Amount hidden</div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {profile.role === 'tech' && (
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
                        {canViewInvoice && (
                          <div className="mt-4 rounded-2xl bg-slate-900 p-4 border border-slate-700">
                            <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                              <span>Total</span>
                              <span className="font-semibold text-slate-100">${total.toFixed(2)}</span>
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-slate-500 text-xs">Only admin and client see invoice amounts.</div>
                              {job.status !== 'Pending' && (
                                <button onClick={() => generateInvoicePdf(job)} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition">
                                  Download invoice
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2 text-slate-400 text-sm">
                        {job.clientPhone && <div>Phone: {job.clientPhone}</div>}
                        {job.clientEmail && <div>Email: {job.clientEmail}</div>}
                        {job.clientSignedOff && <div className="text-emerald-300">Client signed off</div>}
                      </div>
                      <div className="flex flex-wrap gap-3">
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
                        {profile.role === 'admin' && job.status === 'Completed' && (
                          <div className="rounded-2xl bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">Closed</div>
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
        </section>
      </main>
    </div>
  );
}

export default App;
