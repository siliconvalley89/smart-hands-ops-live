const JOB_WINDOW_MS = 2 * 60 * 60 * 1000;
const MOVABLE_STATUSES = ['Pending', 'Assigned', 'Dispatched'];
const SCHEDULE_FIELDS = ['scheduledFor', 'scheduledEnd', 'assignedTechEmail'];
const REVERT_FIELDS = ['scheduledFor', 'scheduledEnd', 'assignedTechEmail', 'assignedTechName', 'status', 'statusUpdatedByRole'];

function toMillisValue(value) {
  if (!value) return null;
  const ms = typeof value.toMillis === 'function' ? value.toMillis() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function sameValue(a, b) {
  const ms = toMillisValue(a);
  if (ms != null || toMillisValue(b) != null) return ms === toMillisValue(b);
  return (a ?? null) === (b ?? null);
}

function getJobWindowMs(job, now) {
  const scheduled = toMillisValue(job.scheduledFor);
  if (scheduled != null) {
    const end = toMillisValue(job.scheduledEnd);
    return { start: scheduled, end: end != null && end > scheduled ? end : scheduled + JOB_WINDOW_MS };
  }
  if (job.status === 'En Route' || (job.status === 'On Site' && !job.checkOutAt)) {
    return { start: now, end: now + JOB_WINDOW_MS };
  }
  return null;
}

function hasTechConflict(target, techEmail, openJobs, now) {
  const targetWindow = getJobWindowMs(target, now) || { start: now, end: now + JOB_WINDOW_MS };
  return openJobs.some((other) => {
    if (other.id === target.id || other.assignedTechEmail !== techEmail) return false;
    const otherWindow = getJobWindowMs(other, now);
    return otherWindow && otherWindow.start < targetWindow.end && targetWindow.start < otherWindow.end;
  });
}

// True when a write moves a movable job's schedule or technician and is not our own conflict revert
function needsConflictCheck(before, after) {
  if (toMillisValue(before.conflictRevertedAt) !== toMillisValue(after.conflictRevertedAt)) return false;
  const scheduleChanged = SCHEDULE_FIELDS.some((field) => !sameValue(before[field], after[field]));
  return scheduleChanged && Boolean(after.assignedTechEmail) && MOVABLE_STATUSES.includes(after.status);
}

module.exports = { REVERT_FIELDS, hasTechConflict, needsConflictCheck, toMillisValue };
