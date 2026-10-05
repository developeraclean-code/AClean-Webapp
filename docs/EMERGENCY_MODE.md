# Mode darurat Supabase 24 jam (MVP lokal)

Mode ini adalah **buku kerja sementara di satu browser Owner**, bukan failover Supabase. Tidak ada migrasi database, write ke Supabase, sinkronisasi otomatis, invoice otomatis, perubahan stok, status PAID, atau WA otomatis. Jangan menganggap entri darurat sebagai data resmi sampai direkonsiliasi.

## Sebelum gangguan

1. Saat Supabase normal, Owner login dan buka **🚨 Mode Darurat** di sidebar (ikon 🚨 pada mobile).
2. Pilih **Siapkan perangkat**, buat frasa sandi minimal 12 karakter, dan simpan di tempat aman yang hanya Owner bisa akses.
3. Gunakan browser/profil yang sama selama insiden. Jangan hapus storage browser. Persiapkan folder lokal terpisah untuk foto dan bukti bayar; mode ini hanya mencatat nama/referensi file.
4. Siapkan jalur komunikasi manual/file transfer (misalnya WA) untuk mengirim paket tugas ke teknisi dan menerima paket laporan. Aktivasi tidak menyebar ke perangkat teknisi.

## Ketika Supabase tidak tersedia

1. Owner klik **Mode Darurat**. Jika sesi sudah tidak bisa dipulihkan, di layar login pilih **Aktifkan perangkat darurat yang telah disiapkan Owner**.
2. Masukkan alasan gangguan dan frasa sandi, centang pernyataan Owner, lalu klik **Aktifkan**. Kredensial lokal ini adalah satu-satunya verifikasi yang tersedia saat server mati. Jangan bagikan frasa sandi ke tim.
3. Aplikasi utama berhenti tampil selama insiden aktif. Catat order lebih dulu. Pada baris order, pilih **Unduh paket tugas teknisi**, lalu kirim file JSON tersebut hanya ke teknisi terkait. File tugas berisi data customer dan kunci akses order; perlakukan sebagai data rahasia.
4. Teknisi membuka `/field-emergency` di perangkatnya, mengimpor paket tugas, mengisi teknisi/helper, unit **aktual**, pekerjaan, material, temuan, dan foto. Draft serta foto tersimpan lokal di perangkat teknisi. Setelah selesai, unduh paket laporan terenkripsi dan kirim file itu ke Owner. File dapat diunduh ulang dengan ID yang sama untuk retry; jangan hapus draft sampai Owner mengonfirmasi penerimaan.
5. Owner memilih file pada **Terima laporan teknisi**. Sistem memastikan file cocok dengan kunci paket tugas dan menolak ID laporan yang sudah pernah diimpor. Foto tetap di dalam file laporan terenkripsi yang diterima Owner; nama/jumlah foto dicatat di vault, tetapi foto asli **tidak** masuk arsip vault. Simpan file laporan terpisah secara privat.
6. Penerimaan pembayaran dan material dapat dicatat Owner dengan mengacu ke ID order darurat. Keduanya belum mengubah invoice atau saldo stok.
7. Pembayaran hanya ditandai sebagai *perlu verifikasi*. Bukti transfer tetap disimpan terpisah dan tidak boleh otomatis menyatakan invoice lunas.
8. Secara berkala unduh **arsip terenkripsi** sebagai cadangan ke lokasi aman. Ekspor CSV adalah data terbuka/PII dan hanya untuk rekonsiliasi; jangan kirim tanpa perlindungan.

## Setelah Supabase pulih

1. Owner membuka arsip darurat di perangkat yang sama. Cocokkan order dan laporan dengan entri permanen. Periksa kemungkinan pekerjaan sudah tercatat lewat kanal lain agar tidak duplikat.
2. Cocokkan pembayaran dengan mutasi bank, bukti, invoice, dan jumlah terutang. Masukkan material melalui alur stok normal setelah cek saldo fisik dan histori. Jangan impor CSV langsung secara buta.
3. Isi ID data permanen dan catatan pemeriksaan untuk **setiap** baris, baru tandai cocok. Unduh arsip terenkripsi terakhir, kemudian tutup insiden. Data lokal tidak dihapus otomatis.

## Batasan keselamatan

- Hanya satu perangkat/browser Owner yang menjadi sumber catatan utama. Teknisi boleh mengisi draft di perangkat sendiri **hanya setelah menerima file tugas**. Tidak ada sinkronisasi antarperangkat; perpindahan file tetap manual. Jika perangkat Owner hilang/rusak, hanya ekspor terenkripsi dan frasa sandi yang mungkin menyelamatkan data; pemulihan dari file ekspor ke UI **belum tersedia**.
- Paket tugas adalah akses berbasis kepemilikan file, bukan verifikasi identitas teknisi dari Supabase. Siapa pun yang mendapat file tugas dapat mengirim laporan untuk order tersebut. Owner harus mencocokkan nama pekerja, waktu, isi pekerjaan, dan foto sebelum rekonsiliasi.
- Draft/foto di perangkat teknisi tidak terenkripsi oleh frasa sandi Owner. Gunakan perangkat yang terkunci dan jangan hapus data browser. Paket laporan yang diekspor terenkripsi, tetapi backup vault Owner **tidak memuat foto**; simpan file laporan terenkripsi terpisah.
- Untuk saat ini satu instalasi browser menyimpan satu insiden. Setelah penutupan, arsip tetap tersimpan dan tidak ditimpa oleh insiden baru. Rotasi/restore arsip memerlukan implementasi lanjutan.
- Jika perangkat belum disiapkan sebelum Supabase mati, sistem **tidak dapat** memverifikasi Owner atau mengaktifkan mode secara aman. Gunakan formulir operasional manual di luar aplikasi sampai server pulih.
- Enkripsi AES-GCM/PBKDF2 melindungi isi dalam penyimpanan browser, tetapi tidak melindungi dari orang yang memegang perangkat terbuka dan mengetahui frasa sandi. Jangan gunakan browser bersama.
- Ini tidak memberi jaminan operasi penuh 24 jam: kapasitas localStorage dan ketersediaan Vercel/browser tetap menjadi batas. Uji dan latihan berkala diperlukan.
- Jalur teknisi `/field-emergency` tetap perlu halaman webapps dari Vercel dapat dibuka; ini dirancang untuk **Supabase mati**, bukan seluruh internet/Vercel mati. Jika Vercel juga tidak tersedia dan halaman belum terbuka, gunakan formulir kertas/WA sampai pulih.
