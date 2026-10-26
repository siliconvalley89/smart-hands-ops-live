import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { CalendarClock } from 'lucide-react';
import { auth, db } from '../firebase';
import { formatDate } from '../lib/jobDisplay';
import { conflictMessage, findTechConflict, formatSchedule, toMillis } from '../lib/jobTime';
import { approvedScheduleFields, jobWindowMs, localInputToMillis, toDateTimeLocal } from '../lib/reschedule';

const MOVABLE_STATUSES = ['Pending', 'Assigned', 'Dispatched'];

export default function RescheduleRequests({ activeJobs, jobs, askConfirm, setAppError }) {
  const [requests, setRequests] = useState([]);
  const [times, setTimes] = useState({});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'rescheduleRequests'), where('status', '==', 'Open'));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (toMillis(a.createdAt) ?? 0) - (toMillis(b.createdAt) ?? 0));
        setRequests(rows);
      },
      (err) => {
        console.error('Reschedule requests listener failed', err);
        setAppError('Unable to load reschedule requests.');
      },
    );
  }, [setAppError]);

  if (requests.length === 0) return null;

  const jobById = new Map(activeJobs.map((job) => [job.id, job]));
  const defaultTime = (request) => (request.preferredFor ? toDateTimeLocal(toMillis(request.preferredFor)) : '');
  const timeFor = (request) => times[request.id] ?? defaultTime(request);

  const resolve = async (request, status, jobUpdates = null) => {
    setBusyId(request.id);
    try {
      const batch = writeBatch(db);
      if (jobUpdates) batch.update(doc(db, 'jobs', request.jobId), jobUpdates);
      batch.update(doc(db, 'rescheduleRequests', request.id), {
        status,
        resolvedAt: new Date(),
        resolvedBy: auth.currentUser?.email || '',
      });
      await batch.commit();
      setTimes((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    } catch (error) {
      console.error('Resolve reschedule request failed', error);
      setAppError('Unable to update this reschedule request.');
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (request, job) => {
    const startMs = localInputToMillis(timeFor(request));
    if (startMs == null) {
      setAppError('Choose the approved date and time first.');
      return;
    }
    if (!MOVABLE_STATUSES.includes(job.status)) {
      setAppError(`${job.status} jobs cannot be moved. Decline the request instead.`);
      return;
    }
    const endMs = startMs + jobWindowMs(job);
    const conflict = job.assignedTechEmail
      ? findTechConflict({ ...job, scheduledFor: startMs, scheduledEnd: endMs }, job.assignedTechEmail, jobs)
      : null;
    if (conflict) {
      setAppError(conflictMessage(job.assignedTechName || 'This technician', conflict));
      return;
    }
    await resolve(request, 'Approved', {
      ...approvedScheduleFields(job, startMs),
      updatedAt: new Date(),
      updatedBy: auth.currentUser?.email || '',
    });
  };

  const decline = async (request) => {
    if (!(await askConfirm('Decline this request? The client will be emailed that the visit was not moved.', 'Decline'))) return;
    await resolve(request, 'Declined');
  };

  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-3 rounded-3xl bg-slate-800 border border-slate-700 p-4">
        <CalendarClock size={20} className="text-amber-300" />
        <div>
          <h2 className="text-xl font-semibold text-white">Reschedule requests</h2>
          <p className="text-slate-400 text-sm mt-1">Clients asking to move a visit. Approving sets the new time and emails the client.</p>
        </div>
      </div>
      {requests.map((request) => {
        const job = jobById.get(request.jobId);
        const busy = busyId === request.id;
        return (
          <div key={request.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-semibold text-white">{job?.client || 'Job no longer open'}</div>
                <div className="text-slate-300 text-sm">{job?.task || request.jobId}</div>
                <div className="text-slate-400 text-sm mt-1">Currently: {job ? (job.scheduledFor ? formatSchedule(job) : 'Not scheduled') : 'Unknown'}</div>
              </div>
              <div className="text-right text-sm text-slate-400">
                <div>Requested {formatDate(request.createdAt)}</div>
                <div>Preferred: {request.preferredFor ? formatDate(request.preferredFor) : 'No preference given'}</div>
              </div>
            </div>
            <p className="mt-3 text-slate-200 whitespace-pre-line">{request.note}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className="grid gap-1 text-sm text-slate-400">
                Approved start time
                <input
                  type="datetime-local"
                  value={timeFor(request)}
                  disabled={!job || busy}
                  onChange={(e) => setTimes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 disabled:opacity-50"
                />
              </label>
              <button
                type="button"
                onClick={() => approve(request, job)}
                disabled={!job || busy}
                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Approve and reschedule'}
              </button>
              <button
                type="button"
                onClick={() => decline(request)}
                disabled={busy}
                className="rounded-2xl bg-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-600 transition disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
