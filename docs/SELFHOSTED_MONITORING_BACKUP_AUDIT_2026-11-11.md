# Monitoring dan backup Supabase self-hosted — 11 November 2026

Catatan ini membedakan perilaku kode lokal dari status runtime VPS. Perubahan
timer di repo belum diterapkan ke host; status timer dan snapshot terbaru tetap
perlu dibaca di VPS sebelum menyatakan backup berjalan saat ini.

## Monitoring

- RPC `get_infra_database_size()` membaca ukuran database aktif dengan
  `pg_database_size(current_database())`.
- Persentase yang ditampilkan memakai ambang aplikasi: 500 MiB untuk database
  dan 10 GiB untuk bucket R2. Angka ini bukan kapasitas disk host, kuota paket
  provider, maupun ruang kosong VPS.
- Pemindaian daftar objek R2 menggunakan checkpoint yang sekarang dapat
  dilanjutkan lintas pergantian tanggal WIB. Panel menyebut ambang dan
  menjelaskan bahwa disk, RAM, WAL, serta kesehatan host tidak diukur.

## Backup self-hosted

- `aclean-prod-r2-backup.timer` menjadwalkan backup setiap hari pada 02.15
  Asia/Jakarta, dengan jitter maksimum 15 menit dan catch-up setelah host
  kembali aktif (`Persistent=true`). Perubahan jadwal ini lokal sampai unit
  diperbarui dan timer di-reload pada VPS.
- `prod-r2-backup.sh` membuat dump PostgreSQL, global roles, konfigurasi
  Supabase terpilih, Storage lokal, Functions, gateway, dan beberapa file
  rahasia yang dipilih. Restic mengenkripsi payload sebelum menyimpannya pada
  repository privat `aclean-prod-migration-backup/restic` di Cloudflare R2.
- Dump sementara berada di `/var/tmp/aclean-prod-backup.*` saat job berjalan.
  Trap `EXIT` menghapus dump, globals, arsip konfigurasi database, checksum,
  dan direktori sementara pada akhir proses. Crash keras dapat meninggalkan
  direktori sementara untuk pemeriksaan.
- Skrip production menjalankan `restic backup` dan `restic check`; ia tidak
  menjalankan `restic forget` atau `restic prune`. Repository R2 tidak memiliki
  cleanup berkala yang didefinisikan di skrip/timer ini. Jangan memasang
  lifecycle delete generik pada bucket restic karena snapshot berbagi pack.
- Backup bucket media aplikasi `aclean-files` tidak termasuk backup Supabase
  ini. Pemulihan lintas-host belum tercatat lulus.

## Backup aplikasi mingguan

Task aplikasi `backup` dijadwalkan Senin pukul 11.00 WIB bila scheduler dan
toggle aktif. Ia membuat arsip terenkripsi untuk allowlist tabel bisnis dan
membaca ulang arsipnya. Ini backup tambahan, bukan pengganti dump full
PostgreSQL harian dan tidak mencakup seluruh objek media R2. Arsip aplikasi
diunggah dengan helper R2 aplikasi pada prefix `backup/` (bucket mengikuti
`R2_BUCKET_NAME`, default `aclean-files`). Task `backup-retention` berjalan
terpisah dan dapat menghapus arsip aplikasi lebih lama dari 60 hari sambil
melindungi folder backup lengkap terbaru. Ini tidak memangkas repository
Restic production.

## Batas verifikasi

Status runtime yang tercatat terakhir di repo untuk timer production dan
snapshot terverifikasi berasal dari 29 Oktober 2026. Catatan 4 November
meminta verifikasi backup setelah tanggal itu. Tidak ada bukti dalam audit
lokal ini bahwa timer production saat ini aktif, snapshot harian terbaru
berhasil, atau R2 repository telah diuji pulih di host berbeda.
