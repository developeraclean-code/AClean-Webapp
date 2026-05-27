-- Migration 046: Security audit follow-up — tighten RLS policies
-- Tanggal: 2026-05-27
-- Konteks: Audit security temukan 2 HIGH severity di RLS:
--   H-01: customer_tokens policy `service_full` qual=true membolehkan anon
--         membaca SEMUA token aktif → portal hijack risk.
--   H-02: merged_pdf_cache tidak punya policy sama sekali (RLS enabled →
--         deny semua dari anon/authenticated) → fitur cache merged PDF
--         tidak berfungsi via frontend.
-- Reference: Security audit report di chat history 2026-05-27.

-- ════════════════════════════════════════════════════════════════════════
-- H-01: customer_tokens — RESTRICT KE SERVICE ROLE ONLY
-- ════════════════════════════════════════════════════════════════════════
-- Frontend tidak pernah query langsung customer_tokens — semua via
-- /api/generate-customer-token (backend pakai service key). Cust portal
-- juga akses via /api/customer-status (backend lookup token → return data).
-- Jadi kita drop policy permissive dan ganti dgn service-role only.

DROP POLICY IF EXISTS service_full ON customer_tokens;

CREATE POLICY tokens_service_only ON customer_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON POLICY tokens_service_only ON customer_tokens IS
  'Hanya service_role (backend) yg boleh akses. Frontend pakai /api/generate-customer-token endpoint untuk issue token, /api/customer-status untuk konsumsi.';

-- ════════════════════════════════════════════════════════════════════════
-- H-02: merged_pdf_cache — ALLOW AUTHENTICATED USERS
-- ════════════════════════════════════════════════════════════════════════
-- Cache merged PDF dibaca/ditulis dari frontend (App.jsx generateMergedInvoicePDFBlob).
-- Pakai authenticated role (semua user app login via Supabase Auth).
-- Trigger auto-invalidate di migration 044 tetap jalan (trigger pakai SECURITY DEFINER
-- secara default melalui executing user, tapi DELETE di trigger pakai service_role context).

CREATE POLICY merged_cache_select ON merged_pdf_cache
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY merged_cache_insert ON merged_pdf_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY merged_cache_update ON merged_pdf_cache
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Service role tetap bypass RLS by default; tidak butuh policy eksplisit.
-- DELETE biasanya hanya via trigger invalidate_merged_pdf_cache (SECURITY DEFINER),
-- atau cleanup job backend pakai service key.

COMMENT ON TABLE merged_pdf_cache IS
  'Cache merged PDF untuk multi-invoice. RLS: authenticated users SELECT/INSERT/UPDATE, service_role bypass. DELETE via trigger auto-invalidate (lihat migration 044).';
