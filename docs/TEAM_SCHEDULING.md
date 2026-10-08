# Jadwal Team dan pop-up planning

Migrasi 193–194 diterapkan dan diverifikasi pada Supabase produksi pada 5 Oktober 2026 (WIB). Frontend/backend tersedia dalam commit rilis ini; preview lokal tetap memakai data simulasi.

## Alur operasional

- **WhatsApp → Jadwalkan/Reorder** membuka pop-up di atas percakapan. Draf belum menjadi job sampai **Simpan planning** berhasil.
- Pilih lokasi pelanggan terlebih dahulu bila nomor dipakai beberapa lokasi. Nama, nomor, alamat, layanan, dan unit diteruskan ke pop-up.
- Pilih tanggal, Team (opsional), jam mulai dan selesai. Estimasi akhir memakai skema durasi Planning yang sama: Cleaning bertingkat per unit, Install maksimal 8 jam, Repair 1,5 jam/unit dibulatkan, Complain minimal 30 menit.
- **Jam disarankan** menampilkan hingga empat rentang bebas per Team, memperhitungkan pekerjaan aktif, anggota bersama antar-Team, durasi dan batas 6 job. Slot malam memakai Team berawalan `Malam`.
- Status **Tentatif** disimpan sebagai `PENDING`; **Pelanggan terkonfirmasi** sebagai `CONFIRMED`. Team/anggota belum tersedia tidak membatalkan konfirmasi pelanggan.
- Penyimpanan berhasil memberi pilihan **Lihat di Jadwal** atau kembali ke percakapan. Tidak ada WA dispatch otomatis.
- **Buka Planning Order** tetap tersedia untuk pengaturan anggota dan pekerjaan lanjutan/maintenance. Form lama mengikuti preset Team yang sama dan mengizinkan planning untuk Team yang belum diisi anggota.

## Tampilan Jadwal

Kalender mingguan Owner/Admin menggunakan **Team × tanggal**, bukan nama teknisi sebagai baris. Jumlah Team mengikuti `team_presets`: delapan preset berarti Team 01–08. Menambah preset akan menambah pilihan/baris setelah muat ulang. Team lama yang masih memiliki job/roster pada minggu tersebut tetap terlihat agar data tidak hilang. Slot Maintenance mengikuti aturan yang sama. Team Malam dan pekerjaan mulai 18:00 ke atas dikelola melalui Planning Order, tanpa ditampilkan pada kalender Team ini.

Grid jam harian **09:00–19:00** tampil di atas perencanaan mingguan. Setiap sel mingguan menampilkan anggota dari `daily_team_slots` hari itu (T/H), kartu pelanggan, rentang mulai–selesai, status konfirmasi, dan ringkasan jam kecil. Klik tanggal di kalender bawah memilih tanggal lalu kembali ke grid jam di atas. Tombol **◀ / ▶** di samping tanggal berpindah satu hari dan otomatis menggeser minggu jika melewati Minggu/Senin. Batang pekerjaan dibatasi pada area jam tersebut; data jam asli tetap utuh. Bila jam selesai belum tersimpan, tampilkan estimasi durasi yang sama dengan planning. Pekerjaan tanpa Team masuk baris **Belum ada tim**; pekerjaan dibatalkan tersembunyi dari tampilan default tetapi tersedia lewat filter. Nama teknisi tetap tersedia dalam List Pekerjaan dan tampilan petugas; alur laporan, invoice, dan report card dipertahankan.

Penanda **Perlu pengganti** berasal dari `technician_availability` (SAKIT/IJIN/ALPA/OFF atau `is_available=false`). Roster kosong ditandai **Anggota belum diisi**. Penanda ini tidak mengubah status pelanggan. Anggota roster kosong eksplisit tidak diisi ulang dari anggota job lama. Jika belum ada baris roster, personel yang tersimpan pada job menjadi informasi cadangan.

Data jadwal/roster/preset dibaca ulang setiap 30 detik saat tab terlihat dan melalui **Muat ulang**. Jika pembacaan gagal, jadwal lama ditandai belum diperbarui dan penambahan slot ditahan. Pencarian dan filter laporan juga berlaku pada kalender baru.

## Reschedule dan integritas

Klik kartu untuk mengubah tanggal/jam/Team atau membatalkan pekerjaan, dengan alasan perubahan. RPC `save_schedule_plan` mempertahankan ID job dan identitas pelanggan/site. Ketika pindah hari, anggota diambil dari roster tanggal tujuan; jika kosong, personel lama dibersihkan. Reservasi `technician_schedule` lama dilepas dan reservasi baru ditulis dalam satu transaksi. Job DISPATCHED dikembalikan ke status konfirmasi yang dipilih dan penanda dispatch dilepas; admin tetap harus mengkomunikasikan perubahan kepada tim/pelanggan.

