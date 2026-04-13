import React, { useState, useEffect } from 'react';
import { db, storage } from './firebase';
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Briefcase,
  Wrench,
  Clock,
  Calendar,
  MapPin,
  Trash2,
  Camera,
  Loader2,
  ShieldCheck,
  Lock,
  User,
  DollarSign,
  List,
  CheckCircle,
  Plus,
  LogOut,
  FileText,
  CheckSquare,
} from 'lucide-react';

const accessCodes = {
  'ADMIN-2026': { id: 'admin-001', role: 'admin', name: 'Admin User', email: 'admin@siliconvalleysmarthands.com', pin: '1111' },
  'TECH-JOHN': { id: 'tech-001', role: 'tech', name: 'John Tech', email: 'john@siliconvalleysmarthands.com', pin: '2222' },
  'TECH-MIA': { id: 'tech-002', role: 'tech', name: 'Mia Tech', email: 'mia@siliconvalleysmarthands.com', pin: '3333' },
  'CLIENT-ALICE': { id: 'client-001', role: 'client', name: 'Alice Client', email: 'alice@customer.com', pin: '4444' },
  'CLIENT-BOB': { id: 'client-002', role: 'client', name: 'Bob Client', email: 'bob@customer.com', pin: '5555' },
};

const formatDate = (value) => {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString();
  return new Date(value).toLocaleString();
};

const calcInvoiceTotal = (items = []) => {
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitPrice || 0)), 0);
};

