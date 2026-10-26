import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseStaffAccount } = require('../../functions/accounts.js');
const { advanceOccurrence, dueOccurrences } = require('../../functions/contracts.js');

const DAY = 24 * 60 * 60 * 1000;
const techInput = {
  email: ' tech@example.com ',
  password: 'temp-pass-1',
  name: 'Ada Tech',
  role: 'tech',
  phone: '408-555-0100',
  location: '1 Main St, San Jose, CA',
  rawLocation: '1 main st',
  lat: 37.33,
  lng: -121.88,
};

describe('parseStaffAccount', () => {
  it('normalizes a technician account with a located base', () => {
    const { account, error } = parseStaffAccount(techInput);
    expect(error).toBeUndefined();
    expect(account).toMatchObject({ email: 'tech@example.com', name: 'Ada Tech', role: 'tech', lat: 37.33, lng: -121.88 });
  });

  it('accepts a client without a base location', () => {
    const { account, error } = parseStaffAccount({ email: 'c@example.com', password: 'secret1', name: 'Cli', role: 'client' });
    expect(error).toBeUndefined();
    expect(account).not.toHaveProperty('lat');
  });

  it('rejects roles that staff cannot be created with', () => {
    expect(parseStaffAccount({ ...techInput, role: 'admin' }).error).toMatch(/client or technician/);
  });

  it('rejects a technician without a located base', () => {
    expect(parseStaffAccount({ ...techInput, lat: undefined }).error).toMatch(/could not be located/);
    expect(parseStaffAccount({ ...techInput, location: '  ' }).error).toMatch(/base location/);
  });

  it('rejects short passwords and malformed email', () => {
    expect(parseStaffAccount({ ...techInput, password: '12345' }).error).toMatch(/6 to 128/);
    expect(parseStaffAccount({ ...techInput, email: 'not-an-email' }).error).toMatch(/valid email/);
  });
});

describe('contract occurrences', () => {
  const start = Date.UTC(2026, 9, 1, 17);

  it('advances weekly by seven days', () => {
    expect(advanceOccurrence(start, 'weekly')).toBe(start + 7 * DAY);
  });

  it('advances monthly by one calendar month', () => {
    expect(advanceOccurrence(Date.UTC(2026, 0, 15, 17), 'monthly')).toBe(Date.UTC(2026, 1, 15, 17));
  });

  it('lists only occurrences within the horizon', () => {
    const due = dueOccurrences(start, 'weekly', start + 14 * DAY, 12);
    expect(due).toEqual([start, start + 7 * DAY, start + 14 * DAY]);
  });

  it('caps how many visits one run creates', () => {
    expect(dueOccurrences(start, 'weekly', start + 365 * DAY, 2)).toHaveLength(2);
  });

  it('returns nothing when the next visit is beyond the horizon', () => {
    expect(dueOccurrences(start + 30 * DAY, 'weekly', start + 7 * DAY, 12)).toEqual([]);
  });
});
