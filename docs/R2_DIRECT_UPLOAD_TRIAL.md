# Trial Direct Upload Cloudflare R2

Direct upload mengirim byte foto/PDF langsung dari browser ke R2 memakai presigned
URL lima menit. API Vercel hanya menandatangani metadata kecil. Bila direct PUT gagal,
webapp otomatis memakai upload base64 lama agar pekerjaan teknisi tidak terhenti.
Fitur tetap nonaktif sampai environment `VITE_R2_DIRECT_UPLOAD=true` dipasang.

## CORS bucket R2

Cloudflare Dashboard → R2 → `aclean-files` → Settings → CORS Policy:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://a-clean-webapp.vercel.app"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Tambahkan custom domain production AClean ke `AllowedOrigins` bila digunakan. Origin
harus sama persis dan tidak memakai trailing slash.

## Trial

1. Jalankan webapp dan buka DevTools → Network.
2. Upload satu foto laporan kecil.
3. Harus terlihat POST `/api/upload-foto` berukuran kecil dengan respons
   `direct: true`, lalu PUT langsung ke `r2.cloudflarestorage.com`.
4. Pastikan foto bisa dibuka, laporan disubmit, dan edit laporan menampilkan foto.
5. Uji dari ponsel teknisi serta koneksi seluler.

Untuk rollback tanpa mengubah kode, set `VITE_R2_DIRECT_UPLOAD=false` lalu rebuild.
Jalur base64 lama tetap tersedia selama masa trial.
