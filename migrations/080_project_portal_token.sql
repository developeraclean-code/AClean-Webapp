-- 080_project_portal_token.sql
-- APPLIED (via MCP, 2026-06-12)
--
-- Portal customer untuk modul Project: customer bisa pantau progres harian + pemakaian
-- material + foto lapangan, hanya untuk laporan harian yang sudah di-VERIFIED Owner/Admin
-- (layer pengaman approval). Token permanen, bisa di-ON/OFF.
--
-- Pola sama dengan portal Maintenance B2B (maintenance_clients.portal_token).
-- Backend: /api/project-portal (PUBLIC). Route: /p/<token> atau /status/ptk_<...>.

alter table project_projects
  add column if not exists portal_token text,
  add column if not exists token_active boolean not null default false;

-- Token unik (boleh banyak NULL)
create unique index if not exists project_projects_portal_token_uniq
  on project_projects (portal_token) where portal_token is not null;

-- Catatan: gate approval portal = project_harian.status = 'VERIFIED' (sudah ada,
-- di-set lewat tombol Verify oleh Owner/Admin). Tidak perlu kolom approval baru.
