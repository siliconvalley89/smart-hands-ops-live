export const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

const MINUTE_MS = 60 * 1000;
const pad = (value) => String(value).padStart(2, '0');

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export const pacificParts = (value) => {
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(value)).map(({ type, value: text }) => [type, Number(text)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
};

const offsetMinutes = (ms) => {
  const p = pacificParts(ms);
  const wallMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((wallMs - Math.floor(ms / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
};

export const pacificToMs = ({ year, month, day, hour = 0, minute = 0 }) => {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wallMs - offsetMinutes(wallMs) * MINUTE_MS;
  return wallMs - offsetMinutes(guess) * MINUTE_MS;
};

export const pacificDayOf = (value) => {
  const { year, month, day } = pacificParts(value);
  return { year, month, day };
};

export const pacificDayKey = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

export const addPacificDays = ({ year, month, day }, count) => {
  const date = new Date(Date.UTC(year, month - 1, day + count));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

export const pacificWeekDays = (anchor) => {
  const weekday = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)).getUTCDay();
  const offset = (weekday + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addPacificDays(anchor, i - offset));
};

export const pacificMinuteMs = (day, minute) => pacificToMs({ ...day, hour: Math.floor(minute / 60), minute: minute % 60 });

export const formatPacific = (value, options) =>
  new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC_TIME_ZONE, ...options }).format(new Date(value));

export const formatPacificDate = (value) => formatPacific(value, { year: 'numeric', month: '2-digit', day: '2-digit' });

export const formatPacificDay = (day, options) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(Date.UTC(day.year, day.month - 1, day.day));

export const toPacificInputValue = (value) => {
  const p = pacificParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};

export const pacificInputToMillis = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const ms = pacificToMs({ year, month, day, hour, minute });
  const back = pacificParts(ms);
  const same = back.year === year && back.month === month && back.day === day && back.hour === hour && back.minute === minute;
  return same ? ms : null;
};
