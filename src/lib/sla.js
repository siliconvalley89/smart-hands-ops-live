import { toMillis } from './jobTime';

export const RESPONSE_TARGET_MS = 4 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

export const getResponseSla = (job, nowMs) => {
  if (job.status !== 'Pending' || job.scheduledFor) return null;
  const createdMs = toMillis(job.createdAt);
  if (createdMs === null) return null;
  const remainingMs = createdMs + RESPONSE_TARGET_MS - nowMs;
  return { breached: remainingMs < 0, remainingMs };
};

export const formatSlaLabel = ({ breached, remainingMs }) => {
  const totalMinutes = Math.max(0, Math.round(Math.abs(remainingMs) / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const span = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return breached ? `Response overdue by ${span}` : `Respond within ${span}`;
};
