# AClean — Modul Maintenance B2B

Dokumen ini berisi rekap fitur, marketing copy, dan cara kerja teknis modul Maintenance korporat AClean.
Terakhir diperbarui: 2026-06-04 · Commit: c0aaf11

---

## 1. Marketing Copy — Prompt Website

> **Kelola Aset AC Perusahaan Anda Lebih Efisien dengan AClean Maintenance**
>
> AClean hadir dengan solusi manajemen maintenance AC korporat yang lengkap — dari registrasi aset,
> jadwal perawatan, laporan teknisi, hingga portal akses eksklusif untuk klien Anda.

### Keunggulan

**✅ Registrasi Aset Digital**
Semua unit AC terdaftar lengkap: kode, lokasi, brand, kapasitas, jenis refrigerant, dan status kondisi real-time.

**✅ Jadwal PM Otomatis**
Sistem menghitung otomatis jadwal Preventive Maintenance berikutnya berdasarkan interval yang Anda tentukan (1–24 bulan). Tidak ada unit yang terlewat.

**✅ Riwayat Servis Lengkap + Foto**
Setiap pekerjaan tercatat: teknisi, tanggal, jenis servis, bahan yang digunakan, biaya, dan foto dokumentasi kondisi unit.

**✅ Portal Customer Eksklusif**
Klien mendapat link permanen untuk melihat aset dan riwayat servis mereka kapan saja, dari mana saja — tanpa perlu login, cukup scan QR.

**✅ QR Code per Unit**
Tempel QR di setiap unit AC. Teknisi atau staf gedung scan → langsung lihat riwayat unit tersebut.

**✅ Invoice B2B Terintegrasi**
Rekap semua servis yang belum dibayar → buat invoice dalam satu klik → ikuti alur approve & pembayaran standar AClean.

**✅ Quotation Digital**
Kirim penawaran harga langsung via WhatsApp dengan PDF terlampir, pantau status DRAFT → SENT → APPROVED.

**✅ Statistik & Laporan**
Lihat biaya per bulan, unit mana paling sering bermasalah, dan berapa total nilai kontrak yang aktif.

**Cocok untuk:** Gedung perkantoran, hotel, rumah sakit, pabrik, sekolah, dan properti komersial dengan 5–100+ unit AC.

---

## 2. Detail Fungsi & Cara Kerja

---

### A. Manajemen Perusahaan (Client Management)

| Field | Keterangan |
|---|---|
| Nama Perusahaan | Identitas utama klien |
| Alamat | Lokasi gedung / properti |
| PIC + No. HP | Kontak penanggung jawab |
| Status Kontrak | Aktif / Nonaktif |
| Nilai Kontrak/Thn | Nominal kontrak tahunan (Rp) |
| Tanggal Mulai & Berakhir | Durasi kontrak — badge warning otomatis 30 hari sebelum expired |
| Catatan Internal | Tidak tampil ke customer |

**Cara kerja:**
- Owner/Admin buat perusahaan → sistem generate portal token unik (`mtk_xxxxxx` 40 karakter)
- Data disimpan di tabel `maintenance_clients` (RLS ketat — anon tidak bisa baca langsung)
- Hapus perusahaan = cascade hapus semua unit + history otomatis

---

### B. Registrasi Unit AC (Asset Registry)

Setiap unit memiliki data:

| Field | Contoh |
|---|---|
| Kode Unit | AC-LT2-01 |
| Lokasi | Lantai 2 — Ruang Rapat |
| Brand | Daikin / Gree / LG |
| Jenis | Split / Cassette / Standing / Floor |
| Kapasitas | 1 PK, 1.5 PK, 2 PK, dst |
| Refrigerant | R32 / R410A / R22 |
| Status | Aktif / Rusak / Retired |
| Interval PM | 1–24 bulan (default 3 bulan) |
| Terakhir Servis | Auto-update saat ada log baru |
| PM Berikutnya | Auto-hitung: Terakhir Servis + Interval |

**Cara kerja PM otomatis:**
```
Servis masuk → DB trigger fn_compute_next_service()
→ next_service_date = last_service_date + service_interval_months
→ Badge "PM Terlambat" / "Due Xh" muncul otomatis di UI
```

