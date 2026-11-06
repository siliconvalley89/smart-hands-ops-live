import { isFieldRole } from './roles';
import { toMillis } from './jobTime';

export const MAX_MESSAGE_LENGTH = 2000;

export const canUseJobThread = (role) => role === 'admin' || role === 'adminAssistant' || isFieldRole(role);

export const cleanMessageText = (input) => {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > MAX_MESSAGE_LENGTH) return null;
  return text;
};

export const hasUnreadMessages = (job, readAtMs) => {
  const lastMessageMs = toMillis(job?.lastMessageAt);
  if (lastMessageMs == null) return false;
  return readAtMs == null || lastMessageMs > readAtMs;
};
