# Setup: Google Sheets → Order Masuk (prototipe)

Script: [`scripts/sheets-sync-run.mjs`](../scripts/sheets-sync-run.mjs). Baca jadwal dari
Google Sheet dan buat order baru (status `PENDING`, `source=sheet_import`) yang muncul
di Order Masuk / Planning Order untuk direview seperti order manual biasa.

## 1. Buat Service Account (sekali saja)

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat project baru (atau pakai yang sudah ada).
2. **APIs & Services → Library** → cari "Google Sheets API" → Enable.
3. **APIs & Services → Credentials → Create Credentials → Service Account**.
   - Nama bebas, misal `aclean-sheets-sync`.
   - Tidak perlu kasih role IAM apa pun (akses diatur lewat sharing Sheet, bukan IAM).
4. Buka service account yang baru dibuat → tab **Keys** → **Add Key → Create new key → JSON**.
   File JSON akan terdownload — isinya ada `client_email` dan `private_key`.

## 2. Share Sheet ke Service Account

1. Buat Google Sheet baru, nama sheet (tab) di dalamnya: **`Jadwal`**.
2. Baris 1 = header (boleh isi label apa saja, tidak dibaca script — kolom dibaca
   berdasarkan posisi A–J, bukan nama header). Baris 2 dst = data.
3. Klik **Share** di Sheet → tempel `client_email` dari file JSON tadi → kasih akses
   **Viewer** (cukup, script hanya baca) → Send.
4. Ambil Sheet ID dari URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

## 3. Isi `.env.local`

```
GOOGLE_SA_EMAIL=<client_email dari JSON>
GOOGLE_SA_PRIVATE_KEY="<private_key dari JSON, dengan \n literal — jangan ganti newline asli>"
GOOGLE_SHEET_ID=<SHEET_ID dari URL>
GOOGLE_SHEET_RANGE=Jadwal!A2:J1000
```

`private_key` di file JSON sudah dalam format `"-----BEGIN PRIVATE KEY-----\nxxxx\n-----END..."`
— copy-paste persis termasuk `\n` literalnya, script otomatis convert ke newline asli.

## 4. Format kolom Sheet (tab "Jadwal", mulai baris 2)

| Kolom | Isi | Wajib? |
|---|---|---|
| A | Tanggal (`2026-06-22` atau `22/06/2026`) | wajib |
| B | Jam (`9` atau `09:00`) | opsional (default 09:00) |
| C | Teknisi | wajib |
| D | Helper | opsional |
| E | Customer | wajib |
| F | Telepon | opsional |
| G | Alamat | opsional |
| H | Jenis Servis (`Cleaning`/`Install`/`Repair`/`Complain`/`Survey`/`Project`) | opsional (default `Repair` kalau kosong/tidak cocok) |
| I | Detail Pekerjaan (teks bebas, masuk ke field `type`) | opsional |
| J | Catatan | opsional |

## 5. Jalankan

```bash
# Cek dulu hasil parsing TANPA menyimpan apa pun:
node --env-file=.env.local scripts/sheets-sync-run.mjs --dry-run

# Kalau hasil dry-run sudah benar, jalankan sungguhan:
node --env-file=.env.local scripts/sheets-sync-run.mjs
```

Setiap baris yang sudah diimport dicatat di tabel `sheet_schedule_imports`
(hash per-baris) — aman dijalankan berkali-kali, baris yang sama tidak dobel-insert.
Kalau isi baris di Sheet diedit setelah diimport, baris itu dianggap baris baru
(hash berubah) dan akan diimport lagi sebagai order baru — ini prototipe, belum
ada logic update-in-place.
