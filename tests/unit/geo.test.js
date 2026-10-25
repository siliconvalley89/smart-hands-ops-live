import { describe, expect, it } from 'vitest';
import { calculateDistanceMiles } from '../../src/lib/geo';

describe('calculateDistanceMiles', () => {
  const sanJose = [37.3382, -121.8863];
  const sanFrancisco = [37.7749, -122.4194];
  const losAngeles = [34.0522, -118.2437];

  it('is zero for the same point', () => {
    expect(calculateDistanceMiles(...sanJose, ...sanJose)).toBe(0);
  });

  it('measures San Francisco to Los Angeles as roughly 347 miles', () => {
    expect(Math.abs(calculateDistanceMiles(...sanFrancisco, ...losAngeles) - 347)).toBeLessThan(2);
  });

  it('gives the same distance in either direction', () => {
    expect(calculateDistanceMiles(...sanJose, ...losAngeles)).toBeCloseTo(calculateDistanceMiles(...losAngeles, ...sanJose), 10);
  });

  it('measures a site-check distance of about 1,000 feet correctly', () => {
    const feetPerDegreeLat = (Math.PI * 3958.8) / 180 * 5280;
    const lat = 37.0 + 1000 / feetPerDegreeLat;
    expect(Math.round(calculateDistanceMiles(37.0, -122.0, lat, -122.0) * 5280)).toBe(1000);
  });
});
