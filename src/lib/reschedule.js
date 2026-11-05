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
