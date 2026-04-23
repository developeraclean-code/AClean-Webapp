-- Migration 010: Tambah kolom payment_proof_url ke invoices
-- Menyimpan URL bukti bayar dari WA (foto transfer yang dikirim customer)
-- Jalankan di Supabase SQL Editor.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_proof_url text;
