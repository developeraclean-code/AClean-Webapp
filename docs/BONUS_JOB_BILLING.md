# Dasar bonus per pekerjaan

Bonus berasal dari nilai dan item milik Job ID masing-masing, bukan total invoice
bersama yang disalin ke beberapa job. Dua job yang benar-benar berbeda tetap
dapat menerima bonus. Nama customer bukan kunci deduplikasi.

## Sumber yang dipakai

- Job biasa: invoice milik job tersebut.
- Team split: `team_invoice_parts` masing-masing job (migrasi 179).
- Konsolidasi manual: invoice asli yang memiliki `job_id` jelas, melalui penanda
  `[Digabung ke ...]`. Sumber yang masih ditautkan ke order tetap dapat dibaca
  walaupun invoice asli sudah CANCELLED.
- Peer di luar bulan tampilan juga dibaca, termasuk order lain dalam grup.

Alokasi harus mencakup seluruh job. Jumlah/nama item sumber harus sesuai dengan
invoice akhir. Dua sumber yang sama-sama mengklaim satu kapasitor, padahal invoice
akhir hanya menagih satu, tidak boleh menghasilkan deteksi bonus otomatis.

## Diskon atau revisi invoice gabungan

Nilai job disesuaikan proporsional terhadap nilai sumber dan dibulatkan dengan
largest remainder sampai sen. Jumlah alokasi tetap tepat sama dengan total
invoice terakhir. UI memberi keterangan bahwa alokasi mengalami penyesuaian.

Contoh: job A Rp1.200.000 dan job B Rp1.800.000, kemudian invoice akhir menjadi
Rp2.700.000. Dasar omset A Rp1.080.000 dan B Rp1.620.000, bukan Rp2.700.000 untuk
masing-masing job. HPP dihitung dari material job masing-masing; diskon tidak
mengurangi harga beli material.

## Data yang belum bisa dipisahkan

Invoice legacy tanpa billing part/sumber yang jelas masuk **Tinjau Dasar Invoice**.
Bonus margin/item tidak diisi otomatis dan tidak boleh menggunakan total gabungan.
Owner/Admin masih dapat mencatat **Bonus Manual**, dengan alasan yang diverifikasi.
Jika rincian invoice/sumber diperbaiki, klik Refresh sebelum menghitung ulang.

Rekap menampilkan **Belum dipisah**, bukan Rp0 palsu. Invoice bersama yang belum
bisa dialokasikan dihitung satu kali pada ringkasan nilai transaksi job berbonus.
CSV dan cetak memuat peringatan yang sama. Nominal, penerima, dan status PAID bonus
lama tidak diubah secara otomatis; anomali lama tetap perlu pemeriksaan Owner.

## Guard penyimpanan

Sebelum insert, aplikasi membaca ulang job, invoice, peer, dan setting bonus.
Preview yang berubah dibatalkan. Omset tidak dapat diganti dengan total gabungan.
HPP auto yang berubah juga meminta perhitungan ulang. Query yang gagal tidak
dianggap data kosong atau biaya nol. Double-click dikunci dan index unik
`(order_id, bonus_type)` tetap menjaga retry antar-browser untuk kategori sama.
Migrasi 205 menambah index unik lintas seluruh tingkat margin, sehingga dua admin
yang memilih tingkat berbeda untuk job yang sama juga tidak dapat memakai dasar
margin dua kali. Bila sudah ada anomali historis, migrasi berhenti tanpa mengubahnya.
Kegagalan sebagian insert ditampilkan sebagai hasil sebagian, bukan sukses penuh.

Bonus pemasangan unit per tim/hari tetap memakai aturan tersendiri, tidak
diturunkan dari total invoice gabungan. Bonus Manual merupakan keputusan admin
yang perlu alasan, bukan alokasi invoice otomatis.

Pemisahan memakai tabel billing part dari migrasi 179. Terapkan migrasi 205 sebelum
rilis untuk guard satu bonus margin aktif per job di database.
Tests: `bonusBilling.test.js` (termasuk simulasi 200 job), `bonusBillingIO.test.js`,
tes rekap, dan smoke browser lokal dengan database simulasi tanpa write produksi.
