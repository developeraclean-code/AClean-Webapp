-- Migration 109: Kosongkan publication supabase_realtime (matikan Postgres Changes / WAL)
--
-- KONTEKS / KENAPA:
--   Diagnosa pg_stat_statements menunjukkan ~68% compute Supabase dihabiskan oleh Realtime
--   Postgres Changes (decode WAL: query `wal->>...` + introspeksi publication). Frontend hanya
--   benar-benar butuh live update untuk segelintir tabel, dan SEMUA konsumen sudah dipindah ke
--   POLLING ringan (App.jsx: orders/invoices/service_reports tiap 90 dtk, jam kerja + tab aktif;
--   LaporanTimView ikut state terpusat). Bukti bayar (payment_suggestions) memang sudah polling
--   sejak awal — TIDAK terpengaruh. 4 dari 7 tabel yang dipublish bahkan tak punya subscriber.
--
--   Dengan publication kosong, `realtime.list_changes`/`apply_rls` tidak lagi memproses perubahan
--   → beban `wal->>` anjlok. Broadcast/Presence (jika dipakai nanti) TIDAK butuh publication ini.
--
-- URUTAN AMAN:
--   1) Deploy dulu build frontend perf/realtime-to-polling (UI sudah tidak pakai postgres_changes).
--   2) Baru jalankan migrasi ini di Supabase SQL Editor.
--   3) Ukur ulang: pilih query `wal->>` di pg_stat_statements harusnya turun drastis.
--
-- DAMPAK: Tidak ada perubahan skema/RLS/data. Hanya melepas tabel dari publication realtime.

-- Lepas SEMUA tabel dari publication supabase_realtime (idempotent — aman diulang).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', t.schemaname, t.tablename);
    RAISE NOTICE 'Dropped % .% from supabase_realtime', t.schemaname, t.tablename;
  END LOOP;
END $$;

-- Verifikasi: harus mengembalikan 0 baris.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (jika perlu mengembalikan Postgres Changes ke kondisi semula):
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.service_reports;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.material_job_movement;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.teknisi_material_checkout;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_group_logs;
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_monitored_groups;
-- (Catatan: frontend perf/realtime-to-polling tidak lagi subscribe postgres_changes, jadi
--  rollback hanya relevan bila UI juga dikembalikan ke versi realtime sebelumnya.)
