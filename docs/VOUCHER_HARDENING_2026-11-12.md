# Perbaikan voucer — kandidat lokal 12 November 2026

Rilis terverifikasi **13 November 2026**. PR #12 di-merge ke main sebagai
`461e74f`; staging dan produksi menjalankan pin **e91b6c6**. Kode aplikasi main
cocok dengan kandidat yang diuji. Migrasi 241 sudah diterapkan pada keduanya.
Enam tabel bisnis produksi memiliki fingerprint sama sebelum/sesudah migrasi.
Worktree utama user tetap tidak diubah; nomor 237–240 tetap milik pekerjaan
keamanan terpisah dan bukan dependensi migrasi ini.

Otomasi voucer tetap **OFF**. Auto-deploy serta preview deployment juga **OFF**
agar push berikutnya tidak melewati persetujuan dan pin rilis yang diuji.

## Kontrak produk yang diimplementasikan

| Bagian | Perilaku |
| --- | --- |
| Akses | Owner/Admin aktif di API dan DB; Finance/Teknisi/Helper/anon tidak dapat mengelola voucer. Portal hanya memakai token pelanggan yang valid. |
| Preview | Baca saja. Terapkan/Hapus/Batal pada form tidak menghabiskan voucer. Perubahan draft membatalkan preview lama. |
| Simpan | Satu RPC atomik: kunci invoice+voucer, hitung ulang, simpan invoice, redemption, pemakaian dan operasi idempoten. Tidak ada fallback klaim terpisah. |
| Potongan | Persentase hanya jasa LABOR. Biaya tetap/FEE, part, freon tidak eligible. Potongan baris dan trade-in mengurangi basis jasa terlebih dahulu. |
| Gratis unit | Unit Cleaning/cuci/pembersihan berharga termurah; jumlah unit bulat sesuai nilai voucer. |
| Gratis jasa | Seluruh jasa yang masih eligible, tanpa material/FEE. |
| Diskon manual | Ambil manfaat terbesar, tidak ditumpuk. Voucer baru ditolak bila tidak menambah manfaat, sehingga tidak habis sia-sia. |
| Pajak | Tetap gross-up PPh 23 yang sudah digunakan sistem, tarif 2% atau 2,5%; tidak mengubah aturan pajak global. |
| Sudah dibayar | Tolak invoice PAID/PARTIAL_PAID/CANCELLED, paid/withheld positif, atau ledger pembayaran positif, termasuk bila cache invoice belum sinkron. |
| Total nol | Invoice yang sudah APPROVED/SENT/UNPAID/OVERDUE dengan total nol ditutup PAID karena potongan penuh, paid_amount tetap nol; tidak dibuat pemasukan kas fiktif. DRAFT/PENDING_APPROVAL tetap mengikuti approval. |
| Edit berikutnya | Terms redemption dibekukan; invoice dengan voucer harus melalui RPC yang sama. Tidak mengganti/melepas voucer lewat update biasa. Pembayaran normal tetap dimungkinkan. |
| Hasil tidak pasti | Form dikunci; konfirmasi ulang mempertahankan request UUID dan snapshot payload yang sama. UI mengklaim berhasil setelah hasil invoice terkonfirmasi. |
| Pembatalan | Voucer terpakai tidak dapat dibatalkan. ID tak ada menjadi 404. Pembatalan ulang idempoten; actor/waktu/alasan tersimpan. |
| Daftar/portal | Statistik seluruh data, pagination 50, filter batal, error/retry terlihat; valid tanpa expiry didukung; batas tanggal memakai WIB. Portal mengecualikan voucer batal. |

Owner menyetujui kebijakan jasa/potongan terbaik dan rilis staging→produksi
pada 13 November 2026; loyalty disesuaikan menjadi hanya order PAID. Tidak membuat
menu kampanye/manual issuance baru di luar lingkup perbaikan audit.

## Otomasi

