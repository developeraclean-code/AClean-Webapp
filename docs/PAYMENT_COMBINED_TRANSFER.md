# Transfer gabungan unit AC dan instalasi

Disiapkan 4 November 2026. Migrasi `229_reviewed_combined_transfer.sql` telah
diterapkan ke database produksi pada 4 November 2026 sekitar 18.50 WIB.
Verifikasi baca ulang: kolom dan RPC tersedia, dua trigger aktif, dan belum
ada pembayaran historis dengan metadata alokasi baru. Migrasi hanya menambah
kolom audit, penjaga perubahan, dan RPC; tidak melunasi invoice otomatis.
Status deployment aplikasi harus diperiksa terpisah pada Coolify.

## Kapan dipakai

Pakai pada bukti WhatsApp yang jelas membayar **unit AC sekaligus instalasi**,
sedangkan invoice yang dipilih hanya menagih instalasi. Owner/Admin membuka
bukti, mencocokkan customer dan rincian penjualan unit AC, lalu mencentang
persetujuan dan menulis catatan minimal 10 karakter yang menyebut penjualan
terkait. Perbedaan nominal besar saja bukan bukti pembayaran milik customer.

Contoh dari layar Owner: bukti Rp8.574.000 untuk invoice Rp3.456.000.
Alokasi dan ledger invoice ini Rp3.456.000; kelebihan Rp5.118.000 tersimpan
di `invoice_payments.combined_transfer_detail.unallocated_amount`, **bukan**
ditambahkan ke pendapatan invoice instalasi, bukan potongan PPh, dan tidak
dibuat sebagai pembayaran penjualan AC secara otomatis. Finance perlu
rekonsiliasi penjualan AC dan sisa transfer tersebut secara terpisah. Satu
bukti yang sudah ditautkan tidak bisa dipakai lagi untuk invoice lain melalui
alur ini.

## Batas dan keamanan

- Transfer harus **lebih besar** dari sisa tagihan. Transfer yang kurang tetap
  mengikuti cicilan atau tinjauan PPh 2–3% yang lama; tidak ada toleransi umum
  ±5% untuk otomatis melunasi.
- Pemeriksaan hanya tersedia untuk Owner/Admin. Snapshot invoice, bukti,
  nominal, status, bukti yang pernah dipakai, order batal, saldo ledger, dan
  tanggal diverifikasi ulang di RPC dalam satu transaksi.
- ID permintaan tetap untuk retry; respons hilang tidak menambah pembayaran
  kedua. Bila migrasi/RPC tidak tersedia, klien gagal tertutup.
- Setelah alokasi, perubahan/revert/delete biasa pada invoice atau entri
  pembayarannya ditolak. Koreksi membutuhkan alur pembalikan berjejak yang
  belum disediakan; jangan mengubah data langsung untuk melewati penjaga ini.
- Kelebihan adalah angka audit, **bukan piutang baru, refund, atau penerimaan
  kas tambahan** pada laporan invoice. Tim Finance harus memutuskan dan
  mendokumentasikan perlakuan penjualan AC berdasarkan transaksi sebenarnya.

## Verifikasi sebelum rilis

1. Terapkan migrasi 229 pada database yang sesuai sebelum deploy kode.
2. Jalankan `node scripts/test-payment-combined-transfer-db.mjs`, `npm test`,
   `npm run lint`, `npm run typecheck`, `npm run build`, dan
   `npm run check:migrations` pada kode yang sama.
3. Di staging, uji bukti transfer > invoice yang benar-benar mencakup AC +
   instalasi. Pastikan tombol menampilkan **alokasi invoice**, invoice menjadi
   PAID tepat sekali, dan kelebihannya terlihat pada catatan audit.
4. Coba bukti yang salah, kurang bayar, dan bukti yang sama untuk invoice
   berbeda; semuanya harus ditolak tanpa status PAID baru.

Jangan jalankan migrasi produksi atau deploy hanya karena dokumen ini ada;
ikuti persetujuan dan pemeriksaan runtime yang berlaku saat rilis.
