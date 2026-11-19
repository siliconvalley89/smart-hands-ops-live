import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateWebsiteIntake } = require('../../functions/websiteIntake.js');

const valid = (overrides = {}) => ({
  fullName: 'Jane Doe',
  companyName: 'Acme',
  serviceType: 'Decommissioning',
  email: 'jane@example.com',
  phone: '(408) 555-0100',
  urgencyLevel: 'Normal',
  preferredStartDate: '2026-11-02',
  scopeOfWork: 'Remove two servers',
  ...overrides,
});

const REQUIRED = 'fullName, email, phone, and serviceType are required';

describe('validateWebsiteIntake', () => {
  it('accepts a complete request', () => {
    expect(validateWebsiteIntake(valid())).toBe('');
  });

  it('requires name, email, phone, and service type', () => {
    expect(validateWebsiteIntake(valid({ fullName: '' }))).toBe(REQUIRED);
    expect(validateWebsiteIntake(valid({ serviceType: undefined }))).toBe(REQUIRED);
    expect(validateWebsiteIntake(valid({ phone: '' }))).toBe(REQUIRED);
    expect(validateWebsiteIntake({})).toBe(REQUIRED);
  });

  it('rejects a phone number with fewer than seven digits', () => {
    expect(validateWebsiteIntake(valid({ phone: '555-01' }))).toBe('Invalid phone number');
    expect(validateWebsiteIntake(valid({ phone: '(408) 555-0100' }))).toBe('');
  });

  it('rejects malformed email addresses', () => {
    expect(validateWebsiteIntake(valid({ email: 'not-an-email' }))).toBe('Invalid email address');
  });

  it('rejects fields that are not text', () => {
    expect(validateWebsiteIntake(valid({ scopeOfWork: { nested: true } }))).toBe('Fields must be text');
    expect(validateWebsiteIntake(valid({ fullName: 42 }))).toBe('Fields must be text');
  });

  it('caps each field at its maximum length', () => {
    expect(validateWebsiteIntake(valid({ fullName: 'a'.repeat(120) }))).toBe('');
    expect(validateWebsiteIntake(valid({ fullName: 'a'.repeat(121) }))).toBe('fullName must be 120 characters or fewer');
    expect(validateWebsiteIntake(valid({ scopeOfWork: 'a'.repeat(2001) }))).toBe('scopeOfWork must be 2000 characters or fewer');
    expect(validateWebsiteIntake(valid({ urgencyLevel: 'a'.repeat(41) }))).toBe('urgencyLevel must be 40 characters or fewer');
    expect(validateWebsiteIntake(valid({ phone: '5'.repeat(41) }))).toBe('phone must be 40 characters or fewer');
  });

  it('rejects an unparseable start date', () => {
    expect(validateWebsiteIntake(valid({ preferredStartDate: 'soon-ish' }))).toBe('Invalid preferredStartDate');
  });

  it('allows optional fields to be omitted', () => {
    expect(validateWebsiteIntake({ fullName: 'Jane', email: 'jane@example.com', phone: '4085550100', serviceType: 'Repair' })).toBe('');
  });
});
