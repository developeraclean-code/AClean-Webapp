-- Migration 099: Maintenance Follow-up Actions + Pre-Service Manifest
-- 1. maintenance_followups — tracking temuan lapangan yang perlu tindak lanjut
-- 2. pre_service_manifests — rencana penugasan tim sebelum berangkat ke lokasi
-- 3. pre_service_manifest_items — detail unit per tim

-- ─────────────────────────────────────────────────────────────
-- 1. maintenance_followups
--    Mencatat temuan lapangan (kapasitor rusak, bocor freon, dll)
--    Menjadi sumber: reminder WA Owner + input penawaran ke klien
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_followups (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id       uuid NOT NULL REFERENCES maintenance_units(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  log_id        uuid REFERENCES maintenance_logs(id) ON DELETE SET NULL, -- log yang mencatat temuan
  issue_type    text NOT NULL
    CHECK (issue_type IN (
      'kapasitor_rusak',     -- komponen listrik perlu diganti
      'bocor_freon',         -- refrigerant leak
      'kompresor_lemah',     -- kompresor bermasalah
      'drain_tersumbat',     -- saluran pembuangan
      'pcb_rusak',           -- board kontrol
      'filter_buntu',        -- filter perlu ganti
      'fan_motor_lemah',     -- motor kipas
      'lainnya'              -- temuan lain (lihat description)
    )),
  description   text,                         -- detail bebas dari teknisi
  found_date    date NOT NULL DEFAULT CURRENT_DATE,
  found_by      text,                          -- nama teknisi yang menemukan
  status        text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','scheduled','in_progress','done','cancelled')),
  priority      text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('critical','high','normal','low')),
  resolved_date date,
  resolved_by   text,
  resolution    text,                          -- catatan penyelesaian
  estimated_cost bigint,                       -- estimasi biaya perbaikan (untuk quotasi)
  wa_alerted_at  timestamptz,                 -- kapan Owner sudah di-WA alert
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfollowup_unit   ON maintenance_followups(unit_id);
CREATE INDEX IF NOT EXISTS idx_mfollowup_client ON maintenance_followups(client_id);
CREATE INDEX IF NOT EXISTS idx_mfollowup_status ON maintenance_followups(status);

-- RLS: restrictive (sama seperti maintenance_units / maintenance_logs)
ALTER TABLE maintenance_followups ENABLE ROW LEVEL SECURITY;
-- Tidak ada policy anon → service_role only (backend memanggil pakai SUPABASE_SERVICE_KEY)

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION mfollowup_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mfollowup_updated_at ON maintenance_followups;
CREATE TRIGGER trg_mfollowup_updated_at
  BEFORE UPDATE ON maintenance_followups
  FOR EACH ROW EXECUTE FUNCTION mfollowup_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. pre_service_manifests
--    Dokumen perencanaan SEBELUM tim berangkat ke lokasi.
--    Setiap manifest = 1 kunjungan ke 1 klien pada 1 tanggal.
--    Isinya: siapa tim yang mana, unit/lantai apa saja.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pre_service_manifests (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  order_id      text,                          -- link ke orders.id bila ada
  status        text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','in_progress','completed','cancelled')),
  notes         text,
  created_by    text,
  confirmed_at  timestamptz,
  confirmed_by  text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (client_id, service_date)             -- 1 manifest per klien per hari
);

CREATE INDEX IF NOT EXISTS idx_manifest_client ON pre_service_manifests(client_id);
CREATE INDEX IF NOT EXISTS idx_manifest_date   ON pre_service_manifests(service_date);

ALTER TABLE pre_service_manifests ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_manifest_updated_at ON pre_service_manifests;
CREATE TRIGGER trg_manifest_updated_at
  BEFORE UPDATE ON pre_service_manifests
  FOR EACH ROW EXECUTE FUNCTION mfollowup_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. pre_service_manifest_items
--    Detail per baris: tim → unit yang ditugaskan
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pre_service_manifest_items (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  manifest_id   uuid NOT NULL REFERENCES pre_service_manifests(id) ON DELETE CASCADE,
  unit_id       uuid NOT NULL REFERENCES maintenance_units(id) ON DELETE CASCADE,
  team_label    text,                          -- "Tim A", "Tim Rey", "LT1", dll
  technician    text,                          -- nama teknisi assigned ke unit ini
  helper        text,                          -- nama helper (opsional)
  service_category text DEFAULT 'cuci_rutin'
    CHECK (service_category IN ('cuci_rutin','inspeksi','perbaikan','pengecekan')),
  notes         text,
  done          boolean DEFAULT false,         -- tandai selesai saat eksekusi lapangan
  UNIQUE (manifest_id, unit_id)               -- 1 unit hanya ada 1x per manifest
);

CREATE INDEX IF NOT EXISTS idx_mitem_manifest ON pre_service_manifest_items(manifest_id);
CREATE INDEX IF NOT EXISTS idx_mitem_unit     ON pre_service_manifest_items(unit_id);

ALTER TABLE pre_service_manifest_items ENABLE ROW LEVEL SECURITY;
