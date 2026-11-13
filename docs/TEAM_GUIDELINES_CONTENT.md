# Teks dan gambar Tata Tertib — 13 November 2026

Owner/Admin dapat menambah, mengedit, dan menghapus poin berupa teks, gambar,
atau keduanya pada Tata Tertib, Tugas & Kewajiban, Jobdesk, serta panduan SOP
tambahan. Tugas/Jobdesk tetap terpisah untuk Teknisi dan Helper; poster SOP
bawaan tetap tersedia. Peran lain membaca sesuai akses menu yang sudah ada.

Cara memakai: tekan **+ Tambah Poin / Gambar**, tulis teks dan/atau pilih
**+ Tambah Gambar**, lalu **Simpan Poin**. Maksimal empat gambar per poin,
masing-masing berkas sumber maksimal 15 MB. Gambar didekode dan dikompres
menjadi JPEG dengan helper gambar dokumen yang sudah dipakai aplikasi.
Gunakan edit untuk menghapus atau mengganti gambar. Klik gambar pada daftar
untuk membuka ukuran penuh.

Tidak ada migrasi atau perubahan RLS. Skema, grant, dan policy produksi dibaca
secara read-only pada 13 November: `team_guidelines.content` bertipe text,
RLS aktif, baca melalui `tg_select`, tulis Owner/Admin melalui `tg_admin_all`
berdasarkan `get_my_role()`. Perubahan ini tidak memperluas hak akses tersebut.

Konten lama tetap berupa teks biasa. Gambar diserialisasi sebagai baris Markdown
khusus `![Gambar tata tertib](/api/foto?key=...)` pada kolom content yang sama.
Renderer hanya mengenali key `foto/team-guidelines/<20 digit hash hex>.jpg`.
HTML, URL luar, data URI, atau referensi media pembayaran tidak dirender menjadi
gambar. Tidak ada renderer HTML/Markdown umum. Tampilan editor menyembunyikan
format penyimpanan ini dan menyediakan textarea serta pratinjau gambar.

Upload memakai `_apiFetch` → `/api/upload-foto` → R2 yang sudah ada; pembacaan
memakai `/api/foto` dan prefix `foto/` yang sudah didukung. Berkas diunggah saat
dipilih; poin baru diterbitkan setelah simpan DB berhasil dan mengembalikan baris.
Membatalkan editor/menghapus lampiran hanya melepaskan referensi dari poin,
tidak menghapus objek R2 secara fisik. Tidak ada kebijakan pembersihan bucket
baru atau perubahan jalur media pembayaran.

Selama upload/simpan, tab dan tindakan lain dikunci. Kegagalan upload/simpan
terlihat dan tidak mengklaim berhasil. Jika hasil simpan tidak terkonfirmasi,
tombol simpan dikunci dan pengguna diminta memuat ulang daftar sebelum
mengirim ulang, untuk menghindari duplikasi akibat respons terputus.

## Verifikasi

- Unit: kompatibilitas teks lama, serialisasi gambar, penolakan URL berbahaya.
- Browser lokal: komponen React dan Supabase client nyata, PostgreSQL/WASM
  sementara dengan migrasi 128 dan RLS yang ada. Handler upload nyata dipanggil
  dengan HTTP R2 diintersep dalam proses; tidak ada upload eksternal.
- Skenario: teks/gambar/mixed, edit/hapus, reload, kegagalan upload/simpan,
  respons simpan terputus, scope Teknisi/Helper, SOP, baca staf dan penolakan
  tulis RLS, retry baca, batas/deduplikasi gambar, serta tampilan mobile.
- Lint, typecheck, suite unit, build, dan pemeriksaan penomoran migrasi.

Bukti berada di `deliverables/team-guidelines-2026-11-13/`. Jalankan ulang
browser dari root repo dengan `node scripts/test-team-guidelines-browser.mjs`.
Tes tidak membaca `.env` dan tidak menulis data produksi.

Push/merge GitHub tidak mengubah pin deployment Coolify. Fitur ini memerlukan
deployment versi baru sebelum muncul di produksi. Tidak ada migrasi, perubahan
env, atau pengaktifan otomasi voucer yang diperlukan untuk fitur ini.
