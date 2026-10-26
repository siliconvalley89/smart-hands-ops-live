import { useEffect, useState } from 'react';
import { addDoc, collection, onSnapshot, query, where } from 'firebase/firestore';
import { CalendarClock } from 'lucide-react';
import { auth, db } from '../firebase';
import { formatDate } from '../lib/jobDisplay';
import { toMillis } from '../lib/jobTime';
import { localInputToMillis } from '../lib/reschedule';

const NOTE_MAX = 500;

export default function RescheduleRequestForm({ job }) {
  const clientEmail = auth.currentUser?.email || '';
  const [requests, setRequests] = useState([]);
  const [note, setNote] = useState('');
  const [preferred, setPreferred] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientEmail) return undefined;
    const q = query(
      collection(db, 'rescheduleRequests'),
      where('clientEmail', '==', clientEmail),
      where('jobId', '==', job.id),
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0));
        setRequests(rows);
      },
      (err) => {
        console.error('Reschedule request listener failed', err);
        setError('Unable to load your reschedule requests.');
      },
    );
  }, [clientEmail, job.id]);

  const openRequest = requests.find((r) => r.status === 'Open');
  const lastResolved = requests.find((r) => r.status !== 'Open');

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) {
      setError('Tell us what time works better for you.');
      return;
    }
    const preferredMs = localInputToMillis(preferred);
    if (preferred && (preferredMs == null || preferredMs <= Date.now())) {
      setError('Choose a future date and time.');
      return;
    }
    setBusy(true);
    setError('');
    setSent(false);
    try {
      await addDoc(collection(db, 'rescheduleRequests'), {
        jobId: job.id,
        clientEmail,
        note: trimmed.slice(0, NOTE_MAX),
        status: 'Open',
        createdAt: new Date(),
        createdBy: clientEmail,
        ...(preferredMs != null ? { preferredFor: new Date(preferredMs) } : {}),
      });
      setNote('');
      setPreferred('');
      setSent(true);
    } catch (err) {
      console.error('Submit reschedule request failed', err);
      setError('Unable to send your request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-3xl bg-slate-950/40 border border-slate-700 p-4">
      <div className="flex items-center gap-2 text-sm text-slate-400 uppercase tracking-[0.18em] mb-3">
        <CalendarClock size={16} /> Reschedule
      </div>
      {openRequest ? (
        <p className="text-amber-300 text-sm">
          Your request for a new time was sent {formatDate(openRequest.createdAt)} and is waiting for the office to confirm.
        </p>
      ) : (
        <form onSubmit={submit} className="grid gap-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder="What time works better, and anything the technician should know?"
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
          />
          <label className="grid gap-1 text-sm text-slate-400">
            Preferred new time (optional)
            <input
              type="datetime-local"
              value={preferred}
              onChange={(e) => setPreferred(e.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100"
            />
          </label>
          {error && <div className="text-sm text-red-300">{error}</div>}
          {sent && <div className="text-sm text-emerald-300">Request sent. The office will confirm the new time.</div>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Request new time'}
          </button>
        </form>
      )}
      {!openRequest && lastResolved && (
        <p className="mt-3 text-xs text-slate-400">
          {lastResolved.status === 'Approved'
            ? `Your last request was approved${lastResolved.resolvedAt ? ` on ${formatDate(lastResolved.resolvedAt)}` : ''}. Check the scheduled time above.`
            : 'Your last request was not approved. Contact the office to discuss other options.'}
        </p>
      )}
      {error && openRequest && <div className="mt-2 text-sm text-red-300">{error}</div>}
    </div>
  );
}
