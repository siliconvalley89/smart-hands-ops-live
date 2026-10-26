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

export const BOARD_START_MINUTE = 6 * 60;
export const BOARD_END_MINUTE = 22 * 60;
export const MOVABLE_STATUSES = ['Pending', 'Assigned', 'Dispatched'];
export const isJobMovable = (job) => MOVABLE_STATUSES.includes(job.status);

export const getWeekDays = (anchor) => {
  const d = new Date(anchor);
  const offset = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset + i));
};

export const minuteOfDayToMs = (day, minute) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute).getTime();

export const snapMinute = (minute, step = 30) => Math.round(minute / step) * step;

// Returns the part of a window that falls on one day within the board's visible hours, as pixel-ready minutes
export const getDayPlacement = (window, day) => {
  const boardStart = minuteOfDayToMs(day, BOARD_START_MINUTE);
  const boardEnd = minuteOfDayToMs(day, BOARD_END_MINUTE);
  const start = Math.max(window.start, boardStart);
  const end = Math.min(window.end, boardEnd);
  if (end <= start) return null;
  return { top: (start - boardStart) / 60000, height: (end - start) / 60000 };
};

export const conflictMessage = (techName, conflict) => {
  const when = conflict.scheduledFor ? formatSchedule(conflict) : 'now';
  return `${techName} is already booked on ${conflict.client || conflict.task || 'another job'} (${when}) during this window. Choose a different time or technician.`;
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

