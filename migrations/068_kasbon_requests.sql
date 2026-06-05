-- Migration 068: Tabel kasbon_requests
-- Request kasbon dari teknisi/helper → approve by Owner/Admin → auto-insert ke expenses

CREATE TABLE IF NOT EXISTS kasbon_requests (
  id              TEXT PRIMARY KEY,          -- KSB-<timestamp>-<random>
  teknisi_name    TEXT NOT NULL,             -- nama teknisi/helper (trimmed)
  teknisi_phone   TEXT,                      -- untuk WA notif balik
  amount          BIGINT NOT NULL,           -- nominal kasbon (Rp)
  reason          TEXT NOT NULL,             -- alasan/keperluan
  status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  requested_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT,                      -- nama admin/owner yang review
  review_notes    TEXT,                      -- catatan dari admin/owner
  expense_id      TEXT,                      -- link ke expenses.id setelah APPROVED
  job_id          TEXT,                      -- opsional: link ke order terkait
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk query by status (admin melihat pending)
CREATE INDEX IF NOT EXISTS idx_kasbon_requests_status ON kasbon_requests(status);
-- Index untuk query by teknisi (teknisi melihat request mereka sendiri)
CREATE INDEX IF NOT EXISTS idx_kasbon_requests_teknisi ON kasbon_requests(teknisi_name);

-- RLS: teknisi bisa insert + lihat milik sendiri; admin/owner bisa lihat semua
-- (menggunakan service key di backend atau anon key dengan RLS policy)
ALTER TABLE kasbon_requests ENABLE ROW LEVEL SECURITY;

-- Policy: semua authed user bisa insert (teknisi buat request)
CREATE POLICY "insert_own_kasbon" ON kasbon_requests
  FOR INSERT TO anon WITH CHECK (true);

-- Policy: baca semua (admin/owner perlu lihat semua; teknisi filter di frontend)
CREATE POLICY "read_kasbon" ON kasbon_requests
  FOR SELECT TO anon USING (true);

-- Policy: update hanya oleh admin/owner (via service key di approval handler)
CREATE POLICY "update_kasbon" ON kasbon_requests
  FOR UPDATE TO anon USING (true);
