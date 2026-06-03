# Modul Maintenance (B2B Asset Registry) — Plan Implementasi

Status: **PLAN / MOCKUP** — belum di-apply ke DB/produksi.
Branch: `feat/maintenance-module`
Tanggal: 2026-06-03

Keputusan arsitektur (dikonfirmasi Owner):
- **Tabel & route portal TERPISAH** dari `customer_tokens` konsumen (hindari regresi portal 7-hari).
- Customer view = **clean view, history pakai dropdown per unit**.

---

## 1. Tujuan

Customer korporat punya 30–50 unit AC (kapasitas & jenis bervariasi). Aclean butuh:
1. Preset data unit saat service ke lokasi (tak ketik ulang).
2. History perbaikan per unit; biaya bisa di-hide ke customer.
3. Token PERMANEN — customer akses kapan saja.
4. Portal yang membuktikan Aclean lebih modern & datanya aktual.
5. Toggle on/off akses + expire/regenerate token (kontrak selesai → matikan).
6. History + foto tersimpan R2 + bisa dilihat customer.

---

## 2. Skema Database (migrasi baru — usulkan `059_maintenance_module.sql`)

```sql
-- 2.1 Perusahaan / klien kontrak
CREATE TABLE maintenance_clients (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name             text NOT NULL,
  address          text,
  pic_name         text,
  pic_phone        text,            -- normalize 628xxx (pakai lib/phone.js)
  contract_status  text DEFAULT 'active' CHECK (contract_status IN ('active','inactive')),
  portal_token     text UNIQUE,     -- token PERMANEN (req #3)
  token_active     boolean DEFAULT true,   -- toggle on/off (req #5)
  token_expires_at timestamptz,     -- NULL = permanen
  hide_costs       boolean DEFAULT true,   -- sembunyikan biaya di portal (req #2)
  notes            text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_mclients_token ON maintenance_clients(portal_token);

-- 2.2 Aset AC per perusahaan (preset — req #1)
CREATE TABLE maintenance_units (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  unit_code         text NOT NULL,        -- "AC-LT2-007"
  location          text,                 -- "Lantai 2 - R. Meeting"
  brand             text,
  ac_type           text,                 -- split|cassette|standing|floor
  capacity_pk       numeric,              -- 0.5 .. 5
  refrigerant       text,                 -- R32|R410A|R22
  year_installed    int,
  serial_no         text,
  status            text DEFAULT 'active' CHECK (status IN ('active','rusak','retired')),
  last_service_date date,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (client_id, unit_code)
);
CREATE INDEX idx_munits_client ON maintenance_units(client_id);

-- 2.3 History perbaikan per unit (req #2 & #6)
CREATE TABLE maintenance_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id       uuid NOT NULL REFERENCES maintenance_units(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  service_type  text,                 -- Cuci|Perbaikan|Isi Freon|Pasang|Cek
  technician    text,
  description   text,
  parts_used    jsonb DEFAULT '[]',
  cost          bigint,               -- NULL/hidden tergantung client.hide_costs
  photos        jsonb DEFAULT '[]',   -- array R2 key (before/after)
  order_id      uuid,                 -- link opsional ke orders existing
  created_by    text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_mlogs_unit ON maintenance_logs(unit_id);
CREATE INDEX idx_mlogs_client ON maintenance_logs(client_id);

-- RLS: ikut pola existing — service role full; portal lewat API (service key), bukan anon langsung
ALTER TABLE maintenance_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_units  ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "svc_full" ON maintenance_clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "svc_full" ON maintenance_units  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "svc_full" ON maintenance_logs   FOR ALL USING (true) WITH CHECK (true);
```

> Catatan realtime: JANGAN tambah tabel ini ke realtime publication (lihat memori Supabase compute — publication sengaja di-trim 20→5). Akses cukup fetch on-demand.

---

## 3. Backend (api/[route].js — tambah route)

Internal (butuh X-Internal-Token, Owner/Admin):
- `maintenance-clients` (GET list, POST create, PATCH update, DELETE owner-only)
- `maintenance-units` (CRUD; bulk import unit via paste/CSV)
- `maintenance-logs` (GET per unit, POST create — auto dari laporan order)
- `maintenance-token` (POST regenerate, PATCH toggle on/off) — Owner only

Publik (token-based, TANPA auth — pola sama `customer-data`):
- `m-portal` — input `token` → validasi: token ada? `token_active`? belum expired?
  - return: client (tanpa field internal), units[], logs per unit. **Strip `cost` kalau `hide_costs=true`.**
  - 403 `TOKEN_DISABLED` kalau toggle off; 401 `TOKEN_EXPIRED` kalau lewat tanggal.

Hardening: rate-limit pakai `_auth.js` yang sudah ada; jangan kembalikan `pic_phone`/`notes` internal ke portal.

---

## 4. Frontend internal — `src/views/MaintenanceView.jsx`

Submenu baru `maintenance` di App.jsx `renderContent()` + `canAccess()`:
- Akses: Owner + Admin (input/edit). DELETE & toggle token → **Owner only** (konsisten role).
- Layout: list perusahaan (kiri) → detail (kanan): tab **Unit** | **History** | **Portal**.
  - Tab Unit: tabel 30–50 unit, bulk add, edit inline, filter lokasi/jenis.
  - Tab History: timeline log per unit + foto.
  - Tab Portal: tampilkan token URL + QR, toggle aktif/non-aktif, toggle hide-cost, tombol regenerate, set expiry.
- Integrasi Planning Order: pilih klien korporat → checklist unit → prefill field order.

## 5. Frontend customer — `src/views/MaintenancePortalView.jsx` (route `/m/<token>`)

Clean view (req tambahan):
- Header: logo Aclean + nama perusahaan + ringkasan (jumlah unit, terakhir servis).
- List unit sebagai **kartu accordion** → klik unit → **dropdown history** (timeline servis + foto + biaya bila tidak di-hide).
- Filter & search unit. Badge status (active/rusak/retired).
- Mobile-first. Tanpa elemen internal.

---

## 6. Cron (Fase lanjutan)
Reminder maintenance berkala (mis. cuci tiap 3 bln) → WA ke PIC. Pakai pola AND-logic toggle (`isCronJobEnabled` + standalone key) — WAJIB sesuai CLAUDE.md.

---

## 7. Urutan kerja
1. **Mockup HTML** (file ini sprint) → review Owner. ← SEKARANG
2. Migrasi 059 + backend route.
3. MaintenanceView internal (CRUD + preset).
4. MaintenancePortalView (clean view).
5. Integrasi Planning Order + log otomatis dari laporan.
6. Cron reminder.

---

## 8. Risiko / catatan bug yang diantisipasi (untuk simulasi)
- Token bocor → wajib bisa regenerate (URL/QR lama mati).
- `hide_costs` harus di-strip **di backend**, bukan cuma disembunyikan di CSS frontend (kalau di frontend, customer bisa lihat via devtools).
- Toggle off harus 403 sebelum query data (jangan bocor unit list).
- Expiry NULL = permanen; jangan sampai logic `new Date(null)` salah → cek `if (expires_at && new Date(expires_at) < now)`.
- Phone PIC normalize 628xxx.
- Bulk import unit: validasi `unit_code` unik per client (UNIQUE constraint sudah ada).