Loyalty dan win-back menjadi task mandiri dalam dispatcher VPS yang sama, tidak
lagi bergantung pada rating, customer portal, atau keberhasilan reminder servis.
Pemicu cron manual juga memeriksa Owner/Admin aktif; secret scheduler mesin tidak berubah.
Kedua sumber toggle (standalone dan cron_jobs) harus mengizinkan pekerjaan.
Tidak menambah cron eksternal atau penulis kedua.

- Sesuai keputusan Owner 13 November 2026, loyalty menghitung hanya order PAID per nomor kanonik;
  job_group_id/parent_job_id digabung agar split team tidak menambah milestone.
  Milestone 2/5/10/15, masa berlaku 90 hari. Aktivasi pertama hanya menyimpan
  baseline historis. Setelah itu, milestone yang baru dilewati diterbitkan
  sekali dengan issuance_key unik dan lock transaksi.
- Win-back: ≥180 hari sejak last_service, tidak ada order aktif/servis lebih
  baru, jeda minimum 30 hari dan satu voucer per periode last_service. Berlaku
  60 hari. Pemrosesan dibatasi per batch.
- Reminder expiry mencakup hari ini sampai H+3 dalam kalender WIB; expiry null
  tidak dikirimi reminder.
- Pengumuman dan reminder memakai ID outbox deterministik yang berbeda per
  tujuan. Hasil UNCERTAIN/SENDING/FAILED memerlukan review outbox; tidak ada
  resend otomatis dengan ID baru. Tracking gagal setelah provider menerima
  tidak menggandakan pengiriman pada percobaan ulang.
- Satu pengiriman per kelanjutan task, timeout provider 6 detik; batch
  berlanjut pada tick dispatcher berikutnya. Tidak mengubah semua toggle OFF
  yang saat ini terverifikasi di produksi.

## Bukti pengujian

- Suite umum: 1.791 unit test / 156 file; lint, typecheck, build lulus.
- PostgreSQL/WASM: 18 pemeriksaan, termasuk guard invoice aktual yang dibaca
  dari produksi tanpa data pelanggan.
- Native PostgreSQL: 9 pemeriksaan dengan koneksi bersamaan, replay, satu
  pemenang lintas invoice, versi stale, lock timeout, pajak, ledger, dedup
  milestone serta win-back.
- Browser: 9 alur komponen asli → handler API asli → migrasi/RPC asli pada DB
  fiktif. Batal preview, persen, unit gratis, diskon manual lebih baik,
  rollback, respons terpotong setelah commit+retry, preview berubah, kode berubah saat cek masih berjalan, admin
  pagination/error/retry/cancel lulus.
- Adapter HTTP self-hosted: 8 pemeriksaan lulus, termasuk routing, body, error aman, dan health tanpa DB.
- Tidak ada WA nyata, fixture pelanggan produksi, pembayaran historis, atau
  schema produksi yang dimutasi. Hasil lokal tidak menggantikan staging.

Reproduksi: `node scripts/test-voucher-db.mjs`,
`node scripts/test-voucher-browser.mjs`, `node scripts/test-voucher-concurrency.mjs`.
Native test memerlukan `embedded-postgres` yang sudah terpasang atau path modul
melalui `ACLEAN_EMBEDDED_PG_MODULE`; tidak mengunduhnya otomatis dan tidak
menerima URL database eksternal. Gunakan Node yang sesuai arsitektur mesin.
Bukti tersimpan dalam [deliverables](../deliverables/voucher-hardening-2026-11-12/README.md).

## Urutan rilis dan batas rollback

1. Setelah izin rilis eksplisit: commit/push kandidat; tinjau diff dan SHA,
   periksa backup terenkripsi terakhir serta schema/toggle/isi voucer aktual.
2. Terapkan migrasi 241 di lab/staging, deploy kandidat staging, uji akun dan
   alur fiktif, verifikasi tidak ada jalur lama klaim terpisah. Bersihkan fixture
   staging terpilih sesuai FK tanpa menghapus data lain.
3. Setelah staging lulus dan izin produksi mencakup migrasi ini: terapkan 241
   lalu deploy SHA yang sama ke produksi. `INVOICE_COLS` baru memerlukan schema
   terlebih dahulu. Pertahankan semua toggle otomasi OFF.
