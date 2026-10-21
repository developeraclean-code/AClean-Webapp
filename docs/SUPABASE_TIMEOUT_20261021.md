# Gangguan 21 Oktober 2026 — diagnosis dan pengamanan

Status: 219/220 sudah diterapkan 21 Oktober 2026; hash fungsi cocok, checksum lima
tabel bisnis tetap sama, smoke baca laporan berhasil, akses baca staf lapangan
ke header/proof nol baris. Tidak ada RPC pembayaran produksi yang dijalankan.
Deployment kode tetap harus diverifikasi terhadap SHA rilis.
Seluruh waktu insiden di bawah adalah WIB. Pemeriksaan produksi hanya baca;
uji pembayaran memakai data sintetis di database terpisah.

## Temuan yang dapat dibuktikan

- Kasus pembayaran gabungan yang dilaporkan: dua invoice masih UNPAID tanpa
  proof; tidak ada header grup, jurnal, atau audit pelunasan pada jendela pemeriksaan.
  Suggestion bukti sudah masuk sebelum gangguan dan tetap PENDING. Tidak ada
  bukti bahwa membuka modal menyebabkan gangguan, atau konfirmasi berhasil.
  Identitas customer, ID invoice dan nominal aktual tidak disertakan di repo publik.
- `cron.job_run_details`: 16.00–17.00 terdapat **11 kegagalan startup**:
  dispatcher 7, retry media 3, rekap harian 1, semuanya `job startup timeout`.
  Retry media kembali sukses 17.07 dan dispatcher 17.10. Ini kegagalan sebelum
  pekerjaan SQL dimulai, bukan sekadar kegagalan HTTP dari browser.
- Pengaturan live: `cron.use_background_workers=off`, `max_connections=60`,
  `cron.max_running_jobs=32`. Worker cron membuka koneksi libpq; setting ini
  bukan bukti 32 job benar-benar berjalan. Jadwal aktif hanya enam; auto-verifikasi OFF.
- PostgreSQL masih memiliki postmaster start 20 Oktober 07.03.42; tidak ada
  restart postmaster selama insiden 21 Oktober yang terlihat dari waktu start ini.
- Statistik query kumulatif sejak 20 Oktober: pencatatan internal cron mencapai
  maksimum 137–157 detik; autentikasi pooler `pgbouncer.get_auth` maksimum 52,6 detik.
  Angka tersebut elapsed, bukan CPU, dan bukan durasi spesifik pukul 16.xx.
- Setelah pulih: 15 backend idle, tidak ada query aktif lain/blocker yang terlihat;
  statistik deadlock nol. Ini tidak membuktikan kondisi koneksi/lock saat insiden.
- `track_io_timing=off` dan `track_wal_io_timing=off`: angka waktu IO nol **bukan**
  bukti storage cepat. `wal_buffers_full` kumulatif tinggi, tetapi tanpa profil
  latensi, resource, dan waktu insiden tidak layak mengubah parameter WAL secara coba-coba.
- RPC laporan lama memiliki 63 panggilan selesai, mean 1,1 detik, maksimum 7,8 detik,
  temporary writes 32.787 blok (~256 MiB kumulatif), bukan ukuran database atau CPU.
  RPC rekap bulanan ada di produksi: pesan migrasi 181 pada error 57014 salah diagnosis UI.

## Kesimpulan terbatas

Gangguan menjangkau database/konektivitas internal, bukan terbukti API Gateway saja.
Login massal atau perubahan data massal tidak diperlukan agar gangguan seperti ini
terjadi. Beban baca/worker, keterbatasan compute/memori/IO, atau masalah host/jaringan
masih perlu dibedakan melalui metrik platform di jendela 15.50–17.10.
Kode aplikasi memiliki penguat beban dan silent error terverifikasi, tetapi belum
ada bukti tunggal yang menghubungkan satu klik pembayaran dengan gangguan seluruh server.

Jangan menyebut cron sebagai pemicu hanya karena pencatatan cron ikut lambat;
jangan menaikkan statement_timeout global atau menambah retry pembayaran otomatis.

## Perbaikan dalam rilis ini

