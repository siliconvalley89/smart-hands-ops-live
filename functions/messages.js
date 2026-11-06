const STAFF_AUTHOR_ROLES = ['admin', 'adminAssistant'];
const PREVIEW_LENGTH = 120;

function messagePushTarget(message, job) {
  if (STAFF_AUTHOR_ROLES.includes(message.authorRole)) {
    return job.assignedTechEmail ? { email: job.assignedTechEmail } : null;
  }
  return { roles: STAFF_AUTHOR_ROLES };
}

function messagePushText(message, job) {
  const text = String(message.text || '');
  const preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
  return {
    title: `Message: ${job.task || job.client || 'Job'}`,
    body: `${message.authorName || message.authorEmail || 'Someone'}: ${preview}`,
  };
}

module.exports = { messagePushTarget, messagePushText };
