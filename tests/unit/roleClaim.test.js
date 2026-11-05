import { describe, expect, it } from 'vitest';
import { waitForRoleClaim } from '../../src/lib/roleClaim';

const userWithClaims = (...roles) => {
  let call = 0;
  const calls = [];
  return {
    calls,
    getIdTokenResult: async (force) => {
      calls.push(force);
      const role = roles[Math.min(call, roles.length - 1)];
      call += 1;
      return { claims: role ? { role } : {} };
    },
  };
};

const noWait = async () => {};

describe('waitForRoleClaim', () => {
  it('accepts a claim that already matches the profile role without forcing a refresh', async () => {
    const user = userWithClaims('admin');
    expect(await waitForRoleClaim(user, 'admin', { wait: noWait })).toBe(true);
    expect(user.calls).toEqual([false]);
  });

  it('forces a token refresh until the claim catches up', async () => {
    const user = userWithClaims(undefined, 'tech');
    expect(await waitForRoleClaim(user, 'tech', { wait: noWait })).toBe(true);
    expect(user.calls).toEqual([false, true]);
  });

  it('reports a mismatch when the claim never catches up', async () => {
    const user = userWithClaims('client');
    expect(await waitForRoleClaim(user, 'admin', { attempts: 3, wait: noWait })).toBe(false);
    expect(user.calls).toHaveLength(3);
  });

  it('treats a missing role on both sides as matching', async () => {
    expect(await waitForRoleClaim(userWithClaims(undefined), null, { wait: noWait })).toBe(true);
  });
});
