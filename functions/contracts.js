const DAY_MS = 24 * 60 * 60 * 1000;
const FREQUENCIES = ['weekly', 'monthly'];

function advanceOccurrence(ms, frequency) {
  if (frequency === 'weekly') return ms + 7 * DAY_MS;
  const date = new Date(ms);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime();
}

function dueOccurrences(nextRunMs, frequency, horizonMs, limit) {
  const due = [];
  for (let at = nextRunMs; at <= horizonMs && due.length < limit; at = advanceOccurrence(at, frequency)) {
    due.push(at);
  }
  return due;
}

module.exports = { FREQUENCIES, advanceOccurrence, dueOccurrences };
