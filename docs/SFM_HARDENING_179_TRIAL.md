# SFM hardening 179 — local trial

Perubahan ini menangani lima area tanpa menghapus data bisnis atau data yatim:

1. Invoice pekerjaan multi-team baru dibuat satu kali setelah semua laporan tim berstatus `VERIFIED`.
2. `orders.invoice_id` direkonsiliasi hanya bila ada invoice aktif dengan pasangan job yang jelas.
3. Retensi log teknis dipusatkan, memakai batas maksimum 2.000 baris per tabel per eksekusi cron.
4. Keputusan kelengkapan multi-team dan finalisasi invoice berada di RPC atomik; UI membaca hasil RPC.
5. Mission Control menyediakan statistik query, preview rekonsiliasi, dan preview retensi tanpa write.

## Safety

- Migration tidak menghapus order, laporan, invoice, payment, expense, stok, atau record yatim.
- Browser hanya dapat menjalankan preview rekonsiliasi/retensi (`p_apply=false`).
- Retensi aktual hanya dapat dijalankan `service_role` dari cron.
- Saat migration 179 belum tersedia, verifikasi laporan multi-team diblokir dengan pesan jelas. Laporan tetap tersimpan.
- Laporan multi-team lama yang sudah `VERIFIED` tetapi belum memiliki invoice tidak diberi nilai tebakan. Jumlahnya ditampilkan di Monitoring → Data Health untuk review manual.

## Local gates

```bash
npm run lint
npm run typecheck
npm run check:migrations
npm test
npm run test:sfm-100
npm run build
npm run test:e2e
```

Simulasi `test:sfm-100` mencakup 100 lifecycle job dan tambahan 100 sub-order multi-team (50 grup). Gate gagal bila invoice dianggap siap sebelum seluruh laporan grup terverifikasi.

## Urutan deployment

1. Merge/deploy kode boleh dilakukan dengan deployment gate aktif; laporan multi-team tidak akan diverifikasi oleh RPC lama.
2. Terapkan migration 179 ke Supabase.
3. Buka Monitoring → Data Health dan pastikan tiga RPC berhasil dimuat.
4. Uji satu grup multi-team: tim pertama diverifikasi tanpa invoice, tim terakhir menghasilkan satu invoice agregat.
5. Review indikator `Laporan Multi-team Legacy` secara manual. Jangan menghapus atau mengubah laporan historis tanpa verifikasi nilai aktual.
