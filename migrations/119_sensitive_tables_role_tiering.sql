-- Migration 119: Tier role-based untuk tabel finansial sensitif
-- Sebelumnya SEMUA user login (termasuk Teknisi/Helper) punya akses penuh ke
-- invoices, payments, quotations, bonus, kasbon, dan price list via PostgREST —
-- pembatasan hanya di UI. Migrasi ini memindahkan enforcement ke DB.
--
-- Jalur teknisi yang WAJIB tetap jalan (hasil trace kode 2026-07-03):
--  * submitLaporan (sesi teknisi): SELECT invoice existing/induk multi-hari,
--    INSERT invoice baru, DELETE invoice lama saat rewrite laporan, UPDATE
--    quotation_id → pakai is_my_job(job_id) (migrasi 117, mencakup parent_job_id).
--  * KomisiView: SELECT order_bonuses miliknya (team_members berbasis nama).
--  * KasbonWidget: INSERT + SELECT kasbon_requests atas nama sendiri.
--  * Pricing laporan: SELECT price_list/ac_price_list tetap semua authenticated.
-- Quotations TIDAK dimuat di menu teknisi (on-demand hanya menu invoice/
-- maintenance) → link quotation saat submit teknisi memang sudah no-op → aman
-- direstriksi tanpa regresi.
-- Bergantung pada: migrasi 117 (get_my_role, get_my_name, is_my_job).

-- ── 1. invoices ──
DROP POLICY IF EXISTS invoices_select ON public.invoices;
DROP POLICY IF EXISTS invoices_insert ON public.invoices;
DROP POLICY IF EXISTS invoices_update ON public.invoices;
DROP POLICY IF EXISTS invoices_delete ON public.invoices;

CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
         OR public.is_my_job(job_id));

CREATE POLICY invoices_insert ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
              OR public.is_my_job(job_id));

CREATE POLICY invoices_update ON public.invoices
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
         OR public.is_my_job(job_id))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
              OR public.is_my_job(job_id));

-- DELETE: Owner/Admin (tombol hapus + rewrite saat verify) ATAU anggota job
-- (rewrite laporan oleh teknisi — hapus invoice lama sebelum insert ulang).
CREATE POLICY invoices_delete ON public.invoices
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin')
         OR public.is_my_job(job_id));

-- ── 2. invoice_items (penulis: AcUnitInvoiceModal + InvoiceView, keduanya O/A) ──
DROP POLICY IF EXISTS auth_full_inv_items ON public.invoice_items;

CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY invoice_items_insert ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

CREATE POLICY invoice_items_update ON public.invoice_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

CREATE POLICY invoice_items_delete ON public.invoice_items
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 3. invoice_payments ──
DROP POLICY IF EXISTS auth_full_invoice_payments ON public.invoice_payments;

CREATE POLICY invoice_payments_select ON public.invoice_payments
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY invoice_payments_insert ON public.invoice_payments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY invoice_payments_update ON public.invoice_payments
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY invoice_payments_delete ON public.invoice_payments
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 4. payment_logs ──
-- CATATAN: deleteInvoice (rewrite teknisi) menghapus payment_logs invoice lama
-- lebih dulu. Dengan DELETE O/A, rewrite teknisi atas invoice YANG SUDAH ADA
-- PEMBAYARAN akan gagal di FK (NO ACTION) — itu disengaja: laporan yang
-- invoicenya sudah dibayar memang tidak boleh di-rewrite diam-diam oleh teknisi.
DROP POLICY IF EXISTS auth_full_payment ON public.payment_logs;

CREATE POLICY payment_logs_select ON public.payment_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY payment_logs_insert ON public.payment_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY payment_logs_update ON public.payment_logs
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY payment_logs_delete ON public.payment_logs
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 5. quotations ──
DROP POLICY IF EXISTS auth_full_quotations ON public.quotations;

CREATE POLICY quotations_select ON public.quotations
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY quotations_insert ON public.quotations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

CREATE POLICY quotations_update ON public.quotations
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

CREATE POLICY quotations_delete ON public.quotations
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 6. price_list & ac_price_list: baca tetap semua login, tulis Owner only ──
-- (Sesuai SOP: edit price list = Owner. SELECT dibiarkan luas karena pricing
--  dipakai membangun invoice dari laporan di sesi teknisi.)
DROP POLICY IF EXISTS price_list_insert ON public.price_list;
DROP POLICY IF EXISTS price_list_update ON public.price_list;
DROP POLICY IF EXISTS price_list_delete ON public.price_list;

CREATE POLICY price_list_insert ON public.price_list
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) = 'Owner');

CREATE POLICY price_list_update ON public.price_list
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) = 'Owner')
  WITH CHECK ((SELECT public.get_my_role()) = 'Owner');

CREATE POLICY price_list_delete ON public.price_list
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) = 'Owner');

DROP POLICY IF EXISTS ac_price_list_insert_auth ON public.ac_price_list;
DROP POLICY IF EXISTS ac_price_list_update ON public.ac_price_list;
DROP POLICY IF EXISTS ac_price_list_delete ON public.ac_price_list;

CREATE POLICY ac_price_list_insert ON public.ac_price_list
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) = 'Owner');

CREATE POLICY ac_price_list_update ON public.ac_price_list
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) = 'Owner')
  WITH CHECK ((SELECT public.get_my_role()) = 'Owner');

CREATE POLICY ac_price_list_delete ON public.ac_price_list
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) = 'Owner');

-- ── 7. order_bonuses: teknisi lihat bonus timnya sendiri, tulis O/A(/F) ──
DROP POLICY IF EXISTS auth_full_order_bonuses ON public.order_bonuses;

CREATE POLICY order_bonuses_select ON public.order_bonuses
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
         OR team_members @> ARRAY[(SELECT public.get_my_name())]);

CREATE POLICY order_bonuses_insert ON public.order_bonuses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY order_bonuses_update ON public.order_bonuses
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY order_bonuses_delete ON public.order_bonuses
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 8. kasbon_requests: teknisi kelola request atas nama sendiri ──
DROP POLICY IF EXISTS auth_read_kasbon   ON public.kasbon_requests;
DROP POLICY IF EXISTS auth_insert_kasbon ON public.kasbon_requests;
DROP POLICY IF EXISTS auth_update_kasbon ON public.kasbon_requests;

CREATE POLICY kasbon_select ON public.kasbon_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
         OR teknisi_name = (SELECT public.get_my_name()));

CREATE POLICY kasbon_insert ON public.kasbon_requests
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance')
              OR teknisi_name = (SELECT public.get_my_name()));

-- UPDATE (approve/reject/re-open) hanya O/A/F.
CREATE POLICY kasbon_update ON public.kasbon_requests
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));
