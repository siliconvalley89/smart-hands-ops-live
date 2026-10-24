import { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { downloadCsv } from '../lib/csv';
import { buildReport, reportCsvRows } from '../lib/reports';
import { localDayStart, nextLocalDayStart, toDateInput } from '../lib/timesheets';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const minutesLabel = (value) => (value == null ? '—' : `${Math.round(value)} min`);
const percentLabel = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`);

const monthStartInput = () => {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
};

export default function ReportsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [from, setFrom] = useState(monthStartInput);
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async (e) => {
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
        where('createdAt', '>=', localDayStart(from)),
        where('createdAt', '<', nextLocalDayStart(to)),
      ));
      const jobs = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const signedOffJobs = jobs.filter((job) => job.adminSignedOffAt);
      const paymentEntries = await Promise.all(signedOffJobs.map(async (job) => {
        const paymentSnapshot = await getDocs(collection(db, 'jobs', job.id, 'payments'));
        return [job.id, paymentSnapshot.docs.map((entry) => entry.data())];
      }));
      setReport(buildReport(jobs, Object.fromEntries(paymentEntries)));
    } catch (err) {
      console.error('Report lookup failed', err);
      setReport(null);
      setError('Unable to build the report.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Reports</h2>
          <p className="text-slate-400 text-sm mt-1">Revenue, collections, tech workload, response time, and repeat visits for jobs created in a date range.</p>
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
          <form onSubmit={run} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-slate-400">
              Created from
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
              {loading ? 'Building...' : 'Run report'}
            </button>
            {report && report.jobCount > 0 && (
              <button
                type="button"
                onClick={() => downloadCsv(`jobs-report-${from}-to-${to}.csv`, reportCsvRows(report))}
                className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
              >
                Download jobs CSV
              </button>
            )}
          </form>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {report && report.jobCount === 0 && <p className="text-slate-400 text-sm">No jobs created in this date range.</p>}

          {report && report.jobCount > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
                  <div className="text-slate-400 text-sm">Jobs created</div>
                  <div className="text-2xl font-semibold text-slate-100">{report.jobCount}</div>
                  <div className="text-slate-500 text-sm">{report.signedOffCount} signed off</div>
                </div>
                <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
                  <div className="text-slate-400 text-sm">Invoiced</div>
                  <div className="text-2xl font-semibold text-slate-100">{money(report.invoiced)}</div>
                  <div className="text-slate-500 text-sm">{money(report.collected)} collected</div>
                </div>
                <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
                  <div className="text-slate-400 text-sm">Outstanding</div>
                  <div className="text-2xl font-semibold text-amber-300">{money(report.outstanding)}</div>
                  <div className="text-slate-500 text-sm">invoiced minus collected</div>
                </div>
                <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
                  <div className="text-slate-400 text-sm">Median response</div>
                  <div className="text-2xl font-semibold text-slate-100">{minutesLabel(report.medianResponseMinutes)}</div>
                  <div className="text-slate-500 text-sm">created to check-in</div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="text-slate-400 text-sm">Repeat visits: {report.repeatJobs} of {report.jobCount} jobs ({percentLabel(report.repeatRate)}) share a location with another job in this range.</div>
                <div className="overflow-x-auto rounded-2xl border border-slate-700">
                  <table className="w-full text-sm text-left text-slate-300">
                    <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Tech</th>
                        <th className="px-3 py-2 text-right">Jobs</th>
                        <th className="px-3 py-2 text-right">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byTech.map((tech) => (
                        <tr key={tech.name} className="border-t border-slate-700">
                          <td className="px-3 py-2">{tech.name}</td>
                          <td className="px-3 py-2 text-right">{tech.jobs}</td>
                          <td className="px-3 py-2 text-right">{tech.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
