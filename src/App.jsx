import React, { useState, useEffect } from 'react';
import { db, storage } from './firebase'; 
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, updateDoc, getDocs, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  Briefcase, Wrench, Eye, Clock, Calendar, MapPin, Trash2, Camera, Loader2, LogOut, ShieldCheck, UserPlus, Phone, Mail, Map, ClipboardList
} from 'lucide-react';

const accessCodes = {
  'ADMIN-2026': { id: 'admin-001', role: 'admin', name: 'Operations Admin', email: 'admin@siliconvalleysmarthands.com' },
  'TECH-JOHN': { id: 'tech-john', role: 'tech', name: 'John Tech', email: 'john@siliconvalleysmarthands.com' },
  'TECH-MIA': { id: 'tech-mia', role: 'tech', name: 'Mia Tech', email: 'mia@siliconvalleysmarthands.com' },
  'CLIENT-ALICE': { id: 'client-alice', role: 'client', name: 'Alice', email: 'alice@example.com' },
  'CLIENT-BOB': { id: 'client-bob', role: 'client', name: 'Bob', email: 'bob@example.com' },
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
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem('smartHandsAuth');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginCode, setLoginCode] = useState('');
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestForm, setRequestForm] = useState({
    name: auth?.name || '',
    email: auth?.email || '',
    phone: '',
    location: '',
    service: '',
    details: '',
  });
  const [newTech, setNewTech] = useState({ name: '', email: '', phone: '' });
  const [manualJob, setManualJob] = useState({ client: '', phone: '', email: '', location: '', task: '', details: '' });

  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setJobs(jobsData);
      setLoading(false);
    });

    const techQuery = query(collection(db, 'technicians'), orderBy('name', 'asc'));
    const techUnsubscribe = onSnapshot(techQuery, (snapshot) => {
      const techData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setTechs(techData);
    });

    return () => {
      unsubscribe();
      techUnsubscribe();
    };
  }, []);

  useEffect(() => {
    setRequestForm((prev) => ({
      ...prev,
      name: auth?.name || prev.name,
      email: auth?.email || prev.email,
    }));
  }, [auth]);

  const login = () => {
    const normalized = loginCode.trim().toUpperCase();
    const user = accessCodes[normalized];
    if (!user) {
      alert('Invalid access code. Please try again.');
      return;
    }
    setAuth(user);
    localStorage.setItem('smartHandsAuth', JSON.stringify(user));
    setLoginCode('');
  };

  const logout = () => {
    setAuth(null);
    localStorage.removeItem('smartHandsAuth');
  };

  const geocodeAddress = async (address) => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
    const results = await response.json();
    if (!results || results.length === 0) {
      throw new Error('Could not find that address.');
    }
    return {
      lat: Number(results[0].lat),
      lng: Number(results[0].lon),
      displayName: results[0].display_name,
    };
  };

  const findNearestTechnician = async (clientLat, clientLng) => {
    const techSnapshot = await getDocs(query(collection(db, 'technicians'), where('status', '==', 'available')));
    let nearest = null;
    techSnapshot.forEach((docSnapshot) => {
      const tech = { id: docSnapshot.id, ...docSnapshot.data() };
      if (tech.lat == null || tech.lng == null) return;
      const distanceKm = calculateDistanceKm(clientLat, clientLng, tech.lat, tech.lng);
      if (!nearest || distanceKm < nearest.distanceKm) {
        nearest = { ...tech, distanceKm };
      }
    });
    return nearest;
  };

  const assignTechFromLocation = async (lat, lng) => {
    try {
      const nearestTech = await findNearestTechnician(lat, lng);
      if (!nearestTech) {
        return { assignedTechId: '', assignedTechName: '', assignedTechEmail: '', assignedTechDistanceKm: null };
      }
      await updateDoc(doc(db, 'technicians', nearestTech.id), { status: 'busy' });
      return {
        assignedTechId: nearestTech.id,
        assignedTechName: nearestTech.name,
        assignedTechEmail: nearestTech.email || '',
        assignedTechDistanceKm: nearestTech.distanceKm,
      };
    } catch (error) {
      console.error('Assign tech failed', error);
      return { assignedTechId: '', assignedTechName: '', assignedTechEmail: '', assignedTechDistanceKm: null };
    }
  };

  const createNewJob = async (jobData) => {
    await addDoc(collection(db, 'jobs'), {
      ...jobData,
      status: jobData.assignedTechId ? 'Dispatched' : 'Pending',
      createdAt: new Date(),
      photoUrl: '',
      requestSource: 'website',
    });
  };

  const handleClientSubmit = async (event) => {
    event.preventDefault();
    setRequestError('');
    setRequestSuccess('');
    setRequestLoading(true);

    try {
      if (!requestForm.name || !requestForm.email || !requestForm.phone || !requestForm.location || !requestForm.service) {
        throw new Error('Please complete every required field.');
      }
      const geo = await geocodeAddress(requestForm.location);
      const assignment = await assignTechFromLocation(geo.lat, geo.lng);
      await createNewJob({
        client: requestForm.name,
        clientEmail: requestForm.email,
        clientPhone: requestForm.phone,
        location: geo.displayName,
        rawLocation: requestForm.location,
        lat: geo.lat,
        lng: geo.lng,
        task: requestForm.service,
        details: requestForm.details,
        assignedTechId: assignment.assignedTechId,
        assignedTechName: assignment.assignedTechName,
        assignedTechEmail: assignment.assignedTechEmail,
        assignedTechDistanceKm: assignment.assignedTechDistanceKm,
      });
      setRequestSuccess('Request submitted. A technician will be dispatched automatically.');
      setRequestForm((prev) => ({ ...prev, phone: '', location: '', service: '', details: '' }));
    } catch (error) {
      setRequestError(error.message || 'Failed to submit request.');
    } finally {
      setRequestLoading(false);
    }
  };

  const handlePhotoUpload = async (event, jobId) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadingId(jobId);
    try {
      const storageRef = ref(storage, `job-photos/${jobId}-${Date.now()}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'jobs', jobId), { photoUrl: url });
    } catch (error) {
      console.error('Upload failed', error);
      alert('Upload failed.');
    }
    setUploadingId(null);
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this job?')) {
      await deleteDoc(doc(db, 'jobs', id));
    }
  };

  const handleToggleStatus = async (job) => {
    if ((job.status === 'In Progress' || job.status === 'Dispatched') && !job.photoUrl) {
      alert('Please upload evidence before marking this job complete.');
      return;
    }
    const nextStatus = job.status === 'Completed' ? 'In Progress' : 'Completed';
    await updateDoc(doc(db, 'jobs', job.id), { status: nextStatus });
    if (nextStatus === 'Completed' && job.assignedTechId) {
      await updateDoc(doc(db, 'technicians', job.assignedTechId), { status: 'available' });
    }
  };

  const handleAddTechnician = async (event) => {
    event.preventDefault();
    if (!newTech.name || !newTech.email) return;
    await addDoc(collection(db, 'technicians'), {
      ...newTech,
      status: 'available',
      createdAt: new Date(),
    });
    setNewTech({ name: '', email: '', phone: '' });
  };

  const handleManualJobSubmit = async (event) => {
    event.preventDefault();
    if (!manualJob.client || !manualJob.location || !manualJob.task) {
      alert('Client, location and task are required.');
      return;
    }
    try {
      const geo = await geocodeAddress(manualJob.location);
      const assignment = await assignTechFromLocation(geo.lat, geo.lng);
      await createNewJob({
        client: manualJob.client,
        clientEmail: manualJob.email,
        clientPhone: manualJob.phone,
        location: geo.displayName,
        rawLocation: manualJob.location,
        lat: geo.lat,
        lng: geo.lng,
        task: manualJob.task,
        details: manualJob.details,
        assignedTechId: assignment.assignedTechId,
        assignedTechName: assignment.assignedTechName,
        assignedTechEmail: assignment.assignedTechEmail,
        assignedTechDistanceKm: assignment.assignedTechDistanceKm,
      });
      setManualJob({ client: '', phone: '', email: '', location: '', task: '', details: '' });
      alert('Manual request created and dispatched if a tech was available.');
    } catch (error) {
      alert(error.message || 'Could not create manual job.');
    }
  };

  const clientJobs = auth?.role === 'client' ? jobs.filter((job) => job.clientEmail === auth.email || job.client === auth.name) : [];
  const techJobs = auth?.role === 'tech' ? jobs.filter((job) => job.assignedTechEmail === auth.email || job.assignedTechName === auth.name) : [];
  const visibleJobs = auth?.role === 'admin' ? jobs : auth?.role === 'tech' ? techJobs : auth?.role === 'client' ? clientJobs : [];

  const totalJobs = jobs.length;
  const dispatchedJobs = jobs.filter((job) => job.status === 'Dispatched' || job.status === 'In Progress').length;
  const pendingJobs = jobs.filter((job) => job.status === 'Pending').length;
  const availableTechCount = techs.filter((tech) => tech.status === 'available').length;

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-3xl p-8 shadow-2xl shadow-slate-950/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-600 p-3 rounded-xl"><ShieldCheck size={24} /></div>
            <div>
              <h1 className="text-2xl font-bold">Dispatch Access</h1>
              <p className="text-slate-400 text-sm">Enter your access code to continue.</p>
            </div>
          </div>
          <label className="block text-slate-400 text-sm mb-2">Access Code</label>
          <input
            value={loginCode}
            onChange={(e) => setLoginCode(e.target.value)}
            placeholder="e.g. ADMIN-2026"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-blue-500"
          />
          <button onClick={login} className="mt-5 w-full rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 transition">
            Sign in
          </button>
          <div className="text-slate-500 text-xs mt-4">Use one code for admin, tech, or client access. This is a prototype ACL layer; replace with Firebase Auth for production.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-20">
      <nav className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-50">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg"><Briefcase size={24} className="text-white" /></div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">Smart Hands Dispatch</h1>
              <p className="text-slate-400 text-sm">Signed in as {auth.name} • {auth.role.toUpperCase()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={logout} className="rounded-full bg-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-600 flex items-center gap-2">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 space-y-6">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700">
            <div className="flex items-center gap-3 text-slate-400 text-sm uppercase tracking-[0.2em]">Jobs</div>
            <div className="mt-4 text-3xl font-bold">{totalJobs}</div>
            <div className="mt-2 text-slate-400">Total jobs in queue</div>
          </div>
          <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700">
            <div className="flex items-center gap-3 text-slate-400 text-sm uppercase tracking-[0.2em]">Dispatched</div>
            <div className="mt-4 text-3xl font-bold">{dispatchedJobs}</div>
            <div className="mt-2 text-slate-400">Active or assigned work</div>
          </div>
          <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700">
            <div className="flex items-center gap-3 text-slate-400 text-sm uppercase tracking-[0.2em]">Available techs</div>
            <div className="mt-4 text-3xl font-bold">{availableTechCount}</div>
            <div className="mt-2 text-slate-400">Techs ready for dispatch</div>
          </div>
        </section>

        {auth.role === 'client' && (
          <section className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 mb-6 text-lg font-semibold">
              <UserPlus size={20} /> Submit a service request
            </div>
            <form onSubmit={handleClientSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Name</span>
                  <input value={requestForm.name} readOnly className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">Email</span>
                  <input value={requestForm.email} readOnly className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Phone</span>
                  <input value={requestForm.phone} onChange={(e) => setRequestForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="(408) 409-8115" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">Location</span>
                  <input value={requestForm.location} onChange={(e) => setRequestForm((prev) => ({ ...prev, location: e.target.value }))} placeholder="123 Main St, San Jose, CA" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-slate-300 text-sm">Service requested</span>
                  <input value={requestForm.service} onChange={(e) => setRequestForm((prev) => ({ ...prev, service: e.target.value }))} placeholder="Network repair, server install, etc." className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                </label>
                <label className="block">
                  <span className="text-slate-300 text-sm">Additional details</span>
                  <input value={requestForm.details} onChange={(e) => setRequestForm((prev) => ({ ...prev, details: e.target.value }))} placeholder="What needs to be done?" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
                </label>
              </div>
              {requestError && <div className="rounded-2xl bg-red-900/50 border border-red-700 p-3 text-red-200">{requestError}</div>}
              {requestSuccess && <div className="rounded-2xl bg-emerald-900/50 border border-emerald-700 p-3 text-emerald-200">{requestSuccess}</div>}
              <button disabled={requestLoading} className="w-full rounded-2xl bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-500 transition disabled:opacity-50">
                {requestLoading ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>
          </section>
        )}

        {auth.role === 'admin' && (
          <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                <div className="flex items-center gap-3 mb-5 text-lg font-semibold"><ClipboardList size={20} /> Manual dispatch</div>
                <form onSubmit={handleManualJobSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block"><span className="text-slate-300 text-sm">Client name</span><input value={manualJob.client} onChange={(e) => setManualJob((prev) => ({ ...prev, client: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                    <label className="block"><span className="text-slate-300 text-sm">Phone</span><input value={manualJob.phone} onChange={(e) => setManualJob((prev) => ({ ...prev, phone: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block"><span className="text-slate-300 text-sm">Email</span><input value={manualJob.email} onChange={(e) => setManualJob((prev) => ({ ...prev, email: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                    <label className="block"><span className="text-slate-300 text-sm">Location</span><input value={manualJob.location} onChange={(e) => setManualJob((prev) => ({ ...prev, location: e.target.value }))} placeholder="Office address or client site" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                  </div>
                  <label className="block"><span className="text-slate-300 text-sm">Service task</span><input value={manualJob.task} onChange={(e) => setManualJob((prev) => ({ ...prev, task: e.target.value }))} placeholder="What needs attention?" className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                  <label className="block"><span className="text-slate-300 text-sm">Details</span><textarea value={manualJob.details} onChange={(e) => setManualJob((prev) => ({ ...prev, details: e.target.value }))} rows={3} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                  <button className="rounded-2xl bg-emerald-600 px-5 py-3 text-white font-semibold hover:bg-emerald-500 transition">Create manual request</button>
                </form>
              </div>
              <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
                <div className="flex items-center gap-3 mb-5 text-lg font-semibold"><UserPlus size={20} /> Add technician</div>
                <form onSubmit={handleAddTechnician} className="space-y-4">
                  <label className="block"><span className="text-slate-300 text-sm">Name</span><input value={newTech.name} onChange={(e) => setNewTech((prev) => ({ ...prev, name: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block"><span className="text-slate-300 text-sm">Email</span><input value={newTech.email} onChange={(e) => setNewTech((prev) => ({ ...prev, email: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                    <label className="block"><span className="text-slate-300 text-sm">Phone</span><input value={newTech.phone} onChange={(e) => setNewTech((prev) => ({ ...prev, phone: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                  </div>
                  <button className="rounded-2xl bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-500 transition">Add technician</button>
                </form>
              </div>
            </div>
            <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
              <div className="flex items-center gap-3 mb-5 text-lg font-semibold"><Map size={20} /> Technician roster</div>
              <div className="space-y-3">
                {techs.map((tech) => (
                  <div key={tech.id} className="rounded-2xl border border-slate-700 p-4 bg-slate-950/50">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">{tech.name}</div>
                        <div className="text-xs text-slate-400">{tech.email || 'No email provided'}</div>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs ${tech.status === 'available' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-orange-500/15 text-orange-300 border border-orange-500/20'}`}>{tech.status}</div>
                    </div>
                    {tech.phone && <div className="text-slate-400 text-sm mt-2">{tech.phone}</div>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
          <div className="flex items-center gap-3 mb-5 text-lg font-semibold"><Briefcase size={20} /> {auth.role === 'admin' ? 'All Requests' : auth.role === 'tech' ? 'Assigned Work' : 'Your Requests'}</div>
          {loading ? (
            <div className="rounded-3xl bg-slate-950/50 p-8 text-center text-slate-400">Loading requests...</div>
          ) : visibleJobs.length === 0 ? (
            <div className="rounded-3xl bg-slate-950/50 p-8 text-center text-slate-400">No requests found yet.</div>
          ) : (
            <div className="space-y-4">
              {visibleJobs.map((job) => (
                <div key={job.id} className="bg-slate-950/70 rounded-3xl p-5 border border-slate-700">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-[0.2em] mb-2">{job.status}</div>
                      <h2 className="text-xl font-semibold">{job.client}</h2>
                      <div className="text-slate-400 text-sm mt-1">{job.task}</div>
                    </div>
                    <div className="text-right space-y-2">
                      <div className="text-slate-400 text-sm">{job.location}</div>
                      {job.assignedTechName && <div className="text-slate-300 text-sm">Assigned: {job.assignedTechName}</div>}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-slate-300 text-sm">
                    <div><span className="font-semibold text-slate-100">Client phone:</span> {job.clientPhone || 'n/a'}</div>
                    <div><span className="font-semibold text-slate-100">Requested:</span> {new Date(job.createdAt?.toDate ? job.createdAt.toDate() : job.createdAt).toLocaleString()}</div>
                  </div>
                  {job.details && <p className="mt-4 text-slate-300 text-sm">{job.details}</p>}
                  <div className="mt-4 flex flex-wrap gap-3 items-center">
                    {(auth.role === 'admin' || auth.role === 'tech') && (
                      <button onClick={() => handleToggleStatus(job)} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition">
                        {job.status === 'Completed' ? 'Reopen' : 'Mark Completed'}
                      </button>
                    )}
                    {(auth.role === 'admin') && (
                      <button onClick={() => handleDelete(job.id)} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition">Delete</button>
                    )}
                    {!job.photoUrl && (auth.role === 'tech' || auth.role === 'admin') && (
                      <label htmlFor={`file-${job.id}`} className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
                        <Camera size={16} /> Upload evidence
                      </label>
                    )}
                    {job.photoUrl && <a href={job.photoUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600 transition">View evidence</a>}
                  </div>
                  <input id={`file-${job.id}`} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, job.id)} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;