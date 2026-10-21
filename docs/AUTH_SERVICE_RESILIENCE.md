# Login dan App Token saat Supabase bermasalah

Perbaikan 21 Oktober 2026 memisahkan penolakan sesi dari gangguan layanan. Ini
mengurangi amplifikasi permintaan; **tidak membuat Supabase yang offline menjadi online**.
Tidak ada migrasi, perubahan akun/password, pelonggaran role atau koreksi transaksi.

## Backend

- `/api/get-api-token` tetap memverifikasi Supabase user, lalu profil aktif dengan ID
  yang sama. Role hanya Owner/Admin/Finance/Teknisi/Helper dari database, bukan request.
  Profil tidak tersedia/nonaktif atau role tidak valid ditolak 403. Tidak ada fallback
  token Helper saat query profil gagal.
- Auth/profil 429, 5xx, respons malformed, jaringan dan timeout → 503 dengan kode
  `AUTH_SERVICE_UNAVAILABLE` dan `Retry-After`. Auth 401/403 tetap penolakan akses.
  Masing-masing pembacaan dibatasi 4 detik, termasuk pembacaan body; respons no-store.
- Middleware Bearer menggunakan pemeriksaan bounded yang sama. App Token bertanda
  tangan yang masih valid tetap diverifikasi lokal; token palsu/kedaluwarsa tidak
  mendapat bypass. Jalur secret server-to-server lama tidak diubah.

## Frontend

- Satu proses pertukaran App Token per tab/akun untuk caller bersamaan. Memori saja,
  tidak ditambahkan ke localStorage. Pergantian akun/logout membatalkan hasil terlambat
  agar token akun sebelumnya tidak dipakai kembali.
- Batas seluruh pertukaran 10 detik. Gagal → jeda 15/30/60/120 detik; `Retry-After`
  dihormati sampai 120 detik. Tidak melakukan refresh Supabase setelah 503/429.
  Hanya 401 definitif boleh memicu satu refresh sesi dan satu pertukaran ulang.
- Token yang sudah diterbitkan boleh digunakan saat refresh proaktif gagal, hanya
  sebelum masa berlaku sebenarnya habis. Penolakan 401/403 menghapus token itu.
- Request bisnis ditahan bila token tidak tersedia. GET/HEAD boleh mencoba satu kali
  setelah token ditolak; POST/PATCH/DELETE/upload/pembayaran/kirim WA tidak otomatis
  diulang. Periksa hasil transaksi sebelum mengulang aksi secara manual.
- Transport Auth SDK juga dibatasi 10 detik (header + body) dan jeda saat jaringan,
  429 atau 5xx gagal. Password salah yang nyata tetap dihitung oleh pengaman login;
  gangguan layanan tidak dihitung sebagai password salah. Circuit ini per tab,
  bukan pembatas global seluruh pengguna/worker.

## Verifikasi dan batasan

Tes mencakup 200 caller serentak, cooldown/pemulihan, API/Supabase SDK, pergantian
akun, hak semua lima role, profile failure, respons terhenti, dan larangan replay
mutasi. Pengurangan 200 caller → satu exchange adalah hasil skenario lokal itu,
bukan klaim penurunan seluruh beban database sebesar 99,5%.

Saat project `Unhealthy / Database not usable / CONNECT_TIMEOUT`, simpan waktu dan
metrik CPU/swap/IO/koneksi, batasi klik ulang, lalu telusuri query/lock/cron setelah
pulih. Restart/upgrade bukan bagian dari deploy ini dan tidak dijalankan otomatis.
Jika status global normal tetapi project tetap tidak responsif, eskalasi ke support
dengan project ref dan waktu WIB/UTC. Jangan menonaktifkan CORS atau reset password
hanya karena gateway tidak menyertakan header pada respons gagal.
