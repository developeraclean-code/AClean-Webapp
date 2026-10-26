import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../paymentSuggestionClose.js', () => ({ closeSuggestionsForInvoice: vi.fn() }));
import { closeSuggestionsForInvoice } from '../paymentSuggestionClose.js';
import { markPaid } from '../markPaid.js';

const invoice = { id: 'INV-TEST', job_id: 'JOB-TEST', customer: 'Customer Test', phone: '6280000000000', total: 195000 };
function context(overrides = {}) {
  return {
    addAgentLog: vi.fn(), appSettings: { app_name: 'AClean' }, auditUserName: () => 'Owner Test',
    fmt: n => String(n), getLocalISOString: () => '2026-10-24T00:00:00+07:00',
    markInvoicePaid: vi.fn(async () => ({ data: { status: 'PAID' }, error: null })),
    ordersData: [], reportError: vi.fn(), retroMatchPayment: vi.fn(), sendWA: vi.fn(async () => true),
    setAuditUser: vi.fn(async () => {}), setInvoicesData: vi.fn(), setOrdersData: vi.fn(),
    showConfirm: vi.fn(async () => false), showNotif: vi.fn(), supabase: {},
    updateInvoice: vi.fn(), validatePositiveNumber: n => Number(n) > 0,
    ...overrides,
  };
}
afterEach(() => vi.clearAllMocks());

it('melaporkan kegagalan penutupan Pending AI tanpa membatalkan pembayaran', async () => {
  closeSuggestionsForInvoice.mockRejectedValueOnce(new Error('database unavailable'));
  const ctx = context();
  const result = await markPaid(invoice, 'transfer', '', false, '/api/foto?key=test', ctx);
  expect(result).toEqual({ ok: true });
  await vi.waitFor(() => expect(ctx.reportError).toHaveBeenCalledWith(
    'invoice.markPaid.closeSuggestionsFailed', expect.any(Error), { invoiceId: invoice.id },
  ));
  expect(ctx.showNotif).toHaveBeenCalledWith(expect.stringContaining('Pending AI belum direkonsiliasi'));
});

it('menampilkan kegagalan WA sesudah pembayaran tercatat', async () => {
  closeSuggestionsForInvoice.mockResolvedValueOnce(0);
  const ctx = context({ sendWA: vi.fn(async () => false) });
  const result = await markPaid(invoice, 'transfer', '', true, '/api/foto?key=test', ctx);
  expect(result).toEqual({ ok: true });
  await vi.waitFor(() => expect(ctx.reportError).toHaveBeenCalledWith(
    'invoice.markPaid.customerWaFailed', expect.any(Error), { invoiceId: invoice.id },
  ));
  expect(ctx.showNotif).toHaveBeenCalledWith(expect.stringContaining('Kirim ulang manual'));
});

it('menampilkan kegagalan retro-match tanpa mengulang transaksi pembayaran', async () => {
  closeSuggestionsForInvoice.mockResolvedValueOnce(0);
  const ctx = context({ retroMatchPayment: vi.fn(async () => { throw new Error('backend timeout'); }) });
  const result = await markPaid(invoice, 'transfer', '', false, null, ctx);
  expect(result).toEqual({ ok: true });
  await vi.waitFor(() => expect(ctx.reportError).toHaveBeenCalledWith(
    'invoice.markPaid.retroMatchFailed', expect.any(Error), { invoiceId: invoice.id },
  ));
  expect(ctx.markInvoicePaid).toHaveBeenCalledTimes(1);
  expect(ctx.showNotif).toHaveBeenCalledWith(expect.stringContaining('pencocokan bukti otomatis gagal'));
});

it('tidak menjalankan efek samping ketika RPC pembayaran gagal', async () => {
  const ctx = context({ markInvoicePaid: vi.fn(async () => ({ data: null, error: new Error('timeout') })) });
  const result = await markPaid(invoice, 'transfer', '', true, null, ctx);
  expect(result.ok).toBe(false);
  expect(ctx.sendWA).not.toHaveBeenCalled();
  expect(closeSuggestionsForInvoice).not.toHaveBeenCalled();
});
