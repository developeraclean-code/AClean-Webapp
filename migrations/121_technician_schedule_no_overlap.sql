-- Migration 121: Exclusion constraint anti dobel-book di technician_schedule
-- Menutup sisa race TOCTOU booking (P3 audit Planning Order). Jalur create sudah
-- atomic via try_claim_teknisi_slot (advisory lock, migrasi 070), tapi jalur edit
-- order menulis technician_schedule langsung (cek-lalu-tulis, ada celah race) dan
-- tidak ada invariant DB yang melarang dua klaim ACTIVE tumpang-tindih untuk
-- teknisi yang sama. Constraint ini jadi backstop untuk SEMUA jalur tulis.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Bersihkan klaim basi: baris ACTIVE yang order-nya sudah tidak aktif
--    (selesai/PAID/batal/terhapus). Sama persis dengan lazy-delete di
--    try_claim_teknisi_slot — di sini dilakukan sekaligus untuk seluruh tabel.
--    (Audit 3 Jul: 3 pasang overlap existing, semuanya order PAID April.)
DELETE FROM public.technician_schedule ts
WHERE ts.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = ts.order_id
      AND o.status = ANY (ARRAY['PENDING','CONFIRMED','DISPATCHED','IN_PROGRESS','ON_SITE'])
  );

-- 2. Guard pra-constraint: kalau masih ada overlap ACTIVE (atau jam terbalik),
--    migrasi sengaja GAGAL di sini dengan daftar baris — investigasi manual dulu.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s vs %s (%s %s)', a.id, b.id, a.teknisi, a.date), '; ') INTO bad
  FROM public.technician_schedule a
  JOIN public.technician_schedule b
    ON a.id < b.id AND a.teknisi = b.teknisi AND a.date = b.date
   AND a.status = 'ACTIVE' AND b.status = 'ACTIVE'
   AND (a.time_start::time < b.time_end::time AND a.time_end::time > b.time_start::time);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Masih ada overlap ACTIVE: %', bad;
  END IF;

END $$;

-- 3. Wrapper IMMUTABLE untuk ekspresi index (cast text::time aslinya STABLE —
--    aman dideklarasikan IMMUTABLE karena format jam selalu 'HH:MM'/'HH:MM:SS').
--    Jam selesai lewat tengah malam (time_end < time_start, mis. 22:00→01:00)
--    dianggap selesai keesokan hari — tanpa ini build/insert error 22000.
CREATE OR REPLACE FUNCTION public.slot_tsrange(d date, t_start text, t_end text)
RETURNS tsrange
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT tsrange(
    d + t_start::time,
    d + t_end::time + CASE WHEN t_end::time < t_start::time
                           THEN interval '1 day' ELSE interval '0 hour' END
  );
$$;

-- 4. Constraint: dua baris ACTIVE utk teknisi sama tidak boleh tumpang-tindih waktu.
--    Pelanggar dapat error 23P01 — jalur insert best-effort (try/catch) tetap aman.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ts_no_overlap_active') THEN
    ALTER TABLE public.technician_schedule
      ADD CONSTRAINT ts_no_overlap_active
      EXCLUDE USING gist (
        teknisi WITH =,
        public.slot_tsrange(date, time_start, time_end) WITH &&
      ) WHERE (status = 'ACTIVE');
  END IF;
END $$;