4. Konfigurasikan DSN Sentry pada scope build/runtime yang benar; rebuild dan
   verifikasi source container, health, bundle frontend dan event sintetis.
   Periksa konfigurasi uptime eksternal terpisah setelah akses/provider jelas.
5. Produksi hanya smoke baca saja tanpa klaim pelanggan/WA/pembayaran percobaan.
   Pengaktifan otomasi bukan bagian implisit dari deploy.

Migrasi bersifat forward-only. Jangan drop tabel audit/kolom atau mengembalikan
invoice yang sudah memakai voucer secara manual. Jika rilis gagal, tetap OFF,
perbaiki maju atau deploy build kompatibel dengan 241; build lama mempunyai
handler klaim terpisah dan tidak aman sebagai rollback fungsional voucer.

Pemeriksaan target 13 November menemukan tabel lab dimiliki supabase_admin,
sedangkan produksi dimiliki postgres. Migrasi memeriksa pemilik dan grant di
awal; objek baru selalu dimiliki postgres. Percobaan awal staging dengan role
postgres di-rollback tanpa perubahan schema/data. Uji native mencakup operator
supabase_admin, pemilik objek baru, dan eksekusi RPC sebagai service_role.

## Penerimaan staging dan produksi — 13 November 2026

- Staging: login Owner lab nyata, diskon 10% jasa Rp20.000, gratis unit Rp100.000,
  retry dengan request sama, pembatalan+pergantian filter, portal, mobile lulus.
  Nol error browser, nol request WA. Fixture dibersihkan; fingerprint enam
  tabel bisnis kembali sama dengan sebelum migrasi.
- Staging menemukan race filter setelah cancel serta release frontend kosong;
  e91b6c6 menutup race dan mengisi release frontend melalui ACLEAN_BUILD_SHA.
- Produksi: deployment `endqn3fwbsnprs0ascnyp66b` Finished/Healthy. Browser Owner
  baca-saja/menu voucer/mobile lulus; tiga endpoint health HTTP200 versi e91b6c6.
  Tidak membuat redemption, pembayaran, WA, atau fixture bisnis produksi.
- Produksi tetap 0 voucer, 0 redemption, 0 operasi voucer saat pemeriksaan;
  tiga toggle OFF. authenticated tidak memiliki hak tulis/RPC atomik langsung.
- Sentry frontend dan backend produksi sama-sama terverifikasi di akun
  aclean-service, release e91b6c6, environment production. Event sintetis INFO
  tidak memuat identitas user. Dua workflow email issue prioritas tinggi aktif;
  tidak sengaja memicu email error untuk menguji inbox.
- UptimeRobot monitor 803163682 diperbarui dengan izin Owner dari Vercel lama
  ke https://app.aclean.id/api/health. Status UP, interval tetap 300 detik,
  contact existing tetap sama. Riwayat monitor lama dipertahankan.
- Coolify token mengizinkan konfigurasi dan deploy tetapi menolak DELETE env
  preview dengan 403; tidak dilewati. Salinan DSN preview tidak dipakai karena
  preview deployment OFF. Tidak ada secret produksi baru yang disalin ke repo.

Bukti JSON produksi/staging dan receipt akun monitoring berada dalam
[folder verifikasi](../deliverables/voucher-hardening-2026-11-12/README.md).

## Catatan operasional terpisah

Task `payment-media-retry` menerima `WhaCenter media HTTP 429`. Riwayat pertama
yang dibaca 13 November 07:25 WIB, sebelum deployment rilis ini selesai
09:25 WIB; handler media tidak diubah oleh patch. Tick berikutnya 09:40 WIB
sukses, tetapi itu tidak membuktikan retry media sudah pulih. Tidak dilakukan
replay manual, perubahan pembayaran, atau perubahan penjadwal untuk menutupi
kegagalan provider. Bukti: `known-provider-issue.json`. Ini tetap catatan
operasional, terpisah dari penerimaan alur voucer/Sentry/UptimeRobot.
