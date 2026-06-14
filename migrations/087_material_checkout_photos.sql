-- 087_material_checkout_photos.sql
-- Material Harian: dukung sampai 5 foto per sesi (pagi/pulang).
-- photo_url (single) tetap dipertahankan utk kompatibilitas jalur WA & reader lama (= foto pertama).

alter table teknisi_material_checkout
  add column if not exists photo_urls jsonb not null default '[]';
