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
sudah di R2) dapat menunggu di belakangnya. Kandidat migrasi 242 memberi
prioritas hanya pada job manual yang telah terverifikasi di R2, tanpa membuka
akses anon/authenticated atau mengubah invoice/ledger. Pembaruan UI/monitor
memakai waktu run terbaru untuk status liveness dan menampilkan hasil gagal
secara terpisah. Kode dan migrasi ini belum diterapkan ke produksi pada
checkpoint dokumen ini.

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
