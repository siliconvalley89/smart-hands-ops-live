import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBreakReturnTime, getBreakStartBlock, getCheckoutBlockReason, getPhotoAddBlockReason, isOnBreak } from '../../src/lib/jobDisplay';

const NOW = new Date('2026-10-24T18:00:00Z');
const HOUR = 60 * 60 * 1000;
const PHOTO_REQUIRED = 'Upload at least one before and after photo before checking out.';
const AFTER_REQUIRED = 'Upload at least one after photo before checking out.';
const BEFORE_REQUIRED = 'Upload at least one before photo before checking out.';
const BREAK_REQUIRED = 'After 5 hours on site, take a 30-minute break before checking out.';

const job = (overrides = {}) => ({
  photoCounts: { before: 1, after: 1 },
  checkInAt: new Date(NOW.getTime() - 2 * HOUR),
  breaks: [],
  ...overrides,
});

describe('getCheckoutBlockReason', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks checkout until both a before and an after photo exist', () => {
    expect(getCheckoutBlockReason(job({ photoCounts: { before: 1, after: 0 } }))).toBe(AFTER_REQUIRED);
    expect(getCheckoutBlockReason(job({ photoCounts: { before: 0, after: 1 } }))).toBe(BEFORE_REQUIRED);
    expect(getCheckoutBlockReason(job({ photoCounts: {} }))).toBe(PHOTO_REQUIRED);
    expect(getCheckoutBlockReason(job())).toBe('');
  });

  it('allows checkout before five hours on site', () => {
    expect(getCheckoutBlockReason(job())).toBe('');
  });

  it('blocks checkout after five hours without a qualifying break', () => {
    const longShift = job({ checkInAt: new Date(NOW.getTime() - 5 * HOUR) });
    expect(getCheckoutBlockReason(longShift)).toBe(BREAK_REQUIRED);
  });

  it('blocks checkout when the only break is shorter than 30 minutes', () => {
    const shortBreak = job({
      checkInAt: new Date(NOW.getTime() - 6 * HOUR),
      breaks: [{ startAt: new Date(NOW.getTime() - 3 * HOUR), endAt: new Date(NOW.getTime() - 3 * HOUR + 29 * 60 * 1000) }],
    });
    expect(getCheckoutBlockReason(shortBreak)).toBe(BREAK_REQUIRED);
  });

  it('allows checkout after five hours with a 30-minute break', () => {
    const withBreak = job({
      checkInAt: new Date(NOW.getTime() - 6 * HOUR),
      breaks: [{ startAt: new Date(NOW.getTime() - 3 * HOUR), endAt: new Date(NOW.getTime() - 3 * HOUR + 30 * 60 * 1000) }],
    });
    expect(getCheckoutBlockReason(withBreak)).toBe('');
  });

  it('ignores breaks that are missing an end time', () => {
    const openBreak = job({
      checkInAt: new Date(NOW.getTime() - 6 * HOUR),
      breaks: [{ startAt: new Date(NOW.getTime() - 3 * HOUR) }],
    });
    expect(getCheckoutBlockReason(openBreak)).toBe(BREAK_REQUIRED);
  });

  it('reports the photo requirement first when both rules fail', () => {
    const both = job({ photoCounts: { before: 1, after: 0 }, checkInAt: new Date(NOW.getTime() - 6 * HOUR) });
    expect(getCheckoutBlockReason(both)).toBe(AFTER_REQUIRED);
  });
});

describe('getPhotoAddBlockReason', () => {
  const CLOSED = 'The photo window for this visit has closed.';
  const checkedOutAt = (hoursAgo) => ({ checkOutAt: new Date(NOW.getTime() - hoursAgo * HOUR) });

  it('never blocks before checkout', () => {
    expect(getPhotoAddBlockReason({}, 'tech', NOW.getTime())).toBe('');
  });

  it('gives techs and senior consultants one hour after checkout', () => {
    expect(getPhotoAddBlockReason(checkedOutAt(0.5), 'tech', NOW.getTime())).toBe('');
    expect(getPhotoAddBlockReason(checkedOutAt(1), 'seniorConsultant', NOW.getTime())).toBe(CLOSED);
    expect(getPhotoAddBlockReason(checkedOutAt(2), 'tech', NOW.getTime())).toBe(CLOSED);
  });

  it('gives admins twelve hours after checkout', () => {
    expect(getPhotoAddBlockReason(checkedOutAt(11), 'admin', NOW.getTime())).toBe('');
    expect(getPhotoAddBlockReason(checkedOutAt(12), 'admin', NOW.getTime())).toBe(CLOSED);
  });
});

describe('isOnBreak', () => {
  it('is true only while a break has no end time', () => {
    expect(isOnBreak(job({ breaks: [{ startAt: NOW }] }))).toBe(true);
    expect(isOnBreak(job({ breaks: [{ startAt: NOW, endAt: NOW }] }))).toBe(false);
    expect(isOnBreak(job())).toBe(false);
  });
});

describe('getBreakReturnTime', () => {
  const MIN = 60 * 1000;

  it('is 30 minutes after the open break started', () => {
    const startAt = new Date(NOW.getTime() - 10 * MIN);
    expect(getBreakReturnTime(job({ breaks: [{ startAt }] }))).toBe(startAt.getTime() + 30 * MIN);
  });

  it('is null when no break is open', () => {
    expect(getBreakReturnTime(job())).toBeNull();
    expect(getBreakReturnTime(job({ breaks: [{ startAt: NOW, endAt: NOW }] }))).toBeNull();
  });
});

describe('getBreakStartBlock', () => {
  const closed = (startAt) => ({ startAt, endAt: new Date(startAt.getTime() + 30 * 60 * 1000) });

  it('allows the first break at any time', () => {
    expect(getBreakStartBlock(job(), NOW.getTime())).toBeNull();
  });

  it('blocks a second break until 12 hours on site', () => {
    const first = closed(new Date(NOW.getTime() - 2 * HOUR));
    const block = getBreakStartBlock(job({ checkInAt: new Date(NOW.getTime() - 3 * HOUR), breaks: [first] }), NOW.getTime());
    expect(block.label).toMatch(/^Second break at /);
  });

  it('allows a second break after 12 hours on site', () => {
    const first = closed(new Date(NOW.getTime() - 6 * HOUR));
    const withTwelveHours = job({ checkInAt: new Date(NOW.getTime() - 12 * HOUR), breaks: [first] });
    expect(getBreakStartBlock(withTwelveHours, NOW.getTime())).toBeNull();
  });

  it('blocks a third break', () => {
    const breaks = [closed(new Date(NOW.getTime() - 14 * HOUR)), closed(new Date(NOW.getTime() - HOUR))];
    expect(getBreakStartBlock(job({ checkInAt: new Date(NOW.getTime() - 15 * HOUR), breaks }), NOW.getTime()).label).toBe('Break limit reached');
  });
});
