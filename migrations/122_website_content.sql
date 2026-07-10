-- ====================================================================
-- 122: website_portfolio + website_blog_meta
-- Manajemen konten website statis (aclean.id) dari admin panel
-- ====================================================================

-- ── Portfolio per kategori layanan ──────────────────────────────────
create table if not exists website_portfolio (
  id          bigint generated always as identity primary key,
  category    text not null,     -- cuci-ac | bongkar-pasang | ducting | pasang-ac | isi-freon | jual-ac
  title       text,
  image_url   text not null,
  sort_order  int  default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- ── Metadata artikel blog ────────────────────────────────────────────
create table if not exists website_blog_meta (
  id              bigint generated always as identity primary key,
  slug            text not null unique,
  title           text not null,
  cover_image_url text,
  excerpt         text,
  category        text default 'tips',  -- tips | area | panduan | ducting | bongkar-pasang
  published_at    date,
  read_minutes    int  default 7,
  is_published    boolean default true,
  sort_order      int  default 0,
  created_at      timestamptz default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────
alter table website_portfolio  enable row level security;
alter table website_blog_meta  enable row level security;

-- Portfolio: publik bisa baca (is_active saja), Owner/Admin bisa write
create policy "wp_public_select"  on website_portfolio for select using (is_active = true);
create policy "wp_admin_all"      on website_portfolio for all
  using      (get_my_role() in ('Owner','Admin'))
  with check (get_my_role() in ('Owner','Admin'));

-- Blog: publik bisa baca yang published, Owner/Admin bisa write
create policy "wbm_public_select" on website_blog_meta for select using (is_published = true);
create policy "wbm_admin_all"     on website_blog_meta for all
  using      (get_my_role() in ('Owner','Admin'))
  with check (get_my_role() in ('Owner','Admin'));

-- ── Seed: artikel blog yang sudah ada ───────────────────────────────
insert into website_blog_meta
  (slug, title, cover_image_url, excerpt, category, published_at, read_minutes, sort_order)
values
-- Area
('biaya-service-ac-tangerang-2026',  'Biaya Service AC 2026: Panduan Lengkap Harga Service AC Tangerang',        'https://aclean.id/images/biaya-service-ac-tangerang-2026.jpg',            'Panduan lengkap biaya service AC di Tangerang Selatan 2026. Cleaning mulai Rp 85.000, isi freon, pasang baru.',               'panduan',       '2026-03-15', 9,  1),
('jasa-service-ac-bintaro',          'Jasa Service AC Bintaro Terpercaya — Cleaning AC Mulai Rp 95.000',         'https://aclean.id/images/hero-teknisi-aclean.jpg',                        'Layanan service AC profesional di Bintaro Jaya Sektor 1–9, Pondok Aren, dan Rempoa. Respons cepat, garansi 30 hari.',         'area',          '2026-07-07', 8,  2),
('jasa-service-ac-graha-raya',       'Jasa Service AC Graha Raya Terpercaya — Cleaning AC Mulai Rp 95.000',      'https://aclean.id/images/hero-cleaning-ac.jpg',                           'Layanan service AC di seluruh sektor Graha Raya Bintaro: Anggrek, Cendana, Pinus, Akasia, hingga Graha Raya Kencana.',        'area',          '2026-07-07', 8,  3),
('jasa-service-ac-karawaci',         'Jasa Service AC Karawaci Terpercaya — Cleaning AC Mulai Rp 95.000',        'https://aclean.id/images/aclean-service.jpg',                             'Layanan service AC di Lippo Karawaci: Klaster Imperial, Crystal, Diamond, Supermal Karawaci, dan sekitarnya.',                 'area',          '2026-07-07', 8,  4),
('jasa-service-ac-alam-sutera',      'Jasa Service AC Alam Sutera Terpercaya — Cleaning AC Mulai Rp 85.000',     'https://aclean.id/images/service-ac-alam-sutera.jpg',                     'Layanan service AC profesional di seluruh area Alam Sutera. Respons cepat 30–60 menit, teknisi berpengalaman.',               'area',          '2026-03-10', 8,  5),
('jasa-service-ac-bsd',              'Service AC BSD City — Cleaning AC Profesional Mulai Rp 85.000',            'https://aclean.id/images/service-ac-bsd-city.jpg',                        'Jasa service AC profesional di BSD City. Melayani Foresta, The Green, Nava Park, AEON Mall, dan seluruh kawasan BSD.',         'area',          '2026-03-08', 7,  6),
('jasa-service-ac-gading-serpong',   'Service AC Gading Serpong — Cleaning AC Profesional Mulai Rp 85.000',      'https://aclean.id/images/service-ac-gading-serpong.jpg',                  'Jasa service AC di Gading Serpong. Melayani Summarecon, Paramount, M-Town & seluruh kawasan Gading Serpong.',                 'area',          '2026-03-05', 7,  7),
-- Tips & Panduan
('cara-merawat-ac-agar-awet',        'Cara Merawat AC Agar Awet Bertahun-tahun — 7 Tips Penting',               'https://aclean.id/images/cara-merawat-ac-agar-awet.jpg',                  'Panduan lengkap cara merawat AC agar awet 10–15 tahun. Tips membersihkan filter, suhu ideal, dan jadwal perawatan rutin.',    'tips',          '2026-02-28', 9,  8),
('tips-hemat-listrik-ac',            'Tips Hemat Listrik AC di Musim Panas — 7 Cara Ampuh',                     'https://aclean.id/images/tips-hemat-listrik-ac.jpg',                      'Tips hemat listrik AC yang terbukti efektif. Hemat 30–50% tagihan listrik dengan 7 cara mudah dan praktis.',                  'tips',          '2026-02-20', 8,  9),
('kapan-harus-isi-freon-ac',         'Kapan Harus Isi Freon AC? Tanda-tanda dan Fakta yang Perlu Diketahui',    'https://aclean.id/images/kapan-isi-freon-ac.jpg',                         'Kenali 5 tanda freon AC habis, proses pengisian yang benar, dan harga isi freon. Fakta vs mitos tentang freon AC.',            'tips',          '2026-02-15', 9, 10),
('kenapa-ac-tidak-dingin',           'Mengapa AC Tidak Dingin? 7 Penyebab dan Solusi Cepat',                    'https://aclean.id/images/ac-tidak-dingin-penyebab-dan-solusi.jpg',        'AC menyala tapi tidak dingin? Kenali 7 penyebab utamanya mulai dari filter kotor, freon habis, hingga kompresor bermasalah.', 'tips',          '2025-04-17', 8, 11),
('ac-bocor-penyebab-solusi',         'Mengapa AC Sering Bocor? Penyebab dan Cara Memperbaiki',                  'https://aclean.id/images/ac-bocor-penyebab-dan-solusi.jpg',               'AC bocor bisa merusak dinding dan lantai. Pelajari 6 penyebab utama AC bocor lengkap dengan estimasi biaya perbaikan.',       'tips',          '2025-04-17', 7, 12),
('freon-r32-vs-r410',                'Perbandingan Freon R-32 vs R-410: Mana yang Terbaik?',                    'https://aclean.id/images/perbandingan-freon-r-32-vs-r-410.jpg',           'Panduan lengkap memilih freon AC yang tepat. Perbandingan efisiensi, keamanan, harga, dan dampak lingkungan.',                'tips',          '2025-04-17', 7, 13),
('daftar-harga-service-ac-2026',     'Daftar Harga Service AC Lengkap 2026 — Tangerang & BSD',                  null,                                                                      'Cek harga cleaning AC, service besar, isi freon, dan pasang AC terbaru 2026 di Tangerang Selatan, BSD, dan Alam Sutera.',      'panduan',       '2026-04-05', 5, 14),
('ac-tidak-dingin-penyebab-solusi',  'AC Tidak Dingin? Ini 8 Penyebab & Solusi Tepatnya',                       'https://aclean.id/images/ac-tidak-dingin-penyebab-dan-solusi.jpg',        'AC tidak dingin bisa disebabkan freon habis, filter kotor, atau kerusakan kompressor. Pelajari penyebab dan solusinya.',      'tips',          '2026-04-10', 7, 15),
('10-tips-merawat-ac-hemat-listrik', '10 Tips Merawat AC Agar Hemat Listrik & Lebih Awet',                      null,                                                                      'Tagihan listrik tinggi karena AC? Ikuti 10 tips merawat AC ini agar lebih hemat listrik dan performa tetap optimal.',         'tips',          '2026-04-17', 8, 16),
('ac-berbau-penyebab-cara-mengatasi','AC Berbau Tidak Sedap? Ini Penyebab & Cara Mengatasinya',                  null,                                                                      'Bau apek atau asam dari AC bisa jadi tanda kotoran, jamur, atau masalah serius. Kenali penyebabnya dan atasi sekarang.',      'tips',          '2026-04-12', 6, 17),
('7-tanda-ac-perlu-service',         '7 Tanda AC Anda Sudah Perlu di-Service Sekarang',                         null,                                                                      'Jangan tunggu sampai AC rusak total. Kenali 7 tanda AC perlu service agar terhindar dari biaya perbaikan yang lebih mahal.',  'tips',          '2026-04-15', 5, 18),
('freon-r32-vs-r410-vs-r22',         'Freon R32 vs R410A vs R22: Mana yang Terbaik untuk AC Anda?',             null,                                                                      'Perbandingan lengkap tiga jenis freon AC dari sisi performa pendinginan, harga, efisiensi energi, dan dampak lingkungan.',    'tips',          '2026-04-03', 7, 19),
('jenis-ac-split-window-cassette',   'Jenis-Jenis AC: Split, Window, Cassette & Standing — Mana Cocok?',        null,                                                                      'Bingung memilih jenis AC? Pelajari perbedaan AC split, window, cassette, dan standing floor beserta kelebihan & kekurangannya.', 'panduan',    '2026-04-01', 6, 20),
('cara-memilih-ac-yang-tepat',       'Cara Memilih AC yang Tepat untuk Rumah Anda — Panduan 2026',              null,                                                                      'Panduan memilih AC berdasarkan ukuran ruangan, kapasitas PK, merek terbaik, dan budget. Jangan salah beli sebelum baca ini!',  'panduan',      '2026-04-08', 8, 21),
('tanda-ac-perlu-diganti',           'Kapan AC Harus Diganti? Ini 6 Tanda yang Sering Diabaikan',               null,                                                                      'Terkadang memperbaiki AC terus-menerus lebih mahal dari membeli baru. Kenali 6 tanda AC sudah waktunya diganti unit baru.',    'tips',          '2026-03-28', 5, 22),
-- Bongkar Pasang (belum di blog index, ditambah di sini)
('biaya-bongkar-pasang-ac-2026',     'Biaya Bongkar Pasang AC 2026: Harga Borongan & Per Unit Terbaru',         null,                                                                      'Panduan biaya bongkar pasang AC 2026 di Tangerang Selatan. Harga per unit, borongan, dan tips menghemat biaya.',              'bongkar-pasang','2026-07-03', 8, 23),
('tips-bongkar-pasang-ac-pindahan',  'Tips Bongkar Pasang AC Saat Pindahan Rumah — Anti Ribet',                 null,                                                                      'Panduan lengkap bongkar pasang AC saat pindahan rumah. Cek kondisi, pilih kontraktor, dan hemat biaya.',                      'bongkar-pasang','2026-07-03', 7, 24),
('bongkar-ac-untuk-renovasi',        'Bongkar AC untuk Renovasi: Panduan Lengkap & Estimasi Biaya',             null,                                                                      'Panduan bongkar AC saat renovasi rumah. Kapan harus bongkar, cara simpan unit, dan biaya pasang ulang.',                      'bongkar-pasang','2026-07-03', 6, 25),
-- Ducting (belum di blog index)
('biaya-ducting-ac-2026',            'Biaya Ducting AC 2026: Estimasi Harga per Meter & per Proyek',            null,                                                                      'Panduan biaya ducting AC 2026. Estimasi harga per meter PU Board, per ruangan, hingga proyek komersial.',                     'ducting',       '2026-07-09', 8, 26),
('ducting-ac-pu-board-vs-galvanis',  'Ducting AC PU Board vs Galvanis: Mana yang Lebih Baik?',                  null,                                                                      'Perbandingan lengkap material ducting AC PU Board vs galvanis glasswool. Berat, insulasi, jamur, dan harga.',                  'ducting',       '2026-07-09', 7, 27)
on conflict (slug) do nothing;
