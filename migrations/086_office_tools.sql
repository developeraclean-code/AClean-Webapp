-- 086_office_tools.sql
-- Registry "Alat Kantor" (bor, vacuum, tambang, dll) + log gerak Bawa/Kembali.
-- Terhubung ke job instal (orders) DAN job project (project_projects) lewat scope+ref_id.
-- NON-consumable: tidak memotong stok material. Hanya tracking lokasi + pemegang + riwayat.
-- Beda dari "alat tas" (tool_bag_checklist) dan dari "material" (inventory).

create table if not exists office_tools (
  id text primary key default (gen_random_uuid())::text,
  nama text not null,
  kategori text not null default 'Umum',
  qty integer not null default 1,         -- jumlah unit dimiliki
  kondisi text not null default 'baik',   -- baik | rusak | servis
  catatan text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists office_tool_movement (
  id text primary key default (gen_random_uuid())::text,
  tool_id text not null references office_tools(id) on delete cascade,
  scope text not null default 'order' check (scope in ('order','project')),
  ref_id text,                            -- orders.id ATAU project_projects.id
  ref_label text default '',              -- snapshot nama customer/project utk tampil
  qty integer not null default 1,
  carried_by text default '',             -- nama teknisi/helper pembawa
  status text not null default 'OUT' check (status in ('OUT','RETURNED')),
  kondisi_out text default 'baik',
  kondisi_in text,
  checkout_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by text default '',
  catatan text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_otm_tool on office_tool_movement(tool_id);
create index if not exists idx_otm_ref on office_tool_movement(scope, ref_id);
create index if not exists idx_otm_status on office_tool_movement(status);

alter table office_tools enable row level security;
alter table office_tool_movement enable row level security;

-- App login pakai Supabase Auth (signInWithPassword) → role authenticated.
drop policy if exists office_tools_auth_all on office_tools;
create policy office_tools_auth_all on office_tools for all to authenticated using (true) with check (true);
drop policy if exists otm_auth_all on office_tool_movement;
create policy otm_auth_all on office_tool_movement for all to authenticated using (true) with check (true);

-- Seed contoh alat umum (owner bisa edit/hapus/tambah dari menu Inventori → Alat Kantor).
insert into office_tools (nama, kategori, qty) values
  ('Bor Listrik', 'Power Tool', 2),
  ('Mesin Vacuum', 'Power Tool', 2),
  ('Tambang / Tali Kerja', 'Safety', 3),
  ('Tangga Lipat', 'Akses', 2),
  ('Pompa Vakum AC', 'AC Tool', 2),
  ('Mesin Las / Brander', 'AC Tool', 1)
on conflict do nothing;
