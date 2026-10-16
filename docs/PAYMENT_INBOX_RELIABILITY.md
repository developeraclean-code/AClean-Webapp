# Bukti bayar WA: operasi 24 jam

Penerimaan webhook dan pengamanan media ke R2 tidak bergantung pada jam kerja,
panel WA Monitor, auto-reply ARA, maupun tab browser admin. Suggestion adalah
kandidat pemeriksaan, **bukan** konfirmasi uang masuk atau pelunasan otomatis.

## Pembaruan tampilan

- Owner/Admin mendapat snapshot seluruh suggestion PENDING, dengan pagination
  200 baris per halaman; tidak dipotong menjadi 20 entri.
- Tab terlihat: interval lima menit, sepanjang hari termasuk Minggu. Tab
  tersembunyi: polling dihentikan, kembali terlihat/fokus/online memicu refresh.
- Notifikasi memakai ID yang belum pernah terlihat dalam sesi, bukan umur 125
  detik. Snapshot pertama tidak membanjiri admin dengan notifikasi arsip lama.
- Kegagalan mempertahankan snapshot terakhir dan menampilkan peringatan. Hasil
  kosong yang berhasil benar-benar membersihkan entri yang telah diselesaikan.
- Invoice dan Pending AI mengikuti pembaruan inbox yang sama. Tombol Perbarui
  tersedia untuk pemeriksaan langsung tanpa harus logout/login.
- Banner hanya membawa admin ke pemeriksaan invoice. Tombol Tutup tidak menolak
  bukti atau mengubah statusnya; tidak ada jalur pelunasan langsung dari notifikasi.

## Retry terpisah dari task operasional berat

Migrasi **210** hanya menambah kolom lease dan fungsi antrean/status/scheduler.
Tidak mengubah transaksi historis, invoice, pembayaran, atau status media lama.

Klaim media atomik menggunakan `FOR UPDATE SKIP LOCKED`, token lease, dan masa
lease lima menit. Media baru diberikan waktu dua menit untuk pemrosesan webhook
awal. Media yang belum diamankan dari URL Fonnte didahulukan. Worker lama tidak
dapat menimpa hasil worker pemilik lease yang baru.

Satu media per invocation menjaga beban serverless tetap terbatas. Maksimal tiga
percobaan, jeda retry 15 lalu 30 menit. Lease kedaluwarsa dapat dipulihkan termasuk
crash pada percobaan terakhir; bila file sudah aman tetapi AI gagal, kandidat
review manual tetap disimpan. Upsert tidak membuka kembali CONFIRMED/DISMISSED.

Pemicu utama: Supabase `pg_cron` + `pg_net`, setiap 15 menit, 24 jam. Kunci internal
disimpan di Vault dan dibaca ketika fungsi dispatcher berjalan, bukan ditulis ke
perintah cron, GitHub, frontend, atau output konfigurasi. Pemicu GitHub terpisah
dan tick Vercel menjadi cadangan; jadwal GitHub sendiri tidak dijadikan jaminan
ketepatan interval. Antrean kosong tidak memanggil AI.

Urutan rilis:

1. Jalankan test unit, PostgreSQL/WASM, build, dan smoke UI tanpa data produksi.
2. `scripts/configure-payment-worker.mjs --check` (read-only).
3. Dengan persetujuan Owner, `--migrate` menerapkan hanya migrasi 210 dan
   memeriksa fingerprint invoice, ledger, order, suggestion, dan antrean.
4. Deploy kode yang sesuai dan pastikan endpoint status dapat dibaca Owner/Admin.
5. `--schedule` mengaktifkan pemicu utama setelah backend siap; `pg_net` dipasang
   bila belum tersedia. Script tidak menjalankan worker atau mengirim WA sendiri.
6. Periksa heartbeat worker pada jadwal berikutnya. Kunci yang dirotasi pada
   Vercel juga harus diperbarui di Vault melalui `--schedule`.

Script memakai `pg` sebagai dependensi operasional; `ACLEAN_PG_MODULE` dapat menunjuk
ke instalasi lokal yang sudah tersedia. Koneksi diambil dari `.env.local`, tidak
boleh di-commit atau dicetak. Mode bawaan `--check` tidak mengubah produksi.

## Pemeriksaan admin

Panel **Bukti Pembayaran WA** pada Invoice menampilkan heartbeat retry, jumlah
antrean, media belum aman, kegagalan, dan tautan rincian. Endpoint bersifat
read-only, tanpa cache, hanya Owner/Admin atau server internal. Detail dibatasi
50 baris; jumlah ringkasan tetap exact. Gagal membaca status tidak dianggap sehat.

Worker yang tidak sukses 45 menit atau antrean menunggu lebih dari 30 menit
ditandai. Watchdog harian/petang dapat mengirim alarm hanya ke Owner, dibatasi
sekali per enam jam. Gangguan Supabase/Vercel sendiri tetap memerlukan monitoring
di luar keduanya; mekanisme ini bukan jaminan ketersediaan tanpa batas.

Media lama berstatus FAILED_PERMANENT tidak dihapus/dibuka kembali otomatis.
Periksa arsip WA untuk memastikan apakah benar bukti bayar. Jika file memang
hilang, unggah ulang melalui Lampirkan Bukti pada invoice yang benar. Jangan
mengubah UNPAID hanya karena screenshot ada atau nomor cocok.
