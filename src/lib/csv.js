export const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const downloadCsv = (filename, rows) => {
  const csv = rows.map((line) => line.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