1. **220 — grup atomik**: header `payments`, jurnal `invoice_payments`, saldo/order,
   dan suggestion disimpan satu transaksi. FK grup bigint sesuai skema produksi,
   bukan `payment_id` UUID lama. Review admin, snapshot saldo, maksimal 20 invoice,
   kunci retry tetap, lock timeout 2 detik dan larangan kelebihan/pecahan rupiah.
   Satu proof ditautkan ke grup, bukan menebak invoice pertama. Tidak menghitung PPh
   atau menutup selisih secara otomatis. Saldo parsial tetap menjadi tagihan.
2. **Dashboard** membedakan fungsi hilang, timeout, koneksi dan akses. Retry rekap
   manual; tidak ada loop otomatis atau asumsi migrasi hilang dari pesan 57014.
3. **219 — paging ringan**: materialisasi ID/status/waktu, detail JSON hanya halaman
   terpilih. Hasil role/filter/urutan tetap identik; tidak mengubah transaksi/RLS.
4. **Backpressure baca**: slot/deadline tetap dipegang sampai body selesai. Enam RPC
   baca eksplisit ikut antrean/circuit; RPC pembayaran dan mutasi lain tidak direplay.
5. **Metrik**: `{error}` tidak lagi tercatat sukses; flush single-flight, batch 20,
   cursor monoton melewati buffer 100, timeout tiga detik dan jeda lima menit saat gagal.
6. Perubahan lokal 20 Oktober yang relevan disertakan: hilangkan fetch outstanding
   invoice duplikat (antrean actionable tetap lengkap) dan health probe paralel,
   deadline tiga detik, single-flight/cache 15 detik **per instance**, bukan global.
7. RLS produksi `payments_all` sebelumnya menerima semua authenticated;
   `payment_suggestions` SELECT/UPDATE juga `true`. 220 menambah policy restrictive
   untuk profil Owner/Admin/Finance aktif, delete header hanya Owner/Admin.
   Policy service_role tidak diubah. Uji SQL asli memastikan field/inactive user
   melihat nol baris dan tidak dapat mengubah proof, tanpa memblokir staf kantor.

## Pengujian dan batasan

- SQL/PGlite: migrasi 220 dua kali, saldo/jurnal/kas, parsial, proof grup, role aktif,
  replay, input buruk dan kegagalan akhir dengan rollback penuh.
- PostgreSQL native lokal: dua koneksi bersamaan; request sama satu transfer,
  invoice tumpang tindih satu pemenang, proof sama untuk dua grup ditolak, lock dibatasi.
- Browser aplikasi penuh desktop/mobile: respons pertama sengaja diputus sesudah
  commit, UI tidak mengklaim PAID, retry mempertahankan payload/ID dan tidak menggandakan kas.
- 219: 48 hasil identik pada 200 job; synthetic work_mem 64kB, temp writes 46 → 0.
  Pengukuran ini bukan persentase pengurangan beban global produksi.
- Semua sesi browser lama perlu refresh setelah deploy. Jalur lama di cache browser
  tidak otomatis berubah karena fungsi baru sudah dipasang.
- Jangan replay pembayaran customer atau memperbaiki transaksi historis sebagai smoke test.

## Tindak lanjut platform jika berulang

Sertakan project ref, 21 Oktober 15.50–17.10 WIB, pesan CONNECT_TIMEOUT 5001ms,
Auth/REST 504/522, 11 kegagalan startup cron dan waktu pemulihan ke dukungan Supabase.
Minta pemeriksaan resource host, accept/auth koneksi libpq, latensi WAL/fsync,
swap-in/out dan Disk IO Budget pada jendela itu. Tidak perlu mengirim password,
JWT, service key, isi bukti transfer atau snapshot data bisnis.

Referensi primer:
- [Supabase HTTP API diagnosis](https://supabase.com/docs/guides/troubleshooting/http-api-issues)
- [pg_cron startup/connection timeout implementation](https://github.com/citusdata/pg_cron/blob/main/src/pg_cron.c)
- [PostgreSQL cumulative IO/WAL statistics](https://www.postgresql.org/docs/current/monitoring-stats.html)

## Rollback

219: pulihkan **definisi fungsi get_service_reports_page saja** dari 201, jangan
jalankan seluruh 201 yang memuat backfill/trigger. 220: fitur baru gagal tertutup
jika RPC tidak tersedia; jangan mengaktifkan kembali frontend grup yang mengabaikan
error. Setelah ada transaksi baru, FK/header/jurnal tambahan harus dipertahankan.
Perubahan kode baca/health dapat direvert terpisah tanpa menghapus jurnal bisnis.
