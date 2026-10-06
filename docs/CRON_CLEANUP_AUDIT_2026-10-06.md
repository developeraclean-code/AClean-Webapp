# Audit cron pembersihan — 6 Oktober 2026

Pemeriksaan produksi sebelum 09:00 WIB: query transaksi read-only pada `cron_runs`, `agent_logs`, `app_settings`, `cron.job`, `cron.job_run_details`, definisi fungsi database, dan hitungan kandidat retensi. Log GitHub Actions dibaca melalui API. Tidak ada cron/RPC penghapusan dijalankan, toggle diubah, atau file R2 dihapus. Angka kandidat file berasal dari metadata database, bukan inventaris objek R2; keberadaan dan ukuran setiap objek belum diperiksa.

## Kesimpulan

Seluruh toggle cleanup yang digunakan aktif. Pembersihan bekerja sebagian, tetapi ada backlog R2, kegagalan pemicu, hasil gagal yang tercatat sukses, aturan yang bertentangan, dan format lama yang dilewati.

| Task | Eksekusi terakhir teramati, WIB | Bukti hasil | Kandidat tersisa saat audit |
|---|---|---|---|
| `r2-cleanup-90d` | 5 Okt 03:41 | 50 berhasil, 0 error | 1.055 referensi foto >90 hari, tertua 18 Juni |
| `expense-foto-cleanup` | 5 Okt 03:41 | 2 berhasil, 0 error | 0 foto memenuhi kriteria |
| `payment-proof-cleanup` | 5 Okt 06:44 | 12 berhasil, 0 error | 16 kandidat URL relatif; 4 URL absolut tidak dipilih |
| `log-cleanup` | 5 Okt 03:41 | 29 cron_runs, 116 webhook raw, 146 dedup dihapus | 39 cron_runs >90 hari, 895 raw >14 hari, 122 dedup >30 hari |
| `wa-cleanup` | 5 Okt 10:13 | 214 pesan, 10 percakapan dihapus | 492 pesan memenuhi syarat; 14 pesan lama lain dilindungi bukti bayar PENDING baru |
| `snapshot-cleanup` | 4 Okt 22:07 | Tidak ada kandidat | 0 snapshot >60 hari |
| `cleanup` | 1 Okt 04:06 | 18 dispatch_logs, 345 payment_suggestions dihapus | 1 dispatch log >90 hari; 61 suggestion selesai >30 hari |
| Retensi dalam `backup` | 5 Okt 22:07 | 2 backup dihapus | 1 catatan backup bulanan lama dilewati |

WA dijadwalkan setelah 09:00 WIB, sehingga belum berjalan pada pagi audit ini tidak cukup untuk menyatakan rusak. Task `cleanup` memang bulanan setiap tanggal 1, bukan harian. Snapshot tidak memiliki backlog walau terakhir tidak dieksekusi pada 5 Oktober.

## Penyebab terverifikasi

### 1. R2 pernah gagal penuh, sekarang pulih tetapi dibatasi 50 per hari

Dalam 30 hari terakhir terdapat 22 run `r2-cleanup-90d` berstatus `SUCCESS` dengan `errors > 0`, seluruh kandidat pada run tersebut gagal. Contoh 30 September 06:17 WIB: `swept=500, purged=0, errors=500`.

Kode sebelum commit `307b774` membaca `new URL(row.r2_image_url)` tanpa base, padahal semua 1.055 kandidat yang tersisa berformat relatif `/api/foto?key=...`. Format ini menyebabkan parsing gagal. Commit 30 September memperbaiki ekstraksi key, encoding signature, timeout, dan batching. Run 1–5 Oktober sudah mencatat penghapusan berhasil; 300 referensi lama kini bertanda `r2_purged_at`.

Saat ini [cleanup.js](../api/_tasks/cleanup.js:7) membatasi 50 objek sekali jalan. [Dispatcher](../api/cron-reminder.js:117) melewati task yang telah sukses hari itu walaupun kandidat masih ada. Backlog 1.055 memerlukan minimal 22 hari eksekusi sukses tanpa tambahan kandidat. Riwayat unggahan yang sedang memasuki umur 90 hari beberapa hari berjumlah 60–105 file/hari, sehingga batas 50 dapat kalah dari pertambahan kandidat.

