-- 108_maintenance_client_prices.sql
-- Price book per-klien Maintenance B2B: harga deal bisa beda tiap perusahaan.
-- Dipakai auto-isi Quotation & Invoice B2B (klien terpilih) supaya tak input manual per unit.
-- Invoice TETAP disimpan di ledger utama `invoices` (type=maintenance + maintenance_client_id) —
-- tabel ini HANYA daftar harga, bukan sistem invoice terpisah. Lihat [[project_eka_jaya_onboarding]] #6.
--
-- Pencocokan harga (di api/[route].js): match client_id + service_type, lalu prioritas baris
-- yang ac_type & capacity_pk cocok; baris dgn ac_type/capacity_pk NULL = wildcard "semua".
-- RLS RESTRICTIVE: enable RLS tanpa policy → anon/authenticated(anon key) diblok; akses lewat
-- backend SERVICE_KEY (service_role bypass RLS). Pola sama migrasi 059.

CREATE TABLE IF NOT EXISTS public.maintenance_client_prices (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES public.maintenance_clients(id) ON DELETE CASCADE,
  service_type  text NOT NULL,                 -- 'Cuci Rutin','Cuci Besar','Perbaikan','Isi Freon', dst
  ac_type       text,                          -- 'Split Wall','Ceiling Cassette', NULL = semua tipe
  capacity_pk   numeric,                        -- kapasitas spesifik; NULL = semua kapasitas
  unit_price    bigint NOT NULL,               -- harga per unit (Rp)
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Unik per (client, service, tipe, kapasitas) — NULL dinormalisasi agar wildcard tak duplikat.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mcp_key
  ON public.maintenance_client_prices
     (client_id, service_type, COALESCE(ac_type, ''), COALESCE(capacity_pk, -1));

CREATE INDEX IF NOT EXISTS idx_mcp_client ON public.maintenance_client_prices (client_id);

CREATE OR REPLACE FUNCTION public.mcp_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mcp_updated_at ON public.maintenance_client_prices;
CREATE TRIGGER trg_mcp_updated_at
  BEFORE UPDATE ON public.maintenance_client_prices
  FOR EACH ROW EXECUTE FUNCTION public.mcp_set_updated_at();

ALTER TABLE public.maintenance_client_prices ENABLE ROW LEVEL SECURITY;
-- sengaja TIDAK ada CREATE POLICY → anon & authenticated (anon key) diblok total.
