import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateReview, toPublicReview } = require('../../functions/reviews.js');

const valid = (overrides = {}) => ({
  name: ' Jane Doe ',
  company: 'Acme Data Centers',
  rating: 5,
  text: 'Fast, careful work on our rack deployment. Would hire again.',
  ...overrides,
});

describe('validateReview', () => {
  it('accepts a complete review and trims the text fields', () => {
    expect(validateReview(valid())).toEqual({
      review: { name: 'Jane Doe', company: 'Acme Data Centers', rating: 5, text: 'Fast, careful work on our rack deployment. Would hire again.' },
    });
  });

  it('allows a blank company', () => {
    expect(validateReview(valid({ company: '' })).review.company).toBe('');
  });

  it('requires a rating from 1 to 5 as a whole number', () => {
    expect(validateReview(valid({ rating: 0 })).error).toMatch(/rating/);
    expect(validateReview(valid({ rating: 6 })).error).toMatch(/rating/);
    expect(validateReview(valid({ rating: 3.5 })).error).toMatch(/rating/);
    expect(validateReview(valid({ rating: '4' })).review.rating).toBe(4);
  });

  it('rejects names and reviews that are too short or too long', () => {
    expect(validateReview(valid({ name: 'J' })).error).toMatch(/name/);
    expect(validateReview(valid({ name: 'a'.repeat(81) })).error).toMatch(/name/);
    expect(validateReview(valid({ text: 'Too short' })).error).toMatch(/Review must be/);
    expect(validateReview(valid({ text: 'a'.repeat(1001) })).error).toMatch(/Review must be/);
  });

  it('rejects a company over its limit', () => {
    expect(validateReview(valid({ company: 'c'.repeat(121) })).error).toMatch(/Company/);
  });
});

describe('toPublicReview', () => {
  it('returns only the public fields, never anything else stored on the review', () => {
    const createdAt = { toMillis: () => 1700000000000 };
    expect(toPublicReview('r1', { name: 'Jane Doe', company: 'Acme', rating: 4, text: 'Great', status: 'approved', moderatedBy: 'admin@x.com', createdAt })).toEqual({
      id: 'r1', name: 'Jane Doe', company: 'Acme', rating: 4, text: 'Great', createdAt: 1700000000000,
    });
  });
});