### 2. Pemicu terbaru gagal sebelum mencapai aplikasi; antrean task juga tertinggal

[GitHub run 37366812822](https://github.com/developeraclean-code/AClean-Webapp/actions/runs/37366812822) pada 6 Oktober 02:58 WIB gagal dengan annotation: `The job was not acquired by Runner of type hosted even after multiple attempts`. Job tidak menjalankan satu step pun; ini kegagalan mendapatkan runner, bukan bukti token Supabase/Fonnte bermasalah.

Walaupun workflow dijadwalkan setiap jam, catatan eksekusi nyata memiliki jeda beberapa jam. Tick terakhir di database: 5 Oktober 22:07 WIB, `pending=14`. Tick 18:00 menyisakan 13 task. Dispatcher membatasi tiga task terjadwal per pemanggilan, anggaran 22 detik, timeout biasa 6,5 detik, dan mengerjakan dua task pembayaran terlebih dahulu pada jam kerja. Kombinasi pemicu yang jarang dan batas ini membuat task bagian akhir, termasuk snapshot, tertunda. Fallback Vercel hanya dijadwalkan 10:00 dan 22:00 WIB.

### 3. Monitoring dapat menyatakan sukses meski pekerjaan gagal

[runWithCronLogging](../api/_logger.js:178) menandai hasil `SUCCESS` selama fungsi selesai tanpa throw. Nilai `error`, `errors > 0`, atau `ok: false` tidak diperiksa. `items_processed` juga default 0 meskipun metadata berisi jumlah penghapusan nyata. Ini menjelaskan indikator 0 yang bukan berarti tidak ada data dihapus.

[Workflow GitHub](../.github/workflows/cron.yml:20) hanya memeriksa HTTP 200. Endpoint dapat mengembalikan HTTP 200 dengan `ok:false`, atau tick sukses dengan antrean belum selesai. Hijau di Actions/Monitoring belum membuktikan seluruh pembersihan tuntas.

### 4. Tiga aturan `agent_logs` bertentangan di produksi

- `cron.job` ID 7, `cleanup-old-logs-daily`, aktif pukul 09:00 WIB: fungsi `cleanup_old_logs()` menghapus **semua agent_logs >30 hari**, tanpa pengecualian log bisnis. Sukses 14 kali dalam 14 hari; terakhir 5 Oktober 09:00.
- `cron.job` ID 1, `aclean-cleanup-agent-logs`, aktif Senin 02:00 WIB: `cleanup_agent_logs_stratified()` menghapus operasional >90 hari, tetapi mengecualikan daftar action audit bisnis. Terakhir sukses 5 Oktober 02:00.
- RPC `cleanup_operational_logs` yang dipanggil API harian menghapus semua agent_logs >90 hari, juga tanpa pengecualian bisnis.

Akibatnya kebijakan 30 hari mendominasi; janji mempertahankan audit bisnis selamanya pada fungsi mingguan tidak efektif. Ini mengenai catatan audit, bukan penghapusan tabel order/invoice. Saat audit tidak ada agent_logs >90 hari; 76 log telah melewati 30 hari sejak eksekusi harian kemarin. Jumlah audit bisnis historis yang pernah terhapus tidak dapat ditentukan dari data yang tersisa.

### 5. Format yang belum dijangkau

- [Retensi backup](../api/_tasks/ops.js:231) hanya menerima folder tanggal `YYYY-MM-DD`. Satu catatan `auto-r2-monthly` 1 Juni 2026 tidak sesuai format dan sengaja dilewati. Objek backup yang tersisa belum diinventarisasi.
- [Bukti bayar](../api/_tasks/cleanup.js:192) hanya memilih URL `/api/foto?key=...`. Ada empat URL absolut >90 hari di luar filter: tiga berpola URL R2/proxy milik aplikasi dan satu provider eksternal. Identitas objek perlu diverifikasi sebelum penghapusan; jangan menghapus URL eksternal secara otomatis.
- Fungsi lama `cleanup_wa_messages_ttl()` ada tetapi tidak dijadwalkan pada `cron.job`; ia merujuk kolom `received_at` yang tidak ada pada `wa_messages` saat ini. Ini fungsi usang, bukan pembersih WA aktif. Jangan mengaktifkannya sebagai solusi.

## Prioritas perbaikan yang disarankan

1. Benarkan status gagal/parsial dan jumlah item pada Monitoring serta validasi JSON hasil workflow.
2. Jadikan pemicu dan kelanjutan antrean lebih andal; beri cleanup R2 kesempatan melanjutkan batch tanpa menunggu esok, tetap dengan batas waktu/konkurensi.
3. Satukan kebijakan retensi log dan lindungi audit bisnis sesuai keputusan Owner sebelum mengubah jadwal database.
4. Inventarisasi lalu tangani format backup/bukti bayar lama; jangan menghapus berdasarkan tebakan path.

Audit ini tidak mengubah perilaku aplikasi maupun produksi. Perubahan berikutnya perlu mempertahankan data finansial dan menguji error parsial, retry, batas waktu, serta retensi pada salinan/simulasi terlebih dahulu.

## Pelaksanaan setelah persetujuan Owner, 6 Oktober 2026

Owner meminta rekomendasi dijalankan. Migrasi **195** sudah diterapkan setelah uji PostgreSQL/WASM dan uji schema produksi yang di-rollback. Migrasi sendiri tidak menghapus data. Dua job pg_cron lama diganti satu job `aclean-operational-log-retention` pukul 03:00 WIB; semua entrypoint retensi lama mengikuti aturan yang sama. Action audit bisnis dipertahankan; log operasional 90 hari, raw webhook 14 hari, dedup 30 hari, dan ai_usage/operational_mutations 180 hari.

Perubahan aplikasi:

- Logger menolak `error`, `ok:false`, dan jumlah error positif; hasil parsial tetap menyimpan jumlah objek yang berhasil diproses.
- Metadata `has_more` melanjutkan batch penuh pada hari yang sama. Task yang belum berjalan didahulukan agar batch R2 tidak menghalangi task lain.
- Endpoint `cleanup-tick` hanya menjalankan cleanup, tidak mengirim WhatsApp. Workflow memeriksa JSON `ok`, lalu menjalankan maksimal delapan batch lanjutan; antrean sisanya dilanjutkan pemicu berikutnya. Jadwal GitHub dipindah ke menit 17; ketersediaan hosted runner tetap di luar kendali aplikasi.
- Retensi backup dipisahkan dari pembuatan backup dan mendukung metadata bulanan lama yang sudah diverifikasi. Bukti bayar mendukung URL R2/proxy absolut milik konfigurasi aplikasi, hanya untuk invoice PAID; URL provider eksternal tidak dihapus.
- Pembersihan chat berhenti jika daftar nomor yang harus dilindungi gagal dibaca.

Validasi: 834 tes unit, lint, typecheck, build, pemeriksaan nomor migrasi, dan tes retensi SQL lulus. Uji produksi dengan rollback memastikan action ORDER_CREATED/PAYMENT_CONFIRMED >200 hari tetap ada, log teknis 45 hari tetap ada, log teknis >90 hari terhapus, dan wrapper lama konsisten. Filter PostgREST produksi mengenali 19 bukti bayar milik aplikasi dan satu backup bulanan.

Inventaris baca R2 berhasil: **29.237 objek / 4.299.134.598 byte**, sebelum cleanup. Folder terbesar: `laporan/` 1.612.756.384 byte, `wa-group/` 1.192.893.756 byte, `service-reports/` 708.083.910 byte, dan `invoices/` 492.077.877 byte. Manifest detail disimpan privat di luar repo. Script audit ulang: `node scripts/audit-r2.mjs --manifest /private/tmp/aclean-r2-inventory.json`.

Kandidat yang sudah cocok dengan objek nyata: 1.055 foto grup (141.313.962 byte), 19 bukti bayar dari invoice PAID (semuanya berumur objek >90 hari), dan empat objek backup Juni. Seluruh 300 objek yang sebelumnya bertanda purged terverifikasi sudah tidak ada. Foto pekerjaan `laporan/`, PDF invoice/laporan, maintenance, material, quotation, dan tanda tangan tidak termasuk penghapusan batch ini. File lain yang belum cocok dengan metadata tetap memerlukan review referensi sebelum dihapus.
