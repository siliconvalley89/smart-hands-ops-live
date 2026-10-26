import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { geocodeAddress } from '../lib/geocode';

const EMPTY_FORM = {
  client: '',
  clientEmail: '',
  clientPhone: '',
  location: '',
  task: '',
  details: '',
  serialNumber: '',
  frequency: 'monthly',
  firstVisit: '',
};

const FREQUENCY_LABELS = { weekly: 'Weekly', monthly: 'Monthly' };
const toDate = (value) => (value?.toDate ? value.toDate() : value ? new Date(value) : null);
const formatDay = (date) => (date ? date.toLocaleDateString() : '—');

export default function MaintenanceContracts({ recordedBy }) {
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => onSnapshot(
    collection(db, 'maintenanceContracts'),
    (snapshot) => setContracts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    (snapshot_error) => {
      console.error('Unable to load maintenance contracts', snapshot_error);
      setError('Unable to load maintenance contracts.');
    },
  ), []);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const createContract = async () => {
    setError('');
    if (!form.client.trim() || !form.location.trim() || !form.task.trim() || !form.firstVisit) {
      setError('Client, location, task, and first visit are required.');
      return;
    }
    setSaving(true);
    try {
      const geo = await geocodeAddress(form.location).catch(() => null);
      if (!geo) {
        setError('Unable to locate that address. Include the street, city, and state.');
        return;
      }
      await addDoc(collection(db, 'maintenanceContracts'), {
        client: form.client.trim(),
        clientEmail: form.clientEmail.trim().toLowerCase(),
        clientPhone: form.clientPhone.trim(),
        location: geo.displayName,
        rawLocation: form.location.trim(),
        lat: geo.lat,
        lng: geo.lng,
        task: form.task.trim(),
        details: form.details.trim(),
        serialNumber: form.serialNumber.trim(),
        frequency: form.frequency,
        active: true,
        nextRunAt: new Date(`${form.firstVisit}T09:00:00`),
        createdBy: recordedBy,
        createdAt: serverTimestamp(),
      });
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error('Create maintenance contract failed', err);
      setError('Unable to save the contract.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (contract) => {
    setError('');
    try {
      await updateDoc(doc(db, 'maintenanceContracts', contract.id), { active: !contract.active, updatedBy: recordedBy });
    } catch (err) {
      console.error('Update maintenance contract failed', err);
      setError('Unable to update the contract.');
    }
  };

  const removeContract = async (contract) => {
    if (!window.confirm(`Delete the maintenance contract for ${contract.client}? Visits already created are not affected.`)) return;
    setError('');
    try {
      await deleteDoc(doc(db, 'maintenanceContracts', contract.id));
    } catch (err) {
      console.error('Delete maintenance contract failed', err);
      setError('Unable to delete the contract.');
    }
  };

  const sorted = [...contracts].sort((a, b) => (toDate(a.nextRunAt)?.getTime() ?? 0) - (toDate(b.nextRunAt)?.getTime() ?? 0));

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <h2 className="text-xl font-semibold text-white">Maintenance contracts</h2>
        <p className="text-slate-400 text-sm mt-1">
          Recurring visits are created as Pending jobs up to a week ahead, each morning at 6:00 AM Pacific.
        </p>
      </div>

      <div className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <input value={form.client} onChange={update('client')} placeholder="Client name" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
          <input value={form.clientEmail} onChange={update('clientEmail')} placeholder="Client email (login)" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
          <input value={form.clientPhone} onChange={update('clientPhone')} placeholder="Client phone" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
          <input value={form.location} onChange={update('location')} placeholder="Site address" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
          <input value={form.task} onChange={update('task')} placeholder="Task (e.g. Quarterly UPS battery check)" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
          <input value={form.serialNumber} onChange={update('serialNumber')} placeholder="Equipment serial (optional)" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
        </div>
        <textarea value={form.details} onChange={update('details')} rows={3} placeholder="Visit details (optional)" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
        <div className="grid gap-4 md:grid-cols-2">
          <select value={form.frequency} onChange={update('frequency')} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <label className="grid gap-1 text-sm text-slate-400">
            First visit
            <input type="date" value={form.firstVisit} onChange={update('firstVisit')} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
          </label>
        </div>
        {error && <div className="rounded-2xl bg-rose-900/40 p-3 text-rose-200">{error}</div>}
        <button type="button" disabled={saving} onClick={createContract} className="rounded-2xl bg-indigo-600 px-5 py-3 text-white font-semibold hover:bg-indigo-500 transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Add maintenance contract'}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-3xl bg-slate-950/70 p-8 text-center text-slate-400">No maintenance contracts yet.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((contract) => (
            <div key={contract.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-slate-100">{contract.client || 'Unnamed client'} · {contract.task || 'Service'}</div>
                <div className="text-slate-400 text-sm">{contract.location || contract.rawLocation || 'No address'}</div>
                <div className="text-slate-500 text-xs mt-1">
                  {FREQUENCY_LABELS[contract.frequency] || contract.frequency} · Next visit {formatDay(toDate(contract.nextRunAt))} · {contract.active ? 'Active' : 'Paused'}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => toggleActive(contract)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition">
                  {contract.active ? 'Pause' : 'Resume'}
                </button>
                <button type="button" onClick={() => removeContract(contract)} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
