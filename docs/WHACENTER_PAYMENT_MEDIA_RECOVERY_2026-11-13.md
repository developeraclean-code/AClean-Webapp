# Pemulihan media bukti pembayaran WhaCenter — 13 November 2026

Audit produksi baca-saja pada 13 November sekitar 08.42 WIB menemukan dua
foto pelanggan baru yang tercatat di chat tetapi tidak mencapai R2/AI:
WhaCenter membalas HTTP 429 pada satu job dan unduhan lain timeout. Keduanya
`FAILED_PERMANENT` sesudah tiga percobaan, tanpa `r2_key` dan tanpa
`payment_suggestions`. Uji GET baca-saja dari container saat itu masih
menghasilkan timeout dan 429. Pada jendela tiga hari, 37 job bukti transfer
berstatus DONE dan Vision memiliki 38 klasifikasi sukses dalam 24 jam; jadi
temuan ini spesifik pada unduhan media, bukan bukti worker/AI mati menyeluruh.
Lima job terminal lain berformat video/PPT atau file yang tidak dikenali,
sehingga tidak boleh otomatis diperlakukan sebagai bukti transfer.

Migrasi 237 diterapkan ke database produksi pada 13 November sekitar 09.44 WIB.
Pemeriksaan ulang menunjukkan constraint provider menerima `manual`, RPC baru
hanya dapat dieksekusi `service_role` (bukan `anon` atau `authenticated`),
dan kedua job terdampak tetap terminal tanpa suggestion sebelum pemulihan.
PR #13 lulus dua pemeriksaan CI (lint/typecheck/unit dan Playwright E2E), lalu
merged sebagai `18c61039551c014c1e1779324bf77335da44a7da`. Coolify
produksi dipin ke SHA itu; deployment `vadt6nuieberbdmpzut0e4au` finished,
container baru healthy, `/api/health` publik 200/healthy dengan versi
`18c6103`, dan `SOURCE_COMMIT` container cocok. Endpoint pemulihan menolak
POST anonim dengan HTTP 401. Perubahan yang dirilis:

1. Audit skema target dan pastikan migrasi 210, 233, 235 tersedia; terapkan
   `migrations/237_payment_media_recovery.sql` melalui jalur SQL target.
   Migrasi ini tidak mengantrekan ulang job lama secara otomatis, mengubah
   invoice, atau menyentuh ledger. Grant RPC baru hanya untuk service role.
2. Deploy kode server dan UI yang cocok. Worker menetapkan waktu retry paling
   awal 1, 5, 15, 30, 60, lalu 120 menit untuk kegagalan unduh; scheduler
   yang berjalan berkala dapat membuat eksekusi aktual lebih lambat.
   Respons 429 `Retry-After` yang
   sah dihormati sampai enam jam. Kegagalan sementara WhaCenter diberi batas
   tujuh percobaan dan umur 24 jam. HTTP 404/format rusak tetap terminal.
   Header identifikasi hanya dikirim ke host awal WhaCenter, tidak diteruskan
   ke redirect storage. Seluruh GET tetap dibatasi ukuran, host, HTTPS, dan
   waktu seperti sebelumnya.
3. Owner/Admin dapat menekan **Coba unduh ulang** di rincian bukti Invoice atau
   **Muat ulang bukti & invoice** pada percakapan terkait. RPC atomik hanya
   membuka job terminal tanpa suggestion, dengan maksimal tiga permintaan
   pemulihan manual. Klik berulang tidak membuat job/suggestion kedua.
   Scheduler kemudian mengunduh, menyalin ke R2, menjalankan AI, dan membuat
   suggestion PENDING bila klasifikasi benar-benar bukti transfer. Jika sumber
   masih membalas 429/timeout, job tetap menunggu atau kembali terminal sesuai
   batas. Tidak ada pelunasan otomatis.
4. Jika URL WhaCenter tidak pulih, unggah file asli melalui **Lampirkan Bukti**.
   Untuk invoice belum lunas, UI mendaftarkan objek R2 yang terverifikasi ke
   worker AI tanpa GET ke WhaCenter. Hasilnya tetap perlu ditinjau sebelum
   pelunasan. Jika antrean AI gagal, file terunggah masih dapat dilampirkan
   secara manual dengan verifikasi manusia. Invoice yang sudah PAID memakai
   jalur lampirkan bukti saja.

Verifikasi kandidat terisolasi: 1.797 tes unit lulus, 13 kelompok tes SQL PGlite
lulus (termasuk 200 job sintetis tanpa penulisan ledger); lint, typecheck,
check:migrations, dan build lulus. Satu tes enkripsi pada run pertama gagal
karena ciphertext acak memuat nama pendek yang dilarang assertion; run ulang
tes itu dan seluruh suite lulus. Skrip `test:selfhost` tidak tersedia pada
branch rilis ini.

