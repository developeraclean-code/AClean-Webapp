-- Migration 006: Tambah kolom image_url ke wa_messages untuk Opsi C image storage
-- Jalankan di Supabase SQL Editor

ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS image_url text;
