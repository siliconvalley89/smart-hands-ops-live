import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { hasTechConflict, needsConflictCheck } = require('../../functions/schedule.js');

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26, 12);
const TECH = 'tech@example.com';
const at = (ms) => ({ toMillis: () => ms });

const job = (id, startMs, extra = {}) => ({
  id,
  status: 'Assigned',
  assignedTechEmail: TECH,
  scheduledFor: at(startMs),
  scheduledEnd: at(startMs + 2 * HOUR),
  ...extra,
});

describe('hasTechConflict', () => {
  it('flags an overlapping window for the same technician', () => {
    const target = job('new', NOW + HOUR);
    expect(hasTechConflict(target, TECH, [job('other', NOW)], NOW)).toBe(true);
  });

  it('allows back-to-back windows and other technicians', () => {
    const target = job('new', NOW + 2 * HOUR);
    expect(hasTechConflict(target, TECH, [job('other', NOW)], NOW)).toBe(false);
    expect(hasTechConflict(job('new', NOW), 'someone@else.com', [job('other', NOW)], NOW)).toBe(false);
  });

  it('ignores the job itself', () => {
    const target = job('same', NOW);
    expect(hasTechConflict(target, TECH, [job('same', NOW)], NOW)).toBe(false);
  });
});

describe('needsConflictCheck', () => {
  const before = job('a', NOW + 5 * HOUR, { status: 'Pending', assignedTechEmail: '' });

  it('checks when a movable job is moved onto a technician', () => {
    const after = { ...before, assignedTechEmail: TECH, status: 'Assigned' };
    expect(needsConflictCheck(before, after)).toBe(true);
  });

  it('skips writes that do not change the schedule or technician', () => {
    expect(needsConflictCheck(before, { ...before, client: 'Renamed' })).toBe(false);
  });

  it('skips jobs that are no longer movable', () => {
    const after = { ...before, assignedTechEmail: TECH, status: 'On Site' };
    expect(needsConflictCheck(before, after)).toBe(false);
  });

  it('skips the revert write itself to prevent a loop', () => {
    const moved = { ...before, assignedTechEmail: TECH, status: 'Assigned', scheduledFor: at(NOW) };
    const reverted = { ...before, conflictRevertedAt: at(NOW) };
    expect(needsConflictCheck(moved, reverted)).toBe(false);
  });
});
