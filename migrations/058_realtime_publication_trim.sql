-- Migration 058: Trim realtime publication (kurangi beban WAL polling ~84%)
-- Konteks: compute NANO kewalahan — pg_stat_statements menunjukkan ~78% waktu DB
-- dihabiskan mesin Realtime (WAL polling + cek pg_publication_tables). Publication
-- berisi 20 tabel padahal frontend hanya butuh sedikit yang live.
--
-- Keputusan Owner (2026-06-02): sisakan realtime hanya untuk tabel yang benar-benar
-- dipantau live + tabel WA Grup (untuk fitur "WA Grup baca" yang sedang disiapkan).
--
-- REALTIME ON (5): orders, invoices, service_reports, wa_group_logs, wa_monitored_groups
-- DROP (15): tabel di bawah — tidak di-subscribe live oleh frontend.
--
-- Status: APPLIED live via MCP 2026-06-02 (file ini untuk dokumentasi/konsistensi repo).
-- Reversible: tinggal ALTER PUBLICATION ... ADD TABLE kalau perlu realtime lagi.

ALTER PUBLICATION supabase_realtime DROP TABLE
  public.agent_logs,
  public.wa_messages,
  public.wa_conversations,
  public.app_settings,
  public.customers,
  public.ac_units,
  public.inventory,
  public.invoice_items,
  public.job_materials_brought,
  public.payment_logs,
  public.payment_suggestions,
  public.price_list,
  public.technician_schedule,
  public.teknisi,
  public.user_profiles;

-- Rollback (kalau butuh realtime lagi untuk tabel tertentu):
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.<nama_tabel>;
