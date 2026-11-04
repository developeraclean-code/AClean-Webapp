# Foto bukti pembayaran tidak tampil, 4 November 2026

## Bukti pemeriksaan

- Browser Owner menampilkan `ERR_CERT_AUTHORITY_INVALID` saat memuat gambar `pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/wa-inbox/...` pada Payment Suggestion.
- Resolver DNS jaringan pemeriksa mengembalikan CNAME `internetpositif.ioh.co.id` dan alamat `114.7.173.245/246`. Sertifikat yang diterima memiliki CN `*.ioh.co.id`, sehingga tidak cocok dengan host `r2.dev`.
- Resolver `1.1.1.1` dan Cloudflare DoH mengembalikan `104.18.54.45` dan `104.18.50.34`. Permintaan HTTPS yang diarahkan ke salah satu alamat itu berhasil memvalidasi TLS dan mendapat HTTP 404 untuk root bucket (root bukan objek).
- `https://app.aclean.id/api/health` merespons 200. Proxy `/api/foto` untuk key dummy merespons 404, bukan 503. Pemeriksaan ini tidak membuktikan apakah setiap objek bukti masih ada; key objek asli belum diuji.

## Dampak dan perbaikan lokal

Saat ini `VITE_R2_CDN_URL` menghasilkan URL `r2.dev` untuk pratinjau. Error DNS/TLS dapat memicu pesan "berkas tidak tersedia" meskipun kegagalannya terjadi sebelum permintaan mencapai R2. `fotoUrl()` kini mengarahkan semua foto R2 ke proxy `/api/foto` pada origin aplikasi bila CDN yang dikonfigurasi adalah subdomain `r2.dev`. Custom domain R2 tetap memakai CDN langsung. Pesan pada `PaymentEvidencePreview` juga tidak lagi menyatakan berkas hilang hanya karena gambar gagal dimuat. Perubahan ini tidak mengubah penyimpanan objek, pencocokan invoice, atau status pembayaran. Proxy menaikkan lalu lintas data pada VPS sampai custom domain media siap.

Untuk penggunaan R2 publik jangka panjang, Cloudflare menganjurkan custom domain dan menyatakan `r2.dev` hanya untuk pengujian. Migrasi domain media adalah pekerjaan terpisah setelah DNS/hosting domain diverifikasi.
