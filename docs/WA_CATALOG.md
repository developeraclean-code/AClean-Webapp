# Katalog gambar WhatsApp AClean

Katalog WA menyimpan metadata di `wa_catalog_items` (Supabase) dan foto di R2 dengan prefix permanen `catalog/`. Prefix ini tidak cocok dengan aturan hapus berumur pada `ops/r2-lifecycle.json` ataupun tugas cleanup R2 aplikasi. Jangan taruh foto katalog di `wa-images/`, `wa-inbox/`, atau folder sementara lain.

## Aktivasi

1. `migrations/198_wa_catalog.sql` sudah diterapkan pada Supabase produksi 9 Oktober 2026 setelah prasyarat migrasi 197 diverifikasi. Migrasi menambah tabel, RLS, jenis `CATALOG` pada outbox, serta audit gambar dalam `wa_messages`. Untuk lingkungan lain, terapkan migrasi 197 lalu 198 secara berurutan.
2. Pastikan upload R2 yang sudah dipakai aplikasi berfungsi dan server memiliki `R2_CDN_URL` (diutamakan) atau `R2_PUBLIC_URL` berupa domain HTTPS publik. Gambar harus dapat diakses dengan `HEAD` oleh server dan Fonnte tanpa login. `VITE_R2_CDN_URL` hanya mengatur pratinjau browser; server tetap membutuhkan variabel tanpa awalan `VITE_`.
3. Owner membuka **Katalog WA**, mengunggah JPG/PNG/WebP maksimum 2,5 MB, mengisi nama dan deskripsi, lalu memilih sumber harga: tanpa harga, harga tetap, Price List jasa, harga unit AC, atau harga AC termasuk pemasangan. Batas ini menjaga unggahan base64 tetap ringan pada jalur API biasa. Admin bisa melihat katalog dan mengirim item aktif, tetapi hanya Owner yang bisa mengubahnya.
4. Di WhatsApp Workspace, pilih chat → **Balasan cepat → Katalog** → item → periksa foto/caption → tulis pengantar jika perlu → **Kirim**. Pengiriman tetap memerlukan tindakan admin; memilih item tidak langsung menghubungi pelanggan.

Server mengambil ulang item aktif dan harga sumber saat tombol Kirim ditekan, menyusun caption, memeriksa akses URL foto, lalu mengirim satu request Fonnte berisi `url` dan `message`. Status `FAILED` atau `UNCERTAIN` tetap mengikuti outbox dengan ID pengiriman yang sama, sehingga tidak ada fallback otomatis yang berisiko mengirim ganda. Gambar dari luar tabel katalog dan URL media dari browser ditolak.

Jika foto memuat harga tercetak, harga pada gambar harus diperbarui manual saat berubah; angka dalam caption mengikuti data harga terbaru. Pengiriman gambar memakai layanan/kuota Fonnte sesuai paket akun. Sebelum digunakan di produksi, uji satu item pada nomor internal untuk memeriksa hasil media di ponsel penerima.
