# Kapasitas inbox WhatsApp — 12 November 2026

Pemeriksaan VPS dilakukan melalui SSH sekitar 09.30–09.32 WIB, seluruhnya
baca-saja. SQL memakai `BEGIN READ ONLY`, statement timeout 5 detik, dan
`ROLLBACK`; tidak mencetak nama, nomor, isi pesan, atau credential. Pengukuran
ini mendahului deployment patch inbox 200.

## Bukti runtime

| Ukuran | Hasil |
| --- | --- |
| CPU | 2 vCPU |
| Load average 1/5/15 menit | 2,70 / 3,37 / 3,62 |
| Sampel CPU 20 interval satu detik (`vmstat`, abaikan baris pertama historis) | Rata-rata user+system 45,9%; puncak 97%; idle 3–91% |
| CPU pressure | `some avg60=39.18`; menunjukkan antrean CPU, bukan persentase CPU terpakai |
| RAM | Total 7.685 MiB; available 3.863 MiB |
| Swap | Terpakai sekitar 1.356 MiB dari 1.987 MiB; `si/so=0` dalam seluruh interval sampel 20 detik |
| Disk root | 79 GB total; 21 GB terpakai; 55 GB tersedia (28% terpakai) |
| Memory pressure / IO pressure avg60 | 0,00 / 0,03 pada awal sampel |
| Percakapan DB | 346 baris |
| Profil lapangan aktif | 16; semuanya memiliki nama dan nomor terisi |

Load rata-rata melebihi jumlah vCPU dan CPU pressure cukup tinggi. Sampel
proses/container menunjukkan banyak layanan Supabase/Coolify berjalan, tetapi
tidak cukup untuk menetapkan penyebab antrean CPU. Tidak ada layanan yang
dihentikan atau konfigurasi yang diubah.

## Query 100 dibanding 200

`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` untuk bentuk query aplikasi
`SELECT * FROM public.wa_conversations ORDER BY updated_at DESC LIMIT N`,
dijalankan sebagai `authenticated` dengan konteks UID Owner aktif:

| Batas | Waktu eksekusi DB | Rencana | Ukuran JSON terukur |
| --- | --- | --- | --- |
| 100 | 0,094 ms | Index scan `idx_wa_conversations_updated`; 92 shared hits | 27.792 byte |
| 200 | 0,140 ms | Seq scan 346 baris + quicksort 83 kB; 19 shared hits | 53.612 byte |

Ukuran memakai agregasi SQL `json_agg` atas hasil dengan satu kolom penanda `n`;
ini perkiraan payload tanpa kompresi, bukan ukuran HTTP PostgREST persis.
Perbedaan sekitar 26 KB per refresh daftar. EXPLAIN adalah satu pengukuran per
batas dengan buffer hit, bukan benchmark statistik, cold-cache, atau latency
HTTP/browser. Planner memilih scan/sort untuk 200 pada tabel kecil; tidak ada
bukti perlunya indeks baru untuk patch ini. Indeks waktu sudah ada.

## Izin baca nama staf

Kolom `id` UUID, `name`/`phone`/`role` text, dan `active` boolean diverifikasi
pada `public.user_profiles`. Policy SELECT aktual mengizinkan Owner/Admin/
Finance membaca profil, sedangkan Teknisi/Helper hanya profil sendiri. Query
minimal `id,name,phone,role WHERE active AND role IN ('Teknisi','Helper')`
diuji sebagai role `authenticated` dengan konteks UID Owner aktif dan Admin
aktif: masing-masing 16 baris. Ini simulasi role/RLS, bukan login Auth/browser
nyata. Tidak mengubah GRANT, policy, view, trigger, atau migrasi 236.

## Penilaian

Peningkatan **daftar 100 menjadi 200 percakapan masih memadai** pada data dan
sampel saat ini: tambahan waktu DB sangat kecil, tambahan payload puluhan KB,
dan RAM/disk masih memiliki ruang. Riwayat awal tetap 100 pesan untuk satu
percakapan aktif; patch tidak memuat riwayat 200 kontak sekaligus. Lookup staf
berukuran kecil, dipaginasi 200, dan berjalan saat buka/manual refresh tanpa
polling baru. Tiga jalur daftar memakai default 200 yang sama.

