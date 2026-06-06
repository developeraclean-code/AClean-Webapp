-- 072 — try_claim_teknisi_slot: purge klaim basi di bawah lock sebelum cek & insert.
--
-- Celah pada 071: meski overlap/cap sudah JOIN-filter status order, baris technician_schedule
-- basi (order CANCELLED/COMPLETED, ts row tak terhapus) masih menyumbat INSERT klaim baru
-- karena UNIQUE constraint unique_tech_schedule(teknisi,date,time_start,time_end) → error 23505
-- saat rebook slot identik setelah cancel.
--
-- Fix: setelah ambil advisory lock (aman dari race), HAPUS dulu klaim utk teknisi+tanggal ini
-- yang order-nya sudah tidak aktif. Membersihkan ledger + membebaskan unique constraint.
-- Idempotent: CREATE OR REPLACE.

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

  -- Purge klaim basi: order sudah tidak aktif (CANCELLED/COMPLETED/PAID/dst) atau hilang.
  delete from technician_schedule ts
  using orders o
  where ts.order_id = o.id
    and ts.teknisi = p_teknisi and ts.date = p_date
    and not (o.status = any(c_active));

  -- Cap 6 lokasi/teknisi/hari (klaim sisa = order aktif)
  select count(*) into v_cnt
  from technician_schedule ts
  where ts.teknisi = p_teknisi and ts.date = p_date and ts.status = 'ACTIVE'
    and ts.order_id <> p_order_id;
  if v_cnt >= 6 then
    return false;
  end if;

  -- Overlap jam
  select count(*) into v_cnt
  from technician_schedule ts
  where ts.teknisi = p_teknisi and ts.date = p_date and ts.status = 'ACTIVE'
    and ts.order_id <> p_order_id
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
