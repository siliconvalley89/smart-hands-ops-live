import { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { formatDate } from '../lib/jobDisplay';

const ACTION_LABELS = {
  created: 'Job created',
  updated: 'Job updated',
  deleted: 'Job deleted',
  recorded: 'Payment recorded',
  voided: 'Payment voided',
};

const displayValue = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));

const timeMs = (value) => value?.toMillis?.() ?? 0;

export default function AuditLog() {
  const [expanded, setExpanded] = useState(false);
  const [jobIdInput, setJobIdInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async (e) => {
    e.preventDefault();
    const jobId = jobIdInput.trim();
    if (!jobId) return;
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(query(collection(db, 'auditLog'), where('jobId', '==', jobId)));
      const entries = snapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt));
      setResult({ jobId, entries });
    } catch (err) {
      console.error('Audit log lookup failed', err);
      setResult(null);
      setError('Unable to load audit log.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Audit log</h2>
          <p className="text-slate-400 text-sm mt-1">Who changed a job, and who recorded, voided, or sent its money.</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div className="grid gap-4 rounded-3xl bg-slate-900/70 border border-slate-700 p-5">
          <form onSubmit={search} className="flex flex-wrap gap-3">
            <input
              type="text"
              value={jobIdInput}
              onChange={(e) => setJobIdInput(e.target.value)}
              placeholder="Job ID"
              className="flex-1 min-w-[220px] rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
            />
            <button
              type="submit"
              disabled={loading || !jobIdInput.trim()}
              className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Show history'}
            </button>
          </form>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {result && result.entries.length === 0 && (
            <p className="text-slate-400 text-sm">No audit entries for job <span className="font-mono text-amber-300">{result.jobId}</span>.</p>
          )}

          {result && result.entries.length > 0 && (
            <div className="grid gap-3">
              <p className="text-slate-400 text-sm">
                {result.entries.length} {result.entries.length === 1 ? 'entry' : 'entries'} for <span className="font-mono text-amber-300">{result.jobId}</span>
              </p>
              {result.entries.map((entry) => (
                <div key={entry.id} className="rounded-2xl bg-slate-800 border border-slate-700 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-white">{ACTION_LABELS[entry.action] || entry.action}</div>
                    <div className="text-xs text-slate-400">{entry.createdAt ? formatDate(entry.createdAt) : 'Pending'}</div>
                  </div>
                  <div className="text-slate-400 text-xs mt-1">By {entry.actorEmail || 'System'}</div>

                  {entry.action === 'updated' && entry.changes && (
                    <ul className="mt-3 grid gap-1 text-sm text-slate-300">
                      {Object.entries(entry.changes).map(([field, change]) => (
                        <li key={field}>
                          <span className="font-mono text-slate-400">{field}</span>: {displayValue(change.from)} → {displayValue(change.to)}
                        </li>
                      ))}
                    </ul>
                  )}

                  {entry.details && (
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                      {Object.entries(entry.details).map(([field, value]) => (
                        <span key={field}>{field}: {displayValue(value)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
