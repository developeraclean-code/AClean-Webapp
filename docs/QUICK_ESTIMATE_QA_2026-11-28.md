# Estimasi Cepat — verifikasi lokal 28 November 2026

Cakupan: Invoice → Quotation → Estimasi Cepat (Owner/Admin), mode pemasangan/bongkar-pasang, pergantian pipa + item manual, Sparepart manual, dan Jasa Lain manual untuk ducting/pekerjaan lainnya. Semua simulasi browser memakai fixture fiktif `preview/quick-estimate/`, supabase=null. Test menolak dan mencatat kegagalan untuk setiap request API atau host selain localhost. Tidak ada mutasi bisnis/produksi, commit, push, atau deploy.

## Temuan dan koreksi

- Implementasi awal mengambil harga dari hasil indeks web dan halaman paket berbeda. Verifikasi HTML/JS asli https://aclean.id/estimasi dan pembacaan publik `get_website_pricing` 28 November menemukan perbedaan. Kode lokal sekarang mengikuti tarif small/large: pasang 400/450 ribu; bongkar 150/200 ribu ditambah pasang kembali indoor+outdoor 400 ribu; kabel 35/45 ribu per meter; freon 2,5 PK 1 juta / kuras 1,15 juta. Paket bongkar/renovasi yang tidak ada pada kalkulator referensi dihapus. Pipa 3 PK tetap tersedia pada pergantian pipa; kalkulator pasang maksimal 2,5 PK seperti referensi.
- Freon dapat dicentang bersamaan mengikuti perilaku referensi. Material pergantian pipa/manual tidak dikalikan jumlah AC; jumlah AC hanya mengalikan jasa dasar.
- Contoh default aktual: pasang baru 1 PK Rp1.395.000; pergantian pipa Rp960.000. Angka lama Rp1.370.000/Rp940.000 berasal dari harga fallback/index lama.
- PDF item panjang sebelumnya terpotong antarhalaman. Baris sekarang utuh; header, nomor halaman, footer berulang, judul ketentuan ikut paragraf pertama. Label total Sparepart diperbaiki menjadi TOTAL PENAWARAN.
- Ekspor JPEG sekarang berukuran 1800 px lebar dari layout 900 px, konsisten desktop/mobile. Tabel lebar dapat digeser di layar kecil; seluruh tabel diekspor. Form material memakai grid responsif.
- Jasa Lain berada di samping Sparepart dan memakai item manual yang sama: nama pekerjaan (misalnya ducting), jumlah, satuan, harga satuan, serta ketentuan/catatan bebas. Masing-masing mode menyimpan draft terpisah selama halaman terbuka; reset mengosongkan keduanya. Total hanya jumlah × harga satuan item valid, tanpa tarif dasar otomatis. PDF/JPEG berjudul Penawaran Jasa Lain dan menampilkan TOTAL PENAWARAN.

## Bukti pengujian

- 8 tes Vitest PASS pada `src/lib/__tests__/quickEstimate.test.js`. Salah satunya membandingkan 2.304 kombinasi terhadap fungsi calcGroup asli dari HTML referensi dengan snapshot harga RPC publik: 3 tier × 3 jumlah unit × 2 jenis pekerjaan × 32 kombinasi material × 4 pilihan freon.
- 14 tes Playwright PASS (7 desktop + 7 Pixel 7 emulation) pada `e2e/quick-estimate.spec.js`: Owner/Admin dan penolakan empat role lain/role dicabut, kabel auto/manual, banyak tipe, item manual/pecahan/negatif/gratis, ekspor kosong/incomplete diblokir, pergantian mode/reset, tarif tier besar, freon bersamaan, layout ponsel, serta ducting Jasa Lain dengan catatan terpisah.
- Sepuluh PDF dan sepuluh JPEG benar-benar diunduh untuk instalasi, pipa+manual, Sparepart, Jasa Lain, dan 30 item panjang pada desktop/mobile. Signature file diperiksa; seluruh JPEG berlebar 1800 px.
- Delapan PDF dirender menggunakan PDFKit macOS dan teks diekstrak. Isi desktop/mobile identik; total sesuai tampilan: 1.395.000 / 1.035.000 (pipa + 75.000 manual) / 700.000 / 970.000. Semua 30 item dan ketentuan manual ada. Dokumen panjang 4 halaman. Render halaman ditinjau visual setelah koreksi pagination.
- PDF Jasa Lain desktop tambahan dirender dan ditinjau visual; teks memuat Ducting galvanis 2,5 m × Rp120.000 = Rp300.000, ketentuan dua baris, serta label TOTAL PENAWARAN. JPEG desktop juga ditinjau visual tanpa pemotongan. Ekspor mobile berukuran sama dan lulus pemeriksaan signature.
- ESLint file fitur dan tes PASS; Vite production build PASS (4,46 detik, peringatan impor dinamis/statis yang sudah ada); git diff --check PASS.

## Menjalankan ulang

Node ARM/universal yang berfungsi adalah `/usr/local/bin/node`; Node default NVM x86_64 tidak berjalan pada sandbox ARM64 ini.

```sh
/usr/local/bin/node node_modules/vitest/vitest.mjs run src/lib/__tests__/quickEstimate.test.js
/usr/local/bin/node node_modules/@playwright/test/cli.js test --config e2e/quick-estimate.config.js
/usr/local/bin/node node_modules/vite/bin/vite.js build
```

Playwright membutuhkan Vite lokal aktif di 127.0.0.1:5173; macOS sandbox mungkin memerlukan izin menjalankan Chromium. Pengujian memakai konfigurasi khusus tanpa kredensial E2E atau konfigurasi tes produksi.

## Batas bukti

- Harga lokal merupakan snapshot publik 28 November, belum disinkronkan otomatis apabila website mengubah tarifnya.
- Cakupan ini adalah penawaran cepat dan dokumen keluarannya. Tidak mengesahkan alur invoice resmi → pembayaran → PAID, integrasi database, pengiriman WhatsApp, atau deployment produksi.
- Browser yang diuji Chromium desktop dan emulasi Pixel 7, bukan perangkat fisik/Safari/iOS. Skenario panjang 30 item; bukan jaminan jumlah teks/baris tak terbatas.
- Draft berada dalam state halaman; muat ulang/unmount menghapus isian. Fitur ini tidak menyimpan quotation resmi.
- Contoh keluaran fiktif yang ditinjau saat verifikasi lokal disimpan di `/private/tmp/aclean-estimate-qa/`; PDF/JPEG tersebut tidak menjadi bagian dari rilis kode.
