export const waitForRoleClaim = async (user, expectedRole, { attempts = 4, delayMs = 1000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { claims } = await user.getIdTokenResult(attempt > 0);
    if ((claims.role || null) === (expectedRole || null)) return true;
    if (attempt < attempts - 1) await wait(delayMs);
  }
  return false;
};
