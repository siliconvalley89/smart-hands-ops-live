export const JOB_WINDOW_MS = 2 * 60 * 60 * 1000;

export const toMillis = (value) => {
  if (!value) return null;
  const ms = value?.toDate ? value.toDate().getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

// Dispatched = tech is en route or currently on site (not yet checked out)
export const isJobDispatched = (job) =>
  job.status === 'En Route' || (job.status === 'On Site' && !job.checkOutAt);

// Assigned = has a tech but work has not started (includes future scheduled jobs; legacy 'Dispatched' status counts here)
export const isJobAssigned = (job) =>
  Boolean(job.assignedTechEmail) &&
  !isJobDispatched(job) &&
  ['Assigned', 'Dispatched', 'Pending'].includes(job.status || 'Assigned');

export const getJobStatusLabel = (job) => (isJobAssigned(job) && job.status === 'Dispatched' ? 'Assigned' : job.status);

// Returns the time window a job occupies, or null if it is unscheduled and not in progress
// Window uses the explicit end time when set, otherwise a default length
export const getJobWindow = (job, now = Date.now()) => {
  const scheduled = toMillis(job.scheduledFor);
  if (scheduled != null) {
    const end = toMillis(job.scheduledEnd);
    return { start: scheduled, end: end != null && end > scheduled ? end : scheduled + JOB_WINDOW_MS };
  }
  if (isJobDispatched(job)) return { start: now, end: now + JOB_WINDOW_MS };
  return null;
};

// e.g. "10/19/2026 1000-1800" (or just date and start time when no end time was set)
export const formatSchedule = (job) => {
  const start = toMillis(job.scheduledFor);
  if (start == null) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const s = new Date(start);
  const hhmm = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const datePart = s.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const end = toMillis(job.scheduledEnd);
  if (end == null) return `${datePart} ${hhmm(s)}`;
  const e = new Date(end);
  const nextDay = e.toDateString() !== s.toDateString();
  const endDatePart = nextDay ? e.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) + ' ' : '';
  return `${datePart} ${hhmm(s)}-${endDatePart}${hhmm(e)}`;
};

export const findTechConflict = (targetJob, techEmail, allJobs) => {
  if (!techEmail) return null;
  const now = Date.now();
  const target = getJobWindow(targetJob, now) || { start: now, end: now + JOB_WINDOW_MS };
  return allJobs.find((other) => {
    if (other.id && other.id === targetJob.id) return false;
    if (other.assignedTechEmail !== techEmail || other.status === 'Completed') return false;
    const win = getJobWindow(other, now);
    return win && win.start < target.end && target.start < win.end;
  }) || null;
};