function App() {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem('smartHandsAuth');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginCode, setLoginCode] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [newConsumable, setNewConsumable] = useState({ description: '', qty: 1, unitPrice: '' });

  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobItems = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      setJobs(jobItems);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = () => {
    const normalized = loginCode.trim().toUpperCase();
    const pin = loginPin.trim();
    const user = accessCodes[normalized];
    if (!user || user.pin !== pin) {
      setLoginError('Invalid code or PIN');
      return;
    }
    setAuth(user);
    localStorage.setItem('smartHandsAuth', JSON.stringify(user));
    setLoginCode('');
    setLoginPin('');
    setLoginError('');
  };

  const logout = () => {
    setAuth(null);
    localStorage.removeItem('smartHandsAuth');
  };

  const handleAddJob = async () => {
    const clientName = prompt('Client name');
    if (!clientName) return;
    const location = prompt('Location / address') || 'Unknown address';
    const task = prompt('Service requested') || 'Service request';
    const assignedTechName = prompt('Assigned tech name (leave blank for unassigned)') || 'Unassigned';
    const assignedTechEmail = assignedTechName && assignedTechName !== 'Unassigned' ? prompt('Assigned tech email (optional)') || '' : '';

    await addDoc(collection(db, 'jobs'), {
      client: clientName,
      clientEmail: '',
      clientPhone: '',
      location,
      task,
      details: '',
      status: assignedTechName === 'Unassigned' ? 'Requested' : 'Dispatched',
      assignedTechName,
      assignedTechEmail,
      consumables: [],
      beforePhotoUrl: '',
      afterPhotoUrl: '',
      clientSignedOff: false,
      createdAt: new Date(),
    });
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this job?')) {
      await deleteDoc(doc(db, 'jobs', id));
    }
  };

  const handlePhotoUpload = async (event, jobId, type) => {
    const file = event.target.files[0];
    if (!file) return;
    setUploadingId(jobId);
    try {
      const storageRef = ref(storage, `job-photos/${jobId}-${type}-${Date.now()}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'jobs', jobId), { [`${type}PhotoUrl`]: url });
    } catch (error) {
      console.error('Upload failed', error);
      alert('Upload failed.');
    }
    setUploadingId(null);
  };

  const handleAddConsumable = async (job) => {
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

  const requestSignoff = async (job) => {
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

  const currentJobs = auth?.role === 'admin'
    ? jobs
    : auth?.role === 'tech'
      ? jobs.filter((job) => job.assignedTechEmail === auth.email || job.assignedTechName === auth.name)
      : jobs.filter((job) => job.clientEmail === auth.email || job.client === auth.name);

  const activeJobsCount = currentJobs.filter((job) => job.status !== 'Completed').length;

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-3xl p-8 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="bg-blue-600 p-3 rounded-xl"><Lock size={24} /></div>
            <div>
              <h1 className="text-2xl font-bold">Smart Hands Login</h1>
              <p className="text-slate-400 text-sm">Enter a code and PIN for admin, technician, or client access.</p>
            </div>
          </div>
          <div className="space-y-4">
            <label className="block text-slate-300 text-sm">Access Code</label>
            <input
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value)}
              placeholder="ADMIN-2026"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
            />
            <label className="block text-slate-300 text-sm">PIN</label>
            <input
              type="password"
              value={loginPin}
              onChange={(e) => setLoginPin(e.target.value)}
              placeholder="1234"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none"
            />
            {loginError && <div className="rounded-2xl bg-red-900/50 p-3 text-red-200">{loginError}</div>}
            <button onClick={login} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 transition">
              Sign in
            </button>
            <p className="text-slate-500 text-xs">This is a prototype access system. Replace with Firebase Auth for production.</p>
          </div>
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
              <div className="text-slate-400 text-sm">Signed in as {auth.name}</div>
              <h1 className="text-xl font-bold">Smart Hands Dispatch</h1>
            </div>
          </div>
          <button onClick={logout} className="rounded-2xl bg-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-600 flex items-center gap-2">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Jobs</div>
            <div className="mt-4 text-4xl font-bold">{currentJobs.length}</div>
            <div className="mt-2 text-slate-400">Jobs visible to your role</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Active</div>
            <div className="mt-4 text-4xl font-bold">{activeJobsCount}</div>
            <div className="mt-2 text-slate-400">Open or awaiting signoff</div>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex items-center gap-3 text-slate-400 uppercase tracking-[0.2em] text-xs">Role</div>
            <div className="mt-4 text-4xl font-bold">{auth.role}</div>
            <div className="mt-2 text-slate-400">{auth.role === 'admin' ? 'Admin access' : auth.role === 'tech' ? 'Technician access' : 'Client access'}</div>
          </div>
        </section>

        {auth.role === 'admin' && (
          <div className="flex flex-col gap-4 lg:flex-row">
            <button onClick={handleAddJob} className="rounded-3xl bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-500 transition flex items-center gap-2">
              <Calendar size={18} /> Add manual request
            </button>
          </div>
        )}

        <section className="grid gap-6">
          {loading ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">Loading jobs…</div>
          ) : currentJobs.length === 0 ? (
            <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">No jobs found for your role yet.</div>
          ) : (
            <div className="space-y-6">
              {currentJobs.map((job) => {
                const canViewInvoice = auth.role === 'admin' || auth.role === 'client';
                const total = calcInvoiceTotal(job.consumables || []);
                const beforeUploaded = Boolean(job.beforePhotoUrl);
                const afterUploaded = Boolean(job.afterPhotoUrl);
                const canRequestSignoff = auth.role === 'tech' && job.status === 'In Progress' && beforeUploaded && afterUploaded;
                const canClientSignoff = auth.role === 'client' && job.status === 'Ready for Signoff' && !job.clientSignedOff;

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
                            {auth.role === 'tech' && (
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
                            {auth.role === 'tech' && (
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
                        {auth.role === 'tech' && (
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
                            <button onClick={() => handleAddConsumable(job)} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-500 transition flex items-center justify-center gap-2">
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
                            <div className="text-slate-500 text-xs">Only admin and client can see amounts.</div>
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
                        {auth.role === 'tech' && canRequestSignoff && (
                          <button onClick={() => requestSignoff(job)} className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 transition flex items-center gap-2">
                            <FileText size={16} /> Request sign-off
                          </button>
                        )}
                        {auth.role === 'client' && canClientSignoff && (
                          <button onClick={() => handleClientSignoff(job)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition flex items-center gap-2">
                            <CheckCircle size={16} /> Sign off work
                          </button>
                        )}
                        {auth.role === 'admin' && job.status === 'Completed' && (
                          <div className="rounded-2xl bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">Closed</div>
                        )}
                        {auth.role === 'admin' && (
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
