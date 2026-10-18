# Scheduler, audit data dan pemulihan — rilis 18 Oktober 2026

Status: migrasi **216–217 diterapkan 18 Oktober 2026**, sesudah uji transaksi rollback
dan validasi lima role di produksi. Kunci backup dipasang sebagai secret production
Vercel dan disimpan pada `.env.local` terabaikan Git (0600), tanpa dicetak.
Aktivasi pemicu 10 menit dilakukan terpisah hanya sesudah deployment READY terverifikasi.
Rilis ini tidak mengaktifkan cron customer yang sedang OFF dan tidak mengubah invoice,
pembayaran, stok atau status laporan historis. Auto-verifikasi tetap dihentikan oleh 215.

## 1. Scheduler

- Semua pemicu `tick` dan `cleanup-tick` berbagi lease atomik tiga menit di database.
  GitHub, Vercel dan pemicu Supabase tidak menjalankan dispatcher bersamaan.
- Task maksimal tiga per invocation, dengan budget eksekusi dan ruang untuk logging.
  Task berat tidak dimulai ketika sisa budget terlalu kecil.
- Task baru mendapat kesempatan sebelum retry gagal; kegagalan mendapat jeda lima menit.
  Timeout tetap menghentikan invocation karena task lama belum tentu bisa dibatalkan.
  Lease ditahan hingga kedaluwarsa setelah timeout, bukan dilepas terlalu cepat.
- Backup dan audit mingguan mempunyai catch-up sampai jadwal minggu berikutnya. Tidak
  berhenti menunggu Senin berikutnya hanya karena pemicu Senin terlewat.
- Retry bukti bayar tetap 24 jam melalui scheduler 210 yang sudah aktif. Di `tick`
  ia menjadi fallback jika belum ada keberhasilan 15 menit terakhir, bukan mendahului
  seluruh antrean. Scan bukti invoice PAID tetap hanya 09.00–18.00 WIB.
- Pemicu tambahan yang disiapkan: Supabase tiap sepuluh menit. GitHub/Vercel tetap
  fallback. **DDL tidak menjadwalkan atau mengaktifkannya otomatis.**
- Tidak ada task yang dijalankan tanpa audit `cron_runs` berhasil dibuat.

### Alarm kuota

R2 dipindai maksimal dua halaman per invocation, bukan seluruh bucket dalam budget
6,5 detik. Checkpoint menyimpan token dan hitungan, lalu dilanjutkan invocation berikut.
Timer HTTP meliputi pembacaan body, bukan hanya penerimaan header. Angka parsial bukan
angka total: Monitoring menampilkan pemindaian berjalan dan status belum lengkap.
Listing bukan snapshot billing atomik; upload/delete selama scan dapat mengubah estimasi.

Kedua gerbang toggle tetap wajib. Malformed/missing `cron_jobs` gagal tertutup untuk
alert baru. Pengiriman dicek ulang, hanya ke nomor Owner yang masih aktif, memakai
outbox idempoten. Status ACCEPTED berarti diterima provider, bukan dibaca; status tidak
pasti/gagal tidak dikirim ulang membabi-buta. Tidak ada panggilan AI.

## 2. Audit integritas

RPC service-only memeriksa tautan maintenance, invoice/payment yatim, stok negatif,
unit stok yatim dan DP yang diaplikasikan melebihi uang diterima. Referensi UUID/JSON
maintenance yang rusak menjadi temuan, bukan membuat seluruh audit crash.

Hasil disimpan sebagai `data_integrity_snapshot` dan terlihat di
**Monitoring → Overview → Audit & Pemulihan Data**, hanya Owner.
Temuan critical/warn memicu alert Owner; **tidak pernah mengoreksi transaksi otomatis**.
Interval PM belum ditentukan adalah info, sesuai pilihan onboarding seperti Dupoin;
tetap tercantum di snapshot, bukan otomatis dibuatkan jadwal.

## 3. Backup

