import { isFieldRole } from './roles';
import { toMillis } from './jobTime';

export const MAX_MESSAGE_LENGTH = 2000;

export const canUseJobThread = (role) => role === 'admin' || role === 'adminAssistant' || isFieldRole(role);
export const canUseClientThread = (role) => role === 'client' || role === 'admin' || role === 'adminAssistant';

export const cleanMessageText = (input) => {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > MAX_MESSAGE_LENGTH) return null;
  return text;
};

const hasUnreadSince = (lastAt, readAtMs) => {
  const lastMs = toMillis(lastAt);
  if (lastMs == null) return false;
  return readAtMs == null || lastMs > readAtMs;
};

export const hasUnreadMessages = (job, readAtMs) => hasUnreadSince(job?.lastMessageAt, readAtMs);

export const hasUnreadClientMessages = (job, readAtMs, myEmail) =>
  job?.lastClientMessageBy !== myEmail && hasUnreadSince(job?.lastClientMessageAt, readAtMs);
