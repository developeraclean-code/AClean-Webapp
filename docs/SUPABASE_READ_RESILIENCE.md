# Pengendalian beban pembacaan browser

Paket 19 Oktober 2026: tidak memerlukan migrasi atau perubahan konfigurasi cloud.
Status deployment harus dibuktikan dengan commit SHA pada endpoint health produksi.
Ini mengurangi lonjakan dan dampak gangguan;
bukan bukti akar insiden sore 19 Oktober sudah ditemukan atau jaminan Supabase Free tidak akan terganggu.

## Cakupan

- `supabaseClient.js` memasang adapter untuk **GET/HEAD ke REST Supabase proyek yang sama**.
  Maksimal tiga permintaan berjalan per instance/tab, antrean maksimal 200,
  batas tunggu antrean 20 detik, dan batas respons jaringan 20 detik.
- Setelah tiga kegagalan server/jaringan berulang, pembacaan dijeda 15 detik.
  Percobaan pemulihan hanya satu request; gagal lagi menambah jeda menjadi 30/60/120 detik.
  Respons lama yang baru selesai tidak dapat menutup circuit yang sudah terbuka.
- Respons asli server mempertahankan status dan kode. Adapter lokal memakai
  `APP_READ_PAUSED`/429 untuk jeda, `APP_READ_NETWORK`/502 untuk jaringan,
  dan `APP_READ_TIMEOUT`/504 untuk timeout. Error bukan hasil kosong yang berhasil.
  SDK terpasang juga retry GET 503/520; retry tersebut tetap melewati gate yang sama.
- Auth, POST RPC, INSERT, UPDATE, DELETE, storage, dan origin lain tidak diantrekan
  atau diulang oleh adapter. Ini **bukan batas global koneksi database** dan bukan
  pengaman beban backend/serverless; banyak tab tetap memiliki gate masing-masing.

## Bootstrap, cache, polling, dan UI

- Satu pembacaan profil memasok daftar teknisi dan akun; batas yang dipakai tetap
  batas akun yang sudah ada (200). Tidak ada perluasan izin; RLS tetap sumber otorisasi.
- Cache TTL 60 detik menyatukan request identik yang masih berjalan, tidak menyimpan
  error, dan dilepas pada pergantian identitas. Invalidation entity mencakup cache
  bootstrap-nya. Respons lama tidak dapat mengisi kembali cache yang sudah dibatalkan.
- Bootstrap/rekonsiliasi tidak bertumpuk. Hasil dari sesi yang sudah ditutup diabaikan.
  Kegagalan bootstrap total menghentikan fan-out data sekunder; kegagalan sebagian
  ditampilkan sebagai peringatan, bukan dianggap angka nol yang sudah terverifikasi.
- Polling order/invoice/laporan/WA global memakai satu request per worker, interval
  normal 90 detik **setelah respons**, jitter 0–9 detik, dan backoff sampai 15 menit.
  Respons timeout dibatalkan; cursor hanya maju pada hasil sukses. Data terakhir
  dipertahankan ketika pembaruan gagal. Jadwal jam kerja/visibility yang lama tetap berlaku.
- Inbox bukti pembayaran tetap memiliki polling terpisah 24 jam/tab terlihat;
  penerimaan webhook, R2 dan retry backend tidak bergantung pada browser ini.
- Banner menunjukkan gangguan/circuit, memungkinkan retry setelah jeda, dan
  bootstrap dicoba lagi saat circuit pulih. Mode darurat tidak aktif otomatis.
- Login dikunci selama satu permintaan berlangsung. Hanya error kredensial tidak valid
  yang menaikkan counter password salah; error 5xx, jaringan, rate limit, dan profil
  gagal dimuat tidak menaikkan counter tersebut. Lockout password asli tetap berlaku.

Trade-off: pembacaan awal dijalankan lebih bertahap, sehingga sebagian data pendukung
bisa muncul lebih lambat ketika server sehat. Ini bukan pengurangan data bisnis,
penurunan harga/tagihan, atau perubahan hitungan invoice/payroll/bonus/stok.

## Verifikasi lokal

- Simulasi 200 pembacaan job: semua ID kembali, peak concurrency tiga.
- 200 konsumen cache identik: satu pemanggilan fetcher.
- 200 job dan invoice: jumlah, relasi job, total, dan sisa tagihan dipertahankan.
- Outage burst, probe tunggal, backoff, timeout, pembatalan, pergantian akun,
  cache invalidation, serta integrasi SDK nyata diuji di Vitest.
- 1.476 tes unit (130 file), lint, typecheck, dan build lulus. Build masih memiliki
  peringatan lama React yang diimpor statis sekaligus dinamis; bukan kegagalan build.
- Delapan skenario Playwright pada aplikasi penuh: outage/pemulihan Owner, lima Auth 503
  tidak menambah percobaan password, klik login ganda, banner mobile 390 px, serta
  login/pemulihan dan batas akses Admin, Finance, Teknisi, dan Helper.
  Semuanya lulus dengan provider palsu; tidak ada koneksi ke produksi. Tes juga
  memastikan tidak ada write invoice/pembayaran/stok/laporan akibat pemulihan.

```sh
npm test
npm run lint
npm run typecheck
npm run build
npx playwright test --config e2e/data-resilience.config.js
```

Tahap database terpisah: optimasi query invoice/laporan berdasarkan execution plan,
biaya/RLS/index, dan snapshot backup yang sempat timeout. Belum ada perubahan SQL
atau jadwal backup dalam patch browser ini. Ukur CPU/Disk I/O/latensi dan keberhasilan
backup setelah deployment yang disetujui; jangan menyamakan simulasi dengan kapasitas produksi.
