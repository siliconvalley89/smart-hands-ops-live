import { describe, expect, it } from 'vitest';
import {
  JOB_WINDOW_MS,
  findTechConflict,
  formatSchedule,
  getDayPlacement,
  getJobStatusLabel,
  getJobWindow,
  isJobAssigned,
  isJobDispatched,
  snapMinute,
  toMillis,
} from '../../src/lib/jobTime';
import { pacificToMs } from '../../src/lib/pacificTime';

const pt = (y, m, d, h = 0, min = 0) => new Date(pacificToMs({ year: y, month: m, day: d, hour: h, minute: min }));

describe('toMillis', () => {
  it('reads Dates, Firestore-style timestamps, and ISO strings', () => {
    const at = pt(2026, 10, 19, 10);
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
    const start = pt(2026, 10, 19, 10);
    const end = pt(2026, 10, 19, 15);
    expect(getJobWindow({ scheduledFor: start, scheduledEnd: end })).toEqual({ start: start.getTime(), end: end.getTime() });
  });

  it('defaults to the standard window length when the end is missing or not after the start', () => {
    const start = pt(2026, 10, 19, 10);
    expect(getJobWindow({ scheduledFor: start }).end).toBe(start.getTime() + JOB_WINDOW_MS);
    expect(getJobWindow({ scheduledFor: start, scheduledEnd: start }).end).toBe(start.getTime() + JOB_WINDOW_MS);
  });

  it('runs from now for a job in progress and has no window when unscheduled', () => {
    const now = pt(2026, 10, 19, 11).getTime();
    expect(getJobWindow({ status: 'En Route' }, now)).toEqual({ start: now, end: now + JOB_WINDOW_MS });
    expect(getJobWindow({ status: 'Assigned' }, now)).toBeNull();
  });
});

describe('formatSchedule', () => {
  it('is empty without a start time', () => {
    expect(formatSchedule({})).toBe('');
  });

  it('shows the Pacific date with start and end times on the same day', () => {
    const job = { scheduledFor: pt(2026, 10, 19, 10), scheduledEnd: pt(2026, 10, 19, 18) };
    expect(formatSchedule(job)).toBe('10/19/2026 1000-1800 PT');
  });

  it('includes the end date when the job runs past midnight Pacific', () => {
    const job = { scheduledFor: pt(2026, 10, 19, 22), scheduledEnd: pt(2026, 10, 20, 2) };
    expect(formatSchedule(job)).toBe('10/19/2026 2200-10/20/2026 0200 PT');
  });

  it('omits the end when none is set', () => {
    expect(formatSchedule({ scheduledFor: pt(2026, 10, 19, 9) })).toBe('10/19/2026 0900 PT');
  });
});

describe('getDayPlacement', () => {
  const day = { year: 2026, month: 10, day: 19 };

  it('places a window within board hours by minutes from the board start', () => {
    const window = { start: pt(2026, 10, 19, 10).getTime(), end: pt(2026, 10, 19, 12).getTime() };
    expect(getDayPlacement(window, day)).toEqual({ top: 240, height: 120 });
  });

  it('clips a window to the visible board hours', () => {
    const window = { start: pt(2026, 10, 19, 5).getTime(), end: pt(2026, 10, 19, 7).getTime() };
    expect(getDayPlacement(window, day)).toEqual({ top: 0, height: 60 });
  });

  it('returns null for a window outside board hours', () => {
    const window = { start: pt(2026, 10, 19, 23).getTime(), end: pt(2026, 10, 20, 1).getTime() };
    expect(getDayPlacement(window, day)).toBeNull();
  });
});

describe('findTechConflict', () => {
  const tech = 't@x.com';
  const at = (h) => pt(2026, 10, 19, h);
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

describe('snapMinute', () => {
  it('snaps minutes to the nearest step', () => {
    expect(snapMinute(14)).toBe(0);
    expect(snapMinute(16)).toBe(30);
    expect(snapMinute(47, 15)).toBe(45);
  });
});
