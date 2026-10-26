import { toMillis } from './jobTime';

const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000;

export const jobWindowMs = (job) => {
  const start = toMillis(job.scheduledFor);
  const end = toMillis(job.scheduledEnd);
  return start != null && end != null && end > start ? end - start : DEFAULT_WINDOW_MS;
};

export const approvedScheduleFields = (job, startMs) => ({
  scheduledFor: new Date(startMs),
  scheduledEnd: new Date(startMs + jobWindowMs(job)),
});

export const localInputToMillis = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

export const toDateTimeLocal = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
