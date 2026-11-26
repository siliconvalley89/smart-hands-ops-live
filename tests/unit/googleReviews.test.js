import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { googleReviewsFromPlace } = require('../../functions/googleReviews.js');

const place = {
  rating: 4.8,
  userRatingCount: 37,
  googleMapsUri: 'https://maps.google.com/?cid=123',
  reviews: [
    {
      name: 'places/abc/reviews/1',
      rating: 5,
      text: { text: 'Excellent rack and stack work.' },
      publishTime: '2026-10-01T18:00:00Z',
      authorAttribution: { displayName: 'Sam R.', uri: 'https://maps.google.com/u/sam' },
    },
    { name: 'places/abc/reviews/2', rating: 4, text: {}, originalText: { text: 'Good, on time.' }, publishTime: '2026-09-01T18:00:00Z' },
    { name: 'places/abc/reviews/3', rating: 3, text: {} },
  ],
};

describe('googleReviewsFromPlace', () => {
  it('maps Google reviews to the site review shape and skips empty ones', () => {
    const { reviews } = googleReviewsFromPlace(place);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toEqual({
      id: 'google-places/abc/reviews/1',
      name: 'Sam R.',
      company: '',
      rating: 5,
      text: 'Excellent rack and stack work.',
      createdAt: Date.parse('2026-10-01T18:00:00Z'),
      source: 'google',
      url: 'https://maps.google.com/u/sam',
    });
    expect(reviews[1].text).toBe('Good, on time.');
    expect(reviews[1].name).toBe('Google user');
  });

  it('returns the rating summary with a link to all reviews', () => {
    expect(googleReviewsFromPlace(place).summary).toEqual({ rating: 4.8, count: 37, url: 'https://maps.google.com/?cid=123' });
  });

  it('returns nothing for an empty or missing place', () => {
    expect(googleReviewsFromPlace({})).toEqual({ reviews: [], summary: null });
    expect(googleReviewsFromPlace(null)).toEqual({ reviews: [], summary: null });
  });
});
