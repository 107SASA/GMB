/**
 * Invoice layout and the pure helpers behind it (runs under `node --test`).
 *
 * The company is not registered under GST (COMPANY.gstin is null): the
 * document is titled "INVOICE", charges no GST and says so. Once a GSTIN is
 * set it becomes a "TAX INVOICE" — the GST breakdown itself is added at that
 * point, with the CA, before any tax is charged.
 */

/** Invoices start at this serial in every financial year (first = START + 1). */
export const INVOICE_SERIAL_START = 1000;

/** Indian financial year (1 April – 31 March) of a date, in IST: "2026-27". */
export function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1; // April = month 3
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(financialYear: string, serial: number): string {
  return `GM/${financialYear}/${String(serial).padStart(4, '0')}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** 10000 → "Rupees Ten Thousand Only"; 1234.5 → "... and Fifty Paise Only" (Indian lakh / crore grouping). */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.round(amount * 100) / 100);
  const paise = Math.round((amount - rupees) * 100);
  const words = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
    const lakh = Math.floor(n / 100_000); n %= 100_000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
    if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
    if (n) parts.push(belowThousand(n));
    return parts.join(' ');
  };
  return `Rupees ${words(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`;
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

export interface InvoiceView {
  invoiceNumber: string;
  issuedAt: Date | string;
  paidAt: Date | string;
  amount: number;
  taxAmount: number;
  currency: string;
  description: string;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  paymentMethod?: string | null;
  razorpayPaymentId: string;
  supplier: { legalName: string; brand: string; address: string; cin: string; pan: string; gstin: string | null; email: string; website: string };
  billedTo: { name: string; businessName: string; address: string; email: string | null; phone: string | null };
}

const METHOD: Record<string, string> = { card: 'Card', upi: 'UPI', netbanking: 'Net banking', wallet: 'Wallet', emandate: 'e-Mandate', nach: 'NACH' };

/** The printable invoice (A4). */
export function renderInvoiceHtml(inv: InvoiceView): string {
  const registered = !!inv.supplier.gstin;
  const title = registered ? 'TAX INVOICE' : 'INVOICE';
  const period = inv.periodStart && inv.periodEnd ? `Service period: ${day(inv.periodStart)} to ${day(inv.periodEnd)}` : '';
  const method = inv.paymentMethod ? METHOD[inv.paymentMethod] || inv.paymentMethod : 'Online';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNumber)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:12px;margin:0;padding:28px}
  h1{font-size:20px;letter-spacing:2px;margin:0;color:#111827} .muted{color:#6b7280} .small{font-size:10.5px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #06b34c;padding-bottom:14px}
  .brand{font-size:18px;font-weight:700;color:#06b34c} .meta td{padding:2px 0 2px 12px;text-align:right}
  .parties{display:flex;gap:24px;margin:18px 0} .box{flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:12px}
  .box h3{margin:0 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:#6b7280}
  table.items{width:100%;border-collapse:collapse;margin-top:6px} .items th{background:#f3f4f6;text-align:left;padding:8px;font-size:11px}
  .items td{padding:10px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top} .r{text-align:right}
  .totals{margin-left:auto;width:300px;margin-top:10px} .totals td{padding:5px 8px} .grand td{font-weight:700;font-size:13px;border-top:2px solid #111827}
  .note{margin-top:16px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px}
  .foot{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px}
</style></head><body>
<div class="top">
  <div>
    <div class="brand">${esc(inv.supplier.brand)}</div>
    <div style="font-weight:700;margin-top:4px">${esc(inv.supplier.legalName)}</div>
    <div class="muted small" style="max-width:340px">${esc(inv.supplier.address)}</div>
    <div class="small" style="margin-top:4px">CIN: ${esc(inv.supplier.cin)} &nbsp;·&nbsp; PAN: ${esc(inv.supplier.pan)}${registered ? ` &nbsp;·&nbsp; GSTIN: ${esc(inv.supplier.gstin)}` : ''}</div>
    <div class="small muted">${esc(inv.supplier.email)} &nbsp;·&nbsp; ${esc(inv.supplier.website)}</div>
  </div>
  <div style="text-align:right">
    <h1>${title}</h1>
    <table class="meta small" style="margin-top:8px;margin-left:auto">
      <tr><td class="muted">Invoice No.</td><td><b>${esc(inv.invoiceNumber)}</b></td></tr>
      <tr><td class="muted">Invoice date</td><td>${esc(day(inv.issuedAt))}</td></tr>
      <tr><td class="muted">Payment date</td><td>${esc(day(inv.paidAt))}</td></tr>
      <tr><td class="muted">Status</td><td><b style="color:#06b34c">PAID</b></td></tr>
    </table>
  </div>
</div>
<div class="parties">
  <div class="box">
    <h3>Billed to</h3>
    <div style="font-weight:700">${esc(inv.billedTo.businessName || inv.billedTo.name)}</div>
    ${inv.billedTo.businessName && inv.billedTo.name && inv.billedTo.name !== inv.billedTo.businessName ? `<div>${esc(inv.billedTo.name)}</div>` : ''}
    ${inv.billedTo.address ? `<div class="muted small">${esc(inv.billedTo.address)}</div>` : ''}
    ${inv.billedTo.email ? `<div class="small">${esc(inv.billedTo.email)}</div>` : ''}
    ${inv.billedTo.phone ? `<div class="small">${esc(inv.billedTo.phone)}</div>` : ''}
  </div>
  <div class="box">
    <h3>Payment</h3>
    <div class="small">Mode: ${esc(method)} (via Razorpay)</div>
    <div class="small">Payment ID: ${esc(inv.razorpayPaymentId)}</div>
    <div class="small">Amount received: <b>${esc(formatInr(inv.amount))}</b></div>
  </div>
</div>
<table class="items">
  <thead><tr><th style="width:36px">#</th><th>Description</th><th class="r" style="width:60px">Qty</th><th class="r" style="width:120px">Amount</th></tr></thead>
  <tbody><tr>
    <td>1</td>
    <td><b>${esc(inv.description)}</b>${period ? `<div class="muted small" style="margin-top:3px">${esc(period)}</div>` : ''}</td>
    <td class="r">1</td>
    <td class="r">${esc(formatInr(inv.amount - inv.taxAmount))}</td>
  </tr></tbody>
</table>
<table class="totals small">
  <tr><td class="muted">Subtotal</td><td class="r">${esc(formatInr(inv.amount - inv.taxAmount))}</td></tr>
  <tr><td class="muted">GST</td><td class="r">${registered ? esc(formatInr(inv.taxAmount)) : 'Not applicable'}</td></tr>
  <tr class="grand"><td>Total</td><td class="r">${esc(formatInr(inv.amount))}</td></tr>
</table>
<div class="small" style="text-align:right;margin-top:4px"><b>Amount in words:</b> ${esc(amountInWords(inv.amount))}</div>
${registered ? '' : `<div class="note small"><b>Note:</b> ${esc(inv.supplier.legalName)} is not registered under the Goods and Services Tax (GST) Act. No GST has been charged on this invoice.</div>`}
<div class="foot small muted">
  ${esc(inv.supplier.brand)} is a product of ${esc(inv.supplier.legalName)}.<br>
  This is a computer-generated invoice and does not require a signature. For any questions about this invoice, write to ${esc(inv.supplier.email)} quoting the invoice number.
</div>
</body></html>`;
}
