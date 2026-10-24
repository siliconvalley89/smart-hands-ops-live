function partStockAdjustments(before, after) {
  const adjustments = {};
  const apply = (partId, delta) => {
    if (partId && delta) adjustments[partId] = (adjustments[partId] || 0) + delta;
  };
  if (before?.partId) apply(before.partId, Number(before.qty) || 0);
  if (after?.partId) apply(after.partId, -(Number(after.qty) || 0));
  for (const partId of Object.keys(adjustments)) {
    if (!adjustments[partId]) delete adjustments[partId];
  }
  return adjustments;
}

function stockChangeAlerts(changes, jobId) {
  const alerts = [];
  for (const change of changes) {
    if (change.delta < 0) {
      alerts.push({
        title: 'Part used',
        body: `${-change.delta} x ${change.name} used on job ${jobId}. ${change.after} on hand.`,
        tag: `part-used-${change.partId}`,
      });
    }
    if (change.before > change.reorderPoint && change.after <= change.reorderPoint) {
      alerts.push({
        title: 'Reorder part',
        body: `${change.name} is down to ${change.after} on hand (reorder at ${change.reorderPoint}).`,
        tag: `part-low-${change.partId}`,
      });
    }
  }
  return alerts;
}

module.exports = { partStockAdjustments, stockChangeAlerts };
