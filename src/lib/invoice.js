import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import logoPath from '../assets/sv-smart-dispatch-logo.jpg';
import { loadImageDataUrl } from './media';
import { BUSINESS_NAME } from './branding';

export const calcInvoiceTotal = (items = [], serviceFee = 0) => {
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitPrice || 0)), 0) + Number(serviceFee || 0);
};

export const NET_TERMS_DAYS = 30;

export const loadInvoiceBilling = async () => {
  const snapshot = await getDoc(doc(db, 'invoiceBilling', 'invoice_details'));
  if (!snapshot.exists()) throw new Error('Invoice billing details are not configured.');
  return snapshot.data();
};

export const generateInvoicePdf = async (job, onError) => {
  try {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    const logoDataUrl = await loadImageDataUrl(logoPath);
    const billing = await loadInvoiceBilling();
    const signedOffDate = job.adminSignedOffAt ? (job.adminSignedOffAt.toDate ? job.adminSignedOffAt.toDate() : new Date(job.adminSignedOffAt)) : null;
    const dueDate = signedOffDate ? new Date(signedOffDate) : null;
    if (dueDate) dueDate.setDate(dueDate.getDate() + NET_TERMS_DAYS);

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const left = 48;
    const right = pageWidth - 48;
    const width = right - left;
    const bottom = pageHeight - 90;
    const navy = [15, 23, 42];
    const muted = [100, 116, 139];
    const accent = [13, 148, 136];
    const rule = [226, 232, 240];
    const tableHeaderFill = [241, 245, 249];
    const money = (value) => `$${Number(value || 0).toFixed(2)}`;
    const dateText = (value) => (value ? value.toLocaleDateString() : 'Pending admin sign-off');
    const setText = (size, style, color) => {
      pdf.setFontSize(size);
      pdf.setFont('helvetica', style);
      pdf.setTextColor(...color);
    };

    pdf.addImage(logoDataUrl, 'JPEG', left, 40, 120, 40);
    setText(16, 'bold', navy);
    pdf.text(BUSINESS_NAME, left, 100);
    setText(26, 'bold', accent);
    pdf.text('INVOICE', right, 66, { align: 'right' });
    let metaY = 88;
    [
      ['Invoice #', job.id],
      ['Invoice date', dateText(signedOffDate)],
      ['Terms', `Net ${NET_TERMS_DAYS}`],
      ['Due date', dateText(dueDate)],
    ].forEach(([label, value]) => {
      setText(9, 'normal', muted);
      pdf.text(label, right - 200, metaY);
      setText(10, 'bold', navy);
      pdf.text(String(value), right, metaY, { align: 'right' });
      metaY += 15;
    });
    pdf.setDrawColor(...rule);
    pdf.line(left, 162, right, 162);

    let y = 184;
    const serviceColumn = 330;
    setText(8, 'bold', muted);
    pdf.text('BILL TO', left, y);
    pdf.text('SERVICE', serviceColumn, y);
    setText(11, 'normal', navy);
    const billLines = [...pdf.splitTextToSize(job.client || 'N/A', 260), ...pdf.splitTextToSize(job.location || 'N/A', 260)];
    const serviceLines = [
      ...pdf.splitTextToSize(job.task || 'N/A', right - serviceColumn),
      ...pdf.splitTextToSize(`Assigned tech: ${job.assignedTechName || 'N/A'}`, right - serviceColumn),
    ];
    billLines.forEach((line, index) => pdf.text(line, left, y + 16 + index * 14));
    serviceLines.forEach((line, index) => pdf.text(line, serviceColumn, y + 16 + index * 14));
    y += 16 + Math.max(billLines.length, serviceLines.length) * 14 + 12;

    setText(8, 'bold', muted);
    pdf.text('SERVICE DETAILS', left, y);
    setText(10, 'normal', navy);
    const detailLines = pdf.splitTextToSize(job.details || 'N/A', width);
    detailLines.forEach((line, index) => pdf.text(line, left, y + 16 + index * 13));
    y += 16 + detailLines.length * 13 + 14;

    const colDesc = left + 8;
    const descWidth = 330;
    const qtyRight = 420;
    const unitRight = 490;
    const amountRight = right - 8;
    const drawTableHeader = (top) => {
      pdf.setFillColor(...tableHeaderFill);
      pdf.rect(left, top, width, 22, 'F');
      setText(8, 'bold', muted);
      pdf.text('DESCRIPTION', colDesc, top + 14);
      pdf.text('QTY', qtyRight, top + 14, { align: 'right' });
      pdf.text('UNIT PRICE', unitRight, top + 14, { align: 'right' });
      pdf.text('AMOUNT', amountRight, top + 14, { align: 'right' });
      return top + 22;
    };
    const lineItems = [
      {
        description: `Service fee${job.serviceFeeDescription ? `: ${job.serviceFeeDescription}` : ''}`,
        qty: 1,
        unitPrice: Number(job.serviceFee || 0),
      },
      ...(job.consumables || []).map((item) => ({
        description: item.description || '',
        qty: Number(item.qty || 0),
        unitPrice: Number(item.unitPrice || 0),
      })),
    ];
    y = drawTableHeader(y);
    lineItems.forEach((item) => {
      setText(10, 'normal', navy);
      const lines = pdf.splitTextToSize(item.description, descWidth);
      const rowHeight = lines.length * 13 + 10;
      if (y + rowHeight > bottom) {
        pdf.addPage();
        y = drawTableHeader(60);
        setText(10, 'normal', navy);
      }
      lines.forEach((line, index) => pdf.text(line, colDesc, y + 15 + index * 13));
      pdf.text(String(item.qty), qtyRight, y + 15, { align: 'right' });
      pdf.text(money(item.unitPrice), unitRight, y + 15, { align: 'right' });
      pdf.text(money(item.qty * item.unitPrice), amountRight, y + 15, { align: 'right' });
      y += rowHeight;
      pdf.setDrawColor(...rule);
      pdf.line(left, y, right, y);
    });

    const total = calcInvoiceTotal(job.consumables || [], job.serviceFee);
    y += 18;
    setText(10, 'bold', muted);
    pdf.text('Total due', 456, y, { align: 'right' });
    setText(14, 'bold', accent);
    pdf.text(money(total), amountRight, y, { align: 'right' });
    y += 30;

    setText(10, 'normal', navy);
    const paymentColumns = [
      [
        ['Beneficiary', billing.beneficiary_name],
        ['Bank', billing.bank_name],
        ['Bank address', billing.bank_address],
      ],
      [
        ['Routing number', billing.routing_number],
        ['Account number', billing.account_number],
        ['Currency', billing.currency],
        ['Payment terms', billing.payment_terms],
      ],
    ].map((items) => items.map(([label, value]) => ({ label, lines: pdf.splitTextToSize(String(value || '-'), 220) })));
    const columnHeight = (items) => items.reduce((height, item) => height + 12 + item.lines.length * 12 + 6, 0);
    const boxHeight = 34 + Math.max(...paymentColumns.map(columnHeight)) + 8;
    if (y + boxHeight > bottom) {
      pdf.addPage();
      y = 60;
    }
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(...rule);
    pdf.roundedRect(left, y, width, boxHeight, 6, 6, 'FD');
    setText(9, 'bold', accent);
    pdf.text('PAYMENT DETAILS', left + 14, y + 18);
    [left + 14, left + 14 + width / 2].forEach((x, columnIndex) => {
      let itemY = y + 36;
      paymentColumns[columnIndex].forEach(({ label, lines }) => {
        setText(8, 'bold', muted);
        pdf.text(label.toUpperCase(), x, itemY);
        setText(10, 'normal', navy);
        lines.forEach((line, index) => pdf.text(line, x, itemY + 12 + index * 12));
        itemY += 12 + lines.length * 12 + 6;
      });
    });

    setText(9, 'normal', muted);
    pdf.text('Thank you for choosing Silicon Valley Smart Hands LLC.', pageWidth / 2, pageHeight - 40, { align: 'center' });
    pdf.save(`SV-Smart-Dispatch-Invoice-${job.id}.pdf`);
  } catch (error) {
    console.error('Invoice generation failed', error);
    onError('Unable to generate invoice PDF.');
    return;
  }
  // The PDF is already downloaded; marking it sent is best-effort (clients lack permission to write this)
  try {
    await updateDoc(doc(db, 'jobs', job.id), {
      invoiceSent: true,
      invoiceSentAt: new Date(),
    });
  } catch (error) {
    console.warn('Could not mark invoice as sent', error);
  }
};
