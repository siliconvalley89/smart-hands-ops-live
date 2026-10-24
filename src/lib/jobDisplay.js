import { toMillis } from './jobTime';

export const formatDate = (value) => {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString();
  return new Date(value).toLocaleString();
};

export const getPhotoCount = (job, type) => {
  const count = job?.photoCounts?.[type];
  return typeof count === 'number' ? count : 0;
};

const MIN_CHECKOUT_BREAK_MS = 30 * 60 * 1000;
const LONG_SHIFT_MS = 5 * 60 * 60 * 1000;

export const getCheckoutBlockReason = (job) => {
  if (getPhotoCount(job, 'after') === 0) return 'Upload at least one after photo before checking out.';
  if (job.checkInAt && Date.now() - toMillis(job.checkInAt) >= LONG_SHIFT_MS) {
    const hasLongBreak = (job.breaks || []).some((b) => b.startAt && b.endAt && toMillis(b.endAt) - toMillis(b.startAt) >= MIN_CHECKOUT_BREAK_MS);
    if (!hasLongBreak) return 'After 5 hours on site, take a 30-minute break before checking out.';
  }
  return '';
};
