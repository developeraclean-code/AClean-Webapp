import { useState, useEffect, useRef, useCallback, useMemo, Component, lazy, Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone, samePhone } from "./lib/phone.js";
import { getLocalDate, getLocalDateObj, getLocalISOString, isWorkingHours } from "./lib/dateTime.js";
import { safeJsonParse } from "./lib/safeJson.js";
import {
  validateEmail, validatePhone, validateTime, validateDate,
  validatePositiveNumber, validateAddressLength, validateNameLength,
  validateFileSize, validationError, validationOk,
} from "./lib/validators.js";
import { isFreonItem, displayStock, computeStockStatus } from "./lib/inventory.js";
import { TECH_PALETTE, getTechColor as getTechColorFromLib } from "./lib/techColor.js";
import { sameCustomer, findCustomer, buildCustomerHistory } from "./lib/customers.js";
import {
  PRICE_LIST_DEFAULT, tipeToPkNumber, getBracketKey,
  hargaPerUnitFromTipe as hargaPerUnitFromTipeLib,
  hitungLaborFromUnits as hitungLaborFromUnitsLib,
  buildPriceListFromDB as buildPriceListFromDBLib,
} from "./lib/pricing.js";
import { cs } from "./theme/cs.js";
import { statusColor, statusLabel } from "./constants/status.js";
import { SERVICE_TYPES } from "./constants/services.js";
import {
  fetchOrders, fetchInvoices, fetchCustomers, fetchInventory,
  fetchServiceReports, fetchAgentLogs, fetchInventoryTransactions,
  fetchInventoryUnits, fetchExpenses, fetchPayments, fetchDispatchLogs,
  fetchAppSettings, fetchUserProfiles, fetchUserAccounts,
  fetchWaConversations, fetchPriceList, fetchAraBrain,
} from "./data/reads.js";
import {
  insertOrder, updateOrder, updateOrderStatus, deleteOrder,
  insertInvoice, updateInvoice, markInvoicePaid, deleteInvoice,
  updateServiceReport, deleteServiceReport,
  insertExpense, updateExpense, deleteExpense,
  insertCustomer, upsertCustomer, updateCustomer, deleteCustomer,
} from "./data/writes.js";
import DashboardView from "./views/DashboardView.jsx";
import ViewErrorBoundary from "./components/ViewErrorBoundary.jsx";
import { AppContext } from "./context/AppContext.js";
const AgentLogView = lazy(() => import("./views/AgentLogView.jsx"));
const DeletedAuditView = lazy(() => import("./views/DeletedAuditView.jsx"));
const MonitoringView = lazy(() => import("./views/MonitoringView.jsx"));
const InventoryView = lazy(() => import("./views/InventoryView.jsx"));
const AraView = lazy(() => import("./views/AraView.jsx"));
const CustomersView = lazy(() => import("./views/CustomersView.jsx"));
const OrdersView = lazy(() => import("./views/OrdersView.jsx"));
const InvoiceView = lazy(() => import("./views/InvoiceView.jsx"));
const PriceListView = lazy(() => import("./views/PriceListView.jsx"));
const ScheduleView = lazy(() => import("./views/ScheduleView.jsx"));
const TeknisiAdminView = lazy(() => import("./views/TeknisiAdminView.jsx"));
const ReportsView = lazy(() => import("./views/ReportsView.jsx"));
const LaporanTimView = lazy(() => import("./views/LaporanTimView.jsx"));
const MyReportView = lazy(() => import("./views/MyReportView.jsx"));
const MatTrackView = lazy(() => import("./views/MatTrackView.jsx"));
const ExpensesView = lazy(() => import("./views/ExpensesView.jsx"));
const SettingsView = lazy(() => import("./views/SettingsView.jsx"));
const OrderInboxView = lazy(() => import("./views/OrderInboxView.jsx"));

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── Enforce required environment variables at startup ──
if (!SUPA_URL) throw new Error("[CRITICAL] VITE_SUPABASE_URL env var is required but not set. Check your .env.local file.");
if (!SUPA_KEY) throw new Error("[CRITICAL] VITE_SUPABASE_ANON_KEY env var is required but not set. Check your .env.local file.");

const supabase = createClient(SUPA_URL, SUPA_KEY);

// Error boundary — tangkap crash dan tampilkan pesan error
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: "#0a0f1eff", color: "#e2e8f0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "monospace" }}>
          <div style={{ maxWidth: 600, width: "100%" }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: "#ef4444", marginBottom: 12 }}>App Error</div>
            <div style={{ background: "#111827", border: "1px solid #1e2d4a", borderRadius: 12, padding: 16, fontSize: 12, color: "#f87171", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error.toString()}
              {this.state.error.stack && ("\n\n" + this.state.error.stack.slice(0, 500))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: "#64748b" }}>
              Salin error di atas dan kirim ke developer. Atau tekan F12 → Console untuk detail lengkap.
            </div>
            <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 20px", background: "#38bdf8", color: "#0a0f1e", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const TEKNISI_DATA = [
];

const CUSTOMERS_DATA = [
];

// ── Helpers murni sudah dipindahkan ke src/lib/ (Stabilisasi #1 Fase 1):
//    phone.js · dateTime.js · safeJson.js · validators.js · customers.js
//    pricing.js · inventory.js · techColor.js
const ORDERS_DATA = [
];

const INVOICES_DATA = [
];

// PRICE_LIST mutable cache — di-hydrate dari DB via buildPriceListFromDB() setelah loadAll().
// Jangan edit langsung; pakai setPriceList() untuk trigger re-assign.
let PRICE_LIST = { ...PRICE_LIST_DEFAULT };

// Cache logo AClean sebagai base64 agar bisa diembed di invoice HTML (blob URL)
// Relative path tidak reliable saat dibuka di popup blob: context
let _logoDataUrlCache = null;
async function fetchInvoiceLogoUrl() {
  if (_logoDataUrlCache) return _logoDataUrlCache;
  try {
    const r = await fetch("/aclean-logo.png");
    if (!r.ok) return null;
    const blob = await r.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { _logoDataUrlCache = reader.result; resolve(reader.result); };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// Wrapper: pass PRICE_LIST cache sebagai fallback ke lib pricing.
const hargaPerUnitFromTipe = (service, tipe, priceListData = []) =>
  hargaPerUnitFromTipeLib(service, tipe, priceListData, PRICE_LIST);
const hitungLaborFromUnits = (service, units, priceListData = []) =>
  hitungLaborFromUnitsLib(service, units, priceListData, PRICE_LIST);
const buildPriceListFromDB = (rows) => buildPriceListFromDBLib(rows, PRICE_LIST_DEFAULT);

// getTechColor wrapper — signature sama.
const getTechColor = (name, teknisiDataArr) => getTechColorFromLib(name, teknisiDataArr);

const INVENTORY_DATA = [
];

const WA_CONVERSATIONS = [
];

const AGENT_LOGS = [
];

const BRAIN_MD_DEFAULT = `# ARA BRAIN v6.0 — AClean Service
> Provider: Anthropic Claude (claude-haiku-4-5) | API: Anthropic langsung

## IDENTITAS
- Nama: ARA (Aclean Response Agent)
- Bisnis: AClean Service — AC Cleaning, Install, Repair & Complain/Garansi
- Area Utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan
- Area Konfirmasi: Jakarta Barat, Jakarta Selatan (ongkir tambah — konfirmasi Owner dulu)
- Peran: Asisten AI eksekutif untuk Owner & Admin AClean

## HARGA & PRICE LIST
⚠️ WAJIB: Selalu gunakan harga dari "PRICE LIST LIVE" di system prompt.
Angka di bawah = FALLBACK saja, jika PRICE LIST LIVE belum dimuat.
Format output harga: Rp85.000 (titik pemisah ribuan, tanpa desimal).

### Cleaning
- AC Split 0.5–1PK            : Rp85.000/unit
- AC Split 1.5–2.5PK          : Rp100.000/unit
- AC Cassette 2–2.5PK         : Rp250.000/unit
- AC Cassette 3PK             : Rp300.000/unit
- AC Cassette 4PK             : Rp400.000/unit
- AC Cassette 5PK             : Rp500.000/unit
- AC Cassette 6PK             : Rp600.000/unit
- AC Standing / Split Duct    : Rp100.000/unit
- Jasa Service Besar 0.5–1PK  : Rp400.000/unit
- Jasa Service Besar 1.5–2.5PK: Rp450.000/unit

### Install
- Pemasangan AC Baru 0.5–1PK  : Rp350.000
- Pemasangan AC Baru 1.5–2PK  : Rp400.000
- Pasang AC Split 3PK         : Rp450.000
- Bongkar Pasang AC 0.5–1PK   : Rp500.000
- Bongkar Pasang AC 1.5–2.5PK : Rp550.000
- Bongkar Unit AC 0.5–1PK     : Rp150.000
- Bongkar Unit AC 1.5–2.5PK   : Rp200.000
- Pasang AC Cassette          : Rp900.000
- Pasang AC Standing          : Rp600.000
- Pemasangan AC Baru Apartemen: Rp350.000
- Jasa Pergantian Instalasi   : Rp300.000
- Jasa Penarikan Pipa AC      : Rp25.000/m
- Jasa Penarikan Pipa Ruko    : Rp35.000/m
- Jasa Vacum AC 0.5–2.5PK     : Rp50.000
- Jasa Vacum Unit AC >3PK     : Rp150.000
- Jasa Instalasi Pipa AC      : Rp200.000
- Jasa Instalasi Listrik      : Rp150.000
- Flaring Pipa                : Rp100.000
- Flushing Pipa               : Rp200.000
- Jasa Bobok Tembok           : Rp150.000
- Jasa Pengelasan Pipa AC     : Rp100.000
- Jasa Pembuatan Saluran Buangan: Rp150.000

### Repair
- Biaya Pengecekan AC               : Rp100.000
- Perbaikan Hermaplex               : Rp150.000
- Jasa Pemasangan Sparepart         : Rp250.000
- Perbaikan PCB/Elektrik            : Rp250.000
- Pergantian Kapasitor Fan Indoor   : Rp250.000
- Pergantian Sensor Indoor          : Rp250.000
- Pergantian Overload Outdoor       : Rp300.000
- Jasa Pemasangan Sparepart Daikin  : Rp330.000
- Kapasitor AC 0.5–1.5PK           : Rp350.000
- Pergantian Kapasitor Outdoor 1PK  : Rp350.000
- Pergantian Modul Indoor Standar   : Rp400.000
- Kapasitor AC 2–2.5PK             : Rp450.000
- Pergantian Kapasitor Outdoor 1.5–2.5PK: Rp450.000
- Test Press Unit                   : Rp450.000
- Jasa Pemasangan Kompresor         : Rp500.000
- Pergantian Modul Indoor Inverter  : Rp500.000
- Kuras Vacum + Isi Freon R32/R410  : Rp600.000
- Kuras Vacum Freon R22             : Rp600.000

### Freon (per kg)
- Freon R22   : Rp450.000/kg
- Freon R32   : Rp450.000/kg
- Freon R410A : Rp450.000/kg

### Complain / Garansi
- Dalam masa garansi aktif         : GRATIS (jasa=0, material tetap dicharge)
- Tanpa garansi + tidak ada temuan : Rp100.000 (biaya cek)

### Maintenance
- Preventif 0.5–1PK    : Rp150.000
- Preventif 1.5–2.5PK  : Rp200.000
- Perawatan Musiman     : Rp200.000
- Pemeriksaan Berkala   : Rp100.000
- Pembersihan Filter    : Rp50.000
- Penggantian Filter    : Rp100.000
- Lubrikasi Kompresor   : Rp250.000

### Biaya Tambahan (Fixed)
- Dadakan (booking H-0): +Rp50.000 → field "dadakan" di invoice

## TIPE LAYANAN VALID
- Cleaning    = cuci AC, service rutin, bersihkan filter
- Install     = pasang AC baru, bongkar pasang, pindah unit
- Repair      = perbaikan, isi freon, troubleshoot, ganti sparepart
- Complain    = garansi, follow-up keluhan, cek ulang
- Maintenance = perawatan berkala terjadwal

## SOP ORDER
1. Cek bizContext.teknisiWorkload — pastikan ada slot kosong sebelum assign
2. Jam operasional: 08:00–17:00 WIB (konfirmasi Owner jika di luar jam)
3. Prioritas assign: teknisi dengan jobsToday paling sedikit & skill cocok
4. Helper WAJIB: order 3+ unit (semua service) ATAU service Install
5. Konfirmasi ke Owner/Admin dulu — tampilkan ringkasan sebelum eksekusi
6. Setelah CONFIRMED → tawarkan DISPATCH_WA ke teknisi
7. Status flow: PENDING → CONFIRMED → IN_PROGRESS → COMPLETED

## SOP INVOICE
1. Buat invoice hanya setelah laporan teknisi masuk (SUBMITTED / COMPLETED)
2. WAJIB gunakan CREATE_INVOICE — jangan hitung manual
3. Sebelum buat invoice, CEK laporan aktual (bizContext.laporan[].pekerjaan_aktual):
   - Ada "Service Besar" / "Deep Cleaning" → pakai harga Jasa Service Besar
   - Ada freon → tambahkan ke field "material" sesuai type & jumlah kg
   - Harga berbeda dari order awal → KONFIRMASI Owner dulu
4. Due date: H+3 dari tanggal selesai
5. Reminder WA: kirim jika H-1 due dan belum PAID
6. Hanya Owner yang bisa APPROVE invoice
7. Laporan masuk → proaktif tawarkan buat invoice

## SOP STOK
1. Alert jika stok status OUT atau CRITICAL
2. Freon R22 & R32: reorder jika < 5 kg
3. Catat penggunaan setelah servis (UPDATE_STOCK delta negatif)

## SOP BIAYA / PENGELUARAN
Kategori valid:
- petty_cash       : Bensin Motor | Perbaikan Motor | Parkir | Kasbon Karyawan | Lembur | Bonus | Lain-lain
- material_purchase: Pipa AC | Kabel | Freon | Material Lain

Jika user dump pengeluaran → parse otomatis → tampilkan ringkasan → tunggu konfirmasi → CREATE_EXPENSE

## TIM TEKNISI & HELPER
> Data tim = LIVE dari bizContext.teknisiWorkload & bizContext.helperList
> JANGAN mengarang nama — gunakan data live saja

- Helper bisa diassign sebagai teknisi utama jika Owner/Admin konfirmasi eksplisit
- Nama tidak ada di list → tolak dan tampilkan daftar yang tersedia

## RULES EKSEKUSI
- Maks 1 ACTION untuk operasi tunggal; maks 3 untuk workflow chain
- JANGAN eksekusi CANCEL/hapus tanpa alasan jelas dari user
- Konflik jadwal → WAJIB tanya user dulu, jangan auto-assign
- Gunakan data live (bizContext) — bukan asumsi
- Data tidak lengkap → tanya user, jangan mengarang
- Order PENDING baru → proaktif tawarkan konfirmasi + assign teknisi
- Laporan SUBMITTED → proaktif tawarkan CREATE_INVOICE
- Selalu sebut nomor order & nama customer dalam konfirmasi aksi

Workflow chain diizinkan:
- CREATE_ORDER → DISPATCH_WA
- UPDATE_ORDER_STATUS(COMPLETED) → CREATE_INVOICE
- MARK_PAID → SEND_WA (konfirmasi ke customer)
- RESCHEDULE_ORDER (otomatis notif WA ke customer & teknisi baru)
- CANCEL_ORDER → SEND_WA (opsional)

## FITUR PARSE DUMP ORDER HARIAN
Format: Customer / Alamat / Phone / Service N unit / Teknisi + Helper / Tanggal Jam
Alias: cuci/cleaning/service rutin → Cleaning | pasang/install/baru → Install | perbaikan/repair/freon → Repair | complain/garansi → Complain

Langkah:
1. Parse semua baris → ekstrak field lengkap
2. Tampilkan ringkasan: "📋 Saya baca [N] order untuk [tgl]:\n1. Nama — Service N unit — Teknisi — Jam\n✅ Ketik OK atau sebutkan nomor yang perlu dikoreksi"
3. Setelah konfirmasi → BULK_CREATE_ORDER

## FITUR RESCHEDULE MASSAL
Jika "teknisi X tidak masuk hari ini":
1. Tampilkan semua order hari ini yang pakai teknisi X
2. Tanya: reschedule (tgl/jam baru) atau ganti teknisi lain
3. Eksekusi RESCHEDULE_ORDER per order → notif WA otomatis ke customer & teknisi baru

## FITUR VISION — BACA GAMBAR
- Bukti bayar/transfer → ekstrak bank, nominal, tanggal, pengirim → tawarkan MARK_PAID
- Gambar kerusakan AC → deskripsikan kondisi → rekomendasikan service
- Nota/struk belanja → baca item + harga → tawarkan CREATE_EXPENSE
- Gambar tidak jelas → minta kirim ulang dengan resolusi lebih baik

## REFERENSI ACTION
[ACTION]{"type":"CREATE_ORDER","customer":"Nama","phone":"08xxx","address":"Alamat","service":"Cleaning","units":1,"teknisi":"Nama","helper":"Nama","date":"YYYY-MM-DD","time":"HH:MM","notes":""}[/ACTION]
[ACTION]{"type":"BULK_CREATE_ORDER","orders":[{"customer":"...","service":"Cleaning","units":1,"teknisi":"...","date":"YYYY-MM-DD","time":"09:00"}]}[/ACTION]
[ACTION]{"type":"UPDATE_ORDER_STATUS","id":"ORD-xxx","status":"CONFIRMED"}[/ACTION]
[ACTION]{"type":"RESCHEDULE_ORDER","id":"ORD-xxx","date":"YYYY-MM-DD","time":"HH:MM","teknisi":"Nama"}[/ACTION]
[ACTION]{"type":"CANCEL_ORDER","id":"ORD-xxx","reason":"Alasan"}[/ACTION]
[ACTION]{"type":"DISPATCH_WA","order_id":"ORD-xxx"}[/ACTION]
[ACTION]{"type":"CREATE_INVOICE","order_id":"ORD-xxx"}[/ACTION]
[ACTION]{"type":"UPDATE_INVOICE","id":"INV-xxx","field":"dadakan","value":50000}[/ACTION]
[ACTION]{"type":"MARK_PAID","id":"INV-xxx"}[/ACTION]
[ACTION]{"type":"APPROVE_INVOICE","id":"INV-xxx"}[/ACTION]
[ACTION]{"type":"SEND_REMINDER","invoice_id":"INV-xxx"}[/ACTION]
[ACTION]{"type":"MARK_INVOICE_OVERDUE"}[/ACTION]
[ACTION]{"type":"CREATE_EXPENSE","category":"petty_cash","subcategory":"Bensin Motor","amount":50000,"date":"YYYY-MM-DD","description":"","teknisi_name":""}[/ACTION]
[ACTION]{"type":"CREATE_EXPENSE","category":"material_purchase","subcategory":"Freon","amount":900000,"date":"YYYY-MM-DD","item_name":"R32 2kg","freon_type":"R32"}[/ACTION]
[ACTION]{"type":"UPDATE_STOCK","code":"KODE","name":"Nama","delta":-2,"reason":"Dipakai ORD-xxx"}[/ACTION]
[ACTION]{"type":"SEND_WA","phone":"08xxx","message":"Pesan"}[/ACTION]

## FORMAT JAWABAN
- Bahasa Indonesia, ringkas, to the point
- Sertakan data aktual (nama, tanggal, jumlah) dalam setiap konfirmasi
- Emoji secukupnya untuk keterbacaan
- JANGAN sebut "AWS Bedrock", "Gemini", atau provider lain
`.trim();

// A.2 OPTIMIZATION: Custom hook untuk debounce nilai (prevent excessive re-renders saat typing)
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export { ErrorBoundary };

// ── AuditHistory (stabilisasi #2B) — tampilkan riwayat perubahan per row ──
// Fetch dari tabel audit_log, tampilkan diff field-by-field.
function AuditHistory({ tableName, rowId, open, onClose, cs = {} }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !tableName || !rowId) return;
    let alive = true;
    setLoading(true);
    supabase.from("audit_log")
      .select("*")
      .eq("table_name", tableName)
      .eq("row_id", String(rowId))
      .order("changed_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) console.warn("[audit] fetch failed:", error.message);
        setRows(data || []);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [tableName, rowId, open]);
  if (!open) return null;

  const fmtVal = (v) => {
    if (v === null || v === undefined) return <span style={{ color: "#64748b" }}>∅</span>;
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") return v.toLocaleString("id-ID");
    const s = String(v);
    return s.length > 60 ? s.slice(0, 60) + "…" : s;
  };

  const C = {
    bg: cs.bg || "#0f172a", surface: cs.surface || "#1e293b",
    border: cs.border || "#334155", text: cs.text || "#e2e8f0",
    muted: cs.muted || "#94a3b8", accent: cs.accent || "#06b6d4",
    green: cs.green || "#22c55e", red: cs.red || "#ef4444", yellow: cs.yellow || "#eab308",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bg, border: "1px solid " + C.border, borderRadius: 12,
        maxWidth: 720, width: "100%", maxHeight: "85vh", overflow: "auto",
        padding: 20
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>📜 Riwayat Perubahan</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{tableName} · {rowId}</div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid " + C.border, color: C.text,
            padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13
          }}>Tutup</button>
        </div>

        {loading && <div style={{ color: C.muted, fontSize: 12, padding: 16, textAlign: "center" }}>Memuat...</div>}
        {!loading && rows.length === 0 && (
          <div style={{
            color: C.muted, fontSize: 12, padding: 24, textAlign: "center",
            border: "1px dashed " + C.border, borderRadius: 8
          }}>
            Belum ada riwayat perubahan untuk row ini.
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((r) => {
            const actColor = r.action === "INSERT" ? C.green : r.action === "DELETE" ? C.red : C.yellow;
            const dt = r.changed_at ? new Date(r.changed_at).toLocaleString("id-ID") : "-";
            const diffs = Array.isArray(r.diff_keys) ? r.diff_keys : [];
            return (
              <div key={r.id} style={{
                background: C.surface, border: "1px solid " + C.border,
                borderRadius: 10, padding: "10px 14px"
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{
                    background: actColor + "22", color: actColor,
                    border: "1px solid " + actColor + "44",
                    padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700
                  }}>{r.action}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{dt}</span>
                  <span style={{ fontSize: 11, color: C.text, marginLeft: "auto" }}>
                    👤 <strong>{r.changed_by}</strong>
                  </span>
                </div>
                {r.action === "UPDATE" && diffs.length > 0 && (
                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    {diffs.filter(k => k !== "updated_at" && k !== "edit_log").map(k => (
                      <div key={k} style={{
                        fontSize: 11, display: "grid",
                        gridTemplateColumns: "110px 1fr 20px 1fr", gap: 6, alignItems: "center"
                      }}>
                        <div style={{ color: C.accent, fontWeight: 700 }}>{k}</div>
                        <div style={{
                          color: C.muted, fontFamily: "monospace",
                          textDecoration: "line-through"
                        }}>{fmtVal((r.before_data || {})[k])}</div>
                        <div style={{ color: C.muted, textAlign: "center" }}>→</div>
                        <div style={{ color: C.text, fontFamily: "monospace", fontWeight: 600 }}>
                          {fmtVal((r.after_data || {})[k])}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {r.action === "INSERT" && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.muted }}>
                    Dibuat dengan {Object.keys(r.after_data || {}).length} field.
                  </div>
                )}
                {r.action === "DELETE" && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.red }}>
                    Row dihapus.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {rows.length >= 50 && (
          <div style={{ textAlign: "center", fontSize: 10, color: C.muted, marginTop: 10 }}>
            Menampilkan 50 perubahan terbaru.
          </div>
        )}
      </div>
    </div>
  );
}

// ── In-memory fetch cache (session-scoped) ──
// Mencegah re-fetch ke Supabase pada manual refresh / navigasi ulang.
// Data tetap fresh via Realtime channels yang sudah ada.
const CACHE_TTL = 60_000; // 1 menit
const _fetchCache = { store: {} };
function cachedFetch(key, fetcher) {
  const hit = _fetchCache.store[key];
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.value);
  return fetcher().then(result => {
    _fetchCache.store[key] = { value: result, ts: Date.now() };
    return result;
  });
}
function invalidateCache(...keys) {
  if (keys.length === 0) { _fetchCache.store = {}; return; }
  keys.forEach(k => delete _fetchCache.store[k]);
}

export default function ACleanWebApp() {
  // ── Auth & Role ──
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [paymentsData, setPaymentsData] = useState([]);
  const [dispatchLogs, setDispatchLogs] = useState([]);
  const [loginScreen, setLoginScreen] = useState("login"); // "login" | "select_account"
  const [loginError, setLoginError] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [modalAddUser, setModalAddUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", role: "Admin", password: "", phone: "" });
  const [userAccounts, setUserAccounts] = useState([]);
  // userAccounts diload dari Supabase user_profiles — tidak ada password hardcode di sini

  // ── Tim Teknisi state (reactive) ──
  const [teknisiData, setTeknisiData] = useState(TEKNISI_DATA);

  // ── Core navigation ──
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [activeRole, setActiveRole] = useState("owner");

  // ── Customer ──
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerTab, setCustomerTab] = useState("list");

  // ── Orders ──
  const [orderFilter, setOrderFilter] = useState("Semua");
  const [searchOrder, setSearchOrder] = useState("");
  const [orderTekFilter, setOrderTekFilter] = useState("Semua");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [orderServiceFilter, setOrderServiceFilter] = useState("Semua"); // GAP-9
  const [orderPage, setOrderPage] = useState(1);
  const ORDER_PAGE_SIZE = 20;

  // ── Invoice ──
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceFilter, setInvoiceFilter] = useState("Semua");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  const [customerPage, setCustomerPage] = useState(1);
  const [schedPage, setSchedPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [dbHealthData, setDbHealthData] = useState([]);
  const [omsetView, setOmsetView] = useState("minggu");
  const [dbHealthLoading, setDbHealthLoading] = useState(false);
  const [vacuumLoading, setVacuumLoading] = useState({});
  const INV_PAGE_SIZE = 15;
  const CUST_PAGE_SIZE = 20;
  const SCHED_PAGE_SIZE = 15;
  const [modalPDF, setModalPDF] = useState(false);
  const [modalApproveInv, setModalApproveInv] = useState(false); // popup pilihan approve
  const [pendingApproveInv, setPendingApproveInv] = useState(null); // invoice yang menunggu approve
  const [auditModal, setAuditModal] = useState(null); // { tableName, rowId } | null — Stabilisasi #2B

  // ── Schedule ──
  const [scheduleView, setScheduleView] = useState("week");
  const [teknisiTab, setTeknisiTab] = useState("jadwal");
  const [filterTeknisi, setFilterTeknisi] = useState("Semua");
  const [calLaporanFilter, setCalLaporanFilter] = useState("semua"); // "semua" | "sudah" | "belum"

  // ── Search ──
  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchInvoice, setSearchInvoice] = useState("");
  const [searchInventory, setSearchInventory] = useState("");
  const [searchPriceList, setSearchPriceList] = useState("");
  const [priceListSvcTab, setPriceListSvcTab] = useState("Semua");
  const [priceListData, setPriceListData] = useState([]);
  const [priceListSyncedAt, setPriceListSyncedAt] = useState(null); // timestamp terakhir sync harga
  const [plEditItem, setPlEditItem] = useState(null);
  const [plEditForm, setPlEditForm] = useState({});
  const [plAddModal, setPlAddModal] = useState(false);
  const [plNewForm, setPlNewForm] = useState({ service: "Cleaning", type: "", code: "", price: "", unit: "unit", notes: "", category: "" });
  const [searchLaporan, setSearchLaporan] = useState("");
  const [laporanSvcFilter, setLaporanSvcFilter] = useState("Semua");
  const [laporanStatusFilter, setLaporanStatusFilter] = useState("Semua");
  const [laporanDateFilter, setLaporanDateFilter] = useState("Semua"); // Semua/Hari Ini/Minggu Ini/Bulan Ini/Range
  const [laporanTeamFilter, setLaporanTeamFilter] = useState("Semua"); // filter per teknisi
  const [laporanDateFrom, setLaporanDateFrom] = useState(""); // date range: dari
  const [laporanDateTo, setLaporanDateTo] = useState(""); // date range: sampai
  const [laporanPage, setLaporanPage] = useState(1);
  const [agentLogPage, setAgentLogPage] = useState(1);
  const LAP_PAGE_SIZE = 10;
  const AGENT_LOG_PAGE_SIZE = 20;

  // ── Laporan Tim ──
  const [laporanReports, setLaporanReports] = useState([]);
  const [selectedLaporan, setSelectedLaporan] = useState(null);
  const [modalLaporanDetail, setModalLaporanDetail] = useState(false);
  const [editLaporanMode, setEditLaporanMode] = useState(false);
  const [editLaporanForm, setEditLaporanForm] = useState({});
  const [activeEditUnitIdx, setActiveEditUnitIdx] = useState(0);

  // ── WA panel ──
  const [waPanel, setWaPanel] = useState(false);
  const [selectedConv, setSelectedConv] = useState(null);
  const [waInput, setWaInput] = useState("");

  // ── Modals ──
  const [modalOrder, setModalOrder] = useState(false);
  const [modalStok, setModalStok] = useState(false);
  const [modalWaTek, setModalWaTek] = useState(false); // popup pilihan pesan WA teknisi ke customer
  const [waTekTarget, setWaTekTarget] = useState(null);  // { phone, customer, service, time, address }
  const [modalTeknisi, setModalTeknisi] = useState(false);
  const [editTeknisi, setEditTeknisi] = useState(null);
  const [modalEditStok, setModalEditStok] = useState(false);
  const [editStokItem, setEditStokItem] = useState(null);
  const [modalRestock, setModalRestock] = useState(false);
  const [restockItem, setRestockItem] = useState(null);
  const [restockForm, setRestockForm] = useState({ qty: "", harga: "", tanggal: "", keterangan: "", catetBiaya: true });
  const [modalBrainEdit, setModalBrainEdit] = useState(false);

  // ── Form laporan (teknisi) — v3 multi-unit ──
  const [laporanModal, setLaporanModal] = useState(null);
  const [laporanStep, setLaporanStep] = useState(1);
  const [laporanSubmitted, setLaporanSubmitted] = useState(false);
  const [laporanUnits, setLaporanUnits] = useState([]);
  const [laporanMaterials, setLaporanMaterials] = useState([]);
  const [laporanJasaItems, setLaporanJasaItems] = useState([]);  // Jasa section A
  const [jasaManualText, setJasaManualText] = useState({});  // {item.id: text} untuk input manual jasa
  const [repairManualText, setRepairManualText] = useState({});  // {item.id: text} untuk input manual repair
  const [laporanRepairItems, setLaporanRepairItems] = useState([]);  // Repair/Sparepart B (legacy, tetap ada)
  const [laporanBarangItems, setLaporanBarangItems] = useState([]);  // ✨ NEW: Barang/Material billed (dari price_list category=Barang)
  const [laporanRepairType, setLaporanRepairType] = useState("berbayar");  // ✨ NEW: Repair type (berbayar/gratis-garansi/gratis-customer)
  // ✨ NEW: Cleaning-in-Repair — teknisi centang unit yang juga dicuci saat repair, harga dari PRICE_LIST bracket PK
  const [laporanCleaningInRepair, setLaporanCleaningInRepair] = useState([]); // array of unit_no yang dicentang
  // ✨ NEW: Complain garansi override (Owner/Admin only, di halaman approval)
  const [complainGaransiOverride, setComplainGaransiOverride] = useState({}); // { [reportId]: "free" | "paid" | null }
  const [editRepairType, setEditRepairType] = useState("berbayar");  // ✨ NEW: Admin edit modal repair type selector
  const [editGratisAlasan, setEditGratisAlasan] = useState("");  // ✨ NEW: Admin must provide reason if choosing gratis
  const [showJasaSearch, setShowJasaSearch] = useState(false);
  const [jasaSearchQ, setJasaSearchQ] = useState("");
  const [showRepairSearch, setShowRepairSearch] = useState(false);
  const [repairSearchQ, setRepairSearchQ] = useState("");
  const [showMatSearch, setShowMatSearch] = useState(false);
  const [matSearchQ2, setMatSearchQ2] = useState("");
  const [laporanFotos, setLaporanFotos] = useState([]);
  const [editPhotoMode, setEditPhotoMode] = useState(false);  // true = re-upload photos, false = keep existing
  const [editLaporanFotos, setEditLaporanFotos] = useState([]);     // new photos for re-upload
  const [laporanRekomendasi, setLaporanRekomendasi] = useState("");
  const [laporanCatatan, setLaporanCatatan] = useState("");
  const [laporanInstallItems, setLaporanInstallItems] = useState({}); // key→qty untuk Report Install
  const [historyPreview, setHistoryPreview] = useState(null); // customer untuk preview history
  const [matSearchId, setMatSearchId] = useState(null); // id material yang sedang di-search
  const [matSearchQuery, setMatSearchQuery] = useState(""); // query search per baris
  // A.2 OPTIMIZATION: Debounce material search query untuk prevent excessive filtering
  const debouncedMatSearchQuery = useDebounce(matSearchQuery, 200);
  const [activeUnitIdx, setActiveUnitIdx] = useState(0);
  const [showMatPreset, setShowMatPreset] = useState(false);
  // ── Smart AC Unit Preset ──
  const [showUnitPresetModal, setShowUnitPresetModal] = useState(false);
  const [unitPresetHistory, setUnitPresetHistory] = useState(null);  // customer history data
  const [unitPresetSelected, setUnitPresetSelected] = useState(new Set()); // Set of unit indices from history to use
  const fotoInputRef = useRef();

  // ── Session Management ──
  const lastSessionCheckRef = useRef(0); // Track last session check to avoid excessive checks

  // ── New order / stok / customer form ──
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false); // anti double submit
  const _orderSubmitLock = useRef(false); // ref-level lock (state updates batch, ref updates instantly)
  const [matTrackFilter, setMatTrackFilter] = useState("Semua"); // filter kategori material
  const [matTrackSearch, setMatTrackSearch] = useState("");
  const [matTrackDateFrom, setMatTrackDateFrom] = useState("");
  const [matTrackDateTo, setMatTrackDateTo] = useState("");
  const [invTxData, setInvTxData] = useState([]);

  // ── Biaya / Expenses ──
  const [expensesData, setExpensesData] = useState([]);
  const [expenseTab, setExpenseTab] = useState("petty_cash"); // "petty_cash" | "material_purchase"
  const [expenseFilter, setExpenseFilter] = useState("Semua");
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseDateFrom, setExpenseDateFrom] = useState("");
  const [expenseDateTo, setExpenseDateTo] = useState("");
  const [expensePage, setExpensePage] = useState(1);
  const [modalExpense, setModalExpense] = useState(false);
  const [editExpenseItem, setEditExpenseItem] = useState(null);
  const [newExpenseForm, setNewExpenseForm] = useState(() => ({
    category: "petty_cash", subcategory: "", amount: "", date: getLocalDate(),
    description: "", teknisi_name: "", item_name: "", freon_type: ""
  }));
  const EXPENSE_PAGE_SIZE = 20;

  // ── ARA Log filters ──
  const [logDateFilter, setLogDateFilter] = useState("Semua");
  const [logActionFilter, setLogActionFilter] = useState("Semua");
  const [schedListFilter, setSchedListFilter] = useState("minggu_ini"); // "hari_ini" | "minggu_ini" | "semua"
  const [invUnitsData, setInvUnitsData] = useState([]); // unit fisik per item (tabung/roll)
  const [showAddStock, setShowAddStock] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState({ customer: "", phone: "", address: "", area: "", service: "Cleaning", type: "AC Split 0.5-1PK", units: 1, teknisi: "", helper: "", date: "", time: "09:00", notes: "" });
  const [newStokForm, setNewStokForm] = useState({ name: "", code: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "" });
  const [newTeknisiForm, setNewTeknisiForm] = useState({ name: "", role: "Teknisi", phone: "", skills: [], email: "", password: "", buatAkun: false });
  const [modalAddCustomer, setModalAddCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: "", phone: "", address: "", area: "", notes: "", is_vip: false });
  const [customersData, setCustomersData] = useState(CUSTOMERS_DATA);
  const [ordersData, setOrdersData] = useState(ORDERS_DATA);
  const [modalEditOrder, setModalEditOrder] = useState(false);
  const [editOrderItem, setEditOrderItem] = useState(null);
  const [editOrderForm, setEditOrderForm] = useState({});

  // GAP 5 — Reactive state untuk invoice & inventory (tidak lagi konstan)
  const [invoicesData, setInvoicesData] = useState(INVOICES_DATA);
  const [inventoryData, setInventoryData] = useState(INVENTORY_DATA);

  // GAP 3 — State untuk edit invoice
  const [modalEditInvoice, setModalEditInvoice] = useState(false);
  const [editInvoiceData, setEditInvoiceData] = useState(null);
  const [editInvoiceForm, setEditInvoiceForm] = useState({});
  const [editInvoiceItems, setEditInvoiceItems] = useState([]); // per-item edit
  // ── Confirm Modal (ganti window.confirm) ──
  const [confirmModal, setConfirmModal] = useState(null);
  // confirmModal = { title, message, icon, danger, onConfirm, onCancel, confirmText, cancelText }
  const showConfirm = (opts) => new Promise(resolve => {
    setConfirmModal({
      ...opts,
      onConfirm: () => { setConfirmModal(null); resolve(true); },
      onCancel: () => { setConfirmModal(null); resolve(false); },
    });
  });

  const [modalEditPwd, setModalEditPwd] = useState(false);
  const [editPwdTarget, setEditPwdTarget] = useState(null); // {id, name}
  const [editPwdForm, setEditPwdForm] = useState({ newPwd: "", confirmPwd: "" });
  const [editAddType, setEditAddType] = useState(''); // 'jasa' | 'material'
  const [editAddSearch, setEditAddSearch] = useState('');
  const [editJasaItems, setEditJasaItems] = useState([]); // jasa items per-row

  // GAP 7/8 — ARA Chat state (live LLM)
  const [araPanel, setAraPanel] = useState(false);
  const [araMessages, setAraMessages] = useState([
    { role: "assistant", content: "Halo! Saya ARA 🤖 — AI Agent AClean. Saya bisa bantu Anda:\n- Cek status order & invoice\n- Update nilai invoice\n- Lihat stok material\n- Analisis revenue & performa\n- Buat ringkasan harian\n\nMau tanya apa?" }
  ]);
  const [araInput, setAraInput] = useState("");
  const [araLoading, setAraLoading] = useState(false);
  const [araImageData, setAraImageData] = useState(null);  // base64 no prefix
  const [araImageType, setAraImageType] = useState(null);  // "image/jpeg" etc
  const [araImagePreview, setAraImagePreview] = useState(null);  // data URL for preview
  const araBottomRef = useRef();

  // GAP 7 — Reactive agent logs
  const [agentLogs, setAgentLogs] = useState(AGENT_LOGS);
  const addAgentLog = async (action, detail, status = "SUCCESS") => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const createdAt = now.toISOString();
    const userName = currentUser?.name || "System";
    const userId = currentUser?.id || null;
    // Update local state
    setAgentLogs(prev => [{
      time: timeStr, action, detail, status,
      user_name: userName, created_at: createdAt
    }, ...prev].slice(0, 200));
    // Persist ke Supabase
    try {
      const { error: alErr } = await supabase.from("agent_logs").insert({
        action, detail, status,
        time: timeStr,
        created_at: createdAt,
        user_name: userName,
        user_id: userId,
      });
      if (alErr) console.warn("agent_logs insert:", alErr.message, alErr.hint);
    } catch (e) { console.warn("agent_logs catch:", e.message); }
  };

  // ── AUDIT TRAIL (stabilisasi #2B) ──
  // Pooler Supabase = transaction mode → session var ga persist. Solusi:
  // inject kolom last_changed_by langsung ke payload. Trigger baca dari NEW/OLD row.
  // auditUserName() = helper nama string user aktif.
  // setAuditUser() = legacy (coba set session var juga, fail-silent backup).
  const auditUserName = () => currentUser?.name || currentUser?.email || currentUser?.id || "system";
  const setAuditUser = async () => {
    try { await supabase.rpc("set_current_user", { uid: auditUserName() }); }
    catch { /* pooler ga support, diabaikan — last_changed_by di payload sudah cukup */ }
  };

  // ── App Settings: bank, phone, nama — load dari DB tabel app_settings ──
  const [appSettings, setAppSettings] = useState({
    bank_name: "",
    bank_number: "",
    bank_holder: "",
    owner_phone: "",
    company_name: "",
    company_addr: "",
    wa_number: "",
    wa_autoreply_enabled: "false",
    ara_training_rules: "",
    wa_forward_to_owner: "true",
    wa_chatbot_enabled: "false",
    wa_payment_detect: "true",
    wa_cleanup_enabled: "true",
    wa_monitor_enabled: "false",
    foto_compression_quality: "0.70", // 30%-100%, default 70%
  });

  // ── Settings: _ls HARUS dideklarasi SEBELUM useState yang memakainya ──
  const _ls = (key, def) => {
    try {
      const v = localStorage.getItem("aclean_" + key);
      if (v === null) return def;
      const parsed = JSON.parse(v);
      // Jika default adalah string tapi tersimpan sebagai array (versi lama), convert
      if (typeof def === "string" && Array.isArray(parsed)) return parsed.join("\n");
      if (typeof def === "string" && typeof parsed !== "string") return def;
      return parsed;
    } catch { return def; }
  };
  const _lsSave = (key, val) => { try { localStorage.setItem("aclean_" + key, JSON.stringify(val)); } catch { } };
  // SEC-02: internal API token — di-exchange saat login, cached di memory (tidak di localStorage/bundle)
  const _internalTokenRef = useRef(null);
  const _apiHeaders = async () => {
    if (!_internalTokenRef.current) {
      try {
        const { data } = await supabase.auth.getSession();
        const jwt = data?.session?.access_token;
        if (jwt) {
          const r = await fetch("/api/get-api-token", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` }
          });
          if (r.ok) {
            const d = await r.json();
            if (d.token) _internalTokenRef.current = d.token;
          }
        }
      } catch { /* gagal silent — request tetap jalan tanpa token */ }
    }
    return {
      "Content-Type": "application/json",
      ...(_internalTokenRef.current ? { "X-Internal-Token": _internalTokenRef.current } : {})
    };
  };
  // SEC-07: brute force states — harus setelah _ls didefinisikan
  const [loginAttempts, setLoginAttempts] = useState(() => _ls("loginAttempts", 0));
  const [lockoutUntil, setLockoutUntil] = useState(() => _ls("lockoutUntil", 0));

  // ── Settings state ──
  const [waProvider, setWaProvider] = useState(() => _ls("waProvider", "fonnte"));
  // B.5 SECURITY: WA token di sessionStorage (tidak persistent) daripada localStorage
  const [waToken, setWaToken] = useState(() => sessionStorage.getItem("aclean_waToken") || "");
  const [waDevice, setWaDevice] = useState(() => _ls("waDevice", ""));
  const [waStatus, setWaStatus] = useState("not_connected");

  // ── LLM Settings: Load from backend endpoint instead of localStorage ──
  // SECURITY FIX: Never store API keys in localStorage
  // Backend endpoint /api/get-llm-config returns available providers & default
  const [llmProvider, setLlmProvider] = useState(() => _ls("llmProvider", "claude"));
  const [llmModel, setLlmModel] = useState(() => { const p = _ls("llmProvider", "claude"); const m = _ls("llmModel", ""); if (m) return m; return p === "minimax" ? "MiniMax-M2.5" : "claude-haiku-4-5-20251001"; });
  const [llmConfig, setLlmConfig] = useState(null); // stores backend response
  const [availableProviders, setAvailableProviders] = useState([]);
  const [ollamaUrl, setOllamaUrl] = useState(() => _ls("ollamaUrl", "http://localhost:11434"));
  const [llmApiKey, setLlmApiKey] = useState(""); // session-only, NEVER persisted to localStorage
  const [llmStatus, setLlmStatus] = useState(() => _ls("llmStatus", "not_connected"));
  const [storageProvider, setStorageProvider] = useState("r2");
  const [storageStatus, setStorageStatus] = useState("not_connected");
  const [dbProvider, setDbProvider] = useState("supabase");
  const [brainMdCustomer, setBrainMdCustomer] = useState(() => {
    const val = _ls("brainMdCustomer", "");
    if (Array.isArray(val)) return val.join("\n");
    if (typeof val !== "string") return "";
    return val;
  });
  const [modalBrainCustomerEdit, setModalBrainCustomerEdit] = useState(false);
  const [brainMd, setBrainMd] = useState(() => {
    const val = _ls("brainMd", BRAIN_MD_DEFAULT);
    // Sanitize: jika tersimpan sebagai array dari versi lama, convert ke string
    if (Array.isArray(val)) return val.join("\n");
    if (typeof val !== "string") return BRAIN_MD_DEFAULT;
    return val;
  });

  // ── Cron jobs ──
  const [cronJobs, setCronJobs] = useState([
    { id: 1, name: "Payment Reminder",  icon: "📨", time: "10:00", days: "Setiap Hari", active: true,  backendKey: "invoice_reminder_enabled", task: "Kirim WA pengingat ke customer invoice UNPAID/OVERDUE (hari ke-1–7, 8–14, 15–21)" },
    { id: 2, name: "Laporan Harian",    icon: "📊", time: "18:00", days: "Setiap Hari", active: true,  backendKey: "daily_report_enabled",      task: "Ringkasan order & pemasukan hari ini ke Owner via WA" },
    { id: 3, name: "Laporan Mingguan",  icon: "📅", time: "20:00", days: "Sabtu",       active: true,  backendKey: null,                        task: "Rekap mingguan order & pendapatan ke Owner via WA" },
    { id: 4, name: "Overdue Detection", icon: "🔔", time: "17:05", days: "Setiap Hari", active: true,  backendKey: null,                        task: "Tandai invoice UNPAID melewati due date menjadi OVERDUE" },
    { id: 5, name: "Stok Alert",        icon: "⚠️", time: "08:00", days: "Setiap Hari", active: true,  backendKey: "stock_alert_enabled",       task: "Cek stok inventory HABIS/KRITIS & notif Owner via WA" },
  ]);

  // ── Tanggal dinamis ──
  const TODAY = getLocalDate();
  const todayDate = new Date();
  const hariIni = todayDate.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const bulanIni = todayDate.toISOString().slice(0, 7); // "2026-03"
  const [weekOffset, setWeekOffset] = useState(0); // 0=minggu ini, -1=minggu lalu, +1=minggu depan
  const [searchSchedule, setSearchSchedule] = useState(""); // BUG-4: search jadwal

  // ── WA Conversations reaktif ──
  const [waConversations, setWaConversations] = useState(WA_CONVERSATIONS);
  const [waMessages, setWaMessages] = useState([]);  // chat history conv aktif
  const [paymentSuggestions, setPaymentSuggestions] = useState([]);
  const [paymentSuggestBanner, setPaymentSuggestBanner] = useState(null);

  // ── Statistik periode filter ──
  const [statsPeriod, setStatsPeriod] = useState("bulan"); // "hari"|"minggu"|"bulan"|"tahun"|"custom"
  const [statsDateFrom, setStatsDateFrom] = useState(""); // untuk custom range
  const [statsDateTo, setStatsDateTo] = useState(""); // untuk custom range
  const [statsMingguOff, setStatsMingguOff] = useState(0);  // 0=minggu ini, -1=minggu lalu, dst

  // ── Mobile detection (MUST be before any conditional returns) ──
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // ── Notification ──
  const [notification, setNotification] = useState(null);
  const notifTimer = useRef(null);
  // G8 FIX: Browser push notification support
  const requestPushPermission = async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  };
  // GAP-7: jalankan check stuck jobs — 30 menit jam kerja, OFF luar jam kerja
  const stuckCheckTimer = useRef(null);
  const startStuckCheck = () => {
    if (stuckCheckTimer.current) clearInterval(stuckCheckTimer.current);
    if (isWorkingHours()) {
      stuckCheckTimer.current = setInterval(() => {
        checkStuckJobs();
      }, 30 * 60 * 1000); // 30 menit jam kerja
    }
  };
  const pushNotif = (title, body, icon = "⬡") => {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, icon: "/favicon.ico", tag: "aclean-" + Date.now() });
      } catch (e) { }
    }
  };
  const showNotif = (msg, push = false) => {
    setNotification(msg);
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
    if (push) pushNotif("AClean", msg.replace(/[🔔📋✅❌⚠️💰]/g, "").trim());
  };

  // ── FORCE RELOAD PRICE LIST: dipanggil dari tombol "Sync Harga" di panel ARA ──
  const forceReloadPriceList = async () => {
    try {
      const { data, error } = await fetchPriceList(supabase);
      if (error) { showNotif("❌ Gagal sync harga: " + error.message); return; }
      if (!data || data.length === 0) { showNotif("⚠️ Tabel price_list kosong di Supabase"); return; }
      setPriceListData(data);
      const activePL = data.filter(r => r.is_active !== false);
      PRICE_LIST = buildPriceListFromDB(activePL);
      setPriceListSyncedAt(new Date());
      showNotif("✅ Harga berhasil di-sync dari Supabase (" + data.length + " item)");
      addAgentLog("PRICELIST_SYNC", "Force reload price list: " + data.length + " item", "SUCCESS");
    } catch (e) {
      showNotif("❌ Error sync: " + e.message);
    }
  };

  // ── GAP-7: Cek job stuck — kirim reminder ke teknisi jika laporan belum masuk 1 jam setelah selesai ──
  const checkStuckJobs = async () => {
    // ── SLA CHECK: alert jika teknisi belum ON_SITE 30 menit setelah jam booking ──
    const now2 = new Date();
    const slaAlerts = ordersData.filter(o => {
      if (o.status !== "DISPATCHED" && o.status !== "CONFIRMED") return false;
      if (!o.date || !o.time || o.date > TODAY) return false;
      const bookingMs = (o.date && o.time ? new Date(o.date + "T" + o.time + ":00").getTime() : 0);
      const menit30 = 30 * 60 * 1000;
      // Sudah lebih dari 30 menit dari jam booking tapi belum ON_SITE
      return (now2.getTime() > bookingMs + menit30) && o.date === TODAY;
    });
    if (slaAlerts.length > 0) {
      slaAlerts.forEach(o => {
        const alreadyAlerted = agentLogs.some(l =>
          l.action === "SLA_ALERT" && (l.detail || "").includes(o.id)
          && (Date.now() - new Date(l.created_at || 0).getTime()) < 2 * 60 * 60 * 1000
        );
        if (!alreadyAlerted) {
          addAgentLog("SLA_ALERT",
            `⚠️ SLA: ${o.teknisi} belum konfirmasi tiba — ${o.id} ${o.customer} jam ${o.time}`,
            "WARNING"
          );
          showNotif(`⚠️ SLA: ${o.teknisi} belum di lokasi ${o.customer} (booking ${o.time})`, true);
          // Kirim WA Owner
          const owners = [...(teknisiData || []), ...(userAccounts || [])].filter(u => u.role === "Owner" && u.phone);
          const slaMsg = `⚠️ *SLA ALERT*\n📋 ${o.id}\n👤 ${o.customer}\n👷 ${o.teknisi || "-"}\n⏰ Booking: ${o.time} — belum konfirmasi tiba`;
          owners.forEach(ow => sendWA(ow.phone, slaMsg));
        }
      });
    }
    const nowMs = Date.now();
    const stuckOrders = ordersData.filter(o => {
      if (!["DISPATCHED", "ON_SITE"].includes(o.status)) return false;
      if (!o.date || !o.time_end) return false;
      // Sudah lewat tanggal job
      if (o.date > TODAY) return false;
      // Hitung estimasi selesai
      const [h, m] = (o.time_end || "17:00").split(":").map(Number);
      const jobEndMs = (o.date && o.time_end ? new Date(o.date + "T" + o.time_end + ":00").getTime() : 0);
      const satu_jam = 60 * 60 * 1000;
      // Sudah lebih dari 1 jam setelah selesai
      return nowMs > (jobEndMs + satu_jam);
    });

    for (const o of stuckOrders) {
      // Cek apakah sudah ada laporan
      const sudahAda = laporanReports.find(r => r.job_id === o.id);
      if (sudahAda) continue;
      // Cek apakah reminder sudah dikirim (pakai agent_logs)
      const sudahReminder = agentLogs.find(l =>
        l.action === "LAPORAN_REMINDER" && l.detail?.includes(o.id)
      );
      if (sudahReminder) continue;

      // Kirim WA reminder ke teknisi
      const tek = teknisiData.find(t => t.name === o.teknisi);
      if (tek?.phone) {
        const msg = `⏰ *Reminder Laporan*

Halo ${o.teknisi}, job *${o.id}* (${o.customer} — ${o.service}) sudah selesai lebih dari 1 jam.

Mohon segera submit laporan di aplikasi AClean ya! 🙏`;
        if (tek?.phone) sendWA(tek.phone, msg);
      }
      addAgentLog("LAPORAN_REMINDER", `Reminder laporan dikirim ke ${o.teknisi} — ${o.id}`, "WARNING");
    }
  };

  // ── Laporan Helper Constants — sesuai standar AClean ──
  const KONDISI_SBL = [
    "AC Normal",
    "AC Tidak Dingin",
    "AC Bau Tidak Sedap",
    "AC Bocor Air",
    "AC Bunyi Berisik",
    "AC Tidak Menyala",
    "Freon Habis/Kurang",
    "Kompresor Bermasalah",
  ];
  const KONDISI_SDH = [
    "AC Dingin Kembali",
    "AC Masih Terkendala",
    "Perlu Pergantian Sparepart",
    "AC Rusak Perlu Pergantian Unit",
    "Semua Fungsi Normal",
    "Perlu Test Press",
    "Perlu Pengisian Freon",
    "Perlu Service Besar",
    "Perlu Pergantian Parts",
  ];
  const PEKERJAAN_BY_SERVICE = {
    Cleaning: [
      "Service Cleaning",
      "Deep Cleaning (Service Besar)",
      "Cleaning Indoor dan Outdoor",
      "Kuras Vacum Freon",
      "Penambahan Freon",
      "Bersihkan Drain / Talang",
      "Pemasangan Sparepart",
      "Pekerjaan Lainnya",
    ],
    Install: [
      "Pemasangan Unit",
      "Bongkar Pasang Unit",
      "Pasang Unit Indoor",
      "Pasang Unit Outdoor",
      "Pasang Bracket",
      "Instalasi Pipa",
      "Instalasi Kabel",
      "Uji Coba Unit",
      "Pekerjaan Lainnya",
    ],
    Repair: [
      "Service Cleaning",
      "Kuras Vacum Freon",
      "Penambahan Freon",
      "Bersihkan Drain / Talang",
      "Pemasangan Sparepart",
      "Ganti Kapasitor",
      "Ganti Relay / Thermostat",
      "Ganti PCB / Modul",
      "Perbaiki Pipa Bocor",
      "Pekerjaan Lainnya",
    ],
    Complain: [
      "Service Cleaning",
      "Penambahan Freon",
      "Bersihkan Drain / Talang",
      "Pemasangan Sparepart",
      "Pengecekan Ulang",
      "Cek Instalasi Pipa",
      "Cek Kelistrikan",
      "Follow Up Komplain",
      "Garansi Servis",
      "Pekerjaan Lainnya",
    ],
  };
  const PEKERJAAN_OPT = (svc) => PEKERJAAN_BY_SERVICE[svc] || PEKERJAAN_BY_SERVICE["Cleaning"];
  // ── MATERIAL_PRESET: quick-add di STEP 3 (Service/Repair/Complain) ──
  const MATERIAL_PRESET = {
    Cleaning: [
      { nama: "Freon R-22", satuan: "KG" },
      { nama: "Freon R-32", satuan: "KG" },
      { nama: "Freon R-410A", satuan: "KG" },
      { nama: "Sparepart Kapasitor Fan", satuan: "Piece" },
      { nama: "Thermis Indoor", satuan: "Piece" },
    ],
    Repair: [
      { nama: "Freon R-22", satuan: "KG" },
      { nama: "Freon R-32", satuan: "KG" },
      { nama: "Freon R-410A", satuan: "KG" },
      { nama: "Sparepart Kapasitor Fan", satuan: "Piece" },
      { nama: "Thermis Indoor", satuan: "Piece" },
      { nama: "Remote AC Multi", satuan: "Unit" },
      { nama: "REMOTE AC DAIKIN", satuan: "Piece" },
      { nama: "Steker Colokan", satuan: "Piece" },
    ],
    Complain: [
      { nama: "Freon R-22", satuan: "KG" },
      { nama: "Freon R-32", satuan: "KG" },
      { nama: "Freon R-410A", satuan: "KG" },
    ],
  };
  // ── INSTALL_ITEMS: preset form instalasi ──
  const INSTALL_ITEMS = [
    { key: "jasa_ganti_instalasi", label: "Jasa Pergantian Instalasi AC", satuan: "Unit", default: 0 },
    { key: "pasang_05_1pk", label: "Pemasangan AC Baru 0,5PK - 1PK", satuan: "Unit", default: 0 },
    { key: "pasang_15_2pk", label: "Pemasangan AC Baru 1,5PK - 2PK", satuan: "Unit", default: 0 },
    { key: "bongkar_05_1pk", label: "Bongkar Unit AC 0.5-1PK", satuan: "Unit", default: 0 },
    { key: "bongkar_15_25pk", label: "Bongkar Unit AC 1.5-2.5PK", satuan: "Unit", default: 0 },
    { key: "vacum_05_25pk", label: "Jasa Vacum AC 0,5PK - 2,5PK", satuan: "Unit", default: 0 },
    { key: "pipa_1pk", label: "Pipa AC Hoda 1PK", satuan: "Meter", default: 0 },
    { key: "pipa_2pk", label: "Pipa AC Hoda 2PK", satuan: "Meter", default: 0 },
    { key: "pipa_25pk", label: "Pipa AC Hoda 2,5PK", satuan: "Meter", default: 0 },
    { key: "pipa_3pk", label: "Pipa AC Hoda 3PK", satuan: "Meter", default: 0 },
    { key: "kabel_15", label: "Kabel Eterna 3x1,5", satuan: "Meter", default: 0 },
    { key: "kabel_25", label: "Kabel Eterna 3x2,5", satuan: "Meter", default: 0 },
    { key: "ducttape_biasa", label: "Duct Tape Non Lem", satuan: "Piece", default: 0 },
    { key: "ducttape_lem", label: "Duct Tape Lem", satuan: "Piece", default: 0 },
    { key: "jasa_pipa_ac", label: "Jasa Penarikan Pipa AC", satuan: "Meter", default: 0 },
    { key: "jasa_pipa_ruko", label: "Jasa Penarikan Pipa Ruko", satuan: "Meter", default: 0 },
    { key: "dinabolt", label: "DINABOLT Set", satuan: "Set", default: 0 },
    { key: "karet_mounting", label: "KARET MOUNTING", satuan: "Set", default: 0 },
    { key: "breket_outdoor", label: "Breket Outdoor", satuan: "Piece", default: 0 },
    { key: "kuras_vacum_r32", label: "Kuras Vacum + Isi Freon R32/R410", satuan: "Unit", default: 0 },
    { key: "kuras_vacum_r22", label: "Kuras Vacum Freon R22", satuan: "Unit", default: 0 },
    { key: "freon_r22", label: "Freon R-22", satuan: "KG", default: 0 },
    { key: "freon_r32", label: "Freon R-32", satuan: "KG", default: 0 },
    { key: "freon_r410", label: "Freon R-410A", satuan: "KG", default: 0 },
  ];
  const TIPE_AC_OPT = [
    "AC Split 0.5PK",
    "AC Split 0.75PK",
    "AC Split 1PK",
    "AC Split 1.5PK",
    "AC Split 2PK",
    "AC Split 2.5PK",
    "AC Split 3PK",
    "AC Cassette 2PK",
    "AC Cassette 2.5PK",
    "AC Cassette 3PK",
    "AC Cassette 3.5PK",
    "AC Cassette 4PK",
    "AC Cassette 4.5PK",
    "AC Cassette 5PK",
    "AC Cassette 6PK",
    "AC Split Duct 2PK",
    "AC Split Duct 3PK",
    "AC Split Duct 4PK",
    "AC Split Duct 5PK"
  ];
  const SATUAN_OPT = ["pcs", "kg", "liter", "meter", "set", "titik", "roll"];

  const mkUnit = (no, hist = null) => {
    if (hist) {
      // Preset dari history: copy tipe, merk, pk, model dari unit history
      return {
        unit_no: no,
        label: hist.label || `Unit ${no}`,
        tipe: TIPE_AC_OPT.includes(hist.tipe) ? hist.tipe : "",
        merk: hist.merk || "",
        pk: hist.pk || "1PK",
        model: hist.model || "",
        kondisi_sebelum: [],
        kondisi_setelah: [],
        pekerjaan: [],
        freon_ditambah: "",
        ampere_akhir: "",
        catatan_unit: "",
        from_history_job_id: hist.from_history_job_id || null
      };
    }
    return {
      unit_no: no,
      label: `Unit ${no}`,
      tipe: "",
      merk: "",
      pk: "1PK",
      model: "",
      kondisi_sebelum: [],
      kondisi_setelah: [],
      pekerjaan: [],
      freon_ditambah: "",
      ampere_akhir: "",
      catatan_unit: "",
      from_history_job_id: null
    };
  };
  // isUnitDone untuk Step 2: cek pekerjaan + kondisi (tipe & pk sudah di Step 1)
  const isUnitDone = (u) => u.pekerjaan.length > 0 && (u.kondisi_sebelum.length > 0 || u.kondisi_setelah.length > 0);
  const compressImg = (file, quality = 0.70) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280; // max dimension px — cukup detail untuk dokumentasi servis
        const sc = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * sc);
        const h = Math.round(img.height * sc);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        // Quality adjustable dari settings (default 0.70 = 70% JPEG — hemat ~78% ukuran vs original)
        const dataUrl = c.toDataURL("image/jpeg", quality);
        const sizeKB = Math.round((dataUrl.length * 3 / 4) / 1024);
        res(dataUrl);
      };
      img.onerror = () => rej(new Error("Invalid image file"));
      img.src = e.target.result;
    };
    r.onerror = () => rej(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });

  // Helper: normalize URL foto → selalu proxy via /api/foto
  // /api/foto melakukan AWS Sig V4 signing ke R2 private endpoint
  // Ini memastikan foto tampil meskipun R2 public access belum diaktifkan
  const fotoSrc = (url) => {
    if (!url) return "";
    // Sudah pakai proxy → langsung
    if (url.startsWith("/api/foto")) return url;
    // Plain path (laporan/JOB-ID/file.jpg) → proxy via /api/foto
    if (url.startsWith("laporan/")) {
      return "/api/foto?key=" + encodeURIComponent(url);
    }
    // URL r2.dev atau r2.cloudflarestorage.com → extract key → proxy
    if (url.includes(".r2.dev/")) {
      const keyMatch = url.match(/\.r2\.dev\/(.+)$/);
      if (keyMatch) return "/api/foto?key=" + encodeURIComponent(keyMatch[1]);
    }
    if (url.includes(".r2.cloudflarestorage.com/")) {
      const keyMatch = url.match(/cloudflarestorage\.com\/[^/]+\/(.+)$/);
      if (keyMatch) return "/api/foto?key=" + encodeURIComponent(keyMatch[1]);
    }
    // Supabase storage → langsung (tidak perlu proxy)
    if (url.includes("supabase")) return url;
    // Fallback → langsung
    return url;
  };

  // ── Generate & Download Invoice PDF (pakai browser print API) ──
  // ── Download Rekap Harian (Orders + Invoice) ke CSV/Excel ──
  // ── Trigger auto-rekap manual via Edge Function ──
  const triggerRekapHarian = async (targetDate) => {
    const tgl = targetDate || TODAY;
    showNotif("⏳ Mengirim rekap ke WhatsApp Owner...");
    try {
      const res = await fetch(
        `/api/cron-reminder?task=daily&date=${tgl}`,
        { method: "POST", headers: await _apiHeaders() }
      );
      const data = await res.json();
      if (data.ok) {
        showNotif(data.waSent
          ? `✅ Rekap ${tgl} terkirim ke WA Owner!`
          : `⚠️ Rekap dibuat tapi WA gagal dikirim`
        );
        addAgentLog("MANUAL_REKAP", `Rekap manual ${tgl} dipicu oleh ${currentUser?.name}`, data.waSent ? "SUCCESS" : "WARNING");
      } else {
        showNotif("❌ Gagal generate rekap: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      showNotif("❌ Error: " + err.message);
    }
  };

  const downloadRekapHarian = (targetDate) => {
    const tgl = targetDate || TODAY;
    const fmt2 = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
    const tglLabel = new Date(tgl + "T00:00:00").toLocaleDateString("id-ID",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    // ── Sheet 1: Rekap Pekerjaan ──
    const ordersHariIni = ordersData.filter(o => o.date === tgl);
    const orderHeaders = ["No", "Job ID", "Customer", "No HP", "Layanan", "Unit", "Teknisi", "Helper",
      "Status", "Jam", "Alamat", "Catatan"];
    const orderRows = ordersHariIni.map((o, i) => [
      i + 1,
      o.id || "-",
      `"${(o.customer || "").replace(/"/g, '""')}"`,
      o.phone || "-",
      o.service || "-",
      o.units || 1,
      o.teknisi || "-",
      o.helper || "-",
      o.status || "-",
      o.time || "-",
      `"${(o.address || "").replace(/"/g, '""')}"`,
      `"${(o.notes || "").replace(/"/g, '""')}"`,
    ]);

    // ── Sheet 2: Rekap Invoice ──
    const invoicesHariIni = invoicesData.filter(i =>
      (i.created_at || "").slice(0, 10) === tgl || (i.paid_at || "").slice(0, 10) === tgl
    );
    const invHeaders = ["No", "Invoice ID", "Customer", "No HP", "Layanan", "Total", "Status",
      "Teknisi", "Tgl Dibuat", "Tgl Bayar", "Metode Bayar"];
    const invRows = invoicesHariIni.map((inv, i) => [
      i + 1,
      inv.id || "-",
      `"${(inv.customer || "").replace(/"/g, '""')}"`,
      inv.phone || "-",
      `"${(inv.service || "").replace(/"/g, '""')}"`,
      inv.total || 0,
      inv.status || "-",
      inv.teknisi || "-",
      inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID") : "-",
      inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("id-ID") : "-",
      inv.paid_method || "-",
    ]);

    // ── Hitung summary ──
    const totalOrder = ordersHariIni.length;
    const totalSelesai = ordersHariIni.filter(o => ["COMPLETED", "REPORT_SUBMITTED", "VERIFIED"].includes(o.status)).length;
    const totalOmset = invoicesHariIni.filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
    const totalInvBaru = invoicesHariIni.filter(i => i.created_at?.slice(0, 10) === tgl).length;

    // ── Build CSV ──
    const bom = "﻿";
    const sep = "\n";
    const rows = [];

    // Header dokumen
    rows.push(`"REKAP HARIAN ACLEAN SERVICE AC"`);
    rows.push(`"Tanggal: ${tglLabel}"`);
    rows.push(`"Digenerate: ${new Date().toLocaleString("id-ID")}"`);
    rows.push("");

    // Summary
    rows.push(`"=== RINGKASAN ==="`);
    rows.push(`"Total Order Hari Ini","${totalOrder}"`);
    rows.push(`"Order Selesai","${totalSelesai}"`);
    rows.push(`"Invoice Dibuat Hari Ini","${totalInvBaru}"`);
    rows.push(`"Total Omset Terbayar","${fmt2(totalOmset)}"`);
    rows.push("");

    // Rekap pekerjaan
    rows.push(`"=== REKAP PEKERJAAN (${ordersHariIni.length} order) ==="`);
    rows.push(orderHeaders.join(","));
    orderRows.forEach(r => rows.push(r.join(",")));
    rows.push("");

    // Rekap invoice
    rows.push(`"=== REKAP INVOICE (${invoicesHariIni.length} invoice) ==="`);
    rows.push(invHeaders.join(","));
    invRows.forEach(r => rows.push(r.join(",")));
    rows.push("");

    // Per teknisi
    const perTek = {};
    ordersHariIni.forEach(o => {
      if (o.teknisi) {
        if (!perTek[o.teknisi]) perTek[o.teknisi] = { order: 0, selesai: 0, omset: 0 };
        perTek[o.teknisi].order++;
        if (["COMPLETED", "REPORT_SUBMITTED", "VERIFIED"].includes(o.status))
          perTek[o.teknisi].selesai++;
      }
    });
    invoicesHariIni.filter(i => i.status === "PAID").forEach(i => {
      if (i.teknisi && perTek[i.teknisi])
        perTek[i.teknisi].omset += (i.total || 0);
    });
    if (Object.keys(perTek).length > 0) {
      rows.push(`"=== REKAP PER TEKNISI ==="`);
      rows.push(`"Teknisi","Total Order","Selesai","Omset Terbayar"`);
      Object.entries(perTek).sort((a, b) => b[1].omset - a[1].omset).forEach(([name, d]) => {
        rows.push(`"${name}",${d.order},${d.selesai},"${fmt2(d.omset)}"`);
      });
    }

    const blob = new Blob([bom + rows.join(sep)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rekap_Harian_AClean_${tgl}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addAgentLog("EXPORT_REKAP", `Rekap harian ${tgl} didownload oleh ${currentUser?.name || "Owner"}`, "SUCCESS");
    showNotif(`✅ Rekap ${tglLabel} berhasil didownload!`);
  };

  // Build invoice HTML string — reused by PDF download AND WA attachment upload
  // logoUrl: base64 data URL atau null (fallback ke teks merek)
  // forWA: true = hapus script print otomatis (untuk link WA, bukan download)
  const buildInvoiceHTML = (inv, logoUrl = null, forWA = false) => {
    const fmt2 = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
    const perUnit = inv.units > 0 ? Math.round((inv.labor || 0) / inv.units) : (inv.labor || 0);

    // Build material rows HTML (di luar template literal agar tidak ada backtick conflict)
    // Build material rows HTML (di luar template literal agar tidak ada backtick conflict)
    // Parse materials_detail — bisa array (sudah parsed) atau string JSON dari DB
    const matDetails = (() => {
      const md = inv.materials_detail;
      if (!md) return [];
      if (Array.isArray(md)) return md;
      try { return JSON.parse(md); } catch (_) { return []; }
    })();
    let matRowsHtml = "";
    if (matDetails.length > 0) {
      // Per-item: setiap material = 1 baris di tabel
      // Group items by category — support both new (keterangan field) and old invoices (detect by nama)
      // Helper: detect kategori dari nama item jika keterangan kosong
      const detectKat = (m) => {
        if (m.keterangan === "jasa") return "jasa";
        if (m.keterangan === "repair") return "repair";
        if (m.keterangan === "freon") return "freon";
        const n = (m.nama || "").toLowerCase();
        // Freon / kuras vacum — by nama (diperluas)
        if (["freon", "kuras vacum", "kuras+vacum", "r32", "r410", "r22"].some(k => n.includes(k))) return "freon";
        // Repair/perbaikan — by nama (cek lebih dulu dari jasa)
        const repairNames = ["repair", "perbaikan", "kapasitor", "kompresor", "sparepart", "pcb",
          "modul", "overload", "sensor", "ganti", "penggantian", "spare part"];
        if (repairNames.some(k => n.includes(k))) return "repair";
        // Jasa — by nama pattern
        const jasaNames = ["cleaning", "jasa vacum", "jasa pemasangan", "jasa perbaikan", "jasa servis",
          "jasa", "service", "servis", "pemasangan ac", "bongkar ac", "biaya pengecekan",
          "service besar", "complain", "pasang", "instalasi"];
        if (jasaNames.some(k => n.includes(k))) return "jasa";
        // Install material — pipa, kabel, breket, insulasi, duct tape
        const matNames = ["pipa", "kabel", "insulasi", "breket", "duct tape", "ducttape", "selang"];
        if (matNames.some(k => n.includes(k))) return "mat";
        // Default: jika ada harga dan di invoice jasa — anggap jasa
        return "jasa";
      };
      const jasaRows = matDetails.filter(m => detectKat(m) === "jasa");
      const repairRows = matDetails.filter(m => detectKat(m) === "repair");
      const freonRows = matDetails.filter(m => detectKat(m) === "freon");
      const matRows = matDetails.filter(m => detectKat(m) === "mat");

      const addSectionHeader = (label, color) => {
        matRowsHtml += '<tr style="background:' + color + '10">' +
          '<td colspan="4" style="padding:5px 12px;font-size:10px;font-weight:800;color:' + color + ';' +
          'text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ' + color + '33">' +
          label + '</td></tr>';
      };
      const addRow = (m) => {
        const hSatFix = m.harga_satuan > 0 ? m.harga_satuan
          : (m.subtotal > 0 && m.jumlah > 0 ? Math.round(m.subtotal / m.jumlah) : 0);
        const hSatStr = hSatFix > 0 ? hSatFix.toLocaleString("id-ID") : "—";
        const subStr = m.subtotal > 0 ? m.subtotal.toLocaleString("id-ID")
          : (hSatFix > 0 && m.jumlah > 0 ? (hSatFix * m.jumlah).toLocaleString("id-ID") : "—");
        matRowsHtml +=
          "<tr>" +
          "<td>" + escHtml(m.nama) + "</td>" +
          '<td style="text-align:right;width:72px;white-space:nowrap">' + escHtml(String(m.jumlah)) + " " + escHtml(m.satuan || "") + "</td>" +
          '<td style="text-align:right;font-family:monospace">' + hSatStr + "</td>" +
          '<td style="text-align:right;font-family:monospace;font-weight:600">' + subStr + "</td>" +
          "</tr>";
      };

      if (jasaRows.length > 0) {
        addSectionHeader("⚡ Jasa / Layanan", "#3b82f6");
        jasaRows.forEach(addRow);
      }
      if (repairRows.length > 0) {
        addSectionHeader("🔩 Repair / Perbaikan", "#f59e0b");
        repairRows.forEach(addRow);
      }
      if (matRows.length > 0) {
        addSectionHeader("🔧 Material / Sparepart", "#10b981");
        matRows.forEach(addRow);
      }
      if (freonRows.length > 0) {
        addSectionHeader("❄️ Freon / Kuras Vacum", "#06b6d4");
        freonRows.forEach(addRow);
      }
      // Fallback: ada item tapi tidak terklasifikasi
      const otherRows = matDetails.filter(m =>
        !jasaRows.includes(m) && !repairRows.includes(m) && !matRows.includes(m) && !freonRows.includes(m)
      );
      if (otherRows.length > 0) { otherRows.forEach(addRow); }

      // CRITICAL: jika inv.material > 0 tapi tidak ada di matDetails (invoice lama)
      // Tampilkan sebagai baris material/freon tambahan
      const matDetailTotal = matDetails.reduce((s, m) => s + (m.subtotal || 0), 0);
      const invMaterial = inv.material || 0;
      const matNotInDetail = invMaterial > 0 && matDetailTotal < invMaterial - 1000;
      if (matNotInDetail) {
        const remainMat = invMaterial - matDetails.filter(m => detectKat(m) !== "jasa" && detectKat(m) !== "repair").reduce((s, m) => s + (m.subtotal || 0), 0);
        if (remainMat > 0) {
          addSectionHeader("❄️ Material / Freon", "#06b6d4");
          matRowsHtml +=
            "<tr><td style=\"color:#475569;font-style:italic\">Material &amp; Freon</td>" +
            "<td style=\"text-align:right\">—</td><td style=\"text-align:right\">—</td>" +
            "<td style=\"text-align:right;font-family:monospace;font-weight:600\">" +
            remainMat.toLocaleString("id-ID") + "</td></tr>";
        }
      }
    } else if ((inv.material || 0) > 0) {
      // Fallback invoice lama: materials_detail kosong tapi ada inv.material
      // Reconstruct dari inv.material → tampilkan sebagai material/freon row
      matRowsHtml =
        '<tr style="background:#06b6d410"><td colspan="4" style="padding:5px 12px;font-size:10px;font-weight:800;color:#06b6d4;text-transform:uppercase;letter-spacing:1px">❄️ Material / Freon</td></tr>' +
        '<tr style="background:#f8fafc">' +
        '<td style="color:#475569;font-style:italic">Material &amp; Freon (total)</td>' +
        '<td style="text-align:right;color:#94a3b8">—</td>' +
        '<td style="text-align:right;color:#94a3b8">—</td>' +
        '<td style="text-align:right;font-family:monospace;font-weight:600">' +
        (inv.material || 0).toLocaleString("id-ID") + "</td></tr>";
    }
    const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Invoice ${inv.id} — ${appSettings.company_name}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; background: #fff; }
  .page { width: 794px; min-height: 1123px; margin: 0 auto; padding: 40px; }
  .header { background: #fff; border-radius: 8px; overflow: hidden; margin-bottom: 20px; box-shadow: 0 2px 12px rgba(30,91,168,0.12); border: 2px solid #1E5BA8; }
  .header-top { padding: 24px 28px; display: flex; justify-content: space-between; align-items: center; }
  .brand { font-size: 26px; font-weight: 900; color: #1E5BA8; letter-spacing: -0.5px; }
  .brand span { color: #1E5BA8; }
  .brand-sub { font-size: 12px; color: #6b7280; margin-top: 4px; font-weight: 500; }
  .inv-badge { background: #1E5BA8; color: #fff; padding: 8px 16px; border-radius: 6px; font-family: monospace; font-weight: 900; font-size: 16px; box-shadow: 0 2px 4px rgba(30,91,168,0.15); }
  .inv-label { font-size: 10px; color: #1E5BA8; font-weight: 700; text-align: right; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .header-sub { background: #f0f4f8; padding: 12px 28px; font-size: 11px; color: #1e293b; display: flex; gap: 28px; border-top: 1px solid #e2e8f0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .box { border-radius: 8px; padding: 14px 16px; }
  .box-blue { background: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px; }
  .box-white { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
  .box-title { font-size: 11px; font-weight: 900; color: #1E5BA8; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.6px; }
  .row { display: flex; gap: 8px; margin-bottom: 4px; }
  .row-label { color: #64748b; min-width: 90px; }
  .row-val { color: #1e293b; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  thead tr { background: #1E5BA8; }
  thead th { padding: 12px 12px; text-align: left; color: #fff; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 10px 12px; color: #1e293b; border-bottom: 1px solid #f1f5f9; }
  .total-row { background: #1E5BA8 !important; }
  .total-row td { color: #fff !important; font-weight: 800; font-size: 14px; border: none; padding: 12px; }
  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .bank-box { background: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px; padding: 14px 16px; }
  .bank-num { font-weight: 800; font-size: 16px; color: #1e293b; margin: 4px 0; }
  .status-box { border-radius: 8px; padding: 14px 16px; }
  .footer-note { text-align: center; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px; }
  .status-paid { background: #F0FDF4; border: 1px solid #86efac; }
  .status-unpaid { background: #FFFBEB; border: 1px solid #fde68a; }
  .status-overdue { background: #FEF2F2; border: 1px solid #fca5a5; }
  .garansi-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 10px 16px; margin-bottom: 16px; font-size: 11px; color: #166534; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 20px; }
  }
  @page {
    size: A4;
    margin: 10mm 12mm;
  }
</style>
</head>
<body>
<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div style="display:flex;align-items:center;gap:14px">
        ${logoUrl
          ? `<div style="background:#fff;border-radius:8px;padding:4px 8px;display:inline-flex;align-items:center;justify-content:center;min-width:56px;height:56px"><img src="${logoUrl}" alt="AClean" style="height:48px;max-width:140px;width:auto;object-fit:contain;display:block" /></div>`
          : ``}
        <div>
          <div class="brand">AClean Service</div>
          <div class="brand-sub">Jasa Servis &amp; Perawatan AC Profesional</div>
        </div>
      </div>
      <div>
        <div class="inv-label">INVOICE</div>
        <div class="inv-badge">${inv.id}</div>
      </div>
    </div>
    <div class="header-sub">
      <span>📍 ${escHtml(appSettings.company_addr)}</span>
      <span>📞 ${escHtml(appSettings.wa_number)}</span>
      <span>🏦 ${escHtml(appSettings.bank_name)} ${escHtml(appSettings.bank_number)} a.n. ${escHtml(appSettings.bank_holder)}</span>
    </div>
  </div>

  <!-- Detail Grid -->
  <div class="grid2">
    <div class="box box-blue">
      <div class="box-title">Detail Invoice</div>
      <div class="row"><span class="row-label">Tgl Invoice</span><span class="row-val">${inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span></div>
      <div class="row"><span class="row-label">Issued</span><span class="row-val" style="font-weight:800;color:#1e40af">${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span></div>
      <div class="row"><span class="row-label">No. Invoice</span><span class="row-val">${inv.id}</span></div>
      <div class="row"><span class="row-label">No. Order</span><span class="row-val">${inv.job_id || "—"}</span></div>
      <div class="row"><span class="row-label">Jatuh Tempo</span><span class="row-val">${inv.due || "—"}</span></div>
    </div>
    <div class="box box-white">
      <div class="box-title">Tagihan Kepada</div>
      <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:6px">${escHtml(inv.customer)}</div>
      <div style="color:#64748b">📱 ${escHtml(inv.phone || "—")}</div>
      <div style="color:#64748b;margin-top:4px">🔧 ${escHtml(inv.service || "—")}</div>
    </div>
  </div>

  <!-- Table -->
  <table>
    <thead>
      <tr>
        <th style="width:auto">Deskripsi</th>
        <th style="text-align:right;width:72px;white-space:nowrap">Jml Unit</th>
        <th style="text-align:right;width:100px;white-space:nowrap">Harga/Unit</th>
        <th style="text-align:right;width:100px;white-space:nowrap">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${(inv.labor > 0 && matDetails.length === 0) ? '<tr><td>' + escHtml((inv.service || "Jasa Servis AC") + (inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? " (Garansi Jasa Gratis)" : "")) + '</td><td style="text-align:center">' + (inv.units || 1) + '</td><td style="text-align:right;font-family:monospace">' + perUnit.toLocaleString("id-ID") + '</td><td style="text-align:right;font-family:monospace;font-weight:600">' + (inv.labor || 0).toLocaleString("id-ID") + '</td></tr>' : ""}
${matRowsHtml}
      ${(inv.dadakan > 0) ? '<tr><td>Pekerjaan Tambahan</td><td style="text-align:center">—</td><td style="text-align:right">—</td><td style="text-align:right;font-family:monospace;font-weight:600">${(inv.dadakan||0).toLocaleString("id-ID")}</td></tr>' : ""}
      <tr class="total-row">
        <td colspan="3">TOTAL TAGIHAN</td>
        <td style="text-align:right;font-family:monospace">Rp ${(inv.total || 0).toLocaleString("id-ID")}</td>
      </tr>
    </tbody>
  </table>

  ${inv.garansi_expires ? '<div class="garansi-box">🛡️ <strong>Garansi Servis ' + (inv.garansi_days || 30) + ' Hari</strong> — berlaku sampai ' + inv.garansi_expires + '. Jika AC bermasalah dalam masa garansi, hubungi kami tanpa biaya tambahan.</div>' : ""}

  <!-- Footer -->
  <div class="footer-grid">
    <div class="bank-box">
      <div class="box-title">Informasi Pembayaran</div>
      <div style="color:#475569;font-size:11px">Transfer Bank BCA</div>
    <div class="bank-num">${escHtml(appSettings.bank_number)}</div>
    <div style="color:#475569;font-size:11px">a.n. ${escHtml(appSettings.bank_holder)}</div>
      <div style="margin-top:8px;font-size:11px;color:#64748b">Kirim bukti transfer via WhatsApp ke nomor di atas</div>
    </div>
    <div class="status-box ${inv.status === "PAID" ? "status-paid" : inv.status === "OVERDUE" ? "status-overdue" : "status-unpaid"}">
      <div class="box-title">Status Pembayaran</div>
      <div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:4px">
        ${inv.status === "PAID" ? "✅ LUNAS" : inv.status === "OVERDUE" ? "⚠️ JATUH TEMPO" : "⏳ MENUNGGU PEMBAYARAN"}
      </div>
      <div style="font-size:11px;color:#64748b">Jatuh tempo: ${inv.due || "—"}</div>
      ${inv.paid_at ? '<div style="font-size:11px;color:#16a34a;margin-top:4px">Dibayar: ' + new Date(inv.paid_at).toLocaleDateString("id-ID") + '</div>' : ""}
    </div>
  </div>

  <div class="footer-note">
    <p>Pertanyaan? Hubungi kami via WhatsApp: ${escHtml(appSettings.wa_number)}</p>
    <p style="font-style:italic;margin-top:4px;color:#94a3b8">Terima kasih telah mempercayakan perawatan AC Anda kepada ${escHtml(appSettings.company_name)} 🙏</p>
  </div>
</div>
${forWA ? "" : "<script>window.onload = () => { window.print(); }</script>"}
</body>
</html>`;

    return html;
  };

  const downloadInvoicePDF = async (inv) => {
    const logoUrl = await fetchInvoiceLogoUrl();
    const html = buildInvoiceHTML(inv, logoUrl);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    // SEC-09: Audit log setiap kali invoice dicetak/download
    addAgentLog("INVOICE_PRINT",
      `Invoice ${inv.id} (${inv.customer}) dicetak oleh ${currentUser?.name || "Unknown"} — Rp${fmt(inv.total)}`,
      "SUCCESS"
    );
    const win = window.open(url, "_blank", "width=860,height=1000,scrollbars=yes");
    if (!win) {
      // Fallback jika popup diblokir browser
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice_${inv.id}_${inv.customer.replace(/\s+/g, "_")}.html`;
      a.click();
      showNotif("PDF disimpan sebagai file HTML — buka lalu Ctrl+P untuk cetak");
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };

  // Load html2pdf.js dari CDN sekali saja (lazy load)
  const loadHtml2Pdf = () => new Promise((resolve, reject) => {
    if (window.html2pdf) { resolve(window.html2pdf); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    s.onload = () => resolve(window.html2pdf);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  // Convert HTML string → PDF blob via html2pdf.js
  const htmlToPdfBlob = async (html, filename) => {
    const h2p = await loadHtml2Pdf();
    const el = document.createElement("div");
    el.innerHTML = html;
    // Harus visible di viewport agar html2canvas bisa capture
    el.style.cssText = "position:absolute;top:0;left:0;width:794px;z-index:9999;background:white;";
    document.body.appendChild(el);
    // Tunggu gambar & font load
    await new Promise(r => setTimeout(r, 1200));
    try {
      const pdfBlob = await h2p().set({
        margin: [5, 5, 5, 5],
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false, allowTaint: true, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      }).from(el).outputPdf("blob");
      return pdfBlob;
    } finally {
      document.body.removeChild(el);
    }
  };

  // Upload invoice sebagai HTML ke R2 — returns /api/foto URL (served inline, no print dialog)
  const uploadInvoiceForWA = async (inv) => {
    try {
      const logoUrl = await fetchInvoiceLogoUrl();
      const html = buildInvoiceHTML(inv, logoUrl, true); // forWA=true: hapus script print
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename: `Invoice_${inv.id}.html`,
          folder: "invoices", mimeType: "text/html"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success && d.key) {
        return `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;
      }
      return null;
    } catch (err) {
      console.warn("[uploadInvoiceForWA] gagal:", err.message);
      return null;
    }
  };

  // Upload invoice sebagai PDF ke R2 menggunakan @react-pdf/renderer
  // Helper: render HTML string → JPG base64 via html2canvas (offscreen div)
  const htmlToImageBase64 = (htmlString, width = 794) => new Promise((resolve) => {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      position: "fixed", left: "-9999px", top: "0",
      width: width + "px", background: "#fff", zIndex: "-1"
    });
    wrapper.innerHTML = htmlString;
    document.body.appendChild(wrapper);
    import("html2canvas").then(({ default: html2canvas }) => {
      html2canvas(wrapper, {
        scale: 2, useCORS: true, allowTaint: false,
        backgroundColor: "#ffffff", logging: false,
        width, windowWidth: width
      }).then(canvas => {
        document.body.removeChild(wrapper);
        resolve(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
      }).catch(() => {
        document.body.removeChild(wrapper);
        resolve(null);
      });
    }).catch(() => { document.body.removeChild(wrapper); resolve(null); });
  });

  const uploadInvoicePDFForWA = async (inv) => {
    try {
      const logoUrl = await fetchInvoiceLogoUrl();
      const html = buildInvoiceHTML(inv, logoUrl, true);
      const base64 = await htmlToImageBase64(html);
      if (!base64) return null;
      const res = await fetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename: `Invoice_${inv.id}.jpg`,
          folder: "invoices", mimeType: "image/jpeg"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success && d.key) {
        return `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;
      }
      return null;
    } catch (err) {
      console.warn("[uploadInvoicePDFForWA] gagal:", err.message);
      return null;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SERVICE REPORT CARD — HTML builder + preview + WA upload
  // ─────────────────────────────────────────────────────────────────────────────

  // Fetch foto URL → base64 data URL (agar embedded dalam HTML, tidak butuh network saat print)
  const fetchFotoAsDataUrl = async (url, origin) => {
    if (!url) return "";
    try {
      let fetchUrl;
      if (url.startsWith("http")) {
        const urlObj = new URL(url);
        let key = urlObj.pathname.replace(/^\/+/, "");
        const lapIdx = key.indexOf("laporan/");
        if (lapIdx >= 0) key = key.slice(lapIdx);
        fetchUrl = `${origin}/api/foto?key=${encodeURIComponent(key)}`;
      } else if (url.startsWith("/api/foto")) {
        fetchUrl = origin + url;
      } else {
        fetchUrl = `${origin}/api/foto?key=${encodeURIComponent(url)}`;
      }
      const res = await fetch(fetchUrl);
      if (!res.ok) return "";
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    } catch {
      return "";
    }
  };

  const buildServiceReportHTML = (laporan, inv, logoUrl, origin, photoDataUrls = {}, forWA = false) => {
    const escH = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ord = ordersData.find(o => o.id === laporan.job_id) || {};
    const units = laporan.units || [];
    const materials = (laporan.materials || []).filter(m => m.nama && m.keterangan !== "jasa");
    const jasaItems = (laporan.materials || []).filter(m => m.keterangan === "jasa");
    const fotos = (laporan.foto_urls || []).filter(Boolean);
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const svcDate = laporan.date || (laporan.submitted_at || "").slice(0, 10);

    // ── Photo pages: chunk 6 per page ──
    const photoPages = [];
    for (let i = 0; i < fotos.length; i += 6) photoPages.push(fotos.slice(i, i + 6));

    const photoPageHTML = photoPages.map((chunk, pi) => `
      <div class="photo-page" style="page-break-before:always">
        <div class="photo-page-header">
          <div class="photo-page-title">DOKUMENTASI FOTO — Lembar ${pi + 2}</div>
          <div class="photo-page-sub">${escH(laporan.job_id)} · ${escH(laporan.customer)}</div>
        </div>
        <div class="photo-grid">
          ${chunk.map((url, idx) => {
            const dataUrl = photoDataUrls[url] || "";
            return dataUrl
              ? `<div class="photo-cell"><img src="${dataUrl}" alt="Foto ${pi * 6 + idx + 1}" /><div class="photo-num">${pi * 6 + idx + 1}</div></div>`
              : `<div class="photo-cell" style="background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px">Foto tidak tersedia<div class="photo-num">${pi * 6 + idx + 1}</div></div>`;
          }).join("")}
        </div>
      </div>
    `).join("");

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Service Report Card — ${escH(laporan.job_id)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; background: #fff; }
  @page { size: A4; margin: 10mm 12mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }

  /* ── HEADER ── */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 2.5px solid #1e3a5f; margin-bottom: 12px; }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .logo-wrap { background: #fff; display: flex; align-items: center; justify-content: center; height: 70px; }
  .logo-wrap img { height: 66px; max-width: 200px; width: auto; object-fit: contain; }
  .brand-text { font-size: 18px; font-weight: 800; color: #1e3a5f; letter-spacing: -0.5px; }
  .brand-sub { font-size: 9px; color: #64748b; margin-top: 2px; }
  .header-right { text-align: right; }
  .doc-title { font-size: 16px; font-weight: 800; color: #1e3a5f; letter-spacing: 0.5px; }
  .doc-sub { font-size: 9px; color: #64748b; margin-top: 2px; }

  /* ── INFO GRID ── */
  .section { margin-bottom: 10px; }
  .section-title { font-size: 9px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; padding-bottom: 3px; border-bottom: 1px solid #e2e8f0; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
  .info-row { display: flex; gap: 4px; }
  .info-label { color: #64748b; min-width: 85px; font-size: 10px; }
  .info-val { color: #1e293b; font-weight: 600; font-size: 10px; }
  .info-val.accent { color: #1e40af; }
  .info-val.full { grid-column: span 2; }

  /* ── UNIT TABLE ── */
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #1e3a5f; color: #fff; font-size: 9px; font-weight: 700; padding: 5px 6px; text-align: left; }
  td { font-size: 9.5px; padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #1e293b; }
  tr:nth-child(even) td { background: #f8fafc; }
  .badge { display: inline-block; background: #eff6ff; color: #1d4ed8; font-size: 8px; padding: 1px 5px; border-radius: 99px; margin: 1px 1px 1px 0; }
  .badge.yellow { background: #fefce8; color: #854d0e; }
  .badge.green { background: #f0fdf4; color: #166534; }

  /* ── MATERIALS ── */
  .mat-table th { background: #334155; }
  .mat-row { display: grid; grid-template-columns: 2fr 1fr 1fr; }

  /* ── CATATAN ── */
  .catatan-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 10px; color: #334155; min-height: 28px; }

  /* ── SIGNATURE ── */
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 8px; }
  .sig-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .sig-label { font-size: 9px; color: #64748b; margin-bottom: 32px; }
  .sig-name { font-size: 10px; font-weight: 700; color: #1e293b; margin-top: 6px; padding-top: 6px; border-top: 1px solid #cbd5e1; }
  .sig-date { font-size: 9px; color: #64748b; }

  /* ── FOOTER ── */
  .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
  .footer-left { font-size: 8.5px; color: #94a3b8; }
  .footer-right { font-size: 8px; color: #cbd5e1; font-style: italic; }

  /* ── PHOTO PAGE ── */
  .photo-page { padding: 0; }
  .photo-page-header { background: #1e3a5f; color: #fff; padding: 8px 12px; margin-bottom: 10px; border-radius: 4px; }
  .photo-page-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; }
  .photo-page-sub { font-size: 9px; color: #93c5fd; margin-top: 2px; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo-cell { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; position: relative; background: #f8fafc; aspect-ratio: 3/4; }
  .photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo-num { position: absolute; bottom: 3px; right: 5px; background: rgba(0,0,0,0.55); color: #fff; font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
${forWA ? "" : "<script>window.onload = () => { window.print(); }</script>"}

<!-- ═══════ HALAMAN 1 — DATA PEKERJAAN ═══════ -->
<div class="header">
  <div class="header-left">
    ${logoUrl
      ? `<div class="logo-wrap"><img src="${logoUrl}" alt="AClean"/></div>`
      : `<div style="font-size:22px;font-weight:900;color:#1e3a5f;line-height:1">AC<span style="color:#3b82f6">lean</span><div style="font-size:9px;font-weight:400;color:#64748b;margin-top:2px">We clean with heart</div></div>`}
  </div>
  <div class="header-right">
    <div class="doc-title">SERVICE REPORT CARD</div>
    <div class="doc-sub">Dicetak: ${printDate}</div>
    <div class="doc-sub" style="margin-top:2px;font-weight:700;color:#1e3a5f">${escH(laporan.job_id)}</div>
  </div>
</div>

<!-- INFO PEKERJAAN -->
<div class="section">
  <div class="section-title">Informasi Pekerjaan</div>
  <div class="info-grid">
    <div class="info-row"><span class="info-label">Job ID</span><span class="info-val accent">${escH(laporan.job_id)}</span></div>
    <div class="info-row"><span class="info-label">Tanggal Service</span><span class="info-val">${escH(svcDate)}</span></div>
    <div class="info-row"><span class="info-label">Jenis Layanan</span><span class="info-val">${escH(laporan.service)}</span></div>
    <div class="info-row"><span class="info-label">Jumlah Unit</span><span class="info-val">${escH(laporan.total_units || units.length || "-")}</span></div>
    <div class="info-row"><span class="info-label">Teknisi</span><span class="info-val">${escH(laporan.teknisi)}${laporan.helper ? " · " + escH(laporan.helper) : ""}${laporan.teknisi2 ? " · " + escH(laporan.teknisi2) : ""}</span></div>
    <div class="info-row"><span class="info-label">Status</span><span class="info-val">${escH(laporan.status)}</span></div>
  </div>
</div>

<!-- INFO CUSTOMER -->
<div class="section">
  <div class="section-title">Informasi Customer</div>
  <div class="info-grid">
    <div class="info-row"><span class="info-label">Nama</span><span class="info-val">${escH(laporan.customer)}</span></div>
    <div class="info-row"><span class="info-label">No. HP</span><span class="info-val">${escH(laporan.phone || ord.phone || "-")}</span></div>
    ${ord.address ? `<div class="info-row" style="grid-column:span 2"><span class="info-label">Alamat</span><span class="info-val">${escH(ord.address)}${ord.area ? ", " + escH(ord.area) : ""}</span></div>` : ""}
  </div>
</div>

<!-- DETAIL UNIT -->
${units.length > 0 ? `
<div class="section">
  <div class="section-title">Detail Unit AC</div>
  <table>
    <thead>
      <tr>
        <th style="width:24px">No</th>
        <th>Tipe / Merk</th>
        <th>Kondisi Sebelum</th>
        <th>Pekerjaan Dilakukan</th>
        <th>Kondisi Sesudah</th>
        <th style="width:52px">Freon / Ampere</th>
      </tr>
    </thead>
    <tbody>
      ${units.map((u, ui) => `
        <tr>
          <td style="text-align:center;font-weight:700">${u.unit_no || ui + 1}</td>
          <td>
            <div style="font-weight:700">${escH(u.tipe || "-")}</div>
            ${u.merk ? `<div style="color:#64748b;font-size:8.5px">${escH(u.merk)}${u.model ? " · " + escH(u.model) : ""}</div>` : ""}
          </td>
          <td>${(u.kondisi_sebelum || []).map(k => `<span class="badge yellow">${escH(k)}</span>`).join("") || "-"}</td>
          <td>${(u.pekerjaan || []).map(p => `<span class="badge">${escH(p)}</span>`).join("") || "-"}</td>
          <td>${(u.kondisi_setelah || []).map(k => `<span class="badge green">${escH(k)}</span>`).join("") || "-"}</td>
          <td style="font-size:8.5px">
            ${parseFloat(u.freon_ditambah) > 0 ? `<div>${u.freon_ditambah} psi</div>` : ""}
            ${u.ampere_akhir ? `<div>${u.ampere_akhir} A</div>` : ""}
            ${!parseFloat(u.freon_ditambah) && !u.ampere_akhir ? "—" : ""}
          </td>
        </tr>
        ${u.catatan_unit ? `<tr><td></td><td colspan="5" style="color:#64748b;font-size:8.5px;font-style:italic">📝 ${escH(u.catatan_unit)}</td></tr>` : ""}
      `).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- MATERIAL TERPAKAI -->
${materials.length > 0 ? `
<div class="section">
  <div class="section-title">Material Terpakai</div>
  <table class="mat-table">
    <thead><tr><th>Nama Material</th><th>Jumlah</th><th>Satuan</th></tr></thead>
    <tbody>
      ${materials.map(m => `<tr><td>${escH(m.nama)}</td><td>${escH(m.jumlah)}</td><td>${escH(m.satuan || "pcs")}</td></tr>`).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- JASA DILAKUKAN -->
${jasaItems.length > 0 ? `
<div class="section">
  <div class="section-title">Jasa / Layanan Dilakukan</div>
  <table class="mat-table">
    <thead><tr><th>Jasa</th><th>Jumlah</th><th>Satuan</th></tr></thead>
    <tbody>
      ${jasaItems.map(j => `<tr><td>${escH(j.nama)}</td><td>${escH(j.jumlah)}</td><td>${escH(j.satuan || "unit")}</td></tr>`).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- CATATAN & REKOMENDASI -->
<div class="section">
  <div class="section-title">Catatan & Rekomendasi</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div>
      <div style="font-size:9px;color:#64748b;margin-bottom:3px">Catatan Teknisi</div>
      <div class="catatan-box">${escH(laporan.catatan_global || laporan.catatan || "—")}</div>
    </div>
    <div>
      <div style="font-size:9px;color:#64748b;margin-bottom:3px">Rekomendasi</div>
      <div class="catatan-box">${escH(laporan.rekomendasi || "—")}</div>
    </div>
  </div>
</div>

<!-- TANDA TANGAN -->
<div class="section">
  <div class="section-title">Persetujuan</div>
  <div class="sig-row">
    <div class="sig-box">
      <div class="sig-label">Tanda Tangan Customer</div>
      <div class="sig-name">${escH(laporan.customer)}</div>
      <div class="sig-date">Tanggal: ${escH(svcDate)}</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">Tanda Tangan Teknisi</div>
      <div class="sig-name">${escH(laporan.teknisi)}</div>
      <div class="sig-date">Tanggal: ${escH(svcDate)}</div>
    </div>
  </div>
</div>

<!-- FOOTER -->
<div class="footer">
  <div class="footer-left">AClean Service · Jasa Servis AC Profesional · aclean.id</div>
  <div class="footer-right">Dokumen ini dicetak otomatis oleh sistem AClean</div>
</div>

<!-- ═══════ HALAMAN FOTO ═══════ -->
${photoPageHTML}

</body>
</html>`;
  };

  // Preview / download Service Report Card di browser
  const downloadServiceReportPDF = async (laporan, inv) => {
    const logoUrl = await fetchInvoiceLogoUrl();
    const origin = window.location.origin;
    // Pre-fetch semua foto sebagai base64 data URL agar embedded dalam HTML (tidak butuh network saat print)
    const fotoUrls = (laporan.foto_urls || []).filter(Boolean);
    const photoDataUrls = {};
    await Promise.all(fotoUrls.map(async (url) => {
      const dataUrl = await fetchFotoAsDataUrl(url, origin);
      if (dataUrl) photoDataUrls[url] = dataUrl;
    }));
    const html = buildServiceReportHTML(laporan, inv, logoUrl, origin, photoDataUrls);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    addAgentLog("REPORT_PRINT", `Service Report ${laporan.job_id} (${laporan.customer}) dicetak oleh ${currentUser?.name || "Unknown"}`, "SUCCESS");
    const win = window.open(url, "_blank", "width=860,height=1000,scrollbars=yes");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `ServiceReport_${laporan.job_id}_${laporan.customer.replace(/\s+/g, "_")}.html`;
      a.click();
      showNotif("Report disimpan sebagai file HTML — buka lalu Ctrl+P untuk cetak");
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };

  // Upload Service Report sebagai HTML ke R2 (foto di-embed sebagai base64)
  const uploadServiceReportForWA = async (laporan, inv) => {
    try {
      const logoUrl = await fetchInvoiceLogoUrl();
      const origin = window.location.origin;
      const fotoUrls = (laporan.foto_urls || []).filter(Boolean);
      const photoDataUrls = {};
      await Promise.all(fotoUrls.map(async (url) => {
        const dataUrl = await fetchFotoAsDataUrl(url, origin);
        if (dataUrl) photoDataUrls[url] = dataUrl;
      }));
      const html = buildServiceReportHTML(laporan, inv, logoUrl, origin, photoDataUrls, true); // forWA=true
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename: `ServiceReport_${laporan.job_id}.html`,
          folder: "service-reports", mimeType: "text/html"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success && d.key) {
        return `${origin}/api/foto?key=${encodeURIComponent(d.key)}`;
      }
      return null;
    } catch (err) {
      console.warn("[uploadServiceReportForWA] gagal:", err.message);
      return null;
    }
  };

  // Upload service report sebagai PDF ke R2 menggunakan @react-pdf/renderer
  const uploadServiceReportPDFForWA = async (laporan, inv) => {
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const { default: ServiceReportPDF } = await import("./components/ServiceReportPDF.jsx");
      const logoUrl = await fetchInvoiceLogoUrl();
      const origin = window.location.origin;
      const fotoUrls = (laporan.foto_urls || []).filter(Boolean);
      const photoDataUrls = {};
      await Promise.all(fotoUrls.map(async (url) => {
        const dataUrl = await fetchFotoAsDataUrl(url, origin);
        if (dataUrl) photoDataUrls[url] = dataUrl;
      }));
      const ord = ordersData.find(o => o.id === laporan.job_id) || {};
      const blob = await pdf(
        <ServiceReportPDF
          laporan={laporan} inv={inv} logoUrl={logoUrl}
          photoDataUrls={photoDataUrls} appSettings={appSettings} ord={ord}
        />
      ).toBlob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename: `ServiceReport_${laporan.job_id}.pdf`,
          folder: "service-reports", mimeType: "application/pdf"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success && d.key) {
        return `${origin}/api/foto?key=${encodeURIComponent(d.key)}`;
      }
      return null;
    } catch (err) {
      console.warn("[uploadServiceReportPDFForWA] gagal:", err.message);
      return null;
    }
  };

  const openLaporanModal = (order) => {
    // ANTI-DUPLIKAT: cek apakah sudah ada laporan untuk job ini
    const existingReport = laporanReports.find(r => r.job_id === (order._rewriteId ? order.id : order.id) && r.status !== "PENDING");
    if (existingReport && !order._rewriteId) {
      const isOwner = existingReport.teknisi === currentUser?.name;
      const isHelper = existingReport.helper === currentUser?.name;
      if (!isOwner && !isHelper) {
        showNotif("⚠️ Laporan untuk job ini sudah dibuat oleh tim lain");
        return;
      }
      if (!isOwner) {
        // Helper mencoba buat laporan padahal teknisi sudah isi
        showNotif(`⚠️ Laporan sudah dibuat oleh ${existingReport.teknisi}. Kamu bisa lihat di menu Laporan Saya.`);
        return;
      }
    }
    const count = Math.min(order.units || 1, 10);
    setLaporanUnits(Array.from({ length: count }, (_, i) => mkUnit(i + 1)));
    setLaporanMaterials([]);
    setLaporanJasaItems([]); setJasaManualText({});
    setLaporanRepairItems([]); setRepairManualText({});
    setLaporanBarangItems([]); // ✨ NEW: reset barang items
    setLaporanCleaningInRepair([]); // ✨ NEW: reset cleaning-in-repair checkboxes
    setShowJasaSearch(false); setJasaSearchQ("");
    setShowRepairSearch(false); setRepairSearchQ("");
    setShowMatSearch(false); setMatSearchQ2("");
    // ── LAYER 2 (lintas sesi): Load foto existing dari service_reports ──
    // Jika sudah ada laporan untuk job ini, tampilkan foto yang sudah tersimpan
    // sehingga teknisi tidak bisa upload ulang foto yang sama
    const existingRep = laporanReports.find(r =>
      r.job_id === order.id && r.status !== "REJECTED"
    );
    if (existingRep && existingRep.foto_urls && existingRep.foto_urls.length > 0) {
      // Rebuild laporanFotos dari foto_urls yang sudah ada di DB
      // hash dibuat dari URL (sebagai identifier unik per sesi)
      const restoredFotos = existingRep.foto_urls.map((url, idx) => {
        const hashFromUrl = url.split("/").pop().replace(".jpg", "").slice(0, 16); // ambil hash dari nama file
        return {
          id: Date.now() + idx,
          label: `Foto ${idx + 1}`,
          data_url: url,      // tampilkan dari URL R2 (sudah tersimpan)
          url: url,      // sudah tersimpan = ☁️ OK
          errMsg: "",
          hash: hashFromUrl,
          restored: true,     // flag: ini foto lama, bukan baru diupload
        };
      });
      setLaporanFotos(restoredFotos);
    } else {
      setLaporanFotos([]);
    }
    // Auto-fill install items berdasarkan jumlah unit order
    const _installDefaults = {};
    if (order.service === "Install") {
      const _u = Math.min(order.units || 1, 10);
      // Auto-fill pasang AC berdasarkan jumlah unit
      _installDefaults.pasang_05_1pk = String(_u);
      _installDefaults.vacum_unit = String(_u);
      _installDefaults.vacum_unit = String(_u);
    }
    setLaporanInstallItems(_installDefaults);
    setLaporanRekomendasi("");
    setLaporanCatatan("");
    setActiveUnitIdx(0);
    setShowMatPreset(false);

    // ── Smart Unit Preset: Cek customer history ──
    const customer = findCustomer(customersData, order.phone, order.customer);
    if (customer) {
      const custHistory = buildCustomerHistory(customer, ordersData, laporanReports, invoicesData);
      // Ambil unit detail dari job sebelumnya (terbaru)
      const historyUnits = custHistory.flatMap((h, idx) =>
        (h.unit_detail || []).map((u, uidx) => ({
          ...u,
          from_history_job_id: h.job_id,
          history_job_idx: idx,
          history_unit_idx: uidx,
          history_date: h.date,
          history_service: h.service
        }))
      );

      // Jika ada history units, tampilkan unit preset modal
      if (historyUnits.length > 0) {
        setUnitPresetHistory(historyUnits);
        setUnitPresetSelected(new Set());
        setShowUnitPresetModal(true);
      }
    }

    setLaporanModal(order);
    setLaporanStep(1);
    setLaporanSubmitted(false);
  };
  const doLogin = async (email, pass) => {
    setLoginError("");

    // ── SEC-07: Cek lockout brute force ──
    const _now = Date.now();
    const _lockout = _ls("lockoutUntil", 0);
    if (_lockout > _now) {
      const sisa = Math.ceil((_lockout - _now) / 1000);
      setLoginError(`⛔ Terlalu banyak percobaan. Coba lagi dalam ${sisa} detik.`);
      return;
    }

    try {
      // ── Coba Supabase Auth dulu (untuk akun real dengan UUID) ──
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });

      if (!error && data?.user) {
        // Login Supabase Auth berhasil — load profil dari user_profiles
        const { data: profile, error: profileErr } = await supabase
          .from("user_profiles").select("*").eq("id", data.user.id).single();
        if (profileErr) {
          console.error("[LOGIN_PROFILE_LOAD_ERROR]", profileErr.message);
          setLoginError("Gagal load profil pengguna. Silakan coba lagi. (Err: " + profileErr.code + ")");
          await supabase.auth.signOut();
          return;
        }
        if (!profile || !profile.active) {
          setLoginError("Akun tidak aktif. Hubungi Owner.");
          await supabase.auth.signOut(); return;
        }
        // SEC-08: Tambah expiry 8 jam ke session
        const userObj = { ...data.user, ...profile, _exp: Date.now() + 8 * 60 * 60 * 1000 };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(profile.role.toLowerCase());
        setActiveMenu("dashboard");
        _lsSave("localSession", userObj);
        // SEC-07: Reset counter setelah login berhasil
        setLoginAttempts(0); setLockoutUntil(0);
        _lsSave("loginAttempts", 0); _lsSave("lockoutUntil", 0);
        showNotif("Selamat datang, " + profile.name + "!");
        addAgentLog("LOGIN", `${profile.name} (${profile.role}) login via Supabase Auth`, "SUCCESS");
        requestPushPermission();
        return;
      }

      // ── Fallback dihapus: semua login wajib via Supabase Auth ──
      // Tidak ada lagi login dengan password hardcode

      // SEC-07: increment attempt counter
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      _lsSave("loginAttempts", newAttempts);
      if (newAttempts >= 5) {
        const lockUntil = Date.now() + 5 * 60 * 1000; // 5 menit
        setLockoutUntil(lockUntil);
        _lsSave("lockoutUntil", lockUntil);
        setLoginError("⛔ 5 percobaan gagal. Akun dikunci 5 menit.");
      } else {
        setLoginError(`Email atau password salah. (${newAttempts}/5 percobaan)`);
      }
    } catch (err) {
      setLoginError("Terjadi kesalahan: " + err.message);
    }
  };

  const doLogout = async () => {
    invalidateCache();
    _internalTokenRef.current = null; // clear cached API token saat logout
    await supabase.auth.signOut();
    _lsSave("localSession", null);
    addAgentLog("LOGOUT", `${currentUser?.name || "User"} (${currentUser?.role || ""}) keluar`, "SUCCESS");
    setIsLoggedIn(false);
    setCurrentUser(null);
    setLoginEmail("");
    setLoginPassword("");
    setActiveMenu("dashboard");
    setOrdersData([]);
    setInvoicesData([]);
    setCustomersData([]);
    setInventoryData([]);
    setLaporanReports([]);
    setAgentLogs([]);
    setTeknisiData(TEKNISI_DATA);
  };

  const canAccess = (menu) => {
    if (!currentUser) return false;
    const role = currentUser.role;
    // Owner: semua akses kecuali myreport
    if (role === "Owner") return menu !== "myreport";
    // Admin: semua operasional + pricelist (kecuali settings & myreport)
    // Rule: Admin = input & edit only (NO delete)
    if (role === "Admin") {
      const adminBlocked = ["settings", "myreport", "deletedaudit", "monitoring", "agentlog"];
      return !adminBlocked.includes(menu);
    }
    // Teknisi & Helper: HANYA dashboard, jadwal, laporan sendiri
    if (role === "Teknisi" || role === "Helper")
      return menu === "dashboard" || menu === "schedule" || menu === "myreport";
    // wa-inbox: Owner + Admin only (handled above — teknisi/helper excluded by default)
    return false;
  };

  // ── Supabase: Restore session saat refresh ──
  // Helper: cek apakah ID adalah Supabase UUID yang valid (GAP 7)
  const isRealUUID = (id) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

  // ── Auto-save settings ke localStorage saat berubah ──
  // ── Startup cleanup: fix nilai lama yang tersimpan sebagai array ──
  useEffect(() => {
    // Delete any stored API credentials (security: never persist keys in localStorage)
    ["fonnteKey", "wapiToken", "wapiUrl", "llmApiKey"].forEach(k => {
      try { localStorage.removeItem("aclean_" + k); } catch (_) { }
    });

    const stringKeys = ["brainMd", "waProvider", "llmProvider", "llmModel", "ollamaUrl"];
    stringKeys.forEach(key => {
      try {
        const raw = localStorage.getItem("aclean_" + key);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localStorage.setItem("aclean_" + key, JSON.stringify(parsed.join("\n")));
          } else if (typeof parsed !== "string" && parsed !== null && typeof parsed !== "boolean" && typeof parsed !== "number") {
            localStorage.removeItem("aclean_" + key);
          }
        }
      } catch (e) { try { localStorage.removeItem("aclean_" + key); } catch (_) { } }
    });
  }, []);

  useEffect(() => { _lsSave("llmProvider", llmProvider); }, [llmProvider]);
  // Sync llmProvider to Supabase app_settings so Owner/Admin use same provider globally
  useEffect(() => {
    if (!isLoggedIn || !llmProvider) return;
    (async () => {
      try {
        await supabase.from("app_settings").upsert({ key: "llm_provider", value: llmProvider }, { onConflict: "key" });
      } catch (e) { console.warn("[Settings] Failed to sync llmProvider:", e.message); }
    })();
  }, [llmProvider, isLoggedIn]);
  // Sync llmModel to Supabase app_settings for global consistency
  useEffect(() => {
    if (!isLoggedIn || !llmModel) return;
    (async () => {
      try {
        await supabase.from("app_settings").upsert({ key: "llm_model", value: llmModel }, { onConflict: "key" });
      } catch (e) { console.warn("[Settings] Failed to sync llmModel:", e.message); }
    })();
  }, [llmModel, isLoggedIn]);
  // SECURITY: Never store API keys in localStorage — keys are managed on backend only
  useEffect(() => { _lsSave("llmModel", llmModel); }, [llmModel]);
  useEffect(() => { _lsSave("ollamaUrl", ollamaUrl); }, [ollamaUrl]);
  useEffect(() => { _lsSave("brainMd", brainMd); }, [brainMd]);
  useEffect(() => { _lsSave("brainMdCustomer", brainMdCustomer); }, [brainMdCustomer]);
  useEffect(() => { _lsSave("waProvider", waProvider); }, [waProvider]);
  // Sync waProvider to Supabase app_settings for global consistency
  useEffect(() => {
    if (!isLoggedIn || !waProvider) return;
    (async () => {
      try {
        await supabase.from("app_settings").upsert({ key: "wa_provider", value: waProvider }, { onConflict: "key" });
      } catch (e) { console.warn("[Settings] Failed to sync waProvider:", e.message); }
    })();
  }, [waProvider, isLoggedIn]);
  // B.5 SECURITY: WA token di sessionStorage (hilang saat browser ditutup)
  useEffect(() => { if (waToken) sessionStorage.setItem("aclean_waToken", waToken); }, [waToken]);
  useEffect(() => { _lsSave("waDevice", waDevice); }, [waDevice]);

  // ── Helper: Check session expiry and auto-logout ──
  const checkSessionValidity = async () => {
    // Only check once per 30 seconds to avoid excessive checking
    const now = Date.now();
    if (now - lastSessionCheckRef.current < 30000) return;
    lastSessionCheckRef.current = now;

    // Check local session expiry
    const saved = _ls("localSession", null);
    if (saved && saved._exp && Date.now() > saved._exp) {
      console.warn("[SESSION] Local session expired, auto-logout");
      _lsSave("localSession", null);
      setIsLoggedIn(false);
      setCurrentUser(null);
      return false;
    }

    // Check Supabase session (auto-refresh handled by library)
    if (isLoggedIn && currentUser) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session) {
          console.warn("[SESSION] Supabase session invalid, auto-logout");
          setIsLoggedIn(false);
          setCurrentUser(null);
          return false;
        }
      } catch (e) {
        console.warn("[SESSION_CHECK_ERROR]", e.message);
      }
    }
    return true;
  };

  useEffect(() => {
    // ── Restore session saat refresh ──
    const restoreSession = async () => {
      // 1. Coba restore dari localStorage dulu (akun lokal/demo) — dengan server verification
      const saved = _ls("localSession", null);
      if (saved && saved.id && saved.role) {
        // SEC-08: Cek expiry session — auto logout setelah 8 jam
        if (saved._exp && Date.now() > saved._exp) {
          _lsSave("localSession", null);
          console.warn("SEC-08: Session expired, auto-logout");
          // jatuh ke Supabase auth check
        } else {
          // B.3 SECURITY: Verify role dari server sebelum trust localStorage
          try {
            const { data: profile } = await supabase
              .from("user_profiles")
              .select("role, name, active")
              .eq("id", saved.id)
              .single();

            if (profile && profile.active !== false) {
              // Override localStorage role dengan server role (prevent tampering)
              const verified = { ...saved, role: profile.role, name: profile.name };
              setCurrentUser(verified);
              setIsLoggedIn(true);
              setActiveRole(profile.role.toLowerCase());
              return;
            } else {
              // Invalid session atau user tidak aktif
              _lsSave("localSession", null);
              console.warn("SEC-08: Session invalid atau user tidak aktif");
            }
          } catch (e) {
            console.warn("SEC-08: Error verify session role:", e?.message);
            // Fallback ke Supabase auth check
          }
        }
      }
      // 2. Fallback: Supabase Auth session (akun real) — wrapped try/catch agar tidak spam 400
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) { console.warn("Auth session check:", error.message); return; }
        const session = data?.session;
        if (session?.user) {
          const { data: profile, error: profileErr } = await supabase
            .from("user_profiles").select("*").eq("id", session.user.id).single();
          if (profileErr) {
            console.warn("[AUTH_RESTORE_PROFILE_ERROR]", profileErr.message);
            // Continue silently — user will need to login manually
            return;
          }
          if (profile && profile.active) {
            setCurrentUser({ ...session.user, ...profile });
            setIsLoggedIn(true);
            setActiveRole(profile.role.toLowerCase());
          }
        }
      } catch (e) { console.warn("Auth restore skip:", e.message); }
    };
    restoreSession();
  }, []);

  // ── Load LLM Configuration from Backend (independent of login) ──
  // ✨ FIX #2: Hanya VALIDASI provider yang tersedia, JANGAN override pilihan user.
  // Source of truth = Supabase app_settings.llm_provider. Default = "minimax".
  useEffect(() => {
    const loadLlmConfig = async () => {
      try {
        const headers = await _apiHeaders();
        const resp = await fetch("/api/get-llm-config", { headers });
        if (resp.ok) {
          const config = await resp.json();
          setLlmConfig(config);
          setAvailableProviders(config.providers || []);
          // ❌ JANGAN setLlmProvider di sini — biarkan DB app_settings yang menentukan.
          // Hanya log untuk debugging.
          console.log("[LLM Config] Available:", config.providers?.map(p => p.name),
            "| Backend default (ignored):", config.defaultProvider,
            "| DB app_settings.llm_provider akan override.");
        }
      } catch (err) {
        console.warn("[LLM Config Load Error]", err.message, "— will use default minimax");
      }
    };
    loadLlmConfig();
  }, []);

  // ── Supabase: Load data + Realtime saat login ──
  useEffect(() => {
    if (!isLoggedIn) return;

    const loadAll = async () => {
        // A.4 OPTIMIZATION: Add LIMIT to initial queries untuk faster page load
        const results = await Promise.allSettled([
          cachedFetch("orders", () => fetchOrders(supabase)),
          cachedFetch("invoices", () => fetchInvoices(supabase)),
          cachedFetch("customers", () => fetchCustomers(supabase)),
          cachedFetch("inventory", () => fetchInventory(supabase)),
          cachedFetch("service_reports", () => fetchServiceReports(supabase)),
          cachedFetch("agent_logs", () => fetchAgentLogs(supabase)),
          cachedFetch("inv_tx", () => fetchInventoryTransactions(supabase)),
          cachedFetch("inv_units", () => fetchInventoryUnits(supabase)),
        ]);
        const [ordersRes, invoicesRes, customersRes, inventoryRes, laporanRes, logsRes, invTxRes, invUnitsRes] = results.map(r => r.status === "fulfilled" ? r.value : { error: r.reason });
        // Selalu pakai data DB jika tidak error (bahkan array kosong = data nyata dari DB)
        // Jika error = fallback ke demo data yang sudah di-init
        if (!ordersRes.error && ordersRes.data) setOrdersData(ordersRes.data);
        if (!invTxRes?.error && invTxRes?.data) setInvTxData(invTxRes.data);
        if (!invUnitsRes?.error && invUnitsRes?.data) setInvUnitsData(invUnitsRes.data);
        if (!invoicesRes.error && invoicesRes.data) setInvoicesData(invoicesRes.data);
        if (!customersRes.error && customersRes.data) setCustomersData(customersRes.data);
        // [G1 FIXED] laporan load handled below by parseLaporan block
        if (!inventoryRes.error && inventoryRes.data) setInventoryData(inventoryRes.data);
        // Load laporan — single clean parse, always run (even empty = clear demo data)
        // Parse materials_detail JSON di invoices
        if (!invoicesRes.error && invoicesRes.data) {
          setInvoicesData(invoicesRes.data.map(inv => ({
            ...inv,
            materials_detail: (() => {
              if (!inv.materials_detail) return [];
              if (Array.isArray(inv.materials_detail)) return inv.materials_detail;
              return safeJsonParse(inv.materials_detail, `invoice_materials_${inv.id}`, []);
            })(),
          })));
        }
        if (!laporanRes.error && laporanRes.data) {
          const parseLaporan = r => ({
            ...r,
            units: r.units_json ? safeJsonParse(r.units_json, `laporan_units_${r.id}`, r.units || []) : (r.units || []),
            materials: r.materials_json ? safeJsonParse(r.materials_json, `laporan_materials_${r.id}`, r.materials_used || []) : (r.materials_used || []),
            fotos: r.fotos || (r.foto_urls || []).map((url, i) => ({ id: i, label: `Foto ${i + 1}`, url })),
            editLog: safeArr(r.edit_log ?? r.editLog),
            rekomendasi: r.rekomendasi || "",
            catatan_global: r.catatan_global || r.catatan || "",
            submitted: r.submitted || (r.submitted_at || "").slice(0, 16).replace("T", " "),
            status: r.status || "SUBMITTED",
          });
          // ✨ DEDUP by job_id — keep latest submitted (prevents double laporan bug on rewrite)
          const allReports = laporanRes.data.map(parseLaporan);
          const dedupedMap = new Map();
          allReports.forEach(r => {
            const existing = dedupedMap.get(r.job_id);
            if (!existing) { dedupedMap.set(r.job_id, r); return; }
            const rTime = r.submitted_at || r.submitted || "";
            const eTime = existing.submitted_at || existing.submitted || "";
            if (rTime > eTime) dedupedMap.set(r.job_id, r);
          });
          setLaporanReports(Array.from(dedupedMap.values()));
        }
        // Jika DB error total, keep demo data (already in useState init)
        if (!logsRes.error && logsRes.data && logsRes.data.length > 0) setAgentLogs(logsRes.data);

        // ── Load Expenses ──
        try {
          const expRes = await cachedFetch("expenses", () => fetchExpenses(supabase));
          if (!expRes.error && expRes.data) setExpensesData(expRes.data);
        } catch (e) { /* tabel belum ada, skip */ }

        // ── Auto-cleanup agent_logs > 90 hari: dilakukan oleh cron backend,
        //    bukan frontend — setelah RLS fix, anon/authenticated tidak bisa DELETE ──

        // GAP 3: Load payments summary & dispatch recent (untuk dashboard)
        try {
          const [payRes, dispRes] = await Promise.all([
            fetchPayments(supabase),
            fetchDispatchLogs(supabase),
          ]);
          if (!payRes.error && payRes.data) setPaymentsData(payRes.data);
          if (!dispRes.error && dispRes.data) setDispatchLogs(dispRes.data);
        } catch (e) { /* tabel belum ada, skip */ }

        // Load app_settings dari Supabase DB (backup dari localStorage)
        try {
          const setRes = await fetchAppSettings(supabase);
          if (!setRes.error && setRes.data) {
            const sMap = Object.fromEntries(setRes.data.map(s => [s.key, s.value]));
            // ── FIXED: Load dari DB dan LOG untuk debugging ──
            // PRIORITAS: DB > localStorage > default "claude"
            const VALID_PROVIDERS = ["minimax", "claude", "openai", "groq", "ollama"];
            const currentLS = _ls("llmProvider", null);
            console.log("[Settings] DEBUG — localStorage llmProvider:", currentLS, "DB llm_provider:", sMap.llm_provider);

            const dbProvider = sMap.llm_provider;
            // Model default per provider — harus konsisten dengan LLM_PROVIDERS di SettingsView
            const DEFAULT_MODEL = { minimax: "MiniMax-M2.5", claude: "claude-haiku-4-5-20251001" };
            const resolvedProvider = (dbProvider && VALID_PROVIDERS.includes(dbProvider)) ? dbProvider : "claude";
            setLlmProvider(resolvedProvider);
            _lsSave("llmProvider", resolvedProvider);
            // Model: pakai DB jika ada & valid, otherwise auto-set sesuai provider
            const dbModel = sMap.llm_model;
            const validModel = dbModel && !dbModel.includes("gemini") ? dbModel : DEFAULT_MODEL[resolvedProvider] || "claude-haiku-4-5-20251001";
            setLlmModel(validModel);
            _lsSave("llmModel", validModel);
            // Load wa_provider (WhatsApp provider) from DB — global setting for Owner/Admin
            const VALID_WA_PROVIDERS = ["fonnte", "wa_cloud", "twilio"];
            if (sMap.wa_provider && VALID_WA_PROVIDERS.includes(sMap.wa_provider)) {
              setWaProvider(sMap.wa_provider);
            }
            // Load bank & phone settings dari DB
            if (sMap.bank_number) setAppSettings(prev => ({
              ...prev,
              bank_name: sMap.bank_name || prev.bank_name,
              bank_number: sMap.bank_number || prev.bank_number,
              bank_holder: sMap.bank_holder || prev.bank_holder,
              owner_phone: sMap.owner_phone || prev.owner_phone,
              company_name: sMap.company_name || prev.company_name,
              company_addr: sMap.company_addr || prev.company_addr,
              wa_number: sMap.wa_number || prev.wa_number,
              wa_autoreply_enabled: sMap.wa_autoreply_enabled ?? prev.wa_autoreply_enabled,
              wa_forward_to_owner: sMap.wa_forward_to_owner ?? prev.wa_forward_to_owner,
              wa_chatbot_enabled: sMap.wa_chatbot_enabled ?? prev.wa_chatbot_enabled ?? "false",
              wa_payment_detect: sMap.wa_payment_detect ?? prev.wa_payment_detect ?? "true",
              wa_cleanup_enabled: sMap.wa_cleanup_enabled ?? prev.wa_cleanup_enabled ?? "true",
              wa_monitor_enabled: sMap.wa_monitor_enabled ?? prev.wa_monitor_enabled ?? "false",
              ara_training_rules: sMap.ara_training_rules ?? prev.ara_training_rules,
            }));
            if (sMap.cron_jobs) {
              try {
                const s = JSON.parse(sMap.cron_jobs);
                if (Array.isArray(s) && s.length > 0) setCronJobs(s);
              } catch (e) { }
            } else {
              // Migrasi: baca toggle lama ke active di masing-masing job
              setCronJobs(prev => prev.map(j => {
                if (!j.backendKey) return j;
                const val = sMap[j.backendKey];
                return val !== undefined ? { ...j, active: val !== "false" } : j;
              }));
            }
            // Sync apiKey sesuai provider dari DB
            if (sMap.llm_provider) {
              const dbProv = sMap.llm_provider;
              const savedKey = _ls("llmApiKey_" + dbProv, "") || _ls("llmApiKey", "");
              if (savedKey) setLlmApiKey(savedKey);
            }
          }
        } catch (e) { }

        // Load Teknisi dari Supabase — fallback ke TEKNISI_DATA jika kosong/error
        try {
          const tekRes = await fetchUserProfiles(supabase);
          if (!tekRes.error && tekRes.data && tekRes.data.length > 0) {
            const tekList = tekRes.data.filter(u => {
              const r = (u.role || "").toLowerCase();
              return r === "teknisi" || r === "helper";
            });
            if (tekList.length > 0) {
              const normalized = tekList.map(u => ({
                ...u,
                role: (u.role || "").charAt(0).toUpperCase() + (u.role || "").slice(1).toLowerCase(),
                skills: u.skills || [],
                jobs_today: 0, // dihitung dari ordersData saat render
                status: u.status || "active",
              }));
              setTeknisiData(normalized);
            }
            // Jika tidak ada Teknisi/Helper di DB → tetap pakai TEKNISI_DATA default (sudah di useState awal)
          }
        } catch (e) { console.warn("Load teknisi failed:", e); }

        // Load semua user → userAccounts (untuk panel manage user)
        try {
          const uaRes = await fetchUserAccounts(supabase);
          if (!uaRes.error && uaRes.data && uaRes.data.length > 0) {
            const roleColors = { owner: "#f59e0b", admin: "#38bdf8", teknisi: "#22c55e", helper: "#a78bfa" };
            const normalized = uaRes.data.map(u => ({
              ...u,
              role: (u.role || "").charAt(0).toUpperCase() + (u.role || "").slice(1).toLowerCase(),
              color: u.color || roleColors[(u.role || "").toLowerCase()] || "#94a3b8",
              avatar: u.avatar || (u.name || "").charAt(0).toUpperCase(),
              active: u.active !== false,
              lastLogin: u.last_login
                ? new Date(u.last_login).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "-",
            }));
            setUserAccounts(normalized);
          }
        } catch (e) { console.warn("Load userAccounts failed:", e); }

        // Load WA conversations dari Supabase (tabel opsional)
        try {
          const waRes = await fetchWaConversations(supabase, 50);
          if (!waRes.error && waRes.data && waRes.data.length > 0) setWaConversations(waRes.data);
        } catch (e) { /* WA tabel belum ada - skip */ }

        // ── GAP-03 FIX + PriceList state: Load price_list dari DB ──
        try {
          const plRes = await fetchPriceList(supabase);
          if (!plRes.error && plRes.data && plRes.data.length > 0) {
            // Set state untuk renderPriceList UI
            setPriceListData(plRes.data);
            // Build PRICE_LIST map untuk kalkulasi invoice
            const activePL = plRes.data.filter(r => r.is_active !== false);
            PRICE_LIST = buildPriceListFromDB(activePL);
            setPriceListSyncedAt(new Date());
          }
        } catch (e) { console.warn("price_list DB fallback to default:", e?.message); }

        // ── BRAIN LOAD: Baca brain.md & brain_customer dari Supabase ara_brain ──
        try {
          const brainRes = await fetchAraBrain(supabase);
          if (!brainRes.error && brainRes.data && brainRes.data.length > 0) {
            const brainMap = Object.fromEntries(brainRes.data.map(r => [r.key, r.value]));
            // Load dari DB, TAPI skip jika v4.0 (use hardcoded v5.1 instead)
            if (brainMap.brain_md && typeof brainMap.brain_md === "string" && brainMap.brain_md.length > 10) {
              const isOldVersion = brainMap.brain_md.includes("v4.0");
              if (!isOldVersion) {
                setBrainMd(brainMap.brain_md);
                _lsSave("brainMd", brainMap.brain_md);
              } else {
              }
            }
            if (brainMap.brain_customer && typeof brainMap.brain_customer === "string" && brainMap.brain_customer.length > 10) {
              setBrainMdCustomer(brainMap.brain_customer);
              _lsSave("brainMdCustomer", brainMap.brain_customer);
            }
          }
        } catch (e) { console.warn("ara_brain DB load failed, pakai localStorage:", e?.message); }

        // ── Load pending payment suggestions (HANYA Owner/Admin) ──
        if (["Owner","Admin"].includes(currentUser?.role)) {
          try {
            const { data: psData } = await supabase.from("payment_suggestions")
              .select("*").eq("status","PENDING").order("created_at",{ascending:false}).limit(20);
            if (psData?.length > 0) setPaymentSuggestions(psData);
          } catch(_) { /* tabel belum ada, skip */ }
        }
      };

    const initLoadAll = async () => {
      const isValid = await checkSessionValidity();
      if (!isValid) return;
      setDataLoading(true);
      loadAll().finally(() => {
        setDataLoading(false);
        // GAP-7: Jalankan check stuck jobs segera setelah data load, lalu setiap 15 menit
        setTimeout(() => checkStuckJobs(), 5000); // delay 5 detik agar state ready
        startStuckCheck();
      });
    };

    initLoadAll();

    // ── AUTO-VERIFY CLIENT: Cek laporan SUBMITTED > 48 jam saat data selesai load ──
    const autoVerifyTimer = setTimeout(async () => {
      try {
        const now = Date.now();
        const LIMIT_MS = 48 * 60 * 60 * 1000; // 48 jam
        const cutoffTime = new Date(now - LIMIT_MS).toISOString();

        // Simplify query - use select(*) to avoid field name issues
        const { data: staleLaporan, error: qErr } = await supabase
          .from("service_reports")
          .select("*")
          .eq("status", "SUBMITTED")
          .lt("submitted_at", cutoffTime);

        if (qErr) {
          console.warn("❌ Auto-verify query error:", qErr.message);
          addAgentLog("AUTO_VERIFY_ERROR", `Query error: ${qErr.message}`, "WARNING");
          return;
        }

        if (staleLaporan && staleLaporan.length > 0) {
          console.log(`⏱️ Auto-verify: ${staleLaporan.length} laporan > 48 jam ditemukan`);
          for (const r of staleLaporan) {
            try {
              await updateServiceReport(supabase, r.id, { status: "VERIFIED" }, "system_auto_verify");
              setLaporanReports(prev => prev.map(x =>
                x.id === r.id ? {
                  ...x, status: "VERIFIED",
                  verified_at: new Date().toISOString()
                } : x
              ));
              addAgentLog("AUTO_VERIFIED",
                `Laporan ${r.job_id || r.id} auto-verified setelah 48 jam — ${r.teknisi || ""}`,
                "INFO"
              );
            } catch (uErr) {
              console.warn(`⚠️ Update laporan ${r.id} gagal:`, uErr);
            }
          }
          showNotif(`⏱️ ${staleLaporan.length} laporan otomatis terverifikasi (>48 jam)`);
        }
      } catch (e) { console.warn("Auto-verify check skip:", e?.message); }
    }, 8000); // jalankan 8 detik setelah data selesai load


    // ── GAP-08 FIX: Auto-refresh — 30 menit jam kerja, 60 menit luar jam kerja ──
    const STATS_INTERVAL = isWorkingHours() ? 30 * 60 * 1000 : 60 * 60 * 1000;
    const _statsTimer = setInterval(() => {
      loadAll().catch(e => console.warn("Auto-refresh skip:", e?.message));
    }, STATS_INTERVAL);

    // ══ Supabase Realtime Channels ══
    // Hanya 4 channel kritis (Supabase free tier: max concurrent realtime)
    // WA tables (wa_conversations, wa_messages) di-skip jika tidak ada

    const shouldSubscribeRT = isWorkingHours();

    const _tabId = (window._tabId = window._tabId || Math.random().toString(36).slice(2, 7));
    const ch1 = shouldSubscribeRT ? supabase.channel("rt-orders-" + _tabId)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        const eventType = payload.eventType;
        setOrdersData(prev => {
          if (!prev) return prev;
          if (eventType === "INSERT") {
            // Cek dedup: jangan double-insert kalau sudah ada (misal user yang create)
            if (prev.some(o => o.id === payload.new.id)) return prev;
            return [payload.new, ...prev];
          } else if (eventType === "UPDATE") {
            return prev.map(o => o.id === payload.new.id ? payload.new : o);
          } else if (eventType === "DELETE") {
            return prev.filter(o => o.id !== payload.old.id);
          }
          return prev;
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("⚠️ RT orders error — akan polling manual");
      }) : null;

    const ch2 = shouldSubscribeRT ? supabase.channel("rt-invoices-" + _tabId)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, (payload) => {
        const eventType = payload.eventType;
        setInvoicesData(prev => {
          if (!prev) return eventType === "DELETE" ? prev : [normalizeInvoice(payload.new)];
          if (eventType === "INSERT") {
            if (prev.some(inv => inv.id === payload.new.id)) return prev;
            return [normalizeInvoice(payload.new), ...prev];
          } else if (eventType === "UPDATE") {
            return prev.map(inv => inv.id === payload.new.id ? normalizeInvoice(payload.new) : inv);
          } else if (eventType === "DELETE") {
            return prev.filter(inv => inv.id !== payload.old.id);
          }
          return prev;
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("⚠️ RT invoices error — fallback polling aktif");
          if (window._rtPoll_1617) clearInterval(window._rtPoll_1617);
          if (isWorkingHours()) {
            window._rtPoll_1617 = setInterval(() => fetchInvoices(supabase)
              .then(({ data }) => {
                if (data) setInvoicesData(data.map(normalizeInvoice));
              }), 5 * 60 * 1000);
          }
        }
      }) : null;

    const ch3 = shouldSubscribeRT ? supabase.channel("rt-laporan-" + _tabId)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_reports" }, (payload) => {
        const eventType = payload.eventType;
        setLaporanReports(prev => {
          if (!prev) return eventType === "DELETE" ? prev : [normalizeReport(payload.new)];
          const normalized = eventType !== "DELETE" ? normalizeReport(payload.new) : null;

          if (eventType === "INSERT") {
            if (prev.some(r => r.id === payload.new.id)) return prev;
            const updated = [normalized, ...prev];
            const dm = new Map();
            updated.forEach(r => {
              const ex = dm.get(r.job_id);
              if (!ex || (r.submitted_at || "") > (ex.submitted_at || "")) dm.set(r.job_id, r);
            });
            return Array.from(dm.values());
          } else if (eventType === "UPDATE") {
            const updated = prev.map(r => r.id === normalized.id ? normalized : r);
            const dm = new Map();
            updated.forEach(r => {
              const ex = dm.get(r.job_id);
              if (!ex || (r.submitted_at || "") > (ex.submitted_at || "")) dm.set(r.job_id, r);
            });
            return Array.from(dm.values());
          } else if (eventType === "DELETE") {
            return prev.filter(r => r.id !== payload.old.id);
          }
          return prev;
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("⚠️ RT laporan error — fallback polling aktif");
          if (window._rtPoll_1645) clearInterval(window._rtPoll_1645);
          if (isWorkingHours()) {
            window._rtPoll_1645 = setInterval(() => fetchServiceReports(supabase)
              .then(({ data }) => {
                if (data) {
                  const mapped = data.map(normalizeReport);
                  const dm = new Map();
                  mapped.forEach(r => {
                    const ex = dm.get(r.job_id);
                    if (!ex || (r.submitted_at || "") > (ex.submitted_at || "")) dm.set(r.job_id, r);
                  });
                  setLaporanReports(Array.from(dm.values()));
                }
              }), 5 * 60 * 1000);
          }
        }
      }) : null;

    // CH4–CH6 dihapus (Opsi-A): pricelist, inventory, customers tidak butuh realtime ketat.
    // Data di-refresh otomatis setiap 30 menit via _statsTimer, cukup untuk use case bisnis.

    // CH7 & CH8: WA tables — hanya aktif bila wa_monitor_enabled = "true"
    const _waMonitorOn = appSettings?.wa_monitor_enabled === "true";
    let ch7 = null, ch8 = null;
    if (_waMonitorOn) {
      try {
        ch7 = supabase.channel("rt-wa-conv-" + _tabId)
          .on("postgres_changes", { event: "*", schema: "public", table: "wa_conversations" }, () =>
            fetchWaConversations(supabase, 50)
              .then(({ data, error }) => { if (data && !error) setWaConversations(data); }))
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR") console.warn("⚠️ RT wa_conversations — tabel mungkin belum ada");
          });

        ch8 = supabase.channel("rt-wa-msg-" + _tabId)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_messages" }, (payload) => {
            setWaMessages(prev => {
              if (prev.length === 0) return prev;
              const phone = payload.new?.phone;
              if (!phone) return prev;
              if (prev[0]?.phone === phone) return [...prev, payload.new];
              return prev;
            });
            fetchWaConversations(supabase, 50)
              .then(({ data, error }) => { if (data && !error) setWaConversations(data); });
          })
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR") console.warn("⚠️ RT wa_messages — tabel mungkin belum ada");
          });
      } catch (e) {
        console.warn("WA realtime channels skip:", e?.message);
      }
    }

    // Payment suggestions — HANYA Owner/Admin, hanya jam kerja, 2 menit polling
    const _isFinanceRole = ["Owner", "Admin"].includes(currentUser?.role);
    const _payDetectOn = appSettings?.wa_payment_detect !== "false";
    const _payPoll = (_isFinanceRole && _payDetectOn && isWorkingHours()) ? setInterval(() => {
      supabase.from("payment_suggestions").select("*").eq("status", "PENDING")
        .order("created_at", { ascending: false }).limit(20)
        .then(({ data }) => {
          if (!data) return;
          setPaymentSuggestions(data);
          const newest = data[0];
          if (newest) {
            const age = Date.now() - new Date(newest.created_at).getTime();
            if (age < 125000) {
              setPaymentSuggestBanner(newest);
              showNotif("💳 Bukti bayar masuk dari " + (newest.sender_name || newest.phone), true);
            }
          }
        });
    }, 2 * 60 * 1000) : null;

    return () => {
      clearInterval(window._rtPoll_1617); delete window._rtPoll_1617;
      clearInterval(window._rtPoll_1645); delete window._rtPoll_1645;
      clearInterval(window._rtPoll_1673); delete window._rtPoll_1673;
      if (_payPoll) clearInterval(_payPoll);

      clearTimeout(autoVerifyTimer);
      clearInterval(_statsTimer);
      if (stuckCheckTimer.current) clearInterval(stuckCheckTimer.current);
      [ch1, ch2, ch3, ch7, ch8].forEach(ch => {
        try { if (ch) supabase.removeChannel(ch); } catch (_) { }
      });
    };
  }, [isLoggedIn]);
  // ── Helper: parse materials_detail JSON safely ──
  // Nama prefix yang menandakan item adalah JASA (bukan material)
  const jasaSvcNames = ["Cleaning /", "Install /", "Repair /", "Complain /", "Jasa ", "Pemasangan ", "Bongkar ", "Vacum ", "Flaring", "Flushing"];

  const parseMD = (md) => {
    if (!md) return [];
    if (Array.isArray(md)) return md;
    if (typeof md === "string" && md) {
      try { return JSON.parse(md); } catch (e) { return []; }
    }
    return [];
  };

  // Helper: normalize invoice untuk payload event
  const normalizeInvoice = (inv) => ({
    ...inv,
    materials_detail: parseMD(inv.materials_detail)
  });

  // Helper: normalize service report untuk payload event
  const normalizeReport = (r) => ({
    ...r,
    units: r.units_json ? (() => { try { return JSON.parse(r.units_json); } catch (_) { return r.units || []; } })() : (r.units || []),
    materials: r.materials_json ? (() => { try { return JSON.parse(r.materials_json); } catch (_) { return r.materials_used || []; } })() : (r.materials_used || []),
    fotos: r.fotos || (r.foto_urls || []).map((url, i) => ({ id: i, label: `Foto ${i + 1}`, url })),
    editLog: safeArr(r.edit_log ?? r.editLog),
  });

  // cs / statusColor / statusLabel sudah di-import dari src/theme & src/constants (Fase 2)

  const fmt = (n) => "Rp " + (n || 0).toLocaleString("id-ID");
  // safeArr: handle Supabase returning JSON arrays as strings
  const safeArr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim().startsWith("[")) {
      try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) { return []; }
    }
    return [];
  };

  // ── Helpers ──
  // ── WA: kirim via Fonnte backend, fallback wa.me ──
  // opts.url + opts.filename → Fonnte Premium attachment (opsional)
  const sendWA = async (phone, message, opts = {}) => {
    if (!phone || !message) {
      console.warn("sendWA skip: phone/message kosong", { phone, message: message?.slice(0, 30) });
      return false;
    }
    try {
      const body = { phone, message, currentUserRole: currentUser?.role || "Unknown" };
      if (opts.url) { body.url = opts.url; if (opts.filename) body.filename = opts.filename; }
      console.log("[sendWA] Sending to", phone, opts.url ? `| attachment: ${opts.url}` : "| no attachment");
      const r = await fetch("/api/send-wa", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        console.log("[sendWA] OK — withAttachment:", d.withAttachment);
        return true;
      }
      // Log error detail — informasi berguna untuk debugging
      const errMsg = d.error || d.detail || String(r.status);
      console.warn("sendWA failed:", errMsg, "| target:", phone);
      // Tampilkan notif hanya untuk error kritis (bukan quota/device)
      if (errMsg.includes("FONNTE_TOKEN") || errMsg.includes("belum diset")) {
        showNotif("⚠️ WA tidak terkirim: FONNTE_TOKEN belum diset di Vercel");
      } else if (errMsg.includes("offline") || errMsg.includes("device")) {
        showNotif("⚠️ WA tidak terkirim: Device Fonnte offline — scan ulang QR");
      }
      return false;
    } catch (err) {
      console.warn("sendWA error:", err.message);
      return false;
    }
  };

  const openWA = async (phone, msg) => {
    if (!phone) { showNotif("❌ Nomor HP tidak tersedia"); return; }
    // Normalisasi nomor — pastikan format 628xxx
    const normPhone = String(phone).replace(/^0/, "62").replace(/[^0-9]/g, "");
    if (msg) {
      // Coba kirim via Fonnte dulu
      const sent = await sendWA(normPhone, msg);
      if (sent) {
        showNotif("✅ Pesan WA terkirim ke " + normPhone);
      } else {
        // Fonnte gagal → fallback buka wa.me agar teknisi tetap bisa kirim manual
        showNotif("⚠️ Kirim otomatis gagal — membuka WhatsApp manual...");
        const waUrl = "https://wa.me/" + normPhone + "?text=" + encodeURIComponent(msg);
        window.open(waUrl, "_blank");
      }
    } else {
      // Tidak ada pesan — langsung buka wa.me
      window.open("https://wa.me/" + normPhone, "_blank");
    }
  };

  // ── Dispatch: update status saja (tanpa WA) ──
  const dispatchStatus = async (order) => {
    const dispatchAt = new Date().toISOString();
    setOrdersData(prev => prev.map(o => o.id === order.id ? { ...o, dispatch: true, dispatch_at: dispatchAt, status: "DISPATCHED" } : o));
    await updateOrderStatus(supabase, order.id, "DISPATCHED", auditUserName(), { dispatch: true, dispatch_at: dispatchAt });
    const dispTek = teknisiData.find(t => t.name === order.teknisi);
    if (dispTek?.id) {
      setTeknisiData(prev => prev.map(t => t.name === order.teknisi ? { ...t, status: "on-job" } : t));
      supabase.from("user_profiles").update({ status: "on-job" }).eq("id", dispTek.id);
    }
    addAgentLog("DISPATCH_STATUS", `Status ${order.id} → DISPATCHED`, "SUCCESS");
    showNotif(`✅ Status job ${order.id} → Dispatched`);
  };

  // ── Kirim WA Dispatch ke Teknisi & Helper (tanpa ubah status) ──
  const sendDispatchWA = async (order) => {
    const tek = teknisiData.find(t => t.name === order.teknisi);
    if (!tek?.phone) return showNotif("⚠️ No. HP teknisi tidak ditemukan");
    const msg =
      "DISPATCH JOB " + order.id + "\n"
      + "Customer: " + order.customer + "\n"
      + "Alamat: " + order.address + "\n"
      + "Service: " + order.service + " - " + order.units + " unit\n"
      + "Jadwal: " + order.date + " jam " + order.time + (order.time_end ? " - " + order.time_end : "") + "\n\n"
      + "Segera konfirmasi kehadiran. — AClean";
    const ok = await sendWA(tek.phone, msg);
    if (order.helper) {
      const helperData = teknisiData.find(t => t.name === order.helper);
      if (helperData?.phone) {
        const helperMsg =
          "ASSIST JOB " + order.id + "\n"
          + "Customer: " + order.customer + "\n"
          + "Alamat: " + order.address + "\n"
          + "Service: " + order.service + " - " + order.units + " unit\n"
          + "Jadwal: " + order.date + " jam " + order.time + "\n"
          + "Teknisi: " + order.teknisi + "\n\n"
          + "Kamu ditugaskan sebagai Helper. — AClean";
        await sendWA(helperData.phone, helperMsg);
      }
    }
    if (ok) {
      try {
        await supabase.from("dispatch_logs").insert({
          order_id: order.id, teknisi: order.teknisi,
          assigned_by_name: currentUser?.name || "",
          wa_message: msg, status: "SENT"
        });
      } catch (e) { /* dispatch_logs opsional */ }
      addAgentLog("DISPATCH_WA_SENT", `WA dispatch ke ${order.teknisi} untuk ${order.id}`, "SUCCESS");
      showNotif(`✅ WA Dispatch terkirim ke ${order.teknisi}${order.helper ? " + " + order.helper : ""}`);
      // WA ke customer TIDAK dikirim saat dispatch — teknisi belum tentu langsung berangkat
    } else {
      showNotif("📱 WA dibuka manual di browser");
    }
  };

  // ── dispatchWA: full (status + WA) — untuk backward compat ──
  const dispatchWA = async (order) => {
    await dispatchStatus(order);
    await sendDispatchWA(order);
  };

  const invoiceReminderWA = async (inv) => {
    if (!inv?.phone) { showNotif("⚠️ No. HP customer tidak tersedia untuk reminder"); return; }
    const invoiceUrl = await uploadInvoicePDFForWA(inv);
    const msg = `Halo ${inv.customer}, mengingatkan tagihan *AClean Service* senilai *${fmt(inv.total)}* belum dibayar.\n\nTransfer ke:\n*${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""} a.n. ${appSettings.bank_holder || ""}*\n\nKonfirmasi di WA ini ya kak. Terima kasih! 🙏`;
    sendWA(inv.phone, msg, invoiceUrl ? { url: invoiceUrl, filename: `Invoice-${inv.id}.pdf` } : {});
  };

  // ── SEC-01: HTML Escape helper untuk prevent XSS di PDF generator ──
  const escHtml = (str) => {
    if (!str) return "—";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // ── GAP 2: Hitung labor dari price list ──
  const hitungLabor = useCallback((service, type, units) => {
    const plItem = priceListData.find(r => r.service === service && r.type === type);
    if (plItem && plItem.price > 0) return plItem.price * (units || 1);
    // ✨ PHASE 3: Handle unknown services by defaulting to Cleaning
    const svcMap = PRICE_LIST[service] || PRICE_LIST["Maintenance"] || PRICE_LIST["Cleaning"];
    const hargaPerUnit = svcMap[type] || svcMap["default"] || 85000;
    return hargaPerUnit * (units || 1);
  }, [priceListData]);

  // ✨ PHASE 2 FIX: Unified lookupHarga function — used across all 3 invoice paths
  // A.1 OPTIMIZATION: Memoize dengan useCallback untuk prevent recreation setiap render
  const lookupHargaGlobal = useCallback((nama, satuanHint) => {
    const nama2 = (nama || "").toLowerCase();
    const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
    const mkNorm = (s) => (s || "").toLowerCase()
      .replace(/,/g, ".").replace(/eterna\s*/g, "").replace(/hoda\s*/g, "")
      .replace(/[-\s]/g, "").replace(/r410a?$/, "r410").replace(/r22a?$/, "r22").replace(/r32a?$/, "r32");
    const norm = mkNorm(nama);
    let h = 0;

    // 1a. priceListData DB — exact match (PRIORITAS TERTINGGI = harga jual)
    const plIt = priceListData.find(r => r.type && r.type.trim() === nama.trim());
    if (plIt && plIt.price > 0) h = plIt.price;

    // 1b. priceListData DB — fuzzy match
    if (!h) {
      const plFuzzy = priceListData.find(r => {
        if (!r.type || !r.price) return false;
        const t = mkNorm(r.type);
        return norm.length >= 4 && (t === norm || t.includes(norm) || norm.includes(t));
      });
      if (plFuzzy && plFuzzy.price > 0) h = plFuzzy.price;
    }

    // 2a. PRICE_LIST hardcode — exact name match
    if (!h) {
      for (const sv of ["Material", "Repair", "Install", "Cleaning", "Complain", "Maintenance"]) {
        if (PRICE_LIST[sv]?.[nama]) { h = PRICE_LIST[sv][nama]; break; }
      }
    }

    // 2b. PRICE_LIST hardcode — fuzzy match
    if (!h) {
      outer: for (const sv of ["Install", "Material", "Repair"]) {
        if (!PRICE_LIST[sv]) continue;
        for (const [k, v] of Object.entries(PRICE_LIST[sv])) {
          if (k === "default" || !v) continue;
          const kn = mkNorm(k);
          if (norm.length >= 4 && (kn === norm || kn.includes(norm) || norm.includes(kn))) {
            h = v; break outer;
          }
        }
      }
    }

    // 3. Inventory — last resort (inventory = stok, price sering 0)
    if (!h) {
      const inv = inventoryData.find(i => {
        const n = mkNorm(i.name);
        return n === norm || (norm.length >= 4 && (n.includes(norm) || norm.includes(n)));
      });
      if (inv?.price > 0) h = inv.price;
    }

    // 4. Freon specific
    if (!h && isF) {
      h = nama2.includes("r22") ? PRICE_LIST["freon_R22"] || 450000 :
        nama2.includes("r32") ? PRICE_LIST["freon_R32"] || 450000 :
          PRICE_LIST["freon_R410A"] || 450000;
    }

    return h;
  }, [inventoryData, priceListData]);

  const hitungMaterialTotal = (materials) => {
    return materials.reduce((sum, m) => {
      const raw = (m.nama || "").toLowerCase().trim();
      const norm = raw
        .replace(/,/g, ".")
        .replace(/eterna\s*/g, "")
        .replace(/[-\s]/g, "")
        .replace(/r410a?$/, "r410")
        .replace(/r22a?$/, "r22")
        .replace(/r32a?$/, "r32");
      const isJasaItem = /^(jasa|kuras|bongkar pasang|pemasangan|pasang)/i.test((m.nama || "").trim());

      const mkN = (s) => (s || "").toLowerCase()
        .replace(/,/g, ".").replace(/eterna\s*/g, "").replace(/hoda\s*/g, "")
        .replace(/[-\s]/g, "").replace(/r410a?$/, "r410").replace(/r22a?$/, "r22").replace(/r32a?$/, "r32");

      // PRIORITY 1a: priceListData DB exact match
      let harga = 0;
      const mNama = m.nama || "";
      const plIt = priceListData.find(r => r.type && r.type.trim() === mNama.trim());
      if (plIt && plIt.price > 0) harga = parseInt(plIt.price) || 0;

      // PRIORITY 1b: priceListData fuzzy match (kabel, breket, dll)
      if (!harga) {
        const nNorm = mkN(mNama);
        const plFuzzy = priceListData.find(r => {
          if (!r.type || !r.price) return false;
          const t = mkN(r.type);
          return nNorm.length >= 4 && (t === nNorm || t.includes(nNorm) || nNorm.includes(t));
        });
        if (plFuzzy && plFuzzy.price > 0) harga = plFuzzy.price;
      }

      // PRIORITY 2a: PRICE_LIST exact name match
      if (!harga) {
        for (const svc of ["Install", "Material", "Repair", "Cleaning", "Complain"]) {
          if (PRICE_LIST[svc]?.[mNama]) { harga = PRICE_LIST[svc][mNama]; break; }
        }
      }

      // PRIORITY 2b: PRICE_LIST fuzzy match (default prices untuk install materials)
      if (!harga) {
        const nNorm = mkN(mNama);
        outer: for (const svc of ["Install", "Material", "Repair"]) {
          if (!PRICE_LIST[svc]) continue;
          for (const [k, v] of Object.entries(PRICE_LIST[svc])) {
            if (k === "default" || !v) continue;
            const kn = mkN(k);
            if (nNorm.length >= 4 && (kn === nNorm || kn.includes(nNorm) || nNorm.includes(kn))) {
              harga = v; break outer;
            }
          }
        }
      }

      // PRIORITY 3: Cari di inventory (hanya fallback, jangan gunakan sebagai primary)
      if (!harga && !isJasaItem) {
        const invItem = inventoryData.find(inv => {
          const n = inv.name.toLowerCase()
            .replace(/,/g, ".").replace(/eterna\s*/g, "")
            .replace(/[-\s]/g, "").replace(/r410a?$/, "r410")
            .replace(/r22a?$/, "r22").replace(/r32a?$/, "r32");
          if (n === norm) return true;
          if (norm.length > 6 && n.includes(norm)) return true;
          if (n.length > 6 && norm.includes(n)) return true;
          return false;
        });
        if (invItem && invItem.price > 0) harga = invItem.price;
      }

      // PRIORITY 4: Fallback freon spesifik — skip jika isJasaItem
      if (!harga && !isJasaItem) {
        if (raw.includes("r-22") || raw.includes("r22")) harga = PRICE_LIST["freon_R22"] || 450000;
        else if (raw.includes("r-32") || raw.includes("r32")) harga = PRICE_LIST["freon_R32"] || 450000;
        else if (raw.includes("r-410") || raw.includes("r410")) harga = PRICE_LIST["freon_R410A"] || 450000;
      }

      return sum + (harga * (parseFloat(m.jumlah) || 0));
    }, 0);
  };

  // ── GAP 3: Approve invoice (real state mutation) ──
  // ── Approve invoice (core) — tanpa kirim WA ──
  const approveInvoiceCore = async (inv) => {
    // Input validation
    if (!inv.id || inv.id.trim().length === 0) {
      showNotif("❌ Invoice ID tidak valid");
      return null;
    }
    // Allow Rp 0 for repair_gratis (free repairs), but require positive for regular invoices
    if (!inv.repair_gratis && !validatePositiveNumber(inv.total)) {
      showNotif("❌ Invoice total harus lebih dari 0");
      return null;
    }
    if (!inv.customer || inv.customer.trim().length === 0) {
      showNotif("❌ Nama customer tidak valid");
      return null;
    }

    const today = getLocalDate();
    const due = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const approvedAt = getLocalISOString(); // Indonesia timezone (UTC+7)
    const sentAt = getLocalISOString(); // When invoice sent/approved timestamp
    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? { ...i, status: "UNPAID", sent: sentAt, due } : i
    ));
    setOrdersData(prev => prev.map(o =>
      o.id === inv.job_id ? { ...o, invoice_id: inv.id, status: "INVOICE_APPROVED" } : o
    ));
    // GAP 4: simpan approved_by, trigger DB akan catat audit_log
    await setAuditUser();
    // Update invoice — try full, fallback minimal
    {
      const { error: apErr } = await updateInvoice(supabase, inv.id, {
        status: "UNPAID", sent: true, due,
        approved_by: currentUser?.name || null,
        approved_at: approvedAt,
      }, auditUserName());
      if (apErr) {
        console.warn("invoice approve full failed:", apErr.message);
        const { error: apErr2 } = await updateInvoice(supabase, inv.id, { status: "UNPAID" }, auditUserName());
        if (apErr2) console.error("invoice approve minimal failed:", apErr2.message);
      }
    }
    // Update order status — with fallback
    {
      const { error: oErr } = await updateOrderStatus(supabase, inv.job_id, "INVOICE_APPROVED", auditUserName(), { invoice_id: inv.id });
      if (oErr) {
        console.warn("orders INVOICE_APPROVED failed:", oErr.message);
        await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName());
      }
    }
    addAgentLog("INVOICE_APPROVED", `Invoice ${inv.id} approve oleh ${currentUser?.name || "—"} — ${inv.customer} ${fmt(inv.total)}`, "SUCCESS");
    return due; // kembalikan due date untuk dipakai caller
  };

  // ── approveInvoice: buka popup pilihan (Kirim ke Customer / Simpan Dahulu) ──
  const approveInvoice = (inv) => {
    setPendingApproveInv(inv);
    setModalApproveInv(true);
  };

  // ── Approve + kirim WA ke customer (invoice + service report card sebagai PDF attachment) ──
  const approveAndSend = async (inv) => {
    const due = await approveInvoiceCore(inv);

    // Generate PDF invoice → upload → kirim sebagai attachment Fonnte
    const invoiceUrl = await uploadInvoicePDFForWA(inv);
    const waMsg = `Halo ${inv.customer}, invoice *AClean Service* telah disiapkan:\n\n🔧 ${inv.service || "Servis AC"}\n💰 Total: *${fmt(inv.total)}*\n📅 Jatuh tempo: ${due}\n\nPembayaran ke:\n*${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""} a.n. ${appSettings.bank_holder || ""}*\n\nTerima kasih! 🙏`;
    const sent = await sendWA(inv.phone, waMsg, invoiceUrl
      ? { url: invoiceUrl, filename: `Invoice-${inv.id}.pdf` }
      : {}
    );
    if (sent) showNotif(`✅ Invoice ${inv.id} diapprove & terkirim ke WA ${inv.customer}${invoiceUrl ? " 📎" : ""}`);
    else showNotif(`✅ Invoice ${inv.id} diapprove — WA gagal terkirim (cek koneksi Fonnte)`);

    setModalApproveInv(false); setPendingApproveInv(null);
  };

  // ── Approve saja tanpa kirim WA ──
  const approveSaveOnly = async (inv) => {
    await approveInvoiceCore(inv);
    showNotif(`✅ Invoice ${inv.id} diapprove — belum dikirim ke customer`);
    setModalApproveInv(false); setPendingApproveInv(null);
  };

  // ── GAP 1.6: Mark Paid → simpan ke payments table ──
  const markPaid = async (inv, method = "transfer", notes = "", sendCustNotif = null, paymentProofUrl = null) => {
    // Input validation
    if (!inv.id || inv.id.trim().length === 0) {
      showNotif("❌ Invoice ID tidak valid");
      return;
    }
    if (!validatePositiveNumber(inv.total)) {
      showNotif("❌ Invoice total harus lebih dari 0");
      return;
    }
    if (!inv.customer || inv.customer.trim().length === 0) {
      showNotif("❌ Nama customer tidak valid");
      return;
    }

    const paidAt = getLocalISOString();
    // H-04: Simpan status original untuk rollback jika DB gagal
    const originalInvStatus = inv.status;
    const originalOrderStatus = ordersData.find(o => o.id === inv.job_id || o.invoice_id === inv.id)?.status;

    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? { ...i, status: "PAID", paid_at: paidAt, ...(paymentProofUrl ? { payment_proof_url: paymentProofUrl } : {}) } : i
    ));
    setOrdersData(prev => prev.map(o =>
      (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: "PAID" } : o
    ));
    await setAuditUser();
    {
      const { error: mpErr } = await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
      if (mpErr) {
        console.warn("mark paid with paid_at failed, trying fallback:", mpErr.message);
        const { error: fbErr } = await updateInvoice(supabase, inv.id, { status: "PAID" }, auditUserName());
        if (fbErr) {
          // H-04: Rollback state jika semua DB update gagal
          console.error("markPaid DB failed completely, rolling back state:", fbErr.message);
          setInvoicesData(prev => prev.map(i =>
            i.id === inv.id ? { ...i, status: originalInvStatus, paid_at: inv.paid_at || null } : i
          ));
          if (originalOrderStatus) {
            setOrdersData(prev => prev.map(o =>
              (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: originalOrderStatus } : o
            ));
          }
          showNotif("❌ Gagal simpan ke database. Status dikembalikan. Coba lagi.");
          return;
        }
      }
    }
    // Simpan bukti bayar URL ke invoice jika ada (dari WA payment detection)
    if (paymentProofUrl) {
      supabase.from("invoices").update({ payment_proof_url: paymentProofUrl }).eq("id", inv.id).catch(() => {});
    }

    // Notif WA ke customer — hanya jika admin/owner menyetujui (sendCustNotif=true)
    const shouldNotif = sendCustNotif === true ||
      (sendCustNotif === null && await showConfirm({
        icon: "📱", title: "Kirim Notif WA?",
        message: "Kirim konfirmasi WA ke customer? " + inv.customer + " Rp " + (inv.total || 0).toLocaleString("id-ID"),
        confirmText: "Kirim WA"
      }));
    if (shouldNotif && inv.phone) {
      sendWA(inv.phone,
        "Pembayaran " + inv.id + " Rp " + (inv.total || 0).toLocaleString("id-ID") + " diterima. Terima kasih! — AClean"
      );
    }
    // GAP 1.6: Catat ke payments table untuk history + partial payment support
    try {
      await supabase.from("payments").insert({
        invoice_id: inv.id,
        amount: inv.total,
        method: method,
        notes: notes || "Lunas",
        paid_at: paidAt,
        verified: true,
        verified_by: currentUser?.id || null,
        verified_at: paidAt,
      });
    } catch (e) { console.warn("payments insert skip:", e?.message); }
    // Update customer last_service
    if (inv.phone) await supabase.from("customers").update({ last_service: paidAt.slice(0, 10) }).eq("phone", inv.phone);
    addAgentLog("PAYMENT_CONFIRMED", `Invoice ${inv.id} LUNAS — ${inv.customer} ${fmt(inv.total)} via ${method}`, "SUCCESS");
    showNotif(`💰 Invoice ${inv.id} LUNAS — ${fmt(inv.total)}`);
  };

  // ── GAP 6: Inventory deduct ──
  // GAP 1.2 + GAP 3: Inventory via transaction table — audit trail + cegah negatif
  const deductInventory = async (materials, orderId, reportId, customerName, teknisiName, jobDate) => {
    for (const mat of materials) {
      // Jika ada _useCode (freon tabung spesifik), match by code dulu
      const item = mat._useCode
        ? inventoryData.find(i => i.code === mat._useCode)
        : inventoryData.find(i =>
          i.name.toLowerCase().includes(mat.nama.toLowerCase()) ||
          mat.nama.toLowerCase().includes(i.name.toLowerCase())
        );
      if (!item) continue;
      const qty = parseFloat(mat.jumlah) || 0;
      // GAP 3: Cek stok cukup sebelum deduct
      if (item.stock < qty) {
        showNotif(`⚠️ Stok ${item.name} tidak cukup (tersedia: ${item.stock} ${item.unit}, butuh: ${qty}). Laporan tetap tersimpan.`);
        addAgentLog("STOCK_INSUFFICIENT", `${item.name}: butuh ${qty}, tersedia ${item.stock}`, "WARNING");
        continue;
      }
      const newStock = item.stock - qty;
      const newStatus = computeStockStatus(newStock, item.reorder);
      // Update local state
      setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, stock: newStock, status: newStatus } : i));
      // Insert transaksi ke DB (trigger Supabase akan update stock otomatis)
      try {
        await supabase.from("inventory_transactions").insert({
          inventory_code: item.code,
          inventory_name: item.name,
          order_id: orderId || null,
          report_id: reportId || null,
          qty: -qty,
          type: "usage",
          notes: mat.keterangan || "",
          customer_name: customerName || null,
          teknisi_name: teknisiName || currentUser?.name || null,
          job_date: jobDate || null,
          created_by: currentUser?.id || null,
          created_by_name: currentUser?.name || "",
          unit_id: mat._unitId || null,
          unit_label: mat._unitLabel || null,
        });
      } catch (e) { console.warn("inv tx skip:", e?.message); }
      if (newStatus === "CRITICAL" || newStatus === "OUT") {
        addAgentLog("STOCK_ALERT", `${item.name}: ${newStatus} (sisa ${newStock} ${item.unit})`, "WARNING");
      }
    }
  };

  // ── GAP 9: Create order (real state mutation) ──
  const createOrder = async (form) => {
    // Input validation
    if (!validateNameLength(form.customer)) {
      showNotif("❌ Nama customer harus 2-100 karakter");
      return null;
    }
    if (!validatePhone(form.phone)) {
      showNotif("❌ Format nomor HP tidak valid");
      return null;
    }
    if (!validateAddressLength(form.address)) {
      showNotif("❌ Alamat harus 5-255 karakter");
      return null;
    }
    if (!form.date || !validateDate(form.date)) {
      showNotif("❌ Format tanggal tidak valid (gunakan YYYY-MM-DD)");
      return null;
    }
    if (!form.time || !validateTime(form.time)) {
      showNotif("❌ Format jam tidak valid (gunakan HH:MM)");
      return null;
    }
    if (!form.service || form.service.trim().length === 0) {
      showNotif("❌ Pilih jenis layanan");
      return null;
    }
    if (!validatePositiveNumber(form.units)) {
      showNotif("❌ Jumlah unit harus lebih dari 0");
      return null;
    }
    if (!form.teknisi || form.teknisi.trim().length === 0) {
      showNotif("❌ Pilih teknisi");
      return null;
    }

    // GAP-1&2: DB-level conflict check (real-time, anti race condition)
    if (form.teknisi && form.date && form.time) {
      const dbCheck = await cekTeknisiAvailableDB(form.teknisi, form.date, form.time, form.service, form.units);
      if (!dbCheck.ok) {
        showNotif("⚠️ " + (dbCheck.reason || form.teknisi + " tidak tersedia di jam tersebut"));
        return null;
      }
    }
    // Higher entropy order ID to prevent collisions on simultaneous submissions
    const newId = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const timeEnd = hitungJamSelesai(form.time || "09:00", form.service || "Cleaning", form.units || 1);
    // Cek customer existing by phone ATAU name (untuk customer_id)
    const preExistCust = findCustomer(customersData, form.phone, form.customer);
    const newOrder = {
      id: newId,
      customer: form.customer, phone: normalizePhone(form.phone), address: form.address,
      customer_id: preExistCust?.id || null,
      service: form.service, type: form.type, units: parseInt(form.units) || 1,
      teknisi: form.teknisi, helper: form.helper || null,
      teknisi2: form.teknisi2 || null, helper2: form.helper2 || null,
      teknisi3: form.teknisi3 || null, helper3: form.helper3 || null,
      date: form.date, time: form.time, time_end: timeEnd, status: "CONFIRMED",
      invoice_id: null, dispatch: false, notes: form.notes || ""
    };

    // ── Fallback insert: coba full → minimal (BEFORE updating state) ──
    let orderSaved = false;

    // Attempt 1: full payload
    {
      const { error: e1 } = await insertOrder(supabase, newOrder);
      if (!e1) { orderSaved = true; }
      else console.warn("❌ A1 full:", e1.message, "| hint:", e1.hint, "| detail:", e1.details);
    }

    // Attempt 2: kolom aman saja
    if (!orderSaved) {
      const safe2 = {
        id: newOrder.id, date: newOrder.date, status: newOrder.status,
        service: newOrder.service, units: newOrder.units,
        customer: newOrder.customer, teknisi: newOrder.teknisi,
        helper: newOrder.helper, time: newOrder.time, time_end: newOrder.time_end,
        customer_id: newOrder.customer_id,
      };
      const { error: e2 } = await insertOrder(supabase, safe2);
      if (!e2) { orderSaved = true; }
      else console.warn("❌ A2 safe:", e2.message, "| hint:", e2.hint);
    }

    // Attempt 3: hanya id + date + service + units + status
    if (!orderSaved) {
      const minimal = {
        id: newOrder.id, date: newOrder.date,
        service: newOrder.service, units: newOrder.units, status: newOrder.status
      };
      const { error: e3 } = await insertOrder(supabase, minimal);
      if (!e3) { orderSaved = true; }
      else {
        console.error("❌ A3 minimal:", e3.message, "| hint:", e3.hint, "| detail:", e3.details);
        showNotif("❌ Gagal simpan order: " + e3.message + (e3.hint ? " — " + e3.hint : ""));
        return null;
      }
    }
    if (!orderSaved) return null;

    // ── Only update state AFTER DB confirmation ──
    invalidateCache("orders");
    setOrdersData(prev => [...prev, newOrder]);

    // GAP 1.5: Simpan ke technician_schedule untuk cegah double booking
    if (form.teknisi && form.date && form.time && timeEnd) {
      // Insert ke technician_schedule — field minimal agar kompatibel berbagai schema
      try {
        const schedPayload = {
          order_id: newId,
          teknisi: form.teknisi,
          date: form.date,
          time_start: form.time || "09:00",
          time_end: timeEnd,
          status: "ACTIVE",
        };
        const { error: se } = await supabase.from("technician_schedule").insert(schedPayload);
        if (se) console.error("technician_schedule 400:", se.message, "|", se.hint, "|", se.details, "| payload:", JSON.stringify(schedPayload));
      } catch (e) { /* technician_schedule opsional */ }
    }

    addAgentLog("ORDER_CREATED", `Order baru ${newId} — ${form.customer} (${form.service} ${form.units} unit)`, "SUCCESS");

    // ── AUTO-DISPATCH: Owner/Admin buat order → langsung dispatch ke teknisi ──
    // Teknisi tidak perlu menunggu tombol dispatch manual
    if (form.teknisi && (currentUser?.role === "Owner" || currentUser?.role === "Admin")) {
      // Update status ke DISPATCHED dulu
      setOrdersData(prev => prev.map(o =>
        o.id === newId ? { ...o, status: "DISPATCHED", dispatch: true, dispatch_at: new Date().toISOString() } : o
      ));
      await updateOrderStatus(supabase, newId, "DISPATCHED", auditUserName(), {
        dispatch: true, dispatch_at: new Date().toISOString()
      });

      // Kirim WA ke teknisi (dan helper jika ada) + customer
      await sendDispatchWA(newOrder);
      showNotif(`✅ Order ${newId} dibuat & WA dispatch dikirim ke ${form.teknisi}!`);
      addAgentLog("AUTO_DISPATCH", `Auto-dispatch ${newId} → ${form.teknisi}`, "SUCCESS");
    } else {
      showNotif(`✅ Order ${newId} berhasil dibuat!`);
    }

    // (komentar lama dihapus)

    // ── AUTO-SAVE CUSTOMER: tambah/update customer saat order dibuat ──
    if (form.phone && form.customer) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const orderDate = form.date || todayStr;
      const existing = findCustomer(customersData, form.phone, form.customer);

      if (!existing) {
        // ── Customer BARU ──
        if (!form.phone || form.phone.trim().length < 5) {
          // Phone kosong — skip insert, hanya log
          addAgentLog("CUSTOMER_SKIP", "Customer " + form.customer + " tidak disimpan: no HP kosong", "WARNING");
        } else {
          const insertPayload = {
            name: form.customer.trim(),
            phone: normalizePhone(form.phone),
            address: (form.address || "").trim(),
            area: (form.area || "").trim(),
            notes: "",
            is_vip: false,
            total_orders: 1,
            joined_date: orderDate,
            last_service: orderDate,
          };
          const { data: savedCust, error: custErr } = await supabase
            .from("customers")
            .insert(insertPayload)
            .select()
            .single();

          if (custErr) {
            // Fallback: upsert jika insert gagal (misal phone sudah ada di DB tapi belum di state)
            const { data: upsertedCust, error: upsertErr } = await supabase
              .from("customers")
              .upsert(insertPayload, { onConflict: "phone", ignoreDuplicates: false })
              .select()
              .single();
            if (upsertErr) {
              addAgentLog("CUSTOMER_SAVE_ERROR",
                "Gagal simpan customer " + form.customer + ": " + custErr.message, "ERROR");
              showNotif("⚠️ Customer gagal ke DB: " + custErr.message + " — tambah manual di menu Customer");
              setCustomersData(prev => [...prev, { ...insertPayload, id: "CUST_LOCAL_" + Date.now() }]);
            } else {
              const c2 = upsertedCust || { ...insertPayload, id: "CUST_" + Date.now() };
              setCustomersData(prev => [...prev, c2]);
              addAgentLog("CUSTOMER_AUTO_ADDED", "Customer baru: " + form.customer + " (" + form.phone + ")", "SUCCESS");
              showNotif("✅ Order + Customer baru " + form.customer + " tersimpan!");
            }
          } else {
            const c1 = savedCust || { ...insertPayload, id: "CUST_" + Date.now() };
            setCustomersData(prev => [...prev, c1]);
            addAgentLog("CUSTOMER_AUTO_ADDED", "Customer baru: " + form.customer + " (" + form.phone + ")", "SUCCESS");
            showNotif("✅ Order + Customer baru " + form.customer + " tersimpan ke database!");
          }
        }
      } else {
        // ── Customer EXISTING: update total_orders & last_service ──
        const updatedOrders = (existing.total_orders || 0) + 1;
        setCustomersData(prev => prev.map(c =>
          sameCustomer(c, form.phone, form.customer)
            ? { ...c, total_orders: updatedOrders, last_service: orderDate }
            : c
        ));
        try {
          await supabase.from("customers")
            .update({ total_orders: updatedOrders, last_service: orderDate })
            .eq("phone", normalizePhone(form.phone))
            .eq("name", form.customer.trim());
        } catch (e) {
          addAgentLog("CUSTOMER_UPDATE_WARN", "Gagal update total_orders: " + (e?.message || ""), "WARNING");
        }
      }
    }
    return newId;
  };

  // ── Connect ARA Brain dari Supabase ──
  const connectAraBrain = async () => {
    setAraLoading(true);
    try {
      const { data: brainData } = await fetchAraBrain(supabase);
      const brainMap = Object.fromEntries((brainData || []).map(row => [row.key, row.value]));

      if (!brainMap.brain_md || brainMap.brain_md.length < 10) {
        throw new Error("Brain data not found in database");
      }

      // Test connection — backend requires messages array
      const testPayload = {
        provider: llmProvider || "claude",
        model: llmModel || "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Halo, test koneksi." }],
        bizContext: {},
        brainMd: brainMap.brain_md.slice(0, 300),
      };

      const r = await fetch("/api/ara-chat", {
        method: "POST",
        headers: await _apiHeaders(),
        body: JSON.stringify(testPayload)
      });

      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody.error || "Connection test failed: " + r.status);
      }

      setBrainMd(brainMap.brain_md);
      _lsSave("brainMd", brainMap.brain_md);

      showNotif("✅ ARA Brain berhasil terhubung dengan Minimax 2.5!");
    } catch (e) {
      console.error("[connectAraBrain]", e);
      showNotif("❌ Gagal koneksi brain: " + e.message);
    } finally {
      setAraLoading(false);
    }
  };

  // ── GAP 8: ARA Chat dengan LLM + Tool Calls ──
  const sendToARA = async (userMsg) => {
    if (!userMsg.trim() || araLoading) return;
    const newMessages = [...araMessages, { role: "user", content: userMsg }];
    setAraMessages(newMessages);
    setAraInput("");
    setAraLoading(true);
    // Clear image after sending
    const sentImagePreview = araImagePreview;
    setAraImageData(null); setAraImageType(null); setAraImagePreview(null);

    const bizContext = {
      today: TODAY,
      orders: ordersData.map(o => ({ id: o.id, customer: o.customer, service: o.service, type: o.type, units: o.units, status: o.status, date: o.date, time: o.time, teknisi: o.teknisi, helper: o.helper, dispatch: o.dispatch, invoice_id: o.invoice_id })),
      invoices: invoicesData.map(i => ({ id: i.id, customer: i.customer, phone: i.phone, total: i.total, status: i.status, due: i.due, labor: i.labor, material: i.material, dadakan: i.dadakan, materials_detail: (i.materials_detail || []).map(m => ({ nama: m.nama, jumlah: m.jumlah, satuan: m.satuan, harga_satuan: m.harga_satuan, subtotal: m.subtotal })) })),
      inventory: inventoryData.map(i => ({ code: i.code, name: i.name, stock: i.stock, unit: i.unit, status: i.status, price: i.price, reorder: i.reorder })),
      customers: customersData.map(c => ({ id: c.id, name: c.name, phone: c.phone, area: c.area, total_orders: c.total_orders, is_vip: c.is_vip })),
      laporan: laporanReports.map(r => ({
        id: r.id, job_id: r.job_id, teknisi: r.teknisi, customer: r.customer,
        service: r.service, status: r.status, date: r.date, submitted: r.submitted,
        is_install: r.service === "Install",
        pekerjaan_aktual: (r.units || []).flatMap(u => u.pekerjaan || []),
        has_service_besar: (r.units || []).some(u => (u.pekerjaan || []).some(p => p.toLowerCase().includes("besar") || p.toLowerCase().includes("deep"))),
        service_besar_type: (r.units || []).some(u => (u.pekerjaan || []).some(p => p.toLowerCase().includes("besar") || p.toLowerCase().includes("deep"))) ? (r.total_units > 1 ? "Jasa Service Besar 1,5PK - 2,5PK" : "Jasa Service Besar 0,5PK - 1PK") : null,
        materials: (r.materials || []).map(m => ({ nama: m.nama, jumlah: m.jumlah, satuan: m.satuan })),
        total_units: r.total_units || 0,
      })),
      laporanPending: laporanReports.filter(r => r.status === "SUBMITTED").length,
      laporanRevisi: laporanReports.filter(r => r.status === "REVISION").length,
      teknisiWorkload: teknisiData.filter(t => t.role === "Teknisi" || t.role === "teknisi").map(t => ({
        name: t.name, role: t.role, status: t.status,
        phone: t.phone || "",
        skills: Array.isArray(t.skills) ? t.skills : [],
        area: t.area || "",
        jobsToday: ordersData.filter(o => o.teknisi === t.name && o.date === TODAY).length,
        jobsPending: ordersData.filter(o => o.teknisi === t.name && ["CONFIRMED", "IN_PROGRESS"].includes(o.status)).length,
        slotKosongHariIni: cariSlotKosong(t.name, TODAY, "Cleaning", 1),
        jadwalHariIni: ordersData.filter(o => o.teknisi === t.name && o.date === TODAY).map(o => ({ id: o.id, time: o.time, time_end: o.time_end || "?", service: o.service, units: o.units, customer: o.customer })),
      })),
      helperList: teknisiData.filter(t => t.role === "Helper" || t.role === "helper").map(t => ({
        name: t.name, role: t.role, status: t.status,
        phone: t.phone || "",
        skills: Array.isArray(t.skills) ? t.skills : [],
        jobsToday: ordersData.filter(o => o.helper === t.name && o.date === TODAY).length,
      })),
      areaPelayanan: {
        utama: ["Alam Sutera", "BSD", "Gading Serpong", "Graha Raya", "Karawaci", "Tangerang", "Tangerang Selatan", "Serpong"],
        konfirmasi: ["Jakarta Barat"],
      },
      // ── Rekomendasi slot dari araSchedulingSuggest (sudah dihitung, ARA tinggal baca) ──
      slotRekomendasi: (() => {
        try {
          const { pref, sorted } = araSchedulingSuggest(TODAY, "Cleaning", 1);
          return {
            teknisiDisarankan: sorted ? sorted.slice(0, 3).map(t => ({
              nama: t.name,
              jobsHariIni: ordersData.filter(o => o.teknisi === t.name && o.date === TODAY).length,
              helperFavorit: pref[t.name] || null,
              slotTersedia: true
            })) : [],
            pasanganFavorit: pref,
          };
        } catch (_) { return { teknisiDisarankan: [], pasanganFavorit: {} }; }
      })(),
      logikaDurasi: "Cleaning: 1u=1j,2u=2j,3u=3j,4u=3j,5-6u=4j,7-8u=5j,9-10u=6j,>10=sehari | Install: 1-3u=1hari,4+u=2hari | Repair: 60-120mnt/unit | Complain: 1u=30mnt,setiap tambahan unit +15mnt",
      jamKerja: "09:00-17:00 WIB",
      revenueStats: {
        bulanIni: invoicesData.filter(i => i.status === "PAID" && String(i.sent || i.created_at || "").startsWith(bulanIni)).reduce((a, b) => a + (b.total || 0), 0),
        totalUnpaid: invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").reduce((a, b) => a + (b.total || 0), 0),
        stokKritis: inventoryData.filter(i => i.status === "OUT" || i.status === "CRITICAL").map(i => i.name),
      },
      // ── PRICE LIST LIVE: baca dari priceListData (React state — reactive) ──
      // priceListData di-update setiap kali ada perubahan di Supabase via realtime
      hargaLayanan: (() => {
        const src = priceListData.filter(r => r.is_active !== false);
        if (src.length === 0) {
          // Fallback ke PRICE_LIST var jika state belum load
          const rows = [];
          Object.entries(PRICE_LIST).forEach(([svc, types]) => {
            if (typeof types === "object" && !Array.isArray(types)) {
              Object.entries(types).forEach(([tipe, harga]) => {
                if (tipe !== "default") rows.push({ service: svc, type: tipe, harga, formatted: "Rp" + Number(harga).toLocaleString("id-ID") });
              });
            }
          });
          return rows;
        }
        return src.map(r => ({
          service: r.service,
          type: r.type,
          harga: Number(r.price) || 0,
          formatted: "Rp" + Number(r.price || 0).toLocaleString("id-ID"),
          notes: r.notes || null,
        }));
      })(),
    };

    try {
      let fullText = "";

      // ── Coba backend proxy dulu (API key aman di server) ──
      const backendRes = await fetch("/api/ara-chat", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          bizContext, brainMd, provider: llmProvider, model: llmModel, ollamaUrl,
          ...(araImageData ? { imageData: araImageData, imageType: araImageType } : {})
        })
      }).catch(() => null);

      if (backendRes?.ok) {
        const d = await backendRes.json();
        fullText = d.reply || "";
        // Jika backendRes ok tapi reply kosong — tangkap error dari server
        if (!fullText && d.error) throw new Error(d.error);
        if (!fullText) throw new Error("ARA tidak memberikan respons. Cek Vercel logs: kemungkinan LLM_API_KEY belum diset di Vercel Environment Variables.");
      } else if (backendRes && !backendRes.ok) {
        // ara-chat.js error (400/500) — ambil pesan error dari body
        try {
          const errData = await backendRes.json();
          throw new Error(errData.error || "Server error " + backendRes.status);
        } catch (je) {
          throw new Error(je.message || "ara-chat server error " + backendRes.status);
        }
      } else if (!backendRes && llmProvider === "ollama") {
        // ── Ollama ONLY: Fallback jika /api/ara-chat tidak tersedia (localhost dev) ──
        // SECURITY NOTE: Direct API calls with keys are NOT supported anymore
        // Production: always use backend /api/ara-chat endpoint (keys are safe on server)
        // Development: use /api/ara-chat or local Ollama
        const sysP = (typeof brainMd === "string" ? brainMd : BRAIN_MD_DEFAULT) + `\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext)}\n\n## TOOL — ACTIONS TERSEDIA\nGunakan [ACTION]{...}[/ACTION] untuk eksekusi operasi. Format JSON:\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"labor","value":100000} (field: labor/material/dadakan/notes. Detail material ada di invoices[].materials_detail)\\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"material","value":200000} (ubah total material)\\n- {"type":"MARK_PAID","id":"INV-xxx"}\n- {"type":"APPROVE_INVOICE","id":"INV-xxx"}\n- {"type":"SEND_REMINDER","invoice_id":"INV-xxx"}\n- {"type":"UPDATE_ORDER_STATUS","id":"JOB-xxx","status":"COMPLETED"}\n- {"type":"DISPATCH_WA","order_id":"JOB-xxx"}\n- {"type":"SEND_WA","phone":"628xxx","message":"..."}\n- {"type":"UPDATE_STOCK","code":"MAT001","delta":5} (delta=tambah/kurang)\n- {"type":"CANCEL_ORDER","id":"JOB-xxx","reason":"..."}
- {"type":"CREATE_INVOICE","order_id":"ORD-xxx"}\n- {"type":"RESCHEDULE_ORDER","id":"JOB-xxx","date":"2026-03-10","time":"09:00","teknisi":"Mulyadi"}\nGunakan data teknisiWorkload.slotKosongHariIni dan jadwalHariIni untuk cek jadwal kosong. Area utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan. Jakarta Barat: perlu konfirmasi admin.\n- {"type":"MARK_INVOICE_OVERDUE"} (tandai semua yang lewat due date)\nHanya gunakan 1 ACTION per response. Konfirmasi ke user setelah eksekusi.`;

        if (llmProvider === "ollama") {
          // ── Ollama Local / ngrok ──
          // H-07: SSRF validation — block internal/cloud-metadata URLs
          const _isValidOllamaUrl = (url) => {
            try {
              const p = new URL(url);
              if (!["http:","https:"].includes(p.protocol)) return false;
              const h = p.hostname.toLowerCase();
              if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.|::1)/.test(h)) return false;
              if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)) return false;
              return true;
            } catch { return false; }
          };
          const baseUrl = (ollamaUrl || "").replace(/\/+$/, "");
          if (!baseUrl || !_isValidOllamaUrl(baseUrl)) {
            setMessages(prev => [...prev, { role: "assistant", content: "⚠️ Ollama URL tidak valid atau menggunakan alamat internal. Masukkan URL publik (contoh: https://xxxx.ngrok.io)." }]);
            setAraLoading(false);
            return;
          }
          const fr = await fetch(baseUrl + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: llmModel || "llama3",
              stream: false,
              messages: [
                { role: "system", content: sysP },
                ...newMessages.map(m => ({ role: m.role, content: m.content }))
              ]
            })
          });
          if (!fr.ok) {
            const txt = await fr.text().catch(() => "");
            throw new Error("Ollama error " + fr.status + (txt ? ": " + txt.slice(0, 100) : ""));
          }
          const fd = await fr.json();
          fullText = fd.message?.content || fd.response || "";
        } else {
          // ── SECURITY: No direct API calls from frontend ──
          // All LLM calls must go through /api/ara-chat backend endpoint
          // This ensures API keys are never exposed in browser
          throw new Error(`Provider "${llmProvider}" requires backend /api/ara-chat endpoint. Is your API server running?`);
        }
      } else {
        const needKey = llmProvider !== "ollama";
        const hasKey = llmProvider === "ollama" ? !!ollamaUrl : !!llmApiKey;
        if (!hasKey) throw new Error(llmProvider === "ollama"
          ? "URL Ollama belum diset. Buka Pengaturan → ARA Brain → masukkan URL Ollama."
          : "API Key belum diset. Buka Pengaturan → ARA Brain.");
        // fallthrough tidak akan terjadi karena sudah ada routing di atas
      }

      // ── Parse & eksekusi ACTION tags ──
      const am = fullText.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let ar = "";
      if (am) {
        try {
          const act = JSON.parse(am[1].trim());
          // H-06: Role check — aksi sensitif hanya Owner/Admin
          const ARA_SENSITIVE = ["UPDATE_INVOICE","MARK_PAID","APPROVE_INVOICE","CANCEL_ORDER","CREATE_EXPENSE","UPDATE_STOCK","MARK_INVOICE_OVERDUE"];
          const araCallerRole = currentUser?.role || "";
          if (ARA_SENSITIVE.includes(act.type) && !["Owner","Admin"].includes(araCallerRole)) {
            ar = `\n⚠️ *Aksi ${act.type} hanya bisa dilakukan Owner/Admin. Hubungi Owner untuk melanjutkan.*`;
            addAgentLog("ARA_BLOCKED", `ARA blocked ${act.type} — caller role: ${araCallerRole}`, "WARNING");
          } else
          if (act.type === "UPDATE_INVOICE") {
            setInvoicesData(prev => prev.map(i => { if (i.id !== act.id) return i; const u = { ...i, [act.field]: act.value }; u.total = (u.labor || 0) + (u.material || 0) + (u.dadakan || 0); return u; }));
            await setAuditUser();
            await updateInvoice(supabase, act.id, { [act.field]: act.value }, auditUserName());
            addAgentLog("ARA_ACTION", `ARA update ${act.id}: ${act.field}=${fmt(act.value)}`, "SUCCESS");
            ar = `\n✅ *Invoice ${act.id} diupdate — ${act.field}: ${fmt(act.value)}*`;
          } else if (act.type === "MARK_PAID") {
            markPaid(invoicesData.find(i => i.id === act.id) || { id: act.id, customer: "", total: 0 });
            ar = `\n✅ *Invoice ${act.id} ditandai LUNAS*\n💬 Notif WA ke customer akan diminta konfirmasi admin.`;
          } else if (act.type === "APPROVE_INVOICE") {
            approveInvoice(invoicesData.find(i => i.id === act.id) || { id: act.id, job_id: "", customer: "", total: 0 });
            ar = `\n✅ *Invoice ${act.id} diapprove*`;
          } else if (act.type === "SEND_REMINDER") {
            const inv = invoicesData.find(i => i.id === act.invoice_id);
            if (inv) { invoiceReminderWA(inv); ar = `\n✅ *Reminder dikirim ke ${inv.customer}*`; }
          } else if (act.type === "UPDATE_ORDER_STATUS") {
            setOrdersData(prev => prev.map(o => o.id === act.id ? { ...o, status: act.status } : o));
            await setAuditUser();
            await updateOrderStatus(supabase, act.id, act.status, auditUserName());
            addAgentLog("ARA_ACTION", `ARA update status ${act.id} → ${act.status}`, "SUCCESS");
            ar = `\n✅ *Order ${act.id} → ${act.status}*`;
          } else if (act.type === "DISPATCH_WA") {
            const orderD = ordersData.find(o => o.id === act.order_id);
            if (orderD) { await dispatchWA(orderD); ar = `\n✅ *Dispatch WA dikirim untuk ${act.order_id}*`; }
            else ar = `\n⚠️ *Order ${act.order_id} tidak ditemukan*`;
          } else if (act.type === "SEND_WA") {
            const sent = await sendWA(act.phone, act.message);
            addAgentLog("ARA_WA_SENT", `ARA kirim WA ke ${act.phone}`, sent ? "SUCCESS" : "WARNING");
            ar = `\n✅ *WA dikirim ke ${act.phone}*`;
          } else if (act.type === "UPDATE_STOCK") {
            const item = inventoryData.find(i => i.code === act.code || i.name.toLowerCase().includes((act.name || "").toLowerCase()));
            if (item) {
              const delta = act.delta || (act.stock != null ? act.stock - item.stock : 0);
              const txType = delta >= 0 ? "restock" : "usage";
              // GAP 1: lewat inventory_transactions → trigger DB update stock otomatis
              const { error: txErr } = await supabase.from("inventory_transactions").insert({
                inventory_code: item.code,
                inventory_name: item.name,
                qty: delta,
                type: txType,
                notes: `ARA ${txType}: ${act.reason || ""}`,
                created_by: currentUser?.id || null,
                created_by_name: currentUser?.name || "ARA",
              });
              if (txErr) {
                // Fallback: update langsung jika trigger belum jalan
                const newStock = Math.max(0, item.stock + delta);
                const ns = computeStockStatus(newStock, item.reorder);
                setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, stock: newStock, status: ns } : i));
                await supabase.from("inventory").update({ stock: newStock, status: ns }).eq("code", item.code);
                ar = `\n✅ *Stok ${item.name} diupdate → ${newStock} ${item.unit}*`;
              } else {
                // Reload inventory dari DB setelah trigger update
                const { data: freshInv } = await fetchInventory(supabase);
                if (freshInv) setInventoryData(freshInv);
                const newStock = item.stock + delta;
                ar = `\n✅ *Stok ${item.name} ${delta >= 0 ? "ditambah +" + delta : "dikurangi " + delta} → ${newStock} ${item.unit}*`;
              }
              addAgentLog("ARA_STOCK", `ARA ${txType} ${item.name}: delta ${delta}`, "SUCCESS");
            } else ar = `\n⚠️ *Material tidak ditemukan*`;
          } else if (act.type === "CREATE_ORDER") {
            const today = getLocalDate();
            const seq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
            const newId = "ORD-" + (act.date || today).replace(/-/g, "").slice(2, 8) + "-" + seq;
            // Normalize service type — handle case insensitive + alias dari bahasa natural
            const _normSvc = (s) => {
              const sl = (s || "").toLowerCase().trim();
              if (sl.includes("install") || sl.includes("pasang") || sl.includes("baru")) return "Install";
              if (sl.includes("repair") || sl.includes("perbaikan") || sl.includes("servis")) return "Repair";
              if (sl.includes("complain") || sl.includes("komplain") || sl.includes("garansi") || sl.includes("complain")) return "Complain";
              if (sl.includes("bongkar")) return "Repair"; // bongkar = repair category
              return "Cleaning"; // default
            };
            // Validate teknisi ada di DB
            const _tekValid = (nm) => !nm || teknisiData.some(t => t.name.toLowerCase() === (nm || "").toLowerCase());
            const _helperValid = (nm) => !nm || teknisiData.some(t => t.role === "Helper" && t.name.toLowerCase() === (nm || "").toLowerCase());
            const normService = _normSvc(act.service);
            const normTeknisi = act.teknisi
              ? (teknisiData.find(t => (t.role === "Teknisi" || t.role === "Helper") && t.name.toLowerCase() === (act.teknisi || "").toLowerCase())?.name || act.teknisi)
              : "";
            const newOrd = {
              id: newId,
              customer: act.customer || "?",
              phone: act.phone || "",
              address: act.address || "",
              service: normService,
              units: parseInt(act.units) || 1,
              teknisi: normTeknisi,
              helper: act.helper || "",
              date: act.date || today,
              time: act.time || "09:00",
              status: "PENDING",
              notes: act.notes || "",
              dispatch: false,
              created_at: new Date().toISOString(),
            };
            // ── Auto-enforce helper rule: 3+ unit ATAU Install untuk SEMUA service ──
            if ((parseInt(newOrd.units) || 1) >= 3 || newOrd.service === "Install") {
              if (!newOrd.helper) {
                const availHelper = teknisiData.find(t => t.role === "Helper" && t.status !== "inactive");
                if (availHelper) { newOrd.helper = availHelper.name; }
                else addAgentLog("ARA_WARN", "Helper dibutuhkan tapi belum ada di database", "WARNING");
              }
            }
            setOrdersData(prev => [...prev, newOrd]);
            const { error: oErr } = await insertOrder(supabase, newOrd);
            if (oErr) console.warn("Create order DB:", oErr.message);
            addAgentLog("ARA_CREATE_ORDER", "ARA buat order " + newId + " untuk " + newOrd.customer, "SUCCESS");

            // ── Auto-upsert customer (new vs existing detection) ──
            if (newOrd.phone && newOrd.customer) {
              const existingCust = findCustomer(customersData, newOrd.phone, newOrd.customer);
              if (!existingCust) {
                const newCust = {
                  id: "CUST" + Date.now(),
                  name: newOrd.customer, phone: newOrd.phone,
                  address: newOrd.address || "", area: "",
                  total_orders: 1, joined_date: newOrd.date, last_service: newOrd.date, is_vip: false
                };
                setCustomersData(prev => [...prev, newCust]);
                try {
                  await upsertCustomer(
                    supabase,
                    { name: newOrd.customer, phone: newOrd.phone, address: newOrd.address || "", joined_date: newOrd.date },
                    "phone"
                  );
                } catch (e) { console.warn("Customer upsert:", e?.message); }
                ar += "\n👤 *Customer baru ditambahkan: " + newOrd.customer + "*";
              } else {
                // Update total_orders untuk customer existing
                setCustomersData(prev => prev.map(c =>
                  sameCustomer(c, newOrd.phone, newOrd.customer) ? { ...c, total_orders: (c.total_orders || 0) + 1, last_service: newOrd.date } : c
                ));
                try {
                  await supabase.from("customers").update({
                    total_orders: (existingCust.total_orders || 0) + 1, last_service: newOrd.date
                  }).eq("phone", newOrd.phone);
                } catch (e) { console.warn("Customer update skip:", e?.message); }
                ar += "\n👤 *Customer existing: " + newOrd.customer + " (order ke-" + ((existingCust.total_orders || 0) + 1) + ")*";
              }
            }

            ar = "\n✅ *Order " + newId + " dibuat untuk " + newOrd.customer + " — " + newOrd.service + " " + newOrd.units + " unit, " + newOrd.date + " jam " + newOrd.time + "*" + ar;
          } else if (act.type === "CREATE_INVOICE") {
            // Buat invoice dari order yang sudah COMPLETED
            const ord = ordersData.find(o => o.id === act.order_id);
            // Query DB langsung untuk cegah race (local state bisa stale saat ARA dispatch cepat).
            const { data: existingDBInv } = await supabase
              .from("invoices").select("id,status")
              .eq("job_id", act.order_id).neq("status", "CANCELLED").limit(1);
            if (!ord) { ar = "\n⚠️ *Order " + act.order_id + " tidak ditemukan*"; }
            else if (existingDBInv && existingDBInv.length > 0) {
              const existing = existingDBInv[0];
              ar = `\n⚠️ *Invoice untuk order ini sudah ada: ${existing.id}* (status: ${existing.status})`;
              addAgentLog("ARA_DUPLICATE_INVOICE", `Duplicate invoice attempt for order ${act.order_id} — existing: ${existing.id}`, "WARNING");
            }
            else {
              const today = getLocalDate();
              const seq2 = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
              const invId = "INV-" + today.replace(/-/g, "").slice(2, 8) + "-" + seq2;
              // Cek pekerjaan aktual + tipe AC dari laporan teknisi
              const lapRepForLabor = laporanReports.find(r => r.job_id === ord.id);
              const hasServiceBesar = lapRepForLabor?.units
                ? lapRepForLabor.units.some(u => (u.pekerjaan || []).some(p =>
                  p.toLowerCase().includes("besar") || p.toLowerCase().includes("deep")))
                : false;

              // ── BUILD EFFECTIVE TYPE untuk invoice ──
              // Priority: 1) Laporan tipe AC+PK detail, 2) Service besar detection, 3) Order type, 4) Default
              let effectiveType = "default";
              if (lapRepForLabor?.units && lapRepForLabor.units.length > 0) {
                // Build type dari tipe AC + PK di laporan (Step 1 detail)
                const typeList = lapRepForLabor.units
                  .filter(u => u.tipe && u.pk)
                  .map(u => `${u.tipe} ${u.pk}`)
                  .join(", ");
                if (typeList) effectiveType = typeList; // Contoh: "Cassette 5PK, Split 1PK"
              }

              // Jika service besar → gunakan harga service besar (override tipe jika ada)
              if (hasServiceBesar && ord.service === "Cleaning") {
                effectiveType = (ord.units || 1) > 1
                  ? "Jasa Service Besar 1,5PK - 2,5PK"
                  : "Jasa Service Besar 0,5PK - 1PK";
              }

              // Fallback ke order type jika laporan tidak ada
              if (effectiveType === "default" && ord.type) {
                effectiveType = ord.type;
              }

              const labor = PRICE_LIST[ord.service]?.[effectiveType] ||
                PRICE_LIST[ord.service]?.["default"] || 85000;
              const laborTotal = labor * (ord.units || 1);

              // ── Baca material + freon dari laporan teknisi ──
              const lapRep = laporanReports.find(r => r.job_id === ord.id);
              const materialCost = lapRep?.materials
                ? lapRep.materials.reduce((sum, m) => {
                  // Lookup harga dari inventory (sama seperti hitungMaterialTotal)
                  const _mNama = (m.nama || "").toLowerCase();
                  const _invItem = inventoryData.find(inv =>
                    inv.name.toLowerCase().includes(_mNama) || _mNama.includes(inv.name.toLowerCase())
                  );
                  let harga = _invItem?.price || m.harga || m.price || 0;
                  // Fallback ke PRICE_LIST freon jika tidak ada di inventory
                  if (!harga) {
                    if (_mNama.includes("r-22") || _mNama.includes("r22")) harga = PRICE_LIST["freon_R22"] || 150000;
                    else if (_mNama.includes("r-32") || _mNama.includes("r32")) harga = PRICE_LIST["freon_R32"] || 450000;
                    else if (_mNama.includes("r-410") || _mNama.includes("r410")) harga = PRICE_LIST["freon_R410A"] || 450000;
                  }
                  const qty = parseFloat(m.jumlah || m.qty || m.quantity || 1);
                  return sum + (harga * qty);
                }, 0)
                : 0;
              // [OPSI A] Freon tidak dihitung dari total_freon (psi data)
              const freonCost = 0; // freon masuk via material manual
              // Freon: hitung dari total_freon × harga freon (R32=200rb, R22=150rb default R32)

              // Dadakan jika booking H-0
              const isToday = ord.date === today;
              const dadakanFee = isToday ? 50000 : 0;
              const totalInv = laborTotal + materialCost + dadakanFee;

              // Build materials_detail for ARA invoice from laporan
              const _araMatDetail = (() => {
                if (!lapRep) return null;
                const mats = (() => {
                  if (lapRep.materials_json) { try { return JSON.parse(lapRep.materials_json); } catch (_) { } }
                  return safeArr(lapRep.materials);
                })().filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
                if (!mats.length) return null;
                return JSON.stringify(mats.map(m => ({
                  nama: m.nama, jumlah: parseFloat(m.jumlah) || 1,
                  satuan: m.satuan || "pcs",
                  harga_satuan: parseFloat(m.harga_satuan) || 0,
                  subtotal: (parseFloat(m.harga_satuan) || 0) * (parseFloat(m.jumlah) || 1),
                  keterangan: m.keterangan || ""
                })));
              })();
              const newInv = {
                id: invId, job_id: ord.id,
                customer: ord.customer, phone: ord.phone || "",
                service: ord.service + (ord.type ? " - " + ord.type : ""),
                units: ord.units || 1,
                labor: laborTotal,
                material: materialCost,
                materials_detail: _araMatDetail,
                dadakan: dadakanFee,
                discount: 0,
                total: totalInv,
                status: "PENDING",
                garansi_days: 30,
                garansi_expires: new Date(Date.now() + 30 * 86400000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
                laporan_id: lapRep?.id || null,
                due: new Date(Date.now() + 3 * 86400000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
                sent: false, created_at: getLocalISOString()
              };
              invalidateCache("invoices", "orders");
              setInvoicesData(prev => [...prev, newInv]);
              const { error: invErr } = await insertInvoice(supabase, newInv);
              if (invErr) console.warn("Create invoice DB:", invErr.message);
              // Link invoice ke order
              setOrdersData(prev => prev.map(o => o.id === ord.id ? { ...o, invoice_id: invId } : o));
              await updateOrder(supabase, ord.id, { invoice_id: invId }, auditUserName());
              addAgentLog("ARA_CREATE_INVOICE", "ARA buat invoice " + invId + " dari " + ord.id + " — " + newInv.customer, "SUCCESS");
              ar = "\n✅ *Invoice " + invId + " dibuat untuk " + newInv.customer + " — Total: " + (newInv.total || 0).toLocaleString("id-ID") + "*";
            }
          } else if (act.type === "CANCEL_ORDER") {
            setOrdersData(prev => prev.map(o => o.id === act.id ? { ...o, status: "CANCELLED" } : o));
            await updateOrderStatus(supabase, act.id, "CANCELLED", auditUserName());
            addAgentLog("ARA_CANCEL", `ARA cancel order ${act.id}: ${act.reason || ""}`, "WARNING");
            ar = `\n✅ *Order ${act.id} dibatalkan*${act.reason ? " — " + act.reason : ""}`;
          } else if (act.type === "RESCHEDULE_ORDER") {
            const upd = { date: act.date, time: act.time || "09:00", ...(act.teknisi ? { teknisi: act.teknisi } : {}) };
            const rOrdCheck = ordersData.find(o => o.id === act.id);
            const tekForReschedule = act.teknisi || rOrdCheck?.teknisi;

            // ── Cek konflik di hari & jam baru sebelum reschedule ──
            let rescheduleConflict = null;
            if (tekForReschedule && act.date && act.time && rOrdCheck) {
              // GAP-1/2: Cek dari DB langsung, bukan state lokal
              const dbConflict = await cekTeknisiAvailableDB(tekForReschedule, act.date, act.time, rOrdCheck.service, rOrdCheck.units);
              if (!dbConflict.ok && !dbConflict.reason?.includes(act.id)) {
                rescheduleConflict = dbConflict.reason || "Ada order lain di waktu tersebut";
              }
            }

            if (rescheduleConflict) {
              // Ada konflik — jangan langsung reschedule, minta persetujuan
              ar = `\n⚠️ *Konflik Jadwal Reschedule!*\n\nTeknisi *${tekForReschedule}* sudah ada job di *${act.date} jam ${act.time}*:\n${typeof rescheduleConflict === "string" ? rescheduleConflict : "Ada order lain di waktu tersebut"}\n\n*Apakah tetap ingin reschedule?* (ketik: "ya, tetap reschedule ORD-xxx" atau pilih waktu lain)`;
            } else {
              setOrdersData(prev => prev.map(o => o.id === act.id ? { ...o, ...upd } : o));
              await updateOrder(supabase, act.id, upd, auditUserName());
              // Auto-kirim WA notifikasi reschedule ke teknisi
              const rOrd = ordersData.find(o => o.id === act.id);
              if (rOrd) {
                const tekData = teknisiData.find(t => t.name === (act.teknisi || rOrd.teknisi));
                // Notif customer
                if (rOrd.phone) {
                  const custMsg = `📅 *Info Perubahan Jadwal*

Yth. ${rOrd.customer},
Jadwal layanan AC Anda *${act.id}* telah diubah:
📅 Tanggal baru: *${act.date}*
⏰ Jam: ${act.time || "09:00"}
🔧 Layanan: ${rOrd.service}

Mohon pastikan ada di lokasi pada waktu tersebut.
Terima kasih — *AClean Service* 😊`;
                  if (rOrd?.phone) sendWA(rOrd.phone, custMsg);
                }
                if (tekData?.phone) {
                  const rMsg = `📅 *Jadwal Diubah*

Halo ${tekData.name}, jadwal order *${act.id}* telah diubah:
👤 Customer: ${rOrd.customer}
📍 Alamat: ${rOrd.address || "-"}
🔧 Layanan: ${rOrd.service}
📅 Tanggal baru: ${act.date}
⏰ Jam: ${act.time || "09:00"}

Mohon sesuaikan jadwal Anda. Terima kasih!`;
                  sendWA(tekData.phone, rMsg);
                }
              }
              addAgentLog("ARA_RESCHEDULE", `ARA reschedule ${act.id} → ${act.date} ${act.time || "09:00"}`, "SUCCESS");
              ar = `\n✅ *Order ${act.id} dijadwal ulang → ${act.date} jam ${act.time || "09:00"}*`;
            } // end konflik check
          } else if (act.type === "MARK_INVOICE_OVERDUE") {
            setInvoicesData(prev => prev.map(i => i.status === "UNPAID" && i.due && i.due < TODAY ? { ...i, status: "OVERDUE" } : i));
            const cnt = invoicesData.filter(i => i.status === "UNPAID" && i.due && i.due < TODAY).length;
            await supabase.from("invoices").update({ status: "OVERDUE" }).eq("status", "UNPAID").lt("due", TODAY);
            ar = `\n✅ *${cnt} invoice ditandai OVERDUE*`;

          } else if (act.type === "CREATE_EXPENSE") {
            // ── ARA create pengeluaran/biaya ──
            const _expCat = (cat) => {
              const c = (cat || "").toLowerCase();
              if (c.includes("material") || c.includes("pipa") || c.includes("kabel") || c.includes("freon")) return "material_purchase";
              return "petty_cash";
            };
            const _expSub = (sub) => {
              const s = (sub || "").toLowerCase();
              if (s.includes("bensin") || s.includes("bbm") || s.includes("solar")) return "Bensin Motor";
              if (s.includes("parkir")) return "Parkir";
              if (s.includes("kasbon") || s.includes("pinjam") || s.includes("utang")) return "Kasbon Karyawan";
              if (s.includes("lembur") || s.includes("overtime")) return "Lembur";
              if (s.includes("bonus")) return "Bonus";
              if (s.includes("perbaikan motor") || s.includes("servis motor") || s.includes("motor")) return "Perbaikan Motor";
              if (s.includes("pipa")) return "Pipa AC";
              if (s.includes("kabel")) return "Kabel";
              if (s.includes("freon")) return "Freon";
              if (s.includes("material")) return "Material Lain";
              return sub || "Lain-lain";
            };
            const expPayload = {
              category: act.category ? _expCat(act.category) : _expCat(act.subcategory),
              subcategory: act.subcategory ? _expSub(act.subcategory) : (act.category || "Lain-lain"),
              amount: Number(act.amount) || 0,
              date: act.date || TODAY,
              description: act.description || act.keterangan || "",
              teknisi_name: act.teknisi_name || act.nama_karyawan || null,
              item_name: act.item_name || act.nama_barang || null,
              freon_type: act.freon_type || null,
              created_by: currentUser?.name || "ARA",
              last_changed_by: auditUserName(),
            };
            if (!expPayload.amount) {
              ar = "\n⚠️ *Jumlah biaya (amount) wajib diisi*";
            } else {
              await setAuditUser();
              const { data: expData, error: expErr } = await insertExpense(supabase, expPayload);
              if (expErr) {
                ar = `\n⚠️ *Gagal catat biaya: ${expErr.message}*`;
              } else {
                invalidateCache("expenses");
                setExpensesData(prev => [expData || expPayload, ...prev]);
                addAgentLog("ARA_EXPENSE", `ARA create expense: ${expPayload.subcategory} — Rp${expPayload.amount.toLocaleString("id-ID")} (${expPayload.date})`, "SUCCESS");
                ar = `\n✅ *Biaya dicatat:*\n📂 ${expPayload.category === "material_purchase" ? "Pembelian Material" : "Petty Cash"} — ${expPayload.subcategory}\n💰 Rp${expPayload.amount.toLocaleString("id-ID")}\n📅 ${expPayload.date}${expPayload.description ? " — " + expPayload.description : ""}`;

                // ── AUTO-LINK: material_purchase → update stok inventory ──
                if (expPayload.category === "material_purchase") {
                  const matQty = (() => {
                    // Coba ekstrak qty dari item_name cth: "R32 2kg" → 2, "Pipa 10m" → 10
                    const raw = (act.item_name || act.nama_barang || "");
                    const m = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|m|roll|pcs|botol|unit|liter)/i);
                    return m ? parseFloat(m[1].replace(",", ".")) : 1;
                  })();
                  // Cari item inventory yang cocok
                  const _matchInv = (keyword) => inventoryData.find(i =>
                    i.name.toLowerCase().includes(keyword.toLowerCase()) ||
                    keyword.toLowerCase().includes(i.name.toLowerCase())
                  );
                  const matKeyword = act.item_name || act.freon_type
                    ? (act.freon_type ? "Freon " + act.freon_type : act.item_name)
                    : expPayload.subcategory;
                  const matchedItem = matKeyword ? _matchInv(matKeyword) : null;

                  if (matchedItem && matQty > 0) {
                    const newStock = matchedItem.stock + matQty;
                    const newStatus = computeStockStatus(newStock, matchedItem.reorder);
                    setInventoryData(prev => prev.map(i => i.code === matchedItem.code ? { ...i, stock: newStock, status: newStatus } : i));
                    await supabase.from("inventory_transactions").insert({
                      inventory_code: matchedItem.code,
                      inventory_name: matchedItem.name,
                      qty: matQty,
                      type: "restock",
                      notes: `Auto dari expense ARA: ${expPayload.subcategory} (${expPayload.date})`,
                      created_by: currentUser?.id || null,
                      created_by_name: currentUser?.name || "ARA",
                    }).catch(() => {});
                    await supabase.from("inventory").update({ stock: newStock, updated_at: new Date().toISOString() }).eq("code", matchedItem.code).catch(() => {});
                    addAgentLog("STOCK_AUTO_RESTOCK", `Auto restock ${matchedItem.name} +${matQty} ${matchedItem.unit} dari expense`, "SUCCESS");
                    ar += `\n📦 *Stok auto-update:* ${matchedItem.name} +${matQty} ${matchedItem.unit} → ${newStock} ${matchedItem.unit}`;
                  }
                }
              }
            }

          } else if (act.type === "BULK_CREATE_ORDER") {
            // ── ARA bulk create order dari dump teks ──
            const orders = Array.isArray(act.orders) ? act.orders : [];
            if (orders.length === 0) {
              ar = "\n⚠️ *BULK_CREATE_ORDER membutuhkan field `orders` berupa array*";
            } else if (orders.length > 20) {
              ar = "\n⚠️ *Maksimal 20 order sekaligus — pisah menjadi beberapa batch*";
            } else {
              const today = getLocalDate();
              const _normSvcBulk = (s) => {
                const sl = (s || "").toLowerCase().trim();
                if (sl.includes("install") || sl.includes("pasang") || sl.includes("baru")) return "Install";
                if (sl.includes("repair") || sl.includes("perbaikan") || sl.includes("servis") || sl.includes("bongkar")) return "Repair";
                if (sl.includes("complain") || sl.includes("komplain") || sl.includes("garansi")) return "Complain";
                return "Cleaning";
              };
              const results = [];
              for (const o of orders) {
                const seq2 = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
                const bId = "ORD-" + (o.date || today).replace(/-/g, "").slice(2, 8) + "-" + seq2;
                const bOrd = {
                  id: bId,
                  customer: o.customer || "?",
                  phone: o.phone || "",
                  address: o.address || "",
                  service: _normSvcBulk(o.service),
                  units: parseInt(o.units) || 1,
                  teknisi: o.teknisi || "",
                  helper: o.helper || "",
                  date: o.date || today,
                  time: o.time || "09:00",
                  status: "PENDING",
                  notes: o.notes || "",
                  dispatch: false,
                  created_at: new Date().toISOString(),
                };
                // Auto helper
                if ((bOrd.units >= 3 || bOrd.service === "Install") && !bOrd.helper) {
                  const avH = teknisiData.find(t => t.role === "Helper" && t.status !== "inactive");
                  if (avH) bOrd.helper = avH.name;
                }
                setOrdersData(prev => [...prev, bOrd]);
                const { error: bErr } = await insertOrder(supabase, bOrd);
                results.push({ id: bId, customer: bOrd.customer, service: bOrd.service, date: bOrd.date, ok: !bErr });
                // Small delay agar ID unik
                await new Promise(r => setTimeout(r, 60));
              }
              addAgentLog("ARA_BULK_ORDER", `ARA bulk create ${results.length} orders`, "SUCCESS");
              ar = `\n✅ *${results.length} order berhasil dibuat:*\n` +
                results.map((r, i) => `${i + 1}. \`${r.id}\` — ${r.customer} | ${r.service} | ${r.date} ${r.ok ? "✅" : "❌"}`).join("\n");
            }
          }
        } catch (e) { console.warn("Action parse", e); }
      }

      const clean = fullText.replace(/\[ACTION\].*?\[\/ACTION\]/s, "").trim() + ar;
      setAraMessages(prev => [...prev, { role: "assistant", content: clean }]);
      addAgentLog("ARA_CHAT", `ARA: "${userMsg.slice(0, 50)}..."`, "SUCCESS");
    } catch (err) {
      const msg = err.message.includes("Backend belum") ? "⚠️ " + err.message
        : err.message.includes("401") || err.message.includes("API key") ? "⚠️ API Key tidak valid. Buka Pengaturan → ARA Brain."
          : "⚠️ ARA gagal: " + err.message;
      setAraMessages(prev => [...prev, { role: "assistant", content: msg }]);
      addAgentLog("ARA_ERROR", err.message.slice(0, 80), "ERROR");
    } finally {
      setAraLoading(false);
      setTimeout(() => araBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  // ── Menu items (all) ──
  const ALL_MENU = [
    { id: "dashboard", icon: "⬡", label: "Dashboard" },
    { id: "wa-inbox", icon: "📌", label: "Planning Order" },
    { id: "orders", icon: "📋", label: "Order Masuk" },
    { id: "schedule", icon: "📅", label: "Jadwal" },
    { id: "invoice", icon: "🧾", label: "Invoice" },
    { id: "customers", icon: "👥", label: "Customer" },
    { id: "inventory", icon: "📦", label: "Inventori" },
    { id: "pricelist", icon: "💰", label: "Price List" },
    { id: "teknisi", icon: "👷", label: "Tim Teknisi" },
    { id: "laporantim", icon: "📝", label: "Laporan Tim" },
    { id: "ara", icon: "🤖", label: "ARA Chat" },
    { id: "reports", icon: "📊", label: "Statistik" },
    { id: "agentlog", icon: "📡", label: "ARA Log" },
    { id: "deletedaudit", icon: "🗑", label: "Deleted Audit" },
    { id: "monitoring", icon: "🔍", label: "Monitoring" },
    { id: "settings", icon: "⚙️", label: "Pengaturan" },
    { id: "mattrack", icon: "🧮", label: "Stok Material" },
    { id: "biaya", icon: "💸", label: "Biaya" },
    // Teknisi-only menu (not shown to Owner/Admin)
    { id: "myreport", icon: "📋", label: "Laporan Saya" },
  ];
  const menuItems = currentUser ? ALL_MENU.filter(m => canAccess(m.id)) : ALL_MENU;

  // ============================================================
  // RENDER DASHBOARD
  // ============================================================
  const renderDashboard = () => (
    <DashboardView currentUser={currentUser} ordersData={ordersData} invoicesData={invoicesData} inventoryData={inventoryData}
      teknisiData={teknisiData} omsetView={omsetView} setOmsetView={setOmsetView} isMobile={isMobile} waConversations={waConversations}
      bulanIni={bulanIni} setActiveMenu={setActiveMenu} setInvoiceFilter={setInvoiceFilter} setModalOrder={setModalOrder}
      setWaPanel={setWaPanel} setWaTekTarget={setWaTekTarget} setModalWaTek={setModalWaTek}
      fmt={fmt} getTechColor={getTechColor} triggerRekapHarian={triggerRekapHarian} openLaporanModal={openLaporanModal} showNotif={showNotif} TODAY={TODAY}
      sendWA={sendWA} dispatchWA={dispatchWA} addAgentLog={addAgentLog}
      setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      customersData={customersData} laporanReports={laporanReports} findCustomer={findCustomer}
      setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab}
      expensesData={expensesData} />
  );

  // ============================================================
  // RENDER CUSTOMERS
  // ============================================================
  const renderCustomers = () => (
    <CustomersView selectedCustomer={selectedCustomer} setSelectedCustomer={setSelectedCustomer} ordersData={ordersData}
      laporanReports={laporanReports} invoicesData={invoicesData} customersData={customersData} setCustomersData={setCustomersData}
      searchCustomer={searchCustomer} setSearchCustomer={setSearchCustomer} customerPage={customerPage} setCustomerPage={setCustomerPage}
      customerTab={customerTab} setCustomerTab={setCustomerTab} currentUser={currentUser} isMobile={isMobile}
      setNewCustomerForm={setNewCustomerForm} setModalAddCustomer={setModalAddCustomer} setNewOrderForm={setNewOrderForm} setModalOrder={setModalOrder}
      setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      buildCustomerHistory={buildCustomerHistory} openWA={openWA} showConfirm={showConfirm} showNotif={showNotif}
      deleteCustomer={deleteCustomer} addAgentLog={addAgentLog} updateCustomer={updateCustomer} fotoSrc={fotoSrc} safeArr={safeArr} fmt={fmt}
      supabase={supabase} CUST_PAGE_SIZE={CUST_PAGE_SIZE} downloadServiceReportPDF={downloadServiceReportPDF} />
  );

  // ============================================================
  // RENDER ORDERS
  // ============================================================
  const renderOrderInbox = () => (
    <OrderInboxView
      ordersData={ordersData} setOrdersData={setOrdersData}
      customersData={customersData} teknisiData={teknisiData}
      currentUser={currentUser} supabase={supabase}
      showNotif={showNotif} showConfirm={showConfirm}
      auditUserName={auditUserName} TODAY={TODAY} />
  );

  const renderOrders = () => (
    <OrdersView ordersData={ordersData} setOrdersData={setOrdersData} orderFilter={orderFilter} setOrderFilter={setOrderFilter}
      orderTekFilter={orderTekFilter} setOrderTekFilter={setOrderTekFilter} orderDateFrom={orderDateFrom} setOrderDateFrom={setOrderDateFrom}
      orderDateTo={orderDateTo} setOrderDateTo={setOrderDateTo} searchOrder={searchOrder} setSearchOrder={setSearchOrder}
      orderPage={orderPage} setOrderPage={setOrderPage} orderServiceFilter={orderServiceFilter} setOrderServiceFilter={setOrderServiceFilter}
      currentUser={currentUser} customersData={customersData} setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab}
      setActiveMenu={setActiveMenu} setEditOrderItem={setEditOrderItem} setEditOrderForm={setEditOrderForm} setModalEditOrder={setModalEditOrder}
      setModalOrder={setModalOrder} showConfirm={showConfirm} showNotif={showNotif} dispatchStatus={dispatchStatus} sendDispatchWA={sendDispatchWA}
      deleteOrder={deleteOrder} addAgentLog={addAgentLog} auditUserName={auditUserName}
      downloadRekapHarian={downloadRekapHarian} triggerRekapHarian={triggerRekapHarian} supabase={supabase} TODAY={TODAY} ORDER_PAGE_SIZE={ORDER_PAGE_SIZE} />
  );

  // ============================================================
  // RENDER INVOICE
  // ============================================================
  // A.3 OPTIMIZATION: Memoize invoice filtering untuk prevent re-filter setiap render
  const invoiceFilterMemo = useMemo(() => {
    // ── SIM-3+2: status filter + search + pagination ──
    // ══ GAP 7: Warranty tracker — filter garansi aktif ══
    const garansiAktif = invoicesData.filter(inv => {
      if (!inv.garansi_expires) return false;
      const daysLeft = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
      return daysLeft >= 0;
    }).sort((a, b) => a.garansi_expires.localeCompare(b.garansi_expires));
    const garansiKritis = garansiAktif.filter(inv => {
      const d = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
      return d <= 7;
    });

    let filteredInv = [...invoicesData];
    const todayDateStr = getLocalDate();
    if (invoiceFilter === "Garansi") {
      filteredInv = garansiAktif;
    } else if (invoiceFilter === "Hari Ini") {
      filteredInv = filteredInv.filter(inv => (inv.created_at || "").slice(0, 10) === todayDateStr);
    } else if (invoiceFilter !== "Semua") {
      filteredInv = filteredInv.filter(inv => inv.status === invoiceFilter);
    }
    // Date range filter
    if (invoiceDateFrom) filteredInv = filteredInv.filter(inv => (inv.created_at || "").slice(0, 10) >= invoiceDateFrom);
    if (invoiceDateTo) filteredInv = filteredInv.filter(inv => (inv.created_at || "").slice(0, 10) <= invoiceDateTo);
    if (searchInvoice.trim()) {
      const q = searchInvoice.trim().toLowerCase();
      filteredInv = filteredInv.filter(inv =>
        (inv.customer || "").toLowerCase().includes(q) ||
        (inv.phone || "").includes(searchInvoice.trim()) ||
        (inv.id || "").toLowerCase().includes(q)
      );
    }
    filteredInv.sort((a, b) => (b.created_at || b.sent || "").localeCompare(a.created_at || a.sent || ""));
    const unpaidCnt = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;

    return { filteredInv, garansiAktif, garansiKritis, unpaidCnt };
  }, [invoicesData, invoiceFilter, invoiceDateFrom, invoiceDateTo, searchInvoice]);

  const renderInvoice = () => (
    <InvoiceView invoiceFilterMemo={invoiceFilterMemo} invoicesData={invoicesData} setInvoicesData={setInvoicesData}
      invoicePage={invoicePage} setInvoicePage={setInvoicePage} currentUser={currentUser} isMobile={isMobile}
      invoiceFilter={invoiceFilter} setInvoiceFilter={setInvoiceFilter} searchInvoice={searchInvoice} invoiceDateFrom={invoiceDateFrom} setInvoiceDateFrom={setInvoiceDateFrom} invoiceDateTo={invoiceDateTo} setInvoiceDateTo={setInvoiceDateTo}
      setSearchInvoice={setSearchInvoice} setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      setEditInvoiceData={setEditInvoiceData} setEditInvoiceForm={setEditInvoiceForm} setEditJasaItems={setEditJasaItems}
      setEditInvoiceItems={setEditInvoiceItems} setModalEditInvoice={setModalEditInvoice}
      ordersData={ordersData} setOrdersData={setOrdersData} setActiveMenu={setActiveMenu} setAuditModal={setAuditModal}
      invoiceReminderWA={invoiceReminderWA} approveInvoice={approveInvoice} markPaid={markPaid}
      showConfirm={showConfirm} showNotif={showNotif} addAgentLog={addAgentLog} auditUserName={auditUserName}
      markInvoicePaid={markInvoicePaid} updateOrderStatus={updateOrderStatus} deleteInvoice={deleteInvoice} updateInvoice={updateInvoice}
      getLocalDate={getLocalDate} fmt={fmt} parseMD={parseMD} jasaSvcNames={jasaSvcNames} downloadRekapHarian={downloadRekapHarian}
      supabase={supabase} TODAY={TODAY} INV_PAGE_SIZE={INV_PAGE_SIZE}
      laporanReports={laporanReports} uploadServiceReportPDFForWA={uploadServiceReportPDFForWA} sendWAFn={sendWA} />
  );

  // ============================================================
  // RENDER INVENTORY
  // ============================================================
  const renderInventory = () => (
    <InventoryView inventoryData={inventoryData} searchInventory={searchInventory} setSearchInventory={setSearchInventory}
      inventoryPage={inventoryPage} setInventoryPage={setInventoryPage} currentUser={currentUser} supabase={supabase} fmt={fmt}
      showConfirm={showConfirm} showNotif={showNotif} setModalStok={setModalStok} setEditStokItem={setEditStokItem}
      setNewStokForm={setNewStokForm} setModalEditStok={setModalEditStok} setInventoryData={setInventoryData}
      setModalRestock={setModalRestock} setRestockItem={setRestockItem} setRestockForm={setRestockForm} TODAY={TODAY} />
  );

  // ============================================================
  // RENDER PRICE LIST (submenu — dari Supabase price_list table)
  // ============================================================
  const renderPriceList = () => (
    <PriceListView priceListData={priceListData} setPriceListData={setPriceListData} priceListSvcTab={priceListSvcTab} setPriceListSvcTab={setPriceListSvcTab}
      searchPriceList={searchPriceList} setSearchPriceList={setSearchPriceList} plEditItem={plEditItem} setPlEditItem={setPlEditItem}
      plEditForm={plEditForm} setPlEditForm={setPlEditForm} plAddModal={plAddModal} setPlAddModal={setPlAddModal}
      plNewForm={plNewForm} setPlNewForm={setPlNewForm} currentUser={currentUser} setPriceListSyncedAt={setPriceListSyncedAt}
      showConfirm={showConfirm} showNotif={showNotif} addAgentLog={addAgentLog} fetchPriceList={fetchPriceList}
      fmt={fmt} buildPriceListFromDB={buildPriceListFromDB} supabase={supabase} PRICE_LIST={PRICE_LIST} setPRICE_LIST={(val) => { PRICE_LIST = val; }} />
  );


  // ============================================================
  // RENDER SCHEDULE
  // ============================================================
  const renderSchedule = () => (
    <ScheduleView ordersData={ordersData} setOrdersData={setOrdersData} laporanReports={laporanReports} customersData={customersData}
      teknisiData={teknisiData} currentUser={currentUser} weekOffset={weekOffset} setWeekOffset={setWeekOffset}
      scheduleView={scheduleView} setScheduleView={setScheduleView} filterTeknisi={filterTeknisi} setFilterTeknisi={setFilterTeknisi}
      calLaporanFilter={calLaporanFilter} setCalLaporanFilter={setCalLaporanFilter} searchSchedule={searchSchedule} setSearchSchedule={setSearchSchedule}
      schedListFilter={schedListFilter} setSchedListFilter={setSchedListFilter} schedPage={schedPage} setSchedPage={setSchedPage} isMobile={isMobile}
      setModalOrder={setModalOrder} setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab} setActiveMenu={setActiveMenu}
      setEditOrderItem={setEditOrderItem} setEditOrderForm={setEditOrderForm} setModalEditOrder={setModalEditOrder}
      setHistoryPreview={setHistoryPreview} setWaTekTarget={setWaTekTarget} setModalWaTek={setModalWaTek}
      getTechColor={getTechColor} dispatchStatus={dispatchStatus} sendDispatchWA={sendDispatchWA} dispatchWA={dispatchWA}
      deleteOrder={deleteOrder} addAgentLog={addAgentLog} auditUserName={auditUserName} showConfirm={showConfirm} showNotif={showNotif}
      openWA={openWA} openLaporanModal={openLaporanModal} sendWA={sendWA} updateOrderStatus={updateOrderStatus}
      hitungJamSelesai={hitungJamSelesai} downloadRekapHarian={downloadRekapHarian} triggerRekapHarian={triggerRekapHarian}
      supabase={supabase} TODAY={TODAY} SCHED_PAGE_SIZE={SCHED_PAGE_SIZE} getLocalDate={getLocalDate} userAccounts={userAccounts}
      uploadServiceReportPDFForWA={uploadServiceReportPDFForWA} invoicesData={invoicesData} setLaporanReports={setLaporanReports} />
  );


  // ============================================================
  // RENDER TEKNISI ADMIN
  // ============================================================
  const renderTeknisiAdmin = () => (
    <TeknisiAdminView teknisiData={teknisiData} setTeknisiData={setTeknisiData} ordersData={ordersData} laporanReports={laporanReports}
      currentUser={currentUser} supabase={supabase} setEditTeknisi={setEditTeknisi} setNewTeknisiForm={setNewTeknisiForm}
      setModalTeknisi={setModalTeknisi} showConfirm={showConfirm} showNotif={showNotif} addAgentLog={addAgentLog} openWA={openWA} TODAY={TODAY}
      invoicesData={invoicesData} />
  );

  // ============================================================
  // RENDER AGENT LOG
  // ============================================================
  // ARA Scheduling helper: suggest consistent teknisi+helper pairs per day
  // ──────────────────────────────────────────────────────────────
  // DURASI & JAM SELESAI LOGIC
  // ──────────────────────────────────────────────────────────────
  // Hitung durasi (jam) berdasarkan service + jumlah unit
  const hitungDurasi = (service, units) => {
    const u = parseInt(units) || 1;
    if (service === "Install") return Math.min(u * 2.5, 8);
    if (service === "Repair") return Math.ceil(u * 1.5);
    if (service === "Complain") return Math.max(0.5, u * 0.5); // 30 mnt/unit min 30 mnt
    // Cleaning:
    if (u === 1) return 1;
    if (u === 2) return 2;
    if (u === 3) return 3;
    if (u === 4) return 3;
    if (u <= 6) return 4;
    if (u <= 8) return 5;
    if (u <= 10) return 6;
    return 8;
  };

  // Tambahkan jam ke time string "09:00"
  const addJam = (timeStr, jamTambah) => {
    const [h, m] = (timeStr || "09:00").split(":").map(Number);
    const totalMin = h * 60 + m + Math.round(jamTambah * 60);
    const nh = Math.floor(totalMin / 60);
    const nm = totalMin % 60;
    if (nh >= 17) return "17:00"; // max jam selesai
    return String(nh).padStart(2, "0") + ":" + String(nm).padStart(2, "0");
  };

  // Hitung jam selesai estimasi
  const hitungJamSelesai = (timeStart, service, units) => {
    const dur = hitungDurasi(service, units);
    return addJam(timeStart, Math.min(dur, 8)); // max 8 jam dalam 1 hari
  };

  // Cek apakah teknisi AVAILABLE di slot waktu tertentu (tidak overlap)
  const MAX_LOKASI_PER_HARI = 6; // GAP-3: max 6 lokasi berbeda per teknisi per hari

  const cekTeknisiAvailable = (teknisiName, date, timeStart, service, units, checkAsHelper = false) => {
    const durBaru = hitungDurasi(service, units);
    const startBaru = (timeStart || "09:00").split(":").map(Number);
    const startMinBaru = startBaru[0] * 60 + startBaru[1];
    const endMinBaru = startMinBaru + Math.round(durBaru * 60);

    const activeOrders = ordersData.filter(o =>
      (checkAsHelper ? o.helper === teknisiName : (o.teknisi === teknisiName || o.helper === teknisiName)) &&
      o.date === date &&
      ["PENDING", "CONFIRMED", "DISPATCHED", "IN_PROGRESS", "ON_SITE"].includes(o.status)
    );

    // GAP-3: Hard cap — max 6 lokasi per hari (tidak ada batasan unit)
    if (activeOrders.length >= MAX_LOKASI_PER_HARI) return false;

    // Cek overlap jam
    for (const o of activeOrders) {
      const durExist = hitungDurasi(o.service || "Cleaning", o.units || 1);
      const startExist = (o.time || "09:00").split(":").map(Number);
      const startMinExist = startExist[0] * 60 + startExist[1];
      const endMinExist = startMinExist + Math.round(durExist * 60);
      if (startMinBaru < endMinExist && endMinBaru > startMinExist) return false;
    }
    return true;
  };

  // Cari slot kosong pertama untuk teknisi di tanggal tertentu
  const cariSlotKosong = (teknisiName, date, service, units) => {
    const dur = hitungDurasi(service, units);
    const slots = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];
    for (const slot of slots) {
      const end = hitungJamSelesai(slot, service, units);
      if (end <= "17:00" && cekTeknisiAvailable(teknisiName, date, slot, service, units)) {
        return slot;
      }
    }
    return null; // penuh
  };

  // ── GAP-1 & GAP-2: Real-time availability check ke Supabase (anti race condition) ──
  const cekTeknisiAvailableDB = async (teknisiName, date, timeStart, service, units) => {
    try {
      const durMenit = Math.round(hitungDurasi(service, units) * 60);
      const startParts = (timeStart || "09:00").split(":").map(Number);
      const startMin = startParts[0] * 60 + startParts[1];
      const endMin = startMin + durMenit;

      // Query langsung ke Supabase — bukan state lokal
      const { data: dbOrders, error } = await supabase
        .from("orders")
        .select("id, time, time_end, service, units, status")
        .eq("teknisi", teknisiName)
        .eq("date", date)
        .in("status", ["PENDING", "CONFIRMED", "DISPATCHED", "IN_PROGRESS", "ON_SITE"]);

      if (error) {
        console.warn("cekAvailDB error:", error.message, "— fallback ke state lokal");
        return cekTeknisiAvailable(teknisiName, date, timeStart, service, units);
      }

      // Hard cap: max 6 lokasi
      if ((dbOrders || []).length >= MAX_LOKASI_PER_HARI) {
        return { ok: false, reason: `${teknisiName} sudah mencapai batas 6 job di tanggal ${date}` };
      }

      // Cek overlap jam
      for (const o of (dbOrders || [])) {
        const oStart = (o.time || "09:00").split(":").map(Number);
        const oStartMin = oStart[0] * 60 + oStart[1];
        const oDur = Math.round(hitungDurasi(o.service || "Cleaning", o.units || 1) * 60);
        const oEndMin = oStartMin + oDur;
        if (startMin < oEndMin && endMin > oStartMin) {
          return { ok: false, reason: `${teknisiName} bentrok dengan job ${o.id} jam ${o.time}–${o.time_end || "?"}` };
        }
      }
      return { ok: true };
    } catch (e) {
      console.warn("cekAvailDB catch:", e.message);
      return { ok: true }; // fallback allow jika error network
    }
  };

  // AREA PELAYANAN
  const AREA_PELAYANAN = {
    utama: ["Alam Sutera", "BSD", "Gading Serpong", "Graha Raya", "Karawaci", "Tangerang", "Tangerang Selatan", "Serpong", "Serpong Utara", "Cipondoh", "Pinang", "Bitung", "Curug"],
    konfirmasi: ["Jakarta Barat", "Kebon Jeruk", "Palmerah", "Taman Sari", "Kembangan"],
    luar: [], // tidak dilayani
  };

  const cekAreaPelayanan = (area) => {
    const a = (area || "").toLowerCase();
    if (AREA_PELAYANAN.utama.some(x => a.includes(x.toLowerCase()))) return "utama";
    if (AREA_PELAYANAN.konfirmasi.some(x => a.includes(x.toLowerCase()))) return "konfirmasi";
    return "luar";
  };

  // ──────────────────────────────────────────────────────────────
  // ARA SCHEDULING SUGGEST — lebih cerdas dengan slot kosong
  // ──────────────────────────────────────────────────────────────
  const araSchedulingSuggest = (targetDate, service, units) => {
    // 1. Pair suggestion (helper favorit per teknisi hari itu)
    const dayOrders = ordersData.filter(o => o.date === targetDate && o.teknisi && o.helper);
    const pairs = {};
    dayOrders.forEach(o => {
      if (!pairs[o.teknisi]) pairs[o.teknisi] = {};
      pairs[o.teknisi][o.helper] = (pairs[o.teknisi][o.helper] || 0) + 1;
    });
    const pref = {};
    Object.keys(pairs).forEach(tek => {
      const helpers = pairs[tek];
      pref[tek] = Object.keys(helpers).reduce((a, b) => helpers[a] > helpers[b] ? a : b);
    });

    // 2. Availability per teknisi di tanggal itu
    const availability = {};
    teknisiData.filter(t => t.role === "Teknisi").forEach(t => {
      const slot = service ? cariSlotKosong(t.name, targetDate, service || "Cleaning", units || 1) : null;
      const jobCount = ordersData.filter(o => o.teknisi === t.name && o.date === targetDate).length;
      availability[t.name] = { slotKosong: slot, jobCount, tersedia: slot !== null };
    });

    return { pref, availability };
  };

  // ============================================================
  // RENDER ARA CHAT (GAP 8)
  // ============================================================
  const renderAra = () => (
    <AraView araMessages={araMessages} setAraMessages={setAraMessages} araInput={araInput} setAraInput={setAraInput}
      araLoading={araLoading} araImageData={araImageData} setAraImageData={setAraImageData} setAraImageType={setAraImageType}
      araImagePreview={araImagePreview} setAraImagePreview={setAraImagePreview} araBottomRef={araBottomRef}
      priceListSyncedAt={priceListSyncedAt} llmStatus={llmStatus}
      sendToARA={sendToARA} forceReloadPriceList={forceReloadPriceList} connectAraBrain={connectAraBrain} />
  );

  const renderAgentLog = () => (
    <AgentLogView agentLogs={agentLogs} logDateFilter={logDateFilter} setLogDateFilter={setLogDateFilter}
      logActionFilter={logActionFilter} setLogActionFilter={setLogActionFilter}
      agentLogPage={agentLogPage} setAgentLogPage={setAgentLogPage} />
  );

  const renderDeletedAudit = () => <DeletedAuditView supabase={supabase} />;

  // ============================================================
  // RENDER REPORTS
  // ============================================================
  const renderReports = () => (
    <ReportsView ordersData={ordersData} invoicesData={invoicesData} laporanReports={laporanReports} customersData={customersData}
      teknisiData={teknisiData} inventoryData={inventoryData} isMobile={isMobile} currentUser={currentUser}
      statsPeriod={statsPeriod} setStatsPeriod={setStatsPeriod} statsMingguOff={statsMingguOff} setStatsMingguOff={setStatsMingguOff}
      statsDateFrom={statsDateFrom} setStatsDateFrom={setStatsDateFrom} statsDateTo={statsDateTo} setStatsDateTo={setStatsDateTo}
      bulanIni={bulanIni} fmt={fmt} invoiceReminderWA={invoiceReminderWA} getTechColor={getTechColor} TODAY={TODAY}
      expensesData={expensesData} />
  );

  // ============================================================
  // RENDER LAPORAN TIM  (Owner & Admin)
  // ============================================================
  const renderLaporanTim = () => (
    <LaporanTimView laporanReports={laporanReports} setLaporanReports={setLaporanReports} ordersData={ordersData} setOrdersData={setOrdersData}
      invoicesData={invoicesData} setInvoicesData={setInvoicesData} priceListData={priceListData} currentUser={currentUser} isMobile={isMobile}
      laporanDateFilter={laporanDateFilter} setLaporanDateFilter={setLaporanDateFilter} laporanDateFrom={laporanDateFrom} setLaporanDateFrom={setLaporanDateFrom}
      laporanDateTo={laporanDateTo} setLaporanDateTo={setLaporanDateTo} laporanSvcFilter={laporanSvcFilter} setLaporanSvcFilter={setLaporanSvcFilter}
      laporanStatusFilter={laporanStatusFilter} setLaporanStatusFilter={setLaporanStatusFilter} laporanTeamFilter={laporanTeamFilter} setLaporanTeamFilter={setLaporanTeamFilter}
      searchLaporan={searchLaporan} setSearchLaporan={setSearchLaporan} laporanPage={laporanPage} setLaporanPage={setLaporanPage} userAccounts={userAccounts}
      setSelectedLaporan={setSelectedLaporan} setEditLaporanMode={setEditLaporanMode} setModalLaporanDetail={setModalLaporanDetail}
      setEditLaporanForm={setEditLaporanForm} setLaporanBarangItems={setLaporanBarangItems} setEditRepairType={setEditRepairType}
      setEditGratisAlasan={setEditGratisAlasan} setActiveEditUnitIdx={setActiveEditUnitIdx} setEditPhotoMode={setEditPhotoMode}
      setEditLaporanFotos={setEditLaporanFotos} setLaporanInstallItems={setLaporanInstallItems} setActiveMenu={setActiveMenu}
      safeArr={safeArr} fotoSrc={fotoSrc} showConfirm={showConfirm} showNotif={showNotif} addAgentLog={addAgentLog}
      auditUserName={auditUserName} getLocalDate={getLocalDate} fmt={fmt}
      updateServiceReport={updateServiceReport} deleteServiceReport={deleteServiceReport} insertInvoice={insertInvoice} deleteInvoice={deleteInvoice}
      updateOrder={updateOrder} updateOrderStatus={updateOrderStatus} markInvoicePaid={markInvoicePaid}
      lookupHargaGlobal={lookupHargaGlobal} hargaPerUnitFromTipe={hargaPerUnitFromTipe} getBracketKey={getBracketKey} hitungLabor={hitungLabor}
      sendWA={sendWA} supabase={supabase} LAP_PAGE_SIZE={LAP_PAGE_SIZE} INSTALL_ITEMS={INSTALL_ITEMS}
      downloadServiceReportPDF={downloadServiceReportPDF} />
  );

  // ============================================================
  // RENDER MY REPORT  (Teknisi & Helper — laporan sendiri + edit)
  // ============================================================
  const renderMyReport = () => (
    <MyReportView laporanReports={laporanReports} ordersData={ordersData} invoicesData={invoicesData} currentUser={currentUser}
      searchLaporan={searchLaporan} setSearchLaporan={setSearchLaporan} setSelectedLaporan={setSelectedLaporan} setEditLaporanMode={setEditLaporanMode}
      setModalLaporanDetail={setModalLaporanDetail} setEditLaporanForm={setEditLaporanForm} setLaporanBarangItems={setLaporanBarangItems}
      setEditRepairType={setEditRepairType} setEditGratisAlasan={setEditGratisAlasan} setActiveEditUnitIdx={setActiveEditUnitIdx}
      setEditPhotoMode={setEditPhotoMode} setEditLaporanFotos={setEditLaporanFotos} setLaporanInstallItems={setLaporanInstallItems}
      openLaporanModal={openLaporanModal} safeArr={safeArr} TODAY={TODAY} INSTALL_ITEMS={INSTALL_ITEMS}
      downloadServiceReportPDF={downloadServiceReportPDF} />
  );

  // ============================================================
  // RENDER MATERIAL TRACKING (Stok & Pemakaian Material)
  // ============================================================
  const renderMatTrack = () => (
    <MatTrackView inventoryData={inventoryData} invUnitsData={invUnitsData} setInvUnitsData={setInvUnitsData} invTxData={invTxData}
      matTrackFilter={matTrackFilter} setMatTrackFilter={setMatTrackFilter} matTrackSearch={matTrackSearch} setMatTrackSearch={setMatTrackSearch}
      matTrackDateFrom={matTrackDateFrom} setMatTrackDateFrom={setMatTrackDateFrom} matTrackDateTo={matTrackDateTo} setMatTrackDateTo={setMatTrackDateTo}
      setModalStok={setModalStok} supabase={supabase} fetchInventoryUnits={fetchInventoryUnits} showNotif={showNotif} currentUser={currentUser} />
  );


  // ============================================================
  // RENDER EXPENSES (BIAYA)
  // ============================================================
  const renderExpenses = () => (
    <ExpensesView expensesData={expensesData} setExpensesData={setExpensesData} expenseTab={expenseTab} setExpenseTab={setExpenseTab}
      expenseFilter={expenseFilter} setExpenseFilter={setExpenseFilter} expenseDateFrom={expenseDateFrom} setExpenseDateFrom={setExpenseDateFrom}
      expenseDateTo={expenseDateTo} setExpenseDateTo={setExpenseDateTo} expenseSearch={expenseSearch} setExpenseSearch={setExpenseSearch}
      expensePage={expensePage} setExpensePage={setExpensePage} modalExpense={modalExpense} setModalExpense={setModalExpense}
      editExpenseItem={editExpenseItem} setEditExpenseItem={setEditExpenseItem} newExpenseForm={newExpenseForm} setNewExpenseForm={setNewExpenseForm}
      currentUser={currentUser} supabase={supabase} insertExpense={insertExpense} updateExpense={updateExpense} deleteExpense={deleteExpense}
      auditUserName={auditUserName} setAuditModal={setAuditModal} TODAY={TODAY} EXPENSE_PAGE_SIZE={EXPENSE_PAGE_SIZE} fmt={fmt} />
  );

  // ============================================================
  // RENDER SETTINGS
  // ============================================================
  const renderSettings = () => (
    <SettingsView currentUser={currentUser} isMobile={isMobile} appSettings={appSettings} setAppSettings={setAppSettings}
      waProvider={waProvider} setWaProvider={setWaProvider} waToken={waToken} setWaToken={setWaToken} waDevice={waDevice} setWaDevice={setWaDevice} waStatus={waStatus} setWaStatus={setWaStatus}
      llmProvider={llmProvider} setLlmProvider={setLlmProvider} llmModel={llmModel} setLlmModel={setLlmModel} llmApiKey={llmApiKey} setLlmApiKey={setLlmApiKey} ollamaUrl={ollamaUrl} setOllamaUrl={setOllamaUrl} llmStatus={llmStatus} setLlmStatus={setLlmStatus}
      storageProvider={storageProvider} setStorageProvider={setStorageProvider} storageStatus={storageStatus} setStorageStatus={setStorageStatus}
      brainMd={brainMd} brainMdCustomer={brainMdCustomer} dbProvider={dbProvider} setDbProvider={setDbProvider}
      cronJobs={cronJobs} setCronJobs={setCronJobs} userAccounts={userAccounts} setUserAccounts={setUserAccounts}
      teknisiData={teknisiData} setTeknisiData={setTeknisiData}
      dbHealthData={dbHealthData} setDbHealthData={setDbHealthData} dbHealthLoading={dbHealthLoading} setDbHealthLoading={setDbHealthLoading} vacuumLoading={vacuumLoading} setVacuumLoading={setVacuumLoading}
      setModalBrainEdit={setModalBrainEdit} setModalBrainCustomerEdit={setModalBrainCustomerEdit} setNewUserForm={setNewUserForm} setModalAddUser={setModalAddUser}
      setEditPwdTarget={setEditPwdTarget} setEditPwdForm={setEditPwdForm} setModalEditPwd={setModalEditPwd}
      showNotif={showNotif} showConfirm={showConfirm} addAgentLog={addAgentLog} _apiHeaders={_apiHeaders} _ls={_ls} supabase={supabase} />
  );

  // ============================================================
  // RENDER MONITORING DASHBOARD
  // ============================================================
  const [monitorData, setMonitorData] = useState(null);
  const [monitorLoading, setMonitorLoading] = useState(false);

  useEffect(() => {
    if (activeMenu !== "monitoring" || !currentUser) return;

    const loadMonitor = async () => {
      try {
        setMonitorLoading(true);
        const resp = await fetch("/api/monitor", { headers: await _apiHeaders() });
        const data = await resp.json();
        setMonitorData(data);
      } catch (err) {
        console.error("[Monitor Load Error]", err.message);
      } finally {
        setMonitorLoading(false);
      }
    };

    // Load immediately
    loadMonitor();

    // Auto-refresh every 5 minutes (only when monitoring is active)
    const interval = setInterval(loadMonitor, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activeMenu, currentUser]);

  const renderMonitoring = () => (
    <MonitoringView monitorData={monitorData} setMonitorLoading={setMonitorLoading} setMonitorData={setMonitorData} _apiHeaders={_apiHeaders} />
  );

  // ============================================================
  // RENDER CONTENT ROUTER
  // ============================================================
  const renderContent = () => {
    switch (activeMenu) {
      case "dashboard": return renderDashboard();
      case "wa-inbox": return renderOrderInbox();
      case "orders": return renderOrders();
      case "schedule": return renderSchedule();
      case "invoice": return renderInvoice();
      case "customers": return renderCustomers();
      case "inventory": return renderInventory();
      case "pricelist": return renderPriceList();
      case "teknisi": return renderTeknisiAdmin();
      case "laporantim": return renderLaporanTim();
      case "myreport": return renderMyReport();
      case "ara": return renderAra();
      case "reports": return renderReports();
      case "agentlog": return renderAgentLog();
      case "deletedaudit": return renderDeletedAudit();
      case "mattrack": return renderMatTrack();
      case "biaya": return renderExpenses();
      case "monitoring": return renderMonitoring();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================
  // ─────────────── LOGIN SCREEN ───────────────
  if (!isLoggedIn) {
    // Quick login hints dihapus — gunakan email & password dari Supabase
    const quickLogins = [
      { role: "Owner", icon: "👑", email: "owner@aclean.id" },
      { role: "Admin", icon: "🛠️", email: "admin@aclean.id" },
      { role: "Teknisi", icon: "👷", email: "mulyadi@aclean.id" },
      { role: "Helper", icon: "🤝", email: "albana@aclean.id" },
    ];
    return (
      <div style={{ background: cs.bg, color: cs.text, minHeight: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 440 }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>⬡</div>
            <div style={{ fontWeight: 900, fontSize: 28, color: cs.accent, letterSpacing: 2 }}>ACLEAN</div>
            <div style={{ fontSize: 13, color: cs.muted, marginTop: 4 }}>Service Management System</div>
          </div>

          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, padding: 28 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text, marginBottom: 4 }}>Masuk ke Panel</div>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 22 }}>Login dengan akun yang diberikan oleh Owner</div>

            {loginError && (
              <div style={{
                background: loginError.startsWith("⛔") ? "#f9731620" : "#ef444418",
                border: "1px solid " + (loginError.startsWith("⛔") ? "#f97316" : "#ef444433"),
                borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12,
                color: loginError.startsWith("⛔") ? "#f97316" : cs.red
              }}>
                {loginError.startsWith("⛔") ? loginError : "⚠️ " + loginError}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Email</div>
              <input id="loginEmail" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                placeholder="email@aclean.id"
                style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "11px 14px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Password</div>
              <input id="loginPassword" type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doLogin(loginEmail, loginPassword)}
                placeholder="••••••••"
                style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "11px 14px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
            <button onClick={() => doLogin(loginEmail, loginPassword)}
              style={{ width: "100%", background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "13px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 15, marginBottom: 16 }}>
              Masuk →
            </button>

            {/* Info akun */}
            <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 14, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: cs.muted }}>Tidak punya akun? Hubungi Owner untuk mendapatkan akses.</div>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: cs.muted }}>
            Tidak punya akun? Hubungi Owner untuk mendapatkan akses.
          </div>
        </div>
        <style>{"*{box-sizing:border-box} input::placeholder{color:#4a5568}"}</style>
      </div>
    );
  }

  const isTekRoleGlobal = currentUser?.role === "Teknisi" || currentUser?.role === "Helper";

  const appContextValue = {
    currentUser, supabase, showNotif, showConfirm, addAgentLog,
    fmt, TODAY, isMobile, auditUserName,
  };

  return (
    <AppContext.Provider value={appContextValue}>
    <div style={{ background: cs.bg, color: cs.text, minHeight: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", display: isMobile ? "block" : "flex" }}>

      {/* ── GLOBAL MOBILE STYLES ── */}
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input, textarea, select { font-size: 16px !important; } /* prevent iOS zoom */
        button { touch-action: manipulation; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e2d4a; border-radius: 2px; }
        table { border-collapse: collapse; }
        @media (max-width: 768px) {
          .hide-mobile { display: none !important; }
          .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:none;opacity:1} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* ── DATA LOADING BANNER ── */}
      {dataLoading && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "linear-gradient(90deg,#38bdf8,#6366f1)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#fff", fontWeight: 700 }}>
          <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTop: "2px solid #fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          Memuat data dari Supabase...
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── SIDEBAR (desktop only) ── */}
      {!isMobile && <div style={{ width: 200, background: cs.surface, borderRight: "1px solid " + cs.border, display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: "16px 14px", borderBottom: "1px solid " + cs.border }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.accent }}>⬡ AClean</div>
            <span style={{ fontSize: 9, color: cs.accent, fontWeight: 700, background: cs.accent + "18", padding: "2px 6px", borderRadius: 4, border: "1px solid " + cs.accent + "33" }}>v18</span>
          </div>
          {currentUser && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg," + currentUser.color + "," + currentUser.color + "88)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: "#fff", flexShrink: 0 }}>
                {currentUser.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name}</div>
                <div style={{ fontSize: 10, color: currentUser.color, fontWeight: 600 }}>
                  {currentUser.role === "Owner" ? "👑 Owner" : currentUser.role === "Admin" ? "🛠️ Admin" : currentUser.role === "Helper" ? "🤝 Helper" : "👷 Teknisi"}
                </div>
              </div>
            </div>
          )}
        </div>
        <nav style={{ flex: 1, padding: "10px 8px" }}>
          {menuItems.filter(item => {
            // Hide Settings (⚙️) untuk Admin — hanya Owner yang bisa akses
            if (item.id === "settings" && currentUser?.role !== "Owner") return false;
            return true;
          }).map(item => (
            <button key={item.id} onClick={() => setActiveMenu(item.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", background: activeMenu === item.id ? cs.accent + "22" : "transparent", color: activeMenu === item.id ? cs.accent : cs.muted, cursor: "pointer", fontSize: 13, fontWeight: activeMenu === item.id ? 700 : 400, marginBottom: 1, textAlign: "left", borderLeft: activeMenu === item.id ? "3px solid " + cs.accent : "3px solid transparent" }}>
              <span>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "12px 14px", borderTop: "1px solid " + cs.border, display: "grid", gap: 6 }}>
          {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && appSettings?.wa_monitor_enabled === "true" && (
            <button onClick={() => setWaPanel(true)} style={{ width: "100%", background: "#25D36618", border: "1px solid #25D36644", color: "#25D366", padding: "8px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12, position: "relative" }}>
              📱 WhatsApp
              {waConversations.filter(c => c.unread > 0).length > 0 && (
                <span style={{ position: "absolute", top: -4, right: -4, background: cs.red, color: "#fff", fontSize: 9, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {waConversations.filter(c => c.unread > 0).reduce((a, b) => a + b.unread, 0)}
                </span>
              )}
            </button>
          )}
          <button onClick={doLogout} style={{ width: "100%", background: cs.red + "12", border: "1px solid " + cs.red + "33", color: cs.red, padding: "8px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
            Keluar →
          </button>
        </div>
      </div>}

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: isMobile ? "70px" : 0 }}>
        <div style={{ padding: isMobile ? "12px" : "20px 24px", maxWidth: 1200 }}>
          {/* Mobile top bar */}
          {isMobile && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid " + cs.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{ALL_MENU.find(m => m.id === activeMenu)?.icon}</span>
                <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>{ALL_MENU.find(m => m.id === activeMenu)?.label}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {currentUser && (
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg," + currentUser.color + "," + currentUser.color + "99)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff" }}>
                    {currentUser.avatar}
                  </div>
                )}
                <button onClick={doLogout} style={{ background: "none", border: "none", color: cs.muted, fontSize: 12, cursor: "pointer", padding: "4px 6px" }}>⏻</button>
              </div>
            </div>
          )}
          {/* Desktop page header */}
          {!isMobile && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid " + cs.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{ALL_MENU.find(m => m.id === activeMenu)?.icon}</span>
                <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{ALL_MENU.find(m => m.id === activeMenu)?.label}</div>
              </div>
              {activeMenu === "schedule" && !isTekRoleGlobal && (
                <div style={{ fontSize: 11, color: cs.muted }}>
                  Filter aktif: <span style={{ color: cs.accent, fontWeight: 700 }}>{filterTeknisi === "Semua" ? "Semua Teknisi" : filterTeknisi}</span>
                </div>
              )}
            </div>
          )}
          <ViewErrorBoundary>
            <Suspense fallback={<div style={{display:"flex",justifyContent:"center",alignItems:"center",minHeight:200,color:cs.muted,fontSize:14}}>Memuat...</div>}>
              {renderContent()}
            </Suspense>
          </ViewErrorBoundary>
        </div>
      </div>

      {/* ── BOTTOM NAV (mobile only) ── */}
      {isMobile && (
        <>
          {/* Drawer menu — tampil saat More diklik */}
          {mobileDrawerOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 550, background: "#000a" }} onClick={() => setMobileDrawerOpen(false)}>
              <div style={{ position: "absolute", bottom: 64, left: 0, right: 0, background: cs.surface, borderRadius: "20px 20px 0 0", padding: "16px 12px 8px", border: "1px solid " + cs.border }}
                onClick={e => e.stopPropagation()}>
                <div style={{ textAlign: "center", marginBottom: 12 }}>
                  <div style={{ width: 36, height: 4, background: cs.border, borderRadius: 2, margin: "0 auto" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                  {menuItems.filter(m => !["dashboard", "orders", "schedule", "laporantim", "ara"].includes(m.id)).map(item => (
                    <button key={item.id} onClick={() => { setActiveMenu(item.id); setMobileDrawerOpen(false); }}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "12px 4px", background: activeMenu === item.id ? cs.accent + "18" : cs.card, border: "1px solid " + (activeMenu === item.id ? cs.accent : cs.border), borderRadius: 12, cursor: "pointer", color: activeMenu === item.id ? cs.accent : cs.text }}>
                      <span style={{ fontSize: 22 }}>{item.icon}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, textAlign: "center" }}>{item.label}</span>
                    </button>
                  ))}
                  {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && appSettings?.wa_monitor_enabled === "true" && (
                    <button onClick={() => { setWaPanel(true); setMobileDrawerOpen(false); }}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "12px 4px", background: "#25D36618", border: "1px solid #25D36644", borderRadius: 12, cursor: "pointer", color: "#25D366", position: "relative" }}>
                      <span style={{ fontSize: 22 }}>💬</span>
                      <span style={{ fontSize: 9, fontWeight: 600 }}>WhatsApp</span>
                      {waConversations.filter(c => c.unread > 0).length > 0 && (
                        <span style={{ position: "absolute", top: 6, right: 8, background: cs.red, color: "#fff", fontSize: 8, fontWeight: 800, borderRadius: 99, padding: "1px 5px" }}>
                          {waConversations.filter(c => c.unread > 0).reduce((a, b) => a + b.unread, 0)}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Bottom tab bar */}
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 500, background: cs.surface, borderTop: "1px solid " + cs.border, display: "flex", alignItems: "stretch", paddingBottom: "env(safe-area-inset-bottom,0px)" }}>
            {[
              { id: "dashboard", icon: "⬡", label: "Home" },
              { id: "orders", icon: "📋", label: "Order" },
              { id: "schedule", icon: "📅", label: "Jadwal" },
              { id: "laporantim", icon: "📝", label: "Laporan" },
              { id: "ara", icon: "🤖", label: "ARA" },
            ].filter(item => menuItems.some(m => m.id === item.id)).map(item => (
              <button key={item.id} onClick={() => { setActiveMenu(item.id); setMobileDrawerOpen(false); }}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "8px 4px 10px", background: "none", border: "none", cursor: "pointer",
                  color: activeMenu === item.id ? cs.accent : cs.muted,
                  borderTop: activeMenu === item.id ? "2px solid " + cs.accent : "2px solid transparent",
                }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 600 }}>{item.label}</span>
              </button>
            ))}
            <button onClick={() => setMobileDrawerOpen(o => !o)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "8px 4px 10px", background: "none", border: "none", cursor: "pointer",
                color: mobileDrawerOpen ? cs.accent : cs.muted,
                borderTop: mobileDrawerOpen ? "2px solid " + cs.accent : "2px solid transparent",
              }}>
              <span style={{ fontSize: 18 }}>☰</span>
              <span style={{ fontSize: 9, fontWeight: 600 }}>Menu</span>
            </button>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — BUAT ORDER */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalOrder && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setModalOrder(false)}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📋 Buat Order Baru</div>
              <button onClick={() => setModalOrder(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {[["Nama Customer", "customer", "text"], ["Nomor HP", "phone", "text"], ["Alamat Lengkap", "address", "text"], ["Area / Kota", "area", "text"], ["Catatan", "notes", "text"]].map(([label, key, type]) => (
                <div key={key}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>{label}</div>
                  <input type={type} value={newOrderForm[key] || ""} onChange={e => {
                    const val = e.target.value;
                    if (key === "phone") {
                      const normVal = normalizePhone(val);
                      const matches = customersData.filter(c => samePhone(c.phone, val));
                      if (matches.length === 1) {
                        // 1 match → auto-fill langsung
                        setNewOrderForm(f => ({ ...f, phone: normVal, customer: matches[0].name, address: matches[0].address || f.address, area: matches[0].area || f.area }));
                      } else if (matches.length > 1) {
                        // Multiple match (phone sama, beda lokasi) → JANGAN auto-fill nama/alamat
                        // Biarkan user pilih sendiri atau ketik nama berbeda
                        setNewOrderForm(f => ({ ...f, phone: normVal }));
                      } else {
                        setNewOrderForm(f => ({ ...f, phone: normVal }));
                      }
                    } else { setNewOrderForm(f => ({ ...f, [key]: val })); }
                  }}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              ))}
              {/* Customer auto-detect badge */}
              {newOrderForm.phone && newOrderForm.phone.length >= 6 && (() => {
                const phoneMatches = customersData.filter(c => samePhone(c.phone, newOrderForm.phone));
                const exactMatch = findCustomer(customersData, newOrderForm.phone, newOrderForm.customer);
                if (phoneMatches.length > 1) {
                  // Phone sama, beda nama/lokasi → tampilkan pilihan
                  return (
                    <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #f59e0b44" }}>
                      <div style={{ padding: "7px 12px", background: "#f59e0b18", fontSize: 12, fontWeight: 700, color: "#d97706" }}>
                        📍 {phoneMatches.length} lokasi ditemukan dengan nomor ini — pilih atau isi nama baru:
                      </div>
                      {phoneMatches.map(m => (
                        <div key={m.id} onClick={() => setNewOrderForm(f => ({ ...f, customer: m.name, address: m.address || f.address, area: m.area || f.area }))}
                          style={{
                            padding: "7px 12px", background: newOrderForm.customer === m.name ? "#16a34a22" : cs.card,
                            borderTop: "1px solid " + cs.border, cursor: "pointer", fontSize: 12,
                            color: newOrderForm.customer === m.name ? "#16a34a" : cs.text, display: "flex", justifyContent: "space-between"
                          }}>
                          <span>{newOrderForm.customer === m.name ? "✅ " : ""}<strong>{m.name}</strong></span>
                          <span style={{ color: cs.muted, fontSize: 11 }}>{m.address || m.area || "—"}</span>
                        </div>
                      ))}
                      <div style={{ padding: "6px 12px", background: cs.surface, fontSize: 11, color: cs.muted }}>
                        Atau ketik nama baru di atas untuk lokasi berbeda
                      </div>
                    </div>
                  );
                }
                return (
                  <div style={{
                    padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: exactMatch ? "#16a34a18" : "#f59e0b18",
                    border: "1px solid " + (exactMatch ? "#16a34a44" : "#f59e0b44"),
                    color: exactMatch ? "#16a34a" : "#d97706",
                    display: "flex", alignItems: "center", gap: 8
                  }}>
                    {exactMatch ? "✅" : "🆕"}
                    {exactMatch
                      ? `Customer EXISTING: ${exactMatch.name} — ${exactMatch.total_orders || 0} order sebelumnya`
                      : "Customer BARU — akan otomatis ditambahkan ke menu Customer"}
                  </div>
                );
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Jenis Layanan</div>
                  <select value={newOrderForm.service} onChange={e => setNewOrderForm(f => ({ ...f, service: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                    {SERVICE_TYPES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Jumlah Unit</div>
                  <input id="field_number_8" type="number" min="1" max="20" value={newOrderForm.units} onChange={e => setNewOrderForm(f => ({ ...f, units: parseInt(e.target.value) || 1 }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              {/* Tipe AC */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Tipe AC</div>
                <select value={newOrderForm.type || ""} onChange={e => setNewOrderForm(f => ({ ...f, type: e.target.value }))}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13 }}>
                  <option value="">Pilih tipe...</option>
                  {(() => {
                    // DYNAMIC dari priceListData — auto update saat price_list DB berubah
                    const svc = newOrderForm.service;
                    // Filter tipe dari DB, exclude sub-jasa Install (Jasa Penarikan, Flaring, dll)
                    const INSTALL_EXCLUDE = [
                      "Jasa Penarikan Pipa AC", "Jasa Penarikan Pipa Ruko", "Jasa Vacum AC 0,5PK - 2,5PK",
                      "Flaring Pipa", "Jasa Pengelasan Pipa AC", "Jasa Bobok Tembok", "Jasa Instalasi Listrik",
                      "Jasa Pembuatan Saluran Pembuangan", "Jasa Vacum Unit AC >3PK", "Bongkar Pasang Indoor AC",
                      "Bongkar Pasang Outdoor AC", "Bongkar Unit AC 0.5-1PK", "Bongkar Unit AC 1.5-2.5PK",
                      "Flushing Pipa", "Jasa Instalasi Pipa AC"
                    ];
                    // Exclude dari Cleaning: jasa besar dan transport (dipilih otomatis dari laporan)
                    const CLEANING_EXCLUDE = [
                      "Jasa Service Besar 0,5PK - 1PK", "Jasa Service Besar 1,5PK - 2,5PK",
                      "Biaya Transport Bila 1 Unit"
                    ];
                    // Exclude dari Repair: jasa install dan cleaning besar
                    const REPAIR_EXCLUDE = [
                      "Jasa Service Besar 0,5PK - 1PK", "Jasa Service Besar 1,5PK - 2,5PK",
                      "Biaya Transport Bila 1 Unit", "Jasa Penarikan Pipa AC", "Jasa Penarikan Pipa Ruko",
                      "Jasa Vacum AC 0,5PK - 2,5PK", "Jasa Instalasi Pipa AC"
                    ];
                    // Complain: hanya tipe pengecekan/garansi — exclude sub-jasa
                    const COMPLAIN_EXCLUDE = [
                      "Jasa Service Besar 0,5PK - 1PK", "Jasa Service Besar 1,5PK - 2,5PK",
                      "Biaya Transport Bila 1 Unit", "Jasa Penarikan Pipa AC", "Jasa Penarikan Pipa Ruko",
                      "Jasa Vacum AC 0,5PK - 2,5PK", "Jasa Instalasi Pipa AC", "Flushing Pipa",
                      "Jasa Bobok Tembok", "Jasa Instalasi Listrik"
                    ];
                    const types = priceListData
                      .filter(r => r.service === svc && r.is_active !== false)
                      .filter(r => {
                        if (svc === "Install") return !INSTALL_EXCLUDE.includes(r.type);
                        if (svc === "Cleaning") return !CLEANING_EXCLUDE.includes(r.type);
                        if (svc === "Repair") return !REPAIR_EXCLUDE.includes(r.type);
                        if (svc === "Complain") return !COMPLAIN_EXCLUDE.includes(r.type);
                        return true;
                      })
                      .map(r => r.type);
                    return types.length > 0
                      ? types.map(t => <option key={t} value={t}>{t}</option>)
                      : <option disabled>Loading...</option>;
                  })()}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Teknisi</div>
                  {(() => {
                    const tgl = newOrderForm.date || "";
                    return (
                      <select value={newOrderForm.teknisi} onChange={e => setNewOrderForm(f => ({ ...f, teknisi: e.target.value, helper: "" }))}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                        <option value="">Pilih teknisi...</option>
                        {teknisiData.filter(t => t.role === "Teknisi" || t.role === "Helper").map(t => {
                          const jobHariIni = tgl ? ordersData.filter(o =>
                            o.teknisi === t.name && o.date === tgl &&
                            ["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS"].includes(o.status)
                          ).length : 0;
                          const penuh = jobHariIni >= MAX_LOKASI_PER_HARI;
                          const roleLabel = t.role === "Helper" ? " [H]" : "";
                          return (
                            <option key={t.id} value={t.name} disabled={penuh}>
                              {penuh ? "🔴" : jobHariIni >= 4 ? "🟡" : "🟢"} {t.name}{roleLabel} — {jobHariIni}/6 job{penuh ? " (PENUH)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    );
                  })()}
                  {/* GAP-3: Warning cap 6 lokasi */}
                  {newOrderForm.teknisi && newOrderForm.date && (() => {
                    const jobCount = ordersData.filter(o =>
                      o.teknisi === newOrderForm.teknisi && o.date === newOrderForm.date &&
                      ["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS"].includes(o.status)
                    ).length;
                    if (jobCount >= MAX_LOKASI_PER_HARI) return (
                      <div style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", borderRadius: 7, padding: "7px 10px", fontSize: 11, color: cs.red, marginTop: 4 }}>
                        🔴 <b>{newOrderForm.teknisi}</b> sudah {jobCount} job di {newOrderForm.date} — batas 6 lokasi tercapai. Pilih teknisi lain atau tanggal lain.
                      </div>
                    );
                    if (jobCount >= 4) return (
                      <div style={{ background: cs.yellow + "18", border: "1px solid " + cs.yellow + "33", borderRadius: 7, padding: "7px 10px", fontSize: 11, color: cs.yellow, marginTop: 4 }}>
                        🟡 <b>{newOrderForm.teknisi}</b> sudah {jobCount}/6 job di tanggal ini.
                      </div>
                    );
                    return null;
                  })()}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Tanggal</div>
                  <input id="field_date_9" type="date" value={newOrderForm.date} onChange={e => setNewOrderForm(f => ({ ...f, date: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              {/* Jam Mulai 09:00-17:00 */}
              {(() => {
                const jamSelesai = hitungJamSelesai(newOrderForm.time || "09:00", newOrderForm.service, newOrderForm.units);
                const dur = hitungDurasi(newOrderForm.service, newOrderForm.units);
                const avail = newOrderForm.teknisi && newOrderForm.date
                  ? cekTeknisiAvailable(newOrderForm.teknisi, newOrderForm.date, newOrderForm.time || "09:00", newOrderForm.service, newOrderForm.units)
                  : true;
                const slotSaran = newOrderForm.teknisi && newOrderForm.date
                  ? cariSlotKosong(newOrderForm.teknisi, newOrderForm.date, newOrderForm.service, newOrderForm.units)
                  : null;
                return (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5, display: "flex", alignItems: "center", gap: 8 }}>
                      Jam Mulai
                      <span style={{ fontSize: 10, color: cs.muted, fontWeight: 400 }}>09:00 – 17:00 WIB</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 5, marginBottom: 6 }}>
                      {["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"].map(t => {
                        const endT = hitungJamSelesai(t, newOrderForm.service, newOrderForm.units);
                        const ok = endT <= "17:00";
                        const isAvail = newOrderForm.teknisi && newOrderForm.date
                          ? cekTeknisiAvailable(newOrderForm.teknisi, newOrderForm.date, t, newOrderForm.service, newOrderForm.units)
                          : true;
                        const isSelected = newOrderForm.time === t;
                        return (
                          <button key={t} onClick={() => ok && setNewOrderForm(f => ({ ...f, time: t }))} disabled={!ok}
                            style={{ background: isSelected ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)" : !ok ? cs.border + "33" : !isAvail ? cs.red + "22" : cs.card, border: "1px solid " + (isSelected ? cs.accent : !ok ? "transparent" : !isAvail ? cs.red + "44" : cs.border), color: isSelected ? "#0a0f1e" : !ok ? cs.border : !isAvail ? cs.red : cs.text, borderRadius: 8, padding: "7px 2px", cursor: ok ? "pointer" : "not-allowed", fontSize: 11, fontWeight: isSelected ? 800 : 400, position: "relative" }}>
                            {t}
                            {!isAvail && ok && <span style={{ fontSize: 7, display: "block", color: cs.red }}>⚠ bentrok</span>}
                          </button>
                        );
                      })}
                    </div>
                    <input id="field_time_10" type="time" min="09:00" max="17:00" value={newOrderForm.time || "09:00"} onChange={e => setNewOrderForm(f => ({ ...f, time: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                    {/* Estimasi durasi & jam selesai */}
                    <div style={{ marginTop: 8, background: avail ? cs.green + "10" : cs.red + "10", border: "1px solid " + (avail ? cs.green : cs.red) + "22", borderRadius: 8, padding: "8px 12px", display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                      <span>⏱ Estimasi: <b style={{ color: cs.accent }}>{dur >= 8 ? "1 hari kerja" : dur + "jam"}</b></span>
                      <span>🕐 Selesai ±: <b style={{ color: cs.green }}>{jamSelesai} WIB</b></span>
                      {newOrderForm.teknisi && newOrderForm.date && (
                        <span>{avail ? <span style={{ color: cs.green }}>✓ Teknisi tersedia</span> : <span style={{ color: cs.red }}>⚠ Jadwal bentrok!</span>}</span>
                      )}
                      {!avail && slotSaran && (
                        <span style={{ color: cs.yellow, cursor: "pointer", textDecoration: "underline" }} onClick={() => setNewOrderForm(f => ({ ...f, time: slotSaran }))}>
                          Slot kosong: {slotSaran} (klik pakai)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5, display: "flex", alignItems: "center", gap: 8 }}>
                  Helper
                  {newOrderForm.teknisi && newOrderForm.date && (() => {
                    const { pref } = araSchedulingSuggest(newOrderForm.date, newOrderForm.service, newOrderForm.units);
                    const sug = pref[newOrderForm.teknisi];
                    return sug ? (
                      <span style={{ fontSize: 10, color: cs.green, background: cs.green + "18", padding: "2px 8px", borderRadius: 99, border: "1px solid " + cs.green + "33", cursor: "pointer" }}
                        onClick={() => setNewOrderForm(f => ({ ...f, helper: sug }))}>
                        ARA rekomen: {sug} (klik pakai)
                      </span>
                    ) : null;
                  })()}
                </div>
                <select value={newOrderForm.helper} onChange={e => setNewOrderForm(f => ({ ...f, helper: e.target.value }))}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                  <option value="">Tidak ada helper</option>
                  {teknisiData.filter(t => t.status !== "inactive" && t.name !== newOrderForm.teknisi).map(t => {
                    const { pref } = araSchedulingSuggest(newOrderForm.date || "", newOrderForm.service, newOrderForm.units);
                    const isSug = pref[newOrderForm.teknisi] === t.name;
                    const roleTag = t.role === "Teknisi" ? " [T]" : t.role === "Helper" ? "" : ` [${t.role}]`;
                    return <option key={t.id} value={t.name}>{isSug ? "★ " : ""}{t.name}{roleTag}{isSug ? " (ARA)" : ""}</option>;
                  })}
                </select>
              </div>

              {/* ── Teknisi/Helper Tambahan ── */}
              <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>👥 Tim Tambahan <span style={{ fontWeight: 400 }}>(opsional — 1 job, beberapa orang)</span></span>
                </div>
                {/* Teknisi 2 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Teknisi ke-2</div>
                    <select value={newOrderForm.teknisi2 || ""} onChange={e => setNewOrderForm(f => ({ ...f, teknisi2: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12 }}>
                      <option value="">— Tidak ada —</option>
                      {teknisiData.filter(t => (t.role === "Teknisi" || t.role === "Helper") && t.name !== newOrderForm.teknisi).map(t => (
                        <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Helper ke-2</div>
                    <select value={newOrderForm.helper2 || ""} onChange={e => setNewOrderForm(f => ({ ...f, helper2: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12 }}>
                      <option value="">— Tidak ada —</option>
                      {teknisiData.filter(t => t.name !== newOrderForm.helper && t.name !== newOrderForm.teknisi).map(t => (
                        <option key={t.id} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Teknisi 3 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Teknisi ke-3</div>
                    <select value={newOrderForm.teknisi3 || ""} onChange={e => setNewOrderForm(f => ({ ...f, teknisi3: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12 }}>
                      <option value="">— Tidak ada —</option>
                      {teknisiData.filter(t => (t.role === "Teknisi" || t.role === "Helper") && t.name !== newOrderForm.teknisi && t.name !== newOrderForm.teknisi2).map(t => (
                        <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Helper ke-3</div>
                    <select value={newOrderForm.helper3 || ""} onChange={e => setNewOrderForm(f => ({ ...f, helper3: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12 }}>
                      <option value="">— Tidak ada —</option>
                      {teknisiData.filter(t => t.name !== newOrderForm.helper && t.name !== newOrderForm.teknisi && t.name !== newOrderForm.helper2 && t.name !== newOrderForm.teknisi2).map(t => (
                        <option key={t.id} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Preview tim */}
                {(newOrderForm.teknisi2 || newOrderForm.helper2 || newOrderForm.teknisi3 || newOrderForm.helper3) && (
                  <div style={{ marginTop: 8, background: cs.accent + "10", borderRadius: 7, padding: "6px 10px", fontSize: 11, color: cs.muted }}>
                    Tim: {[newOrderForm.teknisi, newOrderForm.teknisi2, newOrderForm.teknisi3,
                    newOrderForm.helper, newOrderForm.helper2, newOrderForm.helper3]
                      .filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 6 }}>
                <button onClick={() => setModalOrder(false)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Batal</button>
                {(() => {
                  const capReached = newOrderForm.teknisi && newOrderForm.date && ordersData.filter(o =>
                    o.teknisi === newOrderForm.teknisi && o.date === newOrderForm.date &&
                    ["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS"].includes(o.status)
                  ).length >= MAX_LOKASI_PER_HARI;
                  // ── CLASH HARD-BLOCK: cek overlap jam secara lokal ──
                  const clashDetected = !!(newOrderForm.teknisi && newOrderForm.date && newOrderForm.time
                    && !cekTeknisiAvailable(newOrderForm.teknisi, newOrderForm.date,
                      newOrderForm.time || "09:00", newOrderForm.service, newOrderForm.units || 1));
                  const isBlocked = capReached || clashDetected;
                  return (
                    <>
                      {clashDetected && (
                        <div style={{
                          background: "#ef444412", border: "1px solid #ef444440", borderRadius: 9,
                          padding: "10px 14px", fontSize: 12, color: "#ef4444", fontWeight: 700, marginBottom: 6
                        }}>
                          🚫 Jadwal Bentrok! Teknisi <strong>{newOrderForm.teknisi}</strong> sudah ada job di jam ini.
                          Pilih jam lain atau ganti teknisi.
                        </div>
                      )}
                      <button
                        disabled={isBlocked || isSubmittingOrder}
                        onClick={async () => {
                          // Anti double-submit: guard HARUS di awal sebelum async call
                          // Ref-level lock: prevents double-click race condition before re-render
                          if (_orderSubmitLock.current) return;
                          _orderSubmitLock.current = true;
                          setIsSubmittingOrder(true);
                          try {
                            if (!newOrderForm.customer) { showNotif("Nama customer wajib diisi"); return; }
                            if (!newOrderForm.teknisi) { showNotif("Pilih teknisi dulu"); return; }
                            if (!newOrderForm.date) { showNotif("Pilih tanggal dulu"); return; }
                            // DB-level final check (anti race condition)
                            if (newOrderForm.teknisi && newOrderForm.date && newOrderForm.time) {
                              const dbOk = await cekTeknisiAvailableDB(newOrderForm.teknisi, newOrderForm.date, newOrderForm.time, newOrderForm.service, newOrderForm.units);
                              if (!dbOk.ok) { showNotif("🚫 " + (dbOk.reason || "Jadwal bentrok, cek ulang")); return; }
                            }
                            const formCopy = { ...newOrderForm };
                            setModalOrder(false);
                            setNewOrderForm({ customer: "", phone: "", address: "", area: "", service: "Cleaning", type: "AC Split 0.5-1PK", units: 1, teknisi: "", helper: "", date: "", time: "09:00", notes: "" });
                            await createOrder(formCopy);
                          } finally { _orderSubmitLock.current = false; setIsSubmittingOrder(false); }
                        }}
                        style={{ background: isBlocked ? cs.border : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: isBlocked ? cs.muted : "#0a0f1e", padding: "12px", borderRadius: 10, cursor: isBlocked ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14, opacity: isBlocked ? 0.6 : 1 }}>
                        {capReached ? "🔴 Teknisi Penuh" : clashDetected ? "🚫 Jadwal Bentrok" : "✓ Buat Order"}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — TAMBAH MATERIAL */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalStok && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setModalStok(false)}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 460, padding: 24, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📦 Tambah Material Baru</div>
              <button onClick={() => { setModalStok(false); setNewStokForm({ name: "", code: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "" }); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {/* Nama + Kode berdampingan */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Nama Material <span style={{ color: cs.red }}>*</span></div>
                  <input type="text" placeholder="cth: Freon R32, Pipa 1/4" value={newStokForm.name || ""} onChange={e => setNewStokForm(f => ({ ...f, name: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Kode Manual</div>
                  <input type="text" placeholder="cth: FRN-R32" value={newStokForm.code || ""} onChange={e => setNewStokForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, "") }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>Kosong = auto</div>
                </div>
              </div>
              {/* Tipe Material */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Tipe Material</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[["freon","❄️ Freon"], ["pipa","🔧 Pipa"], ["kabel","⚡ Kabel"], ["sparepart","🔩 Sparepart"], ["other","📦 Lainnya"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setNewStokForm(f => ({ ...f, material_type: val }))}
                      style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid " + (newStokForm.material_type === val ? cs.accent : cs.border), background: newStokForm.material_type === val ? cs.accent + "22" : cs.surface, color: newStokForm.material_type === val ? cs.accent : cs.muted, fontWeight: newStokForm.material_type === val ? 700 : 400 }}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              {/* Satuan + Harga */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Satuan</div>
                  <select value={newStokForm.unit || "pcs"} onChange={e => setNewStokForm(f => ({ ...f, unit: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                    {["pcs","kg","m","roll","botol","set","liter","unit"].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga/Unit (Rp)</div>
                  <input type="number" min="0" placeholder="0" value={newStokForm.price || ""} onChange={e => setNewStokForm(f => ({ ...f, price: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              {/* Stok aktual saat ini */}
              <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 6 }}>📥 Stok Aktual Saat Ini (migrasi dari manual)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Jumlah Stok Fisik</div>
                    <input type="number" min="0" step={newStokForm.material_type === "freon" ? "0.1" : "1"} placeholder="0" value={newStokForm.stock || ""} onChange={e => setNewStokForm(f => ({ ...f, stock: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Reorder Point</div>
                    <input type="number" min="0" placeholder="5" value={newStokForm.reorder || ""} onChange={e => setNewStokForm(f => ({ ...f, reorder: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 8 }}>
                  Min Alert: <input type="number" min="0" placeholder="2" value={newStokForm.min_alert || ""} onChange={e => setNewStokForm(f => ({ ...f, min_alert: e.target.value }))}
                    style={{ width: 60, background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "4px 8px", color: cs.text, fontSize: 12, outline: "none", marginLeft: 6 }} />
                  <span style={{ marginLeft: 8 }}>{newStokForm.unit || "pcs"} (kirim WA alert)</span>
                </div>
              </div>
              {/* Preview status */}
              {(newStokForm.stock !== "" || newStokForm.reorder !== "") && (() => {
                const s = parseFloat(newStokForm.stock) || 0;
                const r = parseInt(newStokForm.reorder) || 5;
                const st = computeStockStatus(s, r);
                const stCol = st === "OK" ? cs.green : st === "OUT" ? cs.red : cs.yellow;
                return (
                  <div style={{ background: stCol + "12", border: "1px solid " + stCol + "33", borderRadius: 8, padding: "8px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, color: stCol }}>{st}</span>
                    <span style={{ color: cs.muted }}>Stok {s} {newStokForm.unit || "pcs"} · Reorder saat &lt; {r}</span>
                  </div>
                );
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
                <button onClick={() => { setModalStok(false); setNewStokForm({ name: "", code: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "" }); }} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Batal</button>
                <button onClick={async () => {
                  if (!validateNameLength(newStokForm.name)) { showNotif("❌ Nama material harus 2-100 karakter"); return; }
                  const stokAwal = parseFloat(newStokForm.stock) || 0;
                  if (stokAwal < 0) { showNotif("❌ Stok tidak boleh negatif"); return; }
                  const price = parseInt(newStokForm.price) || 0;
                  if (price < 0 || price > 100000000) { showNotif("❌ Harga tidak valid"); return; }
                  const reorderPt = parseInt(newStokForm.reorder) || 5;
                  const minAlert = parseInt(newStokForm.min_alert) || 2;
                  // Kode: manual jika diisi, auto-generate jika kosong
                  const rawCode = (newStokForm.code || "").trim().toUpperCase();
                  const codeExists = rawCode && inventoryData.some(i => i.code === rawCode);
                  if (codeExists) { showNotif("❌ Kode " + rawCode + " sudah digunakan"); return; }
                  const newCode = rawCode || ("MAT" + Date.now().toString(36).slice(-4).toUpperCase());
                  const stokStatus = computeStockStatus(stokAwal, reorderPt);
                  const newItem = { code: newCode, name: newStokForm.name.trim(), unit: newStokForm.unit || "pcs", price, stock: stokAwal, reorder: reorderPt, min_alert: minAlert, status: stokStatus, material_type: newStokForm.material_type || "other" };
                  setInventoryData(prev => [...prev, newItem]);
                  const insertPayload = { ...newItem };
                  delete insertPayload.status;
                  const { error: invErr } = await supabase.from("inventory").insert(insertPayload);
                  if (!invErr && stokAwal > 0) {
                    await supabase.from("inventory").update({ stock: stokAwal }).eq("code", newCode);
                    // Catat sebagai opening stock transaction
                    await supabase.from("inventory_transactions").insert({ inventory_code: newCode, inventory_name: newItem.name, qty: stokAwal, type: "restock", notes: "Stok awal (migrasi manual)", created_by: currentUser?.id || null, created_by_name: currentUser?.name || "" }).catch(() => {});
                  }
                  if (invErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal: " + invErr.message);
                  else { addAgentLog("STOCK_ADDED", `Material baru: ${newItem.name} [${newCode}] stok: ${stokAwal} ${newItem.unit}`, "SUCCESS"); showNotif("✅ " + newItem.name + " ditambahkan [" + newCode + "]"); }
                  setModalStok(false); setNewStokForm({ name: "", code: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "" });
                }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>✓ Simpan Material</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT STOK */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalEditStok && editStokItem && (() => {
        const isF = isFreonItem(editStokItem);
        const parseStock = v => isF ? (parseFloat(v) || 0) : (parseInt(v) || 0);
        const tambah = parseStock(newStokForm.tambah);
        const stokBaru = parseStock(newStokForm.stock ?? editStokItem.stock);
        const hargaBaru = parseInt(newStokForm.price ?? editStokItem.price) || 0;
        const reorderBaru = parseInt(newStokForm.reorder ?? editStokItem.reorder) || 5;
        const stokFinal = stokBaru + tambah;
        const statusBaru = computeStockStatus(stokFinal, reorderBaru);
        return (
          <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setModalEditStok(false); setEditStokItem(null); setNewStokForm({ name: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "", tambah: "" }); }}>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 420, padding: 28 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>✏️ Edit Stok — {editStokItem.name}</div>
                <button onClick={() => { setModalEditStok(false); setEditStokItem(null); setNewStokForm({ name: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "", tambah: "" }); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Stok Saat Ini {isF && <span style={{ color: cs.accent, fontSize: 10 }}>(decimal kg)</span>}</div>
                    <input id="field_number_12" type="number" step={isF ? "0.1" : "1"} value={newStokForm.stock ?? editStokItem.stock} onChange={e => setNewStokForm(f => ({ ...f, stock: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tambah (+)</div>
                    <input id="field_number_13" type="number" step={isF ? "0.1" : "1"} min="0" placeholder="0" value={newStokForm.tambah || ""} onChange={e => setNewStokForm(f => ({ ...f, tambah: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga/Unit</div>
                    <input id="field_number_14" type="number" value={newStokForm.price ?? editStokItem.price} onChange={e => setNewStokForm(f => ({ ...f, price: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Reorder Point</div>
                    <input id="field_number_15" type="number" value={newStokForm.reorder ?? editStokItem.reorder} onChange={e => setNewStokForm(f => ({ ...f, reorder: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ background: stokFinal <= editStokItem.min_alert ? cs.red + "12" : cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: cs.muted }}>
                  Stok setelah update: <strong style={{ color: statusBaru === "OK" ? cs.green : statusBaru === "OUT" ? cs.red : cs.yellow }}>{stokFinal} {editStokItem.unit}</strong> · Status: <strong style={{ color: statusBaru === "OK" ? cs.green : statusBaru === "OUT" ? cs.red : cs.yellow }}>{statusBaru}</strong>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
                  <button onClick={() => { setModalEditStok(false); setEditStokItem(null); setNewStokForm({ name: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "", tambah: "" }); }} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Batal</button>
                  <button onClick={async () => {
                    const updated = { ...editStokItem, stock: stokFinal, price: hargaBaru, reorder: reorderBaru, status: statusBaru };
                    setInventoryData(prev => prev.map(i => i.code === editStokItem.code ? updated : i));
                    // GAP 2: catat perubahan stok ke inventory_transactions
                    const deltaStok = stokFinal - editStokItem.stock;
                    if (deltaStok !== 0) {
                      await supabase.from("inventory_transactions").insert({
                        inventory_code: editStokItem.code,
                        inventory_name: editStokItem.name,
                        qty: deltaStok,
                        type: deltaStok > 0 ? "restock" : "correction",
                        notes: `Update manual oleh ${currentUser?.name || "Admin"}`,
                        created_by: currentUser?.id || null,
                        created_by_name: currentUser?.name || "",
                      });
                      // ignore inventory_transactions error (tabel opsional)
                    }
                    const { error: eErr } = await supabase.from("inventory").update({ stock: stokFinal, price: hargaBaru, reorder: reorderBaru, updated_at: new Date().toISOString() }).eq("code", editStokItem.code);
                    if (eErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
                    else { addAgentLog("STOCK_UPDATED", `Stok ${editStokItem.name}: ${editStokItem.stock}→${stokFinal} ${editStokItem.unit} (${statusBaru})`, "SUCCESS"); showNotif("✅ Stok " + editStokItem.name + " diupdate → " + stokFinal + " " + editStokItem.unit); }
                    setModalEditStok(false); setEditStokItem(null); setNewStokForm({ name: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "", tambah: "" });
                  }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>✓ Simpan Perubahan</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — RESTOCK MATERIAL */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalRestock && restockItem && (() => {
        const isF = isFreonItem(restockItem);
        const qtyNum = isF ? parseFloat(restockForm.qty) || 0 : parseInt(restockForm.qty) || 0;
        const hargaNum = parseInt(restockForm.harga) || 0;
        const totalBeli = qtyNum * hargaNum;
        const stokBaru = restockItem.stock + qtyNum;
        const closeRestock = () => { setModalRestock(false); setRestockItem(null); setRestockForm({ qty: "", harga: "", tanggal: TODAY, keterangan: "", catetBiaya: true }); };
        return (
          <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={closeRestock}>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 440, padding: 24 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📥 Restock Material</div>
                  <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{restockItem.name} <span style={{ fontFamily: "monospace", fontSize: 10 }}>[{restockItem.code}]</span></div>
                </div>
                <button onClick={closeRestock} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
              </div>
              {/* Stok sekarang */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 11, color: cs.muted }}>Stok Sekarang</div><div style={{ fontWeight: 800, fontSize: 18, color: restockItem.status === "OUT" ? cs.red : restockItem.status === "CRITICAL" ? cs.yellow : cs.green }}>{restockItem.stock} {restockItem.unit}</div></div>
                {qtyNum > 0 && <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: cs.muted }}>Setelah Restock</div><div style={{ fontWeight: 800, fontSize: 18, color: cs.green }}>+{qtyNum} → {stokBaru} {restockItem.unit}</div></div>}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {/* Qty + Harga */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Qty Masuk ({restockItem.unit}) <span style={{ color: cs.red }}>*</span></div>
                    <input type="number" min="0" step={isF ? "0.1" : "1"} autoFocus placeholder="0"
                      value={restockForm.qty} onChange={e => setRestockForm(f => ({ ...f, qty: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.green + "66", borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontWeight: 700 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga Beli/Unit (Rp)</div>
                    <input type="number" min="0" placeholder={restockItem.price || "0"}
                      value={restockForm.harga} onChange={e => setRestockForm(f => ({ ...f, harga: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                {/* Total & tanggal */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tanggal Beli</div>
                    <input type="date" value={restockForm.tanggal} onChange={e => setRestockForm(f => ({ ...f, tanggal: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Total Beli</div>
                    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", fontSize: 14, fontWeight: 800, color: totalBeli > 0 ? cs.green : cs.muted }}>
                      {totalBeli > 0 ? "Rp" + totalBeli.toLocaleString("id-ID") : "—"}
                    </div>
                  </div>
                </div>
                {/* Keterangan */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Keterangan (opsional)</div>
                  <input type="text" placeholder="cth: Beli di Toko Sejahtera, no faktur 001" value={restockForm.keterangan}
                    onChange={e => setRestockForm(f => ({ ...f, keterangan: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
                {/* Toggle: catat biaya otomatis */}
                <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>💳 Catat ke Biaya Otomatis</div>
                    <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Akan buat expense material_purchase sekaligus</div>
                  </div>
                  <button onClick={() => setRestockForm(f => ({ ...f, catetBiaya: !f.catetBiaya }))}
                    style={{ width: 44, height: 24, borderRadius: 99, border: "none", cursor: "pointer", background: restockForm.catetBiaya ? cs.green : cs.border, transition: "background .2s", position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: restockForm.catetBiaya ? 23 : 3, transition: "left .2s" }} />
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
                  <button onClick={closeRestock} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Batal</button>
                  <button onClick={async () => {
                    if (qtyNum <= 0) { showNotif("❌ Qty harus lebih dari 0"); return; }
                    // 1. Update stok inventory
                    const newStatus = computeStockStatus(stokBaru, restockItem.reorder);
                    setInventoryData(prev => prev.map(i => i.code === restockItem.code ? { ...i, stock: stokBaru, status: newStatus } : i));
                    // Insert restock transaction
                    await supabase.from("inventory_transactions").insert({
                      inventory_code: restockItem.code,
                      inventory_name: restockItem.name,
                      qty: qtyNum,
                      type: "restock",
                      notes: restockForm.keterangan || ("Restock manual oleh " + (currentUser?.name || "Owner")),
                      created_by: currentUser?.id || null,
                      created_by_name: currentUser?.name || "",
                    }).catch(() => {});
                    // Update stock di DB
                    const { error: invErr } = await supabase.from("inventory").update({ stock: stokBaru, updated_at: new Date().toISOString() }).eq("code", restockItem.code);
                    if (invErr) showNotif("⚠️ Stok tersimpan lokal, sync DB gagal: " + invErr.message);
                    // 2. Jika toggle aktif dan ada harga: buat expense material_purchase
                    if (restockForm.catetBiaya && hargaNum > 0 && totalBeli > 0) {
                      const subcat = isFreonItem(restockItem) ? "Freon" : restockItem.material_type === "pipa" ? "Pipa AC" : restockItem.material_type === "kabel" ? "Kabel" : "Material Lain";
                      const expPayload = {
                        category: "material_purchase",
                        subcategory: subcat,
                        amount: totalBeli,
                        date: restockForm.tanggal || TODAY,
                        description: restockForm.keterangan || `Restock ${restockItem.name} ${qtyNum} ${restockItem.unit}`,
                        item_name: restockItem.name + " " + qtyNum + " " + restockItem.unit,
                        freon_type: isFreonItem(restockItem) ? (restockItem.name.includes("R22") ? "R22" : restockItem.name.includes("R410") ? "R410A" : "R32") : null,
                        created_by: currentUser?.name || "Owner",
                        last_changed_by: currentUser?.name || "Owner",
                      };
                      const { error: expErr } = await supabase.from("expenses").insert(expPayload);
                      if (expErr) showNotif("⚠️ Stok berhasil, expense gagal: " + expErr.message);
                      else addAgentLog("RESTOCK_EXPENSE", `Restock ${restockItem.name} +${qtyNum} ${restockItem.unit} — Rp${totalBeli.toLocaleString("id-ID")} dicatat ke biaya`, "SUCCESS");
                    }
                    addAgentLog("STOCK_RESTOCK", `Restock ${restockItem.name}: +${qtyNum} → ${stokBaru} ${restockItem.unit}`, "SUCCESS");
                    showNotif("✅ Restock " + restockItem.name + " +" + qtyNum + " " + restockItem.unit + (restockForm.catetBiaya && totalBeli > 0 ? " · biaya Rp" + totalBeli.toLocaleString("id-ID") + " dicatat" : ""));
                    closeRestock();
                  }} style={{ background: "linear-gradient(135deg," + cs.green + ",#10b981)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                    📥 Simpan Restock{restockForm.catetBiaya && totalBeli > 0 ? " + Catat Biaya" : ""}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — TAMBAH/EDIT TEKNISI */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalTeknisi && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setModalTeknisi(false); setEditTeknisi(null); }}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 420, padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{editTeknisi ? "✏️ Edit Anggota" : "👷 Tambah Anggota"}</div>
              <button onClick={() => { setModalTeknisi(false); setEditTeknisi(null); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {[["Nama Lengkap", "name"], ["Nomor WA", "phone"]].map(([label, key]) => (
                <div key={key}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>{label}</div>
                  <input value={newTeknisiForm[key] || ""} onChange={e => setNewTeknisiForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Role</div>
                <select value={newTeknisiForm.role || "Teknisi"} onChange={e => setNewTeknisiForm(f => ({ ...f, role: e.target.value }))}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                  {["Teknisi", "Helper", "Supervisor"].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              {/* ── Toggle: Buat Akun Login (hanya saat tambah baru) ── */}
              {!editTeknisi && (
                <div style={{ background: cs.card, border: "1px solid " + (newTeknisiForm.buatAkun ? cs.accent : cs.border), borderRadius: 10, padding: "12px 14px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input id="field_checkbox_17" type="checkbox" checked={!!newTeknisiForm.buatAkun}
                      onChange={e => setNewTeknisiForm(f => ({ ...f, buatAkun: e.target.checked, email: "", password: "" }))}
                      style={{ width: 16, height: 16, accentColor: cs.accent }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: newTeknisiForm.buatAkun ? cs.accent : cs.text }}>🔑 Buat Akun Login</div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>Teknisi bisa login ke app untuk submit laporan</div>
                    </div>
                  </label>
                  {newTeknisiForm.buatAkun && (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Email Login</div>
                        <input id="field_email_18" type="email" value={newTeknisiForm.email || ""} placeholder="contoh: mulyadi@aclean.id"
                          onChange={e => setNewTeknisiForm(f => ({ ...f, email: e.target.value }))}
                          style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.accent + "44", borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box", outline: "none" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Password</div>
                        <input id="field_password_19" type="password" value={newTeknisiForm.password || ""} placeholder="min. 6 karakter"
                          onChange={e => setNewTeknisiForm(f => ({ ...f, password: e.target.value }))}
                          style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.accent + "44", borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box", outline: "none" }} />
                      </div>
                      <div style={{ fontSize: 11, color: cs.muted, background: cs.accent + "10", borderRadius: 7, padding: "8px 10px" }}>
                        💡 Email & password ini dipakai teknisi untuk login di halaman utama app
                      </div>
                    </div>
                  )}
                </div>
              )}

              {editTeknisi && currentUser?.role === "Owner" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <button onClick={async () => {
                    if (!await showConfirm({
                      icon: "🗑️", title: "Hapus dari Tim & Database?", danger: true,
                      message: `Hapus ${editTeknisi.name} dari tim dan database?\n\nPerhatian: Tindakan ini tidak bisa dibatalkan.\nOrder yang sudah ada tidak terpengaruh.`,
                      confirmText: "Hapus Permanen"
                    })) return;
                    // Hapus dari local state
                    setTeknisiData(prev => prev.filter(t => t.id !== editTeknisi.id));
                    // Hapus dari Supabase (jika punya UUID id)
                    if (editTeknisi.id && !String(editTeknisi.id).startsWith("Tech")) {
                      const { error } = await supabase.from("user_profiles").delete().eq("id", editTeknisi.id);
                      if (error) showNotif("⚠️ Hapus lokal berhasil, DB gagal: " + error.message);
                      else { addAgentLog("TEKNISI_DELETED", "Anggota " + editTeknisi.name + " dihapus dari tim", "WARNING"); showNotif("✅ " + editTeknisi.name + " berhasil dihapus dari tim & database"); }
                    } else {
                      showNotif("✅ " + editTeknisi.name + " dihapus dari daftar lokal");
                    }
                    setModalTeknisi(false); setEditTeknisi(null);
                  }}
                    style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "9px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>🗑️ Hapus dari Tim &amp; DB</button>
                  {editTeknisi?.status === "standby" ? (
                    <button onClick={async () => {
                      setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, status: "active", active: true } : t));
                      if (!String(editTeknisi.id).startsWith("Tech")) {
                        await supabase.from("user_profiles").update({ active: true, status: "active" }).eq("id", editTeknisi.id);
                      }
                      showNotif(editTeknisi.name + " diaktifkan kembali ✅");
                      setModalTeknisi(false); setEditTeknisi(null);
                    }}
                      style={{ background: cs.green + "18", border: "1px solid " + cs.green + "33", color: cs.green, padding: "9px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>▶ Aktifkan Kembali</button>
                  ) : (
                    <button onClick={async () => {
                      setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, status: "standby", active: false } : t));
                      if (!String(editTeknisi.id).startsWith("Tech")) {
                        await supabase.from("user_profiles").update({ active: false }).eq("id", editTeknisi.id);
                        await supabase.from("user_profiles").update({ status: "standby" }).eq("id", editTeknisi.id);
                      }
                      showNotif(editTeknisi.name + " dinonaktifkan (standby). Data tetap tersimpan.");
                      setModalTeknisi(false); setEditTeknisi(null);
                    }}
                      style={{ background: cs.yellow + "18", border: "1px solid " + cs.yellow + "33", color: cs.yellow, padding: "9px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>⏸ Nonaktifkan (Standby)</button>
                  )}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
                <button onClick={() => { setModalTeknisi(false); setEditTeknisi(null); }} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Batal</button>
                <button onClick={async () => {
                  if (!newTeknisiForm.name || !newTeknisiForm.phone) { showNotif("Nama dan nomor HP wajib diisi"); return; }
                  if (editTeknisi) {
                    // Update existing
                    const upd = { name: newTeknisiForm.name, phone: newTeknisiForm.phone, role: newTeknisiForm.role, skills: newTeknisiForm.skills || [] };
                    setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, ...upd } : t));
                    const { error: tErr } = await supabase.from("user_profiles").update(upd).eq("id", editTeknisi.id);
                    if (tErr) showNotif("⚠️ Update lokal saja, DB gagal");
                    else { addAgentLog("TEKNISI_UPDATED", "Data " + newTeknisiForm.name + " diupdate", "SUCCESS"); showNotif("✅ " + newTeknisiForm.name + " berhasil diupdate"); }
                  } else {
                    // ── Add new teknisi ──
                    let profileId = null;

                    // Step 1: Buat akun Auth dulu (kalau diminta)
                    if (newTeknisiForm.buatAkun) {
                      if (!newTeknisiForm.email || !newTeknisiForm.password) {
                        showNotif("❌ Email dan password wajib diisi untuk buat akun login"); return;
                      }
                      if (newTeknisiForm.password.length < 6) {
                        showNotif("❌ Password minimal 6 karakter"); return;
                      }
                      const { data: authData, error: authErr } = await supabase.auth.admin
                        ? supabase.auth.admin.createUser({ email: newTeknisiForm.email, password: newTeknisiForm.password, email_confirm: true })
                        : await (async () => {
                          // Fallback: pakai signUp biasa (kirim email konfirmasi)
                          const r = await supabase.auth.signUp({ email: newTeknisiForm.email, password: newTeknisiForm.password });
                          return r;
                        })();
                      if (authErr) { showNotif("❌ Gagal buat akun: " + authErr.message); return; }
                      profileId = authData?.user?.id || null;
                    }

                    // Step 2: Insert ke user_profiles
                    const newTek = {
                      ...(profileId ? { id: profileId } : {}),
                      name: newTeknisiForm.name,
                      phone: newTeknisiForm.phone,
                      role: newTeknisiForm.role,
                      skills: newTeknisiForm.skills || [],
                      status: "active",
                      jobs_today: 0,
                      ...(newTeknisiForm.email ? { email: newTeknisiForm.email } : {}),
                    };
                    const { error: tErr, data: tData } = await supabase.from("user_profiles").insert(newTek).select().single();
                    if (tErr) {
                      showNotif("⚠️ Tersimpan lokal, DB gagal: " + tErr.message);
                      setTeknisiData(prev => [...prev, { ...newTek, id: "TMP_" + Date.now() }]);
                    } else {
                      setTeknisiData(prev => [...prev, tData || newTek]);
                      addAgentLog("TEKNISI_ADDED", "Anggota baru: " + newTeknisiForm.name + " (" + newTeknisiForm.role + ")" + (newTeknisiForm.buatAkun ? " + akun login" : ""), "SUCCESS");
                      if (newTeknisiForm.buatAkun) {
                        showNotif("✅ " + newTeknisiForm.name + " ditambahkan + akun login dibuat! Cek email untuk konfirmasi.");
                      } else {
                        showNotif("✅ " + newTeknisiForm.name + " berhasil ditambahkan (tanpa akun login)");
                      }
                    }
                  }
                  setModalTeknisi(false); setEditTeknisi(null); setNewTeknisiForm({ name: "", role: "Teknisi", phone: "", skills: [], email: "", password: "", buatAkun: false });
                }}
                  style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                  ✓ {editTeknisi ? "Update" : "Tambah"} Anggota
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — BRAIN.MD EDITOR */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalBrainEdit && (
        <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 500, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: 16 }} onClick={() => setModalBrainEdit(false)}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.ara + "44", borderRadius: isMobile ? "16px 16px 0 0" : 20, width: "100%", maxWidth: isMobile ? "100%" : 780, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ background: cs.ara + "15", borderBottom: "1px solid " + cs.ara + "33", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 800, color: cs.ara, fontSize: 16 }}>🧠 Edit Brain.md — Memori Permanen ARA</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
                  {localStorage.getItem("aclean_brainMd") ? "💾 Backup lokal: ✅" : "💾 Backup lokal: ✗"}&nbsp;·&nbsp;
                  ☁️ Supabase: tersimpan permanen · Sync semua device
                </div>
              </div>
              <button onClick={() => setModalBrainEdit(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ background: cs.ara + "08", borderBottom: "1px solid " + cs.border, padding: "8px 22px", display: "flex", gap: 20, fontSize: 11, flexShrink: 0 }}>
              <span style={{ color: cs.muted }}>📝 Baris: <strong style={{ color: cs.text }}>{(typeof brainMd === "string" ? brainMd : "").split("\n").length}</strong></span>
              <span style={{ color: cs.muted }}>🔤 Karakter: <strong style={{ color: cs.text }}>{typeof brainMd === "string" ? brainMd.length : 0}</strong></span>
              <span style={{ color: cs.muted }}>💡 Gunakan # untuk heading</span>
            </div>
            <textarea value={brainMd} onChange={e => setBrainMd(e.target.value)}
              style={{ flex: 1, background: cs.bg, border: "none", padding: "18px 22px", color: cs.text, fontSize: 13, fontFamily: "monospace", lineHeight: 1.7, outline: "none", resize: "none", minHeight: 400 }} />
            <div style={{ background: cs.surface, borderTop: "1px solid " + cs.border, padding: "10px 22px", display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: cs.muted, alignSelf: "center" }}>Tambah section:</span>
              {[["Harga Baru", "\n## Harga Update\n- Cleaning 1PK: Rp XX.000\n"], ["Aturan Baru", "\n## Aturan Tambahan\n- Aturan: ...\n"], ["Promo Aktif", "\n## Promo\n- Diskon X% untuk Y unit\n"]].map(([label, snippet]) => (
                <button key={label} onClick={() => setBrainMd(prev => prev + snippet)}
                  style={{ background: cs.ara + "18", border: "1px solid " + cs.ara + "33", color: cs.ara, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>+ {label}</button>
              ))}
            </div>
            <div style={{ background: cs.surface, borderTop: "1px solid " + cs.border, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <button onClick={() => { setBrainMd(BRAIN_MD_DEFAULT); showNotif("Brain.md direset ke default"); }}
                style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>🔄 Reset ke Default</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setModalBrainEdit(false)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Batal</button>
                <button onClick={async () => {
                  showNotif("⏳ Menyimpan Brain.md ke Supabase...");
                  // Selalu simpan ke localStorage dulu sebagai backup instan
                  _lsSave("brainMd", brainMd);
                  let dbOk = false;
                  // Attempt 1: upsert (insert or update on conflict)
                  try {
                    const payload = { key: "brain_md", value: brainMd, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() };
                    const { error: e1 } = await supabase.from("ara_brain").upsert(payload, { onConflict: "key" });
                    if (!e1) { dbOk = true; }
                    else {
                      // Attempt 2: coba UPDATE saja (jika row sudah ada)
                      const { error: e2 } = await supabase.from("ara_brain")
                        .update({ value: brainMd, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() })
                        .eq("key", "brain_md");
                      if (!e2) { dbOk = true; }
                      else {
                        // Attempt 3: INSERT baru (jika row belum ada)
                        const { error: e3 } = await supabase.from("ara_brain")
                          .insert({ key: "brain_md", value: brainMd, updated_by: currentUser?.name || "Owner" });
                        if (!e3) dbOk = true;
                        else throw new Error("Upsert: " + e1.message + " | Update: " + e2.message + " | Insert: " + e3.message);
                      }
                    }
                  } catch (e) {
                    showNotif("⚠️ DB error: " + (e?.message || "") + " — Tersimpan di localStorage saja. Jalankan fix_ara_brain_table.sql di Supabase.");
                    addAgentLog("BRAIN_SAVE_ERROR", "Brain.md gagal ke DB: " + (e?.message || ""), "ERROR");
                    setModalBrainEdit(false); return;
                  }
                  if (dbOk) {
                    addAgentLog("BRAIN_SAVED", "Brain.md disimpan ke Supabase (" + brainMd.length + " karakter)", "SUCCESS");
                    showNotif("✅ Brain.md tersimpan permanen di Supabase + localStorage!");
                  }
                  setModalBrainEdit(false);
                }}
                  style={{ background: "linear-gradient(135deg," + cs.ara + ",#7c3aed)", border: "none", color: "#fff", padding: "9px 22px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>💾 Simpan Brain.md</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT BRAIN CUSTOMER */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalBrainCustomerEdit && (
        <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 500, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: cs.surface, border: "1px solid #22c55e44", borderRadius: isMobile ? "16px 16px 0 0" : 20, width: "100%", maxWidth: isMobile ? "100%" : 700, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ background: "#22c55e12", borderBottom: "1px solid #22c55e33", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#22c55e" }}>💬 Edit Brain Customer Bot</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>System prompt khusus untuk customer via WhatsApp — TERPISAH dari Brain Owner/Admin</div>
              </div>
              <button onClick={() => setModalBrainCustomerEdit(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ background: "#22c55e08", borderBottom: "1px solid " + cs.border, padding: "8px 22px", display: "flex", gap: 16, fontSize: 11 }}>
              <span style={{ color: cs.muted }}>📝 Baris: <strong style={{ color: cs.text }}>{brainMdCustomer.split("\n").length}</strong></span>
              <span style={{ color: cs.muted }}>🔤 Karakter: <strong style={{ color: cs.text }}>{brainMdCustomer.length}</strong></span>
              <span style={{ color: "#22c55e" }}>💡 Hanya aksi terbatas: booking, cek status, feedback</span>
            </div>
            <textarea value={brainMdCustomer} onChange={e => setBrainMdCustomer(e.target.value)}
              style={{ flex: 1, background: cs.bg, border: "none", padding: "18px 22px", color: cs.text, fontSize: 13, fontFamily: "monospace", resize: "none", outline: "none", lineHeight: 1.7 }}
              placeholder="Isi Brain Customer Bot di sini...&#10;&#10;Panduan: tentukan identitas, layanan & harga, SOP booking, batasan yang boleh/tidak boleh dilakukan ARA saat chat dengan customer via WA."
            />
            <div style={{ background: cs.surface, borderTop: "1px solid " + cs.border, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => { setBrainMdCustomer('# ARA CUSTOMER BRAIN v1.0 — AClean Service\n\n## IDENTITAS\nNama: ARA, asisten virtual AClean Service — Jasa Cuci, Servis & Pasang AC.\nArea: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan.\nJam operasional: Senin–Sabtu 08:00–17:00 WIB.\n\n## TUGASMU\n1. Jawab pertanyaan layanan, harga, area AClean\n2. Bantu booking order baru\n3. Bantu cek status order customer (by nomor HP)\n4. Terima & catat komplain/feedback\n\n## BATASAN KERAS\n- JANGAN tampilkan data customer lain\n- JANGAN lakukan aksi admin (cancel, approve, update invoice, dll)\n- Jika tidak yakin: arahkan ke admin\n\n## LAYANAN & HARGA\n- Cuci AC: Rp 80.000/unit\n- Freon R22: Rp 150.000/unit | Freon R32: Rp 200.000/unit\n- Perbaikan AC: mulai Rp 100.000 (tergantung kerusakan)\n- Pasang AC Baru: Rp 300.000/unit | Bongkar AC: Rp 150.000/unit\n- Service AC: Rp 120.000/unit | Booking H-0: +Rp 50.000\n\n## FORMAT JAWABAN\n- Bahasa Indonesia ramah, maks 5 kalimat per respons\n- Gunakan emoji: 😊 ✅ 🔧 📱\n- Jika tidak bisa jawab: arahkan ke admin'); showNotif("Brain Customer direset ke default"); }}
                style={{ background: "#ef444418", border: "1px solid #ef444433", color: "#ef4444", padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                🔄 Reset Default
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setModalBrainCustomerEdit(false)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Batal</button>
                <button onClick={async () => {
                  showNotif("⏳ Menyimpan Brain Customer ke Supabase...");
                  _lsSave("brainMdCustomer", brainMdCustomer);
                  let dbOk = false;
                  try {
                    const payload = { key: "brain_customer", value: brainMdCustomer, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() };
                    const { error: e1 } = await supabase.from("ara_brain").upsert(payload, { onConflict: "key" });
                    if (!e1) { dbOk = true; }
                    else {
                      const { error: e2 } = await supabase.from("ara_brain")
                        .update({ value: brainMdCustomer, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() })
                        .eq("key", "brain_customer");
                      if (!e2) { dbOk = true; }
                      else {
                        const { error: e3 } = await supabase.from("ara_brain")
                          .insert({ key: "brain_customer", value: brainMdCustomer, updated_by: currentUser?.name || "Owner" });
                        if (!e3) dbOk = true;
                        else throw new Error("Upsert: " + e1.message + " | Update: " + e2.message + " | Insert: " + e3.message);
                      }
                    }
                  } catch (e) {
                    showNotif("⚠️ DB error: " + (e?.message || "") + " — Tersimpan lokal. Jalankan fix_ara_brain_table.sql di Supabase.");
                    addAgentLog("BRAIN_CUST_SAVE_ERROR", "Brain Customer gagal ke DB: " + (e?.message || ""), "ERROR");
                    setModalBrainCustomerEdit(false); return;
                  }
                  if (dbOk) {
                    addAgentLog("BRAIN_CUSTOMER_SAVED", "Brain Customer disimpan ke Supabase (" + brainMdCustomer.length + " karakter)", "SUCCESS");
                    showNotif("✅ Brain Customer tersimpan permanen di Supabase + localStorage!");
                  }
                  setModalBrainCustomerEdit(false);
                }}
                  style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#fff", padding: "9px 22px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                  💾 Simpan Brain Customer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT INVOICE (GAP 3) */}
      {/* ══════════════════════════════════════════════════════ */}
      {/* ══ MODAL HISTORY PREVIEW — Teknisi view-only ══ */}
      {historyPreview && (() => {
        const cu = historyPreview;
        const hist = buildCustomerHistory(cu, ordersData, laporanReports, invoicesData);
        return (
          <div style={{
            position: "fixed", inset: 0, background: "#000d", zIndex: 9998,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16
          }}>
            <div style={{
              background: cs.surface, border: "1px solid " + cs.border,
              borderRadius: 18, width: "100%", maxWidth: 500, maxHeight: "88vh",
              display: "flex", flexDirection: "column", overflow: "hidden"
            }}>
              {/* Header */}
              <div style={{
                background: cs.card, padding: "14px 18px",
                borderBottom: "1px solid " + cs.border,
                display: "flex", justifyContent: "space-between", alignItems: "center"
              }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📋 Riwayat Pekerjaan</div>
                  <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{cu.name} · {hist.length}x servis</div>
                </div>
                <button onClick={() => setHistoryPreview(null)}
                  style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer" }}>×</button>
              </div>
              {/* Info lokasi */}
              <div style={{
                padding: "7px 18px", background: cs.accent + "08",
                borderBottom: "1px solid " + cs.border + "44", fontSize: 11, color: cs.muted
              }}>
                📍 {(cu.address || cu.area || "-").slice(0, 50)}
                {hist[0] && <span style={{ marginLeft: 12 }}>🕐 Terakhir: {hist[0].date}</span>}
              </div>
              {/* List history */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {hist.length === 0
                  ? <div style={{ padding: "32px", textAlign: "center", color: cs.muted, fontSize: 13 }}>Belum ada riwayat servis</div>
                  : hist.map((h, hi) => (
                    <div key={hi} style={{ borderBottom: "1px solid " + cs.border + "33" }}>
                      {/* Job header */}
                      <div style={{
                        padding: "10px 18px", background: hi === 0 ? cs.accent + "08" : "transparent",
                        display: "flex", justifyContent: "space-between", alignItems: "flex-start"
                      }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>
                            {h.service}{h.type ? " — " + h.type : ""}
                          </div>
                          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2, display: "flex", gap: 10 }}>
                            <span>📅 {h.date}</span>
                            <span>👷 {h.teknisi || "-"}</span>
                            <span>🔧 {h.units} unit</span>
                          </div>
                        </div>
                        <span style={{
                          fontSize: 10, padding: "2px 7px", borderRadius: 99, flexShrink: 0,
                          background: (h.status === "COMPLETED" || h.status === "PAID" ? cs.green : cs.yellow) + "22",
                          color: (h.status === "COMPLETED" || h.status === "PAID" ? cs.green : cs.yellow), fontWeight: 700
                        }}>
                          {statusLabel?.[h.status] || h.status || "-"}
                        </span>
                      </div>
                      {/* Detail per unit AC */}
                      {(h.unit_detail || []).length > 0 && (
                        <div style={{ margin: "0 18px 8px", background: cs.card, borderRadius: 8, padding: "8px 10px" }}>
                          {(h.unit_detail || []).map((u, ui) => (
                            <div key={ui} style={{
                              marginBottom: ui < h.unit_detail.length - 1 ? 6 : 0,
                              paddingBottom: ui < h.unit_detail.length - 1 ? 5 : 0,
                              borderBottom: ui < h.unit_detail.length - 1 ? "1px solid " + cs.border + "33" : "none"
                            }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent }}>
                                Unit {u.unit_no || ui + 1}: {u.tipe || u.label || "-"}{u.merk ? " · " + u.merk : ""}
                              </div>
                              {(u.pekerjaan || []).length > 0 && (
                                <div style={{ fontSize: 10, color: cs.muted, marginTop: 1 }}>🔨 {u.pekerjaan.join(", ")}</div>
                              )}
                              {(u.kondisi_setelah || []).length > 0 && (
                                <div style={{ fontSize: 10, color: cs.green, marginTop: 1 }}>✅ {u.kondisi_setelah.join(", ")}</div>
                              )}
                              {u.freon_ditambah > 0 && (
                                <div style={{ fontSize: 10, color: "#38bdf8", marginTop: 1 }}>❄️ Tekanan: {u.freon_ditambah} psi</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Catatan & Rekomendasi */}
                      {(h.rekomendasi || h.catatan) && (
                        <div style={{ margin: "0 18px 8px", fontSize: 11 }}>
                          {h.catatan && <div style={{ color: cs.muted, marginBottom: 3 }}>📝 {h.catatan.slice(0, 100)}</div>}
                          {h.rekomendasi && (
                            <div style={{
                              color: "#7dd3fc", background: "#0ea5e910",
                              borderRadius: 6, padding: "4px 8px", fontStyle: "italic"
                            }}>
                              💡 {h.rekomendasi.slice(0, 120)}{h.rekomendasi.length > 120 ? "..." : ""}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Foto dokumentasi */}
                      {(h.foto_urls || []).length > 0 && (
                        <div style={{ padding: "0 18px 12px" }}>
                          <div style={{ fontSize: 10, color: cs.muted, marginBottom: 5, fontWeight: 600 }}>📸 Foto ({h.foto_urls.length})</div>
                          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                            {(h.foto_urls || []).map((url, fi) => (
                              <img key={fi} src={url} alt={"Foto " + (fi + 1)}
                                onClick={() => window.open(url, "_blank")}
                                onError={e => { e.target.style.display = "none"; }}
                                style={{
                                  width: 90, height: 90, objectFit: "cover", flexShrink: 0,
                                  borderRadius: 8, cursor: "pointer", border: "1px solid " + cs.border
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              {/* Footer */}
              <div style={{ padding: "10px 18px", borderTop: "1px solid " + cs.border, background: cs.card }}>
                <button onClick={() => setHistoryPreview(null)}
                  style={{
                    width: "100%", padding: "10px", background: cs.surface,
                    border: "1px solid " + cs.border, borderRadius: 10,
                    color: cs.text, cursor: "pointer", fontWeight: 600, fontSize: 13
                  }}>Tutup</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══ CONFIRM MODAL — ganti semua window.confirm() ══ */}
      {confirmModal && (
        <div style={{
          position: "fixed", inset: 0, background: "#000000cc", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20
        }}>
          <div style={{
            background: cs.surface, border: "1px solid " + (confirmModal.danger ? cs.red : cs.border),
            borderRadius: 16, width: "100%", maxWidth: 400, padding: 24, boxShadow: "0 20px 60px #000a"
          }}>
            {/* Icon + Title */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 28 }}>{confirmModal.icon || (confirmModal.danger ? "⚠️" : "❓")}</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: confirmModal.danger ? cs.red : cs.text }}>
                {confirmModal.title}
              </div>
            </div>
            {/* Message */}
            <div style={{
              fontSize: 13, color: cs.muted, lineHeight: 1.6, marginBottom: 20,
              whiteSpace: "pre-line", background: cs.card, borderRadius: 10, padding: "12px 14px"
            }}>
              {confirmModal.message}
            </div>
            {/* Buttons */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={confirmModal.onCancel}
                style={{
                  padding: "9px 20px", background: cs.surface, border: "1px solid " + cs.border,
                  borderRadius: 10, color: cs.text, cursor: "pointer", fontWeight: 600, fontSize: 13
                }}>
                {confirmModal.cancelText || "Batal"}
              </button>
              <button onClick={confirmModal.onConfirm}
                style={{
                  padding: "9px 20px", border: "none", borderRadius: 10, cursor: "pointer",
                  fontWeight: 700, fontSize: 13, color: "#fff",
                  background: confirmModal.danger
                    ? "linear-gradient(135deg,#ef4444,#dc2626)"
                    : "linear-gradient(135deg," + cs.accent + ",#3b82f6)"
                }}>
                {confirmModal.confirmText || (confirmModal.danger ? "Ya, Hapus" : "Ya, Lanjutkan")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL EDIT PASSWORD (Owner only) ══ */}
      {modalEditPwd && editPwdTarget && (
        <div style={{
          position: "fixed", inset: 0, background: "#000d", zIndex: 500,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }}>
          <div style={{
            background: cs.surface, border: "1px solid " + cs.border,
            borderRadius: 16, width: "100%", maxWidth: 380, padding: 24
          }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text, marginBottom: 4 }}>🔑 Ganti Password</div>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 20 }}>Akun: <strong style={{ color: cs.accent }}>{editPwdTarget.name}</strong></div>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Password Baru</div>
                <input id="epwd_new" type="password" value={editPwdForm.newPwd}
                  onChange={e => setEditPwdForm(f => ({ ...f, newPwd: e.target.value }))}
                  placeholder="Minimal 8 karakter"
                  style={{
                    width: "100%", background: cs.card, border: "1px solid " + cs.border,
                    borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13
                  }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Konfirmasi Password</div>
                <input id="epwd_confirm" type="password" value={editPwdForm.confirmPwd}
                  onChange={e => setEditPwdForm(f => ({ ...f, confirmPwd: e.target.value }))}
                  placeholder="Ulangi password baru"
                  style={{
                    width: "100%", background: cs.card, border: "1px solid " + cs.border,
                    borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13
                  }} />
              </div>
              {editPwdForm.newPwd && editPwdForm.confirmPwd && editPwdForm.newPwd !== editPwdForm.confirmPwd && (
                <div style={{ fontSize: 11, color: cs.red }}>⚠️ Password tidak cocok</div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
                <button onClick={() => { setModalEditPwd(false); setEditPwdTarget(null); }}
                  style={{
                    padding: "10px", background: cs.surface, border: "1px solid " + cs.border,
                    borderRadius: 10, color: cs.text, cursor: "pointer", fontWeight: 600
                  }}>Batal</button>
                <button onClick={() => {
                  const p = editPwdForm.newPwd.trim();
                  const c = editPwdForm.confirmPwd.trim();
                  if (!p || p.length < 8) { showNotif("⚠️ Password minimal 8 karakter"); return; }
                  if (p !== c) { showNotif("⚠️ Password tidak cocok"); return; }
                  // Update di userAccounts state
                  setUserAccounts(prev => prev.map(u => u.id === editPwdTarget.id ? { ...u, password: p } : u));
                  // Jika user punya UUID Supabase → update di DB juga
                  const isUUID = /^[0-9a-f-]{36}$/.test(String(editPwdTarget.id || "").toLowerCase());
                  if (isUUID) {
                    supabase.from("user_profiles").update({ password: p }).eq("id", editPwdTarget.id)
                      .then(({ error }) => {
                        if (!error) addAgentLog("PWD_CHANGED", `Password ${editPwdTarget.name} diubah oleh Owner`, "SUCCESS");
                        else showNotif("✅ Tersimpan lokal. DB sync: " + error.message);
                      });
                  } else {
                    addAgentLog("PWD_CHANGED", `Password ${editPwdTarget.name} diubah (lokal)`, "SUCCESS");
                  }
                  showNotif("✅ Password " + editPwdTarget.name + " berhasil diubah");
                  setModalEditPwd(false); setEditPwdTarget(null);
                }} style={{
                  padding: "10px", background: "linear-gradient(135deg,#f59e0b,#f97316)",
                  border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontWeight: 700
                }}>
                  💾 Simpan Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalEditInvoice && editInvoiceData && (() => {
        // Build lookup lists dari priceListData + inventoryData
        const jasaLookup = priceListData
          .filter(r => r.service !== 'Material' && (r.price || 0) > 0)
          .map(r => ({ label: r.service + ' / ' + r.type, harga: r.price || 0, satuan: r.unit || 'Unit' }));
        const matLookup = (() => {
          const seen = new Set();
          const items = [];
          inventoryData.forEach(r => {
            const harga = lookupHargaGlobal(r.name, r.unit);
            items.push({ label: r.name, harga, satuan: r.unit || 'pcs' });
            seen.add(r.name);
          });
          priceListData.filter(r => r.service === 'Material' || r.service === 'Install')
            .forEach(r => {
              if (r.type && !seen.has(r.type)) {
                items.push({ label: r.type, harga: r.price || 0, satuan: r.unit || 'pcs' });
                seen.add(r.type);
              }
            });
          return items;
        })();

        const filteredJasa = jasaLookup.filter(x =>
          x.label.toLowerCase().includes(editAddSearch.toLowerCase()));
        const filteredMat = matLookup.filter(x =>
          x.label.toLowerCase().includes(editAddSearch.toLowerCase()));

        const jasaTotal = editJasaItems.reduce((s, m) => s + (m.subtotal || 0), 0);
        const matTotal = editInvoiceItems.reduce((s, m) => s + (m.subtotal || 0), 0);
        const newTotal = jasaTotal + matTotal;
        return (
          <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 450, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 20 }}>

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>✏️ Edit Invoice</div>
                  <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{editInvoiceData.id} · {editInvoiceData.customer}</div>
                </div>
                <button onClick={() => { setModalEditInvoice(false); setEditAddType(''); setEditAddSearch(''); }}
                  style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
              </div>

              <div style={{ display: "grid", gap: 14 }}>

                {/* ── JASA / LABOR section ── */}
                {/* ── JASA / LABOR section ── */}
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>🔧 Jasa / Labor</div>
                    <button onClick={() => { setEditAddType(editAddType === 'jasa' ? '' : 'jasa'); setEditAddSearch(''); }}
                      style={{ fontSize: 11, background: cs.accent + "20", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                      {editAddType === 'jasa' ? '✕ Tutup' : '+ Tambah Jasa'}
                    </button>
                  </div>
                  {editAddType === 'jasa' && (
                    <div style={{ marginBottom: 10 }}>
                      <input id="ei_search_jasa" autoFocus value={editAddSearch}
                        onChange={e => setEditAddSearch(e.target.value)}
                        placeholder="Cari jasa... (Cleaning, Install, Repair...)"
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, marginBottom: 6 }}
                      />
                      <div style={{ maxHeight: 180, overflowY: "auto", background: cs.surface, borderRadius: 8, border: "1px solid " + cs.border }}>
                        {filteredJasa.slice(0, 25).map((item, idx) => (
                          <div key={idx} onClick={() => {
                            setEditJasaItems(prev => [...prev, {
                              nama: item.label, jumlah: 1, satuan: item.satuan || 'Unit',
                              harga_satuan: item.harga, subtotal: item.harga, _idx: Date.now() + idx
                            }]);
                            setEditAddType(''); setEditAddSearch('');
                          }}
                            style={{
                              padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text,
                              borderBottom: "1px solid " + cs.border + "44", display: "flex", justifyContent: "space-between"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = cs.accent + "15"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <span>{item.label}</span>
                            <span style={{ fontFamily: "monospace", color: cs.accent, fontWeight: 700 }}>{fmt(item.harga)}</span>
                          </div>
                        ))}
                        {filteredJasa.length === 0 && <div style={{ padding: "10px 12px", color: cs.muted, fontSize: 12 }}>Tidak ada hasil</div>}
                      </div>
                    </div>
                  )}
                  {editJasaItems.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {editJasaItems.map((m, mi) => (
                        <div key={m._idx || mi} style={{ display: "grid", gridTemplateColumns: "1fr 55px 30px 100px 28px", gap: 5, alignItems: "center", marginBottom: 6, padding: "6px 8px", background: cs.surface, borderRadius: 8 }}>
                          <input id={"ej_name_" + mi} value={m.nama || ''} onChange={e => setEditJasaItems(prev => prev.map((x, xi) => xi === mi ? { ...x, nama: e.target.value } : x))}
                            style={{ background: "transparent", border: "none", borderBottom: "1px solid " + cs.border, color: cs.text, fontSize: 12, padding: "2px 4px" }} />
                          <input id={"ej_qty_" + mi} type="number" min="0" step="0.1" value={m.jumlah || 1}
                            onChange={e => setEditJasaItems(prev => prev.map((x, xi) => xi === mi ? { ...x, jumlah: parseFloat(e.target.value) || 0, subtotal: (parseFloat(e.target.value) || 0) * (x.harga_satuan || 0) } : x))}
                            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, textAlign: "center" }} />
                          <span style={{ fontSize: 10, color: cs.muted, textAlign: "center" }}>{m.satuan}</span>
                          <input id={"ej_harga_" + mi} type="number" min="0" value={m.harga_satuan || 0}
                            onChange={e => setEditJasaItems(prev => prev.map((x, xi) => xi === mi ? { ...x, harga_satuan: parseInt(e.target.value) || 0, subtotal: (parseInt(e.target.value) || 0) * (x.jumlah || 0) } : x))}
                            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, fontFamily: "monospace", textAlign: "right" }} />
                          <button onClick={() => setEditJasaItems(prev => prev.filter((_x, xi) => xi !== mi))}
                            style={{ background: "#ef444420", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: cs.muted, textAlign: "right" }}>
                    Subtotal jasa: <strong style={{ color: cs.accent, fontFamily: "monospace" }}>{fmt(editJasaItems.reduce((s, m) => s + (m.subtotal || 0), 0))}</strong>
                  </div>
                </div>

                {/* ── MATERIAL section ── */}
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>📦 Material</div>
                    <button onClick={() => { setEditAddType(editAddType === 'material' ? '' : 'material'); setEditAddSearch(''); }}
                      style={{ fontSize: 11, background: cs.green + "20", border: "1px solid " + cs.green + "44", color: cs.green, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                      {editAddType === 'material' ? '✕ Tutup' : '+ Tambah Material'}
                    </button>
                  </div>

                  {/* Lookup material */}
                  {editAddType === 'material' && (
                    <div style={{ marginBottom: 10 }}>
                      <input id="ei_search_mat" autoFocus value={editAddSearch}
                        onChange={e => setEditAddSearch(e.target.value)}
                        placeholder="Cari material... (Freon, Pipa, Kabel...)"
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, marginBottom: 6 }}
                      />
                      <div style={{ maxHeight: 160, overflowY: "auto", background: cs.surface, borderRadius: 8, border: "1px solid " + cs.border }}>
                        {filteredMat.slice(0, 20).map((item, idx) => (
                          <div key={idx} onClick={() => {
                            setEditInvoiceItems(prev => [...prev, {
                              nama: item.label, jumlah: 1, satuan: item.satuan,
                              harga_satuan: item.harga, subtotal: item.harga, _idx: Date.now() + idx
                            }]);
                            setEditAddType(''); setEditAddSearch('');
                          }}
                            style={{
                              padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text, borderBottom: "1px solid " + cs.border + "44",
                              display: "flex", justifyContent: "space-between", alignItems: "center"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = cs.green + "10"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <span>{item.label} <span style={{ fontSize: 10, color: cs.muted }}>/ {item.satuan}</span></span>
                            <span style={{ fontFamily: "monospace", color: cs.green, fontWeight: 700 }}>{fmt(item.harga)}</span>
                          </div>
                        ))}
                        {filteredMat.length === 0 && (
                          <div style={{ padding: "10px 12px", color: cs.muted, fontSize: 12 }}>Tidak ada hasil</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Item list — editable */}
                  {editInvoiceItems.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {editInvoiceItems.map((m, mi) => (
                        <div key={m._idx || mi} style={{ display: "grid", gridTemplateColumns: "1fr 60px 30px 100px 28px", gap: 5, alignItems: "center", marginBottom: 6, padding: "6px 8px", background: cs.surface, borderRadius: 8 }}>
                          <input id={"ei_name_" + mi} value={m.nama || ''} onChange={e => setEditInvoiceItems(prev => prev.map((x, xi) => xi === mi ? { ...x, nama: e.target.value } : x))}
                            style={{ background: "transparent", border: "none", borderBottom: "1px solid " + cs.border, color: cs.text, fontSize: 12, padding: "2px 4px" }} />
                          <input id={"ei_qty_" + mi} type="number" min="0" step="0.1" value={m.jumlah || 1}
                            onChange={e => setEditInvoiceItems(prev => prev.map((x, xi) => xi === mi ? { ...x, jumlah: parseFloat(e.target.value) || 0, subtotal: (parseFloat(e.target.value) || 0) * (x.harga_satuan || 0) } : x))}
                            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, textAlign: "center" }} />
                          <span style={{ fontSize: 10, color: cs.muted, textAlign: "center" }}>{m.satuan}</span>
                          <input id={"ei_harga_" + mi} type="number" min="0" value={m.harga_satuan || 0}
                            onChange={e => setEditInvoiceItems(prev => prev.map((x, xi) => xi === mi ? { ...x, harga_satuan: parseInt(e.target.value) || 0, subtotal: (parseInt(e.target.value) || 0) * (x.jumlah || 0) } : x))}
                            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, fontFamily: "monospace", textAlign: "right" }} />
                          <button onClick={() => setEditInvoiceItems(prev => prev.filter((_, xi) => xi !== mi))}
                            style={{ background: "#ef444420", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: cs.muted, textAlign: "right" }}>
                    Subtotal material: <strong style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(matTotal)}</strong>
                  </div>
                </div>

                {/* ── Total preview ── */}
                <div style={{ background: cs.accent + "12", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>Total Invoice Baru</div>
                  <div style={{ fontWeight: 800, fontSize: 22, color: cs.accent, fontFamily: "monospace" }}>{fmt(newTotal)}</div>
                  {newTotal !== editInvoiceData.total && (
                    <div style={{ fontSize: 11, color: cs.yellow, marginTop: 4 }}>
                      Perubahan: {fmt(newTotal - editInvoiceData.total)} dari sebelumnya {fmt(editInvoiceData.total)}
                    </div>
                  )}
                </div>

                {/* ── Catatan ── */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Catatan Perubahan</div>
                  <input id="ei_notes" value={editInvoiceForm.notes || ''}
                    onChange={e => setEditInvoiceForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Alasan perubahan nilai..."
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13 }}
                  />
                </div>

                {/* ── Action buttons ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                  <button onClick={() => { setModalEditInvoice(false); setEditAddType(''); setEditAddSearch(''); }}
                    style={{ padding: "11px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, color: cs.text, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                    Batal
                  </button>
                  <button onClick={async () => {
                    const jasaTotal3 = editJasaItems.reduce((s, m) => s + (m.subtotal || 0), 0);
                    const matTotal3 = editInvoiceItems.reduce((s, m) => s + (m.subtotal || 0), 0);
                    const labor = jasaTotal3;
                    const newTotalFinal = jasaTotal3 + matTotal3;
                    if (newTotalFinal <= 0) { showNotif("⚠️ Total tidak boleh 0"); return; }
                    const newMD = [
                      ...editJasaItems.filter(m => m.nama && (m.jumlah || 0) > 0),
                      ...editInvoiceItems.filter(m => m.nama && (m.jumlah || 0) > 0)
                    ];
                    setInvoicesData(prev => prev.map(i => i.id === editInvoiceData.id
                      ? { ...i, labor, material: matTotal3, dadakan: 0, total: newTotalFinal, materials_detail: newMD } : i));
                    let saved = false;
                    {
                      const { error: e1 } = await updateInvoice(supabase, editInvoiceData.id, {
                        labor, material: matTotal3, dadakan: 0, total: newTotalFinal,
                        materials_detail: JSON.stringify(newMD)
                      }, auditUserName()); if (!e1) saved = true; else console.warn("editInv e1:", e1.message);
                    }
                    if (!saved) {
                      const { error: e2 } = await updateInvoice(supabase, editInvoiceData.id, { labor, material: matTotal3, total: newTotalFinal }, auditUserName());
                      if (!e2) saved = true;
                    }
                    if (!saved) await updateInvoice(supabase, editInvoiceData.id, { total: newTotalFinal }, auditUserName());
                    addAgentLog("INVOICE_EDITED", `Invoice ${editInvoiceData.id} diedit → ${fmt(newTotalFinal)}` + (editInvoiceForm.notes ? ` (${editInvoiceForm.notes})` : "") + ` by Owner`, "SUCCESS");
                    showNotif(`✅ Invoice ${editInvoiceData.id} diupdate → ${fmt(newTotalFinal)}`);
                    setModalEditInvoice(false); setEditInvoiceData(null);
                    setEditAddType(''); setEditAddSearch('');
                  }} style={{ padding: "11px", background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                    💾 Simpan Perubahan
                  </button>
                </div>

              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — INVOICE PREVIEW */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalPDF && selectedInvoice && (() => {
        // Always use latest data from invoicesData state
        const liveInv = invoicesData.find(i => i.id === selectedInvoice.id) || selectedInvoice;
        return (
          <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setModalPDF(false)}>
            <div style={{ background: "#f8fafc", borderRadius: 20, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
              {/* Toolbar */}
              <div style={{ background: "#1E3A5F", padding: "12px 20px", borderRadius: "20px 20px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <div>
                  <div style={{ fontWeight: 800, color: "#fff", fontSize: 14 }}>Preview Invoice — {liveInv.id}</div>
                  <div style={{ fontSize: 11, color: "#93c5fd" }}>Format standar AClean · Dikirim sebagai PDF ke customer</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {liveInv.status === "PENDING_APPROVAL" && (
                    <button onClick={() => { setModalPDF(false); setTimeout(() => approveInvoice(liveInv), 100); }}
                      style={{ background: "#22c55e", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓ Approve Invoice</button>
                  )}
                  <button onClick={() => setModalPDF(false)} style={{ background: "none", border: "1px solid #ffffff44", color: "#fff", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>× Tutup</button>
                </div>
              </div>
              {/* Invoice body */}
              <div style={{ padding: 20, background: "#f8fafc" }}>
                {/* Header */}
                <div style={{ background: "#1E3A5F", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ height: 4, background: "#2563EB" }} />
                  <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>
                        <span style={{ color: "#60a5fa" }}>AC</span>lean Service
                      </div>
                      <div style={{ fontSize: 11, color: "#93c5fd", marginTop: 3 }}>Jasa Servis &amp; Perawatan AC Profesional</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "#93c5fd", fontWeight: 600 }}>INVOICE</div>
                      <div style={{ background: "#2563EB", color: "#fff", padding: "4px 10px", borderRadius: 6, fontFamily: "monospace", fontWeight: 800, fontSize: 13 }}>{liveInv.id}</div>
                    </div>
                  </div>
                  <div style={{ background: "#0f2744", padding: "8px 20px", display: "flex", gap: 20, fontSize: 10, color: "#94a3b8" }}>
                    <span>📍 ${appSettings.company_addr}</span>
                    <span>🏦 ${appSettings.bank_name} ${appSettings.bank_number} a.n. ${appSettings.bank_holder}</span>
                  </div>
                </div>
                {/* Detail Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af", marginBottom: 8, textTransform: "uppercase" }}>Detail Invoice</div>
                    {[
                      ["Tgl Invoice", liveInv.created_at ? new Date(liveInv.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : (liveInv.sent_at ? new Date(liveInv.sent_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—")],
                      ["Issued", new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })],
                      ["No. Invoice", liveInv.id],
                      ["No. Order", liveInv.job_id || "—"],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 11 }}>
                        <span style={{ color: "#64748b", minWidth: 80 }}>{k}</span>
                        <span style={{ color: "#1e293b", fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af", marginBottom: 8, textTransform: "uppercase" }}>Tagihan Kepada</div>
                    <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13, marginBottom: 4 }}>{liveInv.customer}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>📱 {liveInv.phone}</div>
                  </div>
                </div>
                {/* Service Table */}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#1E3A5F" }}>
                      {[["Deskripsi", "auto"], ["Jml Unit", "72px"], ["Harga Satuan", "100px"], ["Subtotal", "100px"]].map(([h, w]) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: h === "Deskripsi" ? "left" : "right", color: "#fff", fontWeight: 700, width: w, fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {liveInv.labor > 0 && parseMD(liveInv.materials_detail).length === 0 && (
                      <tr style={{ background: "#fff" }}>
                        <td style={{ padding: "8px 10px", color: "#1e293b" }}>{liveInv.service}</td>
                        <td style={{ padding: "8px 10px", color: "#475569", textAlign: "center" }}>{liveInv.units}</td>
                        <td style={{ padding: "8px 10px", color: "#475569", fontFamily: "monospace" }}>{((liveInv.labor || 0) / (liveInv.units || 1)).toLocaleString("id-ID")}</td>
                        <td style={{ padding: "8px 10px", color: "#1e293b", fontFamily: "monospace", fontWeight: 600 }}>{liveInv.labor.toLocaleString("id-ID")}</td>
                      </tr>
                    )}
                    {/* Per-item material dari materials_detail */}
                    {(() => {
                      const md = liveInv.materials_detail;
                      const mArr = Array.isArray(md) ? md
                        : (typeof md === "string" && md)
                          ? (() => { try { return JSON.parse(md); } catch (_) { return []; } })()
                          : [];
                      if (mArr.length > 0) {
                        return mArr.map((m, mi) => (
                          <tr key={mi} style={{ background: mi % 2 === 0 ? "#f0f9ff" : "#fff" }}>
                            <td style={{ padding: "8px 10px", color: "#1e293b" }}>
                              {m.nama}
                              {m.keterangan && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>({m.keterangan})</span>}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: "#475569", width: "72px" }}>{m.jumlah} {m.satuan}</td>
                            <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#475569", textAlign: "right" }}>
                              {(() => {
                                const hF = m.harga_satuan > 0 ? m.harga_satuan
                                  : (m.subtotal > 0 && m.jumlah > 0 ? Math.round(m.subtotal / m.jumlah) : 0);
                                return hF > 0 ? hF.toLocaleString("id-ID") : "—";
                              })()}
                            </td>
                            <td style={{ padding: "8px 10px", fontFamily: "monospace", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>
                              {m.subtotal > 0 ? m.subtotal.toLocaleString("id-ID") : "—"}
                            </td>
                          </tr>
                        ));
                      }
                      // Fallback: materials_detail kosong → tampil 1 baris total
                      if ((liveInv.material || 0) > 0) return (
                        <tr style={{ background: "#f0f9ff" }}>
                          <td style={{ padding: "8px 10px", color: "#64748b", fontStyle: "italic" }}>Material &amp; Spare Part</td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>—</td>
                          <td style={{ padding: "8px 10px" }}>—</td>
                          <td style={{ padding: "8px 10px", fontFamily: "monospace", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>
                            {(liveInv.material || 0).toLocaleString("id-ID")}
                          </td>
                        </tr>
                      );
                      return null;
                    })()}
                    {liveInv.dadakan > 0 && (
                      <tr style={{ background: "#fffbeb" }}>
                        <td style={{ padding: "8px 10px", color: "#92400e" }}>Pekerjaan Tambahan</td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>—</td>
                        <td style={{ padding: "8px 10px" }}>—</td>
                        <td style={{ padding: "8px 10px", color: "#92400e", fontFamily: "monospace", fontWeight: 600 }}>{liveInv.dadakan.toLocaleString("id-ID")}</td>
                      </tr>
                    )}
                    <tr style={{ background: "#1E3A5F" }}>
                      <td colSpan={3} style={{ padding: "8px 10px", color: "#fff", fontWeight: 700 }}>TOTAL TAGIHAN</td>
                      <td style={{ padding: "8px 10px", color: "#fff", fontFamily: "monospace", fontWeight: 800, fontSize: 14 }}>Rp {liveInv.total.toLocaleString("id-ID")}</td>
                    </tr>
                  </tbody>
                </table>
                {/* Footer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af", marginBottom: 6 }}>Informasi Pembayaran</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>Transfer Bank BCA</div>
                    <div style={{ fontWeight: 800, color: "#1e293b", fontSize: 13, marginTop: 4 }}>{appSettings.bank_number}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>a.n. {appSettings.bank_holder}</div>
                  </div>
                  <div style={{ background: liveInv.status === "OVERDUE" ? "#FEF2F2" : liveInv.status === "PAID" ? "#F0FDF4" : "#FFFBEB", borderRadius: 8, padding: "12px 14px", border: "1px solid " + (liveInv.status === "OVERDUE" ? "#fca5a5" : liveInv.status === "PAID" ? "#86efac" : "#fde68a") }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", marginBottom: 6 }}>Jatuh Tempo</div>
                    <div style={{ fontWeight: 700, color: "#1e293b" }}>{liveInv.due || "Menunggu Approval"}</div>
                    {liveInv.status === "OVERDUE" && <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 700, marginTop: 4 }}>⚠️ SUDAH JATUH TEMPO</div>}
                    {liveInv.status === "PAID" && <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, marginTop: 4 }}>✅ LUNAS</div>}
                  </div>
                </div>
                <div style={{ textAlign: "center", padding: "10px 0", borderTop: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, color: "#64748b" }}>Pertanyaan? Hubungi kami via WA: ${appSettings.wa_number}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 4 }}>Terima kasih telah mempercayakan perawatan AC Anda kepada ${appSettings.company_name}</div>
                </div>
              </div>
              {/* Action bar */}
              <div style={{ background: "#f1f5f9", padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", borderRadius: "0 0 20px 20px", flexShrink: 0 }}>
                <button onClick={() => downloadInvoicePDF(liveInv)} style={{ background: "#EFF6FF", border: "1px solid #bfdbfe", color: "#1d4ed8", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📥 Download PDF</button>
                {liveInv.status === "UNPAID" && (
                  <button onClick={() => { invoiceReminderWA(liveInv); setModalPDF(false); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📱 Kirim via WA</button>
                )}
                {liveInv.status === "PENDING_APPROVAL" &&
                  (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                    <button onClick={() => { setEditInvoiceData(liveInv); setEditInvoiceForm({ labor: liveInv.labor, material: liveInv.material, dadakan: liveInv.dadakan, notes: "" }); const _aLv = parseMD(liveInv.materials_detail).map((m, idx) => ({ ...m, _idx: idx })); const _jLv = _aLv.filter(m => jasaSvcNames.some(s => (m.nama || "").includes(s))); const _mLv = _aLv.filter(m => !jasaSvcNames.some(s => (m.nama || "").includes(s))); setEditJasaItems(_jLv); setEditInvoiceItems(_mLv); setModalPDF(false); setModalEditInvoice(true); }} style={{ background: "#fef9c322", border: "1px solid #fde68a", color: "#92400e", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit Nilai</button>
                  )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — APPROVE INVOICE (pilihan kirim/simpan) */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalApproveInv && pendingApproveInv && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 500,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20
        }}
          onClick={() => { setModalApproveInv(false); setPendingApproveInv(null); }}>
          <div style={{
            background: cs.surface, border: "1px solid " + cs.border, borderRadius: 18,
            padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.4)"
          }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>✅ Approve Invoice</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>Setelah approve, invoice tidak bisa diedit lagi</div>
              </div>
              <button onClick={() => { setModalApproveInv(false); setPendingApproveInv(null); }}
                style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Info invoice */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 14 }}>{pendingApproveInv.id}</span>
                <span style={{ fontWeight: 800, color: cs.green, fontSize: 14 }}>{fmt(pendingApproveInv.total)}</span>
              </div>
              <div style={{ fontSize: 12, color: cs.muted }}>👤 {pendingApproveInv.customer}</div>
              <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>🔧 {pendingApproveInv.service}</div>
              <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>📱 {pendingApproveInv.phone}</div>
            </div>

            {/* Pilihan */}
            <div style={{ display: "grid", gap: 10 }}>
              {/* Opsi 1 — Kirim ke Customer */}
              <button onClick={() => approveAndSend(pendingApproveInv)}
                style={{
                  display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(135deg," + cs.green + ",#059669)",
                  border: "none", borderRadius: 12, padding: "14px 18px", cursor: "pointer", textAlign: "left"
                }}>
                <span style={{ fontSize: 24 }}>📤</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Approve & Kirim ke Customer</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>Invoice langsung dikirim via WA ke {pendingApproveInv.phone}</div>
                </div>
              </button>

              {/* Opsi 2 — Simpan Dahulu */}
              <button onClick={() => approveSaveOnly(pendingApproveInv)}
                style={{
                  display: "flex", alignItems: "center", gap: 14, background: cs.card,
                  border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", cursor: "pointer", textAlign: "left"
                }}>
                <span style={{ fontSize: 24 }}>💾</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Approve & Simpan Dahulu</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Invoice diapprove tapi belum dikirim — kirim manual nanti dari halaman Invoice</div>
                </div>
              </button>

              <button onClick={() => { setModalApproveInv(false); setPendingApproveInv(null); }}
                style={{ background: "none", border: "none", color: cs.muted, fontSize: 12, cursor: "pointer", padding: "6px 0" }}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — WA TEKNISI KE CUSTOMER (pilihan pesan) */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalWaTek && waTekTarget && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 600,
          display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 0 0"
        }}
          onClick={() => { setModalWaTek(false); setWaTekTarget(null); }}>
          <div style={{
            background: cs.surface, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: 480,
            padding: "24px 20px 32px", border: "1px solid " + cs.border
          }}
            onClick={e => e.stopPropagation()}>

            {/* Handle bar */}
            <div style={{ width: 40, height: 4, background: cs.border, borderRadius: 99, margin: "0 auto 18px" }} />

            {/* Header */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📱 WA ke Customer</div>
              <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
                {waTekTarget.customer} · {waTekTarget.phone}
              </div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>🔧 {waTekTarget.service}</div>
            </div>

            {/* Pilihan pesan */}
            <div style={{ display: "grid", gap: 8 }}>
              {[
                {
                  icon: "🚗",
                  label: "Konfirmasi sedang menuju",
                  msg: `Halo ${waTekTarget.customer}, saya dari AClean Service sedang dalam perjalanan menuju lokasi Anda. Estimasi tiba pkl ${waTekTarget.time || "sebentar lagi"}. Mohon ditunggu ya! 🙏`
                },
                {
                  icon: "📍",
                  label: "Tanya patokan / lokasi",
                  msg: `Halo ${waTekTarget.customer}, saya teknisi AClean yang akan servis hari ini. Boleh minta patokan lokasi rumah Bapak/Ibu? Alamat yang tercatat: ${waTekTarget.address || "—"}. Terima kasih 🙏`
                },
                {
                  icon: "✅",
                  label: "Konfirmasi jadwal hari ini",
                  msg: `Halo ${waTekTarget.customer}, kami konfirmasi jadwal servis AC dari AClean hari ini pkl ${waTekTarget.time || "—"} untuk ${waTekTarget.service || "servis AC"}. Apakah masih bisa? 🙏`
                },
                {
                  icon: "⏰",
                  label: "Info terlambat / minta reschedule",
                  msg: `Halo ${waTekTarget.customer}, mohon maaf kami dari AClean ada keterlambatan. Kami akan tiba sedikit lebih lama dari jadwal. Terima kasih atas pengertiannya 🙏`
                },
                {
                  icon: "✔️",
                  label: "Pekerjaan selesai — terima kasih",
                  msg: `Halo ${waTekTarget.customer}, pekerjaan servis AC (${waTekTarget.service || "—"}) telah selesai. Terima kasih sudah mempercayakan ke AClean Service. Semoga AC-nya nyaman kembali! 😊`
                },
              ].map(({ icon, label, msg }) => (
                <button key={label} onClick={async () => {
                  setModalWaTek(false);
                  setWaTekTarget(null);
                  await openWA(waTekTarget.phone, msg);
                }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, background: cs.card,
                    border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px",
                    cursor: "pointer", textAlign: "left", width: "100%"
                  }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{label}</div>
                    <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{msg.slice(0, 60)}...</div>
                  </div>
                </button>
              ))}

              {/* Ketik manual */}
              <button onClick={() => {
                setModalWaTek(false); setWaTekTarget(null);
                window.open("https://wa.me/" + String(waTekTarget.phone).replace(/^0/, "62").replace(/[^0-9]/g, ""), "_blank");
              }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, background: "#25D36615",
                  border: "1px solid #25D36633", borderRadius: 12, padding: "12px 14px",
                  cursor: "pointer", textAlign: "left", width: "100%"
                }}>
                <span style={{ fontSize: 20 }}>💬</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#25D366" }}>Ketik pesan sendiri</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Buka WhatsApp — tulis pesan bebas</div>
                </div>
              </button>

              <button onClick={() => { setModalWaTek(false); setWaTekTarget(null); }}
                style={{ background: "none", border: "none", color: cs.muted, fontSize: 12, cursor: "pointer", padding: "6px 0", marginTop: 4 }}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* WA PANEL */}
      {/* ══════════════════════════════════════════════════════ */}
      {waPanel && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 300, display: "flex", justifyContent: "flex-end" }} onClick={() => setWaPanel(false)}>
          <div style={{ width: isMobile ? "100%" : 420, background: cs.surface, borderLeft: isMobile ? "none" : "1px solid " + cs.border, display: "flex", flexDirection: "column", height: "100vh" }} onClick={e => e.stopPropagation()}>
            <div style={{ background: cs.card, padding: "16px 20px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 800, color: "#25D366", fontSize: 14 }}>📱 WhatsApp Monitor</div>
                <div style={{ fontSize: 11, color: cs.muted }}>via {waProvider === "fonnte" ? "Fonnte" : waProvider === "wa_cloud" ? "WA Cloud API" : "Twilio"} · Real-time</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={async () => {
                  const { data, error } = await fetchWaConversations(supabase, 50);
                  if (error) {
                    if (error.code === "42P01") showNotif("⚠️ Tabel wa_conversations belum dibuat — jalankan SQL setup di Supabase");
                    else showNotif("⚠️ WA Monitor error: " + (error.message || error.code));
                    console.error("[WA_MONITOR_REFRESH]", error);
                  } else {
                    if (data) setWaConversations(data);
                    showNotif(data?.length > 0 ? `✅ ${data.length} percakapan dimuat` : "ℹ️ Belum ada percakapan masuk");
                  }
                }}
                  style={{ background: "none", border: "1px solid " + cs.border, color: cs.muted, fontSize: 12, padding: "4px 10px", borderRadius: 8, cursor: "pointer" }}>🔄</button>
                <button onClick={() => setWaPanel(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
              </div>
            </div>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              <div style={{ width: "100%", overflowY: "auto", display: selectedConv ? "none" : "block" }}>
                {waConversations.length === 0 && (
                  <div style={{ padding: 12, fontSize: 10, color: cs.muted, textAlign: "center", lineHeight: 1.6 }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>📭</div>
                    <div>Belum ada pesan masuk</div>
                    <div style={{ marginTop: 6, color: cs.accent, fontSize: 9 }}>
                      Pastikan:<br/>
                      1. Tabel SQL sudah dibuat<br/>
                      2. Webhook Fonnte aktif<br/>
                      3. Klik 🔄 setelah kirim WA test
                    </div>
                  </div>
                )}
                {waConversations.map(conv => (
                  <div key={conv.id} onClick={() => {
                    setSelectedConv(conv);
                    // Load chat history dari wa_messages
                    supabase.from("wa_messages").select("id,phone,name,content,role,created_at,image_url")
                      .eq("phone", conv.phone)
                      .order("created_at", { ascending: true })
                      .limit(100)
                      .then(({ data, error }) => {
                        if (error && error.code === "42703") {
                          // Kolom image_url belum ada — fallback tanpa image_url
                          supabase.from("wa_messages").select("id,phone,name,content,role,created_at")
                            .eq("phone", conv.phone).order("created_at", { ascending: true }).limit(100)
                            .then(({ data: d2 }) => { if (d2) setWaMessages(d2); });
                        } else if (data) {
                          setWaMessages(data);
                        }
                      });
                    // Reset unread di DB + state
                    supabase.from("wa_conversations").update({ unread: 0 }).eq("phone", conv.phone).then(() => {});
                    setWaConversations(prev => prev.map(cv => cv.id === conv.id ? { ...cv, unread: 0 } : cv));
                  }}
                    style={{ padding: "10px 12px", borderBottom: "1px solid " + cs.border, cursor: "pointer", background: selectedConv?.id === conv.id ? cs.accent + "12" : "transparent" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 700, color: cs.text, fontSize: 12, marginBottom: 1 }}>{conv.name}</div>
                      {conv.unread > 0 && <span style={{ background: cs.green, color: "#fff", fontSize: 9, borderRadius: "50%", minWidth: 15, height: 15, padding: "0 3px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0 }}>{conv.unread}</span>}
                    </div>
                    <div style={{ fontSize: 9, color: cs.accent, marginBottom: 2 }}>{conv.phone}</div>
                    <div style={{ fontSize: 10, color: cs.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.last_message || conv.last}</div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, flexDirection: "column", display: !selectedConv ? "none" : "flex" }}>
                {selectedConv ? (
                  <>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid " + cs.border, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => setSelectedConv(null)} style={{ background: "none", border: "none", color: cs.accent, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1, fontWeight: 700 }}>‹</button>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{selectedConv.name}</div>
                        <div style={{ fontSize: 10, color: cs.muted }}>{selectedConv.phone} · {selectedConv.intent}</div>
                      </div>
                    </div>
                    <div style={{ flex: 1, padding: "12px 14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                      {waMessages.length === 0 ? (
                        <div style={{ textAlign: "center", color: cs.muted, fontSize: 12, paddingTop: 30 }}>Belum ada riwayat pesan.<br/>Pesan masuk dari customer akan muncul di sini.</div>
                      ) : waMessages.map((msg, mi) => {
                        const isOut = msg.role === "ara" || msg.role === "admin";
                        return (
                          <div key={msg.id || mi} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                            <div style={{ maxWidth: "80%", background: isOut ? "#25D36622" : cs.card, border: "1px solid " + (isOut ? "#25D36633" : cs.border), borderRadius: isOut ? "12px 2px 12px 12px" : "2px 12px 12px 12px", padding: "8px 12px", fontSize: 12 }}>
                              {isOut && <div style={{ fontSize: 10, color: "#25D366", fontWeight: 700, marginBottom: 3 }}>{msg.role === "ara" ? "🤖 ARA" : "👤 Admin"}</div>}
                              {msg.image_url && (
                                <a href={msg.image_url} target="_blank" rel="noopener noreferrer">
                                  <img src={msg.image_url} alt="gambar" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, marginBottom: 4, display: "block", cursor: "pointer" }} onError={e => { e.target.style.display="none"; }} />
                                </a>
                              )}
                              <div style={{ color: cs.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</div>
                              <div style={{ fontSize: 9, color: cs.muted, marginTop: 3, textAlign: "right" }}>{msg.created_at ? new Date(msg.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: "10px 14px", borderTop: "1px solid " + cs.border, display: "flex", gap: 8, flexShrink: 0 }}>
                      <input id="waInput" value={waInput} onChange={e => setWaInput(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === "Enter" && waInput.trim() && selectedConv) {
                            const txt = waInput; setWaInput("");
                            const ok = await sendWA(selectedConv.phone, txt);
                            if (ok) {
                              const nowIso = new Date().toISOString();
                              setWaMessages(prev => [...prev, { id: Date.now(), phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin", created_at: nowIso }]);
                              supabase.from("wa_messages").insert({ phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin" }).then(() => {});
                              supabase.from("wa_conversations").update({ last_reply: txt.slice(0, 80), updated_at: nowIso }).eq("phone", selectedConv.phone).then(() => {});
                              setWaConversations(prev => prev.map(cv => cv.id === selectedConv.id ? { ...cv, last_reply: txt.slice(0, 80) } : cv));
                            }
                            addAgentLog("WA_SENT_MANUAL", `Manual reply ke ${selectedConv.name}: "${txt.slice(0, 40)}"`, "SUCCESS");
                            showNotif(ok ? "✅ Pesan terkirim via Fonnte" : "📱 Fonnte gagal — cek koneksi");
                          }
                        }}
                        placeholder="Balas manual..." style={{ flex: 1, background: cs.bg, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 12px", color: cs.text, fontSize: 12, outline: "none" }} />
                      <button onClick={async () => {
                        if (waInput.trim() && selectedConv) {
                          const txt = waInput; setWaInput("");
                          const ok = await sendWA(selectedConv.phone, txt);
                          if (ok) {
                            const nowIso = new Date().toISOString();
                            setWaMessages(prev => [...prev, { id: Date.now(), phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin", created_at: nowIso }]);
                            supabase.from("wa_messages").insert({ phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin" }).then(() => {});
                            supabase.from("wa_conversations").update({ last_reply: txt.slice(0, 80), updated_at: nowIso }).eq("phone", selectedConv.phone).then(() => {});
                            setWaConversations(prev => prev.map(cv => cv.id === selectedConv.id ? { ...cv, last_reply: txt.slice(0, 80) } : cv));
                          }
                          addAgentLog("WA_SENT_MANUAL", `Manual reply ke ${selectedConv.name}: "${txt.slice(0, 40)}"`, "SUCCESS");
                          showNotif(ok ? "✅ Pesan terkirim via Fonnte" : "📱 Fonnte gagal — cek koneksi");
                        }
                      }}
                        style={{ background: "#25D366", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Kirim</button>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted, fontSize: 13 }}>Pilih percakapan</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ MODAL TAMBAH/EDIT PENGGUNA ═══════ */}
      {modalAddUser && (() => {
        // Auto-password berdasarkan role
        const roleConfig = {
          "Owner": { color: "#f59e0b", icon: "👑", desc: "Akses semua menu & pengaturan", autoPass: null },
          "Admin": { color: "#38bdf8", icon: "🛠️", desc: "Semua menu kecuali Pengaturan", autoPass: null },
          "Teknisi": { color: "#22c55e", icon: "👷", desc: "Hanya Jadwal & Laporan", autoPass: "teknisi123" },
          "Helper": { color: "#a78bfa", icon: "🤝", desc: "Hanya Jadwal & Laporan", autoPass: "helper123" },
        };
        const cfg = roleConfig[newUserForm.role] || roleConfig["Admin"];
        const isAutoPass = ["Teknisi", "Helper"].includes(newUserForm.role);
        const effectivePass = isAutoPass ? cfg.autoPass : newUserForm.password;

        const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
        const isEditMode = !!(newUserForm.id && isUUID(newUserForm.id));

        const callManageUser = async (body) => {
          let resolvedRole = currentUser?.role || "";
          if (!resolvedRole) {
            try {
              const saved = JSON.parse(localStorage.getItem("localSession") || "{}");
              resolvedRole = saved?.role || "";
            } catch {}
          }
          const res = await fetch("/api/manage-user", {
            method: "POST",
            headers: await _apiHeaders(),
            body: JSON.stringify({ ...body, callerRole: resolvedRole })
          });
          return res.json();
        };

        const handleSaveUser = async () => {
          if (!newUserForm.name || !newUserForm.email) { showNotif("Nama dan email wajib diisi"); return; }
          if (!isEditMode && !isAutoPass && !newUserForm.password) { showNotif("Password wajib diisi"); return; }

          const avatar = newUserForm.name.charAt(0).toUpperCase();
          const colorMap = { "Owner": "#f59e0b", "Admin": "#38bdf8", "Teknisi": "#22c55e", "Helper": "#a78bfa" };
          const color = colorMap[newUserForm.role] || "#38bdf8";

          if (isEditMode) {
            // ── EDIT via backend API ──
            const result = await callManageUser({ action: "update", userId: newUserForm.id, name: newUserForm.name, role: newUserForm.role, phone: newUserForm.phone || "" });
            if (!result.ok) { showNotif("⚠️ " + (result.error || "Update gagal")); return; }
            setUserAccounts(prev => prev.map(u => u.id === newUserForm.id ? { ...u, name: newUserForm.name, role: newUserForm.role, phone: newUserForm.phone || "", avatar, color } : u));
            // Sync Tim Teknisi: update jika sudah ada, tambah jika role berubah jadi Teknisi/Helper
            if (["Teknisi", "Helper"].includes(newUserForm.role)) {
              setTeknisiData(prev => {
                const exists = prev.find(t => t.id === newUserForm.id);
                if (exists) return prev.map(t => t.id === newUserForm.id ? { ...t, name: newUserForm.name, role: newUserForm.role, phone: newUserForm.phone || "", color } : t);
                return [...prev, { id: newUserForm.id, name: newUserForm.name, role: newUserForm.role, phone: newUserForm.phone || "", skills: [], jobs_today: 0, status: "active", color, avatar }];
              });
            } else {
              // Jika role berubah dari Teknisi/Helper ke lain → hapus dari tim
              setTeknisiData(prev => prev.filter(t => t.id !== newUserForm.id));
            }
            addAgentLog("USER_UPDATED", "Akun " + newUserForm.name + " diupdate", "SUCCESS");
            showNotif("✅ Akun " + newUserForm.name + " berhasil diupdate");

          } else {
            // ── BUAT user baru via backend API (tanpa perlu konfirmasi email) ──
            const password = effectivePass;
            const result = await callManageUser({ action: "create", email: newUserForm.email, password, name: newUserForm.name, role: newUserForm.role, phone: newUserForm.phone || "" });
            if (!result.ok) { showNotif("❌ " + (result.error || "Gagal buat akun")); return; }
            const uid = result.user?.id;
            const newAcc = { id: uid, name: newUserForm.name, email: newUserForm.email, role: newUserForm.role, phone: newUserForm.phone || "", avatar, color, active: true, lastLogin: "Belum login" };
            setUserAccounts(prev => [...prev, newAcc]);
            // Auto-sync Tim Teknisi jika role Teknisi atau Helper
            if (["Teknisi", "Helper"].includes(newUserForm.role)) {
              setTeknisiData(prev => {
                if (prev.find(t => t.id === uid)) return prev;
                return [...prev, { id: uid, name: newUserForm.name, role: newUserForm.role, phone: newUserForm.phone || "", skills: [], jobs_today: 0, status: "active", color, avatar }];
              });
            }
            addAgentLog("USER_CREATED", "Akun baru: " + newUserForm.name + " (" + newUserForm.role + ")", "SUCCESS");
            showNotif(`✅ Akun ${newUserForm.name} dibuat — langsung aktif — password: ${password}`);
          }
          setModalAddUser(false); setNewUserForm({ name: "", email: "", role: "Admin", password: "", phone: "" });
        };

        const handleToggleActive = async () => {
          if (!isEditMode || newUserForm.role === "Owner") return;
          const isCurrentlyActive = newUserForm.active !== false;
          const label = isCurrentlyActive ? "Nonaktifkan" : "Aktifkan";
          if (!await showConfirm({ icon: isCurrentlyActive ? "🔒" : "🔓", title: label + " Akun?", danger: isCurrentlyActive, message: `${label} akun ${newUserForm.name}?\n${isCurrentlyActive ? "User tidak bisa login sampai diaktifkan kembali." : "User bisa login kembali."}`, confirmText: label })) return;
          const result = await callManageUser({ action: "toggle-active", userId: newUserForm.id, active: !isCurrentlyActive });
          if (!result.ok) { showNotif("⚠️ " + (result.error || "Gagal")); return; }
          setUserAccounts(prev => prev.map(u => u.id === newUserForm.id ? { ...u, active: !isCurrentlyActive } : u));
          addAgentLog(isCurrentlyActive ? "USER_DEACTIVATED" : "USER_ACTIVATED", "Akun " + newUserForm.name + " " + (isCurrentlyActive ? "dinonaktifkan" : "diaktifkan"), "WARNING");
          showNotif((isCurrentlyActive ? "🔒 Akun dinonaktifkan: " : "🔓 Akun diaktifkan: ") + newUserForm.name);
          setModalAddUser(false); setNewUserForm({ name: "", email: "", role: "Admin", password: "", phone: "" });
        };

        const handleResetPassword = async () => {
          if (!isEditMode) return;
          const newPass = window.prompt(`Reset password untuk ${newUserForm.name}:\n(minimal 6 karakter)`);
          if (!newPass) return;
          if (newPass.length < 6) { showNotif("⚠️ Password minimal 6 karakter"); return; }
          const result = await callManageUser({ action: "reset-password", userId: newUserForm.id, password: newPass });
          if (!result.ok) { showNotif("⚠️ " + (result.error || "Reset gagal")); return; }
          addAgentLog("USER_RESET_PWD", "Password " + newUserForm.name + " direset oleh " + auditUserName(), "WARNING");
          showNotif("🔑 Password " + newUserForm.name + " berhasil direset");
        };

        const handleDeleteUser = async () => {
          if (!isEditMode || newUserForm.role === "Owner") return;
          if (!await showConfirm({ icon: "🗑️", title: "Hapus Permanen?", danger: true, message: `Hapus akun ${newUserForm.name} dari sistem?\n\nAkun dihapus dari Supabase Auth. Data order/laporan tetap ada.\n\nGunakan "Nonaktifkan" jika hanya ingin blokir login.`, confirmText: "Hapus Permanen" })) return;
          const result = await callManageUser({ action: "delete", userId: newUserForm.id });
          if (!result.ok) { showNotif("⚠️ " + (result.error || "Hapus gagal")); return; }
          setUserAccounts(prev => prev.filter(u => u.id !== newUserForm.id));
          addAgentLog("USER_DELETED", "Akun " + newUserForm.name + " dihapus permanen", "WARNING");
          showNotif("🗑️ Akun " + newUserForm.name + " dihapus permanen");
          setModalAddUser(false); setNewUserForm({ name: "", email: "", role: "Admin", password: "", phone: "" });
        };

        return (
          <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setModalAddUser(false)}>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 480, padding: 28, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{newUserForm.id ? "Edit Pengguna" : "Tambah Anggota Tim"}</div>
                  <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Hanya Owner yang dapat mengelola akun</div>
                </div>
                <button onClick={() => setModalAddUser(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>✕</button>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {/* Role Selector — 4 role */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>Role / Hak Akses</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                    {Object.entries(roleConfig).map(([role, cfg]) => (
                      <div key={role}
                        onClick={() => setNewUserForm(f => ({ ...f, role, password: cfg.autoPass || "" }))}
                        style={{ background: newUserForm.role === role ? cfg.color + "18" : cs.card, border: "2px solid " + (newUserForm.role === role ? cfg.color : cs.border), borderRadius: 10, padding: "12px 10px", cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: newUserForm.role === role ? cfg.color : cs.text }}>{role}</span>
                        </div>
                        <div style={{ fontSize: 10, color: cs.muted }}>{cfg.desc}</div>
                        {cfg.autoPass && <div style={{ fontSize: 10, color: cfg.color, marginTop: 4, fontWeight: 700 }}>🔑 Password otomatis: {cfg.autoPass}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Form fields */}
                {[["Nama Lengkap", "name", "text", "Nama lengkap anggota"], ["Email Login", "email", "email", "nama@aclean.id"], ["Nomor HP", "phone", "text", "628812xxx"]].map(([label, key, type, ph]) => (
                  <div key={key}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>{label}</div>
                    <input type={type} value={newUserForm[key] || ""} onChange={e => setNewUserForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={ph}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                ))}

                {/* Password — auto atau manual */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Password</div>
                  {isAutoPass ? (
                    <div style={{ background: cfg.color + "15", border: "1px solid " + cfg.color + "44", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>🔑</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: cfg.color }}>{cfg.autoPass}</div>
                        <div style={{ fontSize: 10, color: cs.muted }}>Password standar untuk semua {newUserForm.role}. Beritahu anggota password ini.</div>
                      </div>
                    </div>
                  ) : (
                    <input id="field_password_23" type="password" value={newUserForm.password || ""} onChange={e => setNewUserForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="min 8 karakter"
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  )}
                </div>

                {/* Info role */}
                <div style={{ background: cfg.color + "10", border: "1px solid " + cfg.color + "22", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: cs.muted }}>
                  {newUserForm.role === "Owner" && "👑 Akses penuh: semua menu, pengaturan, manajemen akun, dan data keuangan."}
                  {newUserForm.role === "Admin" && "🛠️ Akses operasional: order, invoice, customer, inventory, laporan. Tidak bisa buka Pengaturan."}
                  {newUserForm.role === "Teknisi" && "👷 Akses terbatas: Dashboard, Jadwal, dan Laporan Sendiri saja. Nominal transaksi disembunyikan."}
                  {newUserForm.role === "Helper" && "🤝 Akses terbatas: Dashboard, Jadwal, dan Laporan Sendiri saja. Sama seperti Teknisi."}
                </div>

                {/* Tombol manage — hanya saat edit user UUID valid, bukan Owner */}
                {isEditMode && newUserForm.role !== "Owner" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={handleResetPassword}
                      style={{ background: "#f59e0b18", border: "1px solid #f59e0b44", color: "#f59e0b", padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>
                      🔑 Reset Password
                    </button>
                    <button onClick={handleToggleActive}
                      style={{ background: newUserForm.active !== false ? cs.red + "18" : "#22c55e18", border: "1px solid " + (newUserForm.active !== false ? cs.red + "44" : "#22c55e44"), color: newUserForm.active !== false ? cs.red : "#22c55e", padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>
                      {newUserForm.active !== false ? "🔒 Nonaktifkan" : "🔓 Aktifkan"}
                    </button>
                    <button onClick={handleDeleteUser}
                      style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 11, gridColumn: "1/-1" }}>
                      🗑️ Hapus Permanen dari Supabase Auth
                    </button>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
                  <button onClick={() => setModalAddUser(false)}
                    style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Batal</button>
                  <button onClick={handleSaveUser}
                    style={{ background: "linear-gradient(135deg," + cfg.color + "," + cfg.color + "99)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                    {cfg.icon} {isEditMode ? "Simpan Perubahan" : "Buat Akun " + newUserForm.role}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════ MODAL TAMBAH CUSTOMER ═══════ */}
      {modalAddCustomer && (
        <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setModalAddCustomer(false)}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 460, padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{selectedCustomer?.id ? "✏️ Edit Customer" : "👤 Customer Baru"}</div>
              <button onClick={() => setModalAddCustomer(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {[["Nama Lengkap", "name", "text", "Nama customer"], ["Nomor HP", "phone", "text", "628xxx"], ["Alamat Lengkap", "address", "text", "Jl. ..."], ["Area/Kecamatan", "area", "text", "Alam Sutera, BSD, dll"]].map(([lbl, key, type, ph]) => (
                <div key={key}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>{lbl}</div>
                  <input type={type} value={newCustomerForm[key] || ""} onChange={e => setNewCustomerForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={ph} style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Catatan (Opsional)</div>
                <textarea value={newCustomerForm.notes || ""} onChange={e => setNewCustomerForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Catatan khusus..."
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" id="vip_chk" checked={newCustomerForm.is_vip || false} onChange={e => setNewCustomerForm(f => ({ ...f, is_vip: e.target.checked }))} />
                <label htmlFor="vip_chk" style={{ fontSize: 13, color: cs.text, cursor: "pointer" }}>⭐ Tandai sebagai VIP</label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 6 }}>
                <button onClick={() => setModalAddCustomer(false)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Batal</button>
                <button onClick={async () => {
                  if (!newCustomerForm.name || !newCustomerForm.phone) { showNotif("Nama dan nomor HP wajib diisi"); return; }
                  // GAP 6: cek duplikat phone sebelum submit
                  const existPhone = customersData.find(cu => samePhone(cu.phone, newCustomerForm.phone) && cu.id !== (selectedCustomer?.id || ""));
                  if (existPhone) { showNotif(`⚠️ Nomor HP sudah terdaftar atas nama "${existPhone.name}". Tidak bisa duplikat.`); return; }
                  if (selectedCustomer && selectedCustomer.id) {
                    // UPDATE existing customer
                    setCustomersData(prev => prev.map(cu => cu.id === selectedCustomer.id ? { ...cu, ...newCustomerForm } : cu));
                    setSelectedCustomer(prev => ({ ...prev, ...newCustomerForm }));
                    // Hanya kolom yang ada di DB schema
                    const dbUpdate = {
                      name: newCustomerForm.name.trim(),
                      phone: normalizePhone(newCustomerForm.phone),
                      address: newCustomerForm.address || "",
                      area: newCustomerForm.area || "",
                      notes: newCustomerForm.notes || "",
                      is_vip: newCustomerForm.is_vip || false,
                    };
                    const { error: cErr } = await updateCustomer(supabase, selectedCustomer.id, dbUpdate);
                    if (cErr) showNotif("⚠️ Gagal simpan ke DB: " + cErr.message);
                    else { addAgentLog("CUSTOMER_UPDATED", "Customer " + newCustomerForm.name + " diupdate oleh " + auditUserName(), "SUCCESS"); showNotif("✅ Data " + newCustomerForm.name + " berhasil diupdate"); }
                  } else {
                    // INSERT new customer — tanpa kirim `id`, biarkan DB generate
                    const today = getLocalDate();
                    const dbCust = {
                      name: newCustomerForm.name.trim(),
                      phone: normalizePhone(newCustomerForm.phone),
                      address: newCustomerForm.address || "",
                      area: newCustomerForm.area || "",
                      notes: newCustomerForm.notes || "",
                      is_vip: newCustomerForm.is_vip || false,
                      joined_date: today,
                      total_orders: 0,
                      last_service: null,
                    };
                    const { data: savedCust, error: cErr } = await insertCustomer(supabase, dbCust);
                    if (cErr) {
                      // Fallback upsert jika phone sudah ada di DB
                      const { data: upsertCust, error: cErr2 } = await upsertCustomer(supabase, dbCust, "phone");
                      if (cErr2) {
                        showNotif("⚠️ Gagal simpan ke DB: " + cErr.message);
                        // Tetap tampil di state lokal
                        setCustomersData(prev => [...prev, { ...dbCust, id: "CUST_L_" + Date.now(), last_service: "-", ac_units: 0 }]);
                      } else {
                        setCustomersData(prev => [...prev, upsertCust || { ...dbCust, id: "CUST_" + Date.now() }]);
                        addAgentLog("CUSTOMER_ADDED", "Customer baru: " + newCustomerForm.name, "SUCCESS");
                        showNotif("✅ Customer " + newCustomerForm.name + " berhasil ditambahkan");
                      }
                    } else {
                      setCustomersData(prev => [...prev, savedCust || { ...dbCust, id: "CUST_" + Date.now() }]);
                      addAgentLog("CUSTOMER_ADDED", "Customer baru: " + newCustomerForm.name + " (" + newCustomerForm.area + ")", "SUCCESS");
                      showNotif("✅ Customer " + newCustomerForm.name + " berhasil ditambahkan");
                    }
                  }
                  setModalAddCustomer(false); setNewCustomerForm({ name: "", phone: "", address: "", area: "", notes: "", is_vip: false });
                }}
                  style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                  {selectedCustomer?.id ? "✓ Simpan Perubahan" : "✓ Tambah Customer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ MODAL EDIT ORDER / JADWAL (Owner & Admin) ═══════ */}
      {modalEditOrder && editOrderItem && (
        <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setModalEditOrder(false); setEditOrderItem(null); }}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>✏️ Edit Order — {editOrderItem.id}</div>
                <div style={{ fontSize: 11, color: cs.yellow, marginTop: 2 }}>Hanya Owner &amp; Admin · Perubahan dicatat otomatis</div>
              </div>
              <button onClick={() => { setModalEditOrder(false); setEditOrderItem(null); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              {/* Section: Data Customer */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Data Customer</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {[["Nama Customer", "customer", "text"], ["No. HP", "phone", "text"], ["Alamat Lengkap", "address", "text"], ["Area / Kota", "area", "text"]].map(([lbl, key, type]) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>{lbl}</div>
                      <input type={type} value={editOrderForm[key] || ""} onChange={e => setEditOrderForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Section: Detail Pekerjaan */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Detail Pekerjaan</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Layanan</div>
                    <select value={editOrderForm.service || "Cleaning"} onChange={e => setEditOrderForm(f => ({ ...f, service: e.target.value }))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none" }}>
                      {SERVICE_TYPES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Jumlah Unit</div>
                    <input id="field_number_26" type="number" min="1" max="20" value={editOrderForm.units || 1} onChange={e => setEditOrderForm(f => ({ ...f, units: parseInt(e.target.value) || 1 }))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Tipe AC</div>
                  <select value={editOrderForm.type || ""} onChange={e => setEditOrderForm(f => ({ ...f, type: e.target.value }))}
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none" }}>
                    <option value="">Pilih Tipe...</option>
                    {(priceListData || []).map(p => <option key={p.id || p.type} value={p.type}>{p.type}</option>)}
                  </select>
                </div>
              </div>

              {/* Section: Jadwal &amp; Tim */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>Jadwal &amp; Tim</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Tanggal</div>
                    <input id="field_date_27" type="date" value={editOrderForm.date || ""} onChange={e => setEditOrderForm(f => ({ ...f, date: e.target.value }))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Jam Mulai</div>
                    <input id="field_time_28" type="time" min="09:00" max="17:00" value={editOrderForm.time || "09:00"} onChange={e => setEditOrderForm(f => ({ ...f, time: e.target.value }))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                {editOrderForm.date && editOrderForm.time && (
                  <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "22", borderRadius: 7, padding: "6px 10px", fontSize: 11, color: cs.accent, marginBottom: 8 }}>
                    ⏱ Estimasi selesai: <b>{hitungJamSelesai(editOrderForm.time, editOrderForm.service || "Cleaning", editOrderForm.units || 1)}</b> WIB
                    {" · "}{hitungDurasi(editOrderForm.service || "Cleaning", editOrderForm.units || 1)}j
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Teknisi</div>
                    <select value={editOrderForm.teknisi || ""} onChange={e => setEditOrderForm(f => ({ ...f, teknisi: e.target.value, helper: "" }))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none" }}>
                      <option value="">Pilih Teknisi...</option>
                      {teknisiData.filter(t => t.role === "Teknisi" || t.role === "Helper").map(t =>
                        <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}{cekTeknisiAvailable(t.name, editOrderForm.date || "", editOrderForm.time || "09:00", editOrderForm.service || "Cleaning", editOrderForm.units || 1) ? "" : " (penuh)"}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Helper</div>
                    <select value={editOrderForm.helper || ""} onChange={e => setEditOrderForm(f => ({ ...f, helper: e.target.value }))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none" }}>
                      <option value="">Tidak ada</option>
                      {teknisiData.filter(t => t.status !== "inactive" && t.name !== editOrderForm.teknisi).map(t => {
                        const { pref } = araSchedulingSuggest(editOrderForm.date || "", editOrderForm.service, editOrderForm.units);
                        const roleTag = t.role === "Teknisi" ? " [T]" : t.role === "Helper" ? "" : ` [${t.role}]`;
                        return <option key={t.id} value={t.name}>{pref[editOrderForm.teknisi] === t.name ? "★ " : ""}{t.name}{roleTag}</option>;
                      })}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Tim Tambahan (opsional)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[["Teknisi ke-2", "teknisi2", "Teknisi"], ["Helper ke-2", "helper2", "Helper"], ["Teknisi ke-3", "teknisi3", "Teknisi"], ["Helper ke-3", "helper3", "Helper"]].map(([lbl, key, role]) => (
                      <div key={key}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>{lbl}</div>
                        <select value={editOrderForm[key] || ""} onChange={e => setEditOrderForm(f => ({ ...f, [key]: e.target.value }))}
                          style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none" }}>
                          <option value="">Tidak ada</option>
                          {teknisiData.filter(t => t.status !== "inactive" && t.name !== editOrderForm.teknisi && t.name !== editOrderForm.helper).map(t => {
                            const roleTag = t.role === "Teknisi" ? " [T]" : t.role === "Helper" ? "" : ` [${t.role}]`;
                            return <option key={t.id} value={t.name}>{t.name}{roleTag}</option>;
                          })}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section: Status & Catatan */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Status</div>
                  <select value={editOrderForm.status || "CONFIRMED"} onChange={e => setEditOrderForm(f => ({ ...f, status: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none" }}>
                    {["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING", "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED", "PAID", "COMPLETED", "CANCELLED", "RESCHEDULED"].map(s => (
                      <option key={s} value={s} style={{ color: statusColor[s] || "inherit" }}>{statusLabel[s] || s.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Catatan Perubahan</div>
                  <input id="field_29" value={editOrderForm.notes || ""} onChange={e => setEditOrderForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Alasan perubahan..." style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                <button onClick={() => { setModalEditOrder(false); setEditOrderItem(null); }} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Batal</button>
                <button onClick={async () => {
                  // GAP-1 & GAP-2: Cek ketersediaan teknisi di DB sebelum simpan edit
                  const tekChanged = editOrderForm.teknisi !== editOrderItem.teknisi;
                  const dateChanged = editOrderForm.date !== editOrderItem.date;
                  const timeChanged = editOrderForm.time !== editOrderItem.time;
                  if (editOrderForm.teknisi && (tekChanged || dateChanged || timeChanged)) {
                    const dbCheck = await cekTeknisiAvailableDB(
                      editOrderForm.teknisi, editOrderForm.date || editOrderItem.date,
                      editOrderForm.time || editOrderItem.time || "09:00",
                      editOrderForm.service || editOrderItem.service || "Cleaning",
                      editOrderForm.units || editOrderItem.units || 1
                    );
                    // Exclude order yang sedang diedit dari conflict check
                    if (!dbCheck.ok && !dbCheck.reason?.includes(editOrderItem.id)) {
                      showNotif("⚠️ " + (dbCheck.reason || editOrderForm.teknisi + " tidak tersedia di jadwal tersebut"));
                      return;
                    }
                  }
                  const timeEnd = hitungJamSelesai(editOrderForm.time || "09:00", editOrderForm.service || "Cleaning", editOrderForm.units || 1);
                  const updated = { ...editOrderItem, ...editOrderForm, time_end: timeEnd };
                  setOrdersData(prev => prev.map(o => o.id === editOrderItem.id ? updated : o));
                  const dbUpd = { customer: editOrderForm.customer, phone: editOrderForm.phone, address: editOrderForm.address, area: editOrderForm.area || "", service: editOrderForm.service, type: editOrderForm.type || "", units: editOrderForm.units, teknisi: editOrderForm.teknisi, helper: editOrderForm.helper || null, teknisi2: editOrderForm.teknisi2 || null, helper2: editOrderForm.helper2 || null, teknisi3: editOrderForm.teknisi3 || null, helper3: editOrderForm.helper3 || null, date: editOrderForm.date, time: editOrderForm.time, time_end: timeEnd, status: editOrderForm.status, notes: editOrderForm.notes || "" };
                  const { error: eoErr } = await updateOrder(supabase, editOrderItem.id, dbUpd, auditUserName());
                  // ── GAP-10 FIX: Hapus schedule lama & insert baru setelah edit order ──
                  if (!eoErr) {
                    // Hapus schedule lama — gunakan try/catch, bukan .catch() langsung
                    try {
                      await supabase.from("technician_schedule").delete().eq("order_id", editOrderItem.id);
                    } catch (e) { /* schedule tabel opsional, skip jika belum ada */ }
                    if (editOrderForm.teknisi && editOrderForm.date) {
                      const timeEnd2 = hitungJamSelesai(editOrderForm.time || "09:00", editOrderForm.service || "Cleaning", editOrderForm.units || 1);
                      try {
                        await supabase.from("technician_schedule").insert({
                          order_id: editOrderItem.id,
                          teknisi: editOrderForm.teknisi,
                          date: editOrderForm.date,
                          time_start: editOrderForm.time || "09:00",
                          time_end: timeEnd2,
                          status: "ACTIVE",
                        });
                        addAgentLog("SCHEDULE_SYNCED", `Schedule diupdate untuk ${editOrderItem.id} setelah edit`, "SUCCESS");
                      } catch (e) { /* skip */ }
                    }
                  }
                  if (eoErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal: " + eoErr.message);
                  else {
                    addAgentLog("ORDER_UPDATED", `Order ${editOrderItem.id} diedit — ${editOrderForm.teknisi} ${editOrderForm.date} ${editOrderForm.time}`, "SUCCESS");
                    const tek = teknisiData.find(t => t.name === editOrderForm.teknisi);
                    if (tek && (editOrderForm.teknisi !== editOrderItem.teknisi || editOrderForm.date !== editOrderItem.date || editOrderForm.time !== editOrderItem.time)) {
                      sendWA(tek.phone, `Halo ${editOrderForm.teknisi}, ada *perubahan jadwal*:\n📋 ${editOrderItem.id} — ${editOrderForm.customer || editOrderItem.customer}\n🔧 ${editOrderForm.service} ${editOrderForm.units} unit\n📅 ${editOrderForm.date} jam ${editOrderForm.time}–${timeEnd}\n📍 ${editOrderForm.address || editOrderItem.address}\n${editOrderForm.notes ? "📝 " + editOrderForm.notes + "\n" : ""}Mohon konfirmasi. — AClean`);
                    }
                    showNotif("✅ Order " + editOrderItem.id + " berhasil diupdate");
                  }
                  setModalEditOrder(false); setEditOrderItem(null);
                }} style={{ background: "linear-gradient(135deg," + cs.yellow + ",#d97706)", border: "none", color: "#0a0f1e", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                  ✓ Simpan Semua Perubahan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ MODAL EDIT / DETAIL LAPORAN ═══════ */}
      {modalLaporanDetail && selectedLaporan && (
        <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setModalLaporanDetail(false); setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); }}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: isMobile ? "16px 16px 0 0" : 20, width: "100%", maxWidth: isMobile ? "100%" : 640, maxHeight: "90vh", overflowY: "auto", padding: 28 }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{editLaporanMode ? "Edit Laporan" : "Detail Laporan"}</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{selectedLaporan.job_id} — {selectedLaporan.customer}</div>
              </div>
              <button onClick={() => { setModalLaporanDetail(false); setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>x</button>
            </div>

            {editLaporanMode ? (
              /* EDIT MODE — FULL FORM */
              <div style={{ display: "grid", gap: 14 }}>
                {/* Photo Re-Upload Option */}
                <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px", display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <input type="checkbox" id="editPhotoCheck" checked={editPhotoMode} onChange={e => { setEditPhotoMode(e.target.checked); if (!e.target.checked) setEditLaporanFotos([]); }}
                      style={{ marginTop: 2, cursor: "pointer", width: 18, height: 18, accentColor: cs.accent }} />
                    <label htmlFor="editPhotoCheck" style={{ fontSize: 12, color: cs.text, cursor: "pointer", flex: 1 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>📸 Input Ulang Foto</div>
                      <div style={{ fontSize: 11, color: cs.muted }}>
                        {editPhotoMode
                          ? "Foto lama akan dihapus & diganti dengan foto baru"
                          : "Foto tetap sama, hanya data yang diedit"}
                      </div>
                    </label>
                  </div>
                  {editPhotoMode && (
                    <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "10px", fontSize: 11, color: cs.accent }}>
                      ⚠️ Pilih foto baru di bawah. Foto lama akan dihapus saat save.
                    </div>
                  )}
                </div>

                {/* ══ UBAH JENIS LAYANAN — Owner/Admin only ══ */}
                {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                  <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px", display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent }}>
                      🔄 Jenis Layanan
                    </div>
                    <select value={editLaporanForm.editService || selectedLaporan?.service}
                      onChange={e => setEditLaporanForm(f => ({ ...f, editService: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }}>
                      {["Cleaning", "Install", "Repair", "Complain", "Maintenance"].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {editLaporanForm.editService && editLaporanForm.editService !== selectedLaporan?.service && (
                      <div style={{ fontSize: 10, color: cs.yellow, background: cs.yellow + "15", border: "1px solid " + cs.yellow + "33", borderRadius: 6, padding: "6px 8px" }}>
                        ⚠️ Layanan akan diubah dari <b>{selectedLaporan?.service}</b> ke <b>{editLaporanForm.editService}</b>.
                        {editLaporanForm.editService === "Complain" && " Invoice akan di-recalculate sebagai Complain (Rp 0 jika garansi aktif)."}
                      </div>
                    )}
                  </div>
                )}

                {/* ══ REPAIR/COMPLAIN TYPE SELECTOR ══ */}
                {((editLaporanForm.editService || selectedLaporan?.service) === "Repair" || (editLaporanForm.editService || selectedLaporan?.service) === "Complain") && (
                  <div style={{ background: cs.surface, border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: "12px", display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow }}>
                      💵 Tipe Layanan — {selectedLaporan?.service}
                    </div>
                    <select value={editRepairType} onChange={e => setEditRepairType(e.target.value)}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }}>
                      <option value="berbayar">💰 Berbayar (Standard)</option>
                      <option value="gratis-garansi">🎁 Gratis - Garansi Aktif</option>
                      <option value="gratis-customer">🎁 Gratis - Arrangement Customer</option>
                    </select>
                    {editRepairType !== "berbayar" && (
                      <input
                        placeholder="Alasan gratis (wajib diisi)..."
                        value={editGratisAlasan}
                        onChange={e => setEditGratisAlasan(e.target.value)}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.yellow + "44", borderRadius: 8, padding: "7px 10px", color: cs.text, fontSize: 11, outline: "none" }} />
                    )}
                    <div style={{ fontSize: 10, color: cs.muted }}>
                      {editRepairType === "berbayar" && "Invoice akan dihitung normal dari material + jasa."}
                      {editRepairType !== "berbayar" && "Invoice Rp 0 akan langsung dicatat LUNAS. Tidak dikirim ke customer."}
                    </div>
                  </div>
                )}

                {/* UNIT TABS */}
                {(editLaporanForm.editUnits || []).length > 1 && (
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, borderBottom: "1px solid " + cs.border }}>
                    {(editLaporanForm.editUnits || []).map((_, idx) => (
                      <button key={idx} onClick={() => setActiveEditUnitIdx(idx)}
                        style={{ padding: "8px 12px", borderRadius: 7, background: activeEditUnitIdx === idx ? cs.accent : cs.card, color: activeEditUnitIdx === idx ? "#fff" : cs.text, border: "1px solid " + (activeEditUnitIdx === idx ? cs.accent : cs.border), cursor: "pointer", fontSize: 12, fontWeight: activeEditUnitIdx === idx ? 700 : 500, whiteSpace: "nowrap" }}>
                        Unit {idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                {/* PER-UNIT FORM */}
                {editLaporanForm.editUnits && editLaporanForm.editUnits[activeEditUnitIdx] && (() => {
                  const u = editLaporanForm.editUnits[activeEditUnitIdx];
                  const updateU = (field, val) => setEditLaporanForm(f => { const units = [...f.editUnits]; units[activeEditUnitIdx] = { ...u, [field]: val }; return { ...f, editUnits: units }; });
                  const toggleUArr = (field, val) => { const arr = u[field] || []; updateU(field, arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]); };
                  return (
                    <div style={{ background: cs.card, borderRadius: 10, border: "1px solid " + cs.border, padding: "14px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Tipe AC</div>
                          <select value={u.tipe || ""} onChange={e => updateU("tipe", e.target.value)} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none" }}>
                            <option value="">Pilih...</option>
                            {TIPE_AC_OPT.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Merk</div>
                          <input type="text" value={u.merk || ""} onChange={e => updateU("merk", e.target.value)} placeholder="Daikin..." style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>PK</div>
                          <input type="text" value={u.pk || ""} onChange={e => updateU("pk", e.target.value)} placeholder="0.5, 1, 1.5..." style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                        </div>
                      </div>

                      {/* Kondisi Sebelum */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Kondisi Sebelum</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {KONDISI_SBL.map(k => (
                            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                              <input type="checkbox" checked={(u.kondisi_sebelum || []).includes(k)} onChange={() => toggleUArr("kondisi_sebelum", k)} style={{ cursor: "pointer" }} />
                              <span style={{ fontSize: 11, color: cs.text }}>{k}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Pekerjaan */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Pekerjaan Dilakukan</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {PEKERJAAN_OPT(selectedLaporan.service || "Cleaning").map(p => (
                            <label key={p} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                              <input type="checkbox" checked={(u.pekerjaan || []).includes(p)} onChange={() => toggleUArr("pekerjaan", p)} style={{ cursor: "pointer" }} />
                              <span style={{ fontSize: 11, color: cs.text }}>{p}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Kondisi Sesudah */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Kondisi Sesudah</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {KONDISI_SDH.map(k => (
                            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                              <input type="checkbox" checked={(u.kondisi_setelah || []).includes(k)} onChange={() => toggleUArr("kondisi_setelah", k)} style={{ cursor: "pointer" }} />
                              <span style={{ fontSize: 11, color: cs.text }}>{k}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Freon & Ampere */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Tekanan Freon (psi)</div>
                          <input type="number" value={u.freon_ditambah || ""} onChange={e => updateU("freon_ditambah", e.target.value)} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Ampere Akhir (A)</div>
                          <input type="number" value={u.ampere_akhir || ""} onChange={e => updateU("ampere_akhir", e.target.value)} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                        </div>
                      </div>

                      {/* Catatan Unit */}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Catatan Unit</div>
                        <textarea value={u.catatan_unit || ""} onChange={e => updateU("catatan_unit", e.target.value)} rows={2} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }} />
                      </div>
                    </div>
                  );
                })()}

                {/* ══ INSTALL ITEMS FORM (Edit Mode) ══ */}
                {selectedLaporan?.service === "Install" && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: cs.accent, textTransform: "uppercase", letterSpacing: "0.5px" }}>🔧 Detail Pekerjaan Instalasi</div>
                    {INSTALL_ITEMS.map(item => (
                      <div key={item.key} style={{
                        display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                        background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "08" : cs.card,
                        border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "44" : cs.border),
                        borderRadius: 8, padding: "8px 10px"
                      }}>
                        <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                          {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                        </div>
                        <input type="number" min="0" step={item.satuan === "Meter" || item.satuan === "KG" ? "0.5" : "1"}
                          value={laporanInstallItems[item.key] ?? ""}
                          onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                          placeholder="0"
                          style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                      </div>
                    ))}
                  </div>
                )}

                {/* JASA SECTION (non-Install only) */}
                {selectedLaporan?.service !== "Install" && (() => {
                  // Include: category="Jasa", OR category starts with "freon", OR service matches laporan
                  const jasaLookup = priceListData
                    .filter(r => {
                      if (parseInt(r.price || 0) <= 0) return false; // exclude zero price
                      if (r.category === "Jasa") return true; // standard jasa category
                      const cat = (r.category || "").toLowerCase();
                      if (cat.startsWith("freon")) return true; // freon_R22, freon_R32, freon_R410
                      if (r.service === selectedLaporan?.service) return true; // items dari laporan service
                      return false;
                    })
                    .map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }))
                    .filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i)
                    .slice(0, 100);
                  return (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>⚡ Jasa / Layanan ({(editLaporanForm.editJasaItems || []).length})</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {(editLaporanForm.editJasaItems || []).map((j, ji) => (
                          <div key={j.id || ji} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6, alignItems: "center", background: cs.card, padding: "10px", borderRadius: 7 }}>
                            <select value={j.nama || ""} onChange={e => { const jasa = jasaLookup.find(x => x.nama === e.target.value); setEditLaporanForm(f => ({ ...f, editJasaItems: f.editJasaItems.map((x, i) => i === ji ? { ...x, nama: e.target.value, satuan: jasa?.satuan || "pcs", harga_satuan: jasa?.harga || 0 } : x) })); }} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }}>
                              <option value="">Pilih Jasa...</option>
                              {jasaLookup.map(jl => <option key={jl.nama} value={jl.nama}>{jl.nama}</option>)}
                            </select>
                            <input type="number" value={j.jumlah || 1} onChange={e => setEditLaporanForm(f => ({ ...f, editJasaItems: f.editJasaItems.map((x, i) => i === ji ? { ...x, jumlah: parseInt(e.target.value) || 1 } : x) }))} placeholder="Qty" style={{ width: "60px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                            <button onClick={() => setEditLaporanForm(f => ({ ...f, editJasaItems: f.editJasaItems.filter((_, i) => i !== ji) }))} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🗑️</button>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setEditLaporanForm(f => ({ ...f, editJasaItems: [...(f.editJasaItems || []), { id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", harga_satuan: 0, keterangan: "jasa" }] }))} style={{ marginTop: 8, background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent, padding: "8px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Tambah Jasa</button>
                    </div>
                  );
                })()}

                {/* MATERIAL SECTION (non-Install only) */}
                {selectedLaporan?.service !== "Install" && (() => {
                  const matLookup = [...inventoryData.map(r => ({ nama: r.name, satuan: r.unit || "pcs" })), ...priceListData.filter(r => r.service === "Material").map(r => ({ nama: r.type, satuan: r.unit || "pcs" }))].filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i);
                  return (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>🔧 Material Terpakai ({(editLaporanForm.editMatItems || []).length}/20)</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {(editLaporanForm.editMatItems || []).map((m, mi) => (
                          <div key={m.id || mi} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 6, alignItems: "center", background: cs.card, padding: "10px", borderRadius: 7 }}>
                            <input list="matOpts" value={m.nama || ""} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, nama: e.target.value } : x) }))} placeholder="Nama material" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                            <datalist id="matOpts">
                              {matLookup.map(ml => <option key={ml.nama} value={ml.nama} />)}
                            </datalist>
                            <input type="number" value={m.jumlah || ""} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, jumlah: e.target.value } : x) }))} placeholder="Qty" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                            <select value={m.satuan || "pcs"} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, satuan: e.target.value } : x) }))} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }}>
                              {SATUAN_OPT.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <input type="text" value={m.keterangan || ""} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, keterangan: e.target.value } : x) }))} placeholder="Ket" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                            <button onClick={() => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.filter((_, i) => i !== mi) }))} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🗑️</button>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setEditLaporanForm(f => ({ ...f, editMatItems: [...(f.editMatItems || []), { id: Date.now(), nama: "", jumlah: "", satuan: "pcs", keterangan: "" }] }))} style={{ marginTop: 8, background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent, padding: "8px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Tambah Material</button>
                    </div>
                  );
                })()}

                {/* REKOMENDASI & CATATAN */}
                {[["Rekomendasi", "rekomendasi"], ["Catatan Tambahan", "catatan_global"]].map(([lbl, key]) => (
                  <div key={key}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>{lbl}</div>
                    <textarea value={editLaporanForm[key] || ""} onChange={e => setEditLaporanForm(f => ({ ...f, [key]: e.target.value }))} rows={3} style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
                  </div>
                ))}

                {/* PHOTO RE-UPLOAD SECTION */}
                {editPhotoMode && (
                  <div style={{ background: cs.card, border: "2px solid " + cs.accent + "44", borderRadius: 10, padding: "14px", display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>📸 Pilih Foto Baru</div>
                    <input type="file" multiple accept="image/*"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        const newFotos = [];
                        for (const file of files) {
                          const url = URL.createObjectURL(file);
                          newFotos.push({ id: Date.now() + Math.random(), label: file.name, file: file, url: url, uploaded: false });
                        }
                        setEditLaporanFotos([...editLaporanFotos, ...newFotos]);
                      }}
                      style={{ padding: "10px", background: cs.surface, border: "1px dashed " + cs.accent + "66", borderRadius: 8, cursor: "pointer", fontSize: 12 }} />

                    {editLaporanFotos.length > 0 && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 11, color: cs.muted }}>Foto dipilih: {editLaporanFotos.length}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))", gap: 8 }}>
                          {editLaporanFotos.map((f) => (
                            <div key={f.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid " + cs.border }}>
                              <img src={f.url} style={{ width: "100%", height: 80, objectFit: "cover" }} alt={f.label} />
                              <button onClick={() => setEditLaporanFotos(editLaporanFotos.filter(x => x.id !== f.id))}
                                style={{ position: "absolute", top: 2, right: 2, background: cs.red, color: "#fff", border: "none", borderRadius: "50%", width: 24, height: 24, padding: 0, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* BUTTONS */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                  <button onClick={() => { setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); }} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Batal</button>
                  <button onClick={async () => {
                    const now = new Date().toLocaleString("id-ID", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-");
                    const newService = editLaporanForm.editService || selectedLaporan.service;
                    const serviceChanged = newService !== selectedLaporan.service;
                    const changeDesc = serviceChanged
                      ? `Service changed ${selectedLaporan.service} → ${newService}, unit & material edited`
                      : "Admin edited unit & material details";
                    const newLogs = [{ by: currentUser?.name || "?", at: now, field: serviceChanged ? "service+units+materials" : "units+materials", old: serviceChanged ? selectedLaporan.service : "previous", new: changeDesc }];
                    const allLogs = [...safeArr(selectedLaporan.editLog), ...newLogs];
                    const newStatus = selectedLaporan.status === "REVISION" ? "SUBMITTED" : selectedLaporan.status;

                    // Recombine jasa + barang + material items
                    const combinedMats = [
                      ...(editLaporanForm.editJasaItems || []).map(j => ({ ...j, keterangan: "jasa" })),
                      ...(laporanBarangItems || []).filter(b => b.nama).map(b => ({ ...b, keterangan: "barang" })),
                      ...(editLaporanForm.editMatItems || [])
                    ];

                    const updatePayload = { status: newStatus, service: newService, catatan_global: editLaporanForm.catatan_global || "", rekomendasi: editLaporanForm.rekomendasi || "", units_json: JSON.stringify(editLaporanForm.editUnits || []), materials_json: JSON.stringify(combinedMats), edit_log: JSON.stringify(allLogs) };

                    // ✨ NEW: Handle photo re-upload option
                    if (editPhotoMode && editLaporanFotos.length > 0) {
                      // Upload new photos to R2 and get URLs
                      const uploadedUrls = [];
                      for (const foto of editLaporanFotos.filter(f => f.file)) {
                        try {
                          const base64 = await new Promise((res, rej) => {
                            const reader = new FileReader();
                            reader.onload = e => res(e.target.result);
                            reader.onerror = rej;
                            reader.readAsDataURL(foto.file);
                          });
                          const uploadRes = await fetch("/api/upload-foto", {
                            method: "POST",
                            headers: await _apiHeaders(),
                            body: JSON.stringify({ base64, filename: foto.file.name || `foto_${Date.now()}.jpg`, reportId: selectedLaporan.job_id, mimeType: foto.file.type || "image/jpeg" }),
                          });
                          if (uploadRes.ok) {
                            const uploadData = await uploadRes.json();
                            if (uploadData.url) uploadedUrls.push(uploadData.url);
                          }
                        } catch (uploadErr) {
                          console.warn("Photo upload failed:", uploadErr.message);
                        }
                      }
                      // Also include blob URLs that are already uploaded (from file selection display)
                      const existingUrls = editLaporanFotos.filter(f => !f.file && f.url).map(f => f.url);
                      if (uploadedUrls.length > 0 || existingUrls.length > 0) {
                        updatePayload.foto_urls = [...uploadedUrls, ...existingUrls]; // Replace old fotos with new ones
                      }
                    }
                    // If editPhotoMode = false, skip foto_urls → keep old photos
                    const { error: elErr } = await updateServiceReport(supabase, selectedLaporan.id, updatePayload, auditUserName());
                    if (elErr) { console.warn("❌ update service_reports failed:", elErr.message, "payload:", updatePayload); addAgentLog("LAPORAN_UPDATE_ERROR", `Laporan ${selectedLaporan.job_id} update error: ${elErr.message.slice(0, 100)}`, "WARNING"); }

                    // Update local state
                    setLaporanReports(prev => prev.map(r => r.id === selectedLaporan.id ? { ...r, service: newService, rekomendasi: editLaporanForm.rekomendasi, catatan_global: editLaporanForm.catatan_global, units: editLaporanForm.editUnits, materials: combinedMats, status: newStatus, editLog: allLogs } : r));
                    if (serviceChanged) selectedLaporan.service = newService;

                    if (!elErr) {
                      // Rule: admin edit = sumber invoice paling benar → regenerate invoice jika ada
                      const existInv = invoicesData.find(i => i.job_id === selectedLaporan.job_id);
                      if (existInv) {
                        const ord = ordersData.find(o => o.id === selectedLaporan.job_id);
                        const vMats = combinedMats.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
                        const vMDetail = vMats.map(m => {
                          const nama2 = (m.nama || "").toLowerCase();
                          const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
                          const rawQ = parseFloat(m.jumlah) || 0;
                          const qty = isF ? Math.max(1, Math.ceil(rawQ)) : rawQ;
                          // ✨ PHASE 2: Use unified lookupHargaGlobal instead of inline lookup
                          let hSat = parseFloat(m.harga_satuan) || 0;
                          if (!hSat) {
                            hSat = lookupHargaGlobal(m.nama, m.satuan);
                          }
                          return { nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: hSat, subtotal: hSat * qty, keterangan: m.keterangan || "" };
                        });

                        // Inject service fee jika tidak ada jasa row — per-unit dari Card 1/4 tipe
                        if (!vMDetail.some(m => m.keterangan === "jasa")) {
                          const editUnits = editLaporanForm.editUnits || [];
                          const unitsWithTipe = editUnits.filter(u => u && u.tipe);
                          if (unitsWithTipe.length > 0) {
                            unitsWithTipe.forEach((u) => {
                              const hargaUnit = hargaPerUnitFromTipe(selectedLaporan.service, u.tipe, priceListData);
                              if (hargaUnit > 0) {
                                const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
                                const bracketLabel = getBracketKey(selectedLaporan.service, u.tipe) || u.tipe;
                                vMDetail.unshift({
                                  nama: selectedLaporan.service + " " + bracketLabel + " (" + unitLabel + ")",
                                  jumlah: 1, satuan: "unit",
                                  harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
                                });
                              }
                            });
                          } else {
                            const svcFee = hitungLabor(selectedLaporan.service, ord?.type, editLaporanForm.editUnits?.length || selectedLaporan.total_units || 1);
                            if (svcFee > 0) {
                              const uCount = Math.max(1, editLaporanForm.editUnits?.length || selectedLaporan.total_units || 1);
                              vMDetail.unshift({ nama: selectedLaporan.service + (ord?.type ? " - " + ord.type : "") + " (Servis)", jumlah: uCount, satuan: "unit", harga_satuan: Math.round(svcFee / uCount), subtotal: svcFee, keterangan: "jasa" });
                            }
                          }
                        }

                        const laborV = vMDetail.filter(m => m.keterangan === "jasa").reduce((s, m) => s + m.subtotal, 0) || hitungLabor(selectedLaporan.service, ord?.type, editLaporanForm.editUnits?.length || selectedLaporan.total_units || 1);
                        const matV = vMDetail.filter(m => m.keterangan !== "jasa").reduce((s, m) => s + m.subtotal, 0);

                        // ✨ FIX #3: Add garansi logic ke edit handler
                        const todayInv3 = new Date().toISOString().slice(0, 10);
                        const isComplainSvc3 = selectedLaporan.service === "Complain";

                        let finalLabor3 = laborV;
                        let finalMat3 = matV;
                        let finalTotal3 = laborV + matV;
                        let newInvoiceStatus3 = existInv.status === "PAID" ? "PAID" : "PENDING_APPROVAL";

                        if (isComplainSvc3) {
                          const prevGaransiActive3 = invoicesData.filter(inv =>
                            inv.customer === selectedLaporan.customer && inv.service !== "Complain" &&
                            inv.garansi_expires && inv.garansi_expires >= todayInv3 &&
                            ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
                          ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;

                          if (prevGaransiActive3) {
                            finalLabor3 = 0;
                            finalTotal3 = finalMat3;
                            newInvoiceStatus3 = finalTotal3 === 0 ? "PAID" : "PENDING_APPROVAL";
                          }
                        }

                        // ✨ NEW: Admin edit repair type selector → override repair_gratis
                        const isEditGratis = editRepairType === "gratis-garansi" || editRepairType === "gratis-customer";
                        const newRepairGratis = isEditGratis ? editRepairType : (existInv?.repair_gratis || undefined);

                        // If admin explicitly chose gratis → override status to PAID
                        if (isEditGratis && finalTotal3 === 0) {
                          newInvoiceStatus3 = "PAID";
                          const alasan = editGratisAlasan.trim() || "(tidak ada alasan)";
                          addAgentLog("ADMIN_EDIT_GRATIS_APPROVED",
                            `Invoice ${existInv.id} | Customer: ${existInv.customer || "-"} | diedit ke GRATIS (${editRepairType}) oleh ${currentUser?.name}. Alasan: ${alasan}`,
                            "WARNING");
                        }

                        const totalInv = finalTotal3;

                        // Delete old invoice + insert new (preserve PAID status via garansi check)
                        const { error: delInvErr } = await deleteInvoice(supabase, existInv.id, auditUserName(), "ADMIN_EDIT_GRATIS");
                        if (!delInvErr) {
                          const newInv = {
                            ...existInv,
                            service: newService,
                            materials_detail: JSON.stringify(vMDetail),
                            labor: finalLabor3, material: finalMat3, total: totalInv,
                            status: newInvoiceStatus3,
                            repair_gratis: newRepairGratis,
                            updated_at: new Date().toISOString(),
                          };
                          delete newInv.id;
                          const { error: insertErr } = await insertInvoice(supabase, { ...newInv, id: existInv.id });
                          if (!insertErr) {
                            setInvoicesData(prev => [...prev.filter(i => i.id !== existInv.id), { ...newInv, id: existInv.id }]);
                            addAgentLog("INVOICE_REGEN", `Invoice ${existInv.id} diupdate dari edit laporan oleh ${currentUser?.name}`, "SUCCESS");
                            showNotif(`✅ Laporan + Invoice ${existInv.id} diperbarui dari data admin`);
                          }
                        }
                      }
                    }

                    const photoMsg = editPhotoMode && editLaporanFotos.length > 0 ? "+foto" : "";
                    const svcMsg = serviceChanged ? ` [${selectedLaporan.service}]` : "";
                    addAgentLog("LAPORAN_EDITED", `Laporan ${selectedLaporan.job_id} diedit oleh ${currentUser?.name}${serviceChanged ? ` (service: ${selectedLaporan.service})` : ""} ${photoMsg ? '(+foto)' : ''}`, "SUCCESS");
                    showNotif(`✅ Laporan ${selectedLaporan.job_id} diupdate${svcMsg} (unit+material+catatan${photoMsg ? '+foto' : ''})`);
                    setModalLaporanDetail(false); setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]);
                  }} style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                    ✓ Simpan Semua Perubahan
                  </button>
                </div>
              </div>
            ) : (
              /* VIEW MODE — support multi-unit (baru) & legacy (lama) */
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px", fontSize: 12 }}>
                  <div><span style={{ color: cs.muted }}>Job ID: </span><span style={{ fontFamily: "monospace", color: cs.accent, fontWeight: 700 }}>{selectedLaporan.job_id}</span></div>
                  <div><span style={{ color: cs.muted }}>Tanggal: </span><span style={{ color: cs.text }}>{selectedLaporan.date}</span></div>
                  <div><span style={{ color: cs.muted }}>Customer: </span><span style={{ color: cs.text, fontWeight: 600 }}>{selectedLaporan.customer}</span></div>
                  <div><span style={{ color: cs.muted }}>Layanan: </span><span style={{ color: cs.text }}>{selectedLaporan.service}</span></div>
                  <div><span style={{ color: cs.muted }}>Teknisi: </span><span style={{ color: cs.accent, fontWeight: 700 }}>{selectedLaporan.teknisi}</span></div>
                  {selectedLaporan.helper && <div><span style={{ color: cs.muted }}>Helper: </span><span style={{ color: cs.text }}>{selectedLaporan.helper}</span></div>}
                </div>

                {/* Multi-unit display (struktur baru) */}
                {(selectedLaporan.units || []).length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {(selectedLaporan.units || []).map((u, ui) => (
                      <div key={ui} style={{ background: cs.card, borderRadius: 10, padding: 14, fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 8 }}>Unit {u.unit_no} — {u.label} {u.merk ? `(${u.merk})` : ""}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                          {(u.kondisi_sebelum || []).map((k, ki) => <span key={ki} style={{ background: cs.yellow + "18", color: cs.yellow, fontSize: 10, padding: "2px 8px", borderRadius: 99 }}>{k}</span>)}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                          {(u.pekerjaan || []).map((p, pi) => <span key={pi} style={{ background: cs.accent + "18", color: cs.accent, fontSize: 10, padding: "2px 8px", borderRadius: 99 }}>{p}</span>)}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                          {(u.kondisi_setelah || []).map((k, ki) => <span key={ki} style={{ background: cs.green + "18", color: cs.green, fontSize: 10, padding: "2px 8px", borderRadius: 99 }}>{k}</span>)}
                        </div>
                        {(u.ampere_akhir || parseFloat(u.freon_ditambah) > 0) && (
                          <div style={{ fontSize: 11, color: cs.muted }}>
                            {u.ampere_akhir ? `Ampere: ${u.ampere_akhir}A` : ""}
                            {u.ampere_akhir && parseFloat(u.freon_ditambah) > 0 ? " · " : ""}
                            {parseFloat(u.freon_ditambah) > 0 ? `Tekanan: ${u.freon_ditambah} psi` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Legacy struktur lama (flat) */
                  <div style={{ background: cs.card, borderRadius: 10, padding: 14, fontSize: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                      <div><div style={{ color: cs.muted, fontSize: 11, marginBottom: 4 }}>Kondisi Sebelum</div><div style={{ color: cs.yellow, fontWeight: 600 }}>{typeof selectedLaporan.kondisi_sebelum === "string" ? selectedLaporan.kondisi_sebelum : (selectedLaporan.kondisi_sebelum || []).join(", ")}</div></div>
                      <div><div style={{ color: cs.muted, fontSize: 11, marginBottom: 4 }}>Kondisi Sesudah</div><div style={{ color: cs.green, fontWeight: 600 }}>{typeof selectedLaporan.kondisi_setelah === "string" ? selectedLaporan.kondisi_setelah : (selectedLaporan.kondisi_setelah || []).join(", ")}</div></div>
                    </div>
                    {(selectedLaporan.pekerjaan || []).length > 0 && (
                      <div style={{ marginBottom: 8 }}><span style={{ color: cs.muted, fontSize: 11 }}>Pekerjaan: </span>{(selectedLaporan.pekerjaan || []).map((p, pi) => <span key={pi} style={{ background: cs.accent + "18", color: cs.accent, fontSize: 10, padding: "2px 8px", borderRadius: 99, marginRight: 4 }}>{p}</span>)}</div>
                    )}
                  </div>
                )}

                {/* Material terpakai */}
                {(selectedLaporan.materials || []).length > 0 && (
                  <div style={{ background: cs.card, borderRadius: 10, padding: "10px 14px", fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: cs.muted, marginBottom: 6 }}>🔧 Material</div>
                    {(selectedLaporan.materials || []).map((m, mi) => (
                      <div key={mi} style={{ color: cs.muted, marginBottom: 2 }}>• {m.nama}: {m.jumlah} {m.satuan}</div>
                    ))}
                  </div>
                )}

                {selectedLaporan.rekomendasi && <div style={{ fontSize: 11, marginBottom: 4 }}><span style={{ color: cs.muted }}>Rekomendasi: </span><span style={{ color: cs.text }}>{selectedLaporan.rekomendasi}</span></div>}
                {(selectedLaporan.catatan_global || selectedLaporan.catatan) && <div style={{ fontSize: 11 }}><span style={{ color: cs.muted }}>Catatan: </span><span style={{ color: cs.text }}>{selectedLaporan.catatan_global || selectedLaporan.catatan}</span></div>}

                {/* ── Preview Service Report Card (Owner/Admin only) ── */}
                {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button onClick={() => {
                      const relInv = invoicesData.find(i => i.job_id === selectedLaporan.job_id) || {};
                      downloadServiceReportPDF(selectedLaporan, relInv);
                    }} style={{ flex: 1, background: "#1e3a5f", border: "none", color: "#fff", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      📋 Preview Report Card
                    </button>
                  </div>
                )}

                {safeArr(selectedLaporan.editLog).length > 0 && (
                  <div style={{ background: cs.yellow + "08", border: "1px solid " + cs.yellow + "22", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 8 }}>Riwayat Edit ({safeArr(selectedLaporan.editLog).length}x)</div>
                    {safeArr(selectedLaporan.editLog).map((log, li) => (
                      <div key={li} style={{ fontSize: 11, color: cs.muted, marginBottom: 5, paddingBottom: 5, borderBottom: li < safeArr(selectedLaporan.editLog).length - 1 ? "1px solid " + cs.border : "none" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                          <span style={{ background: cs.accent + "18", color: cs.accent, fontWeight: 700, padding: "1px 8px", borderRadius: 99, fontSize: 10 }}>{log.by}</span>
                          <span style={{ color: cs.muted }}>{log.at}</span>
                          <span>ubah field <b style={{ color: cs.text }}>{log.field}</b></span>
                        </div>
                        <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                          <span style={{ color: cs.red, textDecoration: "line-through" }}>{String(log.old).slice(0, 60)}</span>
                          <span style={{ color: cs.muted }}>→</span>
                          <span style={{ color: cs.green, fontWeight: 600 }}>{String(log.new).slice(0, 60)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MODAL LAPORAN TEKNISI v3 — Multi-Unit, Multi-Material, Foto
      ═══════════════════════════════════════════════════════ */}
      {laporanModal && !laporanSubmitted && (() => {
        const incompleteUnits = laporanUnits.filter(u => !isUnitDone(u));
        const totalFreon = laporanUnits.reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0);
        const presets = MATERIAL_PRESET[laporanModal?.service] || MATERIAL_PRESET.Cleaning;
        const isInstallJob = laporanModal?.service === "Install";
        const STEP_LABELS = ["", "Konfirmasi Unit",
          isInstallJob ? "(skip)" : "Detail Per Unit",
          isInstallJob ? "Form Instalasi" : "Material & Foto",
          "Submit"];

        const updateUnit = (idx, updated) => setLaporanUnits(prev => prev.map((u, i) => i === idx ? updated : u));
        const toggleArr = (arr, val) => arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];

        const handleFotoUpload = async (e) => {
          const MAX_PHOTOS = 20;
          const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

          // ── Validasi format file — reject video ──
          const rawFiles = Array.from(e.target.files || []);
          const invalidFiles = rawFiles.filter(f => !ALLOWED_TYPES.includes(f.type));

          if (invalidFiles.length > 0) {
            showNotif(`❌ Format tidak didukung: ${invalidFiles.map(f => f.name.split(".").pop().toUpperCase()).join(", ")}. Hanya JPG, PNG, WEBP.`);
            e.target.value = "";
            return;
          }

          // ── Cek max 20 foto ──
          if (laporanFotos.length >= MAX_PHOTOS) {
            showNotif(`❌ Maksimal ${MAX_PHOTOS} foto per job. Hapus foto lain untuk upload baru.`);
            e.target.value = "";
            return;
          }

          const validFiles = rawFiles.slice(0, MAX_PHOTOS - laporanFotos.length);
          if (validFiles.length === 0) return;
          const reportId = laporanModal?.id || "tmp";

          // ── LAYER 1: Hash setiap file SEBELUM compress ──
          // Fungsi hash SHA-256 sederhana via SubtleCrypto (tersedia di semua browser modern)
          const hashFile = async (file) => {
            const buf = await file.arrayBuffer();
            const hashBuf = await crypto.subtle.digest("SHA-256", buf);
            return Array.from(new Uint8Array(hashBuf))
              .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16); // 16 char = cukup unik
          };

          // Hitung hash semua file sebelum compress
          const fileHashes = await Promise.all(validFiles.map(hashFile));

          // ── Get compression quality dari settings (default 0.70) ──
          const fotoQualityValue = parseFloat(appSettings?.foto_compression_quality) || 0.70;
          const fotoQuality = Math.max(0.3, Math.min(1, fotoQualityValue)); // Clamp: 30% - 100%

          // ── LAYER 2: Cek duplikat vs foto yang sudah ada di state (per sesi) ──
          const existingHashes = new Set(laporanFotos.map(f => f.hash).filter(Boolean));
          const files = [];
          const hashes = [];
          let skippedCount = 0;
          validFiles.forEach((file, i) => {
            if (existingHashes.has(fileHashes[i])) {
              skippedCount++;
            } else {
              files.push(file);
              hashes.push(fileHashes[i]);
            }
          });

          if (skippedCount > 0) {
            showNotif(`⚠️ ${skippedCount} foto sudah ada (duplikat diabaikan).`);
          }
          if (files.length === 0) { e.target.value = ""; return; }

          showNotif(`⏳ Mengkompresi & upload ${files.length} foto ke R2 (quality: ${Math.round(fotoQuality * 100)}%)...`);
          let compressed = [];
          try {
            compressed = await Promise.all(files.map(f => compressImg(f, fotoQuality)));
          } catch (compErr) {
            console.error("[COMPRESS_ERROR]", compErr.message);
            showNotif(`❌ Gagal kompresi foto: ${compErr.message}. Pastikan file adalah gambar valid.`);
            e.target.value = "";
            return;
          }

          // ✨ FIX #1: Parallel upload dengan batch 3 (3-5x lebih cepat)
          //   - Foto placeholder langsung muncul dengan flag `uploading:true`
          //   - Tombol "Next" di Step 3 di-gate selama ada yang `uploading`
          //   - Upload batch 3 concurrent → balance speed vs bandwidth HP teknisi
          const BATCH_SIZE = 3;
          const placeholders = compressed.map((dataUrl, i) => ({
            id: Date.now() + i,
            label: `Foto ${laporanFotos.length + i + 1}`,
            data_url: dataUrl,
            url: null,
            errMsg: "",
            hash: hashes[i],
            uploading: true,
          }));
          // Push placeholders ke state supaya user lihat progress langsung
          setLaporanFotos(prev => [...prev, ...placeholders]);

          const uploadOne = async (ph) => {
            try {
              const r = await fetch("/api/upload-foto", {
                method: "POST",
                headers: await _apiHeaders(),
                body: JSON.stringify({
                  base64: ph.data_url,
                  filename: `${ph.hash}.jpg`,
                  reportId,
                  mimeType: "image/jpeg",
                  hash: ph.hash,
                  currentUserRole: currentUser?.role || "Unknown",
                }),
              });
              const d = await r.json();
              if (d.success && d.url) {
                return { id: ph.id, url: d.url, errMsg: "", uploading: false };
              }
              return { id: ph.id, url: null, errMsg: d.error || "Upload gagal", uploading: false };
            } catch (err) {
              return { id: ph.id, url: null, errMsg: err.message || "Network error", uploading: false };
            }
          };

          let savedCount = 0, failedCount = 0;
          for (let i = 0; i < placeholders.length; i += BATCH_SIZE) {
            const batch = placeholders.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(uploadOne));
            // Update state incremental per-batch
            setLaporanFotos(prev => prev.map(foto => {
              const res = results.find(r => r.id === foto.id);
              return res ? { ...foto, ...res } : foto;
            }));
            results.forEach(r => r.url ? savedCount++ : failedCount++);
          }

          if (savedCount === placeholders.length) {
            showNotif(`✅ ${savedCount} foto tersimpan di R2!`);
          } else if (savedCount > 0) {
            showNotif(`⚠️ ${savedCount} berhasil, ${failedCount} gagal. Tap ⏳ untuk retry.`);
          } else {
            showNotif(`❌ Upload gagal. Cek koneksi & coba lagi.`);
          }
          e.target.value = "";
        };

        const submitLaporan = async () => {
          if (submitLaporan._running) { showNotif("⏳ Sedang submit, harap tunggu..."); return; }
          submitLaporan._running = true;
          try {
          // ── 1. Definisikan isInstall PERTAMA sebelum digunakan ──
          const isInstall = laporanModal?.service === "Install";

          // ── 2. Validasi unit untuk non-Install ──
          if (!isInstall && incompleteUnits.length > 0) {
            showNotif(`${incompleteUnits.length} unit belum diisi pekerjaan!`);
            return;
          }

          // ── 3. Cek foto gagal upload ──
          const fotoGagal = laporanFotos.filter(f => !f.url).length;
          if (fotoGagal > 0) {
            const lanjut = await showConfirm({
              icon: "⚠️", title: "Ada Foto Belum Tersimpan",
              message: `${fotoGagal} foto belum tersimpan ke cloud (ditandai ⏳).\n\nLanjutkan submit laporan tanpa foto tersebut?`,
              confirmText: "Lanjutkan Submit"
            });
            if (!lanjut) return;
          }

          // ── 4. Siapkan materials yang efektif ──
          // Install: pakai laporanInstallItems, lainnya: pakai laporanMaterials
          // Only jasa items here — barang items are now consolidated into laporanBarangItems
          const jasaAsMaterials = [
            ...laporanJasaItems.map(j => ({
              id: "jasa_" + j.id, nama: j.nama, jumlah: j.jumlah || 1,
              satuan: j.satuan || "pcs", harga_satuan: j.harga_satuan || 0, keterangan: "jasa"
            })),
          ];
          // Mapping INSTALL_ITEMS key → inventory code untuk deduct stok spesifik
          const INSTALL_INV_MAP = {
            "pipa_1pk": "SKU022",  // Pipa AC Hoda 1PK
            "pipa_2pk": "SKU023",  // Pipa AC Hoda 2PK
            "pipa_25pk": "SKU024",  // Pipa AC Hoda 2,5PK
            "pipa_3pk": "SKU057",  // Pipa AC Hoda 3PK
            "kabel_15": "SKU025",  // Kabel Eterna 3x1,5
            "kabel_25": "SKU026",  // Kabel Eterna 3x2,5
            "ducttape_biasa": "SKU031",
            "ducttape_lem": "SKU030",
            "dinabolt": "SKU058",
            "karet_mounting": "SKU059",
            "breket_outdoor": "SKU041",
          };

          // ✨ CHANGE: tambah laporanBarangItems ke effectiveMaterials dengan keterangan="barang"
          const barangAsMaterials = laporanBarangItems
            .filter(b => b.nama)
            .map(b => ({
              id: b.id,
              nama: b.nama,
              jumlah: b.jumlah || 1,
              satuan: b.satuan || "pcs",
              harga_satuan: b.harga_satuan || 0,
              subtotal: (b.harga_satuan || 0) * (b.jumlah || 1),
              keterangan: "barang" // marking barang dari price_list, bukan material stok
            }));

          const effectiveMaterials = isInstall
            ? INSTALL_ITEMS
              .filter(item => parseFloat(laporanInstallItems[item.key] || 0) > 0)
              .map(item => {
                const hargaSat = lookupHargaGlobal(item.label, item.satuan);
                const qty = parseFloat(laporanInstallItems[item.key] || 0);
                return {
                  id: item.key, nama: item.label, jumlah: qty, satuan: item.satuan,
                  harga_satuan: hargaSat, subtotal: hargaSat * qty, keterangan: "",
                  // _useCode: untuk deduct stok by kode inventori yang spesifik
                  _useCode: INSTALL_INV_MAP[item.key] || null,
                };
              })
            : [...jasaAsMaterials, ...barangAsMaterials, ...laporanMaterials];

          const now = new Date().toLocaleString("id-ID", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit"
          });
          const totalFreonLocal = laporanUnits.reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0);

          // ── 5. Buat objek laporan ──
          const newReport = {
            id: laporanModal._rewriteId || ("LPR_" + laporanModal.id + "_" + Date.now().toString(36).slice(-4).toUpperCase()),
            job_id: laporanModal.id,
            teknisi: laporanModal.teknisi,
            helper: laporanModal.helper || null,
            is_substitute: (currentUser?.role === "Helper" &&
              currentUser?.name === laporanModal.helper &&
              !teknisiData.find(t => t.role === "Teknisi" && t.name === laporanModal.helper)),
            customer: laporanModal.customer,
            service: laporanModal?.service,
            date: laporanModal.date,
            submitted: now,
            status: "SUBMITTED",
            total_units: laporanUnits.length,
            units: laporanUnits,
            materials: effectiveMaterials,
            fotos: laporanFotos.map(f => ({ id: f.id, label: f.label })),
            total_freon: totalFreonLocal,
            rekomendasi: laporanRekomendasi,
            catatan_global: laporanCatatan,
            unit_mismatch: laporanUnits.length !== (laporanModal.units || 1),
            editLog: laporanModal._rewriteId ? [{
              by: currentUser?.name || "Teknisi",
              at: new Date().toLocaleString("id-ID"),
              field: "full_rewrite",
              old: "(laporan lama)",
              new: "Laporan ditulis ulang dari awal",
            }] : [],
          };

          setLaporanReports(prev => [...prev.filter(r => r.job_id !== laporanModal.id), newReport]);

          // ── 6. WA notif ke Admin/Owner ──
          const adminUsers = userAccounts.filter(u => u.role === "Admin" || u.role === "Owner");
          const matCount = isInstall
            ? INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).length
            : laporanMaterials.length;
          const notifMsg =
            "Laporan Selesai\nJob: " + laporanModal.id
            + "\nCustomer: " + laporanModal.customer
            + "\nTeknisi: " + laporanModal.teknisi + (laporanModal.helper ? " + " + laporanModal.helper : "")
            + "\nLayanan: " + laporanModal?.service + " - " + laporanUnits.length + " unit"
            + "\nMaterial: " + matCount + " item  Foto: " + laporanFotos.filter(f => f.url).length + " foto"
            + "\n\nSilakan cek invoice di menu Invoice.";
          adminUsers.forEach(u => { if (u.phone) sendWA(u.phone, notifMsg); });

          // ── 7. Simpan laporan ke Supabase (multi-attempt with fallback fields) ──
          showNotif("⏳ Menyimpan laporan ke server...");
          // ✨ DEDUP: hapus ghost rows dgn job_id yg sama tapi id berbeda (prevent double laporan)
          try {
            await supabase.from("service_reports")
              .delete()
              .eq("job_id", newReport.job_id)
              .neq("id", newReport.id);
          } catch (dx) { console.warn("[LAPORAN_DEDUP] cleanup ghost rows failed:", dx.message); }
          const basePayload = {
            id: newReport.id,
            job_id: newReport.job_id,
            teknisi: newReport.teknisi,
            helper: newReport.helper || null,
            customer: newReport.customer,
            service: newReport.service,
            date: newReport.date,
            status: "SUBMITTED",
            total_units: newReport.total_units,
            total_freon: newReport.total_freon,
            submitted_at: new Date().toISOString(),
            foto_urls: laporanFotos.filter(f => f.url).map(f => f.url) || [],
            rekomendasi: newReport.rekomendasi || "",
            catatan_global: newReport.catatan_global || "",
            submitted: new Date().toLocaleString("id-ID"),
          };

          let savedOk = false;
          let lastError = null;
          { // Attempt 1: dengan materials_json & units_json & units (jsonb)
            try {
              const { error: e1 } = await supabase.from("service_reports").upsert({
                ...basePayload,
                materials_json: JSON.stringify(effectiveMaterials),
                units_json: JSON.stringify(laporanUnits),
                units: laporanUnits,
              }, { onConflict: "id" });
              if (!e1) { savedOk = true; }
              else { lastError = e1; console.warn("❌ Attempt 1 failed:", e1.message); }
            } catch (ex) { lastError = ex; console.warn("❌ Attempt 1 error:", ex.message); }
          }
          if (!savedOk) { // Attempt 2: dengan units_json & materials_json (skip units jsonb)
            try {
              const { error: e2 } = await supabase.from("service_reports").upsert({
                ...basePayload,
                units_json: JSON.stringify(laporanUnits),
                materials_json: JSON.stringify(effectiveMaterials),
              }, { onConflict: "id" });
              if (!e2) { savedOk = true; }
              else { lastError = e2; console.warn("❌ Attempt 2 failed:", e2.message); }
            } catch (ex) { lastError = ex; console.warn("❌ Attempt 2 error:", ex.message); }
          }
          if (!savedOk) { // Attempt 3: minimal
            try {
              const { error: e3 } = await supabase.from("service_reports").upsert({
                id: newReport.id, job_id: newReport.job_id,
                teknisi: newReport.teknisi, customer: newReport.customer,
                service: newReport.service, date: newReport.date,
                status: "SUBMITTED", total_units: newReport.total_units,
                submitted_at: new Date().toISOString(),
              }, { onConflict: "id" });
              if (!e3) { savedOk = true; }
              else { lastError = e3; console.warn("❌ Attempt 3 failed:", e3.message); }
            } catch (ex) { lastError = ex; console.warn("❌ Attempt 3 error:", ex.message); }
          }

          // Fallback: If upsert failed, explicitly DELETE old laporan (if rewriting) then try INSERT
          if (!savedOk && laporanModal._rewriteId) {
            console.warn("🔄 Upsert failed, trying DELETE + INSERT fallback for rewrite:", newReport.id);
            try {
              // First, try to delete the old laporan
              await supabase.from("service_reports").delete().eq("id", newReport.id).select();
              // Then insert the new one
              const { error: insertErr } = await supabase.from("service_reports").insert(basePayload).select().single();
              if (!insertErr) {
                savedOk = true;
                } else {
                lastError = insertErr;
                console.error("❌ DELETE+INSERT fallback failed:", insertErr.message);
              }
            } catch (fx) {
              lastError = fx;
              console.error("❌ Fallback error:", fx.message);
            }
          }

          // Final error handling
          if (!savedOk) {
            const errMsg = lastError?.message || "Unknown error";
            console.error("❌ All save attempts failed:", errMsg);
            showNotif("❌ Gagal simpan laporan: " + errMsg + ". Coba lagi atau hubungi admin.");
            return; // Don't proceed to reload/notify if save failed
          }

          // ── 8. Reload laporan (backup, realtime juga akan trigger) ──
          const reloadLaporan = async () => {
            const { data } = await supabase.from("service_reports")
              .select("*").order("submitted_at", { ascending: false });
            if (data?.length > 0) {
              setLaporanReports(data.map(r => ({
                ...r,
                units: r.units_json ? (() => { try { return JSON.parse(r.units_json); } catch (_) { return r.units || []; } })() : (r.units || []),
                materials: r.materials_json ? (() => { try { return JSON.parse(r.materials_json); } catch (_) { return r.materials_used || []; } })() : (r.materials_used || []),
                fotos: r.fotos || (r.foto_urls || []).map((url, i) => ({ id: i, label: `Foto ${i + 1}`, url })),
                editLog: safeArr(r.edit_log ?? r.editLog),
              })));
            }
          };
          setTimeout(reloadLaporan, 800);
          setTimeout(reloadLaporan, 3000);

          // ── 9. Update order status ──
          setOrdersData(prev => prev.map(o =>
            o.id === laporanModal.id ? { ...o, status: "REPORT_SUBMITTED" } : o
          ));
          {
            const { error: ordErr } = await supabase.from("orders")
              .update({ status: "REPORT_SUBMITTED" }).eq("id", laporanModal.id);
            if (ordErr) {
              console.warn("REPORT_SUBMITTED rejected — fallback COMPLETED:", ordErr.message);
              await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName());
            }
          }

          // ── 10. Update status teknisi & helper → active ──
          ["teknisi", "helper"].forEach(role => {
            const name = role === "teknisi" ? laporanModal.teknisi : laporanModal.helper;
            if (!name) return;
            const tek = teknisiData.find(t => t.name === name);
            if (!tek?.id) return;
            setTeknisiData(prev => prev.map(t => t.name === name ? { ...t, status: "active" } : t));
            if (/^[0-9a-f-]{36}$/.test(tek.id)) {
              supabase.from("user_profiles").update({ status: "active" }).eq("id", tek.id);
            }
          });

          // ── 10b. Notif WA ke helper — laporan otomatis tercatat atas namanya ──
          if (laporanModal.helper && currentUser?.name !== laporanModal.helper) {
            const helperData = teknisiData.find(t => t.name === laporanModal.helper);
            if (helperData?.phone) {
              sendWA(helperData.phone,
                `✅ *Laporan ${laporanModal.id} Selesai*\n`
                + `Customer: ${laporanModal.customer}\n`
                + `Teknisi: ${laporanModal.teknisi}\n\n`
                + `Laporan pekerjaan sudah disubmit oleh ${currentUser?.name || laporanModal.teknisi}. `
                + `Kamu tercatat sebagai helper. Cek di menu Laporan Saya. — AClean`
              );
            }
          }

          // ── 11. Deduct stok material (non-Install) ──
          // Install: deduct dari effectiveMaterials (sudah punya _useCode untuk pipa/kabel)
          // Non-install: deduct dari laporanMaterials + laporanBarangItems (billable items dari price_list)
          const barangAsDeducts = laporanBarangItems.filter(b => b.nama && parseFloat(b.jumlah || 0) > 0)
            .map(b => ({
              nama: b.nama,
              jumlah: parseFloat(b.jumlah) || 1,
              satuan: b.satuan || "pcs",
              keterangan: "barang"
            }));
          const materialsToDeduct = isInstall ? effectiveMaterials : [...laporanMaterials, ...barangAsDeducts];

          // Deduct unit fisik: freon (tabung spesifik), pipa (roll), kabel (roll)
          // freon_tabung_code = UUID dari inventory_units yang dipilih teknisi
          // freon_inv_code    = inventory.code milik unit itu (untuk update stok di DB)
          const unitDeducts = laporanMaterials
            .filter(mat => mat.freon_tabung_code && parseFloat(mat.jumlah) > 0)
            .map(mat => {
              const unit = invUnitsData.find(u => u.id === mat.freon_tabung_code);
              if (!unit) return null;
              return {
                nama: unit.unit_label,    // label unit fisik, e.g. "Roll 1PK-A"
                jumlah: parseFloat(mat.jumlah),
                satuan: mat.satuan || "",
                keterangan: "unit_fisik",
                _useCode: unit.inventory_code,  // untuk deduct inventory parent
                _unitId: unit.id,              // untuk update inventory_units.stock
                _unitLabel: unit.unit_label,
              };
            }).filter(Boolean);

          // Deduct inventory_units.stock untuk setiap unit fisik yang dipakai
          for (const ud of unitDeducts) {
            const unit = invUnitsData.find(u => u.id === ud._unitId);
            if (!unit) continue;
            const newStock = Math.max(0, unit.stock - ud.jumlah);
            // Update local state inventory_units
            setInvUnitsData(prev => prev.map(u => u.id === ud._unitId
              ? { ...u, stock: newStock }
              : u
            ));
            // Update DB inventory_units
            supabase.from("inventory_units").update({
              stock: newStock,
              updated_at: new Date().toISOString()
            }).eq("id", ud._unitId).then(({ error }) => {
              if (error) console.warn("inv_units update err:", error.message);
            });
          }

          // Material tanpa unit fisik → deduct via inventory biasa (by nama)
          const matWithoutUnit = materialsToDeduct.filter(mat => !mat.freon_tabung_code);
          const allToDeduct = [...matWithoutUnit, ...unitDeducts];

          if (allToDeduct.length > 0) {
            deductInventory(
              allToDeduct,
              laporanModal?.id || null,        // orderId
              null,                            // reportId
              laporanModal?.customer || null,  // customerName
              laporanModal?.teknisi || null,  // teknisiName
              laporanModal?.date || null   // jobDate
            );
            // Cek stok kritis setelah deduct (dari inventoryData state yg sudah diupdate deductInventory)
            setTimeout(() => {
              const kritisItems = inventoryData.filter(i =>
                allToDeduct.some(m => m._useCode ? m._useCode === i.code
                  : i.name.toLowerCase().includes((m.nama || "").toLowerCase())) &&
                (i.status === "CRITICAL" || i.status === "OUT")
              );
              if (kritisItems.length > 0) {
                const warnings = kritisItems.map(i => `${i.name} sisa ${i.stock} ${i.unit}`);
                showNotif("⚠️ Stok kritis: " + warnings.join(", "));
                const ownerAccs = userAccounts.filter(u => u.role === "Owner");
                const lowMsg = `⚠️ *Stok Material Kritis*\nSetelah job ${laporanModal.id}:\n`
                  + warnings.map(w => "• " + w).join("\n");
                ownerAccs.forEach(u => { if (u.phone) sendWA(u.phone, lowMsg); });
              }
            }, 800);
          }

          // ── 12. Auto-generate invoice ──
          // Hitung labor & material — harga freon dari inventory DULU, fallback PRICE_LIST
          // Untuk Install: labor = 0 karena semua jasa sudah masuk INSTALL_ITEMS → materials_detail
          // Untuk service lain: hitung dari PRICE_LIST
          const isInstallSvc = laporanModal.service === "Install";
          const jasaNamesSet2 = new Set(
            priceListData.filter(r => r.service !== "Material").map(r => r.type && r.type.trim())
          );
          const repairNamesInMat = new Set(laporanRepairItems.map(r => r.nama));
          const jasaFromMat = laporanMaterials.filter(m =>
            m.nama && jasaNamesSet2.has(m.nama.trim())
          );
          const matOnly = laporanMaterials.filter(m =>
            m.nama && !jasaNamesSet2.has(m.nama.trim()) &&
            !repairNamesInMat.has(m.nama) && parseFloat(m.jumlah || 0) > 0
          );
          // ✨ NEW: Cleaning-in-Repair — hitung total tambahan cleaning saat job Repair
          const cleaningInRepairTotal = (laporanModal?.service === "Repair" && Array.isArray(laporanCleaningInRepair) && laporanCleaningInRepair.length > 0)
            ? (laporanUnits || [])
              .filter(u => u && u.tipe && laporanCleaningInRepair.includes(u.unit_no))
              .reduce((s, u) => s + hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData), 0)
            : 0;

          const laborTotalInv = isInstallSvc ? 0 : (() => {
            const svc = laporanModal?.service;
            const jasaSumForm = laporanJasaItems.filter(j => j.nama)
              .reduce((s, j) => s + ((j.harga_satuan || 0) * (parseFloat(j.jumlah) || 1)), 0);

            // Base labor per service type:
            // - Cleaning/Maintenance: service fee baseline per-unit dari Card 1/4 tipe PK
            // - Repair: NO baseline — hanya dari form jasa + cleaning-in-repair
            // - Complain: handle via garansi logic (skip baseline)
            const isCleaningMaint = svc === "Cleaning" || svc === "Maintenance";
            // Skip baseline hanya jika jasa items sudah mengandung cleaning/maintenance jasa.
            // Bug lama: transport/biaya-cek jadi jasa → baseline Cleaning ke-skip → total = transport saja.
            const hasCleaningJasa = laporanJasaItems.some(j => {
              const n = (j.nama || "").toLowerCase();
              return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
            });
            let svcFeeBaseline = 0;
            if (isCleaningMaint && !hasCleaningJasa) {
              const unitsWithTipe = (laporanUnits || []).filter(u => u && u.tipe);
              svcFeeBaseline = unitsWithTipe.length > 0
                ? unitsWithTipe.reduce((s, u) => s + hargaPerUnitFromTipe(svc, u.tipe, priceListData), 0)
                : hitungLabor(svc, laporanModal.type, laporanUnits.length);
            }

            return svcFeeBaseline + jasaSumForm + cleaningInRepairTotal;
          })();
          // ✨ CHANGE: matTotalInv dari laporanBarangItems (price_list category=Barang), bukan dari laporanMaterials
          const barangTotalInv = laporanBarangItems
            .filter(b => b.nama)
            .reduce((s, b) => s + ((b.harga_satuan || 0) * (b.jumlah || 1)), 0);
          const matTotalInv = isInstallSvc
            ? hitungMaterialTotal(effectiveMaterials)
            : barangTotalInv; // gunakan barangTotal, bukan material total
          const invoiceTotal = laborTotalInv + matTotalInv;
          const todayInv = new Date().toISOString().slice(0, 10);
          const isComplainSvc = laporanModal.service === "Complain";
          const isZeroTotal = invoiceTotal === 0;

          // ── GARANSI CHECK: selalu cek untuk Complain, terlepas dari total ──
          // Cek apakah customer punya garansi AKTIF (belum expired)
          const prevGaransiActive = isComplainSvc
            ? invoicesData
              .filter(inv =>
                inv.customer === laporanModal.customer &&
                inv.service !== "Complain" &&
                inv.garansi_expires &&
                inv.garansi_expires >= todayInv &&
                ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
              )
              .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
            : null;

          // Cek garansi EXPIRED (pernah punya garansi tapi sudah habis)
          const prevGaransiExpired = isComplainSvc && !prevGaransiActive
            ? invoicesData
              .filter(inv =>
                inv.customer === laporanModal.customer &&
                inv.service !== "Complain" &&
                inv.garansi_expires &&
                inv.garansi_expires < todayInv &&
                ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
              )
              .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
            : null;

          const BIAYA_CEK = (() => {
            const pl = priceListData.find(r => r.service === "Repair" && r.type === "Biaya Pengecekan AC");
            return (pl && pl.price > 0) ? pl.price : 100000;
          })();

          // ── FINAL LABOR/TOTAL untuk Complain ──────────────────────────────
          // Garansi AKTIF → jasa gratis (labor=0), material tetap dicharge
          // Garansi EXPIRED + tidak ada input → biaya cek 100rb
          // Tidak ada garansi + tidak ada input → biaya cek 100rb
          // Ada input jasa/material → harga normal (garansi hanya cover jasa)
          const noGaransiComplain = isComplainSvc && !prevGaransiActive && !prevGaransiExpired;
          let finalLabor = laborTotalInv;
          let finalTotal = invoiceTotal;

          // ✨ FIX #1 (CORRECTED): Repair service tanpa items → conditional BIAYA_CEK based on repair type
          const isRepairServiceNoItems = laporanModal?.service === "Repair" &&
            laporanBarangItems.filter(b => b.nama).length === 0 &&
            laporanJasaItems.filter(j => j.nama).length === 0 &&
            laporanMaterials.filter(m => m.nama).length === 0 &&
            cleaningInRepairTotal === 0;
          let isRepairGratis = false;

          if (isRepairServiceNoItems) {
            // If teknisi selected "Berbayar" (standard paid repair) → inject BIAYA_CEK
            if (laporanRepairType === "berbayar" && (!finalLabor || finalLabor === 0)) {
              finalLabor = BIAYA_CEK;
              finalTotal = BIAYA_CEK;
              addAgentLog("REPAIR_BIAYA_CEK_INJECTED", `Repair ${laporanModal.id} (berbayar) tanpa items → inject BIAYA_CEK ${BIAYA_CEK}`, "INFO");
            }
            // If teknisi selected "Gratis" (garansi atau customer arrangement) → allow Rp 0
            else if ((laporanRepairType === "gratis-garansi" || laporanRepairType === "gratis-customer") && invoiceTotal === 0) {
              isRepairGratis = true;
              finalLabor = 0;
              finalTotal = 0;
              const alasan = laporanRepairType === "gratis-garansi" ? "garansi aktif" : "arrangement customer";
              addAgentLog("REPAIR_GRATIS_CREATED", `Repair ${laporanModal.id} (${alasan}) tanpa items/material → invoice Rp 0, awaiting approval`, "INFO");
            }
          }

          if (isComplainSvc) {
            if (prevGaransiActive) {
              // Garansi aktif: jasa gratis, material tetap bayar
              finalLabor = 0;
              finalTotal = matTotalInv; // hanya material
            } else if (isZeroTotal) {
              // Tidak ada garansi aktif DAN teknisi tidak input apapun → biaya cek
              finalLabor = BIAYA_CEK;
              finalTotal = BIAYA_CEK;
            }
            // Jika ada input (isZeroTotal=false) tapi garansi expired/no-garansi → harga normal
          }

          if (isComplainSvc && prevGaransiActive && finalTotal === 0) {
            // SKIP invoice — dalam garansi
            setOrdersData(prev => prev.map(o =>
              o.id === laporanModal.id ? { ...o, status: "COMPLETED" } : o
            ));
            try { await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName()); } catch (_) { }
            addAgentLog("GARANSI_SKIP_INVOICE",
              `Complain ${laporanModal.id} — dalam garansi s/d ${prevGaransiActive.garansi_expires} ` +
              `(ref: ${prevGaransiActive.id}) → invoice di-skip`, "SUCCESS");

          } else {
            // BUAT invoice
            const invSeq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
            const invId = "INV-" + todayInv.replace(/-/g, "").slice(0, 8) + "-" + invSeq;
            const gDays = 30; // Semua service: garansi 30 hari dari terbit invoice
            const gExpires = new Date(Date.now() + gDays * 86400000).toISOString().slice(0, 10);

            // ── BUILD mDetail — BREAKDOWN 1-1, SINGLE SOURCE OF TRUTH ──────────────
            // Helper: lookup harga dari inventory/pricelist jika tidak ada di item
            const lookupHarga = (nama, satuanHint) => lookupHargaGlobal(nama, satuanHint);
            const mkRow = (nama, jumlah, satuan, hSat, ket) => {
              const nama2 = (nama || "").toLowerCase();
              const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
              const rawQ = parseFloat(jumlah) || 0;
              const qty = isF ? Math.max(1, Math.ceil(rawQ)) : rawQ;
              const h = parseFloat(hSat) || 0 || lookupHarga(nama, satuan);
              const ketFin = ket || (isF && rawQ !== qty ? `Aktual: ${rawQ} kg → dibulatkan ${qty} kg` : "");
              return { nama, jumlah: qty, satuan: satuan || (isF ? "kg" : "pcs"), harga_satuan: h, subtotal: h * qty, keterangan: ketFin };
            };

            const mDetail = [];

            // A. Jasa rows (dari [+] Tambah Jasa form) — keterangan: "jasa"
            laporanJasaItems.filter(j => j.nama && j.nama !== "__manual__" && parseFloat(j.jumlah || 0) > 0).forEach(j => {
              mDetail.push(mkRow(j.nama, j.jumlah || 1, j.satuan || "pcs", j.harga_satuan || 0, "jasa"));
            });

            // B. Repair rows (dari [+] Tambah Repair form) — keterangan: "repair"
            laporanRepairItems.filter(r => r.nama && parseFloat(r.jumlah || 0) > 0).forEach(r => {
              mDetail.push(mkRow(r.nama, r.jumlah || 1, r.satuan || "pcs", r.harga_satuan || 0, "repair"));
            });

            // C. Material rows (dari [+] Tambah Material / Preset) — keterangan: "" atau freon label
            laporanMaterials.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0).forEach(m => {
              mDetail.push(mkRow(m.nama, m.jumlah, m.satuan || "pcs", m.harga_satuan || 0, m.keterangan || ""));
            });

            // D. Install rows — build dari laporanInstallItems dengan keterangan yang benar
            if (isInstallSvc) {
              mDetail.length = 0;
              // Jasa Install (pasang, vacum, kuras) → keterangan:"jasa"
              const INSTALL_JASA_KEYS = ["pasang", "vacum", "bongkar", "kuras"];
              effectiveMaterials.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0).forEach(m => {
                const n = (m.nama || "").toLowerCase();
                const isJasa = INSTALL_JASA_KEYS.some(k => n.includes(k));
                const isFreon = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => n.includes(k));
                const ket = m.keterangan || (isJasa ? "jasa" : isFreon ? "freon" : "");
                mDetail.push(mkRow(m.nama, m.jumlah, m.satuan || "pcs", m.harga_satuan || 0, ket));
              });
            }

            // E. AUTO-INJECT per-service (planning final 2026-04-14):
            //    - Cleaning/Maintenance: inject per-unit dari Card 1/4 tipe PK (base labor)
            //    - Repair: NO auto-inject base. Inject "Biaya Pengecekan" jika card 3/4 kosong.
            //             Checkbox "Cleaning in Repair" → inject Cleaning rows untuk unit yg dicentang.
            //    - Install: semua dari Card 3/4 (handled di branch D di atas)
            //    - Complain: inject biaya cek hanya jika tanpa-garansi & finalLabor > 0
            if (!isInstallSvc) {
              const svc = laporanModal?.service;
              const hasRepairItems = mDetail.some(m => m.keterangan === "repair");
              const isRepairSvc = svc === "Repair";
              const isComplainSvc2 = svc === "Complain";
              const isCleaningOrMaint = svc === "Cleaning" || svc === "Maintenance";

              // ── Cleaning & Maintenance: per-unit base labor dari Card 1/4 tipe ──
              // Skip hanya jika mDetail sudah ada row jasa cleaning/maintenance/cuci.
              // Bug lama: transport jasa bikin baseline ter-skip → laporan Cleaning hilang.
              const alreadyHasCleaningRow = mDetail.some(m => {
                if (m.keterangan !== "jasa") return false;
                const n = (m.nama || "").toLowerCase();
                return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
              });
              if (isCleaningOrMaint && !alreadyHasCleaningRow) {
                const unitsWithTipe = (laporanUnits || []).filter(u => u && u.tipe);
                if (unitsWithTipe.length > 0) {
                  [...unitsWithTipe].reverse().forEach((u) => {
                    const hargaUnit = hargaPerUnitFromTipe(svc, u.tipe, priceListData);
                    if (hargaUnit > 0) {
                      const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
                      const bracketLabel = getBracketKey(svc, u.tipe) || u.tipe;
                      const namaJasa = (svc || "") + " " + bracketLabel + " (" + unitLabel + ")";
                      mDetail.unshift({
                        nama: namaJasa, jumlah: 1, satuan: "unit",
                        harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
                      });
                    }
                  });
                } else {
                  const svcFee = hitungLabor(svc, laporanModal.type, laporanUnits.length);
                  if (svcFee > 0) {
                    const unitCount = laporanUnits.length || 1;
                    const hPerUnit = Math.round(svcFee / unitCount);
                    [...laporanUnits].reverse().forEach((u, idx) => {
                      const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || (unitCount - idx)));
                      const namaJasa = (svc || "") + (laporanModal.type ? " - " + laporanModal.type : "") + " (" + unitLabel + ")";
                      mDetail.unshift({ nama: namaJasa, jumlah: 1, satuan: "unit", harga_satuan: hPerUnit, subtotal: hPerUnit, keterangan: "jasa" });
                    });
                  }
                }
              }

              // ── Cleaning 1 unit: inject "Biaya Transport Bila 1 Unit" otomatis ──
              if (svc === "Cleaning" && (laporanUnits || []).length === 1) {
                const transportItem = priceListData.find(
                  r => r.service === "Cleaning" && r.type === "Biaya Transport Bila 1 Unit" && r.is_active !== false
                );
                if (transportItem && transportItem.price > 0) {
                  mDetail.push({
                    nama: "Biaya Transport Bila 1 Unit", jumlah: 1, satuan: "unit",
                    harga_satuan: transportItem.price, subtotal: transportItem.price, keterangan: "jasa"
                  });
                }
              }

              // ── Repair: Cleaning-in-Repair checkbox → append per unit yg dicentang ──
              if (isRepairSvc && Array.isArray(laporanCleaningInRepair) && laporanCleaningInRepair.length > 0) {
                const checkedUnits = (laporanUnits || []).filter(u => u && u.tipe && laporanCleaningInRepair.includes(u.unit_no));
                checkedUnits.forEach((u) => {
                  const hargaUnit = hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData);
                  if (hargaUnit > 0) {
                    const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
                    const bracketLabel = getBracketKey("Cleaning", u.tipe) || u.tipe;
                    mDetail.push({
                      nama: "Cleaning " + bracketLabel + " (" + unitLabel + ") [+Repair]",
                      jumlah: 1, satuan: "unit",
                      harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
                    });
                  }
                });
              }

              // ── Repair tanpa items: inject "Biaya Pengecekan" ──
              if (isRepairSvc && !hasRepairItems && !mDetail.some(m => m.keterangan === "jasa") && finalLabor > 0) {
                mDetail.unshift({ nama: "Biaya Pengecekan AC", jumlah: 1, satuan: "unit", harga_satuan: finalLabor, subtotal: finalLabor, keterangan: "jasa" });
              }

              // ── Complain biaya cek: inject dari finalLabor (tanpa garansi) ──
              if (isComplainSvc2 && finalLabor > 0 && finalLabor <= 200000 && !mDetail.some(m => m.keterangan === "jasa")) {
                mDetail.unshift({ nama: "Biaya Pengecekan (Tanpa Garansi)", jumlah: 1, satuan: "unit", harga_satuan: finalLabor, subtotal: finalLabor, keterangan: "jasa" });
              }
            }

            // garansi_status: hanya untuk state lokal (tidak ada kolom ini di DB)
            const garansiStatusLocal = isComplainSvc
              ? (prevGaransiActive ? (matTotalInv > 0 ? 'GARANSI_DENGAN_MATERIAL' : 'GARANSI_AKTIF')
                : prevGaransiExpired ? 'GARANSI_EXPIRED' : 'NO_GARANSI')
              : null;
            // Recalculate total dari mDetail (menangkap inject transport fee dll yang bisa merubah total)
            const finalTotalFromDetail = mDetail.reduce((s, r) => s + (r.subtotal || 0), 0);
            const newInvoice = {
              id: invId, job_id: laporanModal.id,
              customer: laporanModal.customer,
              phone: laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone || "",
              service: laporanModal.service + (laporanModal.type ? " - " + laporanModal.type : ""),
              units: laporanUnits.length,
              labor: finalLabor,
              material: matTotalInv,
              materials_detail: mDetail,           // array untuk state/display
              garansi_status: garansiStatusLocal,  // hanya state, tidak ke DB
              repair_gratis: isRepairGratis ? laporanRepairType : undefined,  // NEW: store repair type (gratis-garansi/gratis-customer)
              dadakan: 0,
              total: finalTotalFromDetail || finalTotal,
              status: "PENDING_APPROVAL",
              garansi_days: gDays,
              garansi_expires: gExpires,
              created_at: new Date().toISOString(),
            };

            // Status override
            if (isRepairGratis && finalTotal === 0) {
              // FREE REPAIR (garansi atau arrangement) → stays PENDING_APPROVAL (requires Owner/Admin approval)
              newInvoice.status = "PENDING_APPROVAL";
              addAgentLog("REPAIR_GRATIS_APPROVAL_NEEDED",
                `Invoice ${invId} Repair Rp 0 (${laporanRepairType}) — PENDING_APPROVAL (awaiting Owner/Admin approval)`,
                "WARNING");
            } else if (isComplainSvc && finalTotal === 0) {
              newInvoice.status = "PAID";
              newInvoice.paid_at = new Date().toISOString();
              addAgentLog("GARANSI_AUTO_PAID", `Invoice ${invId} Rp 0 → auto PAID`, "SUCCESS");
            } else if (isComplainSvc && prevGaransiExpired) {
              addAgentLog("GARANSI_EXPIRED_FEE",
                `Invoice ${invId} — garansi expired (ref: ${prevGaransiExpired.id}) → biaya cek Rp ${BIAYA_CEK.toLocaleString("id-ID")}`,
                "WARNING");
            }

            setInvoicesData(prev => [...prev, newInvoice]);

            // Simpan invoice ke Supabase — exclude fields yang tidak ada di DB schema
            const { garansi_status: _gs, ...invBase } = newInvoice;
            const invPayload = {
              ...invBase,
              materials_detail: mDetail.length > 0 ? JSON.stringify(mDetail) : null,
              repair_gratis: invBase.repair_gratis || undefined,  // Only include if true
            };
            // ── 1 invoice per job: query DB langsung (bukan local state) untuk cegah race ──
            const { data: existingDB, error: fetchExistingErr } = await supabase
              .from("invoices").select("id").eq("job_id", laporanModal.id);
            if (fetchExistingErr) {
              console.error("[INVOICE_PRECHECK] gagal cek existing:", fetchExistingErr.message);
              showNotif("❌ Gagal verifikasi invoice existing — submit dibatalkan. Coba lagi.");
              return;
            }
            if (existingDB && existingDB.length > 0) {
              for (const old of existingDB) {
                const { error: delErr } = await deleteInvoice(supabase, old.id, auditUserName(), "TEKNISI_REWRITE_LAPORAN");
                if (delErr) {
                  console.error("[INVOICE_REWRITE] gagal hapus", old.id, delErr.message);
                  showNotif("❌ Gagal hapus invoice lama — submit dibatalkan. Coba lagi.");
                  return;
                }
              }
              setInvoicesData(prev => prev.filter(i => i.job_id !== laporanModal.id));
              addAgentLog("INVOICE_REWRITE", `${existingDB.length} invoice lama dihapus untuk ${laporanModal.id} (rewrite)`, "INFO");
            }
            const { error: invErr } = await insertInvoice(supabase, invPayload);
            if (invErr) {
              console.warn("Invoice insert failed:", invErr.message, "— retrying minimal");
              for (const st of ["PENDING_APPROVAL", "UNPAID"]) {
                const { error: e2 } = await insertInvoice(supabase, {
                  id: newInvoice.id, job_id: newInvoice.job_id,
                  customer: newInvoice.customer, service: newInvoice.service,
                  units: newInvoice.units, labor: newInvoice.labor,
                  material: newInvoice.material, total: newInvoice.total,
                  status: st,
                });
              }
            }

            addAgentLog("INVOICE_CREATED", `Invoice ${invId} dibuat — ${laporanModal.customer} ${fmt(newInvoice.total)}`, "SUCCESS");

            // WA notif ke Owner
            const ownerAccounts = userAccounts.filter(u => u.role === "Owner");
            const ownerMsg =
              "Invoice Menunggu Approval\n"
              + "Job: " + laporanModal.id + "\n"
              + "Customer: " + laporanModal.customer + "\n"
              + "Layanan: " + laporanModal.service + " - " + laporanUnits.length + " unit\n"
              + "Teknisi: " + laporanModal.teknisi + (laporanModal.helper ? " + " + laporanModal.helper : "") + "\n"
              + "Total: " + fmt(newInvoice.total) + " Jasa: " + fmt(newInvoice.labor) + " Mat: " + fmt(newInvoice.material) + "\n"
              + "Invoice: " + invId + " Silakan approve di menu Invoice. — ARA";
            // Notify owner accounts
            await Promise.all(ownerAccounts.map(u => {
              if (u.phone) return sendWA(u.phone, ownerMsg);
              return Promise.resolve();
            }));

            // Fallback if no owner accounts (notify default phone)
            if (ownerAccounts.length === 0) {
              try {
                const r = await fetch("/api/send-wa", {
                  method: "POST", headers: await _apiHeaders(),
                  body: JSON.stringify({ phone: "6281299898937", message: ownerMsg, currentUserRole: currentUser?.role || "Unknown" })
                });
                if (!r.ok) {
                  const d = await r.json().catch(() => ({}));
                  console.warn("[ARA_NOTIFY_OWNER_FAILED]", d.error || r.status);
                }
              } catch (err) {
                console.warn("[ARA_NOTIFY_OWNER_FAILED]", err.message);
              }
            }
          }

          setLaporanSubmitted(true);
          pushNotif("AClean", "Laporan berhasil dikirim ke Admin ✅");
          showNotif(`✅ Laporan ${laporanModal.id} terkirim! Laporan dikirim ke Owner/Admin untuk verifikasi.`);
          } catch (err) {
            console.error("submitLaporan fatal:", err);
            showNotif("❌ Submit error: " + (err?.message || String(err)));
          } finally {
            submitLaporan._running = false;
          }
        };

        const tagStyle = (active, color) => ({
          display: "flex", alignItems: "center", gap: 6, background: cs.card,
          border: `1px solid ${active ? color : cs.border}44`, borderRadius: 8,
          padding: "7px 10px", cursor: "pointer", fontSize: 12,
          color: active ? color : cs.muted, userSelect: "none"
        });

        // ── UNIT PRESET MODAL ──
        const UnitPresetModal = () => {
          if (!showUnitPresetModal || !unitPresetHistory || unitPresetHistory.length === 0) return null;

          const selectedUnits = Array.from(unitPresetSelected).map(idx => unitPresetHistory[idx]);
          const orderUnitCount = laporanModal?.units || 1;
          const newUnitsNeeded = Math.max(0, orderUnitCount - selectedUnits.length);

          const handleConfirm = () => {
            // Build laporanUnits dari selected history units + new empty units
            const newUnits = selectedUnits.map((hist, idx) => mkUnit(idx + 1, hist));
            for (let i = 0; i < newUnitsNeeded; i++) {
              newUnits.push(mkUnit(selectedUnits.length + i + 1));
            }
            setLaporanUnits(newUnits);
            setShowUnitPresetModal(false);
            setUnitPresetHistory(null);
            setUnitPresetSelected(new Set());
          };

          return (
            <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setShowUnitPresetModal(false); setUnitPresetHistory(null); }}>
              <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontWeight: 800, fontSize: 16, color: cs.text, margin: 0 }}>📋 Pilih AC Unit dari History</h3>
                  <button onClick={() => { setShowUnitPresetModal(false); setUnitPresetHistory(null); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer" }}>×</button>
                </div>

                <div style={{ fontSize: 12, color: cs.muted, marginBottom: 14 }}>
                  Order: <b>{orderUnitCount} unit AC</b>
                  {selectedUnits.length > 0 && <span> · Dipilih: <b style={{ color: cs.accent }}>{selectedUnits.length}/{orderUnitCount}</b></span>}
                </div>

                {/* History Units List */}
                <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                  {unitPresetHistory.map((h, idx) => {
                    const isSelected = unitPresetSelected.has(idx);
                    return (
                      <div key={idx} style={{ display: "flex", gap: 10, alignItems: "center", background: cs.card, border: "1px solid " + (isSelected ? cs.accent : cs.border), borderRadius: 10, padding: 12, cursor: "pointer", transition: "all 0.2s" }} onClick={() => {
                        const newSet = new Set(unitPresetSelected);
                        if (isSelected) newSet.delete(idx);
                        else if (newSet.size < orderUnitCount) newSet.add(idx);
                        setUnitPresetSelected(newSet);
                      }}>
                        <input type="checkbox" checked={isSelected} onChange={() => { }} style={{ cursor: "pointer", width: 18, height: 18 }} />
                        <div style={{ flex: 1, display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 600, color: cs.text, fontSize: 12 }}>
                            {h.label || `Unit ${h.unit_no}`} — {h.merk || "?"} {h.tipe || "?"}
                          </div>
                          <div style={{ fontSize: 10, color: cs.muted }}>
                            {h.pk && <span>{h.pk}</span>}
                            {h.model && <span> · Model: {h.model}</span>}
                            {h.history_date && <span> · {h.history_date}</span>}
                            {h.history_service && <span> · {h.history_service}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* New Units Needed */}
                {newUnitsNeeded > 0 && (
                  <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 11, color: cs.accent }}>
                    ℹ️ Perlu {newUnitsNeeded} unit baru (totalnya {selectedUnits.length} dari history + {newUnitsNeeded} baru)
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setShowUnitPresetModal(false); setUnitPresetHistory(null); }} style={{ flex: 1, background: cs.border, color: cs.muted, border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                    Batal
                  </button>
                  <button onClick={handleConfirm} style={{ flex: 1, background: cs.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }} disabled={selectedUnits.length === 0}>
                    Gunakan {selectedUnits.length} Unit {newUnitsNeeded > 0 ? `+ ${newUnitsNeeded} Baru` : ""}
                  </button>
                </div>
              </div>
            </div>
          );
        };

        return (
          <>
            <UnitPresetModal />
            <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => setLaporanModal(null)}>
              <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 560, maxHeight: "94vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📝 Laporan Servis</div>
                    <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{laporanModal.id} · {laporanModal.customer} · {laporanModal.service}</div>
                  </div>
                  <button onClick={() => setLaporanModal(null)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
                </div>

                {/* Step bar */}
                <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                  {[1, 2, 3, 4].map(s => <div key={s} style={{ flex: 1, height: 3, borderRadius: 99, background: laporanStep >= s ? cs.accent : cs.border }} />)}
                </div>
                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 18, textAlign: "center" }}>Step {laporanStep}/4: {STEP_LABELS[laporanStep]}</div>

                {/* ── STEP 1: Konfirmasi Unit ── */}
                {laporanStep === 1 && (
                  <div style={{ display: "grid", gap: 14 }}>

                    {/* ── GAP-C FIX: History AC Customer (referensi teknisi) ── */}
                    {(() => {
                      const custHistRef = buildCustomerHistory(
                        { name: laporanModal.customer, phone: laporanModal.phone },
                        ordersData.filter(o => o.id !== laporanModal.id),
                        laporanReports,
                        invoicesData
                      ).filter(h => h.laporan_id || h.status === "COMPLETED");
                      if (custHistRef.length === 0) return null;
                      const lastJob = custHistRef[0]; // job terakhir (sudah sorted desc)
                      const allUnits = custHistRef.flatMap(h => h.unit_detail || []);
                      // Kumpulkan semua AC yang pernah dikerjakan (unik per label/merk)
                      const acPernah = [...new Map(allUnits.map(u => [u.label || u.merk || "AC", u])).values()];
                      return (
                        <div style={{ background: "#0ea5e908", border: "1px solid #0ea5e933", borderRadius: 12, padding: "12px 14px" }}>
                          <div style={{ fontWeight: 700, color: "#7dd3fc", fontSize: 12, marginBottom: 8 }}>
                            📋 Referensi History AC — {laporanModal.customer}
                            <span style={{ fontSize: 10, color: cs.muted, marginLeft: 8, fontWeight: 400 }}>
                              ({custHistRef.length} kunjungan sebelumnya)
                            </span>
                          </div>

                          {/* Info kunjungan terakhir */}
                          <div style={{ background: cs.surface, borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 11 }}>
                            <div style={{ fontWeight: 700, color: cs.text, marginBottom: 4 }}>
                              Terakhir dikunjungi: <span style={{ color: cs.accent }}>{lastJob.date}</span>
                              <span style={{ color: cs.muted, marginLeft: 8 }}>{lastJob.service} · {lastJob.teknisi}</span>
                            </div>
                            {/* Detail unit AC — sesuai mkUnit: label, merk, pk, tipe, kondisi_sebelum[], kondisi_setelah[], pekerjaan[] */}
                            {(lastJob.unit_detail || []).map((u, ui) => (
                              <div key={ui} style={{
                                marginBottom: ui < (lastJob.unit_detail.length - 1) ? 8 : 0,
                                paddingBottom: ui < (lastJob.unit_detail.length - 1) ? 8 : 0,
                                borderBottom: ui < (lastJob.unit_detail.length - 1) ? "1px dashed " + cs.border : "none"
                              }}>
                                {/* Identitas unit */}
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                                  <span style={{ color: cs.accent, fontWeight: 700, fontSize: 12 }}>Unit {u.unit_no}</span>
                                  <span style={{ color: cs.text, fontWeight: 600, fontSize: 12 }}>{u.label}</span>
                                  {u.merk && <span style={{ color: cs.muted, fontSize: 11 }}>{u.merk}</span>}
                                  {u.pk && <span style={{ fontSize: 10, background: cs.accent + "12", color: cs.accent, padding: "1px 6px", borderRadius: 99 }}>{u.pk}</span>}
                                  {parseFloat(u.freon_ditambah) > 0 && (
                                    <span style={{ fontSize: 10, background: cs.yellow + "12", color: cs.yellow, padding: "1px 6px", borderRadius: 99 }}>🧊 {u.freon_ditambah} psi freon</span>
                                  )}
                                  {u.ampere_akhir && (
                                    <span style={{ fontSize: 10, background: cs.green + "12", color: cs.green, padding: "1px 6px", borderRadius: 99 }}>⚡ {u.ampere_akhir}A</span>
                                  )}
                                </div>
                                {/* Kondisi sebelum */}
                                {safeArr(u.kondisi_sebelum).length > 0 && (
                                  <div style={{ fontSize: 11, marginBottom: 2 }}>
                                    <span style={{ color: cs.muted }}>Kondisi masuk: </span>
                                    {safeArr(u.kondisi_sebelum).map((k, ki) => (
                                      <span key={ki} style={{ background: cs.yellow + "15", color: cs.yellow, fontSize: 10, padding: "1px 6px", borderRadius: 99, marginRight: 4 }}>{k}</span>
                                    ))}
                                  </div>
                                )}
                                {/* Pekerjaan dilakukan */}
                                {safeArr(u.pekerjaan).length > 0 && (
                                  <div style={{ fontSize: 11, marginBottom: 2 }}>
                                    <span style={{ color: cs.muted }}>Dikerjakan: </span>
                                    {safeArr(u.pekerjaan).map((p, pi) => (
                                      <span key={pi} style={{ background: cs.accent + "15", color: cs.accent, fontSize: 10, padding: "1px 6px", borderRadius: 99, marginRight: 4 }}>{p}</span>
                                    ))}
                                  </div>
                                )}
                                {/* Kondisi sesudah */}
                                <div style={{ fontSize: 11 }}>
                                  <span style={{ color: cs.muted }}>Setelah: </span>
                                  {safeArr(u.kondisi_setelah).length > 0
                                    ? safeArr(u.kondisi_setelah).map((k, ki) => (
                                      <span key={ki} style={{ background: cs.green + "15", color: cs.green, fontSize: 10, padding: "1px 6px", borderRadius: 99, marginRight: 4 }}>{k}</span>
                                    ))
                                    : <span style={{ color: cs.muted, fontStyle: "italic" }}>tidak direkam</span>
                                  }
                                </div>
                                {u.catatan_unit && <div style={{ fontSize: 11, color: "#7dd3fc", marginTop: 3 }}>💬 {u.catatan_unit}</div>}
                              </div>
                            ))}
                            {lastJob.rekomendasi && (
                              <div style={{ color: "#7dd3fc", marginTop: 4, fontStyle: "italic" }}>
                                💡 Rekomendasi lalu: {lastJob.rekomendasi}
                              </div>
                            )}
                          </div>

                          {/* Semua AC yang pernah dikerjakan */}
                          {acPernah.length > 0 && (
                            <div style={{ fontSize: 11, color: cs.muted }}>
                              <span style={{ fontWeight: 700, color: cs.text }}>AC di lokasi ini: </span>
                              {acPernah.map((u, ui) => (
                                <span key={ui} style={{ marginRight: 8 }}>
                                  {u.label || u.merk || `Unit ${u.unit_no}`}
                                  {u.merk && u.label ? ` (${u.merk})` : ""}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* History ringkas semua kunjungan */}
                          {custHistRef.length > 1 && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ fontSize: 11, color: cs.accent, cursor: "pointer", fontWeight: 700 }}>
                                Lihat semua {custHistRef.length} kunjungan ▾
                              </summary>
                              <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                                {custHistRef.map((h, hi) => (
                                  <div key={hi} style={{ fontSize: 11, color: cs.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <span style={{ color: cs.text, fontFamily: "monospace" }}>{h.job_id}</span>
                                    <span>{h.date}</span>
                                    <span style={{ color: cs.accent }}>{h.service}</span>
                                    <span>{h.units}unit</span>
                                    <span>{h.teknisi}</span>
                                    {h.laporan_id && <span style={{ color: cs.green }}>✅ lap</span>}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })()}

                    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                      <div style={{ fontSize: 12, color: cs.muted, marginBottom: 10 }}>Order tercatat <b style={{ color: cs.text }}>{laporanModal.units || 1} unit</b> AC. Isi detail tipe & PK untuk setiap unit — penting untuk invoice!</div>

                      {/* Info banner */}
                      <div style={{ background: cs.accent + "08", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 10, color: cs.accent }}>
                        ⚠️ <strong>Wajib isi Tipe AC, Nama Ruangan & Merk</strong> — PK sudah termasuk dalam pilihan Tipe AC. Data ini langsung masuk invoice!
                      </div>

                      <div style={{ display: "grid", gap: 10 }}>
                        {laporanUnits.map((u, idx) => (
                          <div key={idx} style={{ background: cs.surface, borderRadius: 10, border: "1px solid " + (TIPE_AC_OPT.includes(u.tipe) && u.label && u.label.trim() && u.merk && u.merk.trim() ? cs.green + "33" : cs.border), overflow: "hidden" }}>
                            {/* Card header with unit number */}
                            <div style={{ fontSize: 10, fontWeight: 700, color: cs.accent, padding: "8px 12px", background: cs.card + "33", borderBottom: "1px solid " + cs.border + "22" }}>
                              Unit {u.unit_no}
                            </div>

                            {/* Row 1: Nama Ruangan + Delete button */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: "10px 12px" }}>
                              {/* Nama Ruangan — Required */}
                              <div style={{ display: "grid", gap: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Nama Ruangan *</span>
                                <input value={u.label} onChange={e => updateUnit(idx, { ...u, label: e.target.value })} placeholder="Contoh: Kamar Utama, Ruang Tamu, Dapur"
                                  style={{ background: cs.card, border: "1px solid " + (u.label && u.label.trim() ? cs.green + "44" : "#ef444430"), borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                              </div>

                              {/* Delete button */}
                              {laporanUnits.length > 1 && (
                                <button onClick={() => { const nu = laporanUnits.filter((_, i) => i !== idx).map((u2, i) => ({ ...u2, unit_no: i + 1 })); setLaporanUnits(nu); setActiveUnitIdx(Math.max(0, idx - 1)); }}
                                  style={{ background: "#ef444415", border: "1px solid #ef444430", color: "#ef4444", borderRadius: 6, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700, lineHeight: 1, alignSelf: "flex-end" }}>×</button>
                              )}
                            </div>

                            {/* Row 2: Tipe AC — Required (full width) */}
                            <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid " + cs.border + "22" }}>
                              <div style={{ display: "grid", gap: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Tipe AC *</span>
                                <select value={u.tipe} onChange={e => { const newTipe = e.target.value; const pkMatch = newTipe.match(/(\d[\d.,]*PK)/i); updateUnit(idx, { ...u, tipe: newTipe, pk: pkMatch ? pkMatch[1] : u.pk }); }}
                                  style={{ background: cs.card, border: "1px solid " + (TIPE_AC_OPT.includes(u.tipe) ? cs.green + "44" : "#ef444430"), borderRadius: 6, padding: "8px 10px", color: TIPE_AC_OPT.includes(u.tipe) ? cs.text : cs.muted, fontSize: 11, outline: "none", fontWeight: TIPE_AC_OPT.includes(u.tipe) ? 600 : 400, boxSizing: "border-box", width: "100%" }}>
                                  <option value="">-- Pilih Tipe AC --</option>
                                  {TIPE_AC_OPT.map(t => <option key={t}>{t}</option>)}
                                </select>
                              </div>
                            </div>

                            {/* Row 2: Merk AC — Required */}
                            <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid " + cs.border + "22" }}>
                              <div style={{ display: "grid", gap: 4, marginBottom: 6 }}>
                                <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Merk AC *</span>
                                <input value={u.merk || ""} onChange={e => updateUnit(idx, { ...u, merk: e.target.value })} placeholder="Contoh: Daikin, Panasonic, Mitsubishi"
                                  style={{ background: cs.card, border: "1px solid " + (u.merk && u.merk.trim() ? cs.green + "44" : "#ef444430"), borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 11, outline: "none", fontWeight: u.merk && u.merk.trim() ? 600 : 400, boxSizing: "border-box" }} />
                              </div>
                            </div>

                            {/* Row 3: Model AC (optional) */}
                            <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid " + cs.border + "22" }}>
                              <div style={{ display: "grid", gap: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Model (opsional)</span>
                                <input value={u.model || ""} onChange={e => updateUnit(idx, { ...u, model: e.target.value })} placeholder="Kode Unit Indoor / Outdoor"
                                  style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                              </div>
                              {u.from_history_job_id && (
                                <div style={{ fontSize: 9, color: cs.muted, marginTop: 6, fontStyle: "italic" }}>
                                  ✓ Dari history: {u.from_history_job_id}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {laporanUnits.length < 10 && (
                        <button onClick={() => { setLaporanUnits(p => [...p, mkUnit(p.length + 1)]); setActiveUnitIdx(laporanUnits.length); }}
                          style={{ marginTop: 10, width: "100%", background: cs.accent + "12", border: "1px dashed " + cs.accent + "44", color: cs.accent, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                          + Tambah Unit AC
                        </button>
                      )}
                    </div>
                    {laporanUnits.length !== (laporanModal.units || 1) && (
                      <div style={{ background: cs.yellow + "10", border: "1px solid " + cs.yellow + "22", borderRadius: 9, padding: "9px 13px", fontSize: 11, color: cs.yellow }}>
                        ⚠ Jumlah unit berbeda dari order. Admin akan dinotifikasi untuk verifikasi.
                      </div>
                    )}

                    {/* Validate Tipe AC, Nama Ruangan, & Merk untuk semua unit */}
                    {(() => {
                      const incompleteUnits = laporanUnits.filter(u =>
                        !TIPE_AC_OPT.includes(u.tipe) || // Tipe AC harus pilih dari daftar
                        !u.label || !u.label.trim() ||   // Nama Ruangan required
                        !u.merk || !u.merk.trim()        // Merk required
                      );
                      return incompleteUnits.length > 0 ? (
                        <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 9, padding: "10px 13px", fontSize: 11, color: "#ef4444", fontWeight: 600 }}>
                          ❌ Lengkapi dulu: {incompleteUnits.map(u => `Unit ${u.unit_no}`).join(", ")} — Pastikan Tipe AC dipilih dari daftar, Nama Ruangan & Merk terisi!
                        </div>
                      ) : null;
                    })()}

                    <button onClick={() => {
                      const incomplete = laporanUnits.filter(u => !TIPE_AC_OPT.includes(u.tipe) || !u.label || !u.label.trim() || !u.merk || !u.merk.trim());
                      if (incomplete.length > 0) {
                        showNotif(`⚠️ Lengkapi: ${incomplete.map(u => `Unit ${u.unit_no}`).join(", ")} — Tipe AC harus dipilih dari daftar, Nama Ruangan & Merk wajib diisi!`);
                        return;
                      }
                      setLaporanStep(laporanModal?.service === "Install" ? 3 : 2);
                    }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "13px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                      Lanjut — Isi Detail Unit →
                    </button>
                  </div>
                )}

                {/* ── STEP 2: Detail Per Unit ── */}
                {laporanStep === 2 && (
                  <div style={{ display: "grid", gap: 14 }}>
                    {/* Info banner: Step 2 adalah untuk detail kondisi & pekerjaan */}
                    <div style={{ background: cs.green + "08", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: "10px 12px", fontSize: 11, color: cs.green, lineHeight: 1.6 }}>
                      ✅ <strong>Step 1 selesai!</strong> Sekarang isi detail kondisi & pekerjaan untuk setiap unit. Step 3 (Material) opsional — hanya jika ada tambahan biaya.
                    </div>
                    {/* Tab per unit */}
                    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                      {laporanUnits.map((u, idx) => {
                        const done = isUnitDone(u);
                        return (
                          <button key={idx} onClick={() => setActiveUnitIdx(idx)}
                            style={{
                              flexShrink: 0, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, border: "none",
                              background: activeUnitIdx === idx ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)" : done ? cs.green + "18" : cs.card,
                              color: activeUnitIdx === idx ? "#0a0f1e" : done ? cs.green : cs.muted,
                              outline: activeUnitIdx !== idx && !done ? "1px solid " + cs.border : "none"
                            }}>
                            {done ? "✓ " : ""}{u.label || `Unit ${u.unit_no}`}
                          </button>
                        );
                      })}
                    </div>

                    {/* Detail unit aktif */}
                    {laporanUnits[activeUnitIdx] && (() => {
                      const u = laporanUnits[activeUnitIdx];
                      const upd = (f) => updateUnit(activeUnitIdx, { ...u, ...f });
                      return (
                        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14, display: "grid", gap: 12 }}>
                          {/* Unit info strip — read-only, dari Step 1 */}
                          <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "22", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{u.tipe}</span>
                              {u.merk && <span style={{ fontSize: 12, color: cs.muted }}>🏷 {u.merk}</span>}
                              {u.model && <span style={{ fontSize: 11, color: cs.muted }}>{u.model}</span>}
                              {u.label && <span style={{ fontSize: 11, color: cs.accent }}>📍 {u.label}</span>}
                            </div>
                            <button onClick={() => setLaporanStep(1)}
                              style={{ fontSize: 11, color: cs.accent, background: cs.accent + "12", border: "1px solid " + cs.accent + "33", borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0, fontWeight: 600 }}>
                              ✏️ Edit Info
                            </button>
                          </div>
                          {/* Kondisi Sebelum */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 6 }}>⚠ Kondisi Sebelum</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                              {KONDISI_SBL.map(k => (
                                <label key={k} style={tagStyle(u.kondisi_sebelum.includes(k), cs.yellow)}>
                                  <input id="field_checkbox_33" type="checkbox" checked={u.kondisi_sebelum.includes(k)} onChange={() => upd({ kondisi_sebelum: toggleArr(u.kondisi_sebelum, k) })} style={{ accentColor: cs.yellow }} />{k}
                                </label>
                              ))}
                            </div>
                          </div>
                          {/* Pekerjaan */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent, marginBottom: 6 }}>🔧 Pekerjaan Dilakukan</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                              {PEKERJAAN_OPT(laporanModal?.service || "Cleaning").map(k => (
                                <label key={k} style={tagStyle(u.pekerjaan.includes(k), cs.accent)}>
                                  <input id="field_checkbox_34" type="checkbox" checked={u.pekerjaan.includes(k)} onChange={() => upd({ pekerjaan: toggleArr(u.pekerjaan, k) })} style={{ accentColor: cs.accent }} />{k}
                                </label>
                              ))}
                            </div>
                          </div>
                          {/* Kondisi Sesudah */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.green, marginBottom: 6 }}>✓ Kondisi Sesudah</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                              {KONDISI_SDH.map(k => (
                                <label key={k} style={tagStyle(u.kondisi_setelah.includes(k), cs.green)}>
                                  <input id="field_checkbox_35" type="checkbox" checked={u.kondisi_setelah.includes(k)} onChange={() => upd({ kondisi_setelah: toggleArr(u.kondisi_setelah, k) })} style={{ accentColor: cs.green }} />{k}
                                </label>
                              ))}
                            </div>
                          </div>
                          {/* Freon & Ampere */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tekanan Freon (psi)</div>
                              <input id="field_number_36" type="number" value={u.freon_ditambah} onChange={e => upd({ freon_ditambah: e.target.value })} placeholder="0" min="0" step="0.1"
                                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />

                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Ampere Akhir (A)</div>
                              <input id="field_number_37" type="number" value={u.ampere_akhir} onChange={e => upd({ ampere_akhir: e.target.value })} placeholder="0.0" min="0" step="0.1"
                                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          {/* Catatan unit */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Catatan Unit (Opsional)</div>
                            <textarea value={u.catatan_unit} onChange={e => upd({ catatan_unit: e.target.value })} rows={2} placeholder="Catatan khusus unit ini..."
                              style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
                          </div>
                        </div>
                      );
                    })()}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <button onClick={() => setLaporanStep(1)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>← Kembali</button>
                      <div style={{ textAlign: "center", fontSize: 11, color: cs.muted, alignSelf: "center" }}>{laporanUnits.filter(isUnitDone).length}/{laporanUnits.length} unit ✓</div>
                      <button onClick={() => {
                        if (!isInstallJob && incompleteUnits.length > 0) {
                          const incomplete = incompleteUnits.map(u => `Unit ${u.unit_no}`).join(", ");
                          showNotif(`⚠️ Lengkapi dulu: ${incomplete} — Pastikan Tipe AC & PK sudah diisi untuk semua unit`);
                          setActiveUnitIdx(laporanUnits.findIndex(u => !isUnitDone(u)));
                          return;
                        }
                        setLaporanStep(3);
                      }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>Lanjut →</button>
                    </div>
                  </div>
                )}

                {/* ── STEP 3: Material & Foto ── */}
                {laporanStep === 3 && (
                  <div style={{ display: "grid", gap: 14 }}>

                    {/* ══ REPORT INSTALL FORM ══ */}
                    {isInstallJob && (
                      <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 2 }}>🔧 Detail Pekerjaan Instalasi</div>
                        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Isi 0 jika tidak dikerjakan.</div>
                        {/* ── Group 1: Jasa Pemasangan ── */}
                        <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>Jasa Pemasangan</div>
                        {INSTALL_ITEMS.filter(it => ["jasa_ganti_instalasi", "pasang_05_1pk", "pasang_15_2pk", "bongkar_05_1pk", "bongkar_15_25pk", "vacum_05_25pk"].includes(it.key)).map(item => (
                          <div key={item.key} style={{
                            display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                            background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.accent + "08" : cs.card,
                            border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.accent + "44" : cs.border),
                            borderRadius: 8, padding: "8px 10px"
                          }}>
                            <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                              {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                            </div>
                            <input type="number" min="0" step={item.satuan === "Meter" ? "0.5" : "1"}
                              value={laporanInstallItems[item.key] ?? ""}
                              onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                              placeholder="0"
                              style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                          </div>
                        ))}
                        {/* ── Group 2: Material ── */}
                        <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, letterSpacing: 1, textTransform: "uppercase", marginTop: 6 }}>Material</div>
                        {INSTALL_ITEMS.filter(it => ["pipa_1pk", "pipa_2pk", "pipa_25pk", "pipa_3pk", "kabel_15", "kabel_25", "ducttape_biasa", "ducttape_lem", "jasa_pipa_ac", "jasa_pipa_ruko", "dinabolt", "karet_mounting", "breket_outdoor"].includes(it.key)).map(item => (
                          <div key={item.key} style={{
                            display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                            background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "08" : cs.card,
                            border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "44" : cs.border),
                            borderRadius: 8, padding: "8px 10px"
                          }}>
                            <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                              {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                            </div>
                            <input type="number" min="0" step={item.satuan === "Meter" ? "0.5" : "1"}
                              value={laporanInstallItems[item.key] ?? ""}
                              onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                              placeholder="0"
                              style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                          </div>
                        ))}
                        {/* ── Group 3: Freon & Vacum ── */}
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#38bdf8", letterSpacing: 1, textTransform: "uppercase", marginTop: 6 }}>❄️ Freon & Vacum</div>
                        {INSTALL_ITEMS.filter(it => ["kuras_vacum_r32", "kuras_vacum_r22", "freon_r22", "freon_r32", "freon_r410"].includes(it.key)).map(item => (
                          <div key={item.key} style={{
                            display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                            background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? "#38bdf808" : cs.card,
                            border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? "#38bdf844" : cs.border),
                            borderRadius: 8, padding: "8px 10px"
                          }}>
                            <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                              {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                            </div>
                            <input type="number" min="0" step={item.satuan === "KG" ? "0.5" : "1"}
                              value={laporanInstallItems[item.key] ?? ""}
                              onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                              placeholder="0"
                              style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                          </div>
                        ))}
                        {/* Summary */}
                        {Object.values(laporanInstallItems).some(v => parseFloat(v || 0) > 0) && (
                          <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "33", borderRadius: 9, padding: "8px 12px", fontSize: 11, color: cs.green, marginTop: 4 }}>
                            ✅ {INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).length} item diisi
                          </div>
                        )}
                      </div>
                    )}

                    {/* ══ CLEANING-IN-REPAIR CHECKBOX (Repair only) ══ */}
                    {laporanModal?.service === "Repair" && (laporanUnits || []).some(u => u && u.tipe) && (
                      <div style={{ background: "#06b6d408", border: "1px solid #06b6d433", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#06b6d4" }}>🧽 Tambahan Cleaning (opsional)</div>
                          <div style={{ fontSize: 11, color: cs.muted, marginTop: 3, lineHeight: 1.4 }}>
                            Centang unit yang juga dicuci. Harga otomatis dari PRICE_LIST berdasarkan PK unit.
                            <br /><strong style={{ color: "#06b6d4" }}>Isi hanya jika job Repair ini berubah / menambah pekerjaan Cleaning.</strong>
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {(laporanUnits || []).filter(u => u && u.tipe).map(u => {
                            const hargaUnit = hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData);
                            const bracket = getBracketKey("Cleaning", u.tipe) || u.tipe;
                            const checked = laporanCleaningInRepair.includes(u.unit_no);
                            const unitLabel = u.label || u.merk || ("Unit " + u.unit_no);
                            return (
                              <label key={u.unit_no} style={{
                                display: "flex", alignItems: "center", gap: 10,
                                background: checked ? "#06b6d412" : cs.surface,
                                border: "1px solid " + (checked ? "#06b6d466" : cs.border),
                                borderRadius: 8, padding: "8px 12px", cursor: "pointer"
                              }}>
                                <input type="checkbox" checked={checked} onChange={() => {
                                  setLaporanCleaningInRepair(prev => checked
                                    ? prev.filter(n => n !== u.unit_no)
                                    : [...prev, u.unit_no]);
                                }} style={{ cursor: "pointer" }} />
                                <div style={{ flex: 1, fontSize: 12, color: cs.text }}>
                                  <div style={{ fontWeight: 700 }}>Unit {u.unit_no} — {unitLabel}</div>
                                  <div style={{ fontSize: 10, color: cs.muted }}>{bracket} · {u.tipe}</div>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#06b6d4", fontFamily: "monospace" }}>
                                  Rp {hargaUnit.toLocaleString("id-ID")}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        {laporanCleaningInRepair.length > 0 && (
                          <div style={{ fontSize: 11, color: "#06b6d4", fontWeight: 700, textAlign: "right" }}>
                            Total tambahan cleaning: Rp {((laporanUnits || [])
                              .filter(u => u && u.tipe && laporanCleaningInRepair.includes(u.unit_no))
                              .reduce((s, u) => s + hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData), 0)
                            ).toLocaleString("id-ID")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ══ JASA SECTION: [+] Jasa ══ */}
                    {!isInstallJob && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>⚡ Jasa / Layanan ({laporanJasaItems.length})</div>
                            <button onClick={() => {
                              // Note: Jangan filter by service — items dari semua service (Cleaning, Repair, Install, dll) bisa digunakan
                              if (laporanJasaItems.length < 10) setLaporanJasaItems(p => [...p, {
                                id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", harga_satuan: 0
                              }]);
                            }}
                              style={{
                                fontSize: 11, background: cs.accent + "15", border: "1px solid " + cs.accent + "33", color: cs.accent,
                                borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 700
                              }}>
                              + Tambah Jasa
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: "1.4" }}>
                            💡 <strong>Pekerjaan yang ditagih.</strong> Contoh: Biaya cek AC, kuras vacum, pasang kompresor, jasa pemasangan, dll.
                          </div>
                        </div>
                        {laporanJasaItems.length === 0 && (
                          <div style={{
                            textAlign: "center", padding: "10px 0", fontSize: 12, color: cs.muted,
                            background: cs.surface, borderRadius: 8, border: "1px dashed " + cs.border
                          }}>
                            Belum ada jasa. Klik + Tambah Jasa untuk input biaya layanan.
                          </div>
                        )}
                        {laporanJasaItems.map((item, idx) => {
                          // Pull from "Jasa" category + freon/vacum items (may have null category)
                          // Note: tidak filter by service — items dari semua service (Cleaning, Repair, Install, dll) bisa digunakan di laporan manapun
                          const _isJasaItem = (r) => {
                            if (r.category === "Jasa") return true;
                            const cat = (r.category || "").toLowerCase();
                            if (cat.startsWith("freon")) return true; // freon_R22, freon_R32, freon_R410
                            const t = (r.type || "").toLowerCase();
                            return t.includes("kuras vacum") || t.includes("tambah freon") || t.includes("penambahan freon")
                              || t.includes("biaya transport") || t.includes("biaya pengecekan");
                          };
                          const allJasaOpt = priceListData
                            .filter(r => _isJasaItem(r) && parseInt(r.price || 0) > 0)
                            .map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }))
                            .filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i)
                            .slice(0, 100);
                          return (
                            <div key={item.id} style={{
                              background: cs.card, border: "1px solid " + (item.nama ? cs.accent + "44" : cs.border),
                              borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8
                            }}>
                              {/* Nama jasa */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <select
                                  value={item._isManual ? "__manual__" : item.nama}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "__manual__") {
                                      setLaporanJasaItems(p => p.map(j => j.id === item.id
                                        ? { ...j, nama: "__manual__", _isManual: true, harga_satuan: 0, satuan: "pcs" } : j));
                                      setJasaManualText(p => ({ ...p, [item.id]: "" }));
                                    } else {
                                      const sel = allJasaOpt.find(x => x.nama === val);
                                      setLaporanJasaItems(p => p.map(j => j.id === item.id
                                        ? { ...j, nama: val, _isManual: false, harga_satuan: sel?.harga || 0, satuan: sel?.satuan || "pcs" } : j));
                                    }
                                  }}
                                  style={{
                                    flex: 1, background: cs.surface, border: "1px solid " + cs.border,
                                    borderRadius: 8, padding: "8px 10px", color: item.nama ? cs.text : cs.muted, fontSize: 13
                                  }}>
                                  <option value="">-- Pilih jasa --</option>
                                  {allJasaOpt.map(o => (
                                    <option key={o.nama} value={o.nama}>{o.nama}</option>
                                  ))}
                                  <option value="__manual__">✏️ Input manual...</option>
                                </select>
                                <button onMouseDown={() => setLaporanJasaItems(p => p.filter(j => j.id !== item.id))}
                                  style={{
                                    background: "#ef444420", border: "none", color: "#ef4444",
                                    borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, flexShrink: 0
                                  }}>
                                  ×
                                </button>
                              </div>
                              {/* Manual input jika pilih manual — pakai local state agar tidak close saat ketik */}
                              {item._isManual && (
                                <input
                                  value={jasaManualText[item.id] ?? ""}
                                  onChange={e => {
                                    // Hanya update local text — TIDAK ubah laporanJasaItems.nama
                                    // Sehingga _isManual tetap true dan input tidak close
                                    setJasaManualText(p => ({ ...p, [item.id]: e.target.value }));
                                  }}
                                  onBlur={e => {
                                    // Commit ke state saat user keluar dari input
                                    const txt = (jasaManualText[item.id] || "").trim();
                                    if (txt) setLaporanJasaItems(p => p.map(j => j.id === item.id
                                      ? { ...j, nama: txt, _isManual: true } : j));
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const txt = (jasaManualText[item.id] || "").trim();
                                      if (txt) setLaporanJasaItems(p => p.map(j => j.id === item.id
                                        ? { ...j, nama: txt, _isManual: true } : j));
                                      e.target.blur();
                                    }
                                  }}
                                  placeholder="Ketik nama jasa..."
                                  autoFocus
                                  style={{
                                    width: "100%", background: cs.surface, border: "1px solid " + cs.accent + "55",
                                    borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none"
                                  }} />
                              )}
                              {/* Qty Unit saja — harga disembunyikan dari teknisi */}
                              <div>
                                <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Jumlah Unit</div>
                                <input type="number" min="1" step="1" value={item.jumlah || 1}
                                  onChange={e => setLaporanJasaItems(p => p.map(j => j.id === item.id
                                    ? { ...j, jumlah: parseFloat(e.target.value) || 1 } : j))}
                                  style={{
                                    width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                                    borderRadius: 8, padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none"
                                  }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ══ BARANG / SPAREPART SECTION: [+] Barang (dari price_list category=Barang) ══ */}
                    {!isInstallJob && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: cs.cyan }}>📦 Sparepart & Material ({laporanBarangItems.length})</div>
                            <button onClick={() => {
                              if (laporanBarangItems.length < 10) setLaporanBarangItems(p => [...p, {
                                id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", harga_satuan: 0, _isManual: false
                              }]);
                            }}
                              style={{
                                fontSize: 11, background: cs.cyan + "15", border: "1px solid " + cs.cyan + "33", color: cs.cyan,
                                borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 700
                              }}>
                              + Tambah Barang
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: "1.4" }}>
                            💡 <strong>Barang fisik yang ditagih.</strong> Contoh: Kapasitor, pipa AC, kabel, NAPLE, paralon, armaplex, dll.
                          </div>
                        </div>

                        {laporanBarangItems.length === 0 && (
                          <div style={{
                            textAlign: "center", padding: "10px 0", fontSize: 12, color: cs.muted,
                            background: cs.surface, borderRadius: 8, border: "1px dashed " + cs.border
                          }}>
                            Belum ada barang. Klik + Tambah Barang untuk input sparepart/material yang ditagih.
                          </div>
                        )}
                        {laporanBarangItems.map((bItem, bIdx) => {
                          const _isBarangItem = (r) => {
                            if (r.category === "Barang") return true;
                            const cat = (r.category || "").toLowerCase();
                            if (cat.startsWith("freon")) return true; // freon gas juga muncul di section material
                            const t = (r.type || "").toLowerCase();
                            return t.includes("kapasitor") || t.includes("naple") || t.includes("breket")
                              || t.includes("dinabolt") || t.includes("armaflex") || t.includes("freon r-")
                              || t.includes("freon r3") || t.includes("freon r4") || t.includes("freon r2")
                              || t.includes("pipa ac") || t.includes("kabel eterna") || t.includes("duct tape");
                          };
                          const barangOpt = priceListData
                            .filter(r => _isBarangItem(r) && parseInt(r.price || 0) > 0)
                            .map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }));
                          const allBarangOpt = barangOpt
                            .filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i).slice(0, 100);
                          return (
                            <div key={bItem.id} style={{
                              background: cs.card, border: "1px solid " + (bItem.nama ? cs.cyan + "44" : cs.border),
                              borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8
                            }}>
                              {/* Nama barang */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <select
                                  value={bItem._isManual ? "__manual__" : bItem.nama}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "__manual__") {
                                      setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                        ? { ...b, nama: "__manual__", _isManual: true, harga_satuan: 0, satuan: "pcs" } : b));
                                      setRepairManualText(p => ({ ...p, [bItem.id]: "" }));
                                    } else {
                                      const sel = allBarangOpt.find(x => x.nama === val);
                                      setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                        ? { ...b, nama: val, _isManual: false, harga_satuan: sel?.harga || 0, satuan: sel?.satuan || "pcs" } : b));
                                    }
                                  }}
                                  style={{
                                    flex: 1, background: cs.surface, border: "1px solid " + cs.border,
                                    borderRadius: 8, padding: "8px 10px", color: bItem.nama && !bItem._isManual ? cs.text : cs.muted, fontSize: 13
                                  }}>
                                  <option value="">-- Pilih barang/material --</option>
                                  {allBarangOpt.map(o => (
                                    <option key={o.nama} value={o.nama}>{o.nama}</option>
                                  ))}
                                  <option value="__manual__">✏️ Input manual...</option>
                                </select>
                                <button onMouseDown={() => setLaporanBarangItems(p => p.filter(b => b.id !== bItem.id))}
                                  style={{
                                    background: "#ef444420", border: "none", color: "#ef4444",
                                    borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, flexShrink: 0
                                  }}>
                                  ×
                                </button>
                              </div>
                              {/* Manual input untuk barang */}
                              {bItem._isManual && (
                                <input
                                  value={repairManualText[bItem.id] ?? ""}
                                  onChange={e => setRepairManualText(p => ({ ...p, [bItem.id]: e.target.value }))}
                                  onBlur={e => {
                                    const txt = (repairManualText[bItem.id] || "").trim();
                                    if (txt) setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                      ? { ...b, nama: txt, _isManual: true } : b));
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const txt = (repairManualText[bItem.id] || "").trim();
                                      if (txt) setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                        ? { ...b, nama: txt, _isManual: true } : b));
                                      e.target.blur();
                                    }
                                  }}
                                  placeholder="Ketik nama barang/material..."
                                  autoFocus
                                  style={{
                                    width: "100%", background: cs.surface, border: "1px solid " + cs.cyan + "55",
                                    borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none"
                                  }} />
                              )}
                              {/* Qty — satuan otomatis dari DB */}
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Jumlah</div>
                                  <input type="number" min="1" step="1" value={bItem.jumlah || 1}
                                    onChange={e => setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                      ? { ...b, jumlah: parseFloat(e.target.value) || 1 } : b))}
                                    style={{
                                      width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                                      borderRadius: 8, padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none"
                                    }} />
                                </div>
                                <div>
                                  <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Satuan</div>
                                  <div style={{
                                    background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8,
                                    padding: "8px 10px", color: cs.muted, fontSize: 13, textAlign: "center"
                                  }}>
                                    {bItem.satuan || "pcs"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ══ NORMAL MATERIAL FORM (Service/Repair/Complain) ══ */}
                    {!isInstallJob && (
                      <div style={{ display: "grid", gap: 10 }}>
                        {/* Material Tracking */}
                        <div>
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted }}>📊 Stok Terpakai (Tracking) ({laporanMaterials.length}/20)</div>
                              <button onClick={() => setShowMatPreset(v => !v)}
                                style={{ fontSize: 11, background: cs.muted + "15", border: "1px solid " + cs.muted + "33", color: cs.muted, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                                {showMatPreset ? "✕ Tutup" : "📦 Preset"}
                              </button>
                            </div>
                            <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: "1.4", marginBottom: 8 }}>
                              ℹ️ <strong>Hanya tracking stok, TIDAK masuk invoice.</strong> Pilih material yang pakai (freon tabung, pipa roll, kabel). Harga otomatis terdebit dari stok internal.
                            </div>
                          </div>
                          {showMatPreset && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                              <div style={{ fontSize: 11, color: cs.muted, width: "100%", marginBottom: 2 }}>Klik untuk tambah material tracking:</div>
                              {presets.map(p => (
                                <button key={p.nama || p} onClick={() => { if (laporanMaterials.length < 20) setLaporanMaterials(prev => [...prev, { id: Date.now(), nama: p.nama || p, jumlah: "", satuan: p.satuan || "pcs", keterangan: "" }]); setShowMatPreset(false); }}
                                  style={{ fontSize: 11, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                                  {p.nama || p}
                                </button>
                              ))}
                            </div>
                          )}
                          {laporanMaterials.length === 0 && <div style={{ textAlign: "center", padding: "14px 0", fontSize: 12, color: cs.muted, fontStyle: "italic" }}>Belum ada. Klik + Tambah atau pakai Preset untuk catat stok yang terpakai.</div>}
                          {laporanMaterials.map(mat => {
                            // Build lookup: inventory + price_list Material (tanpa harga)
                            const matLookup = [
                              ...inventoryData.map(r => ({ nama: r.name, satuan: r.unit || "pcs" })),
                              ...priceListData.filter(r => r.service === "Material").map(r => ({ nama: r.type, satuan: r.unit || "pcs" }))
                            ].filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i); // dedupe
                            const isSearching = matSearchId === mat.id;
                            // A.2: Use debouncedMatSearchQuery untuk filtering (bukan langsung matSearchQuery per keystroke)
                            const query = isSearching ? debouncedMatSearchQuery : "";
                            const filtered = matLookup.filter(x =>
                              x.nama.toLowerCase().includes(query.toLowerCase())
                            ).slice(0, 12);
                            return (
                              <div key={mat.id} style={{ background: cs.card, border: "1px solid " + (mat.nama ? cs.accent + "44" : cs.border), borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
                                {/* Row 1: Nama material — dropdown search */}
                                <div style={{ position: "relative", marginBottom: 6 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    {/* Nama field — tampilkan nama terpilih atau input search */}
                                    <div style={{ flex: 1, position: "relative" }}>
                                      <input
                                        id={"mat_search_" + mat.id}
                                        value={isSearching ? matSearchQuery : mat.nama}
                                        placeholder="Cari material..."
                                        onFocus={() => { setMatSearchId(mat.id); setMatSearchQuery(mat.nama); }}
                                        onChange={e => { setMatSearchQuery(e.target.value); }}
                                        onBlur={() => setTimeout(() => { setMatSearchId(null); setMatSearchQuery(""); }, 200)}
                                        style={{
                                          width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                                          borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none"
                                        }}
                                      />
                                      {/* Dropdown hasil search */}
                                      {isSearching && (
                                        <div style={{
                                          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999,
                                          background: cs.surface, border: "1px solid " + cs.accent + "55",
                                          borderRadius: "0 0 10px 10px", maxHeight: 200, overflowY: "auto",
                                          boxShadow: "0 8px 24px #0006"
                                        }}>
                                          {filtered.length > 0 ? filtered.map((item, idx) => (
                                            <div key={idx}
                                              onMouseDown={() => {
                                                setLaporanMaterials(p => p.map(m => m.id === mat.id
                                                  ? { ...m, nama: item.nama, satuan: item.satuan } : m));
                                                setMatSearchId(null); setMatSearchQuery("");
                                              }}
                                              style={{
                                                padding: "9px 12px", cursor: "pointer", fontSize: 13,
                                                color: cs.text, borderBottom: "1px solid " + cs.border + "33",
                                                display: "flex", justifyContent: "space-between", alignItems: "center"
                                              }}
                                              onMouseEnter={e => e.currentTarget.style.background = cs.accent + "18"}
                                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                            >
                                              <span style={{ fontWeight: 600 }}>{item.nama}</span>
                                              <span style={{ fontSize: 11, color: cs.muted, marginLeft: 8 }}>{item.satuan}</span>
                                            </div>
                                          )) : (
                                            <div style={{ padding: "10px 12px", color: cs.muted, fontSize: 12 }}>
                                              Tidak ditemukan — ketik manual
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {/* Tombol hapus baris */}
                                    <button onMouseDown={() => setLaporanMaterials(p => p.filter(m => m.id !== mat.id))}
                                      style={{
                                        background: "#ef444420", border: "none", color: "#ef4444",
                                        borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, flexShrink: 0
                                      }}>
                                      ×
                                    </button>
                                  </div>
                                </div>
                                {/* Row 2: Qty + Satuan */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                  <input type="number" min="0" step="0.5" value={mat.jumlah}
                                    onChange={e => setLaporanMaterials(p => p.map(m => m.id === mat.id ? { ...m, jumlah: parseFloat(e.target.value) || 0 } : m))}
                                    placeholder="Jumlah"
                                    style={{
                                      background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8,
                                      padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none"
                                    }} />
                                  <div style={{
                                    background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8,
                                    padding: "8px 10px", color: cs.muted, fontSize: 13, textAlign: "center",
                                    display: "flex", alignItems: "center", justifyContent: "center"
                                  }}>
                                    {mat.satuan || "pcs"}
                                  </div>
                                </div>
                                {/* ── Unit Fisik Selector (Tabung / Roll) ── */}
                                {(() => {
                                  const n = (mat.nama || "").toLowerCase();
                                  const isFreon = n.includes("freon") || n.includes("kuras vacum") ||
                                    n.includes("r-22") || n.includes("r-32") || n.includes("r-410") ||
                                    n.includes("r22") || n.includes("r32") || n.includes("r410");
                                  const isPipa = n.includes("pipa") || n.includes("hoda");
                                  const isKabel = n.includes("kabel");
                                  if (!isFreon && !isPipa && !isKabel) return null;

                                  // Cari inventory item yang paling cocok dengan nama material
                                  const matchedInvItem = inventoryData.find(item => {
                                    const nm = (item.name || "").toLowerCase();
                                    return nm.includes(n) || n.includes(nm.replace(/\s+/g, "").substring(0, 6));
                                  }) || inventoryData.find(item => {
                                    const nm = (item.name || "").toLowerCase();
                                    if (isFreon) return item.freon_type && n.includes(item.freon_type.toLowerCase().replace("r", "r-"));
                                    if (isPipa) return nm.includes("pipa") && nm.includes(n.replace("pipa", "").replace("hoda", "").trim().split(" ")[0]);
                                    if (isKabel) return nm.includes("kabel") && n.includes(nm.substring(nm.indexOf("3x"), nm.indexOf("3x") + 6));
                                    return false;
                                  });

                                  // Ambil unit fisik milik item ini dari invUnitsData
                                  // Teknisi hanya lihat unit dengan stock >= min_visible
                                  // Admin/Owner bisa lihat semua (is_active = true)
                                  const isAdminRole = currentUser?.role === "Owner" || currentUser?.role === "Admin";
                                  const availableUnits = invUnitsData.filter(u => {
                                    if (!matchedInvItem) return false;
                                    if (u.inventory_code !== matchedInvItem.code) return false;
                                    if (!u.is_active) return false;
                                    // Teknisi: hide unit dengan sisa < min_visible
                                    if (!isAdminRole && u.stock < (u.min_visible || 3)) return false;
                                    return true;
                                  });

                                  const icon = isFreon ? "❄️" : isPipa ? "🔧" : "⚡";
                                  const unitWord = isFreon ? "tabung" : isPipa ? "roll pipa" : "roll kabel";
                                  const borderCol = isFreon ? cs.accent : isPipa ? "#f59e0b" : "#22c55e";

                                  return (
                                    <div style={{
                                      marginTop: 6, padding: "8px 10px",
                                      background: borderCol + "08", border: "1px solid " + borderCol + "33", borderRadius: 8
                                    }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, color: borderCol, marginBottom: 5 }}>
                                        {icon} Dari {unitWord} mana?
                                        {matchedInvItem && (
                                          <span style={{ fontWeight: 400, color: cs.muted, marginLeft: 6 }}>
                                            ({matchedInvItem.name})
                                          </span>
                                        )}
                                      </div>
                                      {availableUnits.length === 0 ? (
                                        <div style={{ fontSize: 11, color: cs.red, padding: "4px 0" }}>
                                          ⚠️ Tidak ada {unitWord} tersedia (stok habis atau semua &lt; batas minimum).
                                          {isAdminRole && " Tambah unit baru di menu Stok Material."}
                                        </div>
                                      ) : (
                                        <select
                                          value={mat.freon_tabung_code || ""}
                                          onChange={e => {
                                            const unitId = e.target.value;
                                            const unit = invUnitsData.find(u => u.id === unitId);
                                            setLaporanMaterials(p => p.map(m => m.id === mat.id
                                              ? {
                                                ...m,
                                                freon_tabung_code: unitId,
                                                freon_unit_label: unit?.unit_label || "",
                                                freon_inv_code: unit?.inventory_code || "",
                                              } : m));
                                          }}
                                          style={{
                                            width: "100%", background: cs.surface,
                                            border: "1px solid " + borderCol + "55", borderRadius: 7,
                                            padding: "7px 10px", color: cs.text, fontSize: 12
                                          }}>
                                          <option value="">— Pilih {unitWord} —</option>
                                          {availableUnits.map(unit => (
                                            <option key={unit.id} value={unit.id}>
                                              {unit.unit_label} — Sisa: {unit.stock} {matchedInvItem?.unit || ""}
                                              {unit.stock < (unit.min_visible || 3) * 2 ? " ⚠️" : ""}
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                      {mat.freon_tabung_code && mat.freon_unit_label && (
                                        <div style={{ fontSize: 10, color: cs.green, marginTop: 4, display: "flex", gap: 8 }}>
                                          <span>✅ {mat.freon_unit_label}</span>
                                          <span style={{ color: cs.muted }}>→ stok berkurang {mat.jumlah} {mat.satuan || matchedInvItem?.unit || ""} saat submit</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                          {laporanMaterials.length < 20 && (
                            <button onClick={() => setLaporanMaterials(p => [...p, { id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", keterangan: "" }])}
                              style={{ marginTop: 8, width: "100%", background: cs.green + "10", border: "1px dashed " + cs.green + "33", color: cs.green, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                              + Tambah Material
                            </button>
                          )}
                        </div>
                      </div>
                    )}{/* end !isInstallJob */}

                    {/* ── Foto: tampil untuk semua service ── */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted }}>📸 Foto Dokumentasi ({laporanFotos.length}/20)
                          {laporanFotos.length > 0 && (() => {
                            const uploadingN = laporanFotos.filter(f => f.uploading).length;
                            const savedN = laporanFotos.filter(f => f.url).length;
                            const failedN = laporanFotos.filter(f => !f.uploading && !f.url && f.errMsg).length;
                            return (
                              <span style={{ marginLeft: 8, fontSize: 11 }}>
                                {uploadingN > 0 && (
                                  <span style={{ color: cs.accent, fontWeight: 700 }}>⏳ {uploadingN} upload...</span>
                                )}
                                {savedN > 0 && (
                                  <span style={{ color: cs.green, marginLeft: uploadingN > 0 ? 6 : 0 }}>☁️ {savedN} tersimpan</span>
                                )}
                                {failedN > 0 && (
                                  <span style={{ color: cs.yellow, marginLeft: 6 }}>⚠️ {failedN} gagal — retry / hapus</span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                        {laporanFotos.length < 20 && (
                          <button onClick={() => fotoInputRef.current?.click()}
                            style={{ fontSize: 11, background: cs.accent + "15", border: "1px solid " + cs.accent + "33", color: cs.accent, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>+ Foto</button>
                        )}
                      </div>
                      <input id="field_file_42" ref={fotoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={handleFotoUpload} style={{ display: "none" }} />
                      {laporanFotos.length === 0 ? (
                        <div onClick={() => fotoInputRef.current?.click()}
                          style={{ border: "1px dashed " + cs.border, borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer", color: cs.muted, fontSize: 12 }}>
                          📷 Tap untuk upload foto<br /><span style={{ fontSize: 11 }}>Sebelum &amp; sesudah servis, kondisi material</span>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                          {laporanFotos.map(f => (
                            <div key={f.id} style={{ position: "relative" }}>
                              <img src={f.data_url} alt={f.label} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 8, border: "1px solid " + cs.border, opacity: f.uploading ? 0.5 : 1 }} />
                              {f.uploading && (
                                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                                  <div style={{ background: cs.accent, color: "#0a0f1e", fontSize: 11, padding: "4px 10px", borderRadius: 99, fontWeight: 800 }}>⏳ Upload...</div>
                                </div>
                              )}
                              {!f.uploading && f.url ? (
                                <div style={{ position: "absolute", top: 4, right: 4, background: "#22c55e", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 99, fontWeight: 700, pointerEvents: "none" }}>
                                  {f.restored ? "☁️ Lama" : "☁️ OK"}
                                </div>
                              ) : !f.uploading ? (
                                <div
                                  title="Tap untuk retry upload"
                                  onClick={async () => {
                                    showNotif("⏳ Retry upload...");
                                    const reportId = laporanModal?.id || "tmp";
                                    try {
                                      const r = await fetch("/api/upload-foto", {
                                        method: "POST", headers: await _apiHeaders(),
                                        body: JSON.stringify({
                                          base64: f.data_url,
                                          filename: f.hash ? `${f.hash}.jpg` : `retry_${f.id}.jpg`,
                                          reportId, mimeType: "image/jpeg", hash: f.hash,
                                          currentUserRole: currentUser?.role || "Unknown",
                                        }),
                                      });
                                      const d = await r.json();
                                      if (d.success && d.url) {
                                        setLaporanFotos(prev => prev.map(x =>
                                          x.id === f.id ? { ...x, url: d.url, errMsg: "" } : x
                                        ));
                                        showNotif("✅ Retry berhasil!");
                                      } else {
                                        showNotif("❌ Retry gagal: " + (d.error || "unknown"));
                                      }
                                    } catch (err) { showNotif("❌ " + err.message); }
                                  }}
                                  style={{ position: "absolute", top: 4, right: 4, background: "#f59e0b", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 99, fontWeight: 700, cursor: "pointer" }}>
                                  ⏳ Retry
                                </div>
                              ) : null}
                              <button onClick={() => setLaporanFotos(p => p.filter(x => x.id !== f.id))}
                                style={{ position: "absolute", top: 4, left: 4, background: "#ef4444cc", border: "none", color: "#fff", borderRadius: 99, width: 18, height: 18, cursor: "pointer", fontSize: 10, lineHeight: 1, padding: 0 }}>×</button>
                              <input id="field_43" value={f.label} onChange={e => setLaporanFotos(p => p.map(x => x.id === f.id ? { ...x, label: e.target.value } : x))}
                                placeholder="Label foto..." style={{ marginTop: 3, width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 6px", color: cs.text, fontSize: 10, outline: "none", boxSizing: "border-box" }} />
                            </div>
                          ))}
                          {laporanFotos.length < 20 && (
                            <div onClick={() => fotoInputRef.current?.click()}
                              style={{ aspectRatio: "1/1", border: "1px dashed " + cs.border, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 22, color: cs.muted }}>+</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Rekomendasi & Catatan: shared untuk semua service ── */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Rekomendasi untuk Customer</div>
                      <textarea value={laporanRekomendasi} onChange={e => setLaporanRekomendasi(e.target.value)} rows={2} placeholder="cth: Disarankan servis berkala tiap 3 bulan..."
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Catatan ke Admin (Opsional)</div>
                      <textarea value={laporanCatatan} onChange={e => setLaporanCatatan(e.target.value)} rows={2} placeholder="Catatan lain untuk Admin..."
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
                    </div>

                    {/* ✨ FIX #1: Gate tombol Next saat foto masih upload */}
                    {(() => {
                      const uploadingCount = laporanFotos.filter(f => f.uploading).length;
                      const failedCount = laporanFotos.filter(f => !f.uploading && !f.url && f.errMsg).length;
                      const canProceed = uploadingCount === 0;
                      const btnLabel = uploadingCount > 0
                        ? `⏳ Tunggu ${uploadingCount} foto upload...`
                        : failedCount > 0
                          ? `⚠️ ${failedCount} foto gagal — retry atau hapus`
                          : "Lanjut → Ringkasan";
                      const btnBg = canProceed
                        ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)"
                        : cs.border;
                      const btnColor = canProceed ? "#0a0f1e" : cs.muted;
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                          <button onClick={() => setLaporanStep(laporanModal?.service === "Install" ? 1 : 2)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>← Kembali</button>
                          <button
                            onClick={() => { if (canProceed) setLaporanStep(4); }}
                            disabled={!canProceed}
                            style={{
                              background: btnBg,
                              border: "none",
                              color: btnColor,
                              padding: "12px",
                              borderRadius: 10,
                              cursor: canProceed ? "pointer" : "not-allowed",
                              fontWeight: 800,
                              fontSize: 14,
                              opacity: canProceed ? 1 : 0.6,
                            }}>{btnLabel}</button>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── STEP 4: Ringkasan & Submit ── */}
                {laporanStep === 4 && (
                  <div style={{ display: "grid", gap: 14 }}>
                    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14, fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12 }}>📋 Ringkasan Laporan</div>
                      <div style={{ display: "grid", gap: 5, marginBottom: 12 }}>
                        <div><span style={{ color: cs.muted }}>Job: </span><span style={{ color: cs.accent, fontWeight: 700 }}>{laporanModal.id}</span> · <span style={{ color: cs.text }}>{laporanModal.customer}</span></div>
                        <div><span style={{ color: cs.muted }}>Teknisi: </span><span style={{ fontWeight: 600, color: cs.text }}>{laporanModal.teknisi}{laporanModal.helper ? " + " + laporanModal.helper + " (Helper)" : ""}</span></div>
                        <div>
                          <span style={{ color: cs.muted }}>Total: </span>
                          <span style={{ fontWeight: 700, color: cs.text }}>{laporanUnits.length} unit AC</span>
                          {totalFreon > 0 && <span style={{ color: cs.muted }}> · Tekanan Freon: <span style={{ color: cs.yellow }}>{totalFreon.toFixed(0)} psi</span></span>}
                          {laporanFotos.length > 0 && <span style={{ color: cs.muted }}> · <span style={{ color: cs.green }}>{laporanFotos.length} foto</span></span>}
                          {laporanMaterials.length > 0 && <span style={{ color: cs.muted }}> · <span style={{ color: cs.accent }}>{laporanMaterials.length} material</span></span>}
                        </div>
                      </div>
                      {/* Per-unit summary */}
                      {/* ══ Install summary ══ */}
                      {isInstallJob && (
                        <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 8, fontSize: 12 }}>🔧 Detail Instalasi</div>
                          {INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).map(it => (
                            <div key={it.key} style={{
                              display: "flex", justifyContent: "space-between", fontSize: 12,
                              color: cs.text, marginBottom: 3, paddingBottom: 3, borderBottom: "1px solid " + cs.border + "33"
                            }}>
                              <span>{it.label}</span>
                              <span style={{ fontWeight: 700, color: cs.accent }}>{laporanInstallItems[it.key]} {it.satuan}</span>
                            </div>
                          ))}
                          {!INSTALL_ITEMS.some(it => parseFloat(laporanInstallItems[it.key] || 0) > 0) && (
                            <div style={{ color: cs.muted, fontSize: 12, textAlign: "center" }}>Belum ada item diisi</div>
                          )}
                        </div>
                      )}

                      {/* ══ Per-unit summary (Service/Repair/Complain) ══ */}
                      {!isInstallJob && (
                        <div style={{ display: "grid", gap: 8 }}>
                          {laporanUnits.map((u, i) => (
                            <div key={i} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9, padding: "10px 12px" }}>
                              <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 5 }}>Unit {u.unit_no} — {u.label} {u.merk ? `(${u.merk})` : ""}</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 3 }}>
                                {u.kondisi_sebelum.map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.yellow + "18", color: cs.yellow, padding: "1px 6px", borderRadius: 99 }}>{k}</span>)}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 3 }}>
                                {u.pekerjaan.map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.accent + "18", color: cs.accent, padding: "1px 6px", borderRadius: 99 }}>{k}</span>)}
                              </div>
                              <div style={{ fontSize: 11, color: cs.muted }}>
                                {u.ampere_akhir ? `Ampere: ${u.ampere_akhir}A` : ""}{u.ampere_akhir && parseFloat(u.freon_ditambah) > 0 ? " · " : ""}
                                {parseFloat(u.freon_ditambah) > 0 ? `Tekanan: ${u.freon_ditambah} psi` : ""}
                                {u.catatan_unit ? ` · ${u.catatan_unit}` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ══ Material summary ══ */}
                      {isInstallJob && INSTALL_ITEMS.some(it => parseFloat(laporanInstallItems[it.key] || 0) > 0) && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 700, color: cs.text, marginBottom: 5, fontSize: 11 }}>Material Instalasi:</div>
                          {INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).map((it, mi) => (
                            <div key={mi} style={{ fontSize: 11, color: cs.muted, marginBottom: 2 }}>• {it.label}: {laporanInstallItems[it.key]} {it.satuan}</div>
                          ))}
                        </div>
                      )}
                      {!isInstallJob && laporanMaterials.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 700, color: cs.text, marginBottom: 5, fontSize: 11 }}>Material:</div>
                          {laporanMaterials.map((m, mi) => (
                            <div key={mi} style={{ fontSize: 11, color: cs.muted, marginBottom: 2 }}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan ? ` — ${m.keterangan}` : ""}</div>
                          ))}
                        </div>
                      )}
                      {laporanRekomendasi && <div style={{ marginTop: 8, fontSize: 11 }}><span style={{ color: cs.muted }}>Rekomendasi: </span><span style={{ color: cs.text }}>{laporanRekomendasi}</span></div>}
                      {laporanUnits.length !== (laporanModal.units || 1) && (
                        <div style={{ marginTop: 10, background: cs.yellow + "10", border: "1px solid " + cs.yellow + "22", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: cs.yellow }}>⚠ Unit tidak sama dengan order asal — Admin akan dikonfirmasi</div>
                      )}
                    </div>
                    <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "22", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: cs.green }}>
                      Setelah submit, laporan dikirim ke Owner/Admin untuk verifikasi dan pembuatan invoice.
                    </div>
                    {/* ── GAP-05 FIX: Upgrade Complain → Repair jika butuh perbaikan ── */}
                    {laporanModal?.service === "Complain" && (
                      <div style={{ background: cs.yellow + "0d", border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 5 }}>⚠️ Perlu Perbaikan Tambahan?</div>
                        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>Jika AC ternyata butuh repair (bukan sekadar komplain garansi), buat job Repair terpisah agar ada invoice perbaikan.</div>
                        <button onClick={async () => {
                          const rId = "JOB" + Date.now().toString(36).slice(-5).toUpperCase();
                          const rJob = {
                            id: rId, customer: laporanModal.customer,
                            phone: laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone || "",
                            address: laporanModal.address || "", service: "Repair", type: "Pengecekan AC",
                            units: laporanModal.units || 1, teknisi: laporanModal.teknisi, helper: laporanModal.helper || null,
                            date: laporanModal.date, time: laporanModal.time || "09:00", status: "CONFIRMED",
                            parent_job_id: laporanModal.id, dispatch: true,
                            notes: "Upgrade dari Complain " + laporanModal.id
                          };
                          setOrdersData(prev => [...prev, rJob]);
                          const { error: rErr } = await insertOrder(supabase, rJob);
                          if (!rErr) {
                            addAgentLog("COMPLAIN_UPGRADED", `Complain ${laporanModal.id} → Repair ${rId}`, "SUCCESS");
                            showNotif(`✅ Job Repair ${rId} dibuat! Admin dinotifikasi.`);
                            const admR = userAccounts.filter(u => u.role === "Admin" || u.role === "Owner");
                            admR.forEach(a => {
                              if (a?.phone) sendWA(a.phone,
                                "Upgrade Complain Repair\nComplain: " + laporanModal.id
                                + "\nRepair Baru: " + rId + "\nCustomer: " + laporanModal.customer
                                + "\nTeknisi: " + laporanModal.teknisi
                                + "\n\nSilakan approve. — ARA");
                            });
                          } else showNotif("❌ Gagal buat Repair: " + rErr.message);
                        }} style={{
                          background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow,
                          padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%"
                        }}>
                          🔧 Upgrade ke Job Repair (Buat Invoice Perbaikan Terpisah)
                        </button>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                      <button onClick={() => setLaporanStep(3)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>← Kembali</button>
                      <button onClick={submitLaporan} style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>✓ Submit Laporan</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Laporan Submitted Confirmation ── */}
      {laporanModal && laporanSubmitted && (
        <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.green + "44", borderRadius: 20, padding: 32, textAlign: "center", maxWidth: 360, width: "100%" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: cs.text, marginBottom: 8 }}>Laporan Terkirim!</div>
            <div style={{ fontSize: 13, color: cs.muted, marginBottom: 6 }}>{laporanModal.id} · {laporanModal.customer}</div>
            <div style={{ fontSize: 12, color: cs.green, marginBottom: 4 }}>{laporanUnits.length} unit AC · {laporanMaterials.length} material · {laporanFotos.length} foto</div>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 20 }}>Laporan sedang diproses Admin/Owner untuk verifikasi.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => { setActiveMenu("myreport"); setLaporanModal(null); setLaporanSubmitted(false); }}
                style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                Lihat Laporan
              </button>
              <button onClick={() => { setLaporanModal(null); setLaporanSubmitted(false); }}
                style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "linear-gradient(135deg,#1e293b,#0f172a)", border: "1px solid " + cs.accent + "66", color: cs.text, padding: "12px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: "0 8px 32px #000a", maxWidth: 360 }}>
          {notification}
        </div>
      )}

      {/* Payment Suggestion Banner — hanya Owner/Admin */}
      {paymentSuggestBanner && ["Owner","Admin"].includes(currentUser?.role) && (
        <div style={{ position:"fixed", bottom: 80, right: 20, zIndex: 9500,
          background: cs.surface, border: "2px solid #22c55e", borderRadius: 16,
          padding: 18, maxWidth: 340, boxShadow: "0 8px 32px #0008", minWidth: 280 }}>
          <div style={{ fontWeight: 800, color: "#22c55e", marginBottom: 8, fontSize: 14 }}>
            💳 Bukti Pembayaran Masuk
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 2 }}>
            Dari: <span style={{color:cs.text, fontWeight:600}}>{paymentSuggestBanner.sender_name}</span>
            {" "}({paymentSuggestBanner.phone})
          </div>
          {paymentSuggestBanner.amount && (
            <div style={{ fontSize: 15, fontWeight: 800, color: cs.text, marginTop: 4 }}>
              Rp {Number(paymentSuggestBanner.amount).toLocaleString("id-ID")}
              {paymentSuggestBanner.bank ? <span style={{fontWeight:400, fontSize:12, color:cs.muted}}> via {paymentSuggestBanner.bank}</span> : null}
            </div>
          )}
          {paymentSuggestBanner.invoice_id && (
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>
              Invoice cocok: <strong style={{color:cs.accent}}>{paymentSuggestBanner.invoice_id}</strong>
            </div>
          )}
          {paymentSuggestBanner.raw_message && (
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 4, fontStyle:"italic",
              background: cs.card, borderRadius: 6, padding: "4px 8px" }}>
              "{paymentSuggestBanner.raw_message.slice(0,100)}"
            </div>
          )}
          <div style={{ display:"flex", gap: 8, marginTop: 12 }}>
            <button onClick={async () => {
              const sugg = paymentSuggestBanner;
              const inv = invoicesData.find(i => i.id === sugg.invoice_id) ||
                invoicesData.find(i => i.phone === sugg.phone && (i.status === "UNPAID" || i.status === "OVERDUE"));
              if (!inv) {
                showNotif("⚠️ Invoice tidak ditemukan untuk nomor ini. Cari manual di halaman Invoice.");
              } else {
                const bankNote = sugg.bank ? "transfer_" + sugg.bank.toLowerCase().replace(/\s/g,"_") : "transfer";
                await markPaid(inv, bankNote, "Auto-detect WA: " + (sugg.raw_message||"").slice(0,100), true, sugg.image_url || null);
                supabase.from("payment_suggestions").update({
                  status:"CONFIRMED", resolved_at: new Date(Date.now()+7*3600000).toISOString(), resolved_by: currentUser?.name||"Admin"
                }).eq("id", sugg.id).then(() => {});
                setPaymentSuggestions(prev => prev.filter(p => p.id !== sugg.id));
              }
              setPaymentSuggestBanner(null);
            }} style={{ flex:1, background:"#22c55e", border:"none", color:"#fff",
              padding:"10px 6px", borderRadius:8, fontWeight:800, cursor:"pointer", fontSize:13 }}>
              ✅ Konfirmasi Lunas
            </button>
            <button onClick={async () => {
              supabase.from("payment_suggestions").update({
                status:"DISMISSED", resolved_at: new Date(Date.now()+7*3600000).toISOString()
              }).eq("id", paymentSuggestBanner.id).then(() => {});
              setPaymentSuggestions(prev => prev.filter(p => p.id !== paymentSuggestBanner.id));
              setPaymentSuggestBanner(null);
            }} style={{ background: cs.card, border:"1px solid "+cs.border, color:cs.muted,
              padding:"10px 14px", borderRadius:8, cursor:"pointer", fontSize:13 }}>
              Abaikan
            </button>
          </div>
        </div>
      )}

      {/* Audit History Modal (Stabilisasi #2B) */}
      <AuditHistory
        open={!!auditModal}
        tableName={auditModal?.tableName}
        rowId={auditModal?.rowId}
        onClose={() => setAuditModal(null)}
        cs={cs}
      />

      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.1)} }
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:99px}
        input::placeholder,textarea::placeholder{color:#4a5568}
        button{transition:opacity .15s,transform .1s}
        button:hover{opacity:.85}
        button:active{transform:scale(.97)}
        select{cursor:pointer}
      `}</style>
    </div>
    </AppContext.Provider>
  );
}
