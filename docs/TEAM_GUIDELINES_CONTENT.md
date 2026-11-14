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

Rilis teks/gambar 13 November tidak memakai migrasi atau perubahan RLS. Skema, grant, dan policy produksi dibaca
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

Push/merge GitHub tidak otomatis mengubah pin deployment Coolify. Tidak ada
migrasi atau pengaktifan otomasi voucer yang diperlukan untuk fitur ini.

## Penerimaan produksi — 14 November 2026, 09.30 WIB

Produksi ditemukan sudah menjalankan `8d032cc`, hasil merge PR18 yang mencakup
fitur Tata Tertib PR17. Source tersebut dipertahankan, termasuk perbaikan antrean
bukti pembayaran. Metadata `ACLEAN_BUILD_SHA` masih 18c6103; nilainya disamakan
dengan source 8d032cc dan source yang sama dibangun ulang melalui Coolify.
Deployment `11shkgasuxf6ffcede2qobgw` Finished pada 09.29 WIB, container Healthy.
Auto-deploy dan preview tetap OFF; tidak ada migrasi atau mutasi bisnis.

Browser Owner produksi lulus membuka menu Tata Tertib, form tambah teks/gambar,
menguji draft lokal + batal dan memeriksa tambahan SOP. Nol error JavaScript,
nol request WA atau mutasi bisnis tidak terduga, serta tidak ada overflow mobile.
Health App/Auth/Database HTTP200 versi 8d032cc. Sentry frontend dikonfigurasi
untuk production dengan release 8d032cc yang sesuai; pemeriksaan ini membaca
konfigurasi SDK, bukan mengirim event atau menguji email alert.

Constraint tabel aktual hanya primary key, dan authenticated memiliki USAGE
sequence untuk INSERT. Tidak dibuat poin atau upload gambar percobaan produksi;
uji penyimpanan/RLS dan upload sintetis tetap berdasarkan 15 alur lokal di atas.
Bukti: `production-browser-20261114.json` dan `production-runtime-20261114.json`
pada folder deliverables yang sama.

## Kategori panduan SOP tambahan — 14 November 2026

Panduan SOP tambahan kini mempunyai kategori saat Owner/Admin menambah atau
mengedit poin: Umum, Cleaning, Cek Unit, Test Press, dan Program & Promo.
Daftar di bawah poster SOP dikelompokkan menurut kategori dan dapat difilter.
Poster SOP bawaan tetap memiliki pilihan sendiri. Kategori tidak ditampilkan
di tab Tata Tertib, Tugas & Kewajiban, atau Jobdesk.

Migrasi 245 menambah kolom `team_guidelines.category` dengan default `umum`
dan constraint nilai. Konten teks, referensi gambar, role scope,
dan policy RLS tidak berubah. Satu panduan SOP lama yang berjudul "Bonus Program"
dipindahkan ke kategori Program & Promo; baris lama lain tetap di Umum. Saat
poin dipindah kategori melalui edit, urutannya ditempatkan di akhir kategori
tujuan. Tidak ada objek R2 yang dipindah atau dihapus.

Verifikasi lokal: lint, typecheck, unit, build, pemeriksaan migrasi, serta
fixture browser/SQL `scripts/test-team-guidelines-browser.mjs` untuk tambah,
edit, filter, reload, backfill Bonus Program, RLS dan tampilan mobile.
Hasilnya di `deliverables/team-guidelines-2026-11-13/browser-results.json`;
pratinjau mobile ada di `sop-categories-mobile.png` pada folder yang sama.
Status produksi fitur kategori harus diverifikasi terpisah setelah migrasi dan
deployment; catatan penerimaan sebelumnya hanya untuk fitur teks/gambar.
