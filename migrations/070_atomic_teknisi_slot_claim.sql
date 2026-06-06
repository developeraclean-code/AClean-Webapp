-- 070 — Atomic teknisi slot claim (anti double-book / TOCTOU)
--
-- Konteks: createOrder (App.jsx) memakai cekTeknisiAvailableDB = check-then-insert
-- yang TIDAK atomic. Smoke test (scripts/smoke-maintenance-order-clash.mjs) membuktikan
-- 6 submit konkuren ke slot sama semuanya lolos → double-book.
--
-- Solusi: RPC dengan pg_advisory_xact_lock per (teknisi|tanggal). Check overlap + cap +
-- INSERT klaim ke technician_schedule dilakukan dalam SATU transaksi terkunci, jadi caller
-- konkuren terserialisasi — hanya 1 yang menang untuk slot bentrok.
--
-- Catatan: tidak pakai EXCLUDE constraint karena data technician_schedule lama kotor
-- (format jam campur "09:00" vs "11:00:00") → constraint bisa gagal/menolak data sah.
-- ::time cast menangani kedua format. Idempotent: CREATE OR REPLACE.

create or replace function public.try_claim_teknisi_slot(
  p_teknisi  text,
  p_date     date,
  p_order_id text,
  p_start    text,   -- "HH:MM" atau "HH:MM:SS"
  p_end      text
) returns boolean
language plpgsql
as $$
declare
  v_cnt int;
begin
  if p_teknisi is null or btrim(p_teknisi) = '' or p_date is null then
    return true; -- tanpa teknisi → tidak perlu klaim (order PENDING)
  end if;

  -- Serialisasi semua klaim untuk teknisi+tanggal yang sama.
  -- Lock auto-release di akhir transaksi RPC ini.
  perform pg_advisory_xact_lock(hashtext(p_teknisi || '|' || p_date::text));

  -- Cap 6 lokasi/teknisi/hari (selaras MAX_LOKASI_PER_HARI)
  select count(*) into v_cnt
  from technician_schedule
  where teknisi = p_teknisi and date = p_date and status = 'ACTIVE';
  if v_cnt >= 6 then
    return false;
  end if;

  -- Overlap jam: [start,end) saling tumpang dengan klaim aktif lain
  select count(*) into v_cnt
  from technician_schedule
  where teknisi = p_teknisi and date = p_date and status = 'ACTIVE'
    and (p_start::time < time_end::time and p_end::time > time_start::time);
  if v_cnt > 0 then
    return false;
  end if;

  insert into technician_schedule (order_id, teknisi, date, time_start, time_end, status)
  values (p_order_id, p_teknisi, p_date, p_start, p_end, 'ACTIVE');

  return true;
end;
$$;

-- Beri akses ke service role (backend) + authenticated (frontend anon JWT)
grant execute on function public.try_claim_teknisi_slot(text, date, text, text, text) to anon, authenticated, service_role;