**Import massal via CSV:**
Upload file `.csv` → preview 20 baris pertama → simpan semua unit sekaligus (batch 20).

Format CSV:
```
unit_code, location, brand, ac_type, capacity_pk, refrigerant, status, service_interval_months
AC-01, Lantai 1 Lobby, Daikin, split, 1, R32, active, 3
AC-02, Lantai 2 Ruang Rapat, Gree, cassette, 1.5, R410A, active, 3
```

Nilai `ac_type` yang valid: `split` / `cassette` / `standing` / `floor`
Nilai `status` yang valid: `active` / `rusak` / `retired`

---

### C. Riwayat Servis (Service History)

Setiap log servis mencatat:

| Field | Keterangan |
|---|---|
| Tanggal | Tanggal pekerjaan dilakukan |
| Jenis Servis | Cuci Rutin / Cuci Besar / Perbaikan / Isi Freon / Ganti Sparepart / Instalasi / Cek & Check-Up |
| Teknisi | Nama teknisi yang mengerjakan |
| Biaya | Nominal biaya pekerjaan |
| Deskripsi | Detail kondisi & pekerjaan |
| Material/Bahan | Nama, qty, satuan (misal: Freon R32 · 0.5 kg) |
| Foto | Hingga 5 foto per log, disimpan di Cloudflare R2 |

**Dua cara log masuk:**

**1. Manual** (dari tab History di dalam detail perusahaan):
Admin/Owner klik `+ Log` di unit yang diinginkan → isi form → upload foto opsional → simpan.

**2. Otomatis dari Order Masuk:**
```
Teknisi selesai kerja → buat laporan (MyReport / Laporan Tim)
→ Owner/Admin klik "Verifikasi" di menu Laporan Tim
→ Sistem otomatis buat 1 log per unit yang ditautkan di order
→ Idempotent: verifikasi ulang tidak membuat log dobel
```

Untuk order terhubung ke maintenance, saat buat order di Planning Order pilih:
**"🏢 Maintenance Korporat"** → pilih perusahaan → centang unit yang diservis.

---

### D. Portal Customer (Akses Klien Korporat)

URL format: `https://[domain]/m/mtk_xxxxxxxxxxxxxxxxxx`

**Yang bisa dilihat customer:**
- Daftar semua unit AC miliknya + status kondisi
- Jadwal PM berikutnya per unit (warna merah = terlambat, kuning = ≤14 hari)
- Riwayat servis lengkap: tanggal, jenis, teknisi, deskripsi, material, foto
- Biaya servis (bisa disembunyikan via toggle `Sembunyikan Biaya`)
- Alert banner merah jika ada unit yang melewati jadwal PM

**Fitur portal:**

| Fitur | Cara Kerja |
|---|---|
| **QR per Unit** | Dari menu Unit klik tombol QR → modal QR code + salin URL. Scan QR → portal otomatis buka detail unit tersebut |
| **Tanpa login** | Token permanen — tidak perlu akun, tidak perlu password |
| **hide_costs** | Toggle ON → biaya di-strip di backend sebelum dikirim ke browser (bukan CSS hide, tidak bisa di-inspect) |
| **Nonaktifkan akses** | Toggle OFF → customer dapat halaman 403 "Akses Dinonaktifkan" |
| **Expiry date** | Opsional — setelah tanggal berakhir, customer dapat 401 "Link Kedaluwarsa" |
| **Regenerate token** | URL & QR lama langsung mati, token baru digenerate — untuk rotasi keamanan |

---

### E. Invoice B2B

**Alur tagihan:**

```
Log servis masuk (manual atau dari order) → tab "Invoice B2B"
→ Admin centang servis yang mau ditagih
→ Klik "Buat Invoice B2B"
→ Invoice masuk ke menu Invoice (status PENDING_APPROVAL)
→ Approve → UNPAID → terima pembayaran → PAID
→ Log yang sudah diinvoice ditandai ✓ Invoiced (tidak muncul lagi di daftar tagihan)
```

