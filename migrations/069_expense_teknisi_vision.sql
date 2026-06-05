-- Migration 069: Expense input teknisi (bensin/parkir) + AI vision
-- TIDAK ada schema baru — reuse tabel existing:
--   • expenses (category, subcategory, amount, date, teknisi_name, validation_status, ai_extraction_id)
--   • ai_extractions (source, source_ref, r2_url, extracted, status, linked_table, linked_id)
-- Yang ditambahkan hanya toggle cron cleanup (idempotent).
-- Applied di Supabase 2026-06-05.

-- Toggle cron cleanup foto expense >30 hari (default ON kecuali di-set "false")
INSERT INTO app_settings (key, value)
VALUES ('expense_foto_cleanup_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Konvensi yang dipakai (untuk dokumentasi, tidak ada DDL):
-- ai_extractions.source       = 'teknisi_dashboard'  → sumber input teknisi dari dashboard
-- ai_extractions.source_ref   = 'tekexp:<sha256>'    → hash foto untuk dedup (anti double-claim)
-- expenses.validation_status  = 'APPROVED'           → auto (tanggal struk == hari ini DAN nominal cocok ±5%)
-- expenses.validation_status  = 'PENDING_AI'         → review manual (muncul di tab Pending AI)
-- expenses.subcategory        = 'Bensin Motor' | 'Parkir'
