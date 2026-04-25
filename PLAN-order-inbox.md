# Plan: Order Inbox WhatsApp (Pengganti Google Keep)

**Branch:** `feature/order-inbox-whatsapp`
**Status:** DRAFT — untuk audit owner sebelum implementasi
**Dibuat:** 2026-04-25

---

## Tujuan

Menggantikan Google Keep sebagai pencatat order WhatsApp manual.
Order masuk ke Supabase langsung → satu sumber kebenaran → tidak ada konflik jadwal.

---

## Apa yang Dibangun

Satu view baru: **Order Inbox** (`src/views/OrderInboxView.jsx`)

Terdiri dari 3 bagian utama dalam satu halaman:

### 1. Panel Kiri — Form Quick-Entry

Form cepat input order WhatsApp, field:

| Field | Tipe | Keterangan |
|---|---|---|
| Nama Customer | Text | Auto-suggest dari tabel `customers` |
| No. WA | Text | Format normalize (08xx → 628xx) |
| Layanan | Dropdown | Dari `SERVICE_TYPES` (existing constant) |
| Alamat | Textarea | Bebas, minimal 10 karakter |
| Tanggal | Date | Default: hari ini |
| Jam Mulai | Time | Format HH:MM |
| Teknisi | Dropdown | Dari data `user_profiles` role Teknisi |
| Catatan | Textarea | Opsional — info tambahan (freon, unit AC, dll) |
| Status | Dropdown | `pending` / `confirmed` / `cancel` |

**Simpan ke tabel:** `orders` (tabel yang sama dengan order website — BUKAN tabel baru)
- Field `source` diisi `"whatsapp"` untuk filter di view lain
- Tidak perlu migrasi besar — hanya tambah nilai `source` kolom yang sudah ada atau default null

### 2. Panel Kanan Atas — Jadwal Mingguan (Grid Visual)

View grid 7 hari ke depan × daftar teknisi aktif:

```
           Sen 26  Sel 27  Rab 28  Kam 29  Jum 30  Sab 1  Min 2
Mulyadi    [09:00]  [Kosong] [10:00] ...
Ezra       [Kosong] [11:00]  ...
Aji        ...
```

- Tiap slot terisi = card kecil warna per teknisi (warna dari `TECH_PALETTE` existing)
- Slot kosong = background hijau muda (tersedia)
- Slot konflik = background merah + border tebal (warning visual)
- Klik card = lihat detail order

### 3. Panel Kanan Bawah — Daftar Order Inbox

List order yang masuk lewat panel ini (filter `source = 'whatsapp'` atau semua pending):

- Sort: tanggal + jam
- Kolom: Tanggal, Jam, Customer, Layanan, Teknisi, Status badge
- Inline edit status (dropdown langsung di baris)
- Tombol: Edit | Hapus | Promote ke Order Aktif (ubah status jadi `confirmed`)

---

## Conflict Detection Logic

Ketika user mengisi form dan memilih Teknisi + Tanggal + Jam:

```
Cek orders di hari yang sama, teknisi yang sama
Jika ada order dengan jam yang overlap (±2 jam) → tampilkan warning merah
Warning: "⚠️ Mulyadi sudah ada order jam 10:00 di [Alamat]"
```

Warning muncul REAL-TIME saat form diisi (tidak perlu submit dulu).

---

## Struktur File

```
src/views/OrderInboxView.jsx    ← View utama (BARU)
src/data/reads.js               ← Tambah fetchWaOrders() (filter source)
src/data/writes.js              ← Tidak perlu tambahan (pakai insertOrder existing)
src/App.jsx                     ← Tambah: menu entry + lazy import + renderContent case
```

**Estimasi baris kode baru:** ~350-450 baris di OrderInboxView.jsx

---

## Perubahan Database

**MINIMAL** — tidak perlu migration besar.

Cek apakah kolom `source` sudah ada di tabel `orders`:
- Jika belum: `ALTER TABLE orders ADD COLUMN source TEXT DEFAULT NULL;`
- Data lama tetap NULL (tidak ada efek)
- Order website baru bisa diisi `source = 'website'`
- Order WhatsApp diisi `source = 'whatsapp'`

Migration file: `migrations/004_add_source_to_orders.sql`

---

## Akses Role

| Role | Bisa Akses Order Inbox? |
|---|---|
| Owner | ✅ Full access |
| Admin | ✅ Full access |
| Teknisi | ❌ Tidak (hanya lihat jadwal sendiri) |
| Helper | ❌ Tidak |

Tambah `"wa-inbox"` ke `canAccess()` di App.jsx (Owner + Admin saja).

---

## Mirip Google Keep — Fitur Paritas

| Google Keep | Order Inbox |
|---|---|
| Input cepat teks bebas | Form terstruktur, semua field opsional kecuali nama+tanggal |
| View per minggu | Grid jadwal 7 hari ke depan |
| History permanen | Supabase — tidak hilang, queryable |
| Edit kapanpun | Inline edit status + tombol Edit |
| Multi-device | Webapps responsive (mobile-ready) |
| ❌ Tidak tahu konflik | ✅ Warning real-time konflik teknisi |
| ❌ Tidak bisa jadi order aktual | ✅ Satu klik promote ke order confirmed |

---

## Urutan Implementasi (jika disetujui)

1. **Migration SQL** — tambah kolom `source` ke tabel `orders`
2. **`src/data/reads.js`** — tambah `fetchWaOrders()`
3. **`src/views/OrderInboxView.jsx`** — view utama (form + grid + list)
4. **`src/App.jsx`** — lazy import + menu entry + renderContent case + canAccess
5. **Test manual** — input order, cek konflik, promote status
6. **Merge ke main** setelah owner approve

---

## Yang TIDAK Ada di Plan Ini (sengaja dihilangkan)

- WhatsApp blast/notifikasi (sudah ada di modul lain)
- Auto-parse teks WhatsApp jadi form (future feature)
- Kalender monthly view (ScheduleView sudah ada)
- Invoice otomatis dari Order Inbox (pakai flow Invoice existing)

---

## Pertanyaan Konfirmasi untuk Owner

Sebelum implementasi, konfirmasi:

1. **Kolom `source`** — apakah tabel `orders` di Supabase sudah punya kolom ini, atau perlu migration?
2. **Overlap detection** — ±2 jam warning OK? Atau mau custom (misal: warning kalau beda <1 jam saja)?
3. **"Promote" order** — ketika order inbox dipromote ke `confirmed`, apakah otomatis buat invoice draft, atau hanya ganti status?
4. **Tampilan mobile** — prioritas? (Panel kiri-kanan akan stack vertikal di HP)