Invoice B2B mengikuti alur yang sama dengan invoice reguler AClean:
- PDF invoice bisa digenerate dan dikirim ke customer
- Mendukung PARTIAL_PAID dan group payment
- Tercatat di laporan keuangan

---

### F. Quotation (Penawaran Harga)

**Alur:**

```
+ Buat Quotation → isi item & harga → DRAFT
→ Kirim WA (PDF otomatis terlampir via Fonnte) → SENT
→ Customer setuju → tandai APPROVED
→ Buat invoice dari quotation jika perlu
```

Status yang ada: `DRAFT` → `SENT` → `APPROVED` / `EXPIRED` / `CANCELLED`

Quotation otomatis terhubung ke perusahaan (via `maintenance_client_id`), sehingga semua penawaran untuk satu klien terkumpul di satu tempat.

---

### G. Statistik per Klien

Dashboard ringkas yang tersedia di tab **📊 Statistik**:

| KPI | Keterangan |
|---|---|
| Total Servis | Jumlah semua log servis |
| Total Biaya | Akumulasi semua biaya servis |
| Rata-rata Biaya | Total biaya ÷ jumlah servis |
| Sudah Invoiced | Berapa log sudah jadi invoice |
| PM Terlambat | Unit yang melewati jadwal PM |
| PM < 14 Hari | Unit yang mendekati jadwal PM |

Grafik:
- **Bar chart biaya** 6 bulan terakhir (otomatis dari data log)
- **Ranking unit** by frekuensi servis: tampilkan unit mana paling sering bermasalah, total biaya, dan jadwal PM berikutnya

---

### H. Role Access

| Aksi | Owner | Admin | Teknisi / Helper |
|---|---|---|---|
| Lihat menu Maintenance | ✅ | ✅ | ❌ |
| Tambah / Edit perusahaan & unit | ✅ | ✅ | ❌ |
| Tambah log servis manual | ✅ | ✅ | ❌ |
| Hapus perusahaan / unit / log | ✅ | ❌ | ❌ |
| Import CSV unit | ✅ | ❌ | ❌ |
| Buat Invoice B2B | ✅ | ✅ | ❌ |
| Buat & kirim Quotation | ✅ | ✅ | ❌ |
| Toggle portal aktif / hide_costs | ✅ | ✅ | ❌ |
| Regenerate token portal | ✅ | ❌ | ❌ |

---

### I. Keamanan Data

- Tabel `maintenance_clients`, `maintenance_units`, `maintenance_logs` — **RLS enabled, 0 policy anon** → hanya bisa diakses via service key (backend)
- Portal customer: semua query lewat `/api/m-portal` (backend), data tidak pernah diekspos via Supabase anon key
- `hide_costs` di-strip di server — tidak bisa di-bypass via inspect element
- Token portal tidak pernah tampil di response Supabase langsung
- Gate akses (token_active / token_expires_at) dicek di backend **sebelum** data unit & log dikirim — tidak ada data yang bocor ke client disabled

---

### J. Data Klien Aktif (per 2026-06-04)

| Perusahaan | Unit | Status Kontrak |
|---|---|---|
| PT. Transmarco — Karawaci Office Park | 22 unit | Aktif |

---

## 3. Struktur Database

```
maintenance_clients       — data perusahaan + portal token + contract fields
maintenance_units         — registrasi unit AC per perusahaan
maintenance_logs          — riwayat servis per unit (link ke orders jika dari order)
invoices.maintenance_client_id — link invoice ke klien maintenance
quotations.maintenance_client_id — link quotation ke klien maintenance
orders.maintenance_client_id    — link order ke klien maintenance
orders.maintenance_unit_ids     — array unit yang diservis dalam order
```

Migrasi yang sudah diterapkan:
- `059` — Skema awal maintenance (3 tabel + trigger last_service_date)
- `060` — Link order → maintenance
- `061` — Fix tipe FK (orders.id = TEXT)
- `063` — Link quotation → maintenance
- `064` — Contract fields, next_service_date, service_interval, materials di log

---

*Dokumen ini di-generate dari codebase AClean Webapp — src/views/MaintenanceView.jsx, api/[route].js, src/views/MaintenancePortalView.jsx*