Job yang sedang dikerjakan, sudah selesai, dibatalkan, atau merupakan project tidak dapat diubah melalui pop-up ini; gunakan alur operasional terkait. Pembuatan job baru juga tidak mengubah `customers.last_service`, karena rencana mendatang belum merupakan servis selesai.

RPC melakukan validasi Owner/Admin, tanggal/jam, Team, lokasi pelanggan, benturan Team/anggota, dan limit job; perubahan bersamaan dibandingkan dengan snapshot saat pop-up dibuka. Request ID membuat retry tidak menggandakan job. Hasil jaringan belum pasti mengunci form dan menawarkan **Periksa penyimpanan** dengan request ID yang sama. Bukti sebelum/sesudah dan alasan disimpan dalam `operational_mutations` (`operation=SCHEDULE_PLAN`); audit trigger orders yang sudah ada tetap berjalan. Tidak ada fallback insert jika RPC belum tersedia.

Penguncian Team berlaku bagi pemanggil RPC ini. Jalur lama yang menulis orders langsung masih memerlukan audit staging untuk konsistensi benturan/reservasi lintas semua jalur. Pengujian PostgreSQL lokal memakai satu engine PGlite; bukan simulasi koneksi Supabase konkuren.

## Penerapan dan pengujian

Terapkan **migrasi 194** sebelum frontend baru. Prasyaratnya schema orders/customers/maintenance_clients, roster hingga member8, team_presets, operational_mutations (177), dan fungsi/constraint reservasi teknisi (070/121 dan perbaikan sesudahnya). Migrasi 194 sudah diterapkan bersama migrasi 193 pada 5 Oktober 2026; jangan menjalankan ulang migrasi 193. Fitur WhatsApp operasional sebelumnya tetap memerlukan migrasi 193.

```sh
npm run preview:wa
npm test
npm run lint
npm run build
npx playwright test -c e2e/wa-workspace.config.js
WA_PGLITE_MODULE=/private/tmp/aclean-wa-dbcheck/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-team-planning-db.mjs
```

PGlite 0.5.8 dapat dipasang terpisah dengan `npm install --prefix /private/tmp/aclean-wa-dbcheck --no-save @electric-sql/pglite@0.5.8`. Pada Mac ini gunakan `/usr/local/bin/node` jika Node nvm gagal dijalankan.

Preview **http://127.0.0.1:4174** tidak membaca `.env`, tidak terhubung Supabase/Fonnte, dan hanya menyimpan data dalam memori browser. Coba Andi untuk beberapa lokasi; tutup WhatsApp lalu buka **Jadwal Tim** untuk contoh roster/absensi. Sebelum penerapan nyata, periksa schema staging, hak akses, reschedule lintas jalur lama, roster kosong/absen, dan riwayat audit.

### Simulasi drag lokal

Buka **http://127.0.0.1:4174/?view=jadwal**, klik tanggal pekerjaan contoh yang disebut di bagian atas halaman, lalu seret blok pada grid jam ke posisi jam atau baris Team lain. Posisi dibulatkan per 30 menit dan durasi pekerjaan dipertahankan. Contoh: Ibu Ratna pada Team 01 pukul 09:00–11:00 diseret ke Team 02 pukul 11:00–13:00. Pop-up Planning menampilkan sebelum → sesudah dan alasan yang ikut berubah bila jam disunting lagi. **Simpan perubahan** memakai job yang sama; klik **Lihat di Jadwal**, lalu **Planning Order** untuk membandingkan datanya. **Batal** tidak mengubah job, sementara slot bentrok, anggota absen, dan jam reguler lewat 18:00 ditolak. Pekerjaan yang sudah berjalan/selesai dan project tidak dapat diseret. Ini masih simulasi lokal dan belum diterapkan ke produksi.

Hasil pengujian commit WA/Jadwal: 811 unit test dalam 87 file, 24 pengujian browser WhatsApp/Team, dan 13 kelompok kontrak PostgreSQL planning lulus. Build produksi, lint src, typecheck, dan pemeriksaan diff lulus. Smoke test localhost memverifikasi pop-up → simpan Team 08 tanpa anggota → kalender, tanpa error JavaScript atau permintaan eksternal. Schema produksi juga diverifikasi langsung: customer ID teks, jam bertipe time, roster, trigger statistik, dan reservasi. Uji transaksi Owner/Admin/Teknisi sebelum/sesudah migrasi lulus dengan rollback: planning, benturan, retry, reschedule, pembatalan, pembayaran parsial dan outbox. Tidak ada data uji tersisa atau pesan gateway yang dikirim; konkurensi lintas jalur lama belum diuji.
