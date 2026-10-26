const FIELD_MAX_LENGTH = {
  fullName: 120,
  companyName: 120,
  serviceType: 120,
  email: 254,
  urgencyLevel: 40,
  preferredStartDate: 40,
  scopeOfWork: 2000,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateWebsiteIntake(body = {}) {
  for (const [field, max] of Object.entries(FIELD_MAX_LENGTH)) {
    const value = body[field];
    if (value == null) continue;
    if (typeof value !== 'string') return 'Fields must be text';
    if (value.length > max) return `${field} must be ${max} characters or fewer`;
  }
  if (!body.fullName || !body.email || !body.serviceType) return 'fullName, email, and serviceType are required';
  if (!EMAIL_PATTERN.test(body.email)) return 'Invalid email address';
  if (body.preferredStartDate && Number.isNaN(new Date(body.preferredStartDate).getTime())) return 'Invalid preferredStartDate';
  return '';
}

module.exports = { validateWebsiteIntake };
