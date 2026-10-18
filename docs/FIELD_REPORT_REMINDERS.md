# Pengingat laporan tim dan verifikasi manual

Perubahan 18 Oktober 2026 WIB; migrasi 215.

## Otomasi yang dihentikan

- `auto-return-brought` dihapus dari dispatcher/handler. URL lama membalas 410,
  tidak dialihkan ke reminder invoice. Material tetap dikelola Admin melalui modul.
- Cron Supabase `aclean-auto-verify-laporan-48jam` dinonaktifkan. Timer 48 jam di
  `App.jsx` juga dihapus. Mematikan salah satunya saja tidak cukup.
- Database menolak transisi VERIFIED dari service-role/aktor auto-verify. Owner/Admin
  tetap dapat memverifikasi manual di Laporan Tim, termasuk finalisasi invoice atomik,
  B2B dan multi-team. Laporan/invoice/pembayaran historis tidak diubah.
- Marker auto-return lama ditolak; pengembalian manual Admin tetap boleh. Rilis ini
  tidak mengubah jumlah stok atau sesi material yang sudah dicatat.

## Reminder baru

- Owner mengontrol **Pengaturan → Otomasi → Pengingat Laporan Tim**. RPC menyimpan
  kedua gerbang atomik: `field_report_reminder_enabled` DAN `cron_jobs.active`.
- Setelah 20.00 sampai sebelum 00.00 WIB, order hari ini yang confirmed/aktif tanpa
  laporan SUBMITTED/VERIFIED diingatkan. REVISION/REJECTED/draf ikut diingatkan.
- Pencocokan memakai **job_id**, bukan tanggal laporan atau siapa yang mengirim.
  Satu laporan mewakili seluruh anggota yang ditugaskan pada job tersebut.
- Pending, batal, rescheduled, sudah ber-invoice/paid dan pekerjaan project tidak
  ikut. Project memiliki laporan harian tersendiri. Pekerjaan malam yang belum
  selesai, termasuk lintas tanggal, tidak diingatkan saat masih berjalan.
- Tujuan WA berasal dari profil teknisi/helper aktif, **bukan nomor customer**.
  Nama ambigu tidak dipilih sembarang. Mantan karyawan tidak menerima pengingat.
- Beberapa pekerjaan dirangkum menjadi satu WA per nomor per tanggal WIB. Nomor
  bersama hanya mendapat satu pesan. Isi panjang diringkas agar muat di gateway.
- ID outbox deterministik tanggal+nomor dan claim atomik mencegah pengiriman ganda
  saat retry/overlap. Sebelum mengirim, order, laporan, profil dan toggle dicek ulang.
  Laporan yang masuk setelah cek terakhir masih dapat berpapasan dengan WA yang
  sudah dikirim ke gateway; ini bukan klaim transaksi atomik dengan gateway eksternal.
- Maksimal dua penerima per invocation. ACCEPTED berarti diterima provider, bukan
  dibaca. FAILED/UNCERTAIN/SENDING dan audit gagal tidak dikirim ulang otomatis;
  periksa Monitoring/outbox sebelum mengirim manual. Tidak ada panggilan AI berbayar.

Contoh:

> 📝 PENGINGAT LAPORAN PEKERJAAN
> 2026-10-18 · setelah 20.00 WIB
>
> Halo Teknisi Satu, laporan untuk pekerjaan berikut belum diterima atau masih perlu diperbaiki:
> 1. Customer Simulasi · JOB-SIMULASI
>
> Mohon kirim/perbaiki melalui menu Laporan Saya. Cukup satu anggota tim mengirim satu laporan per job.
>
> - Auto Reply by ARA -

## Scheduler dan urutan rilis

`tick` adalah dispatcher yang memeriksa tugas jatuh tempo dan menjalankannya secara
bounded. Reminder mendapat prioritas setelah 20.00, tetapi tidak bergantung padanya:
Supabase `aclean-field-report-reminder-5m` memakai `*/5 13-16 * * *` UTC, yaitu tiap
5 menit pukul 20.00–23.55 WIB. Tim tidak harus menerima WA persis pada 20.00;
penerima diproses bertahap sesuai batas invocation dan respons provider.

1. Uji unit, SQL, akses peran dan browser desktop/mobile.
2. Terapkan 215. Feature baru default OFF; scheduler belum dibuat otomatis.
3. Deploy kode dan pastikan Vercel READY dengan commit yang benar.
4. Siapkan secret worker di Vault, jadwalkan `dispatch_field_report_reminders_215()`,
   kemudian aktifkan kedua gerbang atas izin Owner.
5. Periksa `cron_runs.task_name='field-report-reminder'` dan `wa_outbox` dengan
   `document_id='field-report-reminder:YYYY-MM-DD'`. Jangan memakai trigger manual
   sebagai smoke test setelah 20.00 karena dapat mengirim WA sungguhan.

Secret tidak disimpan di source, `cron.job.command` atau browser. RPC scheduler
service-only; RLS outbox Owner/Admin tidak diperluas. Status di Monitoring tetap
menunjukkan gagal/belum pasti meski proses berikutnya mendeteksi pengiriman lama.

## Pengujian

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run check:migrations
WA_PGLITE_MODULE=/path/to/pglite node scripts/test-field-report-reminder-db.mjs
WA_PGLITE_MODULE=/path/to/pglite node scripts/test-maintenance-billing-crosspath-db.mjs --manual-215
node node_modules/@playwright/test/cli.js test --config=e2e/field-report-reminder.config.js
```

Simulasi mencakup 200 job dan 200 overlap invocation tanpa WA atau koneksi produksi.
Validasi rilis: 1.383 tes unit, 10 kontrak SQL reminder, 17 kontrak lintas jalur
invoice dengan verifikasi manual, dan 2 smoke test browser desktop/mobile lulus.
Migrasi 215 juga lolos rehearsal rollback pada skema produksi sebelum diterapkan;
baris laporan, order, invoice, pembayaran dan stok historis tetap sama.