Sekitar 09.52 WIB, dua job lama (Heri: HTTP 429; Mulyaty: timeout) dibuka
sekali melalui RPC baru: keduanya `FAILED_RETRYABLE`, `attempts=0`,
`manual_retry_count=1`, belum memiliki R2/suggestion. Tiga job WhaCenter baru
lain juga sedang menunggu retry setelah HTTP 429 (`attempts=2`). Enam run
worker sebelum rilis berstatus FAILED karena satu unduhan 429/timeout pada
tiap run (`checked=1`), bukan kegagalan claim atau scheduler. Timer produksi
tetap aktif per lima menit; task payment-media memakai interval 15 menit.
Tick worker 09.55 WIB pada container baru mengambil job Mulyaty, mendapat
HTTP 429 lagi, dan menyimpannya sebagai `FAILED_RETRYABLE` dengan `attempts=1`
serta `next_retry_at` satu menit kemudian; ini membuktikan tidak lagi langsung
terminal setelah retry cepat. Job Heri masih menunggu giliran saat pembacaan
ini. Klasifikasi/suggestion untuk kelima file belum terkonfirmasi karena
provider masih membatasi unduhan. Tidak ada invoice/ledger yang diubah
oleh migrasi atau pemulihan job. Jangan menekan retry berulang saat provider
masih membalas 429; jeda yang disimpan antrean harus dihormati.

## Audit lanjutan 14 November 2026

Pada 09.34 WIB dashboard menampilkan antrean aktif 0 dan gagal otomatis 48.
Pembacaan database produksi sekitar 09.40 WIB mengelompokkan 48 job terminal:
18 unduhan sementara (11 HTTP 429, 7 timeout) tanpa objek R2, 22 URL HTTP 404
(17 WhaCenter dan 5 Fonnte), serta 8 file yang sudah di R2 tetapi gagal
validasi format gambar (termasuk satu respons AI `invalid_image_format`).
Tidak ada alasan untuk membuat suggestion otomatis bagi 30 job 404/format
rusak. Dari 18 kegagalan sementara, 13 sumber berumur kurang dari 24 jam dan
5 lebih tua tetapi masih dalam batas pemulihan manual tujuh hari. Kedua job
pelanggan yang diaudit 13 November kembali terminal setelah provider tetap
menolak unduhan; keduanya belum punya R2 atau suggestion.

Tombol `Perbarui bukti WA` pada Invoice sebelumnya hanya menjalankan pembacaan
ulang `payment_suggestions`. Perubahan berikutnya mengubah tindakan di posisi
itu menjadi `Coba pulihkan bukti WA`: endpoint Owner/Admin menjalankan RPC
service-only `requeue_failed_payment_media_batch_243`, memilih maksimal tiga
job 429/timeout yang belum punya suggestion, menjadwalkannya berjarak lima
menit, dan menerapkan jeda batch 15 menit. Migrasi 243 memberi pemulihan manual
jendela retry 24 jam dari permintaan manual, tetap dengan batas tujuh percobaan
untuk kegagalan sementara WhaCenter serta maksimal tiga permintaan manual per
job. UI menyatakan jumlah yang diantrekan dan tidak menyamakan antrean dengan
AI selesai atau invoice lunas. HTTP 404 dan file rusak memerlukan file asli
melalui `Lampirkan Bukti`; klasifikasi sukses tetap perlu tinjauan manusia.

Verifikasi kandidat lokal: 1.809 tes unit, 15 kelompok tes SQL sintetis,
lint, typecheck, check:migrations, dan build lulus. Ini belum merupakan bukti
bahwa provider akan mengizinkan 18 URL tersebut diunduh pada produksi.

### Rilis dan pemulihan pertama, 14 November 2026 sekitar 09.51 WIB

PR #21 lulus CI lint/typecheck/unit dan Playwright E2E, lalu merged sebagai
`58445ff886cb5733b9603ab95273b2d813f2e2c5`. Migrasi 243 diterapkan
ke database produksi; fungsi baru terdaftar, `service_role` memiliki EXECUTE,
`anon`/`authenticated` tidak, dan fungsi claim memuat jendela manual 24 jam.
Sebelum tindakan recovery, jumlah terminal tetap 48 dan tidak ada antrean
aktif. Coolify deployment `nbiamzeo308rqor4yalykbrb` finished pada SHA merge
yang sama; aplikasi `running:healthy`, `/api/health` mengembalikan HTTP 200
dengan versi `58445ff`, dan POST anonim ke endpoint recovery ditolak HTTP 401.

Satu panggilan batch terkontrol mengantrekan **3 dari 18** job transient,
menyisakan 15 yang masih layak dicoba. Setelah transaksi, 45 job tetap
`FAILED_PERMANENT` dan 3 `FAILED_RETRYABLE` dengan jadwal 09.51, 09.56,
dan 10.01 WIB. Timer VPS tunggal masih aktif; run payment-media terakhir
09.50 WIB selesai sukses dengan `checked=0` **sebelum** batch dibuat. Hasil
download R2, klasifikasi AI, dan suggestion dari tiga job ini belum diverifikasi
pada checkpoint ini. Jika provider tetap 429/timeout, status dapat kembali
gagal; jangan menyamakan penurunan angka 48 dengan 3 bukti pembayaran yang
sudah dikenali.
