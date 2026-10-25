import { describe, expect, it } from 'vitest';
import {
  JOB_WINDOW_MS,
  findTechConflict,
  formatSchedule,
  getDayPlacement,
  getJobStatusLabel,
  getJobWindow,
  getWeekDays,
  isJobAssigned,
  isJobDispatched,
  snapMinute,
  toMillis,
} from '../../src/lib/jobTime';

const HOUR = 60 * 60 * 1000;
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('toMillis', () => {
  it('reads Dates, Firestore-style timestamps, and ISO strings', () => {
    const at = local(2026, 10, 19, 10);
    expect(toMillis(at)).toBe(at.getTime());
    expect(toMillis({ toDate: () => at })).toBe(at.getTime());
    expect(toMillis(at.toISOString())).toBe(at.getTime());
  });

  it('is null for missing or unparseable values', () => {
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis('not a date')).toBeNull();
  });
});

describe('dispatch and assignment status', () => {
  it('counts En Route and on-site-without-checkout as dispatched', () => {
    expect(isJobDispatched({ status: 'En Route' })).toBe(true);
    expect(isJobDispatched({ status: 'On Site' })).toBe(true);
    expect(isJobDispatched({ status: 'On Site', checkOutAt: new Date() })).toBe(false);
    expect(isJobDispatched({ status: 'Assigned' })).toBe(false);
  });

  it('counts a tech-assigned job that has not started as assigned', () => {
    expect(isJobAssigned({ assignedTechEmail: 't@x.com', status: 'Assigned' })).toBe(true);
    expect(isJobAssigned({ assignedTechEmail: 't@x.com', status: 'Dispatched' })).toBe(true);
    expect(isJobAssigned({ assignedTechEmail: 't@x.com' })).toBe(true);
  });

  it('does not count unassigned, started, or completed jobs as assigned', () => {
    expect(isJobAssigned({ status: 'Assigned' })).toBe(false);
    expect(isJobAssigned({ assignedTechEmail: 't@x.com', status: 'En Route' })).toBe(false);
    expect(isJobAssigned({ assignedTechEmail: 't@x.com', status: 'Completed' })).toBe(false);
  });

  it('shows legacy Dispatched assigned jobs as Assigned', () => {
    expect(getJobStatusLabel({ assignedTechEmail: 't@x.com', status: 'Dispatched' })).toBe('Assigned');
    expect(getJobStatusLabel({ assignedTechEmail: 't@x.com', status: 'En Route' })).toBe('En Route');
  });
});

describe('getJobWindow', () => {
  it('uses the scheduled range when an end time is after the start', () => {
    const start = local(2026, 10, 19, 10);
    const end = local(2026, 10, 19, 15);
    expect(getJobWindow({ scheduledFor: start, scheduledEnd: end })).toEqual({ start: start.getTime(), end: end.getTime() });
  });

  it('defaults to the standard window length when the end is missing or not after the start', () => {
    const start = local(2026, 10, 19, 10);
    expect(getJobWindow({ scheduledFor: start }).end).toBe(start.getTime() + JOB_WINDOW_MS);
    expect(getJobWindow({ scheduledFor: start, scheduledEnd: start }).end).toBe(start.getTime() + JOB_WINDOW_MS);
  });

  it('runs from now for a job in progress and has no window when unscheduled', () => {
    const now = local(2026, 10, 19, 11).getTime();
    expect(getJobWindow({ status: 'En Route' }, now)).toEqual({ start: now, end: now + JOB_WINDOW_MS });
    expect(getJobWindow({ status: 'Assigned' }, now)).toBeNull();
  });
});

describe('formatSchedule', () => {
  it('is empty without a start time', () => {
    expect(formatSchedule({})).toBe('');
  });

  it('shows the date with start and end times on the same day', () => {
    const job = { scheduledFor: local(2026, 10, 19, 10), scheduledEnd: local(2026, 10, 19, 18) };
    expect(formatSchedule(job)).toBe('10/19/2026 1000-1800');
  });

  it('includes the end date when the job runs past midnight', () => {
    const job = { scheduledFor: local(2026, 10, 19, 22), scheduledEnd: local(2026, 10, 20, 2) };
    expect(formatSchedule(job)).toBe('10/19/2026 2200-10/20/2026 0200');
  });

  it('omits the end when none is set', () => {
    expect(formatSchedule({ scheduledFor: local(2026, 10, 19, 9) })).toBe('10/19/2026 0900');
  });
});

describe('getDayPlacement', () => {
  const day = local(2026, 10, 19);

  it('places a window within board hours by minutes from the board start', () => {
    const window = { start: local(2026, 10, 19, 10).getTime(), end: local(2026, 10, 19, 12).getTime() };
    expect(getDayPlacement(window, day)).toEqual({ top: 240, height: 120 });
  });

  it('clips a window to the visible board hours', () => {
    const window = { start: local(2026, 10, 19, 5).getTime(), end: local(2026, 10, 19, 7).getTime() };
    expect(getDayPlacement(window, day)).toEqual({ top: 0, height: 60 });
  });

  it('returns null for a window outside board hours', () => {
    const window = { start: local(2026, 10, 19, 23).getTime(), end: local(2026, 10, 20, 1).getTime() };
    expect(getDayPlacement(window, day)).toBeNull();
  });
});

describe('findTechConflict', () => {
  const tech = 't@x.com';
  const at = (h) => local(2026, 10, 19, h);
  const scheduled = (id, startH, endH, extra = {}) => ({
    id, assignedTechEmail: tech, status: 'Assigned', scheduledFor: at(startH), scheduledEnd: at(endH), ...extra,
  });

  it('finds an overlapping job for the same tech', () => {
    const existing = scheduled('a', 10, 12);
    const target = scheduled('b', 11, 13);
    expect(findTechConflict(target, tech, [existing])).toBe(existing);
  });

  it('ignores back-to-back jobs and other techs', () => {
    const target = scheduled('b', 12, 14);
    expect(findTechConflict(target, tech, [scheduled('a', 10, 12)])).toBeNull();
    expect(findTechConflict(target, tech, [scheduled('a', 12, 14, { assignedTechEmail: 'other@x.com' })])).toBeNull();
  });

  it('ignores completed jobs and the target job itself', () => {
    const target = scheduled('b', 11, 13);
    expect(findTechConflict(target, tech, [scheduled('a', 10, 12, { status: 'Completed' })])).toBeNull();
    expect(findTechConflict(target, tech, [target])).toBeNull();
  });

  it('returns null when no tech is given', () => {
    expect(findTechConflict(scheduled('b', 11, 13), '', [scheduled('a', 10, 12)])).toBeNull();
  });
});

describe('week and time helpers', () => {
  it('starts the week on Monday', () => {
    const days = getWeekDays(local(2026, 10, 21, 15));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getDate()).toBe(19);
    expect(days[6].getDate()).toBe(25);
  });

  it('snaps minutes to the nearest step', () => {
    expect(snapMinute(14)).toBe(0);
    expect(snapMinute(16)).toBe(30);
    expect(snapMinute(47, 15)).toBe(45);
  });
});
