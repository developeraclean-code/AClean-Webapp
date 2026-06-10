-- Quick Win 1 — Tutup advisor ERROR security_definer_view
-- View dgn SECURITY DEFINER (default Postgres) bisa bypass RLS pemanggil.
-- Set security_invoker=on biar query lewat permission pemanggil (aman + sesuai design app).

ALTER VIEW public.wa_delivery_summary SET (security_invoker = on);
