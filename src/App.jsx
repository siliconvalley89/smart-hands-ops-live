import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Camera, MapPin, Briefcase, Plus, X, Download, Navigation, Clock, CheckSquare, Lock, LogOut } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, serverTimestamp, arrayUnion } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

// --- PASTE YOUR REAL FIREBASE CONFIG HERE ---
const firebaseConfig = {
  apiKey: "AIzaSyA_7MVsNQ4jJU1eO-Yfv9M_WQILopF2evk",
  authDomain: "smart-hands-live.firebaseapp.com",
  projectId: "smart-hands-live",
  storageBucket: "smart-hands-live.firebasestorage.app",
  messagingSenderId: "859653333476",
  appId: "1:859653333476:web:36aafadee67815bae2e7f1"
};
// ---------------------------------------------

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const CATALOG = [{name:'Cat6 Patch',price:15}, {name:'Fiber Patch',price:25}, {name:'SFP+ Optic',price:85}, {name:'Cage Nuts',price:10}];
const QUICK_NOTES = ["Reboot Successful", "Reseated Cable", "Visual Check OK", "Escorted Vendor", "Swapped HDD"];

function App() {
  // LOGIN STATE
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [pin, setPin] = useState('');
  const [userRole, setUserRole] = useState(''); // 'Admin', 'Phat', 'Matthew', 'Client'

  // APP STATE
  const [jobs, setJobs] = useState([]);
  const [showAddJob, setShowAddJob] = useState(false);
  const [newJob, setNewJob] = useState({ client: '', location: '', assignedTo: '' });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('In Progress');
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setJobs(jobsData);
    });
    return () => unsubscribe();
  }, []);

  // AUTO-DISPATCH
  useEffect(() => {
    if (newJob.location.toLowerCase().includes('san jose')) setNewJob(prev => ({ ...prev, assignedTo: 'Phat' }));
    else if (newJob.location.toLowerCase().includes('mountain')) setNewJob(prev => ({ ...prev, assignedTo: 'Matthew' }));
  }, [newJob.location]);

  // LOGIN HANDLER
  const handleLogin = (e) => {
    e.preventDefault();
    if (pin === '8888') { setUserRole('Admin'); setIsLoggedIn(true); }
    else if (pin === '1111') { setUserRole('Phat'); setIsLoggedIn(true); }
    else if (pin === '2222') { setUserRole('Matthew'); setIsLoggedIn(true); }
    else if (pin === '0000') { setUserRole('Client'); setIsLoggedIn(true); }
    else { alert("⛔ Access Denied: Invalid PIN"); setPin(''); }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUserRole('');
    setPin('');
  };

  const handleAddJob = async (e) => {
    e.preventDefault();
    if (!newJob.client || !newJob.location) return;
    await addDoc(collection(db, "jobs"), {
      client: newJob.client,
      location: newJob.location,
      assignedTo: newJob.assignedTo || 'Unassigned',
      status: 'Pending',
      createdAt: serverTimestamp(),
      basePrice: 150,
      partsTotal: 0,
      totalPrice: 150,
      parts: [],
      resolution: '',
      photoUrl: null 
    });
    setNewJob({ client: '', location: '', assignedTo: '' });
    setShowAddJob(false);
  };

  const handleDelete = async (id) => { if (confirm("Delete ticket?")) await deleteDoc(doc(db, "jobs", id)); };

  const toggleStatus = async (job) => {
    if (userRole === 'Client') return;
    if (job.status === 'In Progress' && !job.photoUrl) { alert("⚠️ Evidence Photo Required!"); return; }
    let updates = {};
    if (job.status === 'Pending') { updates.status = 'In Progress'; updates.gpsCheckIn = "37.3382, -121.8863"; }
    else if (job.status === 'In Progress') { updates.status = 'Completed'; }
    else { updates.status = 'In Progress'; }
    await updateDoc(doc(db, "jobs", job.id), updates);
  };

  const addPart = async (job, part) => {
    const newTotal = (job.basePrice || 150) + (job.partsTotal || 0) + part.price;
    await updateDoc(doc(db, "jobs", job.id), { parts: arrayUnion(part.name), partsTotal: (job.partsTotal || 0) + part.price, totalPrice: newTotal });
  };

  const addQuickNote = async (job, note) => {
    const currentNotes = job.resolution ? job.resolution + ", " : "";
    await updateDoc(doc(db, "jobs", job.id), { resolution: currentNotes + note });
  };

  const handleCameraClick = (jobId) => { if (fileInputRef.current) { fileInputRef.current.setAttribute("data-job-id", jobId); fileInputRef.current.click(); }};
  
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    const jobId = fileInputRef.current.getAttribute("data-job-id");
    if (!file || !jobId) return;
    setLoading(true);
    try {
      const storageRef = ref(storage, `evidence/${jobId}_${Date.now()}.jpg`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "jobs", jobId), { photoUrl: url });
      alert("✅ Uploaded!");
    } catch (error) { alert("Upload failed."); }
    setLoading(false);
  };

  const exportCSV = () => {
    const headers = ["Date", "Client", "Location", "Tech", "Status", "Total Price", "Resolution", "Evidence Link"];
    const rows = jobs.map(job => [
      job.createdAt?.toDate().toLocaleDateString() || 'N/A', `"${job.client}"`, `"${job.location}"`, job.assignedTo, job.status, `$${job.totalPrice}`, `"${job.resolution || ''}"`, job.photoUrl || ''
    ]);
    const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `smart_hands_report_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const getSLAStatus = (createdAt) => {
    if (!createdAt) return { text: "New", color: "text-blue-400" };
    const diffMins = Math.floor((new Date() - createdAt.toDate()) / 60000);
    const timeLeft = 60 - diffMins;
    if (timeLeft < 0) return { text: `Overdue ${Math.abs(timeLeft)}m`, color: "text-red-500 font-bold" };
    return { text: `${timeLeft}m left`, color: "text-green-400" };
  };

  // FILTER LOGIC
  const filteredJobs = jobs.filter(job => {
    const tabMatch = activeTab === job.status;
    let roleMatch = true;
    // Techs only see their own jobs
    if (userRole === 'Phat' || userRole === 'Matthew') roleMatch = job.assignedTo === userRole;
    return tabMatch && roleMatch;
  });

  // --- LOGIN SCREEN ---
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-600 p-3 rounded-xl"><Lock size={32} className="text-white" /></div>
          </div>
          <h2 className="text-2xl font-bold text-white text-center mb-2">Smart Hands Ops</h2>
          <p className="text-slate-400 text-center text-sm mb-6">Enter your access PIN</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input 
              type="tel" // Numeric keypad on mobile
              maxLength="4"
              placeholder="0000" 
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-center text-2xl text-white tracking-[0.5em] font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl text-lg transition-all">
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- MAIN APP ---
  return (
    <div className="min-h-screen bg-slate-900 text-gray-100 font-sans pb-24">
      <input type="file" accept="image/*" capture="environment" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
      
      {/* HEADER */}
      <div className="bg-slate-800 p-4 sticky top-0 z-10 shadow-lg border-b border-slate-700 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg"><Briefcase size={24} className="text-white" /></div>
          <div>
            <h1 className="font-bold text-lg tracking-tight leading-none">Smart Hands</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Logged in: <span className="text-blue-400">{userRole}</span></p>
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 bg-slate-700 rounded-lg text-slate-400 hover:text-white"><LogOut size={20}/></button>
      </div>

      {/* ADMIN TOOLBAR */}
      {userRole === 'Admin' && (
        <div className="px-4 mt-4 mb-2">
          <button onClick={exportCSV} className="w-full bg-slate-800 border border-slate-700 hover:bg-slate-700 text-green-400 font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-2 transition-all">
            <Download size={18} /> Download Monthly Report (CSV)
          </button>
        </div>
      )}

      {/* TABS */}
      <div className="flex p-2 bg-slate-900 sticky top-[72px] z-10 gap-2">
        {['Pending', 'In Progress', 'Completed'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-2 rounded-lg font-bold text-sm ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{tab}</button>
        ))}
      </div>

      <div className="px-4 space-y-4 mt-2">
        {filteredJobs.length === 0 && <div className="text-center text-slate-500 py-10 opacity-50">No {activeTab} tickets for {userRole}.</div>}

        {filteredJobs.map(job => {
          const sla = getSLAStatus(job.createdAt);
          return (
            <div key={job.id} className="bg-slate-800 rounded-xl p-5 border border-slate-700 shadow-md">
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-xl font-bold text-white">{job.client}</h3>
                {userRole === 'Admin' && <div className="text-xs font-mono text-green-400 font-bold bg-green-900/30 px-2 py-1 rounded">+${job.totalPrice}</div>}
              </div>

              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`} target="_blank" rel="noreferrer" className="flex items-center text-blue-400 text-sm mb-2 hover:underline">
                <Navigation size={14} className="mr-1" /> {job.location}
              </a>

              {job.status !== 'Completed' && <div className={`flex items-center text-xs mb-4 ${sla.color}`}><Clock size={12} className="mr-1" /> SLA: {sla.text}</div>}
              {job.resolution && <div className="mb-3 text-xs text-slate-400 italic border-l-2 border-slate-600 pl-2">"{job.resolution}"</div>}
              {job.parts && job.parts.length > 0 && <div className="mb-3 flex flex-wrap gap-1">{job.parts.map((p, i) => <span key={i} className="text-[10px] bg-slate-700 px-1 rounded text-slate-300">{p}</span>)}</div>}

              {userRole !== 'Client' && (
                <>
                  <div className="flex items-center gap-2 pt-4 border-t border-slate-700/50">
                    <button onClick={() => toggleStatus(job)} className={`flex-1 py-2 px-2 rounded-lg font-bold text-sm ${job.status === 'Completed' ? 'bg-green-600' : 'bg-blue-600'}`}>{job.status === 'Pending' ? 'Start' : job.status === 'In Progress' ? 'Complete' : 'Done'}</button>
                    {job.status === 'In Progress' && <button onClick={() => handleCameraClick(job.id)} className="p-2 rounded-lg bg-slate-700 border border-slate-600 text-blue-400"><Camera size={20} /></button>}
                    {userRole === 'Admin' && <button onClick={() => handleDelete(job.id)} className="ml-2 text-red-400"><Trash2 size={18} /></button>}
                  </div>
                  {job.status === 'In Progress' && (
                    <div className="mt-4 space-y-2">
                      <div className="flex gap-2 overflow-x-auto pb-1">{CATALOG.map(part => <button key={part.name} onClick={() => addPart(job, part)} className="whitespace-nowrap bg-slate-700 px-2 py-1 rounded text-[10px] border border-slate-600 hover:bg-slate-600">+{part.name}</button>)}</div>
                      <div className="flex gap-2 overflow-x-auto pb-1">{QUICK_NOTES.map(note => <button key={note} onClick={() => addQuickNote(job, note)} className="whitespace-nowrap bg-slate-700 px-2 py-1 rounded text-[10px] border border-slate-600 hover:bg-slate-600 flex items-center gap-1"><CheckSquare size={10}/> {note}</button>)}</div>
                    </div>
                  )}
                </>
              )}
              {job.photoUrl && <div className="mt-3"><img src={job.photoUrl} alt="Proof" className="h-20 w-20 object-cover rounded-lg border border-slate-600" /></div>}
            </div>
          );
        })}
      </div>

      {userRole === 'Admin' && <button onClick={() => setShowAddJob(true)} className="fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-full shadow-2xl"><Plus size={28} /></button>}

      {showAddJob && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 w-full max-w-md rounded-2xl p-6 border border-slate-700">
             <div className="flex justify-between mb-6"><h2 className="text-xl font-bold text-white">New Ticket</h2><button onClick={() => setShowAddJob(false)}><X size={20} /></button></div>
            <form onSubmit={handleAddJob} className="space-y-4">
              <input type="text" placeholder="Client" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white" value={newJob.client} onChange={e => setNewJob({...newJob, client: e.target.value})} />
              <input type="text" placeholder="Location" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white" value={newJob.location} onChange={e => setNewJob({...newJob, location: e.target.value})} />
              <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">Create</button>
            </form>
          </div>
        </div>
      )}
      {loading && <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center"><div className="bg-white text-black p-4 rounded-lg">Uploading...</div></div>}
    </div>
  );
}

export default App;