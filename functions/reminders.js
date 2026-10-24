function reminderStageFor(daysOverdue, stages) {
  return stages.reduce((stage, candidate, index) => (candidate.afterDays <= daysOverdue ? index + 1 : stage), 0);
}

module.exports = { reminderStageFor };
