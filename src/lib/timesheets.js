import { toMillis } from './jobTime';
import { addPacificDays, pacificDayKey, pacificDayOf, pacificToMs } from './pacificTime';

const MINUTE_MS = 60 * 1000;

const parseDayInput = (dateInput) => {
  const [year, month, day] = dateInput.split('-').map(Number);
  return { year, month, day };
};

export const toDateInput = (value) => pacificDayKey(pacificDayOf(value));

export const monthStartInput = () => {
  const { year, month } = pacificDayOf(Date.now());
  return pacificDayKey({ year, month, day: 1 });
};

export const pacificDayStart = (dateInput) => new Date(pacificToMs(parseDayInput(dateInput)));

export const nextPacificDayStart = (dateInput) => new Date(pacificToMs(addPacificDays(parseDayInput(dateInput), 1)));

export const TIMESHEET_HEADER = [
  'Date', 'Tech', 'Email', 'Job ID', 'Client', 'Task', 'Check-in', 'Check-out',
  'On-site minutes', 'Break minutes', 'Worked minutes', 'Flags',
];

export const buildTimesheetRows = (jobs) => jobs
  .filter((job) => toMillis(job.checkInAt) != null)
  .map((job) => {
    const checkIn = toMillis(job.checkInAt);
    const checkOut = toMillis(job.checkOutAt);
    const breaks = job.breaks || [];
    const breakMinutes = breaks.reduce((sum, brk) => {
      const start = toMillis(brk.startAt);
      const end = toMillis(brk.endAt);
      return start != null && end != null ? sum + Math.round((end - start) / MINUTE_MS) : sum;
    }, 0);
    const onSiteMinutes = checkOut == null ? null : Math.round((checkOut - checkIn) / MINUTE_MS);
    const flags = [];
    if (checkOut == null) flags.push('Still on site');
    if (breaks.some((brk) => toMillis(brk.startAt) != null && toMillis(brk.endAt) == null)) flags.push('Open break');
    return {
      date: pacificDayKey(pacificDayOf(checkIn)),
      techName: job.checkInTechName || job.assignedTechName || '',
      techEmail: job.checkInTechEmail || job.assignedTechEmail || '',
      jobId: job.id,
      client: job.client || '',
      task: job.task || '',
      checkIn: new Date(checkIn).toISOString(),
      checkOut: checkOut == null ? '' : new Date(checkOut).toISOString(),
      onSiteMinutes,
      breakMinutes,
      workedMinutes: onSiteMinutes == null ? null : onSiteMinutes - breakMinutes,
      flags: flags.join('; '),
      checkInMs: checkIn,
    };
  })
  .sort((a, b) => a.checkInMs - b.checkInMs || a.techName.localeCompare(b.techName));

export const timesheetCsvRows = (rows) => [
  TIMESHEET_HEADER,
  ...rows.map((row) => [
    row.date, row.techName, row.techEmail, row.jobId, row.client, row.task, row.checkIn, row.checkOut,
    row.onSiteMinutes, row.breakMinutes, row.workedMinutes, row.flags,
  ]),
];
