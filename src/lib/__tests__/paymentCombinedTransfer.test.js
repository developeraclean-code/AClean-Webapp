import { describe, expect, it, vi } from 'vitest';
import { combinedTransferReview, confirmInvoiceWaCombinedTransfer } from '../paymentCombinedTransfer.js';
import { withholdingSnapshot } from '../paymentWithholding.js';

const invoice = { id: 'INV-INSTALL', phone: '628000000001', status: 'UNPAID', total: 3456000, labor: 700000, material: 2756000, paid_amount: 0 };
const suggestion = { id: 'WA-1', phone: '628000000001', amount: 8574000, image_url: '/wa-proof.jpg' };
const input = () => ({ supabase: { rpc: vi.fn() }, invoice, suggestion, requestId: 'REQUEST', paidAt: '2026-11-04', note: 'Transfer untuk pembelian AC unit dan instalasi', reviewAcknowledged: true });
const result = () => ({ invoice: { ...invoice, status: 'PAID', payment_proof_url: suggestion.image_url },
  payment: { amount: 3456000, withheld_amount: 0, combined_transfer_detail: { transfer_amount: 8574000, unallocated_amount: 5118000 } },
  suggestion: { ...suggestion, invoice_id: invoice.id, status: 'CONFIRMED', validation_status: 'LINKED' }, orders: [] });

describe('manual combined AC and installation transfer', () => {
  it('allocates only the invoice remainder and identifies the unallocated excess', () => {
    expect(combinedTransferReview(invoice, suggestion)).toMatchObject({ eligible: true, remaining: 3456000, transfer: 8574000, excess: 5118000 });
  });
  it.each([3456000, 3455999, 0, NaN, Infinity, 8574000.5])('does not use this path for non-overpayments or invalid amounts: %s', amount => {
    expect(combinedTransferReview(invoice, { ...suggestion, amount }).eligible).toBe(false);
  });
  it('calls only the atomic RPC after explicit review and verifies the response', async () => {
    const args = input(); args.supabase.rpc.mockResolvedValue({ data: result() });
    expect((await confirmInvoiceWaCombinedTransfer(args)).invoice.status).toBe('PAID');
    expect(args.supabase.rpc).toHaveBeenCalledWith('confirm_invoice_wa_combined_transfer_atomic', expect.objectContaining({
      p_request_id: 'REQUEST', p_expected_invoice: withholdingSnapshot(invoice), p_review_ack: true,
    }));
  });
  it.each([{ reviewAcknowledged: false }, { note: 'short' }, { suggestion: { ...suggestion, amount: 3000000 } }])('blocks unsafe review %j', async patch => {
    const args = { ...input(), ...patch }; await expect(confirmInvoiceWaCombinedTransfer(args)).rejects.toThrow();
    expect(args.supabase.rpc).not.toHaveBeenCalled();
  });
  it('never falls back to direct writes when the migration is missing', async () => {
    const args = input(); args.supabase.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    await expect(confirmInvoiceWaCombinedTransfer(args)).rejects.toThrow(/Migrasi 229/);
    expect(args.supabase.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['payment', 'metadata', 'invoice', 'proof'])('rejects an incomplete %s result', async part => {
    const args = input(), data = result();
    if (part === 'payment') data.payment.amount = 8574000;
    if (part === 'metadata') data.payment.combined_transfer_detail.unallocated_amount = 0;
    if (part === 'invoice') data.invoice.status = 'UNPAID';
    if (part === 'proof') data.suggestion.validation_status = 'PENDING';
    args.supabase.rpc.mockResolvedValue({ data });
    await expect(confirmInvoiceWaCombinedTransfer(args)).rejects.toThrow(/belum lengkap/);
  });
});
