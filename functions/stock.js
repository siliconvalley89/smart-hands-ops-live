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

module.exports = { partStockAdjustments };
