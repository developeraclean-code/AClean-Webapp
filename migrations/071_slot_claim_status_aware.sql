-- 071 — try_claim_teknisi_slot: evaluasi konflik HANYA terhadap order berstatus aktif.
--
-- Celah pada 070: overlap/cap dihitung dari semua baris technician_schedule status='ACTIVE'.
-- Tapi updateOrderStatus (CANCELLED/COMPLETED) TIDAK menghapus baris technician_schedule,
-- jadi klaim basi bisa menolak rebooking slot yang ordernya sudah batal ("bentrok hantu").
--
-- Fix: JOIN ke orders, hanya hitung klaim yang order-nya masih dalam status aktif
-- (samakan dgn cekTeknisiAvailableDB di App.jsx). Ledger jadi self-correcting — klaim basi
-- diabaikan otomatis tanpa perlu cleanup di tiap transisi status. Advisory lock tetap
-- menjamin atomisitas. Idempotent: CREATE OR REPLACE.

create or replace function public.try_claim_teknisi_slot(
  p_teknisi  text,
  p_date     date,
  p_order_id text,
  p_start    text,
  p_end      text
) returns boolean
language plpgsql
as $$
declare
  v_cnt int;
  c_active constant text[] := array['PENDING','CONFIRMED','DISPATCHED','IN_PROGRESS','ON_SITE'];
begin
  if p_teknisi is null or btrim(p_teknisi) = '' or p_date is null then
    return true;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_teknisi || '|' || p_date::text));

  -- Cap 6 lokasi/teknisi/hari — hanya order aktif
  select count(*) into v_cnt
  from technician_schedule ts
  join orders o on o.id = ts.order_id
  where ts.teknisi = p_teknisi and ts.date = p_date and ts.status = 'ACTIVE'
    and o.id <> p_order_id
    and o.status = any(c_active);
  if v_cnt >= 6 then
    return false;
  end if;

  -- Overlap jam — hanya order aktif
  select count(*) into v_cnt
  from technician_schedule ts
  join orders o on o.id = ts.order_id
  where ts.teknisi = p_teknisi and ts.date = p_date and ts.status = 'ACTIVE'
    and o.id <> p_order_id
    and o.status = any(c_active)
    and (p_start::time < ts.time_end::time and p_end::time > ts.time_start::time);
  if v_cnt > 0 then
    return false;
  end if;

  insert into technician_schedule (order_id, teknisi, date, time_start, time_end, status)
  values (p_order_id, p_teknisi, p_date, p_start, p_end, 'ACTIVE');

  return true;
end;
$$;

grant execute on function public.try_claim_teknisi_slot(text, date, text, text, text) to anon, authenticated, service_role;
