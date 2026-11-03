# Tautan portal pelanggan tetap — 3 November 2026

## Kontrak

- Setiap nomor telepon pelanggan yang sudah dinormalisasi memakai satu token portal reguler yang sama untuk invoice, dispatch, pengingat servis, rating, dan voucher.
- Tautan kanonik berbentuk `https://status.aclean.id/status/<token>`. Tautan lama di `app.aclean.id/status/<token>` tetap diarahkan ke host status ketika `STATUS_PORTAL_REDIRECT_READY=true`.
- Token reguler dengan `expires_at IS NULL` tidak kedaluwarsa. Token yang sudah kedaluwarsa sebelum migrasi 227 tetap tidak berlaku; pembuatan tautan berikutnya menggantinya. Token yang masih aktif saat migrasi tetap sama dan diubah menjadi permanen.
- Token dapat dicabut dengan mengisi `revoked_at`. Portal, foto, voucher, dan rating menolak token yang dicabut. Pembuatan tautan berikutnya membuat token baru; tautan lama tidak dapat dipakai lagi.
- Invoice WhatsApp tetap dikirim apabila pembuatan tautan portal gagal. UI dan log agen menandai kegagalan tautan tersebut; petugas perlu mengirim ulang tautan setelah layanan pulih.

## Rilis

1. Periksa tabel produksi `customer_tokens`: tidak ada dua baris dengan `phone` yang sama. Pada pemeriksaan baca-saja 3 November, ada 677 baris dan 677 nomor unik setelah normalisasi. Ulangi pemeriksaan tepat sebelum migrasi.
2. Backup R2 terenkripsi produksi `8cbb1bd2` berhasil dibuat dan `restic check` lulus pada 3 November 07.47 WIB. Migrasi `227_permanent_customer_portal_token.sql` sudah diterapkan pada database produksi dan staging: kolom `revoked_at` serta indeks unik per nomor tersedia.
3. Sebelum kode baru aktif, 310 token produksi yang masih berlaku dikembalikan **sementara** ke `expires_at = now() + interval '30 days'` agar kode lama tetap dapat membacanya. Nilai token tidak diubah; 367 token yang sudah kedaluwarsa tetap kedaluwarsa. Jangan menganggap token produksi sudah permanen pada fase ini.
4. Deploy staging commit `e334572` dan verifikasi: portal, foto, serta URL `status.aclean.id/status/`. Smoke test dengan token dummy pada 3 November menunjukkan image sehat, halaman portal dan pembatasan host berfungsi; uji foto/customer nyata belum dilakukan.
5. Deploy kode baru ke production dan verifikasi health, portal, serta foto. **Baru setelah kode production baru aktif**, terapkan migrasi `228_finalize_permanent_customer_portal_token.sql` untuk membuat seluruh token yang masih berlaku permanen. Migrasi 228 tidak menghidupkan token yang telah kedaluwarsa atau dicabut. Verifikasi jumlah token aktif `expires_at IS NULL` dan bahwa token tidak berubah.
6. Uji alur invoice WhatsApp, portal, foto, dan fallback saat tautan gagal. Jangan menyimpulkan tes lokal sebagai bukti produksi.

## Pencabutan darurat

Admin database dapat mencabut satu token dengan `UPDATE public.customer_tokens SET revoked_at = now() WHERE phone = '<nomor kanonik>';` setelah memverifikasi nomor yang benar. Jangan mencetak token atau memasukkannya ke log. Pembuatan tautan berikutnya menghasilkan token baru. Tautan tetap bersifat rahasia karena siapa pun yang memilikinya dapat melihat riwayat servis pelanggan.

## Performa

Portal pelanggan kini memuat bundle staff hanya bila membuka aplikasi internal. Host portal juga tidak mengirim referensi manifest PWA staff, sehingga browser tidak meminta manifest yang dialihkan ke domain perusahaan dan memunculkan kesalahan CORS. Tiap foto masih memerlukan pemeriksaan akses pada server sebelum R2; jumlah foto yang banyak tetap bergantung pada respons database, R2, dan koneksi pelanggan.
