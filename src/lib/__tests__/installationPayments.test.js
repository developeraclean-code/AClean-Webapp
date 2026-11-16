import { describe, expect, it } from 'vitest';
import { earlierInstallationPaymentRequest, installationPaymentReview, isInstallationInvoice, verifiedEarlierPayment } from '../installationPayments.js';
import { paymentWithholdingReview } from '../paymentWithholding.js';
const invoice = { id: 'I1', service: 'Install', total: 2135000, paid_amount: 0, status: 'UNPAID', labor: 600000 };
const proof = { amount: 515000 };
const form = () => ({ invoice, proof, history: [], amount: '1000000', method: 'transfer', paidAt: '2026-11-10',
  finalDate: '2026-11-16', today: '2026-11-16', note: 'DP paket, referensi bank ABC', acknowledged: true, requestId: 'P1', actorName: 'Owner' });
describe('pelunasan bertahap instalasi', () => {
  it.each(['Install', 'install', ' Instalasi ', 'Installation'])('recognizes %s', service => expect(isInstallationInvoice({ service })).toBe(true));
  it.each(['Cleaning', 'Repair', '', null, 'Installment'])('excludes %s', service => expect(isInstallationInvoice({ service })).toBe(false));
  it('keeps large differences out of PPh and only reconciles real receipts', () => {
    expect(paymentWithholdingReview(invoice, proof).eligible).toBe(false);
    expect(installationPaymentReview(invoice, proof)).toMatchObject({ eligible: true, gap: 1620000 });
    const partial = { ...invoice, paid_amount: 1620000, status: 'PARTIAL_PAID' };
    expect(installationPaymentReview(partial, proof, [{ amount: 1000000 }, { amount: 620000 }])).toMatchObject({ remaining: 515000, gap: 0 });
    expect(proof.amount).toBe(515000);
  });
  it('requires each earlier receipt and does not fill the gap automatically', () => {
    expect(earlierInstallationPaymentRequest(form())).toMatchObject({ p_amount: 1000000, p_notes: 'Pembayaran bertahap instalasi: DP paket, referensi bank ABC' });
    expect(() => earlierInstallationPaymentRequest({ ...form(), amount: '' })).toThrow(/nominal/);
  });
  it.each([{ amount: '1620001' }, { amount: '-1' }, { amount: '1.5' }, { amount: 'Infinity' }, { amount: 'NaN' },
    { acknowledged: false }, { note: 'DP' }, { paidAt: '2026-02-30' }, { paidAt: '2026-11-17' }, { paidAt: '1999-12-31' },
    { paidAt: '2026-11-12', finalDate: '2026-11-11' }, { method: 'PPh' }])('rejects invalid receipt %j', patch => {
    expect(() => earlierInstallationPaymentRequest({ ...form(), ...patch })).toThrow();
  });
  it.each([{ service: 'Cleaning' }, { status: 'PAID' }, { status: 'CANCELLED' }, { withheld_amount: 10000 }, { total: NaN }, { paid_amount: -1 }, { paid_amount: 2000000 }])('rejects invalid invoice %j', patch => {
    expect(installationPaymentReview({ ...invoice, ...patch }, proof).eligible).toBe(false);
  });
  it('blocks inconsistent ledger and proof overpayment', () => {
    expect(installationPaymentReview(invoice, proof, [{ amount: 1 }]).eligible).toBe(false);
    expect(installationPaymentReview(invoice, { amount: 0 }).eligible).toBe(false);
  });
  it('validates the committed payment identity, amount, reference and balance', () => {
    const request = earlierInstallationPaymentRequest(form());
    const data = { payment: { id: 'P1', invoice_id: 'I1', amount: 1000000, method: 'transfer', paid_at: '2026-11-10', notes: request.p_notes },
      invoice: { ...invoice, status: 'PARTIAL_PAID', paid_amount: 1000000, remaining_amount: 1135000 } };
    expect(verifiedEarlierPayment(data, request)).toBe(true);
    for (const patch of [{ id: 'P2' }, { invoice_id: 'I2' }, { amount: 1620000 }, { notes: 'other' }, { method: 'cash' }])
      expect(verifiedEarlierPayment({ ...data, payment: { ...data.payment, ...patch } }, request)).toBe(false);
    expect(verifiedEarlierPayment({ ...data, invoice: { ...data.invoice, remaining_amount: 0 } }, request)).toBe(false);
    expect(verifiedEarlierPayment(null, request)).toBe(false);
  });
});
