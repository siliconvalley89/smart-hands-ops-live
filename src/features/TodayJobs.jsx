import { Clock, MapPin, Navigation, Phone } from 'lucide-react';
import { toMillis } from '../lib/jobTime';

const OPEN_STATUSES = ['Pending', 'Assigned', 'Dispatched', 'En Route', 'On Site'];
const IN_PROGRESS_STATUSES = ['En Route', 'On Site'];

const timeLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const directionsUrl = (job) => {
  const destination = job.lat != null && job.lng != null
    ? `${job.lat},${job.lng}`
    : encodeURIComponent(job.location || '');
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
};

function JobCard({ job, timeText }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-white">{job.client || 'Job'}</div>
        <div className="text-xs text-slate-400">{job.status}</div>
      </div>
      <div className="text-slate-300">{job.task}</div>
      <div className="flex items-center gap-2 text-sm text-slate-400"><Clock size={14} /> {timeText}</div>
      {job.location && <div className="flex items-center gap-2 text-sm text-slate-400"><MapPin size={14} /> {job.location}</div>}
      <div className="flex flex-wrap gap-2 pt-1">
        <a
          href={directionsUrl(job)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition"
        >
          <Navigation size={14} /> Directions
        </a>
        {job.clientPhone && (
          <a
            href={`tel:${job.clientPhone}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition"
          >
            <Phone size={14} /> Call client
          </a>
        )}
      </div>
    </div>
  );
}

export default function TodayJobs({ activeJobs }) {
  const todayString = new Date().toDateString();
  const mine = (activeJobs || []).filter((job) => job.assignedTechEmail && OPEN_STATUSES.includes(job.status));

  const inProgress = mine.filter((job) => IN_PROGRESS_STATUSES.includes(job.status));
  const scheduledToday = mine
    .filter((job) => !IN_PROGRESS_STATUSES.includes(job.status))
    .filter((job) => toMillis(job.scheduledFor) != null && new Date(toMillis(job.scheduledFor)).toDateString() === todayString)
    .sort((a, b) => toMillis(a.scheduledFor) - toMillis(b.scheduledFor));
  const needsTime = mine.filter((job) => !IN_PROGRESS_STATUSES.includes(job.status) && toMillis(job.scheduledFor) == null);

  const scheduledText = (job) => {
    const start = timeLabel(toMillis(job.scheduledFor));
    const end = toMillis(job.scheduledEnd);
    return end != null ? `${start} – ${timeLabel(end)}` : start;
  };

  const nothingToday = inProgress.length === 0 && scheduledToday.length === 0;

  return (
    <section className="rounded-3xl bg-slate-800 border border-slate-700 p-5 grid gap-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Today</h2>
        <p className="text-slate-400 text-sm mt-1">Your jobs for {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.</p>
      </div>

      {nothingToday && (
        <div className="rounded-2xl bg-slate-950/70 p-6 text-center text-slate-400">Nothing scheduled for today.</div>
      )}

      {inProgress.length > 0 && (
        <div className="grid gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-teal-300">In progress</div>
          {inProgress.map((job) => <JobCard key={job.id} job={job} timeText={job.status === 'On Site' ? 'On site now' : 'On the way'} />)}
        </div>
      )}

      {scheduledToday.length > 0 && (
        <div className="grid gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Scheduled</div>
          {scheduledToday.map((job) => <JobCard key={job.id} job={job} timeText={scheduledText(job)} />)}
        </div>
      )}

      {needsTime.length > 0 && (
        <div className="grid gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Assigned, time not set yet</div>
          {needsTime.map((job) => <JobCard key={job.id} job={job} timeText="Waiting for a time from dispatch" />)}
        </div>
      )}
    </section>
  );
}
