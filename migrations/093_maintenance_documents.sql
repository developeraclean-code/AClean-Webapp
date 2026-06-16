-- Migration 093: Dokumen universal untuk modul Maintenance (B2B).
-- Dokumen per customer maintenance: Berita Acara Pengerjaan, Form Commissioning/Uji Fungsi,
-- Kartu Garansi, Surat Penerimaan Barang, Surat Pengiriman Barang.
-- Struktur mengikuti project_documents (items/checklist jsonb, TTD virtual data-URL).
--
-- KEAMANAN: RLS-RESTRICTIVE (sama seperti tabel maintenance lain, migrasi 059).
--   - TIDAK ada policy → anon key (bundle frontend publik) diblok total.
--   - Semua akses lewat api/[route].js action maintenance memakai SUPABASE_SERVICE_KEY (bypass RLS).

CREATE TABLE IF NOT EXISTS maintenance_documents (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  maintenance_client_id uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  jenis                 text NOT NULL,                 -- "Berita Acara Pengerjaan" dst
  nomor                 text,                          -- "BA/AC/2026/06/001"
  tanggal               date,
  kepada                text,                          -- penerima (PIC / nama)
  periode               text,
  uraian                text,
  items                 jsonb DEFAULT '[]'::jsonb,     -- baris tabel (skema kolom per-jenis)
  checklist             jsonb DEFAULT '[]'::jsonb,     -- Berita Acara: checklist serah terima
  foto                  int  DEFAULT 0,
  ttd_teknisi           text DEFAULT '(teknisi)',
  ttd_customer          text DEFAULT '(belum)',
  ttd_customer_img      text,                          -- data-URL PNG dari SignaturePad
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mdocs_client ON maintenance_documents(maintenance_client_id);

ALTER TABLE maintenance_documents ENABLE ROW LEVEL SECURITY;
-- sengaja TIDAK ada CREATE POLICY → anon & authenticated (anon key) diblok total.
