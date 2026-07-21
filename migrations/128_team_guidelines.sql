-- ====================================================================
-- 128: team_guidelines
-- Konten "Tata Tertib & Jobdesk" untuk menu in-app (Teknisi/Helper baca,
-- Owner/Admin edit teks). Struktur poin fix (seed di bawah); Owner/Admin
-- hanya UPDATE kolom content (edit teks saja).
-- ====================================================================

create table if not exists team_guidelines (
  id          bigint generated always as identity primary key,
  section     text not null,               -- tata_tertib | tugas_kewajiban | jobdesk
  role_scope  text not null default 'all', -- all | teknisi | helper
  content     text not null default '',    -- teks 1 poin (yang diedit Owner/Admin)
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz default now(),
  updated_by  text
);

create index if not exists idx_team_guidelines_section
  on team_guidelines (section, role_scope, sort_order);

-- ── RLS ─────────────────────────────────────────────────────────────
-- Baca: semua user login (Teknisi/Helper/Owner/Admin) — authenticated.
-- Tulis: Owner/Admin saja. Policy tulis WAJIB `to authenticated` (bukan
-- default public) agar tidak ikut dievaluasi & memblok SELECT — pelajaran
-- migrasi 123 (anon/authenticated tanpa hak get_my_role() → 401).
alter table team_guidelines enable row level security;

drop policy if exists "tg_select" on team_guidelines;
create policy "tg_select" on team_guidelines
  for select to authenticated using (true);

drop policy if exists "tg_admin_all" on team_guidelines;
create policy "tg_admin_all" on team_guidelines
  for all to authenticated
  using      (get_my_role() in ('Owner','Admin'))
  with check (get_my_role() in ('Owner','Admin'));

-- ── Seed poin awal (Owner/Admin rapikan bertahap) ───────────────────
-- Guard idempoten: hanya seed kalau tabel masih kosong.
insert into team_guidelines (section, role_scope, content, sort_order)
select v.section, v.role_scope, v.content, v.sort_order
from (values
  -- Tata Tertib AClean (berlaku semua)
  ('tata_tertib','all','Hadir tepat waktu sesuai jadwal kerja yang ditentukan.',1),
  ('tata_tertib','all','Konfirmasi kehadiran (absen) setiap hari melalui aplikasi. Izin/Sakit dilaporkan lebih awal.',2),
  ('tata_tertib','all','Menggunakan seragam & atribut AClean yang rapi dan bersih saat bertugas.',3),
  ('tata_tertib','all','Menjaga sopan santun, ramah, dan komunikasi yang baik dengan customer.',4),
  ('tata_tertib','all','Menjaga kebersihan, kelengkapan, dan keamanan alat kerja (tas teknisi).',5),
  ('tata_tertib','all','Dilarang merokok, makan, atau menerima tamu pribadi di area kerja customer.',6),
  ('tata_tertib','all','Menyelesaikan laporan pekerjaan lengkap dengan foto di hari yang sama.',7),
  ('tata_tertib','all','Menjaga nama baik perusahaan; segala keluhan/kendala dilaporkan ke atasan, bukan ke customer.',8),
  ('tata_tertib','all','Bertanggung jawab atas kerusakan/kehilangan alat & material akibat kelalaian.',9),
  ('tata_tertib','all','Dilarang menerima pekerjaan/uang langsung dari customer di luar prosedur perusahaan.',10),

  -- Tugas & Kewajiban — Teknisi
  ('tugas_kewajiban','teknisi','Melakukan survei dan diagnosa unit AC sesuai SOP sebelum mengerjakan.',1),
  ('tugas_kewajiban','teknisi','Mengerjakan pemasangan/perbaikan/cleaning sesuai standar kualitas AClean.',2),
  ('tugas_kewajiban','teknisi','Memastikan hasil pekerjaan diuji dan berfungsi normal sebelum meninggalkan lokasi.',3),
  ('tugas_kewajiban','teknisi','Mengisi laporan pekerjaan lengkap: kondisi, pekerjaan, material, dan foto dokumentasi.',4),
  ('tugas_kewajiban','teknisi','Mencatat material yang dipakai & yang ditagih ke customer dengan benar.',5),
  ('tugas_kewajiban','teknisi','Membimbing dan mengarahkan Helper selama pekerjaan berlangsung.',6),
  ('tugas_kewajiban','teknisi','Bertanggung jawab penuh atas alat dan material yang dibawa saat bertugas.',7),

  -- Tugas & Kewajiban — Helper
  ('tugas_kewajiban','helper','Membantu teknisi menyiapkan alat, material, dan area kerja sebelum mulai.',1),
  ('tugas_kewajiban','helper','Membantu proses pemasangan/cleaning/perbaikan sesuai arahan teknisi.',2),
  ('tugas_kewajiban','helper','Menjaga kebersihan dan kerapian area kerja selama dan setelah pekerjaan.',3),
  ('tugas_kewajiban','helper','Membantu membawa, merapikan, dan mengecek kelengkapan alat setelah selesai.',4),
  ('tugas_kewajiban','helper','Belajar dan mengikuti instruksi teknisi untuk meningkatkan keterampilan.',5),
  ('tugas_kewajiban','helper','Ikut menjaga sopan santun dan nama baik perusahaan di hadapan customer.',6),

  -- Jobdesk — Teknisi
  ('jobdesk','teknisi','Cek jadwal & konfirmasi kehadiran (absen) di aplikasi setiap pagi.',1),
  ('jobdesk','teknisi','Foto & cek kelengkapan tas teknisi (sesi Pagi) sebelum berangkat.',2),
  ('jobdesk','teknisi','Konfirmasi tiba di lokasi (ON_SITE) dan sapa customer dengan ramah.',3),
  ('jobdesk','teknisi','Diagnosa unit, kerjakan sesuai jenis servis, dan uji hasil sebelum selesai.',4),
  ('jobdesk','teknisi','Isi laporan pekerjaan + foto, catat material & yang ditagih ke customer.',5),
  ('jobdesk','teknisi','Lapor material harian (sesi Pulang) dan foto tas teknisi (sesi Pulang).',6),

  -- Jobdesk — Helper
  ('jobdesk','helper','Cek jadwal & konfirmasi kehadiran (absen) di aplikasi setiap pagi.',1),
  ('jobdesk','helper','Bantu siapkan & angkut alat/material sebelum berangkat ke lokasi.',2),
  ('jobdesk','helper','Bantu teknisi selama pekerjaan sesuai arahan (bongkar, cuci, pasang).',3),
  ('jobdesk','helper','Jaga kebersihan area kerja & rapikan kembali setelah pekerjaan selesai.',4),
  ('jobdesk','helper','Bantu cek ulang kelengkapan alat sebelum meninggalkan lokasi.',5)
) as v(section, role_scope, content, sort_order)
where not exists (select 1 from team_guidelines);
