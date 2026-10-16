import { describe, expect, it, vi } from 'vitest';
import { confirmInvoiceWaWithholding, invoiceCashReceived, paymentWithholdingReview, withholdingMaterials, withholdingSnapshot } from '../paymentWithholding.js';
import { auditOperationalIntegrity } from '../sfmIntegrity.js';

const invoice = { id: 'INV-DEMO', customer: 'Perusahaan contoh', phone: '628000000001', status: 'UNPAID', total: 2950000, labor: 2350000, material: 600000, paid_amount: 0, pph23: false };
const proof = { id: 'PROOF', phone: '628000000002', amount: 2902500, image_url: '/demo.jpg' };

describe('browser/database materials snapshot regression', () => {
  const items = [{ nama: 'Jasa contoh', subtotal: 2350000, category: 'LABOR' }, { nama: 'Material contoh', subtotal: 600000, category: 'PART' }];
  it('raw database JSON text and the parsed App invoice produce identical snapshots', () => {
    const raw = { ...invoice, materials_detail: JSON.stringify(items, null, 2) };
    const parsed = { ...raw, materials_detail: JSON.parse(raw.materials_detail) };
    expect(withholdingSnapshot(raw)).toEqual(withholdingSnapshot(parsed));
    expect(Array.isArray(withholdingSnapshot(parsed).materials_detail)).toBe(true);
  });
  it.each([undefined, null, '', '  ', 'null', '[]', []])('normalizes the empty storage format %j without a false stale warning', value => {
    expect(withholdingMaterials(value)).toEqual([]);
  });
  it.each(['{broken', '{}', 'false', '1', '"[]"', {}, false, 1])('fails closed for malformed/non-array details %j', value => {
    expect(() => withholdingMaterials(value)).toThrow(/Rincian item/);
  });
  it('keeps real item quantity/price changes visible and never removes/reorders duplicates', () => {
    const source = [...items, { ...items[0] }], before = structuredClone(source);
    expect(withholdingSnapshot({ ...invoice, materials_detail: source }).materials_detail).toEqual(before);
    expect(source).toEqual(before);
    expect(withholdingSnapshot({ ...invoice, materials_detail: source })).not.toEqual(withholdingSnapshot({ ...invoice, materials_detail: [{ ...source[0], subtotal: 2350001 }, ...source.slice(1)] }));
  });
});

describe('reviewed PPh tolerance, never automatic tax approval', () => {
  it('uses labor, not material or invoice total, for the admin 2–3% tolerance', () => {
    expect(paymentWithholdingReview(invoice, proof)).toMatchObject({ eligible: true, deduction: 47500, expectedTax: 47000, base: 2350000, differentPhone: true });
    expect(paymentWithholdingReview(invoice, proof).effectiveRate).toBeCloseTo(2.0212766);
  });
  it.each([47000, 70500])('accepts the inclusive %i tolerance boundary', deduction => {
    expect(paymentWithholdingReview(invoice, { ...proof, amount: invoice.total - deduction }).eligible).toBe(true);
  });
  it.each([0, 46999, 70501, 500000, -100])('does not turn arbitrary short/overpayment %i into tax', deduction => {
    expect(paymentWithholdingReview(invoice, { ...proof, amount: invoice.total - deduction }).eligible).toBe(false);
  });
  it.each([{ pph23: true }, { pph23_amount: 47000 }, { withheld_amount: 47000 }, { labor: 0 }, { labor: 4000000 }, { total: NaN }, { status: 'PAID' }, { status: 'CANCELLED' }])('fails closed for invalid/already-taxed invoice %j', patch => {
    expect(paymentWithholdingReview({ ...invoice, ...patch }, proof).eligible).toBe(false);
  });
  it.each([NaN, Infinity, 0, -1, null, 2902500.5])('requires an exact positive integer transfer: %s', amount => {
    expect(paymentWithholdingReview(invoice, { ...proof, amount }).eligible).toBe(false);
  });
  it('uses remaining after DP, not the full invoice as a new receipt', () => {
    expect(paymentWithholdingReview({ ...invoice, status: 'PARTIAL_PAID', paid_amount: 1000000 }, { ...proof, amount: 1902500 })).toMatchObject({ eligible: true, remaining: 1950000, deduction: 47500 });
  });
  it('snapshot is stable for numeric PostgREST strings and preserves pricing/phone identity', () => {
    expect(withholdingSnapshot({ ...invoice, total: '2950000', labor: '2350000', paid_amount: null })).toEqual(withholdingSnapshot(invoice));
  });
});

