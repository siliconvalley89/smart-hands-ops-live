const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['client', 'tech'];

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

function parseStaffAccount(data) {
  const email = trimmed(data?.email);
  const password = typeof data?.password === 'string' ? data.password : '';
  const name = trimmed(data?.name);
  const role = data?.role;
  const phone = trimmed(data?.phone);

  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (password.length < 6 || password.length > 128) return { error: 'Password must be 6 to 128 characters.' };
  if (!name || name.length > 120) return { error: 'Enter a name up to 120 characters.' };
  if (!ROLES.includes(role)) return { error: 'Choose client or technician.' };
  if (phone.length > 40) return { error: 'Phone number is too long.' };

  const account = { email, password, name, role, phone };
  if (role === 'tech') {
    const location = trimmed(data?.location);
    if (!location || location.length > 300) return { error: 'Enter a base location for technician accounts.' };
    if (!Number.isFinite(data?.lat) || !Number.isFinite(data?.lng)) return { error: 'Base location could not be located.' };
    Object.assign(account, { location, rawLocation: trimmed(data?.rawLocation) || location, lat: data.lat, lng: data.lng });
  }
  return { account };
}

module.exports = { parseStaffAccount };
