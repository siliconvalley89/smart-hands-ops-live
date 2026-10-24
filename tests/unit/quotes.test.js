import { describe, expect, it } from 'vitest';
import { canAcceptQuote, isQuoteExpired, quoteTotal } from '../../src/lib/quotes.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1);
const stamp = (ms) => ({ toMillis: () => ms });

describe('quoteTotal', () => {
  it('sums line items and the service fee', () => {
    expect(quoteTotal([{ qty: 2, unitPrice: 12.5 }, { qty: 1, unitPrice: 0 }], 50)).toBe(75);
  });

  it('handles an empty quote', () => {
    expect(quoteTotal([], 0)).toBe(0);
  });
});

describe('isQuoteExpired', () => {
  it('is not expired before the valid-until time', () => {
    expect(isQuoteExpired({ validUntil: stamp(NOW + DAY) }, NOW)).toBe(false);
  });

  it('is expired at or after the valid-until time', () => {
    expect(isQuoteExpired({ validUntil: stamp(NOW) }, NOW)).toBe(true);
  });

  it('accepts a plain Date value', () => {
    expect(isQuoteExpired({ validUntil: new Date(NOW - DAY) }, NOW)).toBe(true);
  });
});

describe('canAcceptQuote', () => {
  it('allows only sent, unexpired quotes', () => {
    expect(canAcceptQuote({ status: 'Sent', validUntil: stamp(NOW + DAY) }, NOW)).toBe(true);
    expect(canAcceptQuote({ status: 'Sent', validUntil: stamp(NOW - DAY) }, NOW)).toBe(false);
    expect(canAcceptQuote({ status: 'Accepted', validUntil: stamp(NOW + DAY) }, NOW)).toBe(false);
    expect(canAcceptQuote({ status: 'Withdrawn', validUntil: stamp(NOW + DAY) }, NOW)).toBe(false);
  });
});