- Snapshot konsisten satu statement database, bukan 51 SELECT terpisah pada waktu berbeda.
- Migrasi 217 menghindari penggabungan/konversi JSONB besar berulang: agregasi memakai
  JSON tekstual, respons RPC tetap object dengan schema yang sama. Uji rollback data
  produksi sekitar 29 MB selesai 10,7 detik (2,38 detik pada uji ulang); JSONB penuh
  sebelumnya mencapai timeout. Riwayat 216 tidak ditulis ulang; optimasi ada di 217.
  Batas fetch snapshot 20 detik, worker 35 detik, dan dispatcher menyisakan waktu
  pencatatan di bawah batas function Vercel 60 detik. Timeout/checkpoint tetap nyata.
- **51 tabel** termasuk order, laporan, invoice/item/pembayaran, DP quotation, stok dan
  transaksi material, biaya/payroll/bonus, maintenance dan project.
- Bundle memuat tipe kolom, primary key, unique key biasa dan foreign key untuk drill.
  Unique key diperlukan karena FK dapat merujuk `inventory.code`, bukan primary key.
- JSON dikompresi gzip lalu dienkripsi AES-256-GCM sebelum masuk R2. Kunci tidak masuk
  browser, manifest atau source control. Tidak ada fallback unggah plaintext.
- Unggahan dibaca ulang dan SHA-256 dibandingkan sebelum manifest dan `backup_log`
  ditandai lengkap. File yang rusak, tabel hilang, kunci salah atau pencatatan gagal
  menghasilkan kegagalan nyata, bukan `SUCCESS`.
- Checkpoint `backup_pending_archive` menjaga ID arsip yang sama pada retry. Gangguan
  baca ulang atau pencatatan tidak membuat file bundle baru terus-menerus menghabiskan
  kuota. Checkpoint hari lama diselesaikan dahulu, lalu antrean meminta snapshot baru.
- Retensi 60 hari memahami format lama dan format terenkripsi. Folder backup lengkap
  terakhir dilindungi; bila tidak dapat diidentifikasi, cleanup gagal tertutup.
- Perlindungan tersebut milik cleanup aplikasi, bukan lifecycle bucket. Rule
  `aclean-backup-60d` pada konfigurasi repo dinonaktifkan agar lifecycle tidak menghapus
  salinan terakhir. Perubahan Git tidak mengubah bucket: nonaktifkan rule itu di
  Cloudflare juga; retensi 60 hari tetap dikerjakan aplikasi. Akses S3 saat preflight
  18 Oktober mengembalikan 403 untuk lifecycle; izin bucket admin diperlukan.
- Skrip manual memakai worker yang sama dan memerlukan `--execute`. Default dry-run.

### Batas pemulihan

Bundle ini **bukan pengganti backup penuh PostgreSQL/PITR**. Ia tidak menyimpan akun
`auth.users`, konfigurasi/secret aplikasi, file foto/video/PDF R2, seluruh view/function,
trigger, grant dan policy RLS. Migrasi dan konfigurasi harus dipulihkan secara terpisah.
Foreign key ke tabel di luar bundle dilaporkan sebagai dependency eksternal, bukan
diam-diam dianggap sudah dipulihkan.

Drill menggunakan database PostgreSQL/WASM kosong dalam RAM: membangun tipe kolom,
PK/unique/FK internal, mengisi ulang baris, memeriksa constraint dan jumlah baris.
Ini tidak menjalankan trigger bisnis produksi. Skrip **tidak lagi membuat/menghapus
`public.restore_test_*` di Supabase**. Arsip lama `.json` dan `.json.gz` masih dapat
divalidasi read-only, tetapi tidak diklaim sebagai restore lengkap karena tanpa schema.
Arsip plaintext lama tidak dienkripsi ulang/dihapus oleh perubahan lokal ini.

## Urutan aktivasi produksi (disetujui Owner 18 Oktober 2026)

1. Buat satu kunci acak 32 byte, base64 (`openssl rand -base64 32`) di terminal privat.
   Simpan sebagai **server-only** `BACKUP_ENCRYPTION_KEY` di lingkungan lokal/Vercel.
   `BACKUP_KEY_ID=v1`. Simpan salinan kunci di tempat aman terpisah dari Supabase/R2.
   Jangan kirim kunci melalui chat atau commit ke Git. Simpan kunci lama saat rotasi.
2. Terapkan migrasi 216 lalu 217 setelah pengujian; verifikasi grant service-only dan Owner-only.
   Ia tidak mengubah jadwal aktif atau feature toggle produksi.