describe('cash versus noncash credit and integrity audit', () => {
  it('never counts withholding as bank cash, including fallback and legacy cases', () => {
    expect(invoiceCashReceived({ ...invoice, status: 'PAID', withheld_amount: 47500 })).toBe(2902500);
    expect(invoiceCashReceived({ ...invoice, status: 'PAID' })).toBe(2950000);
    expect(invoiceCashReceived({ ...invoice, status: 'PARTIAL_PAID', paid_amount: 1000000, withheld_amount: 20000 })).toBe(980000);
    expect(invoiceCashReceived({ ...invoice, status: 'PAID', cash_amount: 1000000, withheld_amount: 47500 })).toBe(1000000);
    expect(invoiceCashReceived(invoice)).toBe(0);
  });
  it('does not incorrectly repair a fully settled tax-credit invoice back to PARTIAL_PAID', () => {
    const result = auditOperationalIntegrity({ orders: [{ id: 'JOB', status: 'PAID' }], reports: [{ id: 'REPORT', job_id: 'JOB', status: 'VERIFIED' }], invoices: [{ ...invoice, job_id: 'JOB', status: 'PAID', paid_amount: 2950000, remaining_amount: 0 }],
      invoicePayments: [{ id: 'PAY', invoice_id: invoice.id, amount: 2902500, withheld_amount: 47500 }] });
    expect(result.issues).toEqual([]);
  });
});

describe('atomic tax-credit confirmation client', () => {
  const input = () => ({ supabase: { rpc: vi.fn() }, invoice, suggestion: proof, requestId: 'REQUEST', paidAt: '2026-10-15', note: 'Finance confirmed company payment', reviewAcknowledged: true });
  const result = () => ({ invoice: { ...invoice, status: 'PAID', withheld_amount: 47500, payment_proof_url: proof.image_url },
    payment: { amount: 2902500, withheld_amount: 47500 }, suggestion: { ...proof, invoice_id: invoice.id, status: 'CONFIRMED', validation_status: 'LINKED' }, orders: [] });
  it('passes stable request, exact snapshot and explicit admin review to one RPC only', async () => {
    const args = input(); args.supabase.rpc.mockResolvedValue({ data: result() });
    expect((await confirmInvoiceWaWithholding(args)).invoice.status).toBe('PAID');
    expect(args.supabase.rpc).toHaveBeenCalledWith('confirm_invoice_wa_withholding_atomic', expect.objectContaining({ p_request_id: 'REQUEST', p_expected_invoice: withholdingSnapshot(invoice), p_review_ack: true, p_paid_at: '2026-10-15' }));
  });
  it.each([{ reviewAcknowledged: false }, { note: '' }, { suggestion: { ...proof, amount: 2500000 } }, { suggestion: { ...proof, image_url: null } }])('never calls the database for an unsafe request %j', async patch => {
    const args = { ...input(), ...patch }; await expect(confirmInvoiceWaWithholding(args)).rejects.toThrow(); expect(args.supabase.rpc).not.toHaveBeenCalled();
  });
  it.each(['cash', 'deduction', 'invoice', 'proof', 'suggestion', 'orders'])('does not report success for malformed %s result', async field => {
    const args = input(), data = result();
    if (field === 'cash') data.payment.amount = 2950000;
    if (field === 'deduction') data.payment.withheld_amount = 0;
    if (field === 'invoice') data.invoice.status = 'UNPAID';
    if (field === 'proof') data.invoice.payment_proof_url = '/wrong.jpg';
    if (field === 'suggestion') data.suggestion.validation_status = 'PENDING';
    if (field === 'orders') delete data.orders;
    args.supabase.rpc.mockResolvedValue({ data }); await expect(confirmInvoiceWaWithholding(args)).rejects.toThrow(/belum lengkap/);
  });
  it('migration and server errors are explicit, never direct-write fallbacks', async () => {
    const args = input(); args.supabase.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    await expect(confirmInvoiceWaWithholding(args)).rejects.toThrow(/Migrasi 212/); expect(args.supabase.rpc).toHaveBeenCalledTimes(1);
  });
});
