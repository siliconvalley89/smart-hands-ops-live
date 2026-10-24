export const calcInvoiceTotal = (items = [], serviceFee = 0) => {
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitPrice || 0)), 0) + Number(serviceFee || 0);
};
