import { describe, expect, it } from 'vitest';
import { normalizePaymentTextAmount, rupiahAmountsInPaymentText, shouldInspectPaymentText } from '../waPaymentText.js';

describe('nominal bukti pembayaran WA berbentuk teks', () => {
  const vita = 'm-Transfer :\nBERHASIL\n21 Oct 2026\n19:03:55\nKe 8830883011\nMALDA RETTA\nRp 195,000.00';

  it('membaca nominal Vita tanpa tertipu tahun dan nomor rekening', () => {
    expect(shouldInspectPaymentText(vita)).toBe(true);
    expect(rupiahAmountsInPaymentText(vita)).toEqual([195000]);
    expect(normalizePaymentTextAmount(vita, 2026)).toBe(195000);
  });

  it.each([
    ['Sudah transfer Rp 195.000', 195000],
    ['Bukti TF Rp195000', 195000],
    ['Pembayaran QRIS Rp 1.250.000,00', 1250000],
    ['Transfer sukses Rp 1,250,000.00', 1250000],
  ])('membaca %s', (message, amount) => {
    expect(shouldInspectPaymentText(message)).toBe(true);
    expect(rupiahAmountsInPaymentText(message)).toEqual([amount]);
  });

  it('tetap menerima konfirmasi transfer tanpa Rp jika nominal mengikuti kata transfer', () => {
    expect(shouldInspectPaymentText('Sudah transfer 195.000')).toBe(true);
    expect(shouldInspectPaymentText('Transfer ke 8830883011 pada 21 Oct 2026')).toBe(false);
  });

  it.each([
    'Transfer ke 8830883011 pada 21 Oct 2026',
    'AC rusak, biaya Rp 195.000',
    'm-Transfer BERHASIL 21 Oct 2026',
  ])('tidak memicu pembaca pada teks tanpa bukti nominal: %s', message => {
    expect(shouldInspectPaymentText(message)).toBe(false);
  });

  it('tidak menimpa pilihan AI jika ada lebih dari satu nominal Rp', () => {
    const message = 'Transfer Rp 195.000, biaya admin Rp 2.500';
    expect(rupiahAmountsInPaymentText(message)).toEqual([195000]);
    expect(normalizePaymentTextAmount('Transfer Rp 195.000 dan Rp 25.000', 170000)).toBe(170000);
  });
});
