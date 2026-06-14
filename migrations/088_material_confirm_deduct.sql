-- 088_material_confirm_deduct.sql
-- Opsi A: Material Harian jadi sumber kebenaran potong stok pipa/kabel/freon.
-- Teknisi submit PULANG (+ tag job hari itu) → PENDING. Owner/Admin confirm di dashboard →
-- baru potong stok asli (per unit_id) + tulis inventory_transactions (trigger update inventory.stock).
-- Idempotent via deduct_tx_ids. Kolom confirm hidup di ROW session_type='pulang'.

alter table teknisi_material_checkout
  add column if not exists job_ids jsonb not null default '[]',          -- order id yang ditag saat pulang
  add column if not exists confirm_status text not null default 'PENDING'  -- PENDING | CONFIRMED | REJECTED
    check (confirm_status in ('PENDING','CONFIRMED','REJECTED')),
  add column if not exists confirmed_by text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirm_notes text,
  add column if not exists deduct_tx_ids jsonb not null default '[]',     -- id inventory_transactions yang dibuat (anti dobel)
  add column if not exists pulang_reminder_sent boolean not null default false;

create index if not exists idx_tmc_confirm on teknisi_material_checkout(session_type, confirm_status, checkout_date desc);

-- Toggle: Opsi A (confirm-deduct) + reminder WA 22:00. Default ON.
insert into app_settings (key, value) values
  ('material_confirm_deduct_enabled', 'true'),
  ('material_pulang_reminder_enabled', 'true')
on conflict (key) do nothing;
