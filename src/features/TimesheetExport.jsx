import { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { downloadCsv } from '../lib/csv';
import { buildTimesheetRows, localDayStart, nextLocalDayStart, timesheetCsvRows, toDateInput } from '../lib/timesheets';

const monthStartInput = () => {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
};

const formatHours = (minutes) => (minutes == null ? '—' : (minutes / 60).toFixed(2));

export default function TimesheetExport() {
  const [expanded, setExpanded] = useState(false);
  const [from, setFrom] = useState(monthStartInput);
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (e) => {
    e.preventDefault();
    if (!from || !to || from > to) {
      setError('Pick a start date on or before the end date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(query(
        collection(db, 'jobs'),
        where('checkInAt', '>=', localDayStart(from)),
        where('checkInAt', '<', nextLocalDayStart(to)),
      ));
      setRows(buildTimesheetRows(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))));
    } catch (err) {
      console.error('Timesheet lookup failed', err);
      setRows(null);
      setError('Unable to load timesheets.');
    } finally {
      setLoading(false);
    }
  };

  const totalWorked = rows?.reduce((sum, row) => sum + (row.workedMinutes ?? 0), 0) ?? 0;

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Timesheets</h2>
          <p className="text-slate-400 text-sm mt-1">On-site and break time per job, by check-in date, for payroll.</p>
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
          <form onSubmit={load} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-slate-400">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500" />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-2xl bg-slate-800 border border-slate-600 px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500" />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load timesheets'}
            </button>
            {rows && rows.length > 0 && (
              <button
                type="button"
                onClick={() => downloadCsv(`timesheets-${from}-to-${to}.csv`, timesheetCsvRows(rows))}
                className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
              >
                Download CSV
              </button>
            )}
          </form>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {rows && rows.length === 0 && <p className="text-slate-400 text-sm">No check-ins in this date range.</p>}

          {rows && rows.length > 0 && (
            <>
              <p className="text-slate-400 text-sm">
                {rows.length} {rows.length === 1 ? 'job' : 'jobs'}, {formatHours(totalWorked)} worked hours
              </p>
              <div className="overflow-x-auto rounded-2xl border border-slate-700">
                <table className="w-full text-sm text-left text-slate-300">
                  <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Tech</th>
                      <th className="px-3 py-2">Job</th>
                      <th className="px-3 py-2 text-right">On site (h)</th>
                      <th className="px-3 py-2 text-right">Break (min)</th>
                      <th className="px-3 py-2 text-right">Worked (h)</th>
                      <th className="px-3 py-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.jobId} className="border-t border-slate-700">
                        <td className="px-3 py-2">{row.date}</td>
                        <td className="px-3 py-2">{row.techName || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.jobId}</td>
                        <td className="px-3 py-2 text-right">{formatHours(row.onSiteMinutes)}</td>
                        <td className="px-3 py-2 text-right">{row.breakMinutes}</td>
                        <td className="px-3 py-2 text-right">{formatHours(row.workedMinutes)}</td>
                        <td className="px-3 py-2 text-amber-300">{row.flags}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
