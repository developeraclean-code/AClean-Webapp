# Audit integritas dan monitoring — peningkatan 218

Rilis 218: migrasi diterapkan 18 Oktober 2026; konfigurasi alert khusus profil
Owner aktif dipilih sesuai persetujuan. Validasi deploy kode wajib memeriksa status
Vercel READY dan versi `/api/health` yang sama dengan commit main, bukan HTTP 200 saja.
Nomor tertinggi produksi yang diverifikasi: 218.

## Perilaku

- Alert operasional tetap memerlukan kedua toggle ON, profil `Owner` aktif dan
  nomor valid. `ops_alert_owner_id` dapat memilih ID Owner khusus alert audit/kuota;
  jika belum dipilih, nomor environment tetap harus cocok dengan satu Owner aktif.
  Tidak ada fallback sembarang nomor, tidak mengubah `OWNER_PHONE` global atau
  profil karyawan. Owner menyetujui penggunaan profil Owner aktif untuk kedua alert ini.
- Policy `app_settings` produksi lama mengizinkan semua authenticated menulis.
  Migrasi 218 menambah trigger hanya untuk key `ops_alert_owner_id`: insert,
  update, rename dan delete dilindungi Owner/service; nilai harus Owner aktif.
  Policy dan key lain tidak diubah.
- Registry penerima juga dijaga: role lain tidak boleh mengubah ID, nomor atau status
  aktif profil Owner. Pembaruan kehadiran/profil non-Owner tetap mengikuti perilaku
  lama. Ini mencegah pengalihan alert lewat edit kontak, bukan hanya lewat key setting.
- Snapshot audit membedakan hasil data dan hasil alert. Gagal WA tetap tercatat
  FAILED, tetapi temuan yang berhasil dihitung tetap tersedia.
- Tiap temuan memiliki label Indonesia dan tombol **Tinjau data**. Detail read-only
  berisi perusahaan/customer, ID invoice/job/unit dan konteks, maksimal 25 per halaman.
  Tersedia navigasi ke invoice, pekerjaan, perusahaan/daftar unit dan inventori.
  Filter tanggal/status lama direset saat membuka invoice/job agar data tidak tersembunyi.
- RPC `get_operational_integrity_details_218` hanya untuk Owner/service. Admin,
  Finance, Teknisi, Helper dan anon ditolak. Enam belas jenis cek dibatasi whitelist,
  pagination 1–50 dan urutan stabil. JSON/UUID tidak valid menjadi temuan, bukan crash.
- Tidak ada koreksi transaksi, penghapusan aset atau approval otomatis. Interval PM
  yang memang belum ditentukan tetap informasi saja.
- Scan R2 mempertahankan cursor halaman sah bila halaman berikutnya timeout/503.
  Angka parsial tidak menjadi total; error tetap terlihat. Snapshot lama, tanggal
  rusak/future atau R2 gagal tidak dianggap hijau, termasuk format snapshot lama.

## Pemeriksaan produksi tanpa rilis kode

Scan kuota selesai lewat worker lokal dengan lease/toggle/audit produksi yang sama;
tidak mengubah transaksi. Snapshot 18 Oktober 2026 17.57 WIB: R2 4.551.212.207 byte,
30.791 objek, 42,4% dari batas estimasi 10 GiB; database 181.841.043 byte (34,7%).
Listing R2 bukan snapshot billing atomik; upload/delete selama scan dapat mengubah angka.
Ini tidak mengubah lifecycle bucket. Izin lifecycle masih perlu ditangani terpisah.

## Verifikasi dan rilis

Jalankan unit tests, lint, typecheck, build, `scripts/test-cron-recovery-db.mjs`
dan Playwright `e2e/cron-recovery.config.js`. SQL menguji kecocokan 16 detail dengan
agregat audit, 200 job sintetis, data >1.000 baris, idempotensi, penolakan role lain
dan serangan rename/delete pada key tujuan alert dengan grant legacy.

Hasil 18 Oktober 2026: 1.436 unit test/125 file, lint, typecheck dan build lulus;
13 kontrak PostgreSQL lokal lulus; smoke test Chromium desktop/mobile 2/2 lulus.
Rehearsal produksi (rollback) membuktikan 16 hitungan detail cocok dengan agregat,
Owner dapat membaca/mengatur tujuan, empat role lain ditolak termasuk perubahan
kontak/ID/status aktif Owner. Migrasi/config kemudian diterapkan; fingerprint 16
tabel bisnis/profil, setting lain dan jadwal cron tidak berubah. Tidak ada WA uji
yang dikirim oleh skrip migrasi.

Urutan rilis: konfirmasi tujuan Owner → terapkan 218 → pilih `ops_alert_owner_id`
terverifikasi (ketiganya selesai) → deploy kode → periksa status audit/alert dan kuota.
Jangan menerapkan konfigurasi ke nomor lain atau memicu WA uji tanpa konfirmasi tujuan.
Jangan mengubah business rows hanya untuk menghilangkan peringatan audit.