3. Commit/push dan tunggu Vercel READY; cocokkan `/api/health.version` dengan commit.
   Kode baru membutuhkan RPC 216, jadi migrasi harus tersedia sebelum kode dirilis.
4. Simpan kredensial worker produksi di Vault dengan nama
   `aclean_cron_dispatcher_secret`, cocok dengan `INTERNAL_API_SECRET` Vercel aktif.
   Jangan menaruh secret literal dalam source atau `cron.job.command`.
5. Setelah persetujuan aktivasi, jadwalkan:

   ```sql
   SELECT cron.schedule('aclean-cron-dispatcher-10m','*/10 * * * *',
     'SELECT public.dispatch_cron_tick_216();');
   ```

   Tidak perlu mematikan retry media 210 atau reminder staf 215. Jangan mengaktifkan
   kembali auto-return/auto-verifikasi yang sudah dihentikan.
6. Periksa hasil `cron_runs`, snapshot audit, backup_log dan manifest arsip pertama.
   Memicu `tick` secara manual dapat mengirim WA operasional jika toggle sedang ON;
   jangan menggunakan trigger produksi sebagai tes tanpa persetujuan.
7. Lakukan drill arsip produksi secara read-only + PostgreSQL lokal terisolasi. Jangan
   menguji restore dengan menimpa database produksi.
8. Nonaktifkan hanya rule `aclean-backup-60d` di lifecycle bucket Cloudflare dengan
   izin admin bucket; akses lifecycle memakai kredensial S3 operasional saat rilis
   ditolak 403. Sampai diverifikasi, perlindungan salinan terakhir hanya berlaku di
   cleanup aplikasi, bukan penghapusan lifecycle bucket. Rule media lain tetap sama.

Jika perlu menghentikan pemicu baru, gunakan `cron.alter_job(jobid,active:=false)`.
Jangan drop tabel lease atau menghapus pengaman verifikasi 215. Jangan rollback ke
unggahan backup plaintext hanya untuk menyembunyikan kegagalan konfigurasi kunci.

## Pengujian ulang

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run check:migrations
WA_PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-cron-recovery-db.mjs
node node_modules/@playwright/test/cli.js test --config=e2e/cron-recovery.config.js
node scripts/backup-r2-run.mjs # dry-run, tanpa upload
node --env-file=.env.local scripts/restore-verify-run.mjs \
  --manifest-key=backup/YYYY-MM-DD/manifest-UUID.json --drill
# Format lama (validasi saja): --legacy-date=YYYY-MM-DD
```

Pengujian sintetis mencakup 200 job, 200 klaim overlap, 200 tick, paginasi >1.000
baris, batas WIB, catch-up mingguan, gagalnya RPC/R2/audit, retry checkpoint, arsip
rusak/kunci salah, perlindungan backup terakhir, dan akses Owner versus role lain.
Tidak ada pengiriman WA, upload R2 atau mutasi transaksi produksi selama pengujian.

Hasil terakhir: **1.429 tes unit / 124 file**, lint, typecheck, production build,
8 kontrak SQL baru, 13 rangkaian SQL regresi lama, paritas verifikasi manual/B2B,
dan 2 smoke test browser desktop/mobile lulus. Drill tambahan memakai metadata tipe,
PK/unique/FK produksi (tanpa membaca baris bisnis): 51 tabel, 200 job sintetis,
800 relasi internal berhasil; satu dependency di luar bundle dilaporkan eksplisit.

### Pemeriksaan akses dan toggle

| Fitur | Akses yang dipertahankan | Hasil |
|---|---|---|
| Worker lease, audit dan export backup | Service-role saja; browser termasuk Owner ditolak | PASS SQL |
| Monitoring / status audit & backup | Owner saja; Admin/Finance/Teknisi/Helper ditolak | PASS SQL + browser |
| Alarm kuota | `infra_usage_alert_enabled=true` DAN entri `cron_jobs.active=true`, cek ulang sebelum WA | PASS |
| Alert audit data | `data_integrity_audit_enabled=true` DAN entri `cron_jobs.active=true`, hanya Owner aktif | PASS |
| Backup (tanpa WA) | Default tetap jalan kecuali eksplisit OFF, sesuai kebijakan backup lama; enkripsi wajib | PASS |
