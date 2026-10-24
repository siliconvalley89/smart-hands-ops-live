import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { quoteTotalCents, quoteLinesProblem, quoteAcceptProblem, buildQuoteJob } = require('../../functions/quote.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1);
const stamp = (ms) => ({ toMillis: () => ms });

const sentQuote = (overrides = {}) => ({
  status: 'Sent',
  client: 'Acme',
  clientEmail: 'client@test.dev',
  clientPhone: '555',
  location: '1 Main St',
  task: 'Rack install',
  details: 'Two racks',
  lines: [{ description: ' Cable ', qty: 2, unitPrice: 12.5 }, { description: 'Patch', qty: 1, unitPrice: 0 }],
  serviceFee: 50,
  serviceFeeDescription: 'Dispatch',
  validUntil: stamp(NOW + 30 * DAY),
  ...overrides,
});

describe('quoteTotalCents', () => {
  it('adds line items and the service fee in whole cents', () => {
    expect(quoteTotalCents([{ qty: 3, unitPrice: 19.99 }], 0.1)).toBe(6007);
  });

  it('counts a service fee with no lines', () => {
    expect(quoteTotalCents([], 75)).toBe(7500);
  });
});

describe('quoteLinesProblem', () => {
  it('accepts valid lines', () => {
    expect(quoteLinesProblem(sentQuote().lines)).toBeNull();
  });

  it('rejects an empty or missing list', () => {
    expect(quoteLinesProblem([])).toMatch(/at least|between/);
    expect(quoteLinesProblem(undefined)).toMatch(/between/);
  });

  it('rejects blank descriptions', () => {
    expect(quoteLinesProblem([{ description: '  ', qty: 1, unitPrice: 1 }])).toBe('Each line needs a description.');
  });

  it('rejects fractional or zero quantities', () => {
    expect(quoteLinesProblem([{ description: 'x', qty: 0, unitPrice: 1 }])).toMatch(/Quantities/);
    expect(quoteLinesProblem([{ description: 'x', qty: 1.5, unitPrice: 1 }])).toMatch(/Quantities/);
  });

  it('rejects negative or non-numeric prices', () => {
    expect(quoteLinesProblem([{ description: 'x', qty: 1, unitPrice: -1 }])).toMatch(/Unit prices/);
    expect(quoteLinesProblem([{ description: 'x', qty: 1, unitPrice: '5' }])).toMatch(/Unit prices/);
  });
});

describe('quoteAcceptProblem', () => {
  it('allows a sent quote before it expires', () => {
    expect(quoteAcceptProblem(sentQuote(), NOW)).toBeNull();
  });

  it('blocks drafts, withdrawn and accepted quotes', () => {
    for (const status of ['Draft', 'Withdrawn', 'Accepted']) {
      expect(quoteAcceptProblem(sentQuote({ status }), NOW)).toBe('This quote is no longer open to accept.');
    }
  });

  it('blocks a quote at or after its valid-until time', () => {
    expect(quoteAcceptProblem(sentQuote({ validUntil: stamp(NOW) }), NOW)).toBe('This quote has expired.');
    expect(quoteAcceptProblem(sentQuote({ validUntil: stamp(NOW - 1) }), NOW)).toBe('This quote has expired.');
  });

  it('blocks a quote with no valid-until date', () => {
    expect(quoteAcceptProblem(sentQuote({ validUntil: undefined }), NOW)).toBe('This quote has expired.');
  });
});

describe('buildQuoteJob', () => {
  const now = new Date(NOW);
  const built = buildQuoteJob(sentQuote(), { quoteId: 'q1', acceptedBy: 'client@test.dev', now });

  it('creates a pending, unassigned job that carries the quote', () => {
    expect(built.job).toMatchObject({
      client: 'Acme',
      clientEmail: 'client@test.dev',
      task: 'Rack install',
      location: '1 Main St',
      status: 'Pending',
      assignedTechEmail: '',
      billingMigrated: true,
      invoiceSent: false,
      clientSignedOff: false,
      createdByRole: 'client',
      source: 'quote',
      quoteId: 'q1',
      updatedBy: 'client@test.dev',
      createdAt: now,
    });
  });

  it('leaves the job without coordinates so no technician is auto-assigned', () => {
    expect(built.job.lat).toBeNull();
    expect(built.job.lng).toBeNull();
  });

  it('moves the service fee into billing and trims line descriptions', () => {
    expect(built.billing).toEqual({
      serviceFee: 50,
      serviceFeeDescription: 'Dispatch',
      quoteId: 'q1',
      updatedAt: now,
    });
    expect(built.consumables).toEqual([
      { description: 'Cable', qty: 2, unitPrice: 12.5 },
      { description: 'Patch', qty: 1, unitPrice: 0 },
    ]);
  });
});
