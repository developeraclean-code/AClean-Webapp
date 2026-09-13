# Trial Lokal — Monitoring dan Biaya (Opsi 1–8)

Dokumen ini adalah checklist verifikasi sebelum dan sesudah rollout. Kode kompatibel saat
migration 168 belum aktif karena otomatis memakai jalur fallback lama.

> Penting: aplikasi localhost masih memakai data Supabase operasional. Membuka, mencari,
> memfilter, dan berpindah halaman aman. Tombol Simpan, Approve, Reject, Hapus, Pulihkan,
> Tautkan Stok, dan Simpan Budget tetap mengubah data live. Jangan gunakan tombol tersebut
> selama trial read-only.

## Cakupan opsi 1–8

1. Monitoring memakai snapshot agregat yang exact dan menampilkan error dependency.
2. Cron `RUNNING` lebih dari satu jam ditandai `TIMEOUT`; status macet terlihat di Overview.
3. Cron, AI Cost, dan Audit Log memakai agregasi/paginasi server agar hasil tidak terpotong.
4. Biaya dimuat per bulan dan per halaman; total/filter dihitung server-side.
5. Validasi input dan peringatan transaksi mirip diperketat tanpa menghapus transaksi sah.
6. Biaya Admin mulai Rp500.000 wajib menunggu approval Owner/Finance.
7. Asal input, identitas pembuat, antrean AI, dan hubungan audit disimpan lebih jelas.
8. Pembelian material wajib punya status alokasi; tautan nota-ke-stok menjadi satu transaksi,
   dan budget disimpan per bulan.

## Tahap A — uji kompatibilitas sebelum migration 168

1. Jalankan aplikasi dan buka `http://127.0.0.1:3000`.
2. Login sebagai Owner.
3. Buka **Monitoring**.
4. Pastikan Overview selesai loading dan status Healthy/Degraded/Unhealthy terlihat.
5. Buka tab **Cron Jobs**, **AI Cost**, dan **Audit Log**. Coba filter Audit Log dan Next/Prev.
6. Buka **Biaya**. Pastikan default tanggal adalah awal–akhir bulan berjalan.
7. Coba tab Petty Cash, Pembelian Material, Pending AI, dan Dihapus tanpa melakukan aksi tulis.
8. Coba pencarian, filter bulan, pagination, serta export CSV/PDF.

Pada tahap ini UI otomatis memakai fallback lama karena RPC migration 168 belum ada. Ini
memastikan deployment kode lebih dahulu tidak membuat Monitoring/Biaya blank.

## Tahap B — uji penuh setelah migration 168 diterapkan

Lakukan hanya setelah backup/checkpoint dan persetujuan Owner. Migration yang dipakai:
`migrations/168_monitoring_expense_hardening.sql`.

Checklist read-only setelah migration:

- Monitoring Overview memiliki bagian **Needs Action**.
- Label Cron menunjukkan 7 hari dan AI Usage menunjukkan 30 hari.
- Audit Log menunjukkan total exact dan pagination server.
- Biaya menampilkan teks `server-side` di jumlah transaksi.
- Banner pending approval, kemungkinan duplikat, legacy tanpa reviewer, dan material belum
  dialokasi muncul bila datanya ada.
- Filter/pencarian/pagination tidak mengubah total secara keliru.

Checklist write terkontrol (gunakan satu data trial yang mudah dibatalkan):

1. Admin input biaya Rp499.999: tersimpan APPROVED.
2. Admin input biaya Rp500.000: masuk PENDING_APPROVAL dan belum masuk total.
3. Admin tidak dapat menyetujui biaya pending tersebut.
4. Owner/Finance dapat approve atau reject; reject masuk recycle bin.
5. Input transaksi manual yang mirip menampilkan warning tetapi tetap dapat disimpan bila sah.
6. Material dapat ditandai untuk Job, Non-stok/langsung dipakai, atau ditautkan ke Stok.
7. Saat tautkan stok, stok, HPP, ledger, dan penanda nota berubah bersama serta tidak bisa
   ditautkan dua kali.
8. Owner membuat budget bulan ini; budget bulan berikutnya tidak ikut berubah.

Setelah tiap data trial selesai, hapus secara normal ke recycle bin. Jangan purge permanen
sampai hasil audit dipastikan benar.

## Gerbang sebelum push ke main

- Unit test dan build lulus.
- Smoke test Monitoring dan Biaya lulus.
- Migration checker serta `git diff --check` lulus.
- Tidak ada error merah pada browser console/network untuk `/api/monitor`, RPC Monitoring,
  atau RPC Biaya.
- Satu siklus input → review → total → alokasi stok tervalidasi oleh Owner.
