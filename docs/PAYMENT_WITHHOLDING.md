# Pembayaran finance dan potongan PPh estimasi

Deployment memerlukan migrasi `212_reviewed_payment_withholding.sql`
dan koreksi format snapshot `213_payment_withholding_snapshot.sql`
sebelum kode ini di-deploy. Tidak ada persetujuan otomatis, perubahan harga,
atau pelunasan invoice produksi saat migrasi diterapkan.

## Alur admin

1. Di Invoice → Pending AI, pilih kandidat atau cari nama/ID invoice secara manual.
2. Klik **Periksa & Link Pembayaran**. Jalur ini memakai modal Lampirkan Bukti
   yang sama dengan daftar invoice, bukan jalur pembayaran kedua.
3. Buka bukti. Bila nomor finance berbeda, konfirmasi bahwa pengirim membayar
   invoice/customer yang dipilih. Nomor master customer tidak diganti dan tidak
   dibuat alias pembayaran tepercaya secara otomatis.
4. Bila transfer berbeda dari sisa tagihan, sistem menampilkan transfer, sisa,
   selisih, dasar jasa dan persentasenya. Admin dapat menyetujui potongan bila
   selisih masuk **2–3% dari nilai jasa** (bukan total material + jasa).
   Rentang ini adalah kebijakan toleransi Owner, **bukan tarif PPh baru**.
5. Konfirmasi potongan, periksa tanggal transfer, dan isi catatan minimal 10
   karakter. Tidak ada pemilihan/centang otomatis yang melunasi invoice.

Contoh sintetis berdasarkan skenario PT ONE 3:

- Invoice Rp2.950.000; dasar jasa Rp2.350.000; material Rp600.000.
- Transfer Rp2.902.500; selisih Rp47.500 = sekitar 2,021% dari jasa.
- Ledger kas menyimpan Rp2.902.500; kredit nonkas menyimpan Rp47.500 terpisah.
- Total invoice tetap Rp2.950.000; piutang nol; status PAID setelah konfirmasi.
- Label: **potongan PPh estimasi; bukti potong belum diverifikasi**.

## Integritas dan batasan

- Tarif/perhitungan/PDF PPh gross-up 2% yang sudah ada tidak diubah. Invoice
  gross-up ditolak untuk potongan tambahan: `total` sudah merupakan transfer neto.
- Di luar rentang: tidak boleh dipaksa PAID. Gunakan Catat Pembayaran sebagai
  cicilan, atau periksa/koreksi rincian invoice lebih dulu.
- RPC baru memeriksa role, snapshot invoice, bukti dan pemakaian sebelumnya;
  perubahan ledger, kredit, invoice, job, dan status bukti dilakukan atomik.
- UUID permintaan tetap untuk retry. Payload berbeda atau media yang telah
  dipakai tidak boleh mencatat uang kedua kali. Gagal migrasi tidak memiliki
  fallback update langsung.
- `invoice_payments.amount` selalu kas. `withheld_amount` adalah kredit nonkas.
  `invoices.paid_amount` mencerminkan total penyelesaian piutang (kas + kredit).
  Finance memakai `finance_cash_events` yang mengecualikan kredit nonkas,
  termasuk dari jalur fallback ledger lama. CSV memisahkan kedua nilai.
- Metadata menyimpan pengirim, nomor customer, pemeriksa, dasar jasa, tanggal,
  rasio, alasan dan snapshot. Tidak ada klaim bukti potong telah sah/terverifikasi.
- **Revert/Edit/Delete biasa untuk invoice yang telah memakai kredit ini
  diblokir secara eksplisit**, termasuk browser versi lama. Pembalikan kredit
  dan verifikasi bukti potong membutuhkan alur audit tersendiri; belum disediakan
  pada perubahan ini. Nilai kredit tidak boleh hilang lewat reset status biasa.

## Uji lokal

- Unit/regresi: `node node_modules/vitest/vitest.mjs run`.
- SQL isolated: `node scripts/test-payment-withholding-db.mjs` (PGlite; dapat
  menggunakan `WA_PGLITE_MODULE` untuk lokasi instalasi terpisah).
- Preview sintetis: `/preview/payment-withholding/index.html` pada Vite lokal.
- Browser desktop/mobile: `node scripts/smoke-payment-withholding.mjs`.
- Preview dan simulasi tidak memakai data produksi, AI berbayar atau Fonnte.
- Smoke browser memakai enam item yang tersimpan sebagai teks JSON di
  PostgreSQL dan sudah menjadi array di model baca browser, seperti alur App.
  RPC yang dijalankan adalah fungsi SQL asli pada database PGlite terisolasi,
  bukan mock respons sukses. Test mereproduksi penolakan versi 212, menerapkan
  migrasi 213, memastikan perubahan isi tetap ditolak, lalu memverifikasi satu
  pencatatan kas + kredit yang benar serta retry tanpa pembayaran ganda.

## Koreksi snapshot (migrasi 213)

`materials_detail` dibandingkan sebagai isi JSON yang sama, baik input berupa
teks dari database maupun array hasil parser browser. Spasi dan urutan key
objek tidak dianggap perubahan; urutan item, item duplikat, harga, jumlah,
tipe nilai, nominal, status dan identitas bukti tidak diabaikan. Nilai kosong
dinormalisasi ke daftar kosong; JSON rusak/non-array ditolak secara eksplisit.

Normalisasi juga berlaku pada pembandingan request retry dari browser lama,
tanpa menulis ulang data permintaan yang telah tercatat. Migrasi 212 yang sudah
diterapkan tidak diubah; migrasi 213 hanya memperbaiki dua pembandingan di RPC.
