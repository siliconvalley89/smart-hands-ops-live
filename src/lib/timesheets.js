import { toMillis } from './jobTime';

const MINUTE_MS = 60 * 1000;

export const toDateInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const localDayStart = (dateInput) => new Date(`${dateInput}T00:00`);

export const nextLocalDayStart = (dateInput) => {
  const day = localDayStart(dateInput);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
};

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
      date: new Date(checkIn).toLocaleDateString('en-CA'),
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
