# Tindak lanjut antrean bukti WA — 13 November 2026

Screenshot Owner pukul 17.45 WIB menunjukkan 18 media dalam antrean retry,
18 belum tersimpan di R2, 19 gagal otomatis, 86 review tersimpan, dan 63 item
Pending AI pada filter aktif. Status publik aplikasi tetap `healthy` pada
build `18c6103`. SSH ke VPS timeout pada port 22, sehingga rincian job/run
terkini belum diverifikasi dari database.

Label "Pemicu retry belum berjalan dalam 45 menit terakhir" pada build itu
menggunakan `last_worker_at` dari migrasi 210. Nilai tersebut hanya menghitung
run `SUCCESS` dan `SKIPPED`; run `FAILED` setelah mengambil media tetapi
mendapat HTTP 429 tidak memperbaruinya. Pembacaan database sebelum SSH putus
membuktikan beberapa run `FAILED` dengan `checked=1` dan kode
`WA_MEDIA_HTTP_429`/`WA_MEDIA_TIMEOUT`. Jadi screenshot saja tidak membuktikan
scheduler berhenti. Diagnosis semua 18 file memerlukan rincian job terbaru.

Migrasi 237 mengantrekan satu media per invocation dan mengurutkan media
belum tersimpan di R2 sebelum yang sudah tersimpan. Saat banyak URL WhaCenter
membalas 429, unggahan bukti manual dari invoice (provider `manual`, file
sudah di R2) dapat menunggu di belakangnya. Migrasi 242 memberi
prioritas hanya pada job manual yang telah terverifikasi di R2, tanpa membuka
akses anon/authenticated atau mengubah invoice/ledger. Pembaruan UI/monitor
memakai waktu run terbaru untuk status liveness dan menampilkan hasil gagal
secara terpisah. Pada checkpoint 13 November, kode dan migrasi ini masih
menunggu rilis.

## Rilis dan pemeriksaan produksi — 14 November 2026

Owner memulihkan akses SSH. PR #18 telah merged sebagai
`8d032cc5fc4a8ed13f599854de862af2ee9b58d7` setelah kedua pemeriksaan
CI lulus. Migrasi 242 diterapkan ke DB produksi; definisi claim memprioritaskan
provider `manual`, dan hak EXECUTE tetap `service_role` saja (anon dan
authenticated ditolak). Coolify dipin ke SHA merge tersebut; deployment
`m85v95gzokm4kdy6hewkhufo` selesai, container baru healthy dan
`SOURCE_COMMIT` cocok. `/api/health` publik 200/healthy versi `8d032cc`.
Endpoint pemulihan tetap menolak POST anonim dengan HTTP 401.

Timer produksi aktif. Sebelum rilis kode, tiga run terbaru worker berstatus
SUCCESS dengan `checked=0`; endpoint status pada container baru membaca run
terakhir dan merespons 200. Antrean aktif saat pembacaan adalah **0** dan
48 job berstatus FAILED_PERMANENT (40 WhaCenter, 8 Fonnte). Dari kegagalan
WhaCenter yang diperbarui dalam 24 jam: 17 berkode HTTP 404, 11 HTTP 429,
dan 7 timeout. Dua foto yang dilaporkan sebelumnya sudah mencapai tujuh
percobaan, tetap tanpa objek R2 dan tanpa payment suggestion. Karena itu
rilis ini memperbaiki prioritas unggahan manual dan kejelasan status, tetapi
tidak memulihkan byte foto yang tetap tidak diberikan WhaCenter. Tidak ada
job terminal yang diantrekan ulang secara massal atau pembayaran yang
ditandai lunas oleh pekerjaan ini.

Langkah pelanggan yang mendesak: gunakan file bukti asli yang diterima di WA,
unggah dari **Invoice → Lampirkan Bukti** pada invoice yang tepat. Unggahan
masuk R2 dan antrean AI tanpa mengunduh ulang dari WhaCenter. Periksa bukti,
pengirim, nominal, dan invoice sebelum tombol konfirmasi pembayaran. Jangan
mengulang klik retry atau menandai lunas hanya karena foto ada di chat.

HTTP 429 berarti penyedia menolak laju permintaan menurut kebijakan mereka;
kuota dan durasi pembatasan khusus WhaCenter belum terdokumentasi/terverifikasi.
Bila 429 berlanjut setelah jeda, minta WhaCenter memeriksa log media endpoint,
limit akun/IP, dan masa berlaku URL media dengan waktu/ID contoh yang aman.
Jangan mengirim URL bertoken atau bukti pelanggan ke kanal publik.
