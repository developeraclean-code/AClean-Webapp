# Alert kesehatan Supabase (monitor di luar Supabase)

Gunakan layanan uptime eksternal yang sudah mengirim email `/api/health is down`.
Jangan menjadwalkan monitor utama dengan `pg_cron`: saat database tidak bisa menerima
koneksi, job tersebut juga gagal dan tidak dapat mengirim alert.

Setelah versi ini ter-deploy, buat monitor HTTP GET berikut pada layanan uptime itu.
Set tujuan email ke alamat notifikasi yang dikonfirmasi Owner; beri nama seperti tabel agar
subjek email langsung menunjukkan jalur yang terdampak.

| Nama monitor | URL | Makna HTTP 503 / tidak terjangkau |
| --- | --- | --- |
| AClean - Aplikasi Coolify | `https://app.aclean.id/api/health?component=app` | Jalur menuju aplikasi tidak terjangkau. Endpoint ini tidak memanggil Supabase. |
| AClean - Supabase Auth | `https://app.aclean.id/api/health?component=auth` | `GET /auth/v1/health` tidak merespons sehat lewat gateway. Tidak menguji login dengan kata sandi. |
| AClean - Supabase Database API | `https://app.aclean.id/api/health?component=database` | Pembacaan kecil `agent_logs` melalui PostgREST gagal; penyebabnya dapat berupa gateway, PostgREST, koneksi, atau PostgreSQL. |

Monitor lama `/api/health` tetap berfungsi sebagai pemeriksaan gabungan Auth +
Database API. Agar tidak menerima empat email untuk satu insiden, setelah ketiga
monitor baru berhasil dites, jadikan monitor gabungan hanya untuk dashboard atau
nonaktifkan notifikasi emailnya. Jangan hapus monitor lama sebelum penggantinya
terbukti mengirim email.

Atur interval 1–5 menit sesuai paket layanan dan alert setelah 2 kegagalan
berturut-turut, beserta notifikasi ketika pulih. Jangan email untuk setiap HTTP
error individual: saat database macet, ratusan request dapat gagal sekaligus dan
menimbulkan spam. Batas waktu per probe aplikasi adalah 3 detik, dan hasilnya
dicache paling lama 15 detik per instance function.

Respons JSON `/api/health` menyertakan `diagnosis`:

- `database_api_or_postgrest`: Auth sehat, pembacaan database gagal.
- `auth_service`: pembacaan database sehat, Auth health gagal.
- `shared_gateway_or_network`: kedua jalur gagal; tidak dapat memastikan apakah
  akar masalahnya gateway, jaringan, atau dependensi database bersama.
- `configuration`: URL/kunci probe tidak lengkap.
- `none`: kedua probe sehat.

Klasifikasi ini menunjukkan **jalur yang gagal**, bukan penyebab host yang pasti.
Untuk mengetahui alasan restart, OOM, limit koneksi, atau gangguan pooler pada
VPS self-hosted, periksa metrik VPS, Docker, PostgreSQL, dan proxy.
Email baru aktif setelah monitor eksternal dan alamat penerimanya dikonfigurasi;
perubahan kode saja tidak mengirim email.

## Pemeriksaan dan perbaikan 13 November 2026

Akun UptimeRobot terhubung dengan izin Owner. Monitor existing 803163682 masih
mengarah ke Vercel lama dan berstatus DOWN. Owner mengizinkan perubahan URL ke
`https://app.aclean.id/api/health`; read-back menunjukkan **UP/HTTP200**, interval
300 detik, contact ID 8464743 tetap sama. Riwayat downtime lama tidak direset.
Nama sekarang `AClean - Aplikasi dan Supabase`.

Yang aktif adalah **satu monitor gabungan**; tabel tiga endpoint di atas adalah
opsi pemisahan diagnosis, bukan klaim tiga monitor baru sudah dibuat. Ketiga
endpoint tetap HTTP200 sesudah deployment e91b6c6. Tidak mematikan produksi
untuk membuat alarm percobaan, dan tidak mengklaim delivery email inbox hanya
dari konfigurasi penerima.

Bukti: [receipt produksi](../deliverables/voucher-hardening-2026-11-12/production-monitoring-receipts.json).
