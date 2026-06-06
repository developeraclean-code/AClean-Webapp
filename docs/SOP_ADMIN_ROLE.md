# SOP: ADMIN ROLE — AClean Webapp

**Dokumen Standar Operasional Perusahaan untuk Admin Role**  
Versi: 1.0 | Update: 7 Mei 2026  
Berlaku untuk: Admin baru di AClean WebApp

---

## 📋 Daftar Isi

1. [Pengenalan Sistem](#pengenalan-sistem)
2. [Role & Akses](#role--akses)
3. [Dashboard & Overview](#dashboard--overview)
4. [Manajemen Customer](#manajemen-customer)
5. [Manajemen Order & Penjadwalan](#manajemen-order--penjadwalan)
6. [Invoice & Pembayaran](#invoice--pembayaran)
7. [Laporan & Verifikasi](#laporan--verifikasi)
8. [Inventory & Material](#inventory--material)
9. [Manajemen Teknisi](#manajemen-teknisi)
10. [Pengaturan & Konfigurasi](#pengaturan--konfigurasi)
11. [Troubleshooting](#troubleshooting)

---

## 1. Pengenalan Sistem

### Apa itu AClean WebApp?

AClean WebApp adalah sistem manajemen operasional untuk perusahaan air conditioner (AC) yang mengintegrasikan:
- **Manajemen Customer** — data pelanggan, riwayat servis
- **Order & Scheduling** — penerimaan order, penjadwalan teknisi
- **Invoicing** — pembuatan invoice otomatis dari laporan teknisi
- **Inventory** — tracking tabung freon, material, dan spare part
- **Reporting** — laporan keuangan, performa teknisi, analisis stok
- **WhatsApp Integration** — kirim invoice, reminder pembayaran via WA

### Role Hierarchy

```
Owner (Dedy)
  ├─ Admin (Kamu) ← SOP ini
  ├─ Teknisi
  └─ Helper
```

**Admin Role memiliki akses ke:**
- Semua data order, invoice, customer, laporan
- Tidak bisa edit harga price list (hanya Owner)
- Tidak bisa ubah user password atau role (hanya Owner)

---

## 2. Role & Akses

### Menu yang Accessible untuk Admin

| Menu | Akses | Fungsi |
|------|-------|--------|
| **Dashboard** | ✅ Penuh | Overview statistik, status order, tim grid |
| **Planning Order** | ✅ Penuh | Input order baru, assign teknisi, ubah jadwal |
| **Order Masuk** | ✅ Penuh | List semua order, filter status, hapus order |
| **Invoice** | ✅ Penuh | List invoice, approval, link bukti bayar, kirim WA |
| **Customer** | ✅ Penuh | Input/edit/hapus customer, lihat riwayat servis |
| **Jadwal** | ✅ Penuh | Kalender mingguan, lihat slot teknisi |
| **Laporan Tim** | ✅ Penuh | Verifikasi laporan teknisi, review material & jasa |
| **My Report** | ❌ Hanya Owner | Untuk submit laporan servis (teknisi punya ini) |
| **Inventory** | ✅ Penuh | Restock request, lihat stok, input adjustment |
| **Stok Material** | ✅ Penuh | Tracking freon per tabung, record pemakaian |
| **Laporan** | ✅ Penuh | Statistik penjualan, performa, expense |
| **Price List** | ❌ Hanya Owner | Edit harga jasa & material (Owner privilege) |
| **Pengaturan** | ⚠️ Terbatas | Toggle WA, ARA, cron jobs (Owner approval) |
| **Tim Teknisi** | ✅ Penuh | Kelola user teknisi, ubah status aktif/nonaktif |
| **ARA Chat** | ✅ Penuh | Chat dengan AI assistant untuk draft invoice dll |
| **Log Audit** | ✅ Penuh | Lihat riwayat data yang dihapus, siapa menghapus |

### Credentials & Akses Awal

- **Akun Admin dibuat oleh Owner** → Login dengan email yang diberikan
- **Password** → Ganti di Pengaturan setelah login pertama
- **Internal Token** — Sistem auto-generate, jangan dibagikan

---

## 3. Dashboard & Overview

### Login Pertama Kali

1. Buka **a-clean-webapp.vercel.app**
2. Masukkan **Email** dan **Password** yang diberikan Owner
3. Pilih **Role = Admin** (jika ada multiple role)
4. Klik **Login**

### Halaman Dashboard

**Layout utama:**
```
┌─────────────────────────────────────┐
│  🏠 Dashboard                       │
├─────────────────────────────────────┤
│ ✅ Order Baru: 5                    │
│ 📋 Order Proses: 8                  │
│ ✔️ Order Selesai: 42                │
│ 💰 Invoice Pending: Rp 2.500.000    │
│ 💵 Invoice Dibayar: Rp 15.200.000   │
├─────────────────────────────────────┤
│ Tim Grid: Tampilkan tugas per teknisi
│ - Hari ini / Besok / Minggu depan   │
├─────────────────────────────────────┤
│ Chart: Penjualan bulan ini          │
│ Expense: Operasional bulan ini      │
└─────────────────────────────────────┘
```

### KPI yang Harus Dimonitor

**Setiap hari:**
- ✅ Ada order baru?
- 📋 Berapa order proses hari ini?
- ⚠️ Ada order overtime (melebihi 3 hari)?

**Setiap minggu:**
- 💰 Invoice pending berapa nilai total?
- 💵 Ada pembayaran masuk hari ini?
- 📊 Performa teknisi (by order count & rating)

---

## 4. Manajemen Customer

### 4.1 Tambah Customer Baru

**Path:** Menu Kiri → **Customer** → Tombol **+ Tambah**

**Data yang harus diisi:**

| Field | Wajib | Format | Catatan |
|-------|-------|--------|---------|
| **Nama Customer** | ✅ | Text | Nama lengkap, max 100 karakter |
| **Nomor HP** | ✅ | Format 62xxx atau 08xx | Contoh: 6281234567890 atau 081234567890 → otomatis normalize |
| **Alamat** | ✅ | Text | Lengkap sampai nomor rumah/unit |
| **Email** | ❌ | email@domain.com | Optional, untuk invoice digital |
| **Kota** | ✅ | Text | Untuk tracking area jangkauan |
| **VIP** | ❌ | Checkbox | Jika customer sering order & pembayaran lancar |

**Langkah-langkah:**

1. Klik **+ Tambah Customer**
2. **Isi Nama** — contoh: "Ibu Siti Nurhaliza"
3. **Isi Nomor HP** — contoh: 081234567890 (sistem otomatis normalize)
4. **Isi Alamat Lengkap** — contoh: "Jl. Merdeka No. 45, Apt Garden View Blok C-12, Sudirman"
5. **Pilih Kota** — dari dropdown (Jakarta, Tangerang, Bekasi, dll)
6. **Centang VIP** (optional) — jika sudah order minimal 5x
7. **Email** — optional, bisa diisi nanti
8. Klik **Simpan**

**Validasi & Error Handling:**

- ❌ **"Nomor HP sudah terdaftar"** → Cek di list, mungkin customer sudah ada (beda nama tapi no HP sama)
- ❌ **"Nama terlalu panjang"** → Nama max 100 karakter
- ❌ **"Alamat terlalu panjang"** → Alamat max 200 karakter
- ❌ **"Format email tidak valid"** → Email harus format `nama@domain.com`

### 4.2 Edit Data Customer

**Path:** Menu Customer → Klik pada card customer → Tombol **Edit**

**Yang boleh diedit:**
- ✅ Nama
- ✅ Nomor HP
- ✅ Alamat
- ✅ Kota
- ✅ Email
- ✅ Status VIP

**Langkah-langkah:**

1. Buka menu **Customer**
2. Cari customer yang mau diedit (bisa scroll atau search)
3. Klik pada **card customer** → buka detail
4. Klik tombol **Edit**
5. Update data yang perlu
6. Klik **Simpan**

### 4.3 Lihat Riwayat Servis Customer

**Path:** Menu Customer → Klik card customer → Tab **Riwayat Servis**

**Informasi yang ditampilkan:**
- Tanggal & waktu servis
- Jenis servis (Cleaning, Repair, Install, Complain)
- Teknisi yang handling
- Status invoice (Pending, Paid, Draft)
- Nilai invoice
- Rating/feedback

**Gunakan untuk:**
- Cek frekuensi servis customer
- Lihat trend masalah (misal: sering complain → ada masalah unit)
- Track pembayaran historis

### 4.4 Hapus Customer

⚠️ **PERINGATAN:** Hapus customer akan menghapus semua data order & invoice terkait!

**Langkah-langkah:**

1. Buka menu **Customer**
2. Klik card customer → buka detail
3. Scroll ke bawah → Tombol **Hapus** (warna merah)
4. Konfirmasi "Yakin hapus?" → Klik **Hapus**
5. Data akan pindah ke **Deleted Audit** (Owner bisa restore jika diperlukan)

---

## 5. Manajemen Order & Penjadwalan

### 5.1 Input Order Baru

**Path:** Menu Kiri → **Planning Order** atau **Order Masuk** → **+ Tambah Order**

**Jenis Servis yang ada:**

```
1. CLEANING — Maintenance rutin AC
   - Buka unit, vacuum, bersih, assembly
   
2. REPAIR — Perbaikan unit yang rusak
   - Gejala: tidak dingin, aneh bunyi, bocor, dll
   
3. INSTALL — Pasang unit baru
   - Full instalasi AC baru dari nol
   
4. COMPLAIN — Garansi atau follow-up
   - Dalam garansi: gratis
   - Luar garansi: bayar cek
```

**Data Order Wajib Diisi:**

| Field | Wajib | Catatan |
|-------|-------|---------|
| **Customer** | ✅ | Pilih dari dropdown atau + Tambah baru |
| **Jenis Servis** | ✅ | Cleaning / Repair / Install / Complain |
| **Tanggal Servis** | ✅ | Harus ≥ hari ini (tidak bisa mundur) |
| **Waktu Mulai** | ✅ | Jam berapa dimulai (misal: 09:00) |
| **Durasi Estimasi** | ✅ | Berapa jam diperkirakan (misal: 2 jam) |
| **Lokasi/Alamat** | ✅ | Alamat customer atau lokasi servis |
| **Deskripsi Keluhan** | ⚠️ | Penting untuk Repair & Complain |
| **Assign Teknisi** | ⚠️ | Optional saat input, bisa assign di Planning Order |
| **Catatan Tambahan** | ❌ | Info spesial (misal: ada anjing, pintu susah, dll) |

**Langkah-langkah Input Order Baru:**

1. **Klik + Tambah Order** → Form terbuka

2. **Pilih atau Tambah Customer**
   - Jika customer sudah ada → dropdown, pilih nama
   - Jika customer baru → klik **+ Tambah Customer** (lihat section 4.1)
   - Nomor HP auto-fill lokasi & riwayat

3. **Pilih Jenis Servis**
   - CLEANING → klik tombol dengan icon 🧹
   - REPAIR → klik tombol dengan icon 🔧
   - INSTALL → klik tombol dengan icon 📦
   - COMPLAIN → klik tombol dengan icon ⚠️

4. **Isi Tanggal & Waktu**
   - Klik field **Tanggal Servis** → Kalender terbuka
   - Pilih hari (hijau = hari kerja, merah = WE/libur)
   - Klik field **Waktu Mulai** → Input jam (contoh: 09:00)
   - Klik field **Durasi** → Input jam estimasi (contoh: 2 untuk 2 jam)

5. **Isi Deskripsi Keluhan** (untuk Repair & Complain)
   - Contoh Repair: "AC tidak dingin, suara bising saat on"
   - Contoh Complain: "Baru dibersihkan minggu lalu, sekarang aneh lagi"

6. **Isi Catatan Tambahan** (optional)
   - Contoh: "Ada anjing di rumah", "Harus datang saat ibu di rumah", "Pintu geser susah"

7. **Assign Teknisi** (optional, bisa nanti)
   - Jika sudah tahu → pilih dari dropdown
   - Jika belum tahu → skip dulu, assign di Planning Order

8. **Klik Simpan**

**Validasi Error:**

- ❌ **"Tanggal tidak boleh mundur"** → Pilih tanggal hari ini atau lebih
- ❌ **"Waktu tidak valid"** → Format harus HH:MM (contoh: 09:00)
- ❌ **"Customer belum dipilih"** → Wajib pilih customer dulu
- ✅ Order berhasil dibuat → notif hijau "Order dibuat"

### 5.2 Assign Teknisi & Penjadwalan

**Path:** Menu Kiri → **Planning Order** → Grid Order

**Halaman Planning Order:**

```
┌──────────────────────────────────────┐
│  📅 Planning Order — Minggu 5-11 Mei │
├──────────────────────────────────────┤
│ Filter: [Semua] [Pending] [Assigned] │
│ Tampil: [Grid] [List]                │
├──────────────────────────────────────┤
│  MON 5 | TUE 6 | WED 7 | ...         │
│ ┌─────┬────────┬────────┐            │
│ │ 09:00  ORDER-1  Cleaning            │
│ │ Unassigned [Assign] [Edit] [Hapus]  │
│ └─────┴────────┴────────┘            │
│ ┌─────┬────────┬────────┐            │
│ │ 14:00  ORDER-2  Repair              │
│ │ [Ari] [Ubah] [Edit] [Hapus]         │
│ └─────┴────────┴────────┘            │
└──────────────────────────────────────┘
```

**Langkah Assign Teknisi:**

1. Buka **Planning Order**
2. Cari order yang belum ada teknisi → tombol **Assign** berwarna oranye
3. Klik **Assign** atau **Ubah Teknisi**
4. Popup muncul → Pilih teknisi dari dropdown
   - ✅ Hijau = Tidak ada konflik jadwal
   - ⚠️ Kuning = Ada order sebelumnya dekat jam ini (risky)
   - ❌ Merah = Conflict dengan order lain (tidak bisa assign)
5. Pilih teknisi → Klik **Confirm**
6. Order status berubah → **Assigned**

**Validasi Konflik:**

Sistem otomatis cek:
- Waktu mulai order - 1 jam ≤ teknisi available?
- Durasi order + travel time tidak overlap dengan order lain?

Contoh:
```
ORDER-1: 09:00-11:00 (Cleaning 2 jam)
ORDER-2: 11:00-12:30 (Repair 1.5 jam) di lokasi berbeda
→ CONFLICT! Travel time 15-30 min perlu buffer
→ Sebaiknya ORDER-2 di 11:45 atau 12:00
```

### 5.3 Edit atau Batalkan Order

**Path:** Menu Planning Order atau Order Masuk → Klik **Edit** atau **Hapus**

**Edit Order:**

Apa yang boleh diedit:
- ✅ Tanggal (bisa maju/mundur)
- ✅ Waktu (bisa ubah jam)
- ✅ Durasi (update estimasi jam kerja)
- ✅ Deskripsi & catatan
- ✅ Teknisi yang assign

Apa yang **TIDAK** boleh diedit:
- ❌ Jenis servis (harus hapus & buat ulang)

**Langkah Edit:**

1. Klik order → Tombol **Edit**
2. Update field yang perlu
3. Klik **Simpan**
4. Notif: "Order diupdate"

**Hapus Order:**

1. Klik order → Tombol **Hapus** (warna merah)
2. Konfirmasi "Yakin hapus order?"
3. Order masuk ke **Deleted Audit**
4. Owner bisa restore jika diperlukan

---

## 6. Invoice & Pembayaran

### 6.1 Workflow Invoice

**Flow dari Laporan → Invoice:**

```
Teknisi Submit Laporan (My Report)
           ↓
Admin Review di "Laporan Tim"
           ↓
Invoice auto-generate dari laporan
(jasa & material dari card yang diisi teknisi)
           ↓
Admin Review Invoice
(cek calculation, isi biaya tambahan)
           ↓
Invoice STATUS = APPROVED
           ↓
Kirim ke customer via WA + PDF
atau manual tagih
           ↓
Tunggu pembayaran
           ↓
Admin update status PAID + link bukti
```

### 6.2 Lihat & Approve Invoice

**Path:** Menu Kiri → **Invoice**

**Halaman Invoice List:**

```
┌──────────────────────────────────────┐
│  📄 Invoice                          │
├──────────────────────────────────────┤
│ Filter: [Semua] [Draft] [Approved]   │
│         [Paid] [Tanpa Bukti] [Overdue]
│ Search: [Cari nomor invoice/customer] │
├──────────────────────────────────────┤
│ NO-INV  | Customer | Total | Status  │
│ INV-001 | Siti     | 350K  | 🟡 Draft
│ INV-002 | Budi     | 150K  | 🟢 Paid
│ INV-003 | Ani      | 500K  | ⚪ Approved
└──────────────────────────────────────┘
```

**Status Invoice:**

| Status | Warna | Arti |
|--------|-------|------|
| **Draft** | 🟡 Kuning | Baru dibuat, belum approve |
| **Approved** | ⚪ Putih | Sudah approve, siap kirim |
| **Paid** | 🟢 Hijau | Pembayaran masuk |
| **Overdue** | 🔴 Merah | Belum bayar > 7 hari |

### 6.3 Review & Approve Invoice

**Langkah-langkah:**

1. **Buka menu Invoice** → Cari invoice dengan status **Draft**

2. **Klik invoice** → Detail terbuka

3. **Review komponen invoice:**
   ```
   Cleaning Service
   - AC 1 Unit Cleaning 🟢 Rp 150.000 [dari card 1]
   - Transport (1 unit) 🟢 Rp 20.000  [auto-inject]
   
   Material
   - Refrigerant R-32  Qty 2 kg  Rp 60.000/kg = Rp 120.000
   [dari input teknisi card 2]
   
   ───────────────────────────
   Total: Rp 290.000
   ───────────────────────────
   ```

4. **Cek Validasi:**
   - ✅ Jasa sudah auto-inject sesuai laporan?
   - ✅ Material sudah tercatat dengan harga benar?
   - ✅ Total = Sum jasa + sum material?
   - ✅ Tidak ada duplikasi item?

5. **Jika ada yang salah:** Klik **Edit Invoice**
   - Tambah baris → + Tambah Item (jasa/material)
   - Edit harga → Klik harga → Ubah
   - Hapus item → Klik item → Hapus
   - Ubah qty → Edit angka qty

6. **Jika benar:** Klik **Approve**
   - Status berubah menjadi **Approved**
   - Notif: "Invoice approved - siap kirim"

### 6.4 Kirim Invoice ke Customer

**Path:** Invoice → Klik invoice → Tombol **Kirim WA** atau **Lihat PDF**

**Metode Kirim:**

1. **Kirim via WhatsApp (Otomatis)**
   - Klik **Kirim WA**
   - Sistem kirim:
     ```
     Halo Ibu Siti,
     
     Berikut invoice servis AC Anda:
     Tanggal: 5 Mei 2026
     Jenis: Cleaning
     Total: Rp 290.000
     
     Nomor rekening: [transfer dikirim via chat]
     
     Terima kasih!
     ```
   - Invoice PDF juga terkirim otomatis

2. **Lihat PDF dulu sebelum kirim**
   - Klik **Lihat PDF** → Download
   - Cek layout, cetakan, data lengkap
   - Jika OK → Klik **Kirim WA**

### 6.5 Update Pembayaran Invoice

**Path:** Invoice → Filter "Tanpa Bukti" → List invoice yang belum bukti

**Cara 1: Auto-Scan Bukti dari WhatsApp**

1. Customer kirim foto bukti transfer via WA
2. Sistem otomatis extract **nomor referensi**, **nominal**, **bank**
3. Klik tombol **Scan Bukti Sekarang** (hanya ada filter "Tanpa Bukti")
4. Sistem match dengan invoice pending
5. Jika match → Auto-update **payment_proof_url** + status **PAID**
6. Notif: "3 invoice selesai dilink dengan bukti"

**Cara 2: Manual Upload Bukti**

1. **Customer kirim foto ke Owner/Admin via chat/email**
2. **Buka invoice** → Tab **Pembayaran**
3. Klik **Upload Bukti Bayar**
4. Pilih file foto bukti (JPG/PNG)
5. Klik **Upload**
6. Sistem save file → Status otomatis jadi **PAID**

**Cara 3: Manual Input (Tanpa Bukti Foto)**

1. **Customer bayar tapi lupa kirim bukti**
2. Buka invoice → Tombol **Konfirmasi Pembayaran Manual**
3. Input:
   - Tanggal transfer
   - Bank asal (BCA/Mandiri/BNI/etc)
   - Nominal
   - Keterangan (opsional)
4. Klik **Konfirmasi**
5. Status otomatis jadi **PAID**
6. Notif: "Invoice marked as paid (manual)"

### 6.6 Reminder Pembayaran Overdue

**Sistem Otomatis:**
- Cron job berjalan daily (pukul 08:00 pagi)
- Invoice APPROVED > 7 hari belum bayar → status jadi **OVERDUE**
- Sistem kirim reminder WA otomatis:
  ```
  Halo Ibu Siti,
  
  Reminder: Invoice INV-001 Rp 290.000
  sudah jatuh tempo 7 hari.
  
  Mohon segera transfer ke rekening kami.
  
  Terima kasih!
  ```

**Admin Manual Reminder:**
1. Buka menu **Invoice** → Filter **Overdue**
2. Klik invoice → Tombol **Kirim Reminder**
3. Manual WA kirim ke customer
4. Catat tanggal follow-up

### 6.7 Laporan Keuangan Invoice

**Path:** Menu Kiri → **Laporan** → Tab **Penjualan**

**Statistik yang tersedia:**
- Total invoice bulan ini
- Total pembayaran bulan ini
- Invoice overdue (belum bayar)
- Customer dengan pembayaran terlambat
- Average invoice value
- Best customer (by total order)

---

## 7. Laporan & Verifikasi

### 7.1 Review Laporan Teknisi

**Path:** Menu Kiri → **Laporan Tim** (hanya Owner/Admin)

**Halaman Laporan Tim:**

```
┌──────────────────────────────────────┐
│  📋 Laporan Tim                      │
├──────────────────────────────────────┤
│ Filter: [Draft] [Pending] [Approved] │
│ Teknisi: [Semua] [Ari] [Budi] ...   │
│ Tanggal: [Range pilih]               │
├──────────────────────────────────────┤
│ LPR-001 | Ari | 5 Mei | 🟡 Draft    │
│ LPR-002 | Budi | 5 Mei | 🟠 Pending │
│ LPR-003 | Ani | 4 Mei | 🟢 Approved │
└──────────────────────────────────────┘
```

### 7.2 Verifikasi Isi Laporan

**Status Laporan:**

| Status | Arti | Action |
|--------|------|--------|
| **Draft** | Teknisi belum finalize | Tunggu teknisi selesai |
| **Pending** | Menunggu admin review | Admin baca & approve |
| **Approved** | Admin sudah approve | Invoice auto-generate |

**Langkah Review:**

1. **Buka Laporan Tim** → Status **Pending**

2. **Klik laporan** → Detail terbuka

3. **Review Card 1 (Unit yang dikerjakan):**
   ```
   Jenis Servis: CLEANING
   Unit yang dikerjakan: AC 1 PK
   Kondisi sebelum: Kotor, filter debu
   Kondisi sesudah: Bersih, suara normal
   ```
   - ✅ Cek apakah deskripsi logis?
   - ✅ Apakah PK terisi? (PK penting untuk harga jasa)

4. **Review Card 2 (Material):**
   ```
   Item: Refrigerant R-32
   Qty: 2 kg
   Harga: Rp 60.000/kg = Rp 120.000
   ```
   - ✅ Harga sesuai price list?
   - ✅ Qty masuk akal?
   - ✅ Satuan benar?

5. **Review Card 3 (Jasa Tambahan untuk Repair/Install):**
   ```
   Jasa: Bongkar unit
   Qty: 1
   Harga: Rp 100.000
   ```
   - ✅ Hanya untuk Repair/Install
   - ✅ Untuk Cleaning card 3 harus kosong

6. **Foto Unit:**
   - ✅ Minimal 1 foto AC sebelum-sesudah
   - ✅ Foto clear, tidak blur

7. **Jika semua OK:** Klik **Approve Laporan**
   - Status jadi **Approved**
   - Invoice otomatis generate
   - Notif: "Invoice INV-xxx berhasil dibuat"

8. **Jika ada masalah:** Klik **Reject** + alasan
   - Contoh: "Card 1 PK kosong, card 2 harga salah"
   - Teknisi dapat notif → revisi laporan
   - Klik **Submit Ulang**

### 7.3 Aturan Verification per Jenis Servis

#### **CLEANING**

| Item | Harus Ada | Catatan |
|------|-----------|---------|
| Card 1: PK | ✅ | Jenis AC (1/1.5/2/3 PK) |
| Card 1: Kondisi | ✅ | Sebelum-sesudah |
| Card 2: Material | ⚠️ | Hanya jika ada material (optional) |
| Card 3: Jasa | ❌ | HARUS KOSONG untuk Cleaning |
| Foto | ✅ | Minimal 1 AC sebelum-sesudah |
| **Auto-Invoice Jasa:** | | Per PK dari price list + transport jika 1 unit |

#### **REPAIR**

| Item | Harus Ada | Catatan |
|------|-----------|---------|
| Card 1: Unit | ✅ | Unit yang diperbaiki |
| Card 1: Gejala | ✅ | Apa yang rusak/keluhan |
| Card 2: Material | ⚠️ | Spare part yang diganti (optional) |
| Card 3: Jasa | ⚠️ | Jasa repair (optional) |
| **Invoice Jasa Repair:** | | Jika Card 3 kosong → auto inject "Biaya Cek" |

#### **INSTALL**

| Item | Harus Ada | Catatan |
|------|-----------|---------|
| Card 3: Semua | ✅ | Semua dari card 3 saja |
| Auto-kategori | | Nama → jasa atau material otomatis |
| Foto | ✅ | Minimal 2: sebelum-sesudah |

#### **COMPLAIN**

| Item | Harus Ada | Catatan |
|------|-----------|---------|
| Card 1: Gejala | ✅ | Keluhan apa |
| Garansi | ✅ | Masih dalam garansi? |
| Card 2: Material | ⚠️ | Jika ada spare part |
| **Invoice:** | | Jika garansi: Rp 0; Jika expired: inject biaya cek |

---

## 8. Inventory & Material

### 8.1 Halaman Inventory

**Path:** Menu Kiri → **Inventory** atau **Stok Material**

**Inventory:**
- Daftar semua material (freon, kabel, kapasitor, dll)
- Stock level per item
- Reorder point
- Supplier info

**Stok Material (MatTrack):**
- Tracking per **tabung/unit** (misal: Tabung Freon #1, #2, #3)
- Real-time stock per tabung
- Riwayat pemakaian per tabung
- Confirmation timbangan freon

### 8.2 Input Restock Request

**Path:** Menu Inventory → Tombol **+ Request Restock**

**Langkah-langkah:**

1. Klik **+ Request Restock**
2. Pilih material yang mau restock (dropdown)
3. Input **qty yang diminta** (contoh: 5 kg freon R-32)
4. Input **harga satuan** dari supplier (optional, auto-fill dari terakhir)
5. **Supplier** → pilih atau input baru
6. **Target tgl datang** → pilih kapan material harus tiba
7. Klik **Submit Request**

**Sistem:**
- Request masuk ke list restock pending
- Owner notif ada restock request
- Setelah material tiba → Admin **input stock**
- Qty otomatis bertambah di inventory

### 8.3 Tracking Freon per Tabung (Stok Material)

**Path:** Menu Kiri → **Stok Material**

**Halaman Stok Material:**

```
┌──────────────────────────────────────┐
│  📦 Stok Material                    │
├──────────────────────────────────────┤
│ 🔙 Filter: [Semua] [Freon] [Pipa] [Kabel]
│
│ ❄️ FREON R-32 (Total Stok: 45 kg)
│  ├─ Tabung #1 (35 kg / 50 kg = 70%)
│  │  - Tgl Beli: 1 Mei 2026
│  │  - Status: ✅ Aktif
│  │  - [Riwayat] [Ubah] [Nonaktifkan] [Arsip]
│  │  ├─ Riwayat Pemakaian:
│  │  │  - 5 Mei: Cleaning -1 kg (Pelanggan Siti)
│  │  │  - 4 Mei: Repair -2 kg (Pelanggan Budi)
│  │  │
│  ├─ Tabung #2 (10 kg / 50 kg = 20%)
│  │  - Tgl Beli: 15 Apr 2026
│  │  - Status: ✅ Aktif
│  │
│  └─ Tabung #3 (Diarsipkan 27 Apr, stok sisa: 5 kg)
│
│ 🔧 PIPA TEMBAGA (Total Stok: 120 m)
│  ├─ Pipa 1/2" (80 m / 100 m = 80%)
│  └─ Pipa 3/4" (40 m / 50 m = 80%)
│
└──────────────────────────────────────┘
```

**Status Progress Bar:**

- 🟢 Hijau (80-100%) — Stok aman
- 🟡 Kuning (40-79%) — Monitor, siap restock
- 🔴 Merah (<40%) — Urgent restock!

### 8.4 Tambah Unit Material Baru

**Path:** Stok Material → Per material card → **+ Tambah Unit**

**Langkah-langkah:**

1. Buka **Stok Material**
2. Klik material yang mau tambah unit (misal: FREON R-32)
3. Klik **+ Tambah Unit**
4. Form terbuka:
   ```
   Label: Tabung Freon #4
   Kapasitas: 50 kg
   Stok Awal: 50 kg
   Min. Tampil: 10 kg (warning jika di bawah ini)
   ```
5. Klik **Simpan**
6. Unit baru muncul di list

### 8.5 Konfirmasi Timbangan Freon (Fron Timbang Aktual)

**Skenario:**
- Teknisi menggunakan freon di lapangan → qty yang terpakai di-record saat submit laporan
- Qty yang terpakai = tebakan (misal: "kira-kira habis 1 kg")
- Admin di kantor kemudian timbang **tabung fisik** untuk confirm qty actual

**Langkah-langkah:**

1. **Teknisi submit laporan** dengan qty tebakan:
   ```
   Laporan: Pemakaian Freon R-32 ~ 1 kg
   ```

2. **Admin punya tabung fisik** → timban dengan weighing scale:
   ```
   Tabung #1: 35 kg (terakhir 36 kg) → selisih -1 kg ✅ sesuai
   Tabung #1: 34 kg (terakhir 36 kg) → selisih -2 kg ❌ berbeda dari tekhnisi
   ```

3. **Buka Stok Material** → Tabung yang baru ditimbang:
   ```
   Klik [Ubah Stok] atau inline edit
   Qty Actual: 34 kg (dari timbangan fisik)
   Sistem otomatis compare dengan qty dalam sistem
   ```

4. **Jika qty actual berbeda:**
   ```
   Sistem = 36 kg
   Actual  = 34 kg
   Selisih = -2 kg
   
   Sistem auto-create ADJUSTMENT
   untuk balance kembali ke actual
   ```

5. **Riwayat pemakaian akan update:**
   - Qty tebakan: -1 kg
   - Qty adjustment: -1 kg (untuk match actual)
   - Total final: -2 kg (sesuai actual)

---

## 9. Manajemen Teknisi

### 9.1 Halaman Tim Teknisi

**Path:** Menu Kiri → **Tim Teknisi**

**List Teknisi:**

```
┌──────────────────────────────────────┐
│  👨‍🔧 Tim Teknisi                    │
├──────────────────────────────────────┤
│ Filter: [Semua] [Aktif] [Nonaktif]   │
│
│ Ari Wijaya (Lead Teknisi)
│ - Status: ✅ Aktif
│ - Area: Jakarta, Tangerang
│ - Rating: ⭐ 4.9 (52 order)
│ - Avg. waktu: 2.1 jam/order
│ - [Edit] [Schedule] [Report] [Hapus]
│
│ Budi Santoso (Teknisi)
│ - Status: ✅ Aktif
│ - Area: Bekasi, Karawang
│ - Rating: ⭐ 4.7 (38 order)
│ - [Edit] [Schedule] [Report] [Hapus]
│
│ Ani Kusuma (Teknisi)
│ - Status: ❌ Cuti (14-20 Mei)
│ - Rating: ⭐ 4.8 (45 order)
│
└──────────────────────────────────────┘
```

### 9.2 Edit Profil Teknisi

**Path:** Tim Teknisi → Klik teknisi → **Edit**

**Data yang bisa diedit:**

| Field | Wajib | Tipe | Catatan |
|-------|-------|------|---------|
| **Nama** | ✅ | Text | Nama lengkap |
| **No HP** | ✅ | Phone | Contact pribadi |
| **Email** | ⚠️ | Email | Untuk login app |
| **Area Jangkauan** | ⚠️ | Multi-select | Kota yang handle |
| **Spesialisasi** | ❌ | Checkbox | HVAC, Instalasi, dll |
| **Status Aktif** | ✅ | Toggle | On/Off aktif |
| **Gaji/Komisi** | ❌ | Number | Admin preference (not shown to teknisi) |

**Langkah Edit:**

1. Klik Tim Teknisi → Pilih teknisi
2. Klik **Edit**
3. Update field yang perlu
4. Klik **Simpan**

### 9.3 Manajemen Helper/Asisten

**Path:** Tim Teknisi → + Tambah User

**Input Helper:**

1. Klik **+ Tambah User**
2. Input data:
   - Nama
   - Email (unik)
   - No HP
   - Password temp (kirim via WA/email)
3. Pilih Role: **Helper** (bukan Teknisi)
4. Assign ke Teknisi: (bisa nanti)
5. Klik **Simpan**

**Helper vs Teknisi:**
- **Teknisi** — bisa submit laporan servis, access schedule
- **Helper** — assist teknisi, tidak bisa submit laporan

---

## 10. Pengaturan & Konfigurasi

### 10.1 Halaman Pengaturan

**Path:** Menu Kiri → **Pengaturan**

**Tab-tab:**

```
📱 WhatsApp | 🤖 AI (ARA) | ⚙️ Sistem | 💾 Data | 📋 Logging
```

### 10.2 WhatsApp Integration

**Tab: 📱 WhatsApp**

**Fungsi:**
- Toggle ON/OFF WhatsApp gateway
- Manage Fonnte API key
- Test send WA

**Aturan:**

| Fitur | Kondisi Kirim |
|-------|---------------|
| **Invoice PDF** | Setiap approve invoice |
| **Reminder Pembayaran** | Daily 08:00 (invoice overdue > 7 hari) |
| **Order Confirm** | Setelah order di-assign |
| **Laporan Harian** | Daily 18:00 (to owner) |

**Langkah Enable WhatsApp:**

1. **Buka Pengaturan** → Tab **WhatsApp**
2. Klik **ON** → Form terbuka
3. Input **Fonnte API Key** (dari dashboard Fonnte)
4. Klik **Test Send** → Kirim WA test
5. Jika berhasil → Klik **Simpan**

### 10.3 AI Assistant (ARA)

**Tab: 🤖 AI**

**Fungsi:**
- Chat dengan AI untuk draft invoice, generate laporan
- Integrasi dengan Claude/OpenAI/Gemini

**Langkah Enable:**

1. **Buka Pengaturan** → Tab **AI (ARA)**
2. Pilih Provider: **Claude** / **OpenAI** / **Gemini**
3. Input API Key
4. Klik **Test** → Coba chat test
5. Jika OK → Klik **Simpan**

**Contoh Penggunaan:**

```
Admin ke ARA:
"Buatkan draft invoice untuk laporan LPR-001 
(Cleaning 2 unit + freon 2kg)"

ARA generate:
"Cleaning 2 unit @ Rp 150K = Rp 300K
Freon R-32 2kg @ Rp 60K = Rp 120K
Transport @ Rp 20K = Rp 20K
───────────────────
Total: Rp 440K"

Admin: "OK, approve" → Invoice dibuat
```

### 10.4 Cron Jobs & Automated Tasks

**Tab: ⚙️ Sistem**

**Scheduled Jobs yang tersedia:**

| Job | Schedule | Fungsi |
|-----|----------|--------|
| **Daily Report** | 18:00 | Kirim laporan harian ke owner via WA |
| **Invoice Reminder** | 08:00 | Reminder pembayaran overdue |
| **Stock Alert** | 09:00 | Alert stok material di bawah minimum |
| **Chat Cleanup** | 02:00 | Cleanup old WA conversations |
| **Bukti Bayar Scan** | 06:00 | Auto-scan bukti transfer dari WA |

**Langkah Enable/Disable:**

1. **Buka Pengaturan** → Tab **Sistem**
2. Lihat daftar Cron Jobs
3. Klik toggle ON/OFF per job
4. Klik **Simpan**

```
✅ Daily Report (18:00) — ENABLED
✅ Invoice Reminder (08:00) — ENABLED
⭕ Stock Alert (09:00) — DISABLED
✅ Chat Cleanup (02:00) — ENABLED
✅ Bukti Bayar Scan (06:00) — ENABLED
```

---

## 11. Troubleshooting

### 11.1 Error & Solusi Umum

#### **Error: "Nomor HP sudah terdaftar"**

**Penyebab:**
- Customer dengan nomor HP sama sudah ada di database
- Bisa nama berbeda tapi nomor sama

**Solusi:**
1. Cek di menu Customer → Search nama atau nomor HP
2. Jika customer lama sudah tidak pernah order → **Hapus** atau **Edit nama**
3. Jika customer masih aktif → Gunakan nomor HP yang beda (misal: nomor rumah/kantor)

---

#### **Error: "Teknisi conflict jadwal"**

**Penyebab:**
- Waktu order overlap atau terlalu dekat dengan order teknisi lain yang sudah assign

**Solusi:**
1. Cek di **Planning Order** → Timeline teknisi
2. Ubah waktu order ke slot yang tidak ada konflik
3. Atau assign ke teknisi yang availability-nya OK

---

#### **Error: "Order tidak bisa ubah (sudah selesai)"**

**Penyebab:**
- Order sudah complete/approved, lock dari edit

**Solusi:**
1. Jika perlu ubah → Hapus order lama
2. Buat order baru dengan data yang benar
3. Data invoice & laporan tetap tersimpan

---

#### **Invoice tidak auto-generate**

**Penyebab:**
- Laporan belum di-approve
- Atau ada validasi error di laporan

**Solusi:**
1. Buka **Laporan Tim**
2. Cari laporan status **Pending**
3. Cek validasi error (misal: card 3 belum kosong untuk Cleaning)
4. Approve laporan → Invoice auto-generate

---

#### **Bukti bayar tidak terdeteksi saat Scan**

**Penyebab:**
- Foto bukti blur/tidak jelas
- Atau format bank tidak dikenal AI
- atau nomor HP customer di bukti tidak match

**Solusi:**
1. Minta customer kirim ulang bukti dengan **foto jelas**
2. Minimal terlihat: **tanggal, nominal, nomor referensi**
3. Atau manual upload file bukti
4. Atau manual konfirmasi pembayaran

---

#### **Vercel deployment error**

**Penyebab:**
- Build gagal (syntax error di code)
- Environment variable tidak set

**Solusi:**
1. Cek **Vercel dashboard** → Deployments → Error log
2. Jika syntax error → Fix code, push ke git, auto-redeploy
3. Jika env var error → Owner update di Vercel settings
4. Hard refresh browser: **Cmd+Shift+R** (Mac) atau **Ctrl+Shift+R** (Windows)

---

### 11.2 FAQ

**Q: Bisa gak assign order ke 2 teknisi sekaligus?**

A: Tidak. Order itu 1 teknisi 1 order. Jika butuh 2 orang:
- Buat 2 order terpisah dengan durasi masing-masing
- Atau 1 teknisi lead, 1 helper assist (via Tim Teknisi)

---

**Q: Berapa lama invoice belum bayar jadi overdue?**

A: **7 hari** setelah invoice di-approve. Sistem otomatis kirim reminder, dan setelah 7 hari status jadi OVERDUE.

---

**Q: Bisa edit harga di invoice?**

A: **Bisa**. Saat review invoice di halaman detail:
1. Klik **Edit Invoice**
2. Update qty atau harga per item
3. Total otomatis recalculate
4. Klik **Simpan**

Tapi **harga price list** (jasa standar) tetap controlled oleh Owner.

---

**Q: Order bisa dihapus kapan?**

A: Order boleh dihapus **sebelum laporan di-submit**. Setelah ada laporan:
- Jika ingin cancel → Hubungi Owner
- Data akan arsip di Deleted Audit

---

**Q: Gimana kalo customer bayar tapi tidak ada bukti?**

A: Ada 3 opsi:
1. **Manual confirm** → Tombol "Konfirmasi Pembayaran Manual"
2. **Terima oral** → Catat di note invoice
3. **Verify later** → Tunggu customer kirim bukti kemudian

---

**Q: Stok material bisa negative?**

A: **Tidak** seharusnya. Jika terjadi:
- Input stok awal salah
- Atau ada transaksi yang tidak ter-record
- **Solusi:** Timbang fisik, lalu input adjustment di MatTrack

---

## 12. Checklist Harian Admin

### Pagi (08:00-09:00)

- [ ] **Buka Dashboard** → Review order hari ini
- [ ] **Planning Order** → Ada order baru? Assign teknisi?
- [ ] **Monitoring:**
  - Ada order yang overdue/overtime?
  - Ada teknisi yang belum assign?
- [ ] **Inventory Alert** → Stok material warning?
- [ ] **Invoice** → Ada yang sudah pending 7+ hari?

### Siang (12:00-13:00)

- [ ] **Laporan Tim** → Ada laporan teknisi baru? Review & approve
- [ ] **Update Progress** → Cek order mana yang sudah done
- [ ] **Customer Chat** → Ada pertanyaan/komplain?

### Sore (16:00-17:00)

- [ ] **Invoice Pending** → Cek pembayaran masuk hari ini
- [ ] **Scan Bukti Bayar** → Click "Scan Bukti Sekarang" untuk auto-link
- [ ] **Overdue** → Follow up customer yang belum bayar

### Malam (18:00-19:00)

- [ ] **Daily Report** → Sistem auto-kirim laporan harian ke Owner
- [ ] **Tomorrow Planning** → Pre-assign order besok? Check konflik?
- [ ] **Closing** → Notifikasi error/issue ke Owner?

---

## 13. Kontak & Support

**Untuk pertanyaan/masalah:**

- **Owner (Dedy)**: wa.me/62xxx
- **Developer**: developer.aclean@gmail.com
- **GitHub Issues**: github.com/developeraclean-code/AClean-Webapp/issues

---

**SOP ini berlaku mulai 7 Mei 2026 dan di-update sesuai kebutuhan operasional.**

Selamat bekerja! 🚀
