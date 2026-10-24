import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { formatDate } from '../lib/jobDisplay';

const lookupAssetHistory = httpsCallable(functions, 'lookupAssetHistory');

export default function AssetHistory() {
  const [expanded, setExpanded] = useState(false);
  const [serialInput, setSerialInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async (e) => {
    e.preventDefault();
    const serialNumber = serialInput.trim();
    if (!serialNumber) return;
    setLoading(true);
    setError('');
    try {
      const response = await lookupAssetHistory({ serialNumber });
      setResult(response.data);
    } catch (err) {
      console.error('Asset history lookup failed', err);
      setResult(null);
      setError('Unable to load asset history.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Asset history</h2>
          <p className="text-slate-400 text-sm mt-1">Every visit recorded against a serial number, including completed jobs.</p>
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
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              placeholder="Serial number"
              className="flex-1 min-w-[220px] rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
            />
            <button
              type="submit"
              disabled={loading || !serialInput.trim()}
              className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Look up'}
            </button>
          </form>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {result && result.visits.length === 0 && (
            <p className="text-slate-400 text-sm">No jobs recorded with serial number <span className="font-mono text-amber-300">{result.serialNumber}</span>.</p>
          )}

          {result && result.visits.length > 0 && (
            <div className="grid gap-3">
              <p className="text-slate-400 text-sm">
                {result.visits.length} {result.visits.length === 1 ? 'visit' : 'visits'} for <span className="font-mono text-amber-300">{result.serialNumber}</span>
              </p>
              {result.visits.map((visit) => (
                <div key={visit.id} className="rounded-2xl bg-slate-800 border border-slate-700 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-white">{visit.client || 'Client not set'}</div>
                    <span className="inline-flex rounded-full px-3 py-1 text-xs bg-slate-700 text-slate-200">{visit.status || 'Unknown'}</span>
                  </div>
                  <div className="text-slate-300 mt-1">{visit.task}</div>
                  {visit.location && <div className="text-slate-400 text-sm mt-1">{visit.location}</div>}
                  {visit.details && <div className="text-slate-400 text-sm mt-2">{visit.details}</div>}
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                    <span>Scheduled: {visit.scheduledFor ? formatDate(visit.scheduledFor) : 'Not scheduled'}</span>
                    <span>Tech: {visit.assignedTechName || 'Unassigned'}</span>
                    {visit.completedAt && <span>Completed: {formatDate(visit.completedAt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
