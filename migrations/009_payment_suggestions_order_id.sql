-- Migration 009: Tambah kolom order_id ke payment_suggestions
-- Jalankan di Supabase SQL Editor.

ALTER TABLE payment_suggestions ADD COLUMN IF NOT EXISTS order_id text;
