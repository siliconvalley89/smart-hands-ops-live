import { describe, expect, it } from 'vitest';
import { buildTimesheetRows, nextLocalDayStart, timesheetCsvRows, toDateInput } from '../../src/lib/timesheets';

const at = (iso) => new Date(iso);

describe('buildTimesheetRows', () => {
  it('computes on-site, break, and worked minutes for a closed job', () => {
    const [row] = buildTimesheetRows([{
      id: 'job-1',
      assignedTechName: 'Ana',
      assignedTechEmail: 'ana@example.com',
      checkInAt: at('2026-10-20T16:00:00Z'),
      checkOutAt: at('2026-10-20T20:00:00Z'),
      breaks: [{ startAt: at('2026-10-20T18:00:00Z'), endAt: at('2026-10-20T18:30:00Z') }],
    }]);
    expect(row).toMatchObject({ jobId: 'job-1', techName: 'Ana', onSiteMinutes: 240, breakMinutes: 30, workedMinutes: 210, flags: '' });
  });

  it('flags a job still on site with no on-site or worked minutes', () => {
    const [row] = buildTimesheetRows([{ id: 'job-2', checkInAt: at('2026-10-20T16:00:00Z'), breaks: [] }]);
    expect(row).toMatchObject({ onSiteMinutes: null, workedMinutes: null, checkOut: '', flags: 'Still on site' });
  });

  it('flags an open break and leaves it out of break minutes', () => {
    const [row] = buildTimesheetRows([{
      id: 'job-3',
      checkInAt: at('2026-10-20T16:00:00Z'),
      checkOutAt: at('2026-10-20T17:00:00Z'),
      breaks: [{ startAt: at('2026-10-20T16:30:00Z') }],
    }]);
    expect(row).toMatchObject({ breakMinutes: 0, workedMinutes: 60, flags: 'Open break' });
  });

  it('skips jobs that were never checked in', () => {
    expect(buildTimesheetRows([{ id: 'job-4', status: 'Assigned' }])).toEqual([]);
  });

  it('orders rows by check-in time', () => {
    const rows = buildTimesheetRows([
      { id: 'late', checkInAt: at('2026-10-21T16:00:00Z') },
      { id: 'early', checkInAt: at('2026-10-20T16:00:00Z') },
    ]);
    expect(rows.map((row) => row.jobId)).toEqual(['early', 'late']);
  });
});

describe('timesheetCsvRows', () => {
  it('writes the header followed by one line per row', () => {
    const rows = buildTimesheetRows([{
      id: 'job-5',
      assignedTechName: 'Ben',
      checkInAt: at('2026-10-20T16:00:00Z'),
      checkOutAt: at('2026-10-20T17:00:00Z'),
      breaks: [],
    }]);
    const [header, line] = timesheetCsvRows(rows);
    expect(header[0]).toBe('Date');
    expect(line.slice(0, 2)).toEqual([rows[0].date, 'Ben']);
    expect(line.slice(8, 11)).toEqual([60, 0, 60]);
  });
});

describe('local day helpers', () => {
  it('formats a date as a local YYYY-MM-DD input value', () => {
    expect(toDateInput(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });

  it('returns the start of the following local day, across a month boundary', () => {
    expect(nextLocalDayStart('2026-10-31')).toEqual(new Date(2026, 10, 1));
  });
});
