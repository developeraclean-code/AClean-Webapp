-- 205: Semua tingkat margin memakai satu dasar pekerjaan yang sama.
-- Guard database untuk dua admin/dua tab yang memilih tingkat berbeda bersamaan.
-- Tidak mengubah/menghapus nominal, penerima, atau status bonus historis.
BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.order_bonuses IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.order_bonuses
    WHERE order_id IS NOT NULL AND status <> 'VOID' AND bonus_type LIKE 'margin%'
    GROUP BY order_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ada job dengan beberapa bonus margin aktif. Tinjau manual sebelum migrasi; data tidak diubah otomatis.'
      USING ERRCODE = '23514';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_bonuses_margin_job_active
  ON public.order_bonuses(order_id)
  WHERE order_id IS NOT NULL AND status <> 'VOID' AND bonus_type LIKE 'margin%';

COMMENT ON INDEX public.uq_order_bonuses_margin_job_active IS
  'Satu bonus margin aktif per job, lintas semua tingkat margin. Bonus kategori lain tetap dapat berdampingan; VOID tidak mengunci penggantian.';

COMMIT;
