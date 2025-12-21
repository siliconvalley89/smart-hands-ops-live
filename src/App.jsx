import React, { useState, useEffect } from 'react';
import { db } from './firebase'; 
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { 
  Briefcase, Wrench, Eye, Clock, DollarSign, Calendar, MapPin, Trash2, CheckCircle
} from 'lucide-react';

function App() {
  const [viewMode, setViewMode] = useState('manager'); 
  const [activeTab, setActiveTab] = useState('jobs'); 
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- 1. LISTEN TO DATABASE (Real-time connection) ---
  useEffect(() => {
    const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setJobs(jobsData);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- 2. ADD A NEW JOB (Function) ---
  const handleAddJob = async () => {
    const clientName = prompt("Client Name (e.g., Equinix):");
    if (!clientName) return;
    
    await addDoc(collection(db, "jobs"), {
      client: clientName,
      location: "San Jose, CA", 
      task: "New Ticket", 
      status: "In Progress",
      tech: "Unassigned",
      time: "Pending", 
      revenue: 0,
      createdAt: new Date()
    });
  };

  // --- 3. DELETE JOB (Manager Only) ---
  const handleDelete = async (id) => {
    if (confirm("Delete this job?")) {
      await deleteDoc(doc(db, "jobs", id));
    }
  };

  // --- 4. UPDATE STATUS (Tech/Manager) ---
  const toggleStatus = async (job) => {
    const newStatus = job.status === 'In Progress' ? 'Completed' : 'In Progress';
    await updateDoc(doc(db, "jobs", job.id), { status: newStatus });
  };

  const totalRevenue = jobs.reduce((acc, job) => acc + (Number(job.revenue) || 0), 0);
  const activeJobsCount = jobs.filter(j => j.status === 'In Progress').length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-20">
      
      {/* NAVBAR */}
      <nav className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-50">
        <div className="flex justify-between items-center max-w-md mx-auto">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg"><Briefcase size={20} className="text-white" /></div>
            <h1 className="font-bold text-lg tracking-tight">Smart Hands<span className="text-blue-500">Ops</span></h1>
          </div>
          <div className="flex bg-slate-700 rounded-full p-1 gap-1">
            <button onClick={() => setViewMode('manager')} className={`p-2 rounded-full ${viewMode === 'manager' ? 'bg-blue-600' : 'text-slate-400'}`}><Briefcase size={16} /></button>
            <button onClick={() => setViewMode('tech')} className={`p-2 rounded-full ${viewMode === 'tech' ? 'bg-emerald-600' : 'text-slate-400'}`}><Wrench size={16} /></button>
            <button onClick={() => setViewMode('client')} className={`p-2 rounded-full ${viewMode === 'client' ? 'bg-purple-600' : 'text-slate-400'}`}><Eye size={16} /></button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="max-w-md mx-auto p-4 space-y-6">
        
        {/* STATS */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Active Jobs</div>
            <div className="text-2xl font-bold flex items-center gap-2">{activeJobsCount}<span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span></div>
          </div>
          {viewMode === 'manager' ? (
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Est. Revenue</div>
              <div className="text-2xl font-bold text-emerald-400">${totalRevenue}</div>
            </div>
          ) : (
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 opacity-50">
               <div className="text-slate-400 text-xs uppercase font-semibold mb-1">Mode</div>
               <div className="text-sm font-medium">{viewMode}</div>
            </div>
          )}
        </div>

        {/* JOB LIST */}
        <div className="space-y-4">
          {loading && <p className="text-center text-slate-500">Loading database...</p>}
          {!loading && jobs.length === 0 && <p className="text-center text-slate-500">No jobs yet. Click + to add one!</p>}
          
          {jobs.map((job) => (
            <div key={job.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700 relative overflow-hidden">
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${job.status === 'Completed' ? 'bg-emerald-500' : 'bg-blue-500'}`}></div>
              <div className="pl-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-bold text-white text-lg">{job.client}</h3>
                    <div className="flex items-center text-xs text-slate-400 mt-1"><MapPin size={12} className="mr-1" /> {job.location}</div>
                  </div>
                  <button onClick={() => toggleStatus(job)} className={`text-xs px-3 py-1 rounded-full font-medium border ${job.status === 'Completed' ? 'bg-emerald-900 border-emerald-700 text-emerald-400' : 'bg-blue-900 border-blue-700 text-blue-400'}`}>
                    {job.status}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-sm text-slate-300 mb-3"><Wrench size={14} className="text-slate-500" /><span>{job.task}</span></div>
                
                <div className="flex justify-between items-center border-t border-slate-700 pt-3 mt-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400"><Clock size={12} /> {job.time}</div>
                  
                  <div className="flex gap-3">
                    {viewMode === 'manager' && (<div className="font-bold text-emerald-400 text-sm">+${job.revenue}</div>)}
                    {viewMode === 'manager' && (
                      <button onClick={() => handleDelete(job.id)} className="text-red-400 hover:text-red-300"><Trash2 size={16} /></button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* ADD BUTTON (Manager Only) */}
      {viewMode === 'manager' && (
        <button onClick={handleAddJob} className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-full shadow-xl shadow-blue-900/20 active:scale-95 transition-transform">
          <Calendar size={24} />
        </button>
      )}

    </div>
  );
}

export default App;