import { serverTimestamp } from 'firebase/firestore';

export const SMS_CONSENT_VERSION = 'v1.2';
export const SMS_CONSENT_DISCLOSURE = 'By checking this box, you agree to receive customer care SMS messages from Silicon Valley Smart Hands LLC at the phone number provided, including scheduling, job status, and notices of new chat messages about your service. Consent is not a condition of purchase. Msg & data rates may apply. Message frequency varies. Reply HELP for help or STOP to opt out.';

export const smsConsentRecord = (phone, recordedBy) => ({
  phone: phone.trim(),
  smsConsent: true,
  version: SMS_CONSENT_VERSION,
  disclosure: SMS_CONSENT_DISCLOSURE,
  consentedAt: serverTimestamp(),
  recordedBy,
  source: 'ops-request-form',
});
