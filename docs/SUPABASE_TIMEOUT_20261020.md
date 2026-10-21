# Insiden timeout Supabase — 20 Oktober 2026

Status: temuan 20 Oktober; migrasi 219 diterapkan 21 Oktober bersama 220 setelah
uji lokal. Kelanjutan insiden dan verifikasi rilis: [21 Oktober](SUPABASE_TIMEOUT_20261021.md).

## Bukti yang berhasil diperoleh

- Pada 16.41 WIB, satu probe read-only gagal menghubungkan pooler dalam 6 detik;
  Auth health dan SELECT satu baris masing-masing tidak selesai dalam 6,5 detik.
- Pada 17.18 WIB, probe yang sama berhasil: Auth 733 ms, REST 1.308 ms,
  koneksi DB 1.736 ms dan pemeriksaan aktivitas 769 ms. Ada 11 koneksi lain,
  satu aktif, tanpa lock/IO wait yang terlihat pada saat itu.
- PostgreSQL mulai 07.03.42 WIB. Tidak ada restart yang dilakukan agen saat insiden.
- Query pengguna `normalized_pg_stat_statements` menghitung statistik query,
  melakukan normalisasi teks dan filter sumber internal. Tidak ditemukan
  pemanggilan SQL ini dalam `src/`, `api/`, `scripts/`, atau `migrations/`.
  Error 57014 disertai `statement timeout` berarti statement dibatalkan karena
  melewati batas waktu; ini belum mengidentifikasi pemicu awal gangguan.
- Statistik setelah pemulihan memuat 427 bentuk query, sekitar 326 KB teks.
  Ukuran ini tidak mendukung asumsi bahwa file statistik sangat besar.
- Pencatatan internal `cron.job_run_details` sempat sangat lambat:
  INSERT maksimum 144,6 detik; UPDATE maksimum 137,4 dan 157,2 detik.
  Ini adalah waktu eksekusi elapsed, bukan ukuran waktu CPU. Tabel tersebut
  berukuran sekitar 2,46 MB; tidak ada bukti bahwa log cron memenuhi disk.
- Sampel log request Vercel pada jendela 14.00–17.00 WIB memuat 366 respons
  503 untuk receive-wa dan 32 respons 504 untuk health. Jumlah request dapat
  mencakup retry; bukan jumlah pesan unik yang hilang. Runtime log historis
  tidak tersedia untuk jendela ini pada retensi Hobby.
- Screenshot menunjukkan swap ratusan MB dan CPU berlabel 87,51%.
  Legenda kategori CPU dan laju swap-in/out belum diperoleh. Pemakaian swap
  saja tidak membuktikan thrashing; belum ada bukti Disk IO Budget habis.

## Masalah aplikasi yang terverifikasi dan perbaikannya

1. `api/_handlers/auth-token.js` health melakukan panggilan Supabase dan Fonnte
   berurutan tanpa deadline. `api/_health.js` sekarang membatasi masing-masing
   3 detik, menjalankannya paralel, menggabungkan ping bersamaan, dan menyimpan
   hasil 15 detik per warm instance. HTTP tetap 503 saat Supabase gagal.
   Ini bukan cache global lintas instance. Status AI tetap pemeriksaan konfigurasi.
2. Bootstrap dan full fetch invoice sudah mencakup seluruh antrean actionable.
   `App.jsx` tidak lagi membaca outstanding terpisah saat login dan saat membuka
   Invoice/Finance. Invoice lama berada pada state utama yang bisa dimutasi.
3. Fungsi produksi `get_service_reports_page` sama persis dengan isi fungsi
   migrasi 201 (dibandingkan read-only). Fungsi tersebut mematerialisasikan
   `r.*` dan crew sebelum paging untuk dipakai ulang oleh count/rows.
   Statistik produksi pada RPC ini menunjukkan temporary disk writes.
   Migrasi 219 hanya menyimpan ID/status/waktu dalam CTE bersama, lalu membaca
   JSON/detail dan menyusun crew untuk ID halaman terpilih.

## Verifikasi

- SQL PostgreSQL/WASM terisolasi: 200 job, enam role aktif, delapan kombinasi
  filter/paging; **48 objek hasil identik** dengan fungsi lama.
- Anon, akun tanpa profil dan Owner nonaktif tetap ditolak; Helper tanpa
  penugasan tidak mendapat laporan; anggota tambahan tetap melihat pekerjaannya.
- Migrasi dapat dijalankan dua kali, hash baris laporan tetap sama, nomor halaman
  integer ekstrem menghasilkan halaman kosong tanpa overflow.
- EXPLAIN ANALYZE terisolasi dengan work_mem **64 kB**: temporary blocks written
  **46 → 0**, waktu sampel **3,286 → 2,250 ms**. Ini bukan benchmark produksi;
  work_mem produksi terukur 4 MB. Tidak ada klaim penurunan beban global sebesar itu.
- Uji invoice: seluruh 1.200 invoice actionable lama dari lima status tetap
  lengkap, unik dan mempertahankan nilai, pada bootstrap maupun full fetch.
- Health: 200 ping bersamaan hanya dua panggilan dependency per instance;
  upstream yang macet dibatalkan dan hasil unhealthy selesai dalam tiga detik.
- Browser terisolasi mencakup login/pemulihan outage Owner, Admin, Finance,
  Teknisi, Helper, layar mobile dan pencegahan login double-click.

## Penerapan dan batas kesimpulan

Migrasi 219 mengganti fungsi baca, tanpa backfill data atau perubahan RLS/ACL,
invoice/pembayaran/stok, scheduler maupun batas statement timeout global.
Terapkan setelah persetujuan deployment, cek definisi live serta hasil baca yang
dibatasi, dan deploy hanya file terkait insiden; perubahan backup lokal terpisah.
Jika perlu rollback, pulihkan **definisi get_service_reports_page saja** dari
migrasi 201; jangan menjalankan ulang seluruh 201 yang berisi backfill/trigger.

Perbaikan aplikasi mengurangi beban yang terverifikasi. Penyebab awal gangguan
server belum pasti: perlu korelasi CPU per kategori, swap-in/out, Disk IO Budget,
latensi WAL/storage dan log platform pada 13.10–17.03 WIB. Jangan menganggap
cron pasti penyebab hanya karena query internalnya ikut lambat. Jangan menaikkan
statement_timeout global untuk menyembunyikan macetnya server.

Referensi resmi:
- https://supabase.com/docs/guides/troubleshooting/exhaust-swap
- https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io
- https://supabase.com/docs/guides/troubleshooting/failed-to-run-sql-query-connection-terminated-due-to-connection-timeout
