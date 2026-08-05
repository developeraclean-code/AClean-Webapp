-- Migration 131: kolom PPh 23 di quotations (gross-up, mirror invoices)
-- Quotation "ala-Excel" (redesign form input + PDF) menambahkan opsi PPh 23 (2,5%)
-- yang dihitung dari baris kategori Jasa saja, lalu di-gross-up (rumus sama dgn
-- computePph23() di lib/invoicing.js, sudah dipakai invoices.pph23/pph23_amount).
-- quotations belum punya kolom ini sama sekali (invoices sudah) — perlu ditambah
-- supaya toggle PPh23 di form Quotation bisa disimpan & tampil di PDF.

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS pph23 boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pph23_amount numeric DEFAULT 0;
