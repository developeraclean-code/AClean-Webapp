import { describe, expect, it, vi } from 'vitest';
import { isPaymentInboxSuggestion } from '../paymentMediaPolicy.js';
import { fetchPendingPaymentSuggestions } from '../paymentInbox.js';

describe('payment-only inbox, including historical broad fallbacks', () => {
  it('filters 200 mixed messages without modifying data or dropping old genuine receipts', async () => {
    const rows = Array.from({ length: 200 }, (_, n) => {
      const kind = n % 5;
      return { id: `${n}`, status: 'PENDING', amount: kind === 0 ? 985000 : null,
        created_at: '2026-04-24', match_source: kind < 2 ? 'wa_image_ai' : 'wa_image_review',
        raw_message: kind === 2 ? 'Media WA perlu review manual: Pengirim memiliki invoice terbuka, tetapi AI mengategorikan media sebagai kerusakan_ac.'
          : kind === 3 ? 'Media WA perlu review manual: AI mengategorikan media sebagai dokumen; periksa apakah ini bukti bayar.'
          : kind === 4 ? 'Media WA perlu review manual: AI timeout' : 'Bukti transfer terdeteksi AI. Periksa invoice dan nominal sebelum konfirmasi.' };
    });
    const snapshot = structuredClone(rows);
    const chain = { select() { return this; }, eq() { return this; }, order() { return this; }, range: vi.fn(async from => ({ data: from === 0 ? rows : [] })) };
    expect(await fetchPendingPaymentSuggestions({ from: () => chain })).toEqual(rows.filter((_, n) => n % 5 < 2));
    expect(chain.range).toHaveBeenCalledTimes(2); // Pagination uses raw page length, not filtered count.
    expect(rows).toEqual(snapshot);
  });
  it('retains manually reviewed real amounts, text payments, and no-amount recognized receipts', () => {
    expect(isPaymentInboxSuggestion({ match_source: 'wa_image_review', amount: 950000, raw_message: 'Diteruskan staf' })).toBe(true);
    expect(isPaymentInboxSuggestion({ match_source: 'wa_image_ai', amount: null })).toBe(true);
    expect(isPaymentInboxSuggestion({ match_source: null, amount: 950000 })).toBe(true);
    expect(isPaymentInboxSuggestion({ match_source: 'wa_text_ai', amount: 950000 })).toBe(true);
  });
});