Kondisi CPU host perlu dipantau tersendiri; peningkatan ini tidak berarti VPS
memiliki ruang besar untuk fitur berat atau banyak pengguna tambahan. Belum
ada uji beban admin serentak, masa sibuk berkepanjangan, HTTP produksi dengan
patch baru, atau pengamatan setelah deploy. Jangan menganggap angka ini
jaminan kapasitas keseluruhan VPS.

## Verifikasi lokal awal dan status tahap awal

- 1.736 tes unit dalam 152 file lulus.
- 42 tes browser fixture WhatsApp/Planning lulus, termasuk inbox 200, nama
  Teknisi/Helper, filter/search, nomor tujuan kirim, retry lookup, desktop/HP,
  dan tidak ada polling staf tambahan. Screenshot HP diperiksa secara visual.
- Lint, typecheck, build dan `git diff --check` lulus.
- Pemeriksaan migrasi lulus tanpa nomor ganda baru; gap/duplikasi warisan tetap
  dilaporkan. Tidak ada migrasi baru untuk patch ini.
- Node bawaan nvm gagal dijalankan pada Mac (`Bad CPU type`); verifikasi memakai
  `/usr/local/bin/node` v22.17.0. Chromium memerlukan eksekusi di luar sandbox
  untuk Mach port lokal; suite memakai data/gateway tiruan, tanpa pelanggan.
- Perubahan hanya lokal pada worktree `main` (HEAD `41dc566` saat audit) yang
  sudah berisi banyak perubahan sesi lain. Tidak ada commit, push, deploy,
  pengiriman pesan nyata, atau mutasi bisnis/konfigurasi produksi.

## Persiapan rilis lanjutan — 12 November 2026

- `main` GitHub dibaca ulang melalui konektor GitHub: `960e98c` (export PDF
  laporan project). Patch disiapkan di worktree terpisah
  `/private/tmp/aclean-wa-staff-inbox-200`, branch `codex/wa-staff-inbox-200`,
  berbasis SHA lengkap `960e98ccaf3424732a7f161e1bf483b2152ed37c`.
- Diff dibatasi pada nama staf, batas inbox, pengujian fixture, serta catatan
  terkait. Perubahan lain dari worktree utama tidak disalin; branch lokal
  `main` dan worktree lain tidak digerakkan.
- Verifikasi ulang kandidat di atas main terbaru: **1.750 tes unit dalam 152
  file**, **42 tes browser** lulus; lint, typecheck, build, pemeriksaan nomor
  migrasi, dan diff whitespace lulus. Jumlah tes berbeda dari tahap awal
  karena base rilis sudah lebih baru. Dependency lokal yang sudah tersedia
  dipakai kembali; tidak mengubah package/lockfile.
- `test:selfhost` tidak tersedia di `package.json` base rilis dan tiga skrip
  adapter yang ada pada workspace utama belum dilacak di base ini; percobaan
  menjalankannya berhenti karena berkas tidak ada. Patch tidak mengubah adapter
  server atau konfigurasi container.
- Pembacaan metadata Coolify dengan token tersimpan mendapatkan **HTTP 401**.
  Pengaturan Git Source, pin SHA dan auto-deploy belum terverifikasi ulang.
  Satu permintaan inspeksi sebelumnya habis waktu pada review izin otomatis;
  percobaan ulang diizinkan lalu mencapai respons 401 tersebut. Tidak ada
  deploy, perubahan token, atau perubahan konfigurasi sebagai jalan alternatif.
- Kandidat disiapkan sebagai commit/branch tersendiri untuk draft PR ke `main`.
  Merge dan deployment belum dilakukan; kesiapan kode tidak berarti produksi
  sudah memakai fitur baru. Sumber rilis Coolify tetap harus diverifikasi
  sebelum deployment sesuai playbook repo.
