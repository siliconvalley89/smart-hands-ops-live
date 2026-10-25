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

export const MIN_BREAK_MS = 30 * 60 * 1000;
const LONG_SHIFT_MS = 5 * 60 * 60 * 1000;

export const getBreakReturnTime = (job) => {
  const openBreak = (job?.breaks || []).filter((b) => b.startAt && !b.endAt).pop();
  return openBreak ? toMillis(openBreak.startAt) + MIN_BREAK_MS : null;
};

const SECOND_BREAK_AFTER_MS = 12 * 60 * 60 * 1000;

export const getBreakStartBlock = (job, now = Date.now()) => {
  const breaks = job?.breaks || [];
  if (breaks.length === 0) return null;
  if (breaks.length > 1) {
    return { label: 'Break limit reached', message: 'Only two breaks are allowed per visit.' };
  }
  const availableAt = toMillis(job.checkInAt) + SECOND_BREAK_AFTER_MS;
  if (now >= availableAt) return null;
  const time = new Date(availableAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return { label: `Second break at ${time}`, message: `A second break is available at ${time}, after 12 hours on site.` };
};

export const getCheckoutBlockReason = (job) => {
  if (getPhotoCount(job, 'after') === 0) return 'Upload at least one after photo before checking out.';
  if (job.checkInAt && Date.now() - toMillis(job.checkInAt) >= LONG_SHIFT_MS) {
    const hasLongBreak = (job.breaks || []).some((b) => b.startAt && b.endAt && toMillis(b.endAt) - toMillis(b.startAt) >= MIN_BREAK_MS);
    if (!hasLongBreak) return 'After 5 hours on site, take a 30-minute break before checking out.';
  }
  return '';
};
