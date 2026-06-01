-- Migration 053: Aktifkan Supabase Realtime publication untuk tabel core (Gap 6 — multi-device sync)
--
-- PENTING: Frontend SUDAH punya subscription realtime (App.jsx ch1/ch2/ch3) yang
-- merge state live untuk orders/invoices/service_reports + fallback polling.
-- Subscription itu hanya menerima event jika tabelnya ada di publication `supabase_realtime`.
-- Migration ini memastikan ketiga tabel ter-publish → subscription yang sudah ada jadi aktif.
--
-- Idempotent (cek pg_publication_tables dulu). Realtime menghormati RLS:
-- client hanya terima event row yang boleh ia SELECT. Overhead saat tanpa subscriber: minimal (WAL).

DO $$
BEGIN
  -- orders
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  -- invoices
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
  END IF;

  -- service_reports
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'service_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_reports;
  END IF;
END $$;
