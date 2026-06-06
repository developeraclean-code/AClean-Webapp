-- 074_payment_suggestions_auth_update.sql
-- FIX: payment_suggestions hanya punya policy write untuk service_role, padahal
-- frontend (role authenticated) meng-UPDATE status saat admin klik
-- "Konfirmasi Lunas" / "Dismiss" notifikasi pembayaran WA (App.jsx 4456, 12669,
-- 12680, 12704, 12733). Tanpa policy UPDATE untuk authenticated, update gagal
-- DIAM-DIAM (0 baris, bukan 403) → notifikasi muncul lagi tiap refresh karena
-- status DB tak pernah berubah.
-- INSERT tetap service_role-only: hanya AI backend yang boleh bikin suggestion baru.

CREATE POLICY "auth_update_payment_suggestions" ON payment_suggestions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
