import { useState, useEffect, useRef, useCallback, useMemo, Component, lazy, Suspense } from "react";
import { supabase } from "./supabaseClient.js";
import { normalizePhone, samePhone } from "./lib/phone.js";
import { getLocalDate, getLocalISOString, isWorkingHours } from "./lib/dateTime.js";
import { safeJsonParse } from "./lib/safeJson.js";
import {
  validatePhone, validateTime, validateDate,
  validatePositiveNumber, validateAddressLength, validateNameLength,
} from "./lib/validators.js";
import { isFreonItem, computeStockStatus } from "./lib/inventory.js";
import { classifyMaterial } from "./lib/materialRecon.js";
import { getTechColor as getTechColorFromLib } from "./lib/techColor.js";
import { sameCustomer, findCustomer, buildCustomerHistory } from "./lib/customers.js";
import { detectContinuationCandidates } from "./lib/orders.js";
import { resolveMultiDayInvoiceAction, multiDayProjectKey } from "./lib/invoiceMultiDay.js";
import { summarize, checkInvoiceConsistency, describeInconsistency, normalizeLines, buildWarrantyDiscountLine, categoryOf, LINE_CATEGORY, categoryFromCatalog, computePph23 } from "./lib/invoicing.js";
import { listPendingBAP, flushBAPQueue } from "./lib/bapOfflineQueue.js";
import { buildInvoiceDetail } from "./lib/laporanInvoice.js";
import { buildAraContext } from "./lib/araContext.js";
import {
  KONDISI_SBL, KONDISI_SDH, PEKERJAAN_OPT, MATERIAL_PRESET,
  INSTALL_ITEMS, TIPE_AC_OPT, SATUAN_OPT, maintUnitToHist, acUnitToHist, mkUnit, isUnitDone,
} from "./lib/laporanConstants.js";
import {
  PRICE_LIST_DEFAULT, getBracketKey,
  hargaPerUnitFromTipe as hargaPerUnitFromTipeLib,
  hitungLaborFromUnits as hitungLaborFromUnitsLib,
  buildPriceListFromDB as buildPriceListFromDBLib,
} from "./lib/pricing.js";
import { cs } from "./theme/cs.js";
import { statusColor, statusLabel } from "./constants/status.js";
import { SERVICE_TYPES } from "./constants/services.js";
import { DEFAULT_BONUS_CATEGORIES } from "./constants/bonus.js";
import {
  fetchOrders, fetchInvoices, fetchCustomers, fetchInventory,
  fetchServiceReports, fetchInventoryTransactions,
  searchInvoicesServer, searchOrdersServer, searchServiceReportsServer,
  fetchInventoryUnits, fetchExpenses, fetchPayments, fetchDispatchLogs,
  fetchAppSettings, fetchUserProfiles, fetchUserAccounts,
  fetchWaConversations, fetchPriceList, fetchAraBrain,
  lookupCustomersByPhone, fetchKasbonRequests,
} from "./data/reads.js";
import {
  insertOrder, updateOrder, updateOrderStatus, deleteOrder,
  insertInvoice, updateInvoice, markInvoicePaid, revertInvoiceToUnpaid, deleteInvoice,
  updateServiceReport, deleteServiceReport,
  insertExpense, updateExpense, deleteExpense,
  insertCustomer, updateCustomer, deleteCustomer,
  insertKasbonRequest, updateKasbonRequest,
  fetchAcUnitsByCustomer, insertAcUnit, updateAcUnit,
} from "./data/writes.js";
// Registry unit AC permanen hanya berlaku maju (order >= tanggal ini). Historis dibiarkan.
const AC_REGISTRY_CUTOFF = "2026-06-25";
import DashboardView from "./views/DashboardView.jsx";
import KasbonWidget from "./views/KasbonWidget.jsx";
import ExpenseInputWidget from "./views/ExpenseInputWidget.jsx";
import ViewErrorBoundary from "./components/ViewErrorBoundary.jsx";
import { AppContext } from "./context/AppContext.js";
const DeletedAuditView = lazy(() => import("./views/DeletedAuditView.jsx"));
const MonitoringView = lazy(() => import("./views/MonitoringView.jsx"));
const WaGroupMonitorView = lazy(() => import("./views/WaGroupMonitorView.jsx"));
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
const BAPModal = lazy(() => import("./views/BAPModal.jsx"));
const MaterialBringModal = lazy(() => import("./views/MaterialBringModal.jsx"));
const JobReportFlow = lazy(() => import("./views/JobReportFlow.jsx"));
const MatTrackView = lazy(() => import("./views/MatTrackView.jsx"));
const ExpensesView = lazy(() => import("./views/ExpensesView.jsx"));
const SettingsView = lazy(() => import("./views/SettingsView.jsx"));
const OrderInboxView = lazy(() => import("./views/OrderInboxView.jsx"));
const FinanceView = lazy(() => import("./views/FinanceView.jsx"));
const TechMobileView = lazy(() => import("./views/TechMobileView.jsx"));
const KomisiView = lazy(() => import("./views/KomisiView.jsx"));
const LaporanDetailModal = lazy(() => import("./views/LaporanDetailModal.jsx"));
const ProjectApp = lazy(() => import("./project/ProjectApp.jsx"));
const MaintenanceView = lazy(() => import("./views/MaintenanceView.jsx"));
const MaterialCheckoutView   = lazy(() => import("./views/MaterialCheckoutView.jsx"));
const MyToolsView            = lazy(() => import("./views/MyToolsView.jsx"));
const ProjectLaporanModal    = lazy(() => import("./views/ProjectLaporanModal.jsx"));
const OrderFormModal         = lazy(() => import("./views/OrderFormModal.jsx"));
const EditOrderModal         = lazy(() => import("./views/EditOrderModal.jsx"));
const CustomerFormModal      = lazy(() => import("./views/CustomerFormModal.jsx"));
const TeknisiFormModal       = lazy(() => import("./views/TeknisiFormModal.jsx"));
const UserFormModal          = lazy(() => import("./views/UserFormModal.jsx"));
const MaterialFormModal      = lazy(() => import("./views/MaterialFormModal.jsx"));
const RestockModal           = lazy(() => import("./views/RestockModal.jsx"));
const ApproveInvoiceModal    = lazy(() => import("./views/ApproveInvoiceModal.jsx"));
const EditPasswordModal      = lazy(() => import("./views/EditPasswordModal.jsx"));
const BrainEditModal         = lazy(() => import("./views/BrainEditModal.jsx"));
const WaTekModal             = lazy(() => import("./views/WaTekModal.jsx"));
const BrainCustomerModal     = lazy(() => import("./views/BrainCustomerModal.jsx"));
const EditInvoiceModal       = lazy(() => import("./views/EditInvoiceModal.jsx"));
const InvoicePreviewModal    = lazy(() => import("./views/InvoicePreviewModal.jsx"));
const LaporanTeknisiModal    = lazy(() => import("./views/LaporanTeknisiModal.jsx"));

// Supabase client tunggal di-import dari ./supabaseClient.js (env divalidasi di sana).
// Single client → session login Supabase Auth ter-share ke modul Project (RLS authenticated).

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
- AC Floor Standing 2–2.5PK   : Rp250.000/unit
- AC Floor Standing 3PK       : Rp300.000/unit
- AC Floor Standing 4PK       : Rp400.000/unit
- AC Floor Standing 5PK       : Rp500.000/unit
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
- Pasang AC Floor Standing    : Rp900.000
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
- Jika nominal transfer > total invoice karena biaya admin/transfer bank (selisih ≤ Rp 5.000), tetap anggap LUNAS dan jalankan MARK_PAID — jangan tanya konfirmasi tambahan
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
[ACTION]{"type":"UPDATE_INVOICE","id":"INV-xxx","field":"discount","value":50000}[/ACTION]
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

// ── Group Payment Modal ──
function GroupPaymentModal({ ctx, onConfirm, onClose, fmt, cs }) {
  const { invoices, suggestedAmount, proofUrl: initProof, method: initMethod } = ctx;
  const [selected, setSelected] = useState(invoices.map(i => i.id));
  const [received, setReceived] = useState(suggestedAmount || invoices.reduce((s, i) => s + (i.status === "PARTIAL_PAID" ? (i.remaining_amount ?? ((i.total||0)-(i.paid_amount||0))) : (i.total||0)), 0));
  const [proofUrl, setProofUrl] = useState(initProof || "");
  const [method, setMethod] = useState(initMethod || "transfer");
  const [loading, setLoading] = useState(false);

  const selectedInvoices = invoices.filter(i => selected.includes(i.id));
  // Untuk PARTIAL_PAID: tagihan efektif = remaining, bukan total
  const effectiveTagihan = (inv) => inv.status === "PARTIAL_PAID"
    ? (inv.remaining_amount ?? ((inv.total || 0) - (inv.paid_amount || 0)))
    : (inv.total || 0);
  const totalTagihan = selectedInvoices.reduce((s, i) => s + effectiveTagihan(i), 0);
  const isPartial = received < totalTagihan;
  const isOver = received > totalTagihan;

  // Preview alokasi greedy (sama dengan handleGroupPayment)
  const sorted = [...selectedInvoices].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let sisa = received;
  const preview = sorted.map(inv => {
    const tagihan = effectiveTagihan(inv);
    if (sisa <= 0) return { inv, cover: 0, full: false };
    if (sisa >= tagihan) { const c = tagihan; sisa -= tagihan; return { inv, cover: c, full: true }; }
    const c = sisa; sisa = 0; return { inv, cover: c, full: false };
  });

  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: cs.card, borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", border: "1px solid " + cs.border }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: cs.text, marginBottom: 4 }}>💳 Group Payment</div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 16 }}>
          Customer punya {invoices.length} invoice unpaid — pilih yang akan dibayar sekarang.
        </div>

        {/* Pilih invoice */}
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {invoices.map(inv => (
            <label key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, background: cs.surface, borderRadius: 10, padding: "10px 12px", cursor: "pointer", border: "1px solid " + (selected.includes(inv.id) ? cs.accent + "66" : cs.border) }}>
              <input type="checkbox" checked={selected.includes(inv.id)} onChange={() => toggle(inv.id)}
                style={{ width: 16, height: 16, accentColor: cs.accent, cursor: "pointer" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, fontFamily: "monospace" }}>{inv.id}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>{inv.service} · {inv.status === "PARTIAL_PAID" ? "💳 Partial" : inv.status}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {inv.status === "PARTIAL_PAID" ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 13, color: "#06b6d4" }}>Sisa {fmt(effectiveTagihan(inv))}</div>
                    <div style={{ fontSize: 10, color: cs.muted }}>dari {fmt(inv.total)}</div>
                  </>
                ) : (
                  <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>{fmt(inv.total)}</div>
                )}
              </div>
            </label>
          ))}
        </div>

        {/* Total tagihan */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 12, padding: "8px 12px", background: cs.surface, borderRadius: 8 }}>
          <span style={{ color: cs.muted }}>Total Tagihan</span>
          <span style={{ fontWeight: 800, color: cs.text }}>{fmt(totalTagihan)}</span>
        </div>

        {/* Input jumlah diterima */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Jumlah Diterima dari Customer</div>
          <input type="number" value={received} onChange={e => setReceived(Number(e.target.value))}
            style={{ width: "100%", background: cs.surface, border: "1px solid " + (isPartial ? "#f59e0b66" : isOver ? "#ef444466" : cs.border), borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 14, fontWeight: 700, boxSizing: "border-box" }} />
          {isPartial && (
            <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
              Partial — sisa {fmt(totalTagihan - received)} belum terbayar (akan di-record PARTIAL_PAID)
            </div>
          )}
          {isOver && (
            <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>
              Lebih bayar {fmt(received - totalTagihan)} — pastikan angka benar sebelum konfirmasi
            </div>
          )}
        </div>

        {/* Metode */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Metode Pembayaran</div>
          <select value={method} onChange={e => setMethod(e.target.value)}
            style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }}>
            <option value="transfer">Transfer Bank</option>
            <option value="transfer_bca">Transfer BCA</option>
            <option value="transfer_bni">Transfer BNI</option>
            <option value="transfer_bri">Transfer BRI</option>
            <option value="transfer_mandiri">Transfer Mandiri</option>
            <option value="transfer_gopay">GoPay</option>
            <option value="transfer_ovo">OVO</option>
            <option value="transfer_dana">DANA</option>
            <option value="cash">Tunai</option>
          </select>
        </div>

        {/* URL bukti bayar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>URL Bukti Bayar (foto dari WA / R2)</div>
          <input value={proofUrl} onChange={e => setProofUrl(e.target.value)}
            placeholder="https://... atau /api/foto/... — akan dipakai untuk semua invoice"
            style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 12, boxSizing: "border-box" }} />
          {proofUrl && (
            <div style={{ fontSize: 11, color: cs.green, marginTop: 3 }}>1 foto ini akan jadi bukti untuk semua {selected.length} invoice yang dipilih</div>
          )}
        </div>

        {/* Preview alokasi */}
        {preview.length > 0 && (
          <div style={{ marginBottom: 16, background: cs.surface, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>Preview Alokasi</div>
            {preview.map(({ inv, cover, full }) => (
              <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: cs.text, fontFamily: "monospace" }}>{inv.id}</span>
                <span style={{ color: full ? cs.green : cover > 0 ? "#f59e0b" : cs.muted, fontWeight: 700 }}>
                  {full ? `✅ ${fmt(cover)} LUNAS` : cover > 0 ? `⚡ ${fmt(cover)} (partial)` : `— belum terbayar`}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            Batal
          </button>
          <button
            disabled={loading || selected.length === 0 || received <= 0}
            onClick={async () => {
              setLoading(true);
              try { await onConfirm(selected, received, proofUrl || null, method); }
              finally { setLoading(false); }
            }}
            style={{ flex: 2, background: loading ? cs.muted : "#22c55e", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: loading || selected.length === 0 ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14 }}>
            {loading ? "Memproses..." : `✅ Konfirmasi ${fmt(received)}`}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [activeMenu, setActiveMenu] = useState(() => {
    try {
      const saved = localStorage.getItem("aclean_lastMenu");
      return saved || "dashboard";
    } catch { return "dashboard"; }
  });
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
  const LAP_PAGE_SIZE = 10;
  const AGENT_LOG_PAGE_SIZE = 20;

  // ── Laporan Tim ──
  const [laporanReports, setLaporanReports] = useState([]);
  const [projectDailyReports, setProjectDailyReports] = useState([]); // laporan harian project (project_daily_reports)
  const [selectedLaporan, setSelectedLaporan] = useState(null);
  const [modalLaporanDetail, setModalLaporanDetail] = useState(false);
  const [editLaporanMode, setEditLaporanMode] = useState(false);
  const [editLaporanForm, setEditLaporanForm] = useState({});
  const [activeEditUnitIdx, setActiveEditUnitIdx] = useState(0);

  // ── WA panel ──
  const [waPanel, setWaPanel] = useState(false);
  const [selectedConv, setSelectedConv] = useState(null);
  const [waInput, setWaInput] = useState("");

  // ── Commission PIN protection (KOMISI SAYA) ──
  const [commissionUnlocked, setCommissionUnlocked] = useState(false);
  const [commissionPinAttempt, setCommissionPinAttempt] = useState("");
  const [commissionPinError, setCommissionPinError] = useState("");
  // livePin: PIN terbaru dari DB saat buka menu Komisi (anti session-basi bila Owner set PIN
  // setelah teknisi login). undefined = belum di-fetch (loading), null = tidak ada PIN, string = ada PIN.
  const [livePin, setLivePin] = useState(undefined);

  // ── Dynamic bonus categories (loaded from app_settings, fallback ke default) ──
  const [bonusCategories, setBonusCategories] = useState(DEFAULT_BONUS_CATEGORIES);
  // Build BONUS_LABELS & BONUS_DEFAULTS from bonusCategories dynamically
  const BONUS_LABELS = useMemo(() => {
    const labels = {};
    bonusCategories.forEach(cat => { labels[cat.id] = cat.label; });
    return labels;
  }, [bonusCategories]);
  const BONUS_DEFAULTS = useMemo(() => {
    const defaults = {};
    bonusCategories.forEach(cat => { defaults[cat.id] = cat.amount; });
    return defaults;
  }, [bonusCategories]);

  // Team daily slots cache (untuk modal order — baca dari Planning Order) ──
  const [teamDailyCache, setTeamDailyCache] = useState({}); // date → [{slot,member1,member1_role,member2,...}]
  const loadTeamDaily = async (date) => {
    if (!date || teamDailyCache[date]) return;
    const { data } = await supabase.from("daily_team_slots").select("slot,member1,member1_role,member2,member2_role,confirmed").eq("date", date);
    if (data) setTeamDailyCache(p => ({ ...p, [date]: data }));
  };

  // ── Modals ──
  const [modalOrder, setModalOrder] = useState(false);
  const [modalStok, setModalStok] = useState(false);
  const [modalWaTek, setModalWaTek] = useState(false); // popup pilihan pesan WA teknisi ke customer
  const [waTekTarget, setWaTekTarget] = useState(null);  // { phone, customer, service, time, address }
  const [modalTeknisi, setModalTeknisi] = useState(false);
  const [editTeknisi, setEditTeknisi] = useState(null);

  // Owner buka Edit Anggota → ambil data rekening (sensitif, tidak ikut di teknisiData)
  useEffect(() => {
    if (!modalTeknisi || !editTeknisi?.id || currentUser?.role !== "Owner") return;
    const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
    if (!isUUID(editTeknisi.id)) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("user_profiles")
        .select("bank_name, bank_account_no, bank_holder, work_start_date")
        .eq("id", editTeknisi.id).single();
      if (cancelled || !data) return;
      setNewTeknisiForm(f => ({ ...f, ...data }));
    })();
    return () => { cancelled = true; };
  }, [modalTeknisi, editTeknisi?.id, currentUser?.role]);
  const [modalEditStok, setModalEditStok] = useState(false);
  const [editStokItem, setEditStokItem] = useState(null);
  const [modalRestock, setModalRestock] = useState(false);
  const [restockItem, setRestockItem] = useState(null);
  const [modalBrainEdit, setModalBrainEdit] = useState(false);

  // ── Form laporan (teknisi) — v3 multi-unit ──
  const [laporanModal, setLaporanModal] = useState(null);
  const [laporanStep, setLaporanStep] = useState(1);
  const [laporanSubmitted, setLaporanSubmitted] = useState(false);
  const submitLaporanLock = useRef(false); // persistent lock — tidak hilang saat re-render
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
  const [editStockMats, setEditStockMats] = useState([]);     // stock-linked materials (tabung/roll) for edit modal
  const [laporanRekomendasi, setLaporanRekomendasi] = useState("");
  const [laporanCatatan, setLaporanCatatan] = useState("");
  const [laporanSurveyHasil, setLaporanSurveyHasil] = useState("");
  const [laporanSurveyCatatan, setLaporanSurveyCatatan] = useState("");
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
  // ── Tambah unit dari daftar Maintenance (untuk order B2B/maintenance) ──
  const [maintUnitPool, setMaintUnitPool] = useState([]);            // semua unit terdaftar klien
  const [showAddMaintUnitModal, setShowAddMaintUnitModal] = useState(false);
  const [addMaintSelected, setAddMaintSelected] = useState(new Set()); // Set of maintenance unit ids to add
  // ── Registry unit AC permanen (customer reguler) — forward-only sejak cutoff ──
  // Picker open-state dikelola lokal di LaporanTeknisiModal (cermin maint). App pegang datanya.
  const [acUnitPool, setAcUnitPool] = useState([]);                 // ac_units aktif customer ini
  const fotoInputRef = useRef();
  const fotoUnitInputRef = useRef(); // input khusus uploader foto per-unit di Step 2
  const fotoTargetUnitRef = useRef(null); // unit_no untuk foto yg di-upload dari tab unit (null = umum)

  // ── Session Management ──
  const lastSessionCheckRef = useRef(0); // Track last session check to avoid excessive checks

  // ── New order / stok / customer form ──
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false); // anti double submit
  const _orderSubmitLock = useRef(false); // ref-level lock (state updates batch, ref updates instantly)
  const _maintAutoDetectRef = useRef(false); // flag: maintenance client di-detect otomatis → centang semua unit
  const [matTrackFilter, setMatTrackFilter] = useState("Semua"); // filter kategori material
  const [matTrackSearch, setMatTrackSearch] = useState("");
  const [matTrackDateFrom, setMatTrackDateFrom] = useState("");
  const [matTrackDateTo, setMatTrackDateTo] = useState("");
  const [invTxData, setInvTxData] = useState([]);

  // ── Biaya / Expenses ──
  const [expensesData, setExpensesData] = useState([]);
  const [kasbonRequests, setKasbonRequests] = useState([]);
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

  const [schedListFilter, setSchedListFilter] = useState("minggu_ini"); // "hari_ini" | "minggu_ini" | "semua"
  const [invUnitsData, setInvUnitsData] = useState([]); // unit fisik per item (tabung/roll)
  const [showAddStock, setShowAddStock] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState({ customer: "", phone: "", address: "", area: "", service: "Cleaning", type: "AC Split 0.5-1PK", units: 1, teknisi: "", helper: "", team_slot: "", date: "", time: "09:00", notes: "", maintenance_client_id: "", maintenance_unit_ids: [] });
  // Maintenance korporat (Opsi B): daftar klien & unit untuk dipilih saat buat order
  const [maintClientsForOrder, setMaintClientsForOrder] = useState([]);
  const [maintUnitsForOrder, setMaintUnitsForOrder] = useState([]);
  // Server-side lookup customer by phone — anti miss customer di luar limit fetchCustomers
  const [orderPhoneLookup, setOrderPhoneLookup] = useState({ phone: "", matches: [] });
  // Auto-detect pekerjaan lanjutan: order OPEN customer yg sama dalam H-3
  const [continuationSuggestion, setContinuationSuggestion] = useState([]); // kandidat parent jobs
  const [continuationParentId, setContinuationParentId] = useState(null);   // null=belum pilih, ""=decline, "JOB-x"=confirmed
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

  // Quotation state
  const [quotationsData, setQuotationsData] = useState([]);
  // BAP modal state — order/job yang sedang dibuat BAP-nya
  const [bapModalOrder, setBapModalOrder] = useState(null);
  const openBAPModal = (order) => setBapModalOrder(order);

  // ── Kasbon: approve → auto-insert ke expenses (Kasbon Karyawan) ──
  const approveKasbon = async (req, reviewNotes = "") => {
    // ATOMIC CLAIM: update status hanya jika MASIH PENDING (.eq status filter).
    // PostgREST/Postgres update bersifat atomic per-row → hanya 1 caller konkuren yang
    // dapat baris (rows.length===1); caller kedua dapat 0 baris → skip, cegah double-expense.
    const { data: claimed, error: claimErr } = await supabase
      .from("kasbon_requests")
      .update({
        status: "APPROVED",
        reviewed_at: new Date().toISOString(),
        reviewed_by: currentUser?.name || auditUserName(),
        review_notes: reviewNotes || null,
      })
      .eq("id", req.id)
      .eq("status", "PENDING")
      .select();
    if (claimErr) { showNotif("❌ Gagal proses kasbon: " + claimErr.message); return; }
    if (!claimed || claimed.length === 0) {
      showNotif("⚠️ Kasbon ini sudah diproses sebelumnya");
      return;
    }

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
    // Tanggal Biaya = tanggal REQUEST kasbon (bukan tanggal approve) agar tidak geser kalau
    // approve-nya telat (mis. request sore, baru di-ACC besok pagi). Fallback ke hari ini.
    const kasbonDate = (req.requested_at || req.created_at)
      ? new Date(req.requested_at || req.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })
      : today;
    // dedup_key cross-channel (migrasi 094): kasbon yang sama bisa masuk dari WA Finance
    // grup (jalur wa_group_kasbon di api/[route].js juga isi dedup_key) DAN dari approve di
    // app ini. Tanpa key yang identik, unique index expenses.dedup_key tak bisa nangkep →
    // double. Format WAJIB sama persis dengan buildExpenseDedupKey() di api/_expense-dedup.js:
    // `${lower(name)}|${date}|${amount}|${lower(subcategory)}`.
    const kasbonDedupKey = (() => {
      const name = String(req.teknisi_name || "").trim().toLowerCase();
      const amt = Number(req.amount);
      if (!name || !amt || !kasbonDate) return null;
      return `${name}|${kasbonDate}|${amt}|kasbon karyawan`;
    })();
    // id expenses dibiarkan default (UUID gen_random_uuid) — jangan kirim id custom (kolom UUID).
    const expPayload = {
      category: "petty_cash",
      subcategory: "Kasbon Karyawan",
      teknisi_name: (req.teknisi_name || "").trim(),
      amount: req.amount,
      date: kasbonDate,
      description: "Kasbon: " + (req.reason || ""),
      validation_status: "APPROVED",
      last_changed_by: auditUserName(),
      dedup_key: kasbonDedupKey,
    };
    const { data: expData, error: eErr } = await insertExpense(supabase, expPayload);
    if (eErr) {
      // 23505 = unique violation di expenses.dedup_key → kasbon yang sama SUDAH tercatat
      // via WA Finance grup. Ini BUKAN kegagalan: link ke expense yang ada, biarkan status
      // APPROVED (klaim atomic sudah jalan), JANGAN rollback ke PENDING & JANGAN gandakan.
      if (eErr.code === "23505" || /duplicate key|dedup_key/i.test(eErr.message || "")) {
        let existingId = null;
        if (kasbonDedupKey) {
          const { data: ex } = await supabase
            .from("expenses").select("id")
            .eq("dedup_key", kasbonDedupKey).is("deleted_at", null)
            .limit(1).maybeSingle();
          existingId = ex?.id || null;
        }
        if (existingId) await updateKasbonRequest(supabase, req.id, { expense_id: existingId });
        setKasbonRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "APPROVED", expense_id: existingId, reviewed_by: currentUser?.name } : r));
        if (req.teknisi_phone) sendWA(req.teknisi_phone, `✅ *Kasbon Disetujui*\n\nHalo ${req.teknisi_name},\nRequest kasbon Rp ${Number(req.amount).toLocaleString("id-ID")} sudah disetujui oleh ${currentUser?.name || "Admin"}.\n\nKeperluan: ${req.reason}\n${reviewNotes ? "Catatan: " + reviewNotes + "\n" : ""}\n— ${appSettings?.app_name || "AClean"}`);
        addAgentLog("KASBON_APPROVED", `Kasbon ${req.id} (${req.teknisi_name} Rp${Number(req.amount).toLocaleString("id-ID")}) diapprove — biaya sudah tercatat via WA grup (dedup, tidak digandakan) → expense ${existingId || "?"}`, "SUCCESS");
        showNotif(`✅ Kasbon ${req.teknisi_name} diapprove (biaya sudah tercatat via WA grup, tidak digandakan)`);
        return;
      }
      // Error lain → rollback klaim ke PENDING agar bisa diproses ulang.
      await supabase.from("kasbon_requests").update({ status: "PENDING", reviewed_at: null, reviewed_by: null, review_notes: null }).eq("id", req.id);
      showNotif("❌ Gagal catat ke Biaya: " + eErr.message);
      return;
    }
    const expId = expData?.id;  // UUID hasil generate DB
    setExpensesData(prev => [expData || expPayload, ...prev]);

    // Link expense_id ke request yang sudah diklaim
    await updateKasbonRequest(supabase, req.id, { expense_id: expId });
    setKasbonRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "APPROVED", expense_id: expId, reviewed_by: currentUser?.name } : r));

    // WA notif ke teknisi
    if (req.teknisi_phone) sendWA(req.teknisi_phone, `✅ *Kasbon Disetujui*\n\nHalo ${req.teknisi_name},\nRequest kasbon Rp ${Number(req.amount).toLocaleString("id-ID")} sudah disetujui oleh ${currentUser?.name || "Admin"}.\n\nKeperluan: ${req.reason}\n${reviewNotes ? "Catatan: " + reviewNotes + "\n" : ""}\n— ${appSettings?.app_name || "AClean"}`);
    addAgentLog("KASBON_APPROVED", `Kasbon ${req.id} (${req.teknisi_name} Rp${Number(req.amount).toLocaleString("id-ID")}) diapprove → expense ${expId}`, "SUCCESS");
    showNotif(`✅ Kasbon ${req.teknisi_name} Rp${Number(req.amount).toLocaleString("id-ID")} diapprove & dicatat ke Biaya`);
  };

  const rejectKasbon = async (req, reviewNotes = "") => {
    await updateKasbonRequest(supabase, req.id, {
      status: "REJECTED",
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser?.name || auditUserName(),
      review_notes: reviewNotes || null,
    });
    setKasbonRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "REJECTED", reviewed_by: currentUser?.name } : r));
    if (req.teknisi_phone) sendWA(req.teknisi_phone, `❌ *Kasbon Ditolak*\n\nHalo ${req.teknisi_name},\nRequest kasbon Rp ${Number(req.amount).toLocaleString("id-ID")} ditolak oleh ${currentUser?.name || "Admin"}.\n\nKeperluan: ${req.reason}\n${reviewNotes ? "Alasan: " + reviewNotes + "\n" : ""}\n— ${appSettings?.app_name || "AClean"}`);
    addAgentLog("KASBON_REJECTED", `Kasbon ${req.id} (${req.teknisi_name}) ditolak`, "INFO");
    showNotif(`✅ Kasbon ${req.teknisi_name} ditolak`);
  };
  const onBAPSubmitted = (newReport) => {
    setLaporanReports(prev => [newReport, ...prev.filter(r => r.id !== newReport.id)]);
    setBapModalOrder(null);
    // Refresh pending count — bisa naik (kalau offline) atau turun (kalau langsung sync)
    listPendingBAP().then(items => setPendingBAPCount(items.length)).catch(() => {});
  };
  // BAP offline queue — count untuk indikator, auto-sync periodic & on online
  const [pendingBAPCount, setPendingBAPCount] = useState(0);
  const [bapSyncing, setBapSyncing] = useState(false);

  // Bawa Material modal — teknisi/helper declare unit material yang dibawa per job
  const [materialBringJob, setMaterialBringJob] = useState(null);
  const openMaterialBringModal = (order) => setMaterialBringJob(order);
  // SATU PINTU laporan & material per job (Fase 2) — hub yang membuka bring + laporan
  const [jobReportJob, setJobReportJob] = useState(null);
  const openJobReport = (order) => setJobReportJob(order);
  // Map job_id → count brought (status BROUGHT/USED), untuk badge tombol Bawa Material
  const [materialsBroughtMap, setMaterialsBroughtMap] = useState({});
  const refreshMaterialsBroughtMap = async () => {
    try {
      const { data } = await supabase.from("job_materials_brought")
        .select("job_id, status")
        .in("status", ["BROUGHT", "USED"]);
      const m = {};
      (data || []).forEach(r => { m[r.job_id] = (m[r.job_id] || 0) + 1; });
      setMaterialsBroughtMap(m);
    } catch (_) { /* ignore */ }
  };
  useEffect(() => { refreshMaterialsBroughtMap(); /* eslint-disable-next-line */ }, []);

  // Server-side search (Opsi B) — extra hasil dari DB di luar window 300/500 default
  const [searchInvExt, setSearchInvExt] = useState([]);
  const [searchOrdExt, setSearchOrdExt] = useState([]);
  const [searchInvLoading, setSearchInvLoading] = useState(false);
  const [searchOrdLoading, setSearchOrdLoading] = useState(false);
  const [searchLapExt, setSearchLapExt] = useState([]);
  const [searchLapLoading, setSearchLapLoading] = useState(false);

  // GAP 3 — State untuk edit invoice
  const [modalEditInvoice, setModalEditInvoice] = useState(false);
  const [editInvoiceData, setEditInvoiceData] = useState(null);
  const [editInvoiceForm, setEditInvoiceForm] = useState({});
  const [editInvoiceItems, setEditInvoiceItems] = useState([]); // per-item edit
  // ── Confirm Modal (ganti window.confirm) ──
  const [confirmModal, setConfirmModal] = useState(null);
  // confirmModal = { title, message, icon, danger, onConfirm, onCancel, confirmText, cancelText }
  const showConfirm = (opts) => new Promise(resolve => {
    const userOnConfirm = opts.onConfirm;
    const userOnCancel  = opts.onCancel;
    setConfirmModal({
      ...opts,
      onConfirm: async () => {
        setConfirmModal(null);
        try { await userOnConfirm?.(); } catch (e) { console.error("[showConfirm.onConfirm]", e); }
        resolve(true);
      },
      onCancel: () => {
        setConfirmModal(null);
        try { userOnCancel?.(); } catch (e) { console.error("[showConfirm.onCancel]", e); }
        resolve(false);
      },
    });
  });

  const [modalEditPwd, setModalEditPwd] = useState(false);
  const [editPwdTarget, setEditPwdTarget] = useState(null); // {id, name}
  const [editPwdForm, setEditPwdForm] = useState({ newPwd: "", confirmPwd: "" });
  const [editJasaItems, setEditJasaItems] = useState([]); // jasa items per-row
  // editAddType/editAddSearch/voucher state → dipindahkan ke EditInvoiceModal.jsx

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
    bap_enabled: "false",
    foto_compression_quality: "0.70",
    // White-label branding
    app_name: "AClean",
    ai_name: "ARA",
    logo_url: "",
    // Configurable business logic
    service_types_json: "",
    area_utama: "",
    area_konfirmasi: "",
  });

  // Service types — bisa override via app_settings.service_types_json (JSON array)
  const effectiveServiceTypes = useMemo(() => {
    const p = safeJsonParse(appSettings.service_types_json, null);
    return Array.isArray(p) && p.length > 0 ? p : SERVICE_TYPES;
  }, [appSettings.service_types_json]);

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
  // SEC-02: internal API token — App Token JWT (15 menit expiry, per-user, role claim)
  // Cached di memory, auto-refresh 1 menit sebelum expiry. Tidak di localStorage/bundle.
  const _internalTokenRef = useRef(null);
  const _internalTokenExpRef = useRef(0); // epoch ms saat token harus di-refresh
  const _exchangeApiToken = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      let jwt = data?.session?.access_token;
      if (!jwt) {
        const refreshed = await supabase.auth.refreshSession();
        jwt = refreshed?.data?.session?.access_token;
      }
      if (!jwt) return;
      const r = await fetch("/api/get-api-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` }
      });
      if (r.ok) {
        const d = await r.json();
        if (d.token) {
          _internalTokenRef.current = d.token;
          // Refresh 1 menit sebelum expiry (default 15 menit → refresh setelah 14 menit)
          const ttl = (d.expiresIn || 900) - 60;
          _internalTokenExpRef.current = Date.now() + ttl * 1000;
        }
      }
    } catch { /* gagal silent — request tetap jalan tanpa token */ }
  };
  const _apiHeaders = async () => {
    if (!_internalTokenRef.current || Date.now() >= _internalTokenExpRef.current) {
      await _exchangeApiToken();
    }
    return {
      "Content-Type": "application/json",
      ...(_internalTokenRef.current ? { "X-Internal-Token": _internalTokenRef.current } : {})
    };
  };
  // Fetch wrapper: kalau 401, force-refresh token sekali lalu retry.
  // Gunakan ini di tempat-tempat baru. Existing fetch() yang pakai _apiHeaders() tetap jalan.
  const _apiFetch = async (url, opts = {}) => {
    const headers = { ...(opts.headers || {}), ...(await _apiHeaders()) };
    let r = await fetch(url, { ...opts, headers });
    if (r.status === 401) {
      _internalTokenRef.current = null;
      _internalTokenExpRef.current = 0;
      const fresh = { ...(opts.headers || {}), ...(await _apiHeaders()) };
      r = await fetch(url, { ...opts, headers: fresh });
    }
    return r;
  };

  // Server-side search Invoice — debounce 350ms; reset hasil saat search dibersihkan
  useEffect(() => {
    const q = (searchInvoice || "").trim();
    if (q.length < 2) { setSearchInvExt([]); setSearchInvLoading(false); return; }
    let cancelled = false;
    setSearchInvLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await searchInvoicesServer(supabase, q);
        if (!cancelled) setSearchInvExt(data || []);
      } catch (_) { if (!cancelled) setSearchInvExt([]); }
      finally { if (!cancelled) setSearchInvLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); setSearchInvLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInvoice]);

  // Server-side search Order — pola sama
  useEffect(() => {
    const q = (searchOrder || "").trim();
    if (q.length < 2) { setSearchOrdExt([]); setSearchOrdLoading(false); return; }
    let cancelled = false;
    setSearchOrdLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await searchOrdersServer(supabase, q);
        if (!cancelled) setSearchOrdExt(data || []);
      } catch (_) { if (!cancelled) setSearchOrdExt([]); }
      finally { if (!cancelled) setSearchOrdLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); setSearchOrdLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOrder]);

  // Server-side search Laporan — jangkau report lama di luar cap startup (PostgREST 1000). Pola sama invoice/order.
  useEffect(() => {
    const q = (searchLaporan || "").trim();
    if (q.length < 2) { setSearchLapExt([]); setSearchLapLoading(false); return; }
    let cancelled = false;
    setSearchLapLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await searchServiceReportsServer(supabase, q);
        // Parse selaras parseLaporan di loadAll (units_json/materials_json sudah tak di-fetch → pakai jsonb)
        const parsed = (data || []).map(r => ({
          ...r,
          units: safeArr(r.units),
          materials: safeArr(r.materials_used),
          fotos: r.fotos || (r.foto_urls || []).map((url, i) => ({ id: i, label: `Foto ${i + 1}`, url })),
          editLog: safeArr(r.edit_log ?? r.editLog),
          rekomendasi: r.rekomendasi || "",
          catatan_global: r.catatan_global || r.catatan || "",
          submitted: r.submitted || (r.submitted_at || "").slice(0, 16).replace("T", " "),
          status: r.status || "SUBMITTED",
        }));
        if (!cancelled) setSearchLapExt(parsed);
      } catch (_) { if (!cancelled) setSearchLapExt([]); }
      finally { if (!cancelled) setSearchLapLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); setSearchLapLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLaporan]);

  // Merge local + server (dedup by id) — hanya untuk filter & display, bukan state global
  const invoicesDataMerged = useMemo(() => {
    if (!searchInvExt.length) return invoicesData;
    const ids = new Set(invoicesData.map(i => i.id));
    const extras = searchInvExt.filter(i => !ids.has(i.id));
    return extras.length ? [...invoicesData, ...extras] : invoicesData;
  }, [invoicesData, searchInvExt]);

  const ordersDataMerged = useMemo(() => {
    if (!searchOrdExt.length) return ordersData;
    const ids = new Set(ordersData.map(o => o.id));
    const extras = searchOrdExt.filter(o => !ids.has(o.id));
    return extras.length ? [...ordersData, ...extras] : ordersData;
  }, [ordersData, searchOrdExt]);

  const laporanReportsMerged = useMemo(() => {
    if (!searchLapExt.length) return laporanReports;
    const ids = new Set(laporanReports.map(r => r.id));
    const extras = searchLapExt.filter(r => !ids.has(r.id));
    return extras.length ? [...laporanReports, ...extras] : laporanReports;
  }, [laporanReports, searchLapExt]);

  // ── Jaring pengaman global: ordersData tak pernah simpan id ganda. ──
  // Beberapa jalur (realtime INSERT + create/confirm order WA) sesekali menyisipkan
  // entri dobel ke state → bikin baris dobel di Order Masuk DAN salah-hitung di
  // stats/Dashboard. Dedup di satu titik ini menjaga semua view + agregasi bersih.
  // Guard `uniq.length === prev.length ? prev` mencegah loop re-render.
  useEffect(() => {
    setOrdersData(prev => {
      if (!Array.isArray(prev) || prev.length < 2) return prev;
      const seen = new Set();
      const uniq = prev.filter(o => {
        if (!o || !o.id) return true;
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });
      return uniq.length === prev.length ? prev : uniq;
    });
  }, [ordersData]);

  // BAP offline sync worker — trigger flush + refresh counter
  const triggerBAPSync = async () => {
    if (bapSyncing) return;
    try {
      setBapSyncing(true);
      const res = await flushBAPQueue({
        supabase, apiHeaders: _apiHeaders,
        onSynced: (finalReport) => {
          setLaporanReports(prev => {
            const exists = prev.some(r => r.id === finalReport.id);
            const next = { ...finalReport, _pendingSync: undefined };
            return exists ? prev.map(r => r.id === finalReport.id ? next : r) : [next, ...prev];
          });
        },
      });
      setPendingBAPCount(res.remaining);
      if (res.synced > 0) showNotif?.(`☁️ ${res.synced} BAP berhasil di-sync`);
    } catch (e) {
      console.warn("[BAP sync]", e?.message);
    } finally {
      setBapSyncing(false);
    }
  };

  // Mount: load initial pending count + listener online + periodic
  useEffect(() => {
    let stopped = false;
    listPendingBAP().then(items => { if (!stopped) setPendingBAPCount(items.length); }).catch(() => {});
    const onOnline = () => triggerBAPSync();
    window.addEventListener("online", onOnline);
    const iv = setInterval(() => {
      if (navigator.onLine !== false) {
        listPendingBAP().then(items => {
          if (items.length > 0) triggerBAPSync();
          setPendingBAPCount(items.length);
        }).catch(() => {});
      }
    }, 30_000);
    return () => { stopped = true; window.removeEventListener("online", onOnline); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [waSearch, setWaSearch] = useState("");
  const [paymentSuggestions, setPaymentSuggestions] = useState([]);
  const [paymentSuggestBanner, setPaymentSuggestBanner] = useState(null);
  const [groupPaymentCtx, setGroupPaymentCtx] = useState(null); // { phone, invoices, suggestedAmount, proofUrl }

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

  // Undo toast: simpan data yang baru dihapus untuk 10 detik
  const [undoToast, setUndoToast] = useState(null); // { label, onUndo, timer }
  const showUndoToast = (label, onUndo) => {
    if (undoToast?.timer) clearTimeout(undoToast.timer);
    const timer = setTimeout(() => setUndoToast(null), 10000);
    setUndoToast({ label, onUndo, timer });
  };
  const dismissUndoToast = () => {
    if (undoToast?.timer) clearTimeout(undoToast.timer);
    setUndoToast(null);
  };
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
    if (push) pushNotif(appSettings.app_name || "AClean", msg.replace(/[🔔📋✅❌⚠️💰]/g, "").trim());
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

Mohon segera submit laporan di aplikasi ${appSettings.app_name || "AClean"} ya! 🙏`;
        if (tek?.phone) sendWA(tek.phone, msg);
      }
      addAgentLog("LAPORAN_REMINDER", `Reminder laporan dikirim ke ${o.teknisi} — ${o.id}`, "WARNING");
    }
  };

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

  // Downscale data URL foto KHUSUS untuk PDF yang dikirim via WA (Fonnte upload lambat).
  // Foto resolusi penuh tetap di R2; ini hanya mengecilkan salinan yang ditanam ke PDF-WA
  // supaya total PDF kecil (~300-500KB) → upload cepat → PDF murni terkirim, bukan fallback link.
  // Default 850px @ q0.55 — masih jelas untuk dokumentasi servis. Gagal → kembalikan data asli.
  const downscaleDataUrl = (dataUrl, maxDim = 850, quality = 0.55) => new Promise((resolve) => {
    try {
      if (!dataUrl || !dataUrl.startsWith("data:image")) return resolve(dataUrl);
      const img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * sc);
          const h = Math.round(img.height * sc);
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", quality));
        } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl); }
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

  // ── Update membership tier customer setelah order Cleaning/Install selesai ──
  const updateCustomerTierAfterOrder = async (order) => {
    if (!["Cleaning", "Install"].includes(order?.service)) return;
    // Cocokkan ke customer YANG BENAR — bukan phone-only (untuk multi-lokasi phone-only nyasar
    // ke record pertama → counter unit naik di record salah, riwayat di record lain kosong).
    // Prioritas: customer_id (link permanen) > (nama + phone) > nama saja. Selaras buildCustomerHistory.
    const nm = (s) => (s || "").trim().toLowerCase();
    const oPhone = order.phone ? normalizePhone(order.phone) : null;
    let cust = order.customer_id ? customersData.find(c => c.id === order.customer_id) : null;
    if (!cust) cust = customersData.find(c => nm(c.name) === nm(order.customer) && (!oPhone || samePhone(c.phone, oPhone)));
    if (!cust) cust = customersData.find(c => nm(c.name) === nm(order.customer));
    if (!cust?.id) return;
    const addUnits = order.units || 1;
    const newTotal = (cust.total_units_serviced || 0) + addUnits;
    const newTier = newTotal >= 50 ? "platinum" : newTotal >= 30 ? "gold" : "silver";
    if (newTier === (cust.membership_tier || "silver") && newTotal === (cust.total_units_serviced || 0)) return;
    await supabase.from("customers").update({ total_units_serviced: newTotal, membership_tier: newTier }).eq("id", cust.id);
    setCustomersData(prev => prev.map(c => c.id === cust.id ? { ...c, total_units_serviced: newTotal, membership_tier: newTier } : c));
    if (newTier !== (cust.membership_tier || "silver")) {
      const tierLabel = { gold: "🥇 Gold", platinum: "💎 Platinum" }[newTier] || newTier;
      showNotif(`🎉 ${cust.name} naik ke Member ${tierLabel}!`);
      addAgentLog("MEMBER_TIER_UP", `${cust.name} → ${newTier} (${newTotal} unit)`, "SUCCESS");
    }
  };

  // ── Seed-by-confirm registry unit AC (forward-only) setelah laporan disimpan ──
  // Idempotent by (customer_id, lokasi=label): unit ber-ac_unit_id → touch terakhir_service;
  // unit baru ber-label → insert/touch. Tanpa label → dilewati (label posisi wajib utk registry).
  // Hanya customer reguler (non-maintenance) & order >= cutoff. Historis tak tersentuh.
  const seedAcRegistry = async (order, units) => {
    try {
      const cid = order?.customer_id;
      if (!cid || order?.maintenance_client_id) return;
      if ((order?.date || "") < AC_REGISTRY_CUTOFF) return;
      const { data: existing } = await fetchAcUnitsByCustomer(supabase, cid);
      const byLabel = new Map((existing || []).map(u => [String(u.lokasi || "").trim().toLowerCase(), u]));
      for (const u of (units || [])) {
        const label = String(u.label || "").trim();
        const fields = { merk: u.merk || null, tipe: u.tipe || null, pk: u.pk || null, serial_number: u.model || null, terakhir_service: order.date };
        if (u.ac_unit_id) {
          await updateAcUnit(supabase, u.ac_unit_id, fields);
        } else if (label) {
          const hit = byLabel.get(label.toLowerCase());
          if (hit) await updateAcUnit(supabase, hit.id, fields);
          else await insertAcUnit(supabase, { customer_id: cid, lokasi: label, is_active: true, ...fields });
        }
      }
      // Refresh pool kalau modal masih buka untuk customer ini
      if (laporanModal?.customer_id === cid) {
        const { data: fresh } = await fetchAcUnitsByCustomer(supabase, cid);
        if (fresh) setAcUnitPool(fresh);
      }
    } catch (e) { console.warn("[AC_REGISTRY] seed gagal:", e?.message || e); }
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


  const downloadInvoicePDF = async (inv) => {
    showNotif("⏳ Membuat PDF invoice...");
    try {
      const safeName = (inv.customer || "Customer").replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
      const filename = `Invoice_${inv.id}_${safeName}.pdf`;
      const pdfBlob = await generateInvoicePDFBlob(inv);
      addAgentLog("INVOICE_PRINT",
        `Invoice ${inv.id} (${inv.customer}) dicetak oleh ${currentUser?.name || "Unknown"} — Rp${fmt(inv.total)}`,
        "SUCCESS"
      );
      if (!pdfBlob) {
        showNotif("⚠️ Gagal buat PDF — coba lagi");
        return;
      }
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showNotif("✅ PDF invoice berhasil diunduh");
    } catch (err) {
      console.warn("[downloadInvoicePDF] gagal:", err);
      showNotif("⚠️ Gagal membuat PDF: " + (err?.message || "unknown"));
    }
  };


  // Generate Invoice PDF blob via @react-pdf/renderer (reliable, no rasterization)
  // 3-layer cache: memory (LRU) → DB pdf_url (R2) → fresh generation
  const generateInvoicePDFBlob = async (inv, portalLink = null) => {
    const { getCachedPDF, setCachedPDF } = await import("./lib/pdfCache.js");
    const variant = portalLink ? "wpl" : "nopl";
    const version = `${inv.updated_at || inv.created_at || "v0"}:${variant}`;

    // Layer 1: memory cache (fastest, <10ms)
    const memCached = getCachedPDF("invoice", inv.id, version);
    if (memCached) return memCached;

    // Layer 2: DB cache (R2 fetch, ~200-500ms) — hanya untuk variant tanpa portalLink
    if (!portalLink && inv.pdf_url) {
      try {
        const r = await fetch(inv.pdf_url);
        if (r.ok) {
          const blob = await r.blob();
          setCachedPDF("invoice", inv.id, version, blob);
          return blob;
        }
      } catch (err) {
        console.warn("[generateInvoicePDFBlob] fetch cached pdf_url failed:", err.message);
      }
    }

    // Layer 3: generate fresh (~3-5s)
    const { pdf } = await import("@react-pdf/renderer");
    const { default: InvoicePDF } = await import("./components/InvoicePDF.jsx");
    const logoUrl = await fetchInvoiceLogoUrl();
    const blob = await pdf(
      <InvoicePDF inv={inv} logoUrl={logoUrl} appSettings={appSettings} portalLink={portalLink} />
    ).toBlob();
    setCachedPDF("invoice", inv.id, version, blob);

    // Async upload ke R2 + simpan ke DB (non-blocking) — hanya variant tanpa portalLink
    if (!portalLink && blob) {
      cacheInvoicePDFToR2(inv.id, blob).catch(err =>
        console.warn("[generateInvoicePDFBlob] background R2 cache failed:", err.message)
      );
    }
    return blob;
  };

  // Upload PDF blob ke R2 + update invoices.pdf_url di DB. Non-blocking.
  const cacheInvoicePDFToR2 = async (invoiceId, blob) => {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const res = await _apiFetch("/api/upload-foto", {
      method: "POST", headers: await _apiHeaders(),
      body: JSON.stringify({
        base64, filename: `Invoice_${invoiceId}.pdf`,
        folder: "invoices", mimeType: "application/pdf"
      })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success || !d.key) {
      throw new Error(d.error || "upload-foto failed");
    }
    const pdfUrl = `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;
    // Simpan URL di DB — kalau gagal, cache memory tetap valid (degraded mode)
    const { error: upErr } = await supabase
      .from("invoices")
      .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (upErr) console.warn("[cacheInvoicePDFToR2] DB update failed:", upErr.message);
    return pdfUrl;
  };

  const uploadInvoicePDFForWA = async (inv, portalLink = null) => {
    try {
      // Fast path: kalau sudah ada pdf_url di DB & tidak butuh portalLink → langsung pakai
      if (!portalLink && inv.pdf_url) return inv.pdf_url;

      const blob = await generateInvoicePDFBlob(inv, portalLink);
      if (!blob) return null;
      const filename = `Invoice_${inv.id}.pdf`;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await _apiFetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename,
          folder: "invoices", mimeType: "application/pdf"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success && d.key) {
        const pdfUrl = `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;
        // Simpan ke DB juga (kalau variant tanpa portalLink)
        if (!portalLink) {
          supabase.from("invoices")
            .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
            .eq("id", inv.id)
            .then(({ error }) => error && console.warn("[uploadInvoicePDFForWA] DB cache update failed:", error.message));
        }
        return pdfUrl;
      }
      console.warn("[uploadInvoicePDFForWA] upload response:", d);
      return null;
    } catch (err) {
      console.warn("[uploadInvoicePDFForWA] gagal:", err.message);
      return null;
    }
  };

  // Compute deterministic cache key untuk sekumpulan invoice + variant.
  // Format: merge:{sorted_ids_csv}:{max_updated_at}:{variant}
  // Variant berubah kalau invoice di-update (trigger updated_at di DB).
  const computeMergedCacheKey = (invList, portalLink) => {
    const sortedIds = [...invList].map(i => i.id).sort();
    const maxUpdated = invList.reduce((max, i) => {
      const u = i.updated_at || i.created_at || "v0";
      return u > max ? u : max;
    }, "");
    const variant = portalLink ? "wpl" : "nopl";
    return {
      sortedIds,
      cacheKey: `merge:${sortedIds.join(",")}:${maxUpdated}:${variant}`,
      memVersion: `${maxUpdated}:${variant}`,
    };
  };

  // ── Multi-invoice merged PDF (1 dokumen tagihan gabungan: section per pekerjaan, total agregat) ──
  // 3-layer cache: memory LRU → DB merged_pdf_cache (R2 fetch) → generate fresh + async cache
  const generateMergedInvoicePDFBlob = async (invList, portalLink = null) => {
    if (!Array.isArray(invList) || invList.length === 0) return null;
    const { getCachedPDF, setCachedPDF } = await import("./lib/pdfCache.js");
    const { sortedIds, cacheKey, memVersion } = computeMergedCacheKey(invList, portalLink);
    const memId = sortedIds.join(",");

    // Layer 1: memory cache
    const memCached = getCachedPDF("merged", memId, memVersion);
    if (memCached) return memCached;

    // Layer 2: DB cache (R2 fetch) — hanya variant tanpa portalLink
    if (!portalLink) {
      try {
        const { data } = await supabase
          .from("merged_pdf_cache")
          .select("pdf_url")
          .eq("cache_key", cacheKey)
          .maybeSingle();
        if (data?.pdf_url) {
          const r = await fetch(data.pdf_url);
          if (r.ok) {
            const blob = await r.blob();
            setCachedPDF("merged", memId, memVersion, blob);
            // Touch last_used (non-blocking)
            supabase.from("merged_pdf_cache")
              .update({ last_used: new Date().toISOString() })
              .eq("cache_key", cacheKey)
              .then(() => {});
            return blob;
          }
        }
      } catch (err) {
        console.warn("[generateMergedInvoicePDFBlob] DB cache fetch failed:", err.message);
      }
    }

    // Layer 3: generate fresh
    const { pdf } = await import("@react-pdf/renderer");
    const { default: InvoicePDF } = await import("./components/InvoicePDF.jsx");
    const logoUrl = await fetchInvoiceLogoUrl();
    const entries = invList.map(inv => ({ inv, invoiceItems: [] }));
    const blob = await pdf(
      <InvoicePDF invList={entries} unified={true} logoUrl={logoUrl} appSettings={appSettings} portalLink={portalLink} />
    ).toBlob();
    setCachedPDF("merged", memId, memVersion, blob);

    // Async upload R2 + insert DB cache (non-blocking) — hanya variant nopl
    if (!portalLink && blob) {
      cacheMergedPDFToR2(cacheKey, sortedIds, blob).catch(err =>
        console.warn("[generateMergedInvoicePDFBlob] background cache failed:", err.message)
      );
    }
    return blob;
  };

  // Upload merged PDF ke R2 + insert ke merged_pdf_cache table. Non-blocking helper.
  const cacheMergedPDFToR2 = async (cacheKey, invoiceIds, blob) => {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const first = invoiceIds[0] || "merge";
    const filename = `Merge_${first}_x${invoiceIds.length}_${Date.now()}.pdf`;
    const res = await _apiFetch("/api/upload-foto", {
      method: "POST", headers: await _apiHeaders(),
      body: JSON.stringify({ base64, filename, folder: "invoices/merged", mimeType: "application/pdf" })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success || !d.key) {
      throw new Error(d.error || "upload-foto failed");
    }
    const pdfUrl = `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;
    const { error: upErr } = await supabase
      .from("merged_pdf_cache")
      .upsert(
        {
          cache_key: cacheKey,
          invoice_ids: invoiceIds,
          pdf_url: pdfUrl,
          generated_at: new Date().toISOString(),
          last_used: new Date().toISOString(),
        },
        { onConflict: "cache_key" }
      );
    if (upErr) console.warn("[cacheMergedPDFToR2] DB upsert failed:", upErr.message);
    return pdfUrl;
  };

  // Preview tanpa upload — buka di tab baru agar user bisa cek isi PDF sebelum kirim
  const previewMergedInvoicePDF = async (invList) => {
    if (!Array.isArray(invList) || invList.length < 2) {
      showNotif("⚠️ Pilih minimal 2 invoice untuk preview");
      return false;
    }
    showNotif("⏳ Membuat preview PDF...");
    try {
      const sorted = [...invList].sort((a, b) =>
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
      const blob = await generateMergedInvoicePDFBlob(sorted, null);
      if (!blob) { showNotif("⚠️ Gagal buat preview"); return false; }
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return true;
    } catch (err) {
      showNotif("⚠️ Gagal preview: " + (err?.message || "unknown"));
      return false;
    }
  };

  // ── Upload Quotation PDF ke R2 untuk WA attachment ──
  const uploadQuotationPDFForWA = async (quo) => {
    try {
      const { BlobProvider } = await import("@react-pdf/renderer");
      const { default: QuotationPDF } = await import("./components/QuotationPDF.jsx");
      const { createElement } = await import("react");
      const { renderToStream } = await import("@react-pdf/renderer");

      const logoUrl = await fetchInvoiceLogoUrl();
      // Gunakan pendekatan blob via dynamic render
      const blob = await new Promise((resolve, reject) => {
        let resolved = false;
        const doc = createElement(QuotationPDF, { quo, appSettings: appSettings || {}, logoUrl });
        // Render via BlobProvider — tapi kita butuh blob tanpa React DOM
        // Pakai @react-pdf/renderer renderToBlob API
        import("@react-pdf/renderer").then(({ pdf }) => {
          pdf(doc).toBlob().then(b => { resolved = true; resolve(b); }).catch(reject);
        }).catch(reject);
        setTimeout(() => { if (!resolved) reject(new Error("PDF timeout")); }, 15000);
      });
      if (!blob) return null;
      const filename = `Quotation_${quo.id}_${quo.customer?.replace(/\s+/g, "_") || "Customer"}.pdf`;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await _apiFetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({ base64, filename, folder: "quotations", mimeType: "application/pdf" })
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success && d.key) {
        return { url: `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`, filename };
      }
      console.warn("[uploadQuotationPDFForWA] upload response:", d);
      return null;
    } catch (err) {
      console.warn("[uploadQuotationPDFForWA] gagal:", err.message);
      return null;
    }
  };

  const uploadMergedInvoicePDFForWA = async (invList, portalLink = null) => {
    try {
      if (!Array.isArray(invList) || invList.length === 0) return null;
      const { sortedIds, cacheKey } = computeMergedCacheKey(invList, portalLink);
      const first = sortedIds[0] || "merge";
      const filename = `Invoice_Gabungan_${first}_x${sortedIds.length}.pdf`;

      // Fast path: DB cache lookup (hanya variant nopl)
      if (!portalLink) {
        try {
          const { data } = await supabase
            .from("merged_pdf_cache")
            .select("pdf_url")
            .eq("cache_key", cacheKey)
            .maybeSingle();
          if (data?.pdf_url) {
            // Touch last_used (non-blocking)
            supabase.from("merged_pdf_cache")
              .update({ last_used: new Date().toISOString() })
              .eq("cache_key", cacheKey)
              .then(() => {});
            return { url: data.pdf_url, filename };
          }
        } catch (err) {
          console.warn("[uploadMergedInvoicePDFForWA] DB cache lookup failed:", err.message);
        }
      }

      // Generate + upload sync (return URL synchronously untuk WA send)
      const blob = await generateMergedInvoicePDFBlob(invList, portalLink);
      if (!blob) return null;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await _apiFetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64, filename,
          folder: "invoices", mimeType: "application/pdf"
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success || !d.key) {
        console.warn("[uploadMergedInvoicePDFForWA] upload response:", d);
        return null;
      }
      const pdfUrl = `${window.location.origin}/api/foto?key=${encodeURIComponent(d.key)}`;

      // Save ke DB cache (hanya variant nopl) — non-blocking
      if (!portalLink) {
        supabase.from("merged_pdf_cache")
          .upsert(
            {
              cache_key: cacheKey,
              invoice_ids: sortedIds,
              pdf_url: pdfUrl,
              generated_at: new Date().toISOString(),
              last_used: new Date().toISOString(),
            },
            { onConflict: "cache_key" }
          )
          .then(({ error }) => error && console.warn("[uploadMergedInvoicePDFForWA] DB cache upsert failed:", error.message));
      }
      return { url: pdfUrl, filename };
    } catch (err) {
      console.warn("[uploadMergedInvoicePDFForWA] gagal:", err.message);
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

    // ── Photo pages ──
    // Jika foto sudah di-tag per unit (laporan.fotos[].unit_no) → kelompokkan per unit.
    // Kalau tidak (laporan lama) → galeri datar seperti sebelumnya.
    const fotoMeta = Array.isArray(laporan.fotos) ? laporan.fotos.filter(m => m && m.url) : [];
    const hasUnitTags = fotoMeta.some(m => m.unit_no);

    const cellHTML = (url, label) => {
      const dataUrl = photoDataUrls[url] || "";
      const cap = label ? `<div class="photo-num" style="position:static;display:block;text-align:center;margin-top:2px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escH(label)}</div>` : "";
      return dataUrl
        ? `<div class="photo-cell"><img src="${dataUrl}" alt="${escH(label || "Foto")}" />${cap}</div>`
        : `<div class="photo-cell" style="background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px">Foto tidak tersedia</div>`;
    };
    const pageHTML = (title, items) => {
      const pages = [];
      for (let i = 0; i < items.length; i += 6) pages.push(items.slice(i, i + 6));
      return pages.map((chunk, pi) => `
        <div class="photo-page" style="page-break-before:always">
          <div class="photo-page-header">
            <div class="photo-page-title">${escH(title)}${pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ""}</div>
            <div class="photo-page-sub">${escH(laporan.job_id)} · ${escH(laporan.customer)}</div>
          </div>
          <div class="photo-grid">
            ${chunk.map(it => cellHTML(it.url, it.label)).join("")}
          </div>
        </div>`).join("");
    };

    let photoPageHTML;
    if (hasUnitTags) {
      const unitLabel = (no) => {
        const un = units.find(u => Number(u.unit_no) === Number(no));
        return un ? `FOTO UNIT ${no}${un.tipe ? " — " + un.tipe : ""}${un.label ? " (" + un.label + ")" : ""}` : `FOTO UNIT ${no}`;
      };
      const byUnit = {};
      fotoMeta.forEach(m => { const k = m.unit_no ? String(m.unit_no) : "_umum"; (byUnit[k] = byUnit[k] || []).push({ url: m.url, label: m.label }); });
      // Foto flat yg tak ada di meta (safety) → grup umum
      const tagged = new Set(fotoMeta.map(m => m.url));
      fotos.forEach(url => { if (!tagged.has(url)) (byUnit["_umum"] = byUnit["_umum"] || []).push({ url, label: "" }); });
      const unitKeys = Object.keys(byUnit).filter(k => k !== "_umum").sort((a, b) => Number(a) - Number(b));
      photoPageHTML = [
        ...unitKeys.map(k => pageHTML(unitLabel(k), byUnit[k])),
        ...(byUnit["_umum"] ? [pageHTML("DOKUMENTASI FOTO — UMUM", byUnit["_umum"])] : []),
      ].join("");
    } else {
      photoPageHTML = pageHTML("DOKUMENTASI FOTO", fotos.map((url, i) => ({ url, label: "" })));
    }

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
      ? `<div class="logo-wrap"><img src="${logoUrl}" alt="${appSettings.app_name || "AClean"}"/></div>`
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

<!-- CATATAN & REKOMENDASI / SURVEY -->
${laporan.service === "Survey" ? `
<div class="section">
  <div class="section-title">Laporan Hasil Survey</div>
  <div style="margin-bottom:8px">
    <div style="font-size:9px;color:#64748b;margin-bottom:3px;font-weight:700">Hasil Survey</div>
    <div class="catatan-box" style="min-height:60px;white-space:pre-wrap">${escH(laporan.hasil_survey || "—")}</div>
  </div>
  ${laporan.catatan_rekomendasi ? `
  <div>
    <div style="font-size:9px;color:#64748b;margin-bottom:3px;font-weight:700">Rekomendasi</div>
    <div class="catatan-box" style="min-height:40px;white-space:pre-wrap">${escH(laporan.catatan_rekomendasi)}</div>
  </div>` : ""}
</div>
` : `
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
`}

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
  <div class="footer-left">${appSettings.company_name || "AClean Service"} · ${appSettings.company_addr || "Jasa Servis AC Profesional"}</div>
  <div class="footer-right">Dokumen ini dicetak otomatis oleh sistem ${appSettings.app_name || "AClean"}</div>
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
      const res = await _apiFetch("/api/upload-foto", {
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
        // Kecilkan foto KHUSUS untuk PDF-WA → PDF ringan → upload Fonnte cepat → terkirim sbg file.
        if (dataUrl) photoDataUrls[url] = await downscaleDataUrl(dataUrl);
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
      const res = await _apiFetch("/api/upload-foto", {
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
    const count = Math.min(order.units || 1, 30);
    setLaporanUnits(Array.from({ length: count }, (_, i) => mkUnit(i + 1)));

    // Reset pool unit maintenance & registry AC — diisi ulang di bawah sesuai jenis order
    setMaintUnitPool([]); setShowAddMaintUnitModal(false); setAddMaintSelected(new Set());
    setAcUnitPool([]);

    // Pre-fill unit label/tipe/merk/PK dari maintenance preset (jika order corporate)
    const mUnitIds = Array.isArray(order.maintenance_unit_ids) ? order.maintenance_unit_ids : [];
    if (order.maintenance_client_id) {
      (async () => {
        try {
          const r = await _apiFetch("/api/maintenance", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list-units", client_id: order.maintenance_client_id }),
          });
          if (!r.ok) return;
          const { units: allUnits = [] } = await r.json().catch(() => ({}));
          // Simpan seluruh unit terdaftar klien → dipakai picker "Tambah dari Daftar Maintenance"
          setMaintUnitPool(allUnits);
          if (mUnitIds.length > 0) {
            const filled = mUnitIds.map((uid, i) => {
              const mu = allUnits.find(u => u.id === uid);
              if (!mu) return mkUnit(i + 1);
              return mkUnit(i + 1, maintUnitToHist(mu));
            });
            setLaporanUnits(filled);
          }
        } catch (_) { /* non-blocking — default units tetap dipakai */ }
      })();
    } else {
      // Customer REGULER. Prioritas pre-fill: (1) registry unit AC permanen bila order
      // >= cutoff & ada di registry; (2) fallback #1A laporan terakhir; (3) default kosong.
      // #1A — pre-fill identitas dari laporan terakhir (field kerja tetap kosong tiap visit).
      const prefillFromLastReport = () => {
        const nm = (s) => (s || "").trim().toLowerCase();
        const custOrderIds = new Set(
          ordersData.filter(o => o.id !== order.id &&
            ((order.customer_id && o.customer_id === order.customer_id) ||
             (!o.customer_id && nm(o.customer) === nm(order.customer)))
          ).map(o => o.id)
        );
        const lastReport = laporanReports
          .filter(r => custOrderIds.has(r.job_id) && r.status && r.status !== "PENDING" && Array.isArray(r.units) && r.units.length > 0)
          .sort((a, b) => (b.date || b.submitted || "").localeCompare(a.date || a.submitted || ""))[0];
        if (lastReport) {
          const prefilled = Array.from({ length: count }, (_, i) => {
            const pu = lastReport.units[i];
            return pu ? mkUnit(i + 1, { label: pu.label, tipe: pu.tipe, merk: pu.merk, pk: pu.pk, model: pu.model, from_history_job_id: lastReport.job_id }) : mkUnit(i + 1);
          });
          setLaporanUnits(prefilled);
          showNotif(`ℹ️ ${Math.min(count, lastReport.units.length)} unit di-prefill dari servis terakhir — cek & sesuaikan`);
        }
      };
      // Registry forward-only: hanya order >= cutoff & punya customer_id.
      if (order.customer_id && (order.date || "") >= AC_REGISTRY_CUTOFF) {
        (async () => {
          try {
            const { data: acUnits } = await fetchAcUnitsByCustomer(supabase, order.customer_id);
            if (acUnits && acUnits.length > 0) {
              setAcUnitPool(acUnits);
              const filled = acUnits.slice(0, 30).map((au, i) => mkUnit(i + 1, acUnitToHist(au)));
              setLaporanUnits(filled);
              showNotif(`ℹ️ ${filled.length} unit di-prefill dari registry customer — cek & sesuaikan`);
              return; // registry dipakai → skip #1A
            }
          } catch (_) { /* non-blocking */ }
          prefillFromLastReport(); // registry kosong/gagal → fallback
        })();
      } else {
        prefillFromLastReport();
      }
    }

    setLaporanMaterials([]);
    setLaporanJasaItems([]); setJasaManualText({});
    setLaporanRepairItems([]); setRepairManualText({});
    setLaporanBarangItems([]); // ✨ NEW: reset barang items
    // ── Pre-fill dari materials_brought (Bawa Material) ──
    // Kalau teknisi pagi sudah declare bawa tabung/roll → auto-add ke section barang
    (async () => {
      try {
        const { data: brought } = await supabase.from("job_materials_brought")
          .select("id, unit_id, inventory_code, inventory_name, unit_label, material_type, qty_estimate, qty_used")
          .eq("job_id", order.id)
          .in("status", ["BROUGHT", "USED"])
          .order("brought_at", { ascending: true });
        if (brought && brought.length > 0) {
          const inv = inventoryData;
          const prefill = brought.map((b, i) => {
            const invItem = inv.find(x => x.code === b.inventory_code);
            const hargaSatuan = (() => {
              const pl = priceListData.find(p => p.type && b.inventory_name && p.type.toLowerCase().includes((b.inventory_name || "").toLowerCase()));
              return pl ? parseInt(pl.price || 0) : 0;
            })();
            return {
              id: Date.now() + i,
              nama: b.inventory_name || invItem?.name || "",
              jumlah: Number(b.qty_used || b.qty_estimate || 1),
              satuan: invItem?.unit || (b.material_type === "freon" ? "kg" : "m"),
              harga_satuan: hargaSatuan,
              _isManual: false,
              unit_id: b.unit_id,
              unit_label: b.unit_label,
              inv_code: b.inventory_code,
              _broughtId: b.id,
              _fromBrought: true,
            };
          });
          setLaporanBarangItems(prefill);
        }
      } catch (e) { console.warn("[BROUGHT_PREFILL]", e?.message || e); }
    })();
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
      // Tag unit_no & label dipulihkan dari existingRep.fotos (match by url) jika ada.
      const metaByUrl = Object.fromEntries((existingRep.fotos || []).filter(m => m && m.url).map(m => [m.url, m]));
      const restoredFotos = existingRep.foto_urls.map((url, idx) => {
        const hashFromUrl = url.split("/").pop().replace(".jpg", "").slice(0, 16); // ambil hash dari nama file
        const meta = metaByUrl[url] || {};
        return {
          id: Date.now() + idx,
          label: meta.label || `Foto ${idx + 1}`,
          data_url: url,      // tampilkan dari URL R2 (sudah tersimpan)
          url: url,      // sudah tersimpan = ☁️ OK
          errMsg: "",
          hash: hashFromUrl,
          restored: true,     // flag: ini foto lama, bukan baru diupload
          unit_no: meta.unit_no || null,
        };
      });
      setLaporanFotos(restoredFotos);
    } else {
      setLaporanFotos([]);
    }
    // Auto-fill install items berdasarkan jumlah unit order
    const _installDefaults = {};
    if (order.service === "Install") {
      const _u = Math.min(order.units || 1, 30);
      // Auto-fill pasang AC berdasarkan jumlah unit
      _installDefaults.pasang_05_1pk = String(_u);
      _installDefaults.vacum_unit = String(_u);
      _installDefaults.vacum_unit = String(_u);
    }
    setLaporanInstallItems(_installDefaults);
    setLaporanRekomendasi("");
    setLaporanCatatan("");
    setLaporanSurveyHasil("");
    setLaporanSurveyCatatan("");
    setActiveUnitIdx(0);
    setShowMatPreset(false);

    // ── Smart Unit Preset: Cek customer history ──
    // Order maintenance B2B: unit sudah pasti dari registry (di-preset di blok corporate
    // di atas, lengkap dengan unit_code + maint_unit_id). History-picker malah mubazir &
    // membingungkan (unit history tak punya kode unit) → lewati untuk order maintenance.
    const customer = order.maintenance_client_id ? null : findCustomer(customersData, order.phone, order.customer);
    if (customer) {
      const custHistory = buildCustomerHistory(customer, ordersData, laporanReports, invoicesData, customersData);
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
    submitLaporanLock.current = false; // reset lock setiap kali modal dibuka
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
        // Strip kolom legacy `password` (terenkripsi, migrasi 079) — jangan pernah kirim ke client/localStorage
        const { password: _ignorePwd, ...profileSafe } = profile;
        const userObj = { ...data.user, ...profileSafe, _exp: Date.now() + 8 * 60 * 60 * 1000 };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(profile.role.toLowerCase());
        const defaultMenu = profile.role === "Finance" ? "finance" : "dashboard";
        setActiveMenu(defaultMenu);
        try { localStorage.setItem("aclean_lastMenu", defaultMenu); } catch (_) {}
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
    _internalTokenExpRef.current = 0;
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
    // Owner: semua akses kecuali menu khusus teknisi (myreport, matcheckout)
    if (role === "Owner") return menu !== "myreport" && menu !== "matcheckout" && menu !== "alatsaya";
    // Admin: semua operasional KECUALI pricelist (Owner only per SOP), settings, myreport
    // docs/SOP_ADMIN_ROLE.md: Admin = input & edit only, no delete, no price list, no settings
    // Statistik (reports), Deleted Audit (deletedaudit) → Owner only
    if (role === "Admin") {
      const adminBlocked = ["settings", "myreport", "matcheckout", "alatsaya", "monitoring", "wa_groups", "finance", "pricelist", "reports", "deletedaudit"];
      return !adminBlocked.includes(menu);
    }
    // Teknisi & Helper: dashboard, jadwal, laporan sendiri, material harian, + Komisi Saya (dilindungi PIN
    // per-teknisi bila Owner set commission_pin — layer-2 anti "intip" data keuangan sensitif)
    if (role === "Teknisi" || role === "Helper")
      return menu === "dashboard" || menu === "schedule" || menu === "myreport" || menu === "matcheckout" || menu === "alatsaya" || menu === "komisi";
    // Finance: akses finance hub, invoice, biaya, statistik
    if (role === "Finance")
      return ["finance", "invoice", "biaya", "reports"].includes(menu);
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
  // Server-side autolookup customer by phone (form Buat Order) — debounced.
  // Menjamin customer existing terdeteksi walau di luar limit fetchCustomers.
  useEffect(() => {
    if (!modalOrder) return;
    const raw = newOrderForm.phone || "";
    if (raw.replace(/\D/g, "").length < 8) {
      setOrderPhoneLookup(prev => (prev.phone || prev.matches.length) ? { phone: "", matches: [] } : prev);
      return;
    }
    const norm = normalizePhone(raw);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await lookupCustomersByPhone(supabase, norm);
        if (cancelled) return;
        setOrderPhoneLookup({ phone: norm, matches: (!error && data) ? data : [] });
      } catch (e) { if (!cancelled) setOrderPhoneLookup({ phone: norm, matches: [] }); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [newOrderForm.phone, modalOrder, supabase]);

  // Auto-detect pekerjaan lanjutan berdasarkan no HP customer
  useEffect(() => {
    if (!modalOrder) { setContinuationSuggestion([]); setContinuationParentId(null); return; }
    const candidates = detectContinuationCandidates(ordersData, newOrderForm.phone);
    setContinuationSuggestion(candidates);
    setContinuationParentId(null);
  }, [newOrderForm.phone, modalOrder, ordersData]);

  // Maintenance korporat: muat daftar klien saat modal order dibuka
  useEffect(() => {
    if (!modalOrder) return;
    (async () => {
      try {
        const r = await _apiFetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list-clients" }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) setMaintClientsForOrder((j.clients || []).filter(c => c.contract_status === "active"));
      } catch (_) { /* abaikan — fitur opsional */ }
    })();
  }, [modalOrder]);

  // Muat unit saat klien maintenance dipilih
  useEffect(() => {
    const cid = newOrderForm.maintenance_client_id;
    if (!cid) { setMaintUnitsForOrder([]); return; }
    (async () => {
      try {
        const r = await _apiFetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list-units", client_id: cid }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) setMaintUnitsForOrder(j.units || []);
      } catch (_) { setMaintUnitsForOrder([]); }
    })();
  }, [newOrderForm.maintenance_client_id]);

  // Auto-detect maintenance client: phone match customer ATAU nama order = nama perusahaan → auto-select.
  // Tujuan: cegah order maintenance lupa di-link (missing link silent). Owner/Admin tetap bisa ubah manual.
  useEffect(() => {
    if (!modalOrder || newOrderForm.maintenance_client_id || !maintClientsForOrder.length) return;
    const custMatch = orderPhoneLookup.matches?.[0];
    // 1) Cocok via customer_id (paling andal — dari nomor HP)
    let found = custMatch?.id ? maintClientsForOrder.find(c => c.customer_id === custMatch.id) : null;
    // 2) Fallback: nama order persis sama dengan nama perusahaan (normalized) — low-risk, exact only
    if (!found) {
      const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      const oc = norm(newOrderForm.customer);
      if (oc.length >= 4) found = maintClientsForOrder.find(c => norm(c.name) === oc);
    }
    if (!found) return;
    _maintAutoDetectRef.current = true;
    setNewOrderForm(f => ({ ...f, maintenance_client_id: found.id }));
  }, [orderPhoneLookup.matches, maintClientsForOrder, modalOrder, newOrderForm.customer]);

  // Saat units selesai di-load via auto-detect → centang semua otomatis
  useEffect(() => {
    if (!_maintAutoDetectRef.current || !maintUnitsForOrder.length) return;
    _maintAutoDetectRef.current = false;
    setNewOrderForm(f => ({ ...f, maintenance_unit_ids: maintUnitsForOrder.map(u => u.id) }));
  }, [maintUnitsForOrder]);

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
              // Strip kolom legacy `password` bila masih terbawa dari localSession lama
              const { password: _ignorePwd, ...savedSafe } = saved;
              const verified = { ...savedSafe, role: profile.role, name: profile.name };
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
            const { password: _ignorePwd, ...profileSafe } = profile;
            setCurrentUser({ ...session.user, ...profileSafe });
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
        // Opsi-A: agent_logs, expenses, quotations dikeluarkan dari loadAll — diload on-demand saat view dibuka
        const results = await Promise.allSettled([
          cachedFetch("orders", () => fetchOrders(supabase)),
          cachedFetch("invoices", () => fetchInvoices(supabase)),
          cachedFetch("customers", () => fetchCustomers(supabase)),
          cachedFetch("inventory", () => fetchInventory(supabase)),
          cachedFetch("service_reports", () => fetchServiceReports(supabase)),
          cachedFetch("inv_tx", () => fetchInventoryTransactions(supabase)),
          cachedFetch("inv_units", () => fetchInventoryUnits(supabase)),
          cachedFetch("project_daily_reports", () => supabase.from("project_daily_reports").select("id,order_id,project_id,tanggal,status,submitted_by").order("tanggal", { ascending: false }).limit(1000)),
        ]);
        const [ordersRes, invoicesRes, customersRes, inventoryRes, laporanRes, invTxRes, invUnitsRes, pdrRes] = results.map(r => r.status === "fulfilled" ? r.value : { error: r.reason });
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
        if (!pdrRes?.error && pdrRes?.data) setProjectDailyReports(pdrRes.data);
        // Jika DB error total, keep demo data (already in useState init)
        // agent_logs: diakses lewat Monitoring → tab Audit Log (server-side)

        // ── Expenses & agent_logs: load on-demand (opsi-A, bukan di sini) ──

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
            // ── Load bonus_categories from app_settings ──
            if (sMap.bonus_categories) {
              try {
                const parsed = JSON.parse(sMap.bonus_categories);
                if (Array.isArray(parsed) && parsed.length > 0) setBonusCategories(parsed);
              } catch (e) { console.error("Failed to parse bonus_categories:", e); }
            }
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
              bap_statement_default: sMap.bap_statement_default || prev.bap_statement_default,
              bap_enabled: sMap.bap_enabled ?? prev.bap_enabled ?? "false",
              wa_autoreply_enabled: sMap.wa_autoreply_enabled ?? prev.wa_autoreply_enabled,
              wa_forward_to_owner: sMap.wa_forward_to_owner ?? prev.wa_forward_to_owner,
              wa_chatbot_enabled: sMap.wa_chatbot_enabled ?? prev.wa_chatbot_enabled ?? "false",
              wa_payment_detect: sMap.wa_payment_detect ?? prev.wa_payment_detect ?? "true",
              wa_cleanup_enabled: sMap.wa_cleanup_enabled ?? prev.wa_cleanup_enabled ?? "true",
              wa_monitor_enabled: sMap.wa_monitor_enabled ?? prev.wa_monitor_enabled ?? "false",
              ara_training_rules: sMap.ara_training_rules ?? prev.ara_training_rules,
              customer_portal_enabled: sMap.customer_portal_enabled ?? prev.customer_portal_enabled ?? "false",
              customer_portal_url: sMap.customer_portal_url ?? prev.customer_portal_url ?? "https://a-clean-webapp.vercel.app",
              rating_prompt_enabled: sMap.rating_prompt_enabled ?? prev.rating_prompt_enabled ?? "false",
              servis_reminder_enabled: sMap.servis_reminder_enabled ?? prev.servis_reminder_enabled ?? "false",
              voucher_loyalty_enabled: sMap.voucher_loyalty_enabled ?? prev.voucher_loyalty_enabled ?? "false",
              voucher_winback_enabled: sMap.voucher_winback_enabled ?? prev.voucher_winback_enabled ?? "false",
              voucher_expiry_reminder_enabled: sMap.voucher_expiry_reminder_enabled ?? prev.voucher_expiry_reminder_enabled ?? "false",
              app_name: sMap.app_name || prev.app_name,
              ai_name: sMap.ai_name || prev.ai_name,
              logo_url: sMap.logo_url ?? prev.logo_url,
              service_types_json: sMap.service_types_json ?? prev.service_types_json,
              area_utama: sMap.area_utama ?? prev.area_utama,
              area_konfirmasi: sMap.area_konfirmasi ?? prev.area_konfirmasi,
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
            const roleColors = { owner: "#f59e0b", admin: "#38bdf8", finance: "#10b981", teknisi: "#22c55e", helper: "#a78bfa" };
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
          const waRes = await fetchWaConversations(supabase, 100);
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
        // Auto-sync: order masih DISPATCHED/ON_SITE tapi laporannya sudah VERIFIED → set COMPLETED
        setTimeout(async () => {
          try {
            const { data: verifiedLaporan } = await supabase
              .from("service_reports").select("job_id").eq("status", "VERIFIED");
            if (!verifiedLaporan?.length) return;
            const verifiedJobIds = new Set(verifiedLaporan.map(r => r.job_id).filter(Boolean));
            setOrdersData(prev => {
              const toFix = prev.filter(o => ["DISPATCHED","ON_SITE"].includes(o.status) && verifiedJobIds.has(o.id));
              if (!toFix.length) return prev;
              toFix.forEach(o => supabase.from("orders").update({ status: "COMPLETED" }).eq("id", o.id).then(() => {}));
              addAgentLog("AUTO_COMPLETE_SYNC", `${toFix.length} order di-sync ke COMPLETED karena laporan sudah VERIFIED`, "INFO");
              return prev.map(o => toFix.some(f => f.id === o.id) ? { ...o, status: "COMPLETED" } : o);
            });
          } catch (e) { console.warn("Auto-complete sync skip:", e?.message); }
        }, 10000); // 10 detik setelah data load
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
                x.id === r.id ? { ...x, status: "VERIFIED", verified_at: new Date().toISOString() } : x
              ));
              // Sync order status → COMPLETED jika masih DISPATCHED/ON_SITE
              if (r.job_id) {
                const ord = ordersData.find(o => o.id === r.job_id);
                if (ord && ["DISPATCHED", "ON_SITE"].includes(ord.status)) {
                  await supabase.from("orders").update({ status: "COMPLETED" }).eq("id", r.job_id);
                  setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED" } : o));
                  updateCustomerTierAfterOrder(ord).catch(() => {});
                }
              }
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
          .on("postgres_changes", { event: "*", schema: "public", table: "wa_conversations" }, (payload) => {
            // Opsi-B: update lokal tanpa re-fetch — hemat egress
            const row = payload.new || payload.old;
            if (!row?.phone) return;
            if (payload.eventType === "DELETE") {
              setWaConversations(prev => prev.filter(c => c.phone !== row.phone));
            } else {
              setWaConversations(prev => {
                const idx = prev.findIndex(c => c.phone === row.phone);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...row };
                  next.sort((a, b) => (b.updated_at || "") > (a.updated_at || "") ? 1 : -1);
                  return next;
                }
                return [row, ...prev].slice(0, 100);
              });
            }
          })
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
            // Update state lokal tanpa re-fetch — hemat egress DB
            const newMsg = payload.new;
            if (newMsg?.phone) {
              setWaConversations(prev => {
                const phone = newMsg.phone;
                const idx = prev.findIndex(c => c.phone === phone);
                const now = new Date().toISOString();
                if (idx >= 0) {
                  const updated = { ...prev[idx], last_message: newMsg.message || prev[idx].last_message, last_reply: newMsg.role === "bot" ? (newMsg.message || prev[idx].last_reply) : prev[idx].last_reply, updated_at: now, unread: newMsg.role === "customer" ? (prev[idx].unread || 0) + 1 : prev[idx].unread };
                  const rest = prev.filter((_, i) => i !== idx);
                  return [updated, ...rest];
                }
                return [{ phone, last_message: newMsg.message, last_reply: null, updated_at: now, unread: newMsg.role === "customer" ? 1 : 0, id: newMsg.phone }, ...prev.slice(0, 149)];
              });
            }

            if (newMsg?.role === "customer") {
              // 1. Suara — buat AudioContext inline (tidak perlu file eksternal)
              try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.value = 880;
                osc.type = "sine";
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.4);
              } catch(_) {}

              // 2. Browser push notification
              const senderDisplay = newMsg.name || newMsg.phone || "Customer";
              const msgPreview = (newMsg.content || "").slice(0, 60);
              if (typeof Notification !== "undefined") {
                if (Notification.permission === "granted") {
                  new Notification("📱 WA Baru — " + senderDisplay, {
                    body: msgPreview || "(foto/media)",
                    icon: "/favicon.ico",
                    tag: "wa-" + (newMsg.phone || ""),
                    renotify: true
                  });
                } else if (Notification.permission === "default") {
                  Notification.requestPermission().then(perm => {
                    if (perm === "granted") {
                      new Notification("📱 WA Baru — " + senderDisplay, {
                        body: msgPreview || "(foto/media)",
                        icon: "/favicon.ico",
                        tag: "wa-" + (newMsg.phone || "")
                      });
                    }
                  });
                }
              }
            }
          })
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR") console.warn("⚠️ RT wa_messages — tabel mungkin belum ada");
          });
      } catch (e) {
        console.warn("WA realtime channels skip:", e?.message);
      }
    }

    // Payment suggestions — HANYA Owner/Admin, hanya jam kerja, 5 menit polling (Opsi-C)
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
    }, 5 * 60 * 1000) : null;

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
    let arr = [];
    if (Array.isArray(md)) arr = md;
    else if (typeof md === "string" && md) {
      try { arr = JSON.parse(md); } catch (e) { arr = []; }
    }
    if (!Array.isArray(arr) || arr.length === 0) return [];
    // Dedup item transport bernama sama (mis. "Biaya Transport Bila 1 Unit") — item ini
    // selalu tunggal per invoice; cegah double tagih dari data warisan / state in-memory.
    // Transport dengan nama BERBEDA tetap dipertahankan; edit/hapus manual tidak terganggu.
    const seenTransport = new Set();
    return arr.filter(m => {
      const n = (m?.nama || "").toLowerCase().trim();
      if (!n.includes("transport")) return true;
      if (seenTransport.has(n)) return false;
      seenTransport.add(n);
      return true;
    });
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
      const errMsg = d.detail || d.error || String(r.status);
      console.warn("sendWA failed:", d.error || "", "| detail:", d.detail || "—", "| target:", phone);
      // Tampilkan notif hanya untuk error kritis (bukan quota/device)
      if (errMsg.includes("FONNTE_TOKEN") || errMsg.includes("belum diset")) {
        showNotif("⚠️ WA tidak terkirim: FONNTE_TOKEN belum diset di Vercel");
      } else if (errMsg.includes("FONNTE_UNREACHABLE") || errMsg.includes("fetch failed") || errMsg.includes("timeout")) {
        showNotif("⚠️ WA tidak terkirim: server Fonnte tidak bisa dihubungi (down/timeout) — coba lagi nanti");
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
      + `Segera konfirmasi kehadiran. — ${appSettings.app_name || "AClean"}`;
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
          + `Kamu ditugaskan sebagai Helper. — ${appSettings.app_name || "AClean"}`;
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

      // Kirim link portal ke customer jika fitur aktif
      if (appSettings?.customer_portal_enabled === "true" && order.phone) {
        try {
          const hdrs = await _apiHeaders();
          const tokRes = await fetch("/api/generate-customer-token", {
            method: "POST", headers: hdrs,
            body: JSON.stringify({
              phone: order.phone,
              customer_name: order.customer,
              // Kirim maintenance_client_id agar API return link portal permanen (B2B)
              maintenance_client_id: order.maintenance_client_id || null,
            }),
          });
          if (tokRes.ok) {
            const { link, is_maintenance } = await tokRes.json();
            const tgl = new Date(order.date).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
            const team = [order.teknisi, order.helper].filter(Boolean).join(" & ");
            const appName = appSettings.app_name || "AClean";
            const portalMsg = is_maintenance
              ? `Halo ${order.customer}! 👋\n` +
                `Konfirmasi Jadwal Maintenance Aset AC Anda 😊\n` +
                `Tim ${appName} sedang menuju lokasi Anda sekarang 🚗\n\n` +
                `📋 Detail Servis:\n` +
                `• Layanan  : ${order.service}\n` +
                `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
                `• Tim      : ${team || order.teknisi}\n` +
                `• Lokasi   : ${order.address || "-"}\n\n` +
                `🔗 Portal Maintenance Aset AC Anda:\n${link}\n\n` +
                `Akses laporan, history, dan status aset AC Perusahaan Anda secara lengkap. Jika Ada Pertanyaan? Balas pesan ini.\n— ${appName} Service`
              : `Halo ${order.customer}! 👋\n` +
                `Ini adalah Pesan Otomatis Konfirmasi Pesanan Anda 😊\n` +
                `Tim ${appName} sedang menuju lokasi Anda sekarang 🚗\n\n` +
                `📋 Detail Servis:\n` +
                `• Layanan  : ${order.service}\n` +
                `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
                `• Tim      : ${team || order.teknisi}\n` +
                `• Lokasi   : ${order.address || "-"}\n\n` +
                `🔗 Pantau status tim secara langsung:\n${link}\n\n` +
                `Link aktif 30 hari sejak Pemesanan Anda. Detail Service, Pembayaran, Complain dan History Pengerjaan Di Lokasi. Jika Ada Pertanyaan? Balas pesan ini.\n— ${appName} Service`;
            await sendWA(order.phone, portalMsg);
            // Tandai portal WA sudah dikirim agar cron morning-dispatch tidak kirim dobel
            await supabase.from("orders").update({ portal_wa_sent_at: new Date().toISOString() }).eq("id", order.id);
            const logLabel = is_maintenance ? "MAINTENANCE_PORTAL_LINK_SENT" : "PORTAL_LINK_SENT";
            addAgentLog(logLabel, `Link portal ${is_maintenance ? "B2B permanen" : "customer"} terkirim ke ${order.customer} (${order.phone})`, "SUCCESS");
          }
        } catch (e) { /* portal link opsional — tidak blok dispatch */ }
      }
    } else {
      showNotif("📱 WA dibuka manual di browser");
    }
  };

  // ── dispatchWA: full (status + WA) — untuk backward compat ──
  const dispatchWA = async (order) => {
    await dispatchStatus(order);
    await sendDispatchWA(order);
  };

  // ── Helper: generate/refresh portal token dan return link ──
  const getPortalLink = async (phone, customerName) => {
    if (!phone || appSettings?.customer_portal_enabled !== "true") return null;
    try {
      const hdrs = await _apiHeaders();
      const r = await fetch("/api/generate-customer-token", {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ phone, customer_name: customerName || "" }),
      });
      if (!r.ok) return null;
      const { link } = await r.json();
      return link || null;
    } catch { return null; }
  };

  const invoiceReminderWA = async (inv) => {
    if (!inv?.phone) { showNotif("⚠️ No. HP customer tidak tersedia untuk reminder"); return; }
    const portalLink = await getPortalLink(inv.phone, inv.customer);
    const invoiceUrl = await uploadInvoicePDFForWA(inv, portalLink);
    const portalLine = portalLink ? `\n\n🔗 Riwayat & invoice Anda:\n${portalLink}` : "";
    const msg = `Halo ${inv.customer}, Terlampir Invoice Resmi Pekerjaan Kemaren senilai *${fmt(inv.total)}*.\n\nPembayaran Bisa Melalui Transfer ke:\n*${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""} a.n. ${appSettings.bank_holder || ""}*\n\nApabila sudah di Transfer Bole dikirimkan Bukti Pembayaran kesini untuk di Konfirmasi Pembayarannya ya Bapak / Ibu. Terima kasih! 🙏${portalLine}`;
    const sent = await sendWA(inv.phone, msg, invoiceUrl ? { url: invoiceUrl, filename: `Invoice-${inv.id}.pdf` } : {});
    if (sent) await writeInvoiceSendAudit([inv.id], "single", null);
  };

  // ── Audit kirim WA per-invoice (update kolom wa_sent_count, wa_last_sent_at, dll) ──
  const writeInvoiceSendAudit = async (invIds, mode, batchInfo) => {
    if (!Array.isArray(invIds) || invIds.length === 0) return;
    const now = new Date().toISOString();
    try {
      // Ambil sent_count saat ini agar bisa increment
      const { data: current } = await supabase.from("invoices")
        .select("id,wa_sent_count").in("id", invIds);
      const updates = (current || []).map(c => ({
        id: c.id,
        wa_sent_count: (c.wa_sent_count || 0) + 1,
        wa_last_sent_at: now,
        wa_last_sent_mode: mode,
        wa_last_sent_batch: batchInfo || null,
      }));
      // Upsert batch
      for (const u of updates) {
        await supabase.from("invoices").update({
          wa_sent_count: u.wa_sent_count,
          wa_last_sent_at: u.wa_last_sent_at,
          wa_last_sent_mode: u.wa_last_sent_mode,
          wa_last_sent_batch: u.wa_last_sent_batch,
        }).eq("id", u.id);
      }
      // Refresh local state
      setInvoicesData(prev => prev.map(i => {
        const u = updates.find(x => x.id === i.id);
        return u ? { ...i, ...u } : i;
      }));
    } catch (err) {
      console.warn("[writeInvoiceSendAudit] gagal:", err.message);
    }
  };

  // ── Kirim beberapa invoice digabung jadi 1 PDF (1 page per invoice) ──
  // Validasi: semua invoice harus customer/phone yang sama. Otomatis sort by created_at asc.
  // Cap maksimal 5 invoice per gabungan (UX & payload safety).
  // Return: { ok: bool, error?: string, retryContext?: object }
  const mergedInvoiceWA = async (invList) => {
    if (!Array.isArray(invList) || invList.length < 2) {
      showNotif("⚠️ Pilih minimal 2 invoice untuk digabung");
      return { ok: false, error: "min" };
    }
    if (invList.length > 5) {
      showNotif("⚠️ Maksimal 5 invoice per gabungan");
      return { ok: false, error: "max" };
    }
    const phone = invList[0]?.phone;
    if (!phone) { showNotif("⚠️ No. HP customer tidak tersedia"); return { ok: false, error: "no_phone" }; }
    const allSamePhone = invList.every(i => samePhone(i.phone, phone));
    if (!allSamePhone) {
      showNotif("⚠️ Semua invoice harus dari customer/nomor yang sama");
      return { ok: false, error: "diff_customer" };
    }
    const sorted = [...invList].sort((a, b) =>
      new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    const customer = sorted[0]?.customer || "";
    showNotif(`⏳ Menggabungkan ${sorted.length} invoice...`);
    const portalLink = await getPortalLink(phone, customer);
    const uploaded = await uploadMergedInvoicePDFForWA(sorted, portalLink);
    if (!uploaded) {
      showNotif("⚠️ Gagal upload PDF gabungan — fallback teks saja");
    }
    const totalAll = sorted.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const sisaAll = sorted.reduce((s, i) => {
      const sisa = (i.status === "PAID") ? 0
        : (i.remaining_amount > 0 ? Number(i.remaining_amount) : Number(i.total) || 0);
      return s + sisa;
    }, 0);
    const lines = sorted.map((i, idx) => {
      const tgl = i.created_at ? new Date(i.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
      return `${idx + 1}. ${i.service || "Servis AC"} — 📅 ${tgl}`;
    }).join("\n");
    const portalLine = portalLink ? `\n\n🔗 Riwayat & invoice Anda:\n${portalLink}` : "";
    const tagihanLine = sisaAll > 0
      ? `💰 *Total Tagihan: ${fmt(sisaAll)}*${totalAll !== sisaAll ? ` _(dari ${fmt(totalAll)})_` : ""}`
      : `✅ *Semua sudah lunas — total ${fmt(totalAll)}*`;
    const msg = `Halo ${customer}, Terlampir tagihan gabungan untuk ${sorted.length} pekerjaan servis kami dalam 1 dokumen PDF:\n\n${lines}\n\n${tagihanLine}\n\nPembayaran ke:\n*${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""} a.n. ${appSettings.bank_holder || ""}*\n\nMohon kirimkan bukti transfer setelah pembayaran ya. Terima kasih! 🙏${portalLine}`;
    const sent = await sendWA(phone, msg, uploaded ? { url: uploaded.url, filename: uploaded.filename } : {});
    if (sent) {
      showNotif(`✅ ${sorted.length} invoice terkirim digabung ke ${customer}${uploaded ? " 📎" : ""}`);
      const ids = sorted.map(i => i.id);
      addAgentLog("INVOICE_MERGED_SEND",
        `${sorted.length} invoice digabung & dikirim ke ${customer} (${phone}) oleh ${currentUser?.name || "—"}: ${ids.join(", ")}`,
        "SUCCESS"
      );
      // Audit DB per-invoice
      await writeInvoiceSendAudit(ids, "merged", ids.join(","));
      return { ok: true };
    } else {
      showNotif(`⚠️ Gagal kirim WA ke ${customer} — cek koneksi Fonnte`);
      return { ok: false, error: "send_failed", retryContext: { invList: sorted } };
    }
  };

  // ── Buat 1 invoice baru gabungan dari beberapa invoice (untuk 1 customer) ──
  const createConsolidatedInvoice = async (invList) => {
    if (!Array.isArray(invList) || invList.length < 2) {
      showNotif("⚠️ Pilih minimal 2 invoice"); return { ok: false };
    }
    const allSamePhone = invList.every(i => samePhone(i.phone, invList[0].phone));
    if (!allSamePhone) { showNotif("⚠️ Semua invoice harus dari customer yang sama"); return { ok: false }; }

    const sorted = [...invList].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const first = sorted[0];
    const sourceIds = sorted.map(i => i.id).join(", ");

    // Gabungkan materials_detail dari semua invoice. Sumber tanpa line item (legacy)
    // disintesis dari field labor/material agar nilainya tidak hilang saat merge.
    const mergedMaterials = normalizeLines(sorted.flatMap(inv => {
      let md = inv.materials_detail;
      if (typeof md === "string") { try { md = JSON.parse(md); } catch { md = null; } }
      if (Array.isArray(md) && md.length > 0) return md;
      const synth = [];
      if (Number(inv.labor) > 0) synth.push({ nama: inv.service || "Jasa", jumlah: 1, satuan: "unit", harga_satuan: Number(inv.labor), subtotal: Number(inv.labor), keterangan: "jasa" });
      if (Number(inv.material) > 0) synth.push({ nama: "Material", jumlah: 1, satuan: "unit", harga_satuan: Number(inv.material), subtotal: Number(inv.material), keterangan: "barang" });
      return synth;
    }));

    // Ringkasan diturunkan dari line item gabungan (single source of truth via summarize).
    const totalDiscount = sorted.reduce((s, i) => s + (Number(i.discount) || 0), 0);
    const _mergedSum    = summarize(mergedMaterials, { discount: totalDiscount });
    const totalLabor    = _mergedSum.labor;
    const totalMaterial = _mergedSum.material;
    const grandTotal    = _mergedSum.total;
    const dueDates      = sorted.map(i => i.due).filter(Boolean);
    const dueLatest     = dueDates.length ? dueDates.sort((a, b) => new Date(b) - new Date(a))[0] : null;
    const serviceNames  = [...new Set(sorted.map(i => i.service).filter(Boolean))].join(" + ");
    const unitTotal     = sorted.reduce((s, i) => {
      const u = Array.isArray(i.units) ? i.units.length : (Number(i.units) || 1);
      return s + u;
    }, 0);

    // Generate invoice ID — kolom id tabel invoices tidak punya default (format: INV-YYYYMMDD-XXXXX)
    const todayStr = getLocalDate();
    const invSeq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
    const newId = "INV-" + todayStr.replace(/-/g, "").slice(0, 8) + "-" + invSeq;

    const newInv = {
      id:              newId,
      customer:        first.customer,
      phone:           first.phone,
      service:         `Invoice Gabungan (${sorted.length} pekerjaan)`,
      job_id:          null,
      units:           unitTotal,
      labor:           totalLabor,
      material:        totalMaterial,
      discount:        totalDiscount,
      total:           grandTotal,
      status:          "UNPAID",
      due:             dueLatest,
      teknisi:         first.teknisi || null,
      materials_detail: mergedMaterials.length > 0 ? JSON.stringify(mergedMaterials) : null,
      sent:            false,
      created_at:      new Date().toISOString(),
    };

    // Guard invarian (observasional)
    {
      const _chk = checkInvoiceConsistency({ ...newInv, lines: mergedMaterials });
      if (!_chk.ok) addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, newInv.id) + " (gabungan)", "WARNING");
    }

    const { data: created, error } = await supabase.from("invoices").insert([newInv]).select().single();
    if (error || !created) {
      showNotif("⚠️ Gagal buat invoice gabungan: " + (error?.message || "unknown"));
      return { ok: false };
    }

    // Tandai invoice sumber sebagai CANCELLED dengan keterangan
    for (const inv of sorted) {
      await supabase.from("invoices").update({
        status: "CANCELLED",
        service: (inv.service || "Servis AC") + ` [Digabung ke ${created.id}]`,
      }).eq("id", inv.id);
    }

    // Update state lokal — dedup created.id supaya tidak dobel di UI kalau subscription
    // realtime INSERT sudah menambah invoice gabungan duluan (race optimistic vs realtime).
    setInvoicesData(prev => {
      const updated = prev
        .filter(i => i.id !== created.id)
        .map(i =>
          sorted.some(s => s.id === i.id)
            ? { ...i, status: "CANCELLED", service: i.service + ` [Digabung ke ${created.id}]` }
            : i
        );
      return [created, ...updated];
    });

    addAgentLog("INVOICE_CONSOLIDATED",
      `${sorted.length} invoice digabung jadi ${created.id} oleh ${currentUser?.name || "—"}: ${sourceIds}`,
      "SUCCESS"
    );
    showNotif(`✅ Invoice gabungan ${created.id} berhasil dibuat — ${sorted.length} invoice sumber di-cancelled`);
    return { ok: true, newInvoice: created };
  };


  // ── GAP 2: Hitung labor dari price list ──
  const hitungLabor = useCallback((service, type, units) => {
    const plItem = priceListData.find(r => r.service === service && r.type === type);
    if (plItem && plItem.price > 0) return plItem.price * (units || 1);
    // ✨ PHASE 3: Handle unknown services by defaulting to Cleaning
    const svcMap = PRICE_LIST[service] || PRICE_LIST["Maintenance"] || PRICE_LIST["Cleaning"];
    const hargaPerUnit = svcMap?.[type] ?? svcMap?.["default"] ?? 0;
    return hargaPerUnit * (units || 1);
  }, [priceListData]);

  // ✨ PHASE 2 FIX: Unified lookupHarga function — used across all 3 invoice paths
  // A.1 OPTIMIZATION: Memoize dengan useCallback untuk prevent recreation setiap render
  const lookupHargaGlobal = useCallback((nama, satuanHint) => {
    const nama2 = (nama || "").toLowerCase();
    const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
    const mkNorm = (s) => (s || "").toLowerCase()
      .replace(/,/g, ".").replace(/eterna\s*/g, "").replace(/hoda\s*/g, "").replace(/listrik\s*/g, "")
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
      h = nama2.includes("r22") ? (PRICE_LIST["freon_R22"] || 0) :
        nama2.includes("r32") ? (PRICE_LIST["freon_R32"] || 0) :
          (PRICE_LIST["freon_R410A"] || 0);
    }

    return h;
  }, [inventoryData, priceListData]);

  const hitungMaterialTotal = (materials) => {
    return materials.reduce((sum, m) => {
      const raw = (m.nama || "").toLowerCase().trim();
      const norm = raw
        .replace(/,/g, ".")
        .replace(/eterna\s*/g, "").replace(/listrik\s*/g, "")
        .replace(/[-\s]/g, "")
        .replace(/r410a?$/, "r410")
        .replace(/r22a?$/, "r22")
        .replace(/r32a?$/, "r32");
      const isJasaItem = /^(jasa|kuras|bongkar pasang|pemasangan|pasang)/i.test((m.nama || "").trim());

      const mkN = (s) => (s || "").toLowerCase()
        .replace(/,/g, ".").replace(/eterna\s*/g, "").replace(/hoda\s*/g, "").replace(/listrik\s*/g, "")
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
  // ── Retro-match: cari bukti bayar yang sudah masuk untuk invoice yang baru di-approve ──
  // Dipanggil saat invoice berubah ke UNPAID. Cari payment_suggestions by phone dalam 7 hari.
  const retroMatchPayment = async (inv) => {
    if (!inv.phone || !supabase) return;
    const norm = normalizePhone(inv.phone);
    if (!norm) return;

    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // Cari semua payment_suggestions dari nomor ini, belum di-match ke invoice manapun, dalam 30 hari
      const { data: candidates, error } = await supabase
        .from("payment_suggestions")
        .select("id, amount, bank, transfer_date, image_url, source, created_at")
        .eq("phone", norm)
        .is("invoice_id", null)
        .eq("status", "PENDING")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error || !candidates?.length) return;

      // Ambil kandidat terbaik: yang paling baru
      const best = candidates[0];
      const now = new Date().toISOString();

      // Patch payment_suggestion → link ke invoice ini
      await supabase.from("payment_suggestions").update({
        invoice_id: inv.id,
        order_id: inv.job_id || null,
        matched_at: now,
        match_source: "retro",
      }).eq("id", best.id);

      // Patch invoice → simpan payment_proof_url jika ada foto
      if (best.image_url) {
        await supabase.from("invoices").update({
          payment_proof_url: best.image_url,
          updated_at: now,
        }).eq("id", inv.id);
        setInvoicesData(prev => prev.map(i =>
          i.id === inv.id ? { ...i, payment_proof_url: best.image_url } : i
        ));
      }

      // Cek selisih nominal
      const invTotal = Number(inv.total) || 0;
      const paidAmt  = Number(best.amount) || 0;
      const selisih  = Math.abs(invTotal - paidAmt);
      const toleransi = 10000; // Rp 10.000 toleransi pembulatan

      // Notif ke owner via WA
      const ownerAccs = (userAccounts || []).filter(u => u.role === "Owner" && u.phone);
      const tglBukti = best.transfer_date || best.created_at?.slice(0, 10) || "?";
      const tglInvoice = inv.date || inv.created_at?.slice(0, 10) || "?";

      if (paidAmt > 0 && selisih > toleransi) {
        // Nominal TIDAK sesuai — warning
        const warnMsg =
          `⚠️ *Bukti Bayar Ditemukan — Nominal Beda*\n` +
          `Invoice: ${inv.id}\n` +
          `Customer: ${inv.customer}\n` +
          `Tagihan: Rp${invTotal.toLocaleString("id-ID")}\n` +
          `Bukti Bayar: Rp${paidAmt.toLocaleString("id-ID")}\n` +
          `Selisih: Rp${selisih.toLocaleString("id-ID")}\n` +
          `Tgl Bukti: ${tglBukti} · Tgl Invoice: ${tglInvoice}\n` +
          (best.bank ? `Bank: ${best.bank}\n` : "") +
          `\n🔍 Cek manual di menu Invoice → ${inv.id}`;
        ownerAccs.forEach(u => sendWA(u.phone, warnMsg));
        addAgentLog("RETRO_MATCH_WARN", `Retro-match ${inv.id} ← ${best.id} | selisih Rp${selisih.toLocaleString("id-ID")}`, "WARNING");
      } else {
        // Nominal sesuai (atau tidak terbaca) — notif biasa
        const okMsg =
          `✅ *Bukti Bayar Otomatis Dicocokkan*\n` +
          `Invoice: ${inv.id}\n` +
          `Customer: ${inv.customer}\n` +
          (paidAmt > 0 ? `Nominal: Rp${paidAmt.toLocaleString("id-ID")}\n` : `Nominal: tidak terbaca dari bukti\n`) +
          `Tgl Bukti: ${tglBukti} · Tgl Invoice: ${tglInvoice}\n` +
          (best.bank ? `Bank: ${best.bank}\n` : "") +
          `\n📋 Cek & konfirmasi PAID di menu Invoice → ${inv.id}`;
        ownerAccs.forEach(u => sendWA(u.phone, okMsg));
        addAgentLog("RETRO_MATCH_OK", `Retro-match ${inv.id} ← ${best.id}${paidAmt > 0 ? " | Rp" + paidAmt.toLocaleString("id-ID") : " | nominal ?"}`, "SUCCESS");
      }
    } catch (e) {
      console.warn("[RETRO_MATCH] error:", e.message);
    }
  };

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
      // Multi-hari: propagate ke parent + semua child multi-day
      (o.id === inv.job_id || (o.parent_job_id === inv.job_id && o.is_multi_day))
        ? { ...o, invoice_id: inv.id, status: "INVOICE_APPROVED" } : o
    ));
    // Sync ke DB untuk child multi-day juga
    {
      const childIds = (ordersData || [])
        .filter(o => o.parent_job_id === inv.job_id && o.is_multi_day)
        .map(o => o.id);
      if (childIds.length > 0) {
        supabase.from("orders").update({ invoice_id: inv.id, status: "INVOICE_APPROVED" }).in("id", childIds);
      }
    }
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

    // Retro-match: cari bukti bayar yang sudah masuk sebelum invoice di-approve
    retroMatchPayment(inv).catch(e => console.warn("[RETRO_MATCH] fire-and-forget error:", e.message));

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
    const portalLink = await getPortalLink(inv.phone, inv.customer);
    const invoiceUrl = await uploadInvoicePDFForWA(inv, portalLink);
    const portalLine = portalLink ? `\n\n🔗 Riwayat & invoice Anda:\n${portalLink}` : "";
    const waMsg = `Halo ${inv.customer}, invoice *${appSettings.app_name || "AClean"} Service* telah disiapkan:\n\n🔧 ${inv.service || "Servis AC"}\n💰 Total: *${fmt(inv.total)}*\n📅 Jatuh tempo: ${due}\n\nPembayaran ke:\n*${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""} a.n. ${appSettings.bank_holder || ""}*\n\nTerima kasih! 🙏${portalLine}`;
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
      // Multi-hari: parent + child multi-day + via invoice_id link → semua PAID
      (o.id === inv.job_id || o.invoice_id === inv.id || (o.parent_job_id === inv.job_id && o.is_multi_day))
        ? { ...o, status: "PAID" } : o
    ));
    // Sync ke DB untuk child multi-day yang belum punya invoice_id link
    {
      const childIds = (ordersData || [])
        .filter(o => o.parent_job_id === inv.job_id && o.is_multi_day)
        .map(o => o.id);
      if (childIds.length > 0) {
        supabase.from("orders").update({ status: "PAID" }).in("id", childIds);
      }
    }
    await setAuditUser();
    {
      const { error: mpErr } = await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
      if (mpErr) {
        // Guard errors dari markInvoicePaid (status conflict/race condition) — jangan fallback
        const isGuardError = mpErr.message?.includes("sudah") || mpErr.message?.includes("tidak ditemukan");
        if (isGuardError) {
          setInvoicesData(prev => prev.map(i =>
            i.id === inv.id ? { ...i, status: originalInvStatus, paid_at: inv.paid_at || null } : i
          ));
          if (originalOrderStatus) {
            setOrdersData(prev => prev.map(o =>
              (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: originalOrderStatus } : o
            ));
          }
          showNotif(`❌ ${mpErr.message}`);
          return;
        }
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
    // Sync order status ke DB — React state sudah update di atas, tapi DB perlu diupdate juga
    if (inv.job_id) {
      supabase.from("orders").update({ status: "PAID" }).eq("id", inv.job_id).then(() => {});
    }
    // Juga update order yang dilink via invoice_id (edge case AC unit sale)
    supabase.from("orders").update({ status: "PAID" }).eq("invoice_id", inv.id).then(() => {});
    // Simpan bukti bayar URL ke invoice jika ada (dari WA payment detection)
    if (paymentProofUrl) {
      supabase.from("invoices").update({ payment_proof_url: paymentProofUrl }).eq("id", inv.id).then(() => {});
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
        "Pembayaran " + inv.id + " Rp " + (inv.total || 0).toLocaleString("id-ID") + " diterima. Terima kasih! — " + (appSettings.app_name || "AClean")
      );
    }
    // GAP 1.6: Catat ke payments table untuk history + partial payment support
    // amount = sisa yang dibayar (total - paid_amount sebelumnya), bukan total — hindari double-count saat ada DP
    {
      const sisaDibayar = (inv.total || 0) - (Number(inv.paid_amount) || 0);
      const { error: pmtErr } = await supabase.from("payments").insert({
        invoice_id: inv.id,
        amount: sisaDibayar > 0 ? sisaDibayar : (inv.total || 0),
        method: method,
        notes: notes || "Lunas",
        paid_at: paidAt,
      });
      if (pmtErr?.code === "23505" && pmtErr?.message?.includes("payment_proof")) {
        showNotif("⚠️ Bukti pembayaran ini sudah pernah digunakan. Cek invoice yang terkait.");
        return;
      }
      if (pmtErr) console.warn("payments insert skip:", pmtErr?.message);
    }
    // Update customer last_service
    if (inv.phone) await supabase.from("customers").update({ last_service: paidAt.slice(0, 10) }).eq("phone", inv.phone);
    addAgentLog("PAYMENT_CONFIRMED", `Invoice ${inv.id} LUNAS — ${inv.customer} ${fmt(inv.total)} via ${method}`, "SUCCESS");
    showNotif(`💰 Invoice ${inv.id} LUNAS — ${fmt(inv.total)}`);
    // Retro-match: cari bukti bayar yang belum ter-link jika belum ada proof dari parameter
    if (!paymentProofUrl) {
      retroMatchPayment({ ...inv, status: "PAID" }).catch(e => console.warn("[RETRO_MATCH] markPaid error:", e.message));
    }
  };

  // ── Revert invoice PAID → UNPAID/OVERDUE (Owner only) — untuk koreksi nilai ──
  // Membalik status + field bayar, dan kembalikan order PAID → INVOICE_APPROVED.
  // payment_logs & bukti bayar TIDAK dihapus (audit tetap terjaga).
  const revertInvoicePaid = async (inv) => {
    if (currentUser?.role !== "Owner") { showNotif("🔒 Hanya Owner yang bisa revert invoice lunas"); return; }
    const ok = await showConfirm({
      icon: "↩️", danger: true,
      title: "Revert invoice ke Belum Bayar?",
      message: `Invoice ${inv.id} (${inv.customer}) akan dikembalikan ke status BELUM BAYAR agar nilainya bisa dikoreksi.\n\n• Pembayaran ${fmt(inv.total)} dibatalkan (catatan/bukti bayar tetap tersimpan)\n• Order terkait kembali ke "Invoice Dikirim"\n• Setelah koreksi nilai, tandai Lunas lagi\n\nLanjutkan?`,
      confirmText: "Ya, Revert",
    });
    if (!ok) return;
    const { error, newStatus } = await revertInvoiceToUnpaid(supabase, inv.id, auditUserName());
    if (error) { showNotif("❌ Gagal revert: " + error.message); return; }
    const st = newStatus || "UNPAID";
    // Kembalikan order terkait PAID → INVOICE_APPROVED (job_id + invoice_id + anak)
    supabase.from("orders").update({ status: "INVOICE_APPROVED" }).eq("invoice_id", inv.id).eq("status", "PAID").then(() => {});
    if (inv.job_id) supabase.from("orders").update({ status: "INVOICE_APPROVED" }).eq("id", inv.job_id).eq("status", "PAID").then(() => {});
    setInvoicesData(prev => prev.map(i => i.id === inv.id
      ? { ...i, status: st, paid_at: null, paid_amount: 0, remaining_amount: inv.total, paid_method: null } : i));
    setOrdersData(prev => prev.map(o =>
      (o.invoice_id === inv.id || o.id === inv.job_id) && o.status === "PAID" ? { ...o, status: "INVOICE_APPROVED" } : o));
    addAgentLog("INVOICE_REVERTED", `Invoice ${inv.id} (${inv.customer}) direvert PAID→${st} oleh ${currentUser?.name} untuk koreksi nilai`, "WARNING");
    showNotif(`↩️ Invoice ${inv.id} → ${st === "OVERDUE" ? "Terlambat" : "Belum Bayar"}. Sekarang bisa Edit Nilai.`);
  };

  // ── Group Payment: 1 transfer cover beberapa invoice 1 customer ──
  const handleGroupPayment = async (customerPhone, invoiceIds, totalReceived, proofUrl, method) => {
    const targetInvoices = invoicesData.filter(i => invoiceIds.includes(i.id));
    if (!targetInvoices.length) { showNotif("❌ Tidak ada invoice yang dipilih"); return; }
    // Untuk PARTIAL_PAID, tagihan efektif adalah remaining_amount (bukan total)
    const effectiveTagihan = (inv) => inv.status === "PARTIAL_PAID"
      ? (inv.remaining_amount ?? ((inv.total || 0) - (inv.paid_amount || 0)))
      : (inv.total || 0);
    const totalTagihan = targetInvoices.reduce((s, i) => s + effectiveTagihan(i), 0);

    // Block over-payment signifikan (toleransi Rp 1.000 untuk pembulatan)
    if (totalReceived > totalTagihan + 1000) {
      showNotif(`❌ Jumlah bayar (${fmt(totalReceived)}) melebihi total tagihan (${fmt(totalTagihan)}). Cek kembali.`);
      return;
    }

    // Greedy alokasi: invoice terlama dulu, pakai effective tagihan
    const sorted = [...targetInvoices].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let sisa = totalReceived;
    const allocation = {};
    const fullyPaid = [];
    const partialPaid = [];
    for (const inv of sorted) {
      if (sisa <= 0) break;
      const tagihan = effectiveTagihan(inv);
      if (sisa >= tagihan) {
        allocation[inv.id] = tagihan;
        fullyPaid.push(inv);
        sisa -= tagihan;
      } else {
        allocation[inv.id] = sisa;
        partialPaid.push({ ...inv, _paid_amount: (inv.paid_amount || 0) + sisa });
        sisa = 0;
      }
    }

    const paidAt = getLocalISOString();
    await setAuditUser();

    // Optimistic UI
    setInvoicesData(prev => prev.map(i => {
      if (fullyPaid.find(f => f.id === i.id)) return { ...i, status: "PAID", paid_at: paidAt, payment_proof_url: proofUrl || i.payment_proof_url };
      const p = partialPaid.find(f => f.id === i.id);
      if (p) return { ...i, status: "PARTIAL_PAID", paid_amount: p._paid_amount, remaining_amount: (i.total || 0) - p._paid_amount, payment_proof_url: proofUrl || i.payment_proof_url };
      return i;
    }));

    // Simpan 1 record payment untuk 1 transfer
    let paymentId = null;
    {
      const { data: paymentRow, error: gpErr } = await supabase.from("payments").insert({
        customer_phone: customerPhone,
        customer_name: sorted[0]?.customer,
        total_amount: totalReceived,
        amount: totalReceived,
        method,
        is_partial: totalReceived < totalTagihan,
        invoice_ids: invoiceIds,
        allocation_detail: allocation,
        payment_proof_url: proofUrl || null,
        paid_at: paidAt,
        notes: `Group payment: ${invoiceIds.join(", ")}`,
      }).select("id").single();
      if (gpErr?.code === "23505" && gpErr?.message?.includes("payment_proof")) {
        showNotif("⚠️ Bukti pembayaran ini sudah pernah digunakan. Cek invoice yang terkait.");
        return;
      }
      if (gpErr) console.warn("group payment insert:", gpErr?.message);
      paymentId = paymentRow?.id || null;
    }

    // Junction table: 1 payment → banyak invoice
    if (paymentId) {
      const junctionRows = Object.entries(allocation).map(([invId, amt]) => ({
        payment_id: paymentId,
        invoice_id: invId,
        amount: amt,
      }));
      await supabase.from("invoice_payments").insert(junctionRows).then(() => {});
    }

    // Update DB per invoice
    for (const inv of fullyPaid) {
      await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
      supabase.from("invoices").update({
        payment_proof_url: proofUrl || null,
        paid_method: method,
        paid_amount: inv.total,
        remaining_amount: 0,
      }).eq("id", inv.id).then(() => {});
      // Update order status
      const ord = ordersData.find(o => o.id === inv.job_id || o.invoice_id === inv.id);
      if (ord) {
        supabase.from("orders").update({ status: "PAID" }).eq("id", ord.id).then(() => {});
        setOrdersData(prev => prev.map(o => o.id === ord.id ? { ...o, status: "PAID" } : o));
      }
      // Update customer last_service
      if (inv.phone) supabase.from("customers").update({ last_service: paidAt.slice(0, 10) }).eq("phone", inv.phone).then(() => {});
    }

    for (const inv of partialPaid) {
      supabase.from("invoices").update({
        status: "PARTIAL_PAID",
        paid_amount: inv._paid_amount,
        remaining_amount: (inv.total || 0) - inv._paid_amount,
        payment_proof_url: proofUrl || null,
        paid_method: method,
      }).eq("id", inv.id).then(() => {});
    }

    const msg = fullyPaid.length && partialPaid.length
      ? `💰 ${fullyPaid.length} invoice LUNAS + ${partialPaid.length} partial — ${fmt(totalReceived)}`
      : fullyPaid.length
        ? `💰 ${fullyPaid.length} invoice LUNAS — ${fmt(totalReceived)}`
        : `💳 Pembayaran partial ${fmt(totalReceived)} dari ${fmt(totalTagihan)} dicatat`;
    addAgentLog("GROUP_PAYMENT", `Group payment ${customerPhone}: ${invoiceIds.join(",")} — ${fmt(totalReceived)} via ${method}`, "SUCCESS");
    showNotif(msg);
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
      // Cek stok cukup sebelum deduct — skip dengan notif + log jika kurang
      if (item.stock < qty) {
        const skipMsg = `⚠️ Stok ${item.name} kurang: butuh ${qty} ${item.unit}, tersisa ${item.stock} ${item.unit}. Deduct di-skip — laporan tersimpan.`;
        showNotif(skipMsg);
        addAgentLog("STOCK_INSUFFICIENT", `Job ${orderId||reportId||"?"} — ${item.name}: butuh ${qty}, tersedia ${item.stock} ${item.unit}. Deduct di-skip.`, "WARNING");
        // Notif ke Owner agar bisa koreksi manual
        const ownerAccs = userAccounts?.filter(u => u.role === "Owner") || [];
        ownerAccs.forEach(u => { if (u.phone) sendWA(u.phone, `⚠️ *Stok Kurang*\nJob ${orderId||"?"} — ${item.name}: butuh ${qty} ${item.unit}, tersisa ${item.stock} ${item.unit}.\nDeduct di-skip, perlu koreksi manual.`); });
        continue;
      }
      const newStock = item.stock - qty;
      const newStatus = computeStockStatus(newStock, item.reorder);
      // Update local state
      setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, stock: newStock, status: newStatus } : i));
      // Freon: qty_actual = null (belum ditimbang, admin perlu confirm aktual)
      // Non-freon: qty_actual = qty (langsung confirmed)
      const isFreon = item.material_type === "freon" ||
        ["r22","r32","r410","freon"].some(k => (item.name||"").toLowerCase().includes(k));
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
          teknisi_name: (teknisiName || currentUser?.name || "").trim() || null,
          job_date: jobDate || null,
          created_by: currentUser?.id || null,
          created_by_name: currentUser?.name || "",
          unit_id: mat._unitId || null,
          unit_label: mat._unitLabel || null,
          qty_actual: isFreon ? null : -qty,
        });
      } catch (e) { console.warn("inv tx skip:", e?.message); }
      if (newStatus === "CRITICAL" || newStatus === "OUT") {
        addAgentLog("STOCK_ALERT", `${item.name}: ${newStatus} (sisa ${newStock} ${item.unit})`, "WARNING");
      }
    }
  };

  // ── Tracked inventory codes: Pipa AC Hoda 1PK/2PK/2.5PK + Freon semua jenis ──
  const TRACKED_INV_CODES = new Set(["SKU022", "SKU023", "SKU024"]);
  const isTrackedByCode = (code) => TRACKED_INV_CODES.has(code);
  const isTrackedByName = (name) => {
    const n = (name || "").toLowerCase();
    return n.includes("pipa ac hoda") || n.includes("freon") || n.includes("r-22") || n.includes("r-32") || n.includes("r-410") || n.includes("r22") || n.includes("r32") || n.includes("r410");
  };

  // ── syncTrackedStock: idempotent — hapus usage tracked lama, insert baru, recalculate stok dari DB ──
  // Berlaku untuk submit pertama DAN semua revisi. Input terakhir selalu yang menang.
  // newMaterials: array [{nama, jumlah, inv_code?, _useCode?, freon_tabung_code?, _unitId?, freon_unit_label?, _unitLabel?}]
  const syncTrackedStock = async (reportId, orderId, newMaterials, customerName, teknisiName, jobDate) => {
    // 1. Hapus semua transaksi usage tracked lama untuk laporan ini
    const { data: oldTxs } = await supabase
      .from("inventory_transactions")
      .select("id, inventory_code, inventory_name, qty, unit_id")
      .eq("report_id", reportId)
      .eq("type", "usage");

    const oldTracked = (oldTxs || []).filter(tx =>
      isTrackedByCode(tx.inventory_code) || isTrackedByName(tx.inventory_name)
    );

    if (oldTracked.length > 0) {
      await supabase
        .from("inventory_transactions")
        .delete()
        .in("id", oldTracked.map(tx => tx.id));
    }

    // 2. Filter material baru yang tracked
    const newTracked = (newMaterials || []).filter(m =>
      parseFloat(m.jumlah) > 0 && (isTrackedByCode(m.inv_code || m._useCode) || isTrackedByName(m.nama))
    );

    // 3. Insert transaksi usage baru untuk setiap tracked material
    for (const m of newTracked) {
      const qty = parseFloat(m.jumlah) || 0;
      const invCode = m.inv_code || m._useCode || null;
      const unitId = m.freon_tabung_code || m._unitId || null;
      const unitLabel = m.freon_unit_label || m._unitLabel || null;
      const invItem = invCode
        ? inventoryData.find(i => i.code === invCode)
        : inventoryData.find(i => i.name.toLowerCase().includes((m.nama || "").toLowerCase()));
      const isFreon = (invItem?.material_type === "freon") || isTrackedByName(m.nama);
      try {
        await supabase.from("inventory_transactions").insert({
          inventory_code: invCode || invItem?.code || null,
          inventory_name: invItem?.name || m.nama || null,
          order_id: orderId || null,
          report_id: reportId || null,
          qty: -qty,
          qty_actual: isFreon ? null : -qty,
          type: "usage",
          notes: `Laporan ${reportId} oleh ${currentUser?.name || "sistem"}`,
          customer_name: customerName || null,
          teknisi_name: (teknisiName || "").trim() || null,
          job_date: jobDate || null,
          created_by: currentUser?.id || null,
          created_by_name: currentUser?.name || "",
          unit_id: unitId || null,
          unit_label: unitLabel || null,
        });
      } catch (e) { console.warn("syncTrackedStock insert skip:", e?.message); }
    }

    // 4. Recalculate inventory_units.stock dari semua transaksi di DB (bukan dari state lokal)
    // Kumpulkan semua unit_id yang terdampak (lama + baru)
    const affectedUnitIds = new Set([
      ...oldTracked.map(tx => tx.unit_id).filter(Boolean),
      ...newTracked.map(m => m.freon_tabung_code || m._unitId).filter(Boolean),
    ]);

    for (const unitId of affectedUnitIds) {
      const unit = invUnitsData.find(u => u.id === unitId);
      if (!unit) continue;
      // Query total usage untuk unit ini dari seluruh transaksi di DB
      const { data: allUnitTxs } = await supabase
        .from("inventory_transactions")
        .select("qty")
        .eq("unit_id", unitId)
        .eq("type", "usage");
      const totalUsed = (allUnitTxs || []).reduce((s, tx) => s + Math.abs(tx.qty), 0);
      const recalcStock = Math.max(0, (unit.capacity || unit.stock + totalUsed) - totalUsed);
      await supabase.from("inventory_units").update({ stock: recalcStock, updated_at: new Date().toISOString() }).eq("id", unitId);
      setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, stock: recalcStock } : u));
    }

    // 5. Recalculate inventory master stock dari semua transaksi di DB
    const affectedInvCodes = new Set([
      ...oldTracked.map(tx => tx.inventory_code).filter(Boolean),
      ...newTracked.map(m => m.inv_code || m._useCode).filter(Boolean),
    ]);

    for (const invCode of affectedInvCodes) {
      const { data: allInvTxs } = await supabase
        .from("inventory_transactions")
        .select("qty, type")
        .eq("inventory_code", invCode);
      if (!allInvTxs) continue;
      // Stok = restock - usage (semua jenis transaksi)
      const netQty = (allInvTxs || []).reduce((s, tx) => s + (tx.qty || 0), 0);
      const invItem = inventoryData.find(i => i.code === invCode);
      if (!invItem) continue;
      const recalcStock = Math.max(0, netQty);
      const newStatus = computeStockStatus(recalcStock, invItem.reorder);
      await supabase.from("inventory").update({ stock: recalcStock, status: newStatus }).eq("code", invCode);
      setInventoryData(prev => prev.map(i => i.code === invCode ? { ...i, stock: recalcStock, status: newStatus } : i));
    }

    addAgentLog("INV_SYNC", `Stok tracked disync laporan ${reportId} — ${newTracked.length} item, editor: ${currentUser?.name}`, "INFO");
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

    // Gerbang atomik anti double-book dilakukan SETELAH order tersimpan (di bawah),
    // karena technician_schedule.order_id FK ke orders.id — klaim butuh order sudah ada.
    let slotClaimed = false;
    // Cek customer existing by phone ATAU name (untuk customer_id).
    // Fallback ke server kalau tidak ketemu di array client (mungkin di luar limit fetchCustomers).
    let preExistCust = findCustomer(customersData, form.phone, form.customer);
    if (!preExistCust && form.phone && normalizePhone(form.phone).length >= 8) {
      try {
        const { data: srvMatches } = await lookupCustomersByPhone(supabase, normalizePhone(form.phone));
        if (srvMatches && srvMatches.length) preExistCust = findCustomer(srvMatches, form.phone, form.customer);
      } catch (e) { /* lookup server opsional */ }
    }
    const newOrder = {
      id: newId,
      customer: form.customer, phone: normalizePhone(form.phone), address: form.address,
      customer_id: preExistCust?.id || null,
      service: form.service, type: form.type, units: parseInt(form.units) || 1,
      teknisi: form.teknisi, helper: form.helper || null,
      teknisi2: form.teknisi2 || null, helper2: form.helper2 || null,
      teknisi3: form.teknisi3 || null, helper3: form.helper3 || null,
      date: form.date, time: form.time, time_end: timeEnd, status: "CONFIRMED",
      team_slot: form.team_slot || null,
      invoice_id: null, dispatch: false, notes: form.notes || "",
      parent_job_id: form.parent_job_id || null,
      is_multi_day: form.is_multi_day || false,
      maintenance_client_id: form.maintenance_client_id || null,
      maintenance_unit_ids: Array.isArray(form.maintenance_unit_ids) ? form.maintenance_unit_ids : [],
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

    // ── GERBANG ATOMIK (anti double-book/TOCTOU) — setelah order ada di DB ──
    // RPC try_claim_teknisi_slot: advisory-lock per teknisi+tanggal → cek overlap+cap
    // lalu INSERT klaim ke technician_schedule, semua dalam 1 transaksi (migrasi 070).
    // Caller konkuren terserialisasi; yang kalah → order-nya dihapus lagi di sini.
    if (form.teknisi && form.date && form.time && timeEnd) {
      try {
        const { data: claimOk, error: claimErr } = await supabase.rpc("try_claim_teknisi_slot", {
          p_teknisi: form.teknisi, p_date: form.date, p_order_id: newId,
          p_start: form.time, p_end: timeEnd,
        });
        if (claimErr) {
          console.warn("try_claim_teknisi_slot error:", claimErr.message, "— fallback insert schedule biasa");
        } else if (claimOk === false) {
          // Kalah race / slot bentrok → buang order yang sudah terlanjur dibuat
          try { await supabase.from("orders").delete().eq("id", newId); } catch (_) {}
          showNotif("🚫 " + form.teknisi + " bentrok di jam tersebut (slot baru saja terisi)");
          return null;
        } else {
          slotClaimed = true;
        }
      } catch (e) { console.warn("claim slot catch:", e.message); }
    }

    // ── Only update state AFTER DB confirmation ──
    invalidateCache("orders");
    // Dedup: realtime bisa keburu menambah order ini sebelum baris ini jalan.
    setOrdersData(prev => prev.some(o => o.id === newOrder.id) ? prev : [...prev, newOrder]);

    // GAP 1.5: technician_schedule.
    // Jika slot sudah diklaim atomik via RPC (migrasi 070) → baris sudah ada, skip.
    // Insert manual hanya sebagai fallback kalau RPC error/tidak jalan (slotClaimed=false).
    if (!slotClaimed && form.teknisi && form.date && form.time && timeEnd) {
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
      // Reuse hasil lookup di atas (sudah termasuk fallback server) agar tidak miss customer di luar limit
      const existing = preExistCust || findCustomer(customersData, form.phone, form.customer);

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
            // Fallback: phone sudah ada di DB tapi belum di state lokal — fetch & link saja, jangan override nama/alamat
            const { data: existingInDB } = await supabase
              .from("customers")
              .select("id,name,phone,address,area,total_orders,last_service")
              .eq("phone", normalizePhone(form.phone))
              .maybeSingle();
            if (existingInDB) {
              // Customer sudah ada — hanya update stats, jangan override nama/alamat
              const updatedOrders = (existingInDB.total_orders || 0) + 1;
              await supabase.from("customers")
                .update({ total_orders: updatedOrders, last_service: orderDate })
                .eq("id", existingInDB.id);
              await supabase.from("orders").update({ customer_id: existingInDB.id }).eq("id", newId);
              setCustomersData(prev => {
                const alreadyIn = prev.find(c => c.id === existingInDB.id);
                if (alreadyIn) return prev.map(c => c.id === existingInDB.id ? { ...c, total_orders: updatedOrders, last_service: orderDate } : c);
                return [...prev, { ...existingInDB, total_orders: updatedOrders, last_service: orderDate }];
              });
              setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: existingInDB.id } : o));
              addAgentLog("CUSTOMER_LINKED", "Customer existing (beda lokasi): " + existingInDB.name + " (" + form.phone + ")", "SUCCESS");
            } else {
              addAgentLog("CUSTOMER_SAVE_ERROR",
                "Gagal simpan customer " + form.customer + ": " + custErr.message, "ERROR");
              showNotif("⚠️ Customer gagal ke DB: " + custErr.message + " — tambah manual di menu Customer");
              setCustomersData(prev => [...prev, { ...insertPayload, id: "CUST_LOCAL_" + Date.now() }]);
            }
          } else {
            const c1 = savedCust || { ...insertPayload, id: "CUST_" + Date.now() };
            setCustomersData(prev => [...prev, c1]);
            if (c1.id && !c1.id.startsWith("CUST_")) {
              await supabase.from("orders").update({ customer_id: c1.id }).eq("id", newId);
              setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: c1.id } : o));
            }
            addAgentLog("CUSTOMER_AUTO_ADDED", "Customer baru: " + form.customer + " (" + form.phone + ")", "SUCCESS");
            showNotif("✅ Order + Customer baru " + form.customer + " tersimpan ke database!");
          }
        }
      } else {
        // ── Customer EXISTING: update total_orders & last_service + pastikan order ter-link ──
        const updatedOrders = (existing.total_orders || 0) + 1;
        setCustomersData(prev => prev.map(c =>
          sameCustomer(c, form.phone, form.customer)
            ? { ...c, total_orders: updatedOrders, last_service: orderDate }
            : c
        ));
        // Pastikan order ter-link ke customer_id (kalau sebelumnya null karena race condition)
        if (existing.id && !newOrder.customer_id) {
          await supabase.from("orders").update({ customer_id: existing.id }).eq("id", newId);
          setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: existing.id } : o));
        }
        try {
          await supabase.from("customers")
            .update({ total_orders: updatedOrders, last_service: orderDate })
            .eq("id", existing.id);
        } catch (e) {
          addAgentLog("CUSTOMER_UPDATE_WARN", "Gagal update total_orders: " + (e?.message || ""), "WARNING");
        }
      }
    }
    return newId;
  };

  // ── createTeamSplit: 1 project maintenance PT dipecah jadi N sub-order paralel ──
  // Tiap tim = 1 pasangan teknisi+helper + subset unit. Semua sub-order share
  // job_group_id = id parent (sub-order pertama). Parent = order dgn id === job_group_id.
  // base: { customer, phone, address, area, service, type, date, time, notes, maintenance_client_id }
  // teams: [{ teknisi, helper, unitIds: [] }]  — minimal 2 tim dgn unit terisi.
  // Return groupId (parent id) atau null jika gagal total.
  const createTeamSplit = async ({ base, teams }) => {
    if (!base?.date) { showNotif("❌ Tanggal wajib"); return null; }
    const valid = (teams || []).filter(t => Array.isArray(t.unitIds) && t.unitIds.length > 0);
    if (valid.length < 2) { showNotif("❌ Minimal 2 tim dengan unit terisi"); return null; }

    const mkId = () => "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const groupId = mkId();
    const created = [];

    for (let i = 0; i < valid.length; i++) {
      const t = valid[i];
      const id = i === 0 ? groupId : mkId();
      const units = t.unitIds.length;
      const timeEnd = hitungJamSelesai(base.time || "09:00", base.service || "Cleaning", units);
      let teknisi = (t.teknisi || "").trim() || null;
      let helper = teknisi ? ((t.helper || "").trim() || null) : null;
      let status = teknisi ? "CONFIRMED" : "PENDING";

      // Cek bentrok jadwal teknisi (real-time DB). Bentrok → turunkan ke PENDING.
      if (teknisi && base.time) {
        const dbCheck = await cekTeknisiAvailableDB(teknisi, base.date, base.time, base.service, units);
        if (!dbCheck.ok) {
          showNotif(`⚠️ Tim ${i + 1}: ${teknisi} bentrok jadwal → dibuat PENDING (assign ulang di Planning Order)`);
          teknisi = null; helper = null; status = "PENDING";
        }
      }

      const order = {
        id,
        customer: base.customer, phone: base.phone ? normalizePhone(base.phone) : null,
        address: base.address || "", area: base.area || "",
        service: base.service, type: base.type || base.service, units,
        teknisi, helper,
        date: base.date, time: base.time || "09:00", time_end: timeEnd, status,
        dispatch: false, source: "maintenance",
        job_group_id: groupId, is_team_split: true,
        maintenance_client_id: base.maintenance_client_id || null,
        maintenance_unit_ids: t.unitIds,
        notes: [base.notes, `Tim ${i + 1}/${valid.length}`].filter(Boolean).join(" · "),
      };

      const { error } = await insertOrder(supabase, order);
      if (error) { showNotif(`❌ Tim ${i + 1} gagal disimpan: ${error.message}`); continue; }
      created.push(order);

      // Gerbang atomik anti double-book (sama pola createOrder). Kalah race → turunkan PENDING.
      if (teknisi && base.time && timeEnd) {
        try {
          const { data: claimOk } = await supabase.rpc("try_claim_teknisi_slot", {
            p_teknisi: teknisi, p_date: base.date, p_order_id: id,
            p_start: base.time, p_end: timeEnd,
          });
          if (claimOk === false) {
            await supabase.from("orders").update({ teknisi: null, helper: null, status: "PENDING" }).eq("id", id);
            order.teknisi = null; order.helper = null; order.status = "PENDING";
            showNotif(`🚫 Tim ${i + 1}: ${teknisi} slot baru saja terisi → jadi PENDING`);
          }
        } catch (e) { console.warn("team-split claim slot:", e.message); }
      }
    }

    if (!created.length) return null;
    invalidateCache("orders");
    // Dedup: realtime bisa keburu menambah order yang baru dibuat ke `prev`
    // sebelum baris ini jalan → buang dulu id yang sama agar tak dobel.
    setOrdersData(prev => {
      const ids = new Set(created.map(o => o.id));
      return [...created, ...prev.filter(o => !ids.has(o.id))];
    });
    addAgentLog("TEAM_SPLIT_CREATED",
      `Project ${groupId} — ${created.length} tim · ${base.customer} (${valid.reduce((s, t) => s + t.unitIds.length, 0)} unit)`, "SUCCESS");
    showNotif(`✅ Project dibuat: ${created.length} tim (grup ${groupId}). Cek/assign di Planning Order.`);
    return groupId;
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

    // bizContext (data bisnis live untuk ARA) — diekstrak ke lib/araContext.js (pure, read-only).
    const bizContext = buildAraContext({
      today: TODAY, bulanIni,
      ordersData, invoicesData, inventoryData, customersData, laporanReports,
      teknisiData, waConversations, paymentSuggestions, priceListData, PRICE_LIST,
      cariSlotKosong, araSchedulingSuggest,
    });

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
        const sysP = (typeof brainMd === "string" ? brainMd : BRAIN_MD_DEFAULT) + `\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext)}\n\n## TOOL — ACTIONS TERSEDIA\nGunakan [ACTION]{...}[/ACTION] untuk eksekusi operasi. Format JSON:\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"labor","value":100000} (field: labor/material/discount/notes. Detail material ada di invoices[].materials_detail)\\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"material","value":200000} (ubah total material)\\n- {"type":"MARK_PAID","id":"INV-xxx"}\n- {"type":"APPROVE_INVOICE","id":"INV-xxx"}\n- {"type":"SEND_REMINDER","invoice_id":"INV-xxx"}\n- {"type":"UPDATE_ORDER_STATUS","id":"JOB-xxx","status":"COMPLETED"}\n- {"type":"DISPATCH_WA","order_id":"JOB-xxx"}\n- {"type":"SEND_WA","phone":"628xxx","message":"..."}\n- {"type":"UPDATE_STOCK","code":"MAT001","delta":5} (delta=tambah/kurang)\n- {"type":"CANCEL_ORDER","id":"JOB-xxx","reason":"..."}
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
            setInvoicesData(prev => prev.map(i => { if (i.id !== act.id) return i; const u = { ...i, [act.field]: act.value }; u.total = (u.labor || 0) + (u.material || 0) - (u.discount || 0) - (u.trade_in ? (u.trade_in_amount || 0) : 0); return u; }));
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
            setOrdersData(prev => prev.some(o => o.id === newOrd.id) ? prev : [...prev, newOrd]);
            const { error: oErr } = await insertOrder(supabase, newOrd);
            if (oErr) console.warn("Create order DB:", oErr.message);
            addAgentLog("ARA_CREATE_ORDER", "ARA buat order " + newId + " untuk " + newOrd.customer, "SUCCESS");

            // ── Auto-upsert customer + link customer_id ke order ──
            if (newOrd.phone && newOrd.customer) {
              const existingCust = findCustomer(customersData, newOrd.phone, newOrd.customer);
              if (!existingCust) {
                try {
                  const { data: savedCust } = await supabase.from("customers")
                    .upsert({ name: newOrd.customer.trim(), phone: newOrd.phone, address: newOrd.address || "", joined: newOrd.date, last_service: newOrd.date, is_vip: false, total_orders: 1 }, { onConflict: "phone" })
                    .select().single();
                  if (savedCust?.id) {
                    await supabase.from("orders").update({ customer_id: savedCust.id }).eq("id", newId);
                    setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: savedCust.id } : o));
                    setCustomersData(prev => [...prev, savedCust]);
                  }
                } catch (e) { console.warn("Customer upsert:", e?.message); }
                ar += "\n👤 *Customer baru ditambahkan: " + newOrd.customer + "*";
              } else {
                // Link customer_id + update total_orders
                if (existingCust.id && !newOrd.customer_id) {
                  await supabase.from("orders").update({ customer_id: existingCust.id }).eq("id", newId);
                  setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: existingCust.id } : o));
                }
                setCustomersData(prev => prev.map(c =>
                  sameCustomer(c, newOrd.phone, newOrd.customer) ? { ...c, total_orders: (c.total_orders || 0) + 1, last_service: newOrd.date } : c
                ));
                try {
                  await supabase.from("customers").update({
                    total_orders: (existingCust.total_orders || 0) + 1, last_service: newOrd.date
                  }).eq("id", existingCust.id);
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

              const labor = PRICE_LIST[ord.service]?.[effectiveType] ??
                PRICE_LIST[ord.service]?.["default"] ?? 0;
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

              const totalInv = laborTotal + materialCost;

              // Build line item ARA: 1 baris jasa (labor) + baris material dari laporan
              // (harga di-resolve dari inventory/PRICE_LIST seperti perhitungan materialCost),
              // lalu ringkasan diturunkan dari line item via summarize (single source of truth).
              const _resolveMatPrice = (m) => {
                const _mNama = (m.nama || "").toLowerCase();
                const _invItem = inventoryData.find(inv =>
                  inv.name.toLowerCase().includes(_mNama) || _mNama.includes(inv.name.toLowerCase()));
                let harga = parseFloat(m.harga_satuan) || _invItem?.price || m.harga || m.price || 0;
                if (!harga) {
                  if (_mNama.includes("r-22") || _mNama.includes("r22")) harga = PRICE_LIST["freon_R22"] || 150000;
                  else if (_mNama.includes("r-32") || _mNama.includes("r32")) harga = PRICE_LIST["freon_R32"] || 450000;
                  else if (_mNama.includes("r-410") || _mNama.includes("r410")) harga = PRICE_LIST["freon_R410A"] || 450000;
                }
                return harga;
              };
              const _araLines = (() => {
                const lines = [];
                if (laborTotal > 0) lines.push({
                  nama: ord.service + (ord.type ? " - " + ord.type : ""), jumlah: ord.units || 1, satuan: "unit",
                  harga_satuan: Math.round(laborTotal / (ord.units || 1)), subtotal: laborTotal, keterangan: "jasa",
                });
                const mats = (() => {
                  if (lapRep?.materials_json) { try { return JSON.parse(lapRep.materials_json); } catch (_) { } }
                  return safeArr(lapRep?.materials);
                })().filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
                mats.forEach(m => {
                  const qty = parseFloat(m.jumlah) || 1;
                  const harga = _resolveMatPrice(m);
                  lines.push({ nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: harga, subtotal: harga * qty, keterangan: m.keterangan || "barang" });
                });
                return normalizeLines(lines);
              })();
              const _araSum = summarize(_araLines);
              const newInv = {
                id: invId, job_id: ord.id,
                customer: ord.customer, phone: ord.phone || "",
                service: ord.service + (ord.type ? " - " + ord.type : ""),
                units: ord.units || 1,
                labor: _araSum.labor,
                material: _araSum.material,
                materials_detail: _araLines.length > 0 ? JSON.stringify(_araLines) : null,
                discount: 0,
                trade_in: false,
                trade_in_amount: 0,
                total: _araSum.total,
                status: "PENDING",
                garansi_days: 30,
                garansi_expires: new Date(Date.now() + 30 * 86400000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
                laporan_id: lapRep?.id || null,
                due: new Date(Date.now() + 3 * 86400000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
                sent: false, created_at: getLocalISOString()
              };
              {
                const _chk = checkInvoiceConsistency({ ...newInv, lines: _araLines });
                if (!_chk.ok) addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, newInv.id) + " (ARA)", "WARNING");
              }
              invalidateCache("invoices", "orders");
              setInvoicesData(prev => prev.some(i => i.id === newInv.id) ? prev : [...prev, newInv]);
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
Terima kasih — *${appSettings.app_name || "AClean"} Service* 😊`;
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
              teknisi_name: (act.teknisi_name || act.nama_karyawan || "").trim() || null,
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
                    }).then(() => {});
                    await supabase.from("inventory").update({ stock: newStock, updated_at: new Date().toISOString() }).eq("code", matchedItem.code).then(() => {});
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
                setOrdersData(prev => prev.some(o => o.id === bOrd.id) ? prev : [...prev, bOrd]);
                const { error: bErr } = await insertOrder(supabase, bOrd);
                if (!bErr && bOrd.phone && bOrd.customer) {
                  const bCust = findCustomer(customersData, bOrd.phone, bOrd.customer);
                  if (bCust?.id) {
                    await supabase.from("orders").update({ customer_id: bCust.id }).eq("id", bId);
                  }
                }
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
    { id: "finance", icon: "💰", label: "Finance" },
    { id: "wa-inbox", icon: "📌", label: "Planning Order" },
    { id: "orders", icon: "📋", label: "Order Masuk" },
    { id: "schedule", icon: "📅", label: "Jadwal" },
    { id: "invoice", icon: "🧾", label: "Invoice" },
    { id: "customers", icon: "👥", label: "Customer" },
    { id: "inventory", icon: "📦", label: "Inventori" },
    { id: "pricelist", icon: "💰", label: "Price List" },
    { id: "teknisi", icon: "👷", label: "Tim Teknisi" },
    { id: "laporantim", icon: "📝", label: "Laporan Tim" },
    { id: "maintenance", icon: "🏢", label: "Maintenance" },
    { id: "project", icon: "🏗", label: "Project" },
    { id: "ara", icon: "🤖", label: "ARA Chat" },
    { id: "reports", icon: "📊", label: "Statistik" },
    { id: "deletedaudit", icon: "🗑", label: "Deleted Audit" },
    { id: "monitoring", icon: "🔍", label: "Monitoring" },
    { id: "wa_groups", icon: "📡", label: "Monitor WA" },
    { id: "settings", icon: "⚙️", label: "Pengaturan" },
    { id: "mattrack", icon: "🧮", label: "Stok Material" },
    { id: "biaya", icon: "💸", label: "Biaya" },
    // Teknisi-only menu (not shown to Owner/Admin)
    { id: "myreport", icon: "📋", label: "Laporan Saya" },
    { id: "matcheckout", icon: "📥", label: "Material Harian" },
    { id: "alatsaya", icon: "🧰", label: "Alat Saya" },
    { id: "komisi", icon: "💰", label: "Komisi Saya" },
  ];
  const menuItems = currentUser ? ALL_MENU.filter(m => canAccess(m.id)) : ALL_MENU;

  // ============================================================
  // RENDER DASHBOARD
  // ============================================================
  const renderDashboard = () => {
    // Props kasbon untuk widget di dashboard teknisi/helper
    const kasbonProps = {
      currentUser, kasbonRequests, setKasbonRequests, insertKasbonRequest,
      sendWA, appSettings, userAccounts, supabase, showNotif,
    };
    const expenseProps = { currentUser, apiHeaders: _apiHeaders, supabase, showNotif, TODAY };
    // Mobile teknisi/helper: tampilkan TechMobileView yang lebih sederhana
    if (isMobile && isTekRoleGlobal) {
      return (
        <TechMobileView
          currentUser={currentUser}
          ordersData={ordersData}
          TODAY={TODAY}
          openLaporanModal={openLaporanModal}
          openJobReport={openJobReport}
          materialsBroughtMap={materialsBroughtMap}
          updateOrderStatus={updateOrderStatus}
          supabase={supabase}
          sendWA={sendWA}
          auditUserName={auditUserName}
          showNotif={showNotif}
          setActiveMenu={setActiveMenu}
          apiHeaders={_apiHeaders}
          kasbonProps={kasbonProps}
          expenseProps={expenseProps}
        />
      );
    }
    // Desktop teknisi/helper: widget di atas DashboardView
    if (isTekRoleGlobal) {
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <ExpenseInputWidget {...expenseProps} />
          <KasbonWidget {...kasbonProps} />
          {renderDashboardMain()}
        </div>
      );
    }
    return renderDashboardMain();
  };

  const renderDashboardMain = () => {
    return (
    <DashboardView currentUser={currentUser} ordersData={ordersData} invoicesData={invoicesData} inventoryData={inventoryData}
      teknisiData={teknisiData} omsetView={omsetView} setOmsetView={setOmsetView} isMobile={isMobile} waConversations={waConversations}
      bulanIni={bulanIni} setActiveMenu={setActiveMenu} setInvoiceFilter={setInvoiceFilter} setModalOrder={setModalOrder}
      setWaPanel={setWaPanel} setWaTekTarget={setWaTekTarget} setModalWaTek={setModalWaTek}
      fmt={fmt} getTechColor={getTechColor} triggerRekapHarian={triggerRekapHarian} openLaporanModal={openLaporanModal} openBAPModal={openBAPModal} bapEnabled={appSettings?.bap_enabled === "true"}
      openMaterialBringModal={openMaterialBringModal} openJobReport={openJobReport} materialsBroughtMap={materialsBroughtMap} showNotif={showNotif} TODAY={TODAY}
      sendWA={sendWA} dispatchWA={dispatchWA} addAgentLog={addAgentLog}
      setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      customersData={customersData} laporanReports={laporanReports} findCustomer={findCustomer}
      setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab}
      expensesData={expensesData} supabase={supabase} apiHeaders={_apiHeaders} />
    );
  };

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
      customersData={customersData} setCustomersData={setCustomersData} teknisiData={teknisiData}
      currentUser={currentUser} supabase={supabase}
      showNotif={showNotif} showConfirm={showConfirm}
      auditUserName={auditUserName} TODAY={TODAY}
      sendWA={sendWA} showUndoToast={showUndoToast}
      insertOrder={insertOrder}
      apiHeaders={_apiHeaders} />
  );

  const renderOrders = () => (
    <OrdersView ordersData={searchOrder.trim() ? ordersDataMerged : ordersData} setOrdersData={setOrdersData} searchLoading={searchOrdLoading} orderFilter={orderFilter} setOrderFilter={setOrderFilter}
      orderTekFilter={orderTekFilter} setOrderTekFilter={setOrderTekFilter} orderDateFrom={orderDateFrom} setOrderDateFrom={setOrderDateFrom}
      orderDateTo={orderDateTo} setOrderDateTo={setOrderDateTo} searchOrder={searchOrder} setSearchOrder={setSearchOrder}
      orderPage={orderPage} setOrderPage={setOrderPage} orderServiceFilter={orderServiceFilter} setOrderServiceFilter={setOrderServiceFilter}
      currentUser={currentUser} customersData={customersData} setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab}
      setActiveMenu={setActiveMenu} setEditOrderItem={setEditOrderItem} setEditOrderForm={setEditOrderForm} setModalEditOrder={setModalEditOrder}
      setModalOrder={setModalOrder} showConfirm={showConfirm} showNotif={showNotif} dispatchStatus={dispatchStatus} sendDispatchWA={sendDispatchWA}
      deleteOrder={deleteOrder} addAgentLog={addAgentLog} auditUserName={auditUserName}
      downloadRekapHarian={downloadRekapHarian} triggerRekapHarian={triggerRekapHarian} supabase={supabase} TODAY={TODAY} ORDER_PAGE_SIZE={ORDER_PAGE_SIZE}
      showUndoToast={showUndoToast} insertOrder={insertOrder} />
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

    // Saat search aktif, gunakan invoicesDataMerged (sudah include hasil server search).
    // Saat tidak search, pakai invoicesData biasa supaya perilaku non-search tidak berubah.
    const sourceInv = searchInvoice.trim() ? invoicesDataMerged : invoicesData;
    let filteredInv = [...sourceInv];
    const todayDateStr = getLocalDate();
    if (invoiceFilter === "Garansi") {
      filteredInv = garansiAktif;
    } else if (invoiceFilter === "Hari Ini") {
      filteredInv = filteredInv.filter(inv => (inv.created_at || "").slice(0, 10) === todayDateStr);
    } else if (invoiceFilter === "Tanpa Bukti") {
      filteredInv = filteredInv.filter(inv => inv.status === "PAID" && inv.total > 0 && !inv.repair_gratis && !inv.payment_proof_url && inv.payment_proof_url !== "verified-no-proof");
    } else if (invoiceFilter !== "Semua") {
      filteredInv = filteredInv.filter(inv => inv.status === invoiceFilter);
    }
    // Date range filter
    if (invoiceDateFrom) filteredInv = filteredInv.filter(inv => (inv.created_at || "").slice(0, 10) >= invoiceDateFrom);
    if (invoiceDateTo) filteredInv = filteredInv.filter(inv => (inv.created_at || "").slice(0, 10) <= invoiceDateTo);
    if (searchInvoice.trim()) {
      const q = searchInvoice.trim().toLowerCase();
      // Multi-kolom — match cakupan server search (reads.js searchInvoicesServer)
      filteredInv = filteredInv.filter(inv =>
        (inv.customer || "").toLowerCase().includes(q) ||
        (inv.phone || "").includes(searchInvoice.trim()) ||
        (inv.id || "").toLowerCase().includes(q) ||
        (inv.job_id || "").toLowerCase().includes(q) ||
        (inv.teknisi || "").toLowerCase().includes(q)
      );
    }
    filteredInv.sort((a, b) => (b.created_at || b.sent || "").localeCompare(a.created_at || a.sent || ""));
    const unpaidCnt = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE" || i.status === "PARTIAL_PAID").length;

    return { filteredInv, garansiAktif, garansiKritis, unpaidCnt };
  }, [invoicesData, invoicesDataMerged, invoiceFilter, invoiceDateFrom, invoiceDateTo, searchInvoice]);

  const renderInvoice = () => (
    <InvoiceView invoiceFilterMemo={invoiceFilterMemo} invoicesData={invoicesData} setInvoicesData={setInvoicesData} searchLoading={searchInvLoading}
      invoicePage={invoicePage} setInvoicePage={setInvoicePage} currentUser={currentUser} isMobile={isMobile}
      invoiceFilter={invoiceFilter} setInvoiceFilter={setInvoiceFilter} searchInvoice={searchInvoice} invoiceDateFrom={invoiceDateFrom} setInvoiceDateFrom={setInvoiceDateFrom} invoiceDateTo={invoiceDateTo} setInvoiceDateTo={setInvoiceDateTo}
      setSearchInvoice={setSearchInvoice} setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      setEditInvoiceData={setEditInvoiceData} setEditInvoiceForm={setEditInvoiceForm} setEditJasaItems={setEditJasaItems}
      setEditInvoiceItems={setEditInvoiceItems} setModalEditInvoice={setModalEditInvoice}
      ordersData={ordersData} setOrdersData={setOrdersData} setActiveMenu={setActiveMenu} setAuditModal={setAuditModal}
      invoiceReminderWA={invoiceReminderWA} mergedInvoiceWA={mergedInvoiceWA} createConsolidatedInvoice={createConsolidatedInvoice} previewMergedInvoicePDF={previewMergedInvoicePDF} approveInvoice={approveInvoice} markPaid={markPaid}
      showConfirm={showConfirm} showNotif={showNotif} addAgentLog={addAgentLog} auditUserName={auditUserName}
      markInvoicePaid={markInvoicePaid} revertInvoicePaid={revertInvoicePaid} updateOrderStatus={updateOrderStatus} deleteInvoice={deleteInvoice} updateInvoice={updateInvoice}
      getLocalDate={getLocalDate} fmt={fmt} parseMD={parseMD} jasaSvcNames={jasaSvcNames} downloadRekapHarian={downloadRekapHarian}
      supabase={supabase} TODAY={TODAY} INV_PAGE_SIZE={INV_PAGE_SIZE}
      laporanReports={laporanReports} uploadServiceReportPDFForWA={uploadServiceReportPDFForWA} sendWAFn={sendWA}
      apiHeaders={_apiHeaders} setGroupPaymentCtx={setGroupPaymentCtx}
      paymentSuggestions={paymentSuggestions} setPaymentSuggestions={setPaymentSuggestions} fotoSrc={fotoSrc}
      customersData={customersData} priceListData={priceListData}
      quotationsData={quotationsData} setQuotationsData={setQuotationsData}
      uploadQuotationPDFFn={uploadQuotationPDFForWA}
      appSettings={appSettings}
      approveSaveOnly={approveSaveOnly} />
  );

  // ============================================================
  // RENDER INVENTORY
  // ============================================================
  const renderInventory = () => (
    <InventoryView inventoryData={inventoryData} searchInventory={searchInventory} setSearchInventory={setSearchInventory}
      inventoryPage={inventoryPage} setInventoryPage={setInventoryPage} currentUser={currentUser} supabase={supabase} fmt={fmt}
      showConfirm={showConfirm} showNotif={showNotif} setModalStok={setModalStok} setEditStokItem={setEditStokItem}
      setModalEditStok={setModalEditStok} setInventoryData={setInventoryData}
      setModalRestock={setModalRestock} setRestockItem={setRestockItem} TODAY={TODAY} />
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
      openWA={openWA} openLaporanModal={openLaporanModal}
      openJobReport={openJobReport} materialsBroughtMap={materialsBroughtMap}
      sendWA={sendWA} updateOrderStatus={updateOrderStatus}
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
      invoicesData={invoicesData} bonusCategories={bonusCategories} setBonusCategories={setBonusCategories}
      BONUS_LABELS={BONUS_LABELS} BONUS_DEFAULTS={BONUS_DEFAULTS} />
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

  // ── handleOrderSubmit: dipanggil oleh OrderFormModal.onSubmit ──
  const handleOrderSubmit = async (form) => {
    if (_orderSubmitLock.current) return;
    _orderSubmitLock.current = true;
    setIsSubmittingOrder(true);
    try {
      if (!form.customer) { showNotif("Nama customer wajib diisi"); return; }
      if (!form.teknisi) { showNotif("Pilih teknisi dulu"); return; }
      if (!form.date) { showNotif("Pilih tanggal dulu"); return; }
      if (form.teknisi && form.date && form.time) {
        const dbOk = await cekTeknisiAvailableDB(form.teknisi, form.date, form.time, form.service, form.units);
        if (!dbOk.ok) { showNotif("🚫 " + (dbOk.reason || "Jadwal bentrok, cek ulang")); return; }
      }
      setModalOrder(false);
      setContinuationSuggestion([]);
      setContinuationParentId(null);
      setNewOrderForm({ customer: "", phone: "", address: "", area: "", service: "Cleaning", type: "AC Split 0.5-1PK", units: 1, teknisi: "", helper: "", team_slot: "", date: "", time: "09:00", notes: "", maintenance_client_id: "", maintenance_unit_ids: [] });
      await createOrder(form);
    } finally {
      _orderSubmitLock.current = false;
      setIsSubmittingOrder(false);
    }
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

  const renderDeletedAudit = () => <DeletedAuditView supabase={supabase} currentUser={currentUser} showNotif={showNotif} setOrdersData={setOrdersData} setInvoicesData={setInvoicesData} />;

  // ============================================================
  // RENDER REPORTS
  // ============================================================
  const renderReports = () => (
    <ReportsView ordersData={ordersData} invoicesData={invoicesData} laporanReports={laporanReports} customersData={customersData}
      teknisiData={teknisiData} inventoryData={inventoryData} isMobile={isMobile} currentUser={currentUser}
      statsPeriod={statsPeriod} setStatsPeriod={setStatsPeriod} statsMingguOff={statsMingguOff} setStatsMingguOff={setStatsMingguOff}
      statsDateFrom={statsDateFrom} setStatsDateFrom={setStatsDateFrom} statsDateTo={statsDateTo} setStatsDateTo={setStatsDateTo}
      bulanIni={bulanIni} fmt={fmt} invoiceReminderWA={invoiceReminderWA} getTechColor={getTechColor} TODAY={TODAY}
      expensesData={expensesData} supabase={supabase} />
  );

  // ============================================================
  // RENDER LAPORAN TIM  (Owner & Admin)
  // ============================================================
  const renderLaporanTim = () => (
    <LaporanTimView laporanReports={searchLaporan.trim() ? laporanReportsMerged : laporanReports} searchLoading={searchLapLoading} setLaporanReports={setLaporanReports} ordersData={ordersData} setOrdersData={setOrdersData}
      invoicesData={invoicesData} setInvoicesData={setInvoicesData} priceListData={priceListData} currentUser={currentUser} isMobile={isMobile}
      laporanDateFilter={laporanDateFilter} setLaporanDateFilter={setLaporanDateFilter} laporanDateFrom={laporanDateFrom} setLaporanDateFrom={setLaporanDateFrom}
      laporanDateTo={laporanDateTo} setLaporanDateTo={setLaporanDateTo} laporanSvcFilter={laporanSvcFilter} setLaporanSvcFilter={setLaporanSvcFilter}
      laporanStatusFilter={laporanStatusFilter} setLaporanStatusFilter={setLaporanStatusFilter} laporanTeamFilter={laporanTeamFilter} setLaporanTeamFilter={setLaporanTeamFilter}
      searchLaporan={searchLaporan} setSearchLaporan={setSearchLaporan} laporanPage={laporanPage} setLaporanPage={setLaporanPage} userAccounts={userAccounts}
      setSelectedLaporan={setSelectedLaporan} setEditLaporanMode={setEditLaporanMode} setModalLaporanDetail={setModalLaporanDetail}
      setEditLaporanForm={setEditLaporanForm} setLaporanBarangItems={setLaporanBarangItems} setEditRepairType={setEditRepairType}
      setEditGratisAlasan={setEditGratisAlasan} setActiveEditUnitIdx={setActiveEditUnitIdx} setEditPhotoMode={setEditPhotoMode}
      setEditLaporanFotos={setEditLaporanFotos} setEditStockMats={setEditStockMats} setLaporanInstallItems={setLaporanInstallItems} setActiveMenu={setActiveMenu}
      safeArr={safeArr} fotoSrc={fotoSrc} showConfirm={showConfirm} showNotif={showNotif} addAgentLog={addAgentLog}
      auditUserName={auditUserName} getLocalDate={getLocalDate} fmt={fmt}
      updateServiceReport={updateServiceReport} deleteServiceReport={deleteServiceReport} insertInvoice={insertInvoice} deleteInvoice={deleteInvoice}
      updateOrder={updateOrder} updateOrderStatus={updateOrderStatus} markInvoicePaid={markInvoicePaid}
      lookupHargaGlobal={lookupHargaGlobal} hargaPerUnitFromTipe={hargaPerUnitFromTipe} getBracketKey={getBracketKey} hitungLabor={hitungLabor}
      sendWA={sendWA} supabase={supabase} LAP_PAGE_SIZE={LAP_PAGE_SIZE} INSTALL_ITEMS={INSTALL_ITEMS}
      downloadServiceReportPDF={downloadServiceReportPDF}
      setInvTxData={setInvTxData} setInventoryData={setInventoryData}
      updateCustomerTierAfterOrder={updateCustomerTierAfterOrder} customersData={customersData} setCustomersData={setCustomersData} apiFetch={_apiFetch} />
  );

  // ============================================================
  // RENDER MY REPORT  (Teknisi & Helper — laporan sendiri + edit)
  // ============================================================
  const renderMyReport = () => (
    <MyReportView laporanReports={searchLaporan.trim() ? laporanReportsMerged : laporanReports} searchLoading={searchLapLoading} projectDailyReports={projectDailyReports} ordersData={ordersData} invoicesData={invoicesData} currentUser={currentUser}
      searchLaporan={searchLaporan} setSearchLaporan={setSearchLaporan} setSelectedLaporan={setSelectedLaporan} setEditLaporanMode={setEditLaporanMode}
      setModalLaporanDetail={setModalLaporanDetail} setEditLaporanForm={setEditLaporanForm} setLaporanBarangItems={setLaporanBarangItems}
      setEditRepairType={setEditRepairType} setEditGratisAlasan={setEditGratisAlasan} setActiveEditUnitIdx={setActiveEditUnitIdx}
      setEditPhotoMode={setEditPhotoMode} setEditLaporanFotos={setEditLaporanFotos} setEditStockMats={setEditStockMats} setLaporanInstallItems={setLaporanInstallItems}
      openLaporanModal={openLaporanModal} openBAPModal={openBAPModal} bapEnabled={appSettings?.bap_enabled === "true"} safeArr={safeArr} TODAY={TODAY} INSTALL_ITEMS={INSTALL_ITEMS}
      downloadServiceReportPDF={downloadServiceReportPDF} />
  );

  // ============================================================
  // RENDER MATERIAL TRACKING (Stok & Pemakaian Material)
  // ============================================================
  const renderMatTrack = () => (
    <MatTrackView inventoryData={inventoryData} invUnitsData={invUnitsData} setInvUnitsData={setInvUnitsData} invTxData={invTxData} setInvTxData={setInvTxData}
      matTrackFilter={matTrackFilter} setMatTrackFilter={setMatTrackFilter} matTrackSearch={matTrackSearch} setMatTrackSearch={setMatTrackSearch}
      matTrackDateFrom={matTrackDateFrom} setMatTrackDateFrom={setMatTrackDateFrom} matTrackDateTo={matTrackDateTo} setMatTrackDateTo={setMatTrackDateTo}
      setModalStok={setModalStok} supabase={supabase} fetchInventoryUnits={fetchInventoryUnits} showNotif={showNotif} currentUser={currentUser} setInventoryData={setInventoryData} computeStockStatus={computeStockStatus} appSettings={appSettings} />
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
      auditUserName={auditUserName} setAuditModal={setAuditModal} TODAY={TODAY} EXPENSE_PAGE_SIZE={EXPENSE_PAGE_SIZE} fmt={fmt}
      showNotif={showNotif} showConfirm={showConfirm} appSettings={appSettings} setAppSettings={setAppSettings}
      teknisiData={teknisiData} userAccounts={userAccounts}
      kasbonRequests={kasbonRequests} approveKasbon={approveKasbon} rejectKasbon={rejectKasbon} />
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

  // Opsi-A: on-demand load untuk expenses, quotations — tidak masuk loadAll
  // (agent_logs kini diakses lewat Monitoring → tab Audit Log, server-side)
  useEffect(() => {
    if (!currentUser) return;
    if (activeMenu === "biaya" || activeMenu === "dashboard") {
      fetchExpenses(supabase).then(({ data, error }) => { if (!error && data) setExpensesData(data); }).catch(() => {});
      fetchKasbonRequests(supabase).then(({ data, error }) => { if (!error && data) setKasbonRequests(data); }).catch(() => {});
    } else if (activeMenu === "invoice" || activeMenu === "maintenance") {
      supabase.from("quotations").select("*").order("created_at", { ascending: false }).limit(200)
        .then(({ data, error }) => { if (!error && data) setQuotationsData(data); });
    }
  }, [activeMenu, currentUser]);

  const renderMonitoring = () => (
    <MonitoringView monitorData={monitorData} setMonitorLoading={setMonitorLoading} setMonitorData={setMonitorData} _apiHeaders={_apiHeaders} supabase={supabase} />
  );

  const renderWaGroupMonitor = () => (
    <WaGroupMonitorView currentUser={currentUser} supabase={supabase} showNotif={showNotif} showConfirm={showConfirm} auditUserName={auditUserName} apiHeaders={_apiHeaders} />
  );

  // ── Commission PIN Protection ──
  useEffect(() => {
    if (activeMenu !== "komisi") {
      // Reset saat keluar dari menu komisi
      setCommissionUnlocked(false);
      setCommissionPinAttempt("");
      setCommissionPinError("");
      setLivePin(undefined);
      return;
    }
    // Masuk menu komisi → ambil PIN TERBARU dari DB (anti session-basi).
    let cancelled = false;
    setLivePin(undefined); // loading
    (async () => {
      const uid = currentUser?.id;
      if (!uid || !isRealUUID(uid)) { if (!cancelled) setLivePin(currentUser?.commission_pin ?? null); return; }
      const { data, error } = await supabase.from("user_profiles").select("commission_pin").eq("id", uid).single();
      if (cancelled) return;
      setLivePin(error ? (currentUser?.commission_pin ?? null) : (data?.commission_pin ?? null));
    })();
    return () => { cancelled = true; };
  }, [activeMenu, currentUser?.id]);

  const handleCommissionPinSubmit = () => {
    if (!commissionPinAttempt.trim()) {
      setCommissionPinError("Silakan masukkan PIN");
      return;
    }

    if (commissionPinAttempt === livePin) {
      setCommissionUnlocked(true);
      setCommissionPinAttempt("");
      setCommissionPinError("");
    } else {
      setCommissionPinError("❌ PIN salah");
      setCommissionPinAttempt("");
    }
  };

  const CommissionPinModal = () => {
    // Tampil hanya bila sudah tahu ada PIN (livePin truthy) & belum unlock
    if (commissionUnlocked || !livePin) return null;
    
    return (
      <div style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}>
        <div style={{
          background: cs.card,
          border: "2px solid " + cs.accent,
          borderRadius: 16,
          padding: 32,
          maxWidth: 380,
          width: "90%",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: cs.text, marginBottom: 8 }}>
            Komisi Terlindungi
          </div>
          <div style={{ fontSize: 13, color: cs.muted, marginBottom: 20 }}>
            Masukkan PIN 4-6 digit untuk mengakses data komisi Anda
          </div>
          
          {/* PIN Input */}
          <input
            type="password"
            value={commissionPinAttempt}
            onChange={(e) => {
              setCommissionPinAttempt(e.target.value);
              setCommissionPinError("");
            }}
            onKeyPress={(e) => e.key === "Enter" && handleCommissionPinSubmit()}
            placeholder="••••"
            maxLength="6"
            inputMode="numeric"
            style={{
              width: "100%",
              padding: "14px",
              fontSize: 24,
              textAlign: "center",
              borderRadius: 10,
              border: "2px solid " + (commissionPinError ? cs.red : cs.border),
              background: cs.surface,
              color: cs.text,
              letterSpacing: "0.3em",
              boxSizing: "border-box",
              marginBottom: commissionPinError ? 8 : 16,
            }}
            autoFocus
          />
          
          {/* Error Message */}
          {commissionPinError && (
            <div style={{
              fontSize: 12,
              color: cs.red,
              marginBottom: 16,
              fontWeight: 700,
            }}>
              {commissionPinError}
            </div>
          )}
          
          {/* Buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleCommissionPinSubmit}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: 10,
                background: cs.accent,
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              ✓ Submit
            </button>
            <button
              onClick={() => {
                setActiveMenu("dashboard");
                setCommissionUnlocked(false);
                setCommissionPinAttempt("");
                setCommissionPinError("");
              }}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: 10,
                background: "transparent",
                border: "1px solid " + cs.border,
                color: cs.muted,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Keluar
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER CONTENT ROUTER
  // ============================================================
  const renderContent = () => {
    // Guard: blokir render menu yang tidak diizinkan untuk role (defense-in-depth)
    if (currentUser && !canAccess(activeMenu)) {
      return (
        <div style={{ padding: 48, textAlign: "center", color: cs.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, color: cs.text, marginBottom: 4 }}>Akses Ditolak</div>
          <div style={{ fontSize: 13 }}>Anda tidak memiliki akses ke menu ini.</div>
        </div>
      );
    }
    switch (activeMenu) {
      case "dashboard": return renderDashboard();
      case "finance": return <FinanceView currentUser={currentUser} ordersData={ordersData} invoicesData={invoicesData} expensesData={expensesData} supabase={supabase} teknisiData={teknisiData} showNotif={showNotif} showConfirm={showConfirm} openWA={openWA} TODAY={TODAY} />;
      case "wa-inbox": return renderOrderInbox();
      case "orders": return renderOrders();
      case "schedule": return renderSchedule();
      case "invoice": return renderInvoice();
      case "customers": return renderCustomers();
      case "inventory": return renderInventory();
      case "pricelist": return renderPriceList();
      case "teknisi": return renderTeknisiAdmin();
      case "laporantim": return renderLaporanTim();
      case "maintenance": return (
        <Suspense fallback={<div style={{ color: cs.muted, padding: 20 }}>Memuat...</div>}>
          <MaintenanceView
            currentUser={currentUser} apiFetch={_apiFetch}
            showNotif={showNotif} showConfirm={showConfirm}
            quotationsData={quotationsData} setQuotationsData={setQuotationsData}
            setOrdersData={setOrdersData}
            teknisiData={teknisiData} createOrderFn={createOrder} createTeamSplitFn={createTeamSplit}
            supabase={supabase} customersData={customersData}
            priceListData={priceListData} getLocalDate={getLocalDate}
            appSettings={appSettings} sendWAFn={sendWA}
            uploadQuotationPDFFn={uploadQuotationPDFForWA}
            setActiveMenu={setActiveMenu}
          />
        </Suspense>
      );
      case "project": return (
        <Suspense fallback={<div style={{ color: cs.muted, padding: 20 }}>Memuat...</div>}>
          <ProjectApp currentUser={currentUser} apiFetch={_apiFetch} appSettings={appSettings} onBack={() => setActiveMenu("dashboard")} />
        </Suspense>
      );
      case "myreport": return renderMyReport();
      case "komisi": return (
        <>
          <CommissionPinModal />
          <Suspense fallback={<div style={{ color: cs.muted, padding: 20 }}>Memuat...</div>}>
            {livePin === undefined ? (
              // Masih cek PIN dari DB — jangan tampilkan data dulu (hindari kebocoran sekejap)
              <div style={{ padding: 20, textAlign: "center", color: cs.muted }}>Memeriksa akses...</div>
            ) : (commissionUnlocked || !livePin) ? (
              <KomisiView currentUser={currentUser} supabase={supabase} bonusCategories={bonusCategories} BONUS_LABELS={BONUS_LABELS} />
            ) : (
              <div style={{ padding: 20, textAlign: "center", color: cs.muted }}>Masukkan PIN untuk melanjutkan...</div>
            )}
          </Suspense>
        </>
      );
      case "ara": return renderAra();
      case "reports": return renderReports();
      case "deletedaudit": return renderDeletedAudit();
      case "mattrack": return renderMatTrack();
      case "matcheckout": return (
        <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: cs.muted }}>Memuat…</div>}>
          <MaterialCheckoutView supabase={supabase} currentUser={currentUser} showNotif={showNotif}
            fotoSrc={fotoSrc} _apiFetch={_apiFetch} _apiHeaders={_apiHeaders} appSettings={appSettings}
            notifyOwnerWA={(msg) => userAccounts.filter(u => u.role === "Owner").forEach(u => u.phone && sendWA(u.phone, msg))} />
        </Suspense>
      );
      case "alatsaya": return (
        <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: cs.muted }}>Memuat…</div>}>
          <MyToolsView supabase={supabase} currentUser={currentUser} showNotif={showNotif}
            teknisiData={teknisiData} TODAY={TODAY} />
        </Suspense>
      );
      case "biaya": return renderExpenses();
      case "monitoring": return renderMonitoring();
      case "wa_groups": return renderWaGroupMonitor();
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

  // ── Laporan modal handlers (diekstrak dari IIFE render — Tahap 1 refactor) ──
  // Logika murni level-komponen; incompleteUnits dihitung ulang di dalam submitLaporan.
  const handleFotoUpload = async (e) => {
    const MAX_PHOTOS = 20;
    const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    // Foto baru di-tag ke unit hanya jika event berasal dari input per-unit (fotoUnitInputRef).
    // Upload dari uploader global (fotoInputRef) selalu unit_no=null (umum). Cara ini kebal
    // stale-ref: kalau picker per-unit dibatalkan, upload global berikutnya tidak salah tag.
    const fromUnitInput = e.target === fotoUnitInputRef.current;
    const targetUnitNo = fromUnitInput ? fotoTargetUnitRef.current : null;
    fotoTargetUnitRef.current = null;

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
      unit_no: targetUnitNo || null,
    }));
    // Push placeholders ke state supaya user lihat progress langsung
    setLaporanFotos(prev => [...prev, ...placeholders]);

    const uploadOne = async (ph) => {
      try {
        const r = await _apiFetch("/api/upload-foto", {
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
    if (submitLaporanLock.current) { showNotif("⏳ Sedang submit, harap tunggu..."); return; }
    submitLaporanLock.current = true;
    try {
    // ── 1. Definisikan isInstall PERTAMA sebelum digunakan ──
    const isInstall = laporanModal?.service === "Install";
    const isSurvey = laporanModal?.service === "Survey";
    const incompleteUnits = laporanUnits.filter(u => !isUnitDone(u));

    // ── Survey: submit langsung, bypass 4-step wizard ──
    if (isSurvey) {
      if (!laporanSurveyHasil.trim()) {
        showNotif("⚠️ Hasil Survey wajib diisi");
        submitLaporanLock.current = false;
        return;
      }
      const now = new Date().toLocaleString("id-ID", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const reportId = "LPR_" + laporanModal.id + "_" + Date.now().toString(36).slice(-4).toUpperCase();
      const surveyFotoUrls = laporanFotos.filter(f => f.url).map(f => f.url);
      const surveyReport = {
        id: reportId, job_id: laporanModal.id, teknisi: laporanModal.teknisi,
        helper: laporanModal.helper || null, customer: laporanModal.customer,
        service: "Survey", date: laporanModal.date, submitted: now,
        status: "SUBMITTED", total_units: 0, units: [], materials: [],
        fotos: laporanFotos.filter(f => f.url).map(f => ({ id: f.id, label: f.label, url: f.url, unit_no: f.unit_no || null })),
        foto_urls: surveyFotoUrls,
        total_freon: 0, rekomendasi: "", catatan_global: "",
        hasil_survey: laporanSurveyHasil.trim(),
        catatan_rekomendasi: laporanSurveyCatatan.trim(),
        editLog: [],
      };
      setLaporanReports(prev => [...prev.filter(r => r.job_id !== laporanModal.id), surveyReport]);
      showNotif("⏳ Menyimpan laporan survey...");
      try {
        await supabase.from("service_reports").delete().eq("job_id", reportId).neq("id", reportId);
      } catch (_) {}
      const { error: sErr } = await supabase.from("service_reports").upsert({
        id: reportId, job_id: laporanModal.id, teknisi: laporanModal.teknisi,
        helper: laporanModal.helper || null, customer: laporanModal.customer,
        service: "Survey", date: laporanModal.date, status: "SUBMITTED",
        total_units: 0, total_freon: 0, submitted_at: new Date().toISOString(),
        foto_urls: surveyFotoUrls, rekomendasi: "", catatan_global: "",
        hasil_survey: laporanSurveyHasil.trim(),
        catatan_rekomendasi: laporanSurveyCatatan.trim(),
        submitted: now,
      }, { onConflict: "id" });
      if (sErr) { showNotif("⚠️ Tersimpan lokal, sync gagal: " + sErr.message); }
      else { showNotif("✅ Laporan Survey terkirim!"); }
      const admR2 = userAccounts.filter(u => u.role === "Admin" || u.role === "Owner");
      admR2.forEach(u => { if (u.phone) sendWA(u.phone, "Laporan Survey\nJob: " + laporanModal.id + "\nCustomer: " + laporanModal.customer + "\nTeknisi: " + laporanModal.teknisi + "\n\nHasil: " + laporanSurveyHasil.trim().slice(0, 200)); });
      setLaporanSubmitted(true);
      submitLaporanLock.current = false;
      return;
    }

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
      "kabel_15": "SKU025",  // Kabel Listrik 3x1,5
      "kabel_25": "SKU026",  // Kabel Listrik 3x2,5
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
      fotos: laporanFotos.filter(f => f.url).map(f => ({ id: f.id, label: f.label, url: f.url, unit_no: f.unit_no || null })),
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
    const adminUsers = userAccounts.filter(u => u.role === "Owner");
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
          fotos: laporanFotos.filter(f => f.url).map(f => ({ url: f.url, label: f.label || "", unit_no: f.unit_no || null })),
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
          + `Kamu tercatat sebagai helper. Cek di menu Laporan Saya. — ${appSettings.app_name || "AClean"}`
        );
      }
    }

    // ── 11. Stok material tracked (pipa/freon): idempotent sync ──
    // syncTrackedStock: hapus usage lama → insert baru → recalculate dari DB.
    // Berlaku submit pertama DAN rewrite — input terakhir selalu yang menang.
    const isRewriteLaporan = !!laporanModal._rewriteId;
    const syncReportId = newReport.id; // selalu pakai ID laporan final (sama untuk rewrite)
    // Opsi A: kalau material_confirm_deduct ON, stok pipa/kabel/freon dipotong lewat Material Harian (confirm Owner),
    // BUKAN dari submit laporan. Jadi keluarkan kategori itu dari deduct laporan (cegah dobel).
    const confirmDeductOn = appSettings?.material_confirm_deduct_enabled === "true";
    const isHarianManaged = (m) => ["pipa", "kabel", "freon"].includes(classifyMaterial(m?.nama || ""));
    const dropHarian = (arr) => confirmDeductOn ? (arr || []).filter((m) => !isHarianManaged(m)) : (arr || []);
    const materialsForSync = dropHarian(isInstall ? effectiveMaterials : laporanMaterials);
    await syncTrackedStock(
      syncReportId,
      laporanModal.id,
      materialsForSync,
      laporanModal?.customer || null,
      laporanModal?.teknisi || null,
      laporanModal?.date || null
    );

    // ── 11b. Material non-tracked: deduct via deductInventory (lama, hanya sekali saat submit baru) ──
    const barangAsDeducts = laporanBarangItems.filter(b => b.nama && parseFloat(b.jumlah || 0) > 0)
      .map(b => ({ nama: b.nama, jumlah: parseFloat(b.jumlah) || 1, satuan: b.satuan || "pcs", keterangan: "barang" }));
    const materialsToDeduct = dropHarian(isInstall ? effectiveMaterials : [...laporanMaterials, ...barangAsDeducts]);
    const nonTrackedToDeduct = materialsToDeduct.filter(m =>
      !isTrackedByCode(m.inv_code || m._useCode) && !isTrackedByName(m.nama) && !m.freon_tabung_code
    );

    if (!isRewriteLaporan && nonTrackedToDeduct.length > 0) {
      deductInventory(
        nonTrackedToDeduct,
        laporanModal?.id || null,
        null,
        laporanModal?.customer || null,
        laporanModal?.teknisi || null,
        laporanModal?.date || null
      );
      setTimeout(() => {
        const kritisItems = inventoryData.filter(i =>
          nonTrackedToDeduct.some(m => i.name.toLowerCase().includes((m.nama || "").toLowerCase())) &&
          (i.status === "CRITICAL" || i.status === "OUT")
        );
        if (kritisItems.length > 0) {
          const warnings = kritisItems.map(i => `${i.name} sisa ${i.stock} ${i.unit}`);
          showNotif("⚠️ Stok kritis: " + warnings.join(", "));
          const ownerAccs = userAccounts.filter(u => u.role === "Owner");
          const lowMsg = `⚠️ *Stok Material Kritis*\nSetelah job ${laporanModal.id}:\n` + warnings.map(w => "• " + w).join("\n");
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
      return (pl && pl.price > 0) ? pl.price : 0;
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
      // Team-split: invoice B2B tunggal per project, di-key ke job_group_id untuk SEMUA
      // anggota grup. Tim mana pun yang diverifikasi duluan membuat invoice; sisanya menemukan
      // invoice itu via job_id = job_group_id → skip (anti invoice ganda).
      // Multi-hari TIDAK ditangani di sini — diproses dengan AKUMULASI di bawah (setelah mDetail
      // dibangun) lewat resolveMultiDayInvoiceAction(): 1 invoice induk, item tiap hari digabung.
      const isTeamSplit = !!laporanModal.is_team_split && !!laporanModal.job_group_id;
      if (isTeamSplit) {
        const groupInv = invoicesData.find(i => i.job_id === laporanModal.job_group_id);
        if (groupInv && !["CANCELLED", "PAID"].includes(groupInv.status)) {
          // Invoice grup sudah ada & masih aktif — notif saja, jangan buat invoice baru
          showNotif(`ℹ️ Laporan tim project terkirim. Invoice grup ${groupInv.id} sudah ada — minta Admin/Owner update total jika ada tambahan.`);
          addAgentLog("GROUP_CHILD_LAPORAN",
            `Laporan ${laporanModal.id} (tim project) — invoice grup ${groupInv.id} sudah ada, skip buat invoice baru`,
            "INFO");
          setLaporanModal(null);
          return;
        }
      }

      const invSeq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
      const invId = "INV-" + todayInv.replace(/-/g, "").slice(0, 8) + "-" + invSeq;
      const gDays = 30; // Semua service: garansi 30 hari dari terbit invoice
      const gExpires = new Date(Date.now() + gDays * 86400000).toISOString().slice(0, 10);

      // garansi_status: hanya untuk state lokal (tidak ada kolom ini di DB)
      const garansiStatusLocal = isComplainSvc
        ? (prevGaransiActive ? (matTotalInv > 0 ? 'GARANSI_DENGAN_MATERIAL' : 'GARANSI_AKTIF')
          : prevGaransiExpired ? 'GARANSI_EXPIRED' : 'NO_GARANSI')
        : null;

      // ── mDetail = single source of truth baris invoice — diekstrak ke lib/laporanInvoice.js ──
      // buildInvoiceDetail murni (no DB/setState). Warranty discount line (Complain dalam garansi)
      // ikut dibangun di dalamnya. Orkestrasi (skip/multi-hari/insert) tetap di submitLaporan.
      const { mDetail } = buildInvoiceDetail({
        order: laporanModal, units: laporanUnits,
        jasaItems: laporanJasaItems, repairItems: laporanRepairItems, barangItems: laporanBarangItems,
        effectiveMaterials, cleaningInRepair: laporanCleaningInRepair,
        finalLabor, isRepairGratis, prevGaransiActive,
        priceListData, lookupHargaGlobal, hitungLabor,
      });

      // ── SINGLE SOURCE OF TRUTH: ringkasan DITURUNKAN dari mDetail via lib/invoicing ──
      // Dulu labor=finalLabor & material=matTotalInv dihitung dari variabel terpisah → desync
      // (transport/biaya-cek/barang inject tak terhitung). Sekarang summarize() = satu-satunya
      // perhitungan: jasa/repair = labor, sisanya (barang/freon/material) = material,
      // total = jumlah semua baris. Konsisten di semua jalur invoice.
      const _summary = summarize(mDetail);
      const finalTotalFromDetail = _summary.lineTotal;
      const laborFromDetail = _summary.labor;
      const matFromDetail = _summary.material;

      // ── MULTI-HARI: akumulasi ke 1 invoice INDUK, bukan invoice ganda ───────────────
      // Hanya untuk laporan is_multi_day. Flow normal & team-split tidak terpengaruh sama sekali.
      // Cek invoice grup langsung ke DB (race-safe) → MERGE / CREATE / CREATE_SEPARATE.
      let didMergeMultiDay = false;
      let multiDayAnchorJobId = null;
      // ── Anti-duplikat invoice (defense-in-depth) ──
      // (a) order SUDAH tertaut invoice aktif (gabungan manual job_id=null / edit ulang), atau
      // (b) order hari ke-2+ (day_number>1) yang TIDAK ter-flag is_multi_day (data cacat) →
      // JANGAN buat invoice baru; cukup tautkan + COMPLETED. (Multi-hari ter-flag benar lanjut
      // ke resolver di bawah.) Laporan tetap tersimpan — hanya pembuatan invoice yang di-skip.
      {
        const _ordDup = ordersData.find(o => o.id === laporanModal.id);
        const _linkedDup = _ordDup?.invoice_id
          ? invoicesData.find(i => i.id === _ordDup.invoice_id && String(i.status || "").toUpperCase() !== "CANCELLED")
          : null;
        const _orphanMD = laporanModal.is_multi_day !== true && _ordDup?.is_multi_day !== true
          && Number(laporanModal.day_number || _ordDup?.day_number) > 1;
        if (laporanModal.service !== "Survey" && (_linkedDup || _orphanMD)) {
          const _tgt = _linkedDup?.id || _ordDup?.invoice_id || null;
          setOrdersData(prev => prev.map(o => o.id === laporanModal.id ? { ...o, status: "COMPLETED", ...(_tgt ? { invoice_id: _tgt } : {}) } : o));
          try { await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName(), _tgt ? { invoice_id: _tgt } : {}); } catch (_) { }
          addAgentLog("INVOICE_DUP_GUARD",
            `Laporan ${laporanModal.id} (hari ke-${laporanModal.day_number || "?"}) — ${_linkedDup ? "tertaut invoice " + _linkedDup.id : "day_number>1 tanpa flag multi-hari"}, TIDAK buat invoice baru`, "INFO");
          showNotif(_linkedDup
            ? `ℹ️ Laporan masuk & ditautkan ke invoice ${_linkedDup.id}. Tidak ada invoice baru — edit invoice induk bila perlu.`
            : `ℹ️ Laporan hari ke-${laporanModal.day_number || "?"} masuk. Tidak buat invoice baru (multi-hari) — tautkan/edit invoice induk manual.`);
          didMergeMultiDay = true;
        }
      }
      if (!didMergeMultiDay && laporanModal.is_multi_day === true) {
        const projectKey = multiDayProjectKey(laporanModal);
        const { data: grpRows, error: grpErr } = await supabase
          .from("invoices")
          .select("id,job_id,status,materials_detail,labor,material,total,garansi_days,garansi_expires,created_at")
          .eq("job_id", projectKey)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: true });
        if (grpErr) {
          console.error("[MULTIDAY_PRECHECK]", grpErr.message);
          showNotif("❌ Gagal cek invoice grup multi-hari — submit dibatalkan, coba lagi.");
          return;
        }
        const mdAction = resolveMultiDayInvoiceAction({ report: laporanModal, invoices: grpRows || [] });
        multiDayAnchorJobId = mdAction.anchorJobId;

        if (mdAction.type === "SKIP") {
          // Multi-hari: invoice induk SUDAH ADA & belum lunas → JANGAN buat invoice baru
          // DAN JANGAN tambah nilai otomatis (SOP: laporan harian tumpang-tindih → cegah
          // dobel-hitung). Cukup tautkan order ini ke invoice induk; Owner edit manual.
          const existing = mdAction.existing;
          setOrdersData(prev => prev.map(o => o.id === laporanModal.id ? { ...o, status: "COMPLETED", invoice_id: existing.id } : o));
          try { await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName(), { invoice_id: existing.id }); } catch (_) { }
          addAgentLog("MULTIDAY_SKIP_INVOICE",
            `Laporan ${laporanModal.id} (hari ke-${laporanModal.day_number || "?"}) — invoice induk ${existing.id} sudah ada, tidak buat/menambah (edit manual bila perlu)`,
            "INFO");
          showNotif(`ℹ️ Laporan hari ke-${laporanModal.day_number || "?"} masuk & ditautkan ke invoice induk ${existing.id} (${fmt(existing.total)}). Tidak ada invoice baru — edit invoice induk bila ada tambahan.`);
          didMergeMultiDay = true;
        }
        // CREATE / CREATE_SEPARATE → lanjut ke pembuatan invoice di bawah (anchor = multiDayAnchorJobId).
      }

      if (!didMergeMultiDay) {
      // P1: simpan kategori billing eksplisit per baris (bukan tebak nama saat baca).
      const _normDetail = normalizeLines(mDetail);
      // Multi-hari (CREATE): tag tiap baris dgn source_job_id agar idempotent untuk akumulasi berikutnya.
      const detailToStore = laporanModal.is_multi_day === true
        ? _normDetail.map(r => ({ ...r, source_job_id: laporanModal.id }))
        : _normDetail;
      const newInvoice = {
        id: invId,
        // Multi-hari → anchor dari resolveMultiDayInvoiceAction (induk utk CREATE, id order sendiri
        // utk CREATE_SEPARATE saat invoice grup sudah lunas). Team-split → job_group_id. Sisanya → id sendiri.
        job_id: (laporanModal.is_multi_day === true && multiDayAnchorJobId)
          ? multiDayAnchorJobId
          : (laporanModal.is_team_split && laporanModal.job_group_id)
            ? laporanModal.job_group_id
            : laporanModal.id,
        customer: laporanModal.customer,
        phone: laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone || "",
        service: laporanModal.service + (laporanModal.type ? " - " + laporanModal.type : ""),
        units: laporanUnits.length,
        labor: laborFromDetail,
        material: matFromDetail,
        materials_detail: detailToStore,     // array untuk state/display (tagged source_job_id utk multi-hari)
        garansi_status: garansiStatusLocal,  // hanya state, tidak ke DB
        repair_gratis: isRepairGratis ? laporanRepairType : undefined,  // NEW: store repair type (gratis-garansi/gratis-customer)
        discount: 0,
        trade_in: false,
        trade_in_amount: 0,
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

      // ── Auto-discount membership tier (Gold: jasa 5%, Platinum: jasa 5% + material 5%) ──
      {
        const custPhone = laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone;
        const custData = custPhone ? customersData.find(c => c.phone === custPhone || c.phone === normalizePhone(custPhone)) : null;
        const custTier = custData?.membership_tier;
        if (custTier === "gold" || custTier === "platinum") {
          const laborDisc = Math.round((newInvoice.labor || 0) * 0.05);
          const matDisc = custTier === "platinum" ? Math.round((newInvoice.material || 0) * 0.05) : 0;
          const memberDisc = laborDisc + matDisc;
          if (memberDisc > 0 && newInvoice.total > 0 && newInvoice.status === "PENDING_APPROVAL") {
            newInvoice.discount = (newInvoice.discount || 0) + memberDisc;
            newInvoice.member_discount = memberDisc;
            newInvoice.total = Math.max(0, newInvoice.total - memberDisc);
          }
        }
      }

      // Simpan invoice ke Supabase — exclude fields yang tidak ada di DB schema
      const { garansi_status: _gs, ...invBase } = newInvoice;
      const invPayload = {
        ...invBase,
        materials_detail: detailToStore.length > 0 ? JSON.stringify(detailToStore) : null,
        repair_gratis: invBase.repair_gratis || undefined,
      };
      // ── 1 invoice per job: query DB langsung untuk cegah race condition ──
      const { data: existingDB, error: fetchExistingErr } = await supabase
        .from("invoices").select("id").eq("job_id", laporanModal.id);
      if (fetchExistingErr) {
        console.error("[INVOICE_PRECHECK] gagal cek existing:", fetchExistingErr.message);
        showNotif("❌ Gagal verifikasi invoice existing — submit dibatalkan. Coba lagi.");
        return;
      }
      if (existingDB && existingDB.length > 0) {
        // Hapus semua dulu — update local state HANYA setelah semua delete sukses
        for (const old of existingDB) {
          const { error: delErr } = await deleteInvoice(supabase, old.id, auditUserName(), "TEKNISI_REWRITE_LAPORAN");
          if (delErr) {
            console.error("[INVOICE_REWRITE] gagal hapus", old.id, delErr.message);
            showNotif("❌ Gagal hapus invoice lama — submit dibatalkan. Coba lagi.");
            return;
          }
        }
        // Semua delete sukses baru update local state
        setInvoicesData(prev => prev.filter(i => i.job_id !== laporanModal.id));
        addAgentLog("INVOICE_REWRITE", `${existingDB.length} invoice lama dihapus untuk ${laporanModal.id} (rewrite)`, "INFO");
      }
      // ── GUARD INVARIAN (observasional, non-blocking): pastikan total = Σ line item ──
      // Garansi kini dimodelkan sbg baris diskon (P3), jadi invarian konsisten tanpa waiver.
      {
        const _chk = checkInvoiceConsistency(newInvoice);
        if (!_chk.ok) {
          console.warn("[INVOICE_INVARIANT]", describeInconsistency(_chk, newInvoice.id));
          addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, newInvoice.id) + " (submit laporan)", "WARNING");
        }
      }
      const { error: invErr } = await insertInvoice(supabase, invPayload);
      if (invErr) {
        console.warn("Invoice insert failed:", invErr.message, "— retrying minimal");
        let retryOk = false;
        for (const st of ["PENDING_APPROVAL", "UNPAID"]) {
          const { error: e2 } = await insertInvoice(supabase, {
            id: newInvoice.id, job_id: newInvoice.job_id,
            customer: newInvoice.customer, service: newInvoice.service,
            units: newInvoice.units, labor: newInvoice.labor,
            material: newInvoice.material, total: newInvoice.total,
            status: st,
          });
          if (!e2) { retryOk = true; break; }
        }
        if (!retryOk) {
          showNotif("❌ Gagal simpan invoice — laporan tersimpan, cek menu Invoice manual.");
          addAgentLog("INVOICE_INSERT_FAILED", `Invoice ${newInvoice.id} gagal disimpan setelah retry`, "ERROR");
        }
      }
      // Update local state SETELAH DB insert sukses (atau retry sukses)
      setInvoicesData(prev => prev.some(i => i.id === newInvoice.id) ? prev : [...prev, newInvoice]);

      // P1: Link invoice ↔ quotation — jika order ini berasal dari quotation
      const srcOrder = ordersData.find(o => o.id === laporanModal.id);
      if (srcOrder?.source === "quotation") {
        const linkedQuo = quotationsData.find(q => q.job_id === laporanModal.id);
        if (linkedQuo) {
          // Patch invoice.quotation_id
          supabase.from("invoices").update({ quotation_id: linkedQuo.id }).eq("id", invId).then(() => {});
          // Patch quotation.invoice_id
          supabase.from("quotations").update({ invoice_id: invId, updated_at: new Date().toISOString() }).eq("id", linkedQuo.id).then(() => {});
          setQuotationsData(prev => prev.map(q => q.id === linkedQuo.id ? { ...q, invoice_id: invId } : q));
          setInvoicesData(prev => prev.map(i => i.id === invId ? { ...i, quotation_id: linkedQuo.id } : i));
          addAgentLog("QUOTATION_INVOICE_LINKED", `Invoice ${invId} ↔ Quotation ${linkedQuo.id} ter-link`, "SUCCESS");
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
      } // ── tutup if (!didMergeMultiDay) — pembuatan invoice baru ──
    }

    // ── Sync job_materials_brought: tandai USED / RETURNED ──
    // Item barang yang masih dipakai → USED + qty_used
    // Item brought yang tidak ke-laporan lagi → RETURNED (balik ke stok, tidak deduct)
    try {
      const broughtIdsUsed = new Map(); // id → qty_used
      for (const b of laporanBarangItems) {
        if (b._broughtId) broughtIdsUsed.set(b._broughtId, Number(b.jumlah) || 0);
      }
      const { data: existingBrought } = await supabase.from("job_materials_brought")
        .select("id, status, qty_used")
        .eq("job_id", laporanModal.id);
      const now = new Date().toISOString();
      for (const row of (existingBrought || [])) {
        if (broughtIdsUsed.has(row.id)) {
          const newQty = broughtIdsUsed.get(row.id);
          if (row.status !== "USED" || Number(row.qty_used || 0) !== newQty) {
            await supabase.from("job_materials_brought")
              .update({ status: "USED", qty_used: newQty, used_at: now, updated_at: now })
              .eq("id", row.id);
          }
        } else if (row.status === "BROUGHT") {
          // Brought tapi tidak ke-laporan → returned
          await supabase.from("job_materials_brought")
            .update({ status: "RETURNED", updated_at: now })
            .eq("id", row.id);
        }
      }
      refreshMaterialsBroughtMap();
    } catch (e) { console.warn("[BROUGHT_SYNC]", e?.message || e); }

    setLaporanSubmitted(true);
    // Seed-by-confirm registry unit AC (non-blocking, idempotent, forward-only)
    seedAcRegistry(laporanModal, laporanUnits);
    pushNotif(appSettings.app_name || "AClean", "Laporan berhasil dikirim ke Admin ✅");
    showNotif(`✅ Laporan ${laporanModal.id} terkirim! Laporan dikirim ke Owner/Admin untuk verifikasi.`);
    } catch (err) {
      console.error("submitLaporan fatal:", err);
      showNotif("❌ Submit error: " + (err?.message || String(err)));
    } finally {
      submitLaporanLock.current = false;
    }
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
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.accent }}>⬡ {appSettings.app_name || "AClean"}</div>
            <span style={{ fontSize: 9, color: cs.accent, fontWeight: 700, background: cs.accent + "18", padding: "2px 6px", borderRadius: 4, border: "1px solid " + cs.accent + "33" }}>v32</span>
          </div>
          {currentUser && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg," + currentUser.color + "," + currentUser.color + "88)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: "#fff", flexShrink: 0 }}>
                {currentUser.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.name}</div>
                <div style={{ fontSize: 10, color: currentUser.color, fontWeight: 600 }}>
                  {currentUser.role === "Owner" ? "👑 Owner" : currentUser.role === "Admin" ? "🛠️ Admin" : currentUser.role === "Finance" ? "💰 Finance" : currentUser.role === "Helper" ? "🤝 Helper" : "👷 Teknisi"}
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
      {/* ═══════ MODAL BUAT ORDER — OrderFormModal ═══════ */}
      <Suspense fallback={null}>
        <OrderFormModal
          open={modalOrder}
          onClose={() => setModalOrder(false)}
          form={newOrderForm} setForm={setNewOrderForm}
          onSubmit={handleOrderSubmit} isSubmitting={isSubmittingOrder}
          customersData={customersData} ordersData={ordersData} teknisiData={teknisiData}
          laporanReports={laporanReports} invoicesData={invoicesData} quotationsData={quotationsData}
          maintClientsForOrder={maintClientsForOrder} maintUnitsForOrder={maintUnitsForOrder}
          orderPhoneLookup={orderPhoneLookup}
          teamDailyCache={teamDailyCache} loadTeamDaily={loadTeamDaily}
          continuationSuggestion={continuationSuggestion} setContinuationSuggestion={setContinuationSuggestion}
          continuationParentId={continuationParentId} setContinuationParentId={setContinuationParentId}
          effectiveServiceTypes={effectiveServiceTypes}
          MAX_LOKASI_PER_HARI={MAX_LOKASI_PER_HARI}
          hitungJamSelesai={hitungJamSelesai} hitungDurasi={hitungDurasi}
          cekTeknisiAvailable={cekTeknisiAvailable} cariSlotKosong={cariSlotKosong}
          araSchedulingSuggest={araSchedulingSuggest}
          showNotif={showNotif} setActiveMenu={setActiveMenu}
        />
      </Suspense>
      {false && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setModalOrder(false)}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📋 Buat Order Baru</div>
              <button onClick={() => setModalOrder(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {[["Nama Customer", "customer", "text"], ["Nomor HP", "phone", "text"], ["Alamat Lengkap", "address", "text"], ["Catatan", "notes", "text"]].map(([label, key, type]) => (
                <div key={key}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>{label}</div>
                  <input type={type} value={newOrderForm[key] || ""} onChange={e => {
                    const val = e.target.value;
                    if (key === "phone") {
                      const normVal = normalizePhone(val);
                      const matches = customersData.filter(c => samePhone(c.phone, normVal));
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
                // Gabungkan match dari array client + hasil lookup server (dedupe by id)
                const clientMatches = customersData.filter(c => samePhone(c.phone, newOrderForm.phone));
                const serverMatches = orderPhoneLookup.phone === normalizePhone(newOrderForm.phone) ? orderPhoneLookup.matches : [];
                const _mergeById = new Map();
                [...clientMatches, ...serverMatches].forEach(c => { if (c && c.id) _mergeById.set(c.id, c); });
                const phoneMatches = Array.from(_mergeById.values());
                const exactMatch = findCustomer(phoneMatches, newOrderForm.phone, newOrderForm.customer);
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
                      {/* Penegasan: nama terketik = lokasi terdaftar atau lokasi baru? (cegah typo) */}
                      {newOrderForm.customer && newOrderForm.customer.trim() && (() => {
                        const typed = newOrderForm.customer.trim().toLowerCase();
                        const isKnown = phoneMatches.some(m => (m.name || "").trim().toLowerCase() === typed);
                        return (
                          <div style={{
                            padding: "7px 12px", fontSize: 11.5, fontWeight: 700, borderTop: "1px solid " + cs.border,
                            background: isKnown ? "#16a34a14" : "#f59e0b18",
                            color: isKnown ? "#16a34a" : "#d97706"
                          }}>
                            {isKnown
                              ? `✅ Lokasi terdaftar: ${newOrderForm.customer.trim()}`
                              : `🆕 "${newOrderForm.customer.trim()}" = LOKASI BARU (bukan dari ${phoneMatches.length} lokasi di atas). Pastikan bukan typo.`}
                          </div>
                        );
                      })()}
                    </div>
                  );
                }
                return (
                  <div style={{ display: "grid", gap: 6 }}>
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
                    {/* ── Service History Panel ── */}
                    {exactMatch && (() => {
                      const history = buildCustomerHistory(exactMatch, ordersData, laporanReports, invoicesData, customersData);
                      const recentJobs = (history.orders || [])
                        .filter(o => o.status !== "CANCELLED")
                        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                        .slice(0, 3);
                      if (recentJobs.length === 0) return null;

                      // Kumpulkan semua unit AC yang pernah diservice
                      const knownUnits = [];
                      const unitSet = new Set();
                      laporanReports.forEach(r => {
                        if (!samePhone(r.phone || "", exactMatch.phone)) return;
                        const units = typeof r.units_json === "string" ? JSON.parse(r.units_json || "[]") : (r.units_json || []);
                        units.forEach(u => {
                          const label = [u.brand, u.type, u.capacity ? u.capacity + "PK" : ""].filter(Boolean).join(" ");
                          if (label && !unitSet.has(label)) { unitSet.add(label); knownUnits.push(label); }
                        });
                      });

                      // Hint: sudah lama tidak cleaning?
                      const lastCleaning = recentJobs.find(o => (o.service || "").toLowerCase().includes("cleaning"));
                      const daysSinceCleaning = lastCleaning
                        ? Math.floor((new Date() - new Date(lastCleaning.date)) / 86400000)
                        : null;

                      return (
                        <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 10, overflow: "hidden" }}>
                          <div style={{ padding: "8px 12px", background: cs.accent + "12", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>📋 Riwayat {recentJobs.length} job terakhir</span>
                            {daysSinceCleaning !== null && daysSinceCleaning > 90 && (
                              <span style={{ fontSize: 10, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "2px 8px", borderRadius: 99 }}>
                                💡 Terakhir cleaning {daysSinceCleaning}h lalu
                              </span>
                            )}
                          </div>
                          <div style={{ padding: "8px 12px", display: "grid", gap: 6 }}>
                            {recentJobs.map(o => (
                              <div key={o.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11 }}>
                                <span style={{ color: cs.muted, minWidth: 68, fontFamily: "monospace" }}>{o.date}</span>
                                <div style={{ flex: 1 }}>
                                  <span style={{ color: cs.text, fontWeight: 600 }}>{o.service}</span>
                                  <span style={{ color: cs.muted }}> · {o.units} unit</span>
                                  {o.teknisi && <span style={{ color: cs.muted }}> · {o.teknisi}</span>}
                                  {o.notes && <div style={{ color: cs.muted, fontSize: 10, marginTop: 1, fontStyle: "italic" }}>{o.notes.slice(0, 60)}{o.notes.length > 60 ? "…" : ""}</div>}
                                </div>
                                <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: o.status === "COMPLETED" ? cs.green + "22" : cs.yellow + "22", color: o.status === "COMPLETED" ? cs.green : cs.yellow, whiteSpace: "nowrap" }}>
                                  {o.status === "COMPLETED" ? "✅ Selesai" : o.status}
                                </span>
                              </div>
                            ))}
                          </div>
                          {knownUnits.length > 0 && (
                            <div style={{ padding: "6px 12px", borderTop: "1px solid " + cs.border + "44", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>AC diketahui:</span>
                              {knownUnits.slice(0, 5).map((u, i) => (
                                <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent }}>{u}</span>
                              ))}
                              {knownUnits.length > 5 && <span style={{ fontSize: 10, color: cs.muted }}>+{knownUnits.length - 5}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
              {/* ── Auto-detect Pekerjaan Lanjutan ── */}
              {continuationSuggestion.length > 0 && continuationParentId === null && (
                <div style={{ background: "#f59e0b14", border: "1px solid #f59e0b44", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", background: "#f59e0b1a", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 15 }}>🔗</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b" }}>Terdeteksi Pekerjaan Belum Selesai</div>
                      <div style={{ fontSize: 11, color: "#fbbf24" }}>Customer ini punya {continuationSuggestion.length} job aktif dalam 3 hari terakhir. Lanjutan?</div>
                    </div>
                  </div>
                  {continuationSuggestion.map(o => (
                    <div key={o.id} style={{ padding: "9px 14px", borderTop: "1px solid #f59e0b22", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ fontWeight: 700, color: "#fbbf24", fontFamily: "monospace" }}>{o.id}</span>
                        <span style={{ color: "#94a3b8", marginLeft: 8 }}>{o.date} · {o.service} {o.units}u · {o.teknisi || "—"}</span>
                        <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 7px", borderRadius: 99, background: "#f59e0b22", color: "#fbbf24" }}>{o.status}</span>
                      </div>
                      <button
                        onClick={() => setContinuationParentId(o.id)}
                        style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#0a0f1e", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                        Ya, Lanjutan
                      </button>
                    </div>
                  ))}
                  <div style={{ padding: "8px 14px", borderTop: "1px solid #f59e0b22", display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setContinuationParentId("")}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #64748b44", background: "transparent", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>
                      Tidak, Job Baru
                    </button>
                  </div>
                </div>
              )}
              {/* ── P3: Badge Quotation Aktif ── */}
              {(() => {
                const phone = newOrderForm.phone ? normalizePhone(newOrderForm.phone) : null;
                if (!phone || !quotationsData.length) return null;
                const activeQuo = quotationsData.filter(q =>
                  ["SENT","DRAFT"].includes(q.status) &&
                  q.phone && normalizePhone(q.phone) === phone
                );
                if (!activeQuo.length) return null;
                return (
                  <div style={{ background: "#6366f114", border: "1px solid #6366f144", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "10px 14px", background: "#6366f11a", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15 }}>📋</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#818cf8" }}>Ada Quotation Aktif</div>
                        <div style={{ fontSize: 11, color: "#a5b4fc" }}>Customer ini punya {activeQuo.length} quotation belum diproses</div>
                      </div>
                    </div>
                    {activeQuo.map(q => (
                      <div key={q.id} style={{ padding: "9px 14px", borderTop: "1px solid #6366f122", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: "#a5b4fc", fontFamily: "monospace" }}>{q.id}</span>
                          <span style={{ color: "#94a3b8", marginLeft: 8 }}>
                            {q.created_at?.slice(0,10)} · {(q.items||[]).length} item · Rp {Number(q.total||0).toLocaleString("id-ID")}
                          </span>
                          <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 7px", borderRadius: 99, background: "#6366f122", color: "#a5b4fc" }}>{q.status}</span>
                        </div>
                        <button
                          onClick={() => setActiveMenu("quotations")}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                          Lihat Quotation
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {continuationParentId && continuationParentId !== "" && (() => {
                const parent = ordersData.find(o => o.id === continuationParentId);
                return (
                  <div style={{ background: "#22c55e14", border: "1px solid #22c55e44", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 12 }}>
                      <span style={{ fontSize: 14 }}>🔗</span>
                      <span style={{ fontWeight: 700, color: "#4ade80", marginLeft: 6 }}>Lanjutan dari {continuationParentId}</span>
                      {parent && <span style={{ color: "#94a3b8", marginLeft: 6 }}>· {parent.date} · {parent.service}</span>}
                    </div>
                    <button onClick={() => setContinuationParentId(null)}
                      style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid #64748b44", background: "transparent", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>
                      Ubah
                    </button>
                  </div>
                );
              })()}

              {/* 🏢 Maintenance Korporat (Opsi B) — tampil hanya jika ada klien maintenance aktif */}
              {maintClientsForOrder.length > 0 && (
                <div style={{ border: "1px solid " + cs.border, borderRadius: 10, padding: 12, background: cs.card }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 6 }}>🏢 Maintenance Korporat (opsional)</div>
                  <select value={newOrderForm.maintenance_client_id || ""}
                    onChange={e => setNewOrderForm(f => ({ ...f, maintenance_client_id: e.target.value, maintenance_unit_ids: [] }))}
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}>
                    <option value="">— Bukan order maintenance —</option>
                    {maintClientsForOrder.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {newOrderForm.maintenance_client_id && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: cs.muted }}>Pilih unit yang diservis ({(newOrderForm.maintenance_unit_ids || []).length}/{maintUnitsForOrder.length})</span>
                        <button type="button" onClick={() => setNewOrderForm(f => ({ ...f, maintenance_unit_ids: (f.maintenance_unit_ids || []).length === maintUnitsForOrder.length ? [] : maintUnitsForOrder.map(u => u.id) }))}
                          style={{ marginLeft: "auto", background: "transparent", border: "1px solid " + cs.border, color: cs.text, borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
                          {(newOrderForm.maintenance_unit_ids || []).length === maintUnitsForOrder.length ? "Hapus semua" : "Pilih semua"}
                        </button>
                      </div>
                      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid " + cs.border, borderRadius: 8 }}>
                        {maintUnitsForOrder.length === 0 ? <div style={{ padding: 10, fontSize: 12, color: cs.muted }}>Memuat unit… (unit baru harus didaftarkan dulu di menu Maintenance)</div> :
                          maintUnitsForOrder.map(u => {
                            const checked = (newOrderForm.maintenance_unit_ids || []).includes(u.id);
                            return (
                              <label key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 10px", borderBottom: "1px solid " + cs.border, cursor: "pointer", fontSize: 12, color: cs.text }}>
                                <input type="checkbox" checked={checked} onChange={e => setNewOrderForm(f => {
                                  const cur = f.maintenance_unit_ids || [];
                                  return { ...f, maintenance_unit_ids: e.target.checked ? [...cur, u.id] : cur.filter(x => x !== u.id) };
                                })} />
                                <b>{u.unit_code}</b><span style={{ color: cs.muted }}>{u.location || ""} · {u.brand || ""}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Jenis Layanan</div>
                  <select value={newOrderForm.service} onChange={e => setNewOrderForm(f => ({ ...f, service: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                    {effectiveServiceTypes.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Jumlah Unit</div>
                  <input id="field_number_8" type="number" min="1" max="20" value={newOrderForm.units} onChange={e => setNewOrderForm(f => ({ ...f, units: parseInt(e.target.value) || 1 }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              {/* Area — tersimpan ke data customer */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Area / Lokasi <span style={{ fontWeight: 400, color: cs.muted }}>(tersimpan ke data customer)</span></div>
                <input value={newOrderForm.area || ""} onChange={e => setNewOrderForm(f => ({ ...f, area: e.target.value }))}
                  placeholder="Misal: Graha Raya, BSD, Alam Sutera..."
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              </div>
              {/* ── Quick Select Tim (dari Planning Order) ── */}
              {newOrderForm.date && (() => {
                const teams = teamDailyCache[newOrderForm.date];
                if (!teams) { loadTeamDaily(newOrderForm.date); return null; }
                const filledTeams = teams.filter(t => t.member1);
                if (filledTeams.length === 0) return (
                  <div style={{ fontSize: 11, color: cs.muted, padding: "8px 12px", background: cs.card, borderRadius: 8, border: "1px dashed " + cs.border }}>
                    Belum ada setup tim untuk tanggal ini. Isi dulu di Planning Order.
                  </div>
                );
                return (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Pilih Tim</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {filledTeams.map(t => {
                        const tek = t.member1 || "";
                        const hlp = t.member1_role === "helper" ? "" : (t.member2 || "");
                        const isSelected = newOrderForm.teknisi === tek;
                        return (
                          <button key={t.slot}
                            onClick={() => setNewOrderForm(f => ({ ...f, teknisi: tek, helper: hlp, team_slot: t.slot }))}
                            style={{ padding: "6px 12px", borderRadius: 9, border: "1px solid " + (isSelected ? cs.accent : t.confirmed ? cs.green + "66" : cs.border), background: isSelected ? cs.accent + "22" : cs.card, color: isSelected ? cs.accent : cs.text, cursor: "pointer", fontSize: 12, fontWeight: isSelected ? 700 : 500 }}>
                            <span style={{ fontWeight: 700, color: isSelected ? cs.accent : cs.muted, marginRight: 4 }}>{t.slot}</span>
                            {tek}{hlp ? <span style={{ color: cs.muted }}> + {hlp}</span> : ""}
                            {t.confirmed && <span style={{ fontSize: 9, color: cs.green, marginLeft: 4 }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>Klik tim untuk auto-fill. Tim ✓ sudah dikonfirmasi di Planning Order.</div>
                  </div>
                );
              })()}
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
                  <input id="field_date_9" type="date" value={newOrderForm.date} onChange={e => { setNewOrderForm(f => ({ ...f, date: e.target.value })); loadTeamDaily(e.target.value); }}
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
                            const formCopy = {
                              ...newOrderForm,
                              parent_job_id: continuationParentId || null,
                              is_multi_day: !!(continuationParentId && continuationParentId !== ""),
                            };
                            setModalOrder(false);
                            setContinuationSuggestion([]);
                            setContinuationParentId(null);
                            setNewOrderForm({ customer: "", phone: "", address: "", area: "", service: "Cleaning", type: "AC Split 0.5-1PK", units: 1, teknisi: "", helper: "", date: "", time: "09:00", notes: "", maintenance_client_id: "", maintenance_unit_ids: [] });
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
      {/* MODAL — MATERIAL (Add/Edit) + RESTOCK — SFM */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <MaterialFormModal
          open={modalStok || modalEditStok}
          mode={modalStok ? "add" : "edit"}
          editItem={editStokItem}
          onClose={() => { setModalStok(false); setModalEditStok(false); setEditStokItem(null); }}
          inventoryData={inventoryData}
          setInventoryData={setInventoryData}
          currentUser={currentUser}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          supabase={supabase}
        />
      </Suspense>
      <Suspense fallback={null}>
        <RestockModal
          open={modalRestock}
          item={restockItem}
          onClose={() => { setModalRestock(false); setRestockItem(null); }}
          setInventoryData={setInventoryData}
          currentUser={currentUser}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          supabase={supabase}
          TODAY={TODAY}
        />
      </Suspense>
      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — TAMBAH/EDIT TEKNISI */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <TeknisiFormModal
          open={modalTeknisi}
          onClose={() => { setModalTeknisi(false); setEditTeknisi(null); setNewTeknisiForm({ name: "", role: "Teknisi", phone: "", skills: [], email: "", password: "", buatAkun: false }); }}
          editTeknisi={editTeknisi}
          newTeknisiForm={newTeknisiForm}
          setNewTeknisiForm={setNewTeknisiForm}
          teknisiData={teknisiData}
          setTeknisiData={setTeknisiData}
          setUserAccounts={setUserAccounts}
          currentUser={currentUser}
          showNotif={showNotif}
          showConfirm={showConfirm}
          addAgentLog={addAgentLog}
          _apiHeaders={_apiHeaders}
        />
      </Suspense>
      {false && modalTeknisi && (
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

              {/* ── Email Login (wajib untuk akun baru) ── */}
              {!editTeknisi && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Email Login <span style={{ color: cs.red }}>*</span></div>
                  <input type="email" value={newTeknisiForm.email || ""} placeholder="contoh: ari@aclean.id"
                    onChange={e => setNewTeknisiForm(f => ({ ...f, email: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 5, background: cs.accent + "10", borderRadius: 7, padding: "7px 10px" }}>
                    🔑 Password otomatis: <b style={{ color: cs.accent }}>{["Helper"].includes(newTeknisiForm.role) ? "helper123" : "teknisi123"}</b> — langsung aktif tanpa konfirmasi email
                  </div>
                </div>
              )}

              {/* ── Commission PIN (edit only) ── */}
              {editTeknisi && currentUser?.role === "Owner" && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>🔐 Commission PIN (optional)</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="text" placeholder="4-6 digits (atau kosongkan untuk hapus)" maxLength="6"
                      value={newTeknisiForm.commission_pin || ""} pattern="[0-9]*"
                      onChange={e => {
                        const v = e.target.value.replace(/[^0-9]/g, "");
                        setNewTeknisiForm(f => ({ ...f, commission_pin: v }));
                      }}
                      style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                    <button onClick={() => { setNewTeknisiForm(f => ({ ...f, commission_pin: "" })); }}
                      style={{ padding: "8px 10px", borderRadius: 6, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 12 }}>🗑</button>
                  </div>
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 4, fontStyle: "italic" }}>PIN harus diisi untuk mengakses KOMISI SAYA. Teknisi akan diminta PIN saat membuka menu Komisi Saya.</div>
                </div>
              )}

              {/* ── Data Rekening Payroll (Owner only, edit only) ── */}
              {editTeknisi && currentUser?.role === "Owner" && (
                <div style={{ borderTop: "1px dashed " + cs.border, paddingTop: 12, marginTop: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: cs.text, marginBottom: 8 }}>🏦 Rekening Payroll <span style={{ fontSize: 10, fontWeight: 600, color: cs.muted }}>(tampil di Komisi Saya)</span></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Bank</div>
                      <input list="bank-options" placeholder="BCA" value={newTeknisiForm.bank_name || ""}
                        onChange={e => setNewTeknisiForm(f => ({ ...f, bank_name: e.target.value }))}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                      <datalist id="bank-options"><option value="BCA" /><option value="DANA" /><option value="Mandiri" /><option value="BRI" /><option value="BNI" /><option value="OVO" /><option value="GoPay" /></datalist>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>No. Rekening / e-wallet</div>
                      <input inputMode="numeric" placeholder="6044307591" value={newTeknisiForm.bank_account_no || ""}
                        onChange={e => setNewTeknisiForm(f => ({ ...f, bank_account_no: e.target.value.replace(/[^0-9]/g, "") }))}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontVariantNumeric: "tabular-nums" }} />
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Atas Nama</div>
                    <input placeholder="Nama pemilik rekening" value={newTeknisiForm.bank_holder || ""}
                      onChange={e => setNewTeknisiForm(f => ({ ...f, bank_holder: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tanggal Mulai Kerja</div>
                    <input type="date" value={newTeknisiForm.work_start_date || ""}
                      onChange={e => setNewTeknisiForm(f => ({ ...f, work_start_date: e.target.value }))}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
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
                    const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
                    if (isUUID(editTeknisi.id)) {
                      const res = await fetch("/api/manage-user", {
                        method: "POST", headers: await _apiHeaders(),
                        body: JSON.stringify({ action: "delete", userId: editTeknisi.id, callerRole: currentUser?.role })
                      });
                      const result = await res.json();
                      if (!result.ok) { showNotif("⚠️ " + (result.error || "Hapus gagal")); return; }
                    } else {
                      await supabase.from("user_profiles").delete().eq("id", editTeknisi.id);
                    }
                    setTeknisiData(prev => prev.filter(t => t.id !== editTeknisi.id));
                    setUserAccounts(prev => prev.filter(u => u.id !== editTeknisi.id));
                    addAgentLog("TEKNISI_DELETED", "Anggota " + editTeknisi.name + " dihapus dari tim", "WARNING");
                    showNotif("✅ " + editTeknisi.name + " berhasil dihapus dari tim & database");
                    setModalTeknisi(false); setEditTeknisi(null);
                  }}
                    style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "9px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>🗑️ Hapus dari Tim &amp; DB</button>
                  {editTeknisi?.status === "standby" ? (
                    <button onClick={async () => {
                      const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
                      if (isUUID(editTeknisi.id)) {
                        const res = await fetch("/api/manage-user", { method: "POST", headers: await _apiHeaders(), body: JSON.stringify({ action: "toggle-active", userId: editTeknisi.id, active: true, callerRole: currentUser?.role }) });
                        const result = await res.json();
                        if (!result.ok) { showNotif("⚠️ " + (result.error || "Gagal aktifkan")); return; }
                      } else {
                        await supabase.from("user_profiles").update({ active: true, status: "active" }).eq("id", editTeknisi.id);
                      }
                      setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, status: "active", active: true } : t));
                      showNotif(editTeknisi.name + " diaktifkan kembali ✅");
                      setModalTeknisi(false); setEditTeknisi(null);
                    }}
                      style={{ background: cs.green + "18", border: "1px solid " + cs.green + "33", color: cs.green, padding: "9px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>▶ Aktifkan Kembali</button>
                  ) : (
                    <button onClick={async () => {
                      const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
                      if (isUUID(editTeknisi.id)) {
                        const res = await fetch("/api/manage-user", { method: "POST", headers: await _apiHeaders(), body: JSON.stringify({ action: "toggle-active", userId: editTeknisi.id, active: false, callerRole: currentUser?.role }) });
                        const result = await res.json();
                        if (!result.ok) { showNotif("⚠️ " + (result.error || "Gagal nonaktifkan")); return; }
                      } else {
                        await supabase.from("user_profiles").update({ active: false, status: "standby" }).eq("id", editTeknisi.id);
                      }
                      setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, status: "standby", active: false } : t));
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
                    // ── Update existing via backend ──
                    // commission_pin: "" → null (hapus PIN). Selalu sertakan agar bisa di-clear.
                    const pinVal = (newTeknisiForm.commission_pin || "").trim() || null;
                    const upd = { name: newTeknisiForm.name, phone: newTeknisiForm.phone, role: newTeknisiForm.role, skills: newTeknisiForm.skills || [], commission_pin: pinVal };
                    // Data rekening payroll — hanya Owner yang boleh kirim
                    const bankUpd = currentUser?.role === "Owner" ? {
                      bank_name: (newTeknisiForm.bank_name || "").trim() || null,
                      bank_account_no: (newTeknisiForm.bank_account_no || "").trim() || null,
                      bank_holder: (newTeknisiForm.bank_holder || "").trim() || null,
                      work_start_date: newTeknisiForm.work_start_date || null,
                    } : {};
                    Object.assign(upd, bankUpd);
                    const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
                    if (isUUID(editTeknisi.id)) {
                      const res = await fetch("/api/manage-user", {
                        method: "POST", headers: await _apiHeaders(),
                        body: JSON.stringify({ action: "update", userId: editTeknisi.id, name: upd.name, role: upd.role, phone: upd.phone, commission_pin: pinVal, ...bankUpd, callerRole: currentUser?.role })
                      });
                      const result = await res.json();
                      if (!result.ok) { showNotif("⚠️ " + (result.error || "Update gagal")); return; }
                    } else {
                      await supabase.from("user_profiles").update(upd).eq("id", editTeknisi.id);
                    }
                    setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? { ...t, ...upd } : t));
                    addAgentLog("TEKNISI_UPDATED", "Data " + newTeknisiForm.name + " diupdate", "SUCCESS");
                    showNotif("✅ " + newTeknisiForm.name + " berhasil diupdate");
                  } else {
                    // ── Tambah anggota baru via backend manage-user ──
                    if (!newTeknisiForm.email) { showNotif("❌ Email wajib diisi untuk membuat akun login"); return; }
                    const autoPass = newTeknisiForm.role === "Helper" ? "helper123" : "teknisi123";
                    const res = await fetch("/api/manage-user", {
                      method: "POST", headers: await _apiHeaders(),
                      body: JSON.stringify({ action: "create", email: newTeknisiForm.email, password: autoPass, name: newTeknisiForm.name, role: newTeknisiForm.role, phone: newTeknisiForm.phone, callerRole: currentUser?.role })
                    });
                    const result = await res.json();
                    if (!result.ok) { showNotif("❌ " + (result.error || "Gagal buat akun")); return; }
                    const uid = result.user?.id;
                    const colorMap = { Teknisi: "#22c55e", Helper: "#a78bfa", Supervisor: "#38bdf8" };
                    const newTek = { id: uid, name: newTeknisiForm.name, role: newTeknisiForm.role, phone: newTeknisiForm.phone, email: newTeknisiForm.email, skills: [], jobs_today: 0, status: "active", active: true, color: colorMap[newTeknisiForm.role] || "#22c55e", avatar: newTeknisiForm.name.charAt(0).toUpperCase() };
                    setTeknisiData(prev => [...prev, newTek]);
                    setUserAccounts(prev => prev.find(u => u.id === uid) ? prev : [...prev, { ...newTek, lastLogin: "Belum login" }]);
                    addAgentLog("TEKNISI_ADDED", "Anggota baru: " + newTeknisiForm.name + " (" + newTeknisiForm.role + ") + akun login", "SUCCESS");
                    showNotif("✅ " + newTeknisiForm.name + " ditambahkan — langsung aktif — password: " + autoPass);
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
      {/* MODAL — BRAIN.MD EDITOR — BrainEditModal */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <BrainEditModal
          open={modalBrainEdit}
          onClose={() => setModalBrainEdit(false)}
          brainMd={brainMd}
          setBrainMd={setBrainMd}
          BRAIN_MD_DEFAULT={BRAIN_MD_DEFAULT}
          currentUser={currentUser}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          supabase={supabase}
          isMobile={isMobile}
          _lsSave={_lsSave}
        />
      </Suspense>

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT BRAIN CUSTOMER */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <BrainCustomerModal
          open={modalBrainCustomerEdit}
          onClose={() => setModalBrainCustomerEdit(false)}
          brainMdCustomer={brainMdCustomer}
          setBrainMdCustomer={setBrainMdCustomer}
          currentUser={currentUser}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          supabase={supabase}
          isMobile={isMobile}
          _lsSave={_lsSave}
        />
      </Suspense>}


      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT INVOICE (GAP 3) */}
      {/* ══════════════════════════════════════════════════════ */}
      {/* ══ MODAL HISTORY PREVIEW — Teknisi view-only ══ */}
      {historyPreview && (() => {
        const cu = historyPreview;
        const hist = buildCustomerHistory(cu, ordersData, laporanReports, invoicesData, customersData);
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
                              <img key={fi} src={fotoSrc(url)} alt={"Foto " + (fi + 1)}
                                onClick={() => window.open(fotoSrc(url), "_blank")}
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

      {/* ══ MODAL EDIT PASSWORD (Owner only) — EditPasswordModal ══ */}
      <Suspense fallback={null}>
        <EditPasswordModal
          open={modalEditPwd}
          target={editPwdTarget}
          onClose={() => { setModalEditPwd(false); setEditPwdTarget(null); }}
          currentUser={currentUser}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          _apiHeaders={_apiHeaders}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EditInvoiceModal
          open={modalEditInvoice}
          onClose={() => { setModalEditInvoice(false); setEditInvoiceData(null); }}
          editInvoiceData={editInvoiceData}
          editInvoiceForm={editInvoiceForm}
          setEditInvoiceForm={setEditInvoiceForm}
          editInvoiceItems={editInvoiceItems}
          setEditInvoiceItems={setEditInvoiceItems}
          editJasaItems={editJasaItems}
          setEditJasaItems={setEditJasaItems}
          priceListData={priceListData}
          inventoryData={inventoryData}
          customersData={customersData}
          lookupHargaGlobal={lookupHargaGlobal}
          parseMD={parseMD}
          fmt={fmt}
          appSettings={appSettings}
          currentUser={currentUser}
          supabase={supabase}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          updateInvoice={updateInvoice}
          setInvoicesData={setInvoicesData}
          auditUserName={auditUserName}
          _apiHeaders={_apiHeaders}
        />
      </Suspense>

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — INVOICE PREVIEW */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <InvoicePreviewModal
          open={modalPDF}
          onClose={() => setModalPDF(false)}
          selectedInvoice={selectedInvoice}
          invoicesData={invoicesData}
          setInvoicesData={setInvoicesData}
          appSettings={appSettings}
          currentUser={currentUser}
          supabase={supabase}
          showNotif={showNotif}
          approveInvoice={approveInvoice}
          downloadInvoicePDF={downloadInvoicePDF}
          invoiceReminderWA={invoiceReminderWA}
          computePph23={computePph23}
          updateInvoice={updateInvoice}
          parseMD={parseMD}
          fmt={fmt}
          auditUserName={auditUserName}
          onOpenEditInvoice={(invoice) => {
            setEditInvoiceData(invoice);
            setEditInvoiceForm({ labor: invoice.labor, material: invoice.material, discount: invoice.discount || 0, trade_in: invoice.trade_in || false, trade_in_amount: invoice.trade_in_amount || 250000, pph23: invoice.pph23 || false, notes: "" });
            const _aLv = parseMD(invoice.materials_detail).map((m, idx) => ({ ...m, _idx: idx }));
            setEditJasaItems(_aLv.filter(m => categoryOf(m) === LINE_CATEGORY.LABOR));
            setEditInvoiceItems(_aLv.filter(m => categoryOf(m) !== LINE_CATEGORY.LABOR));
            setModalPDF(false);
            setModalEditInvoice(true);
          }}
        />
      </Suspense>

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — APPROVE INVOICE — ApproveInvoiceModal */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <ApproveInvoiceModal
          open={modalApproveInv}
          invoice={pendingApproveInv}
          onClose={() => { setModalApproveInv(false); setPendingApproveInv(null); }}
          approveAndSend={approveAndSend}
          approveSaveOnly={approveSaveOnly}
          fmt={fmt}
        />
      </Suspense>

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — WA TEKNISI KE CUSTOMER — WaTekModal */}
      {/* ══════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <WaTekModal
          open={modalWaTek}
          target={waTekTarget}
          onClose={() => { setModalWaTek(false); setWaTekTarget(null); }}
          appName={appSettings.app_name}
          openWA={openWA}
        />
      </Suspense>

      {/* ══════════════════════════════════════════════════════ */}
      {/* WA PANEL */}
      {/* ══════════════════════════════════════════════════════ */}
      {waPanel && (() => {
        // Filter + match customer untuk semua conv
        const waSearchLower = waSearch.toLowerCase();
        const filteredConvs = waConversations.map(conv => {
          const cust = customersData.find(x => samePhone(x.phone, conv.phone));
          return { ...conv, _cust: cust || null };
        }).filter(conv => {
          if (!waSearchLower) return true;
          return (conv.name || "").toLowerCase().includes(waSearchLower) ||
            (conv.phone || "").includes(waSearch) ||
            (conv._cust?.name || "").toLowerCase().includes(waSearchLower) ||
            (conv.last_message || conv.last || "").toLowerCase().includes(waSearchLower);
        });
        const selConvCust = selectedConv ? customersData.find(x => samePhone(x.phone, selectedConv.phone)) : null;
        const selConvOrders = selectedConv ? ordersData.filter(o => samePhone(o.phone || "", selectedConv.phone) || (selConvCust && o.customer === selConvCust.name)).slice(0, 5) : [];
        return (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 300, display: "flex", justifyContent: "flex-end" }} onClick={() => setWaPanel(false)}>
          <div style={{ width: isMobile ? "100%" : 440, background: cs.surface, borderLeft: isMobile ? "none" : "1px solid " + cs.border, display: "flex", flexDirection: "column", height: "100vh" }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: cs.card, padding: "12px 16px", borderBottom: "1px solid " + cs.border, flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, color: "#25D366", fontSize: 14 }}>📱 WhatsApp Monitor</div>
                  <div style={{ fontSize: 10, color: cs.muted }}>via {waProvider === "fonnte" ? "Fonnte" : waProvider === "wa_cloud" ? "WA Cloud API" : "Twilio"} · {waConversations.length} chat dimuat</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={async () => {
                    const { data, error } = await fetchWaConversations(supabase, 100);
                    if (error) {
                      if (error.code === "42P01") showNotif("⚠️ Tabel wa_conversations belum dibuat");
                      else showNotif("⚠️ WA Monitor error: " + (error.message || error.code));
                    } else {
                      if (data) setWaConversations(data);
                      showNotif(data?.length > 0 ? `✅ ${data.length} percakapan dimuat` : "ℹ️ Belum ada percakapan masuk");
                    }
                  }} style={{ background: "none", border: "1px solid " + cs.border, color: cs.muted, fontSize: 11, padding: "4px 8px", borderRadius: 7, cursor: "pointer" }}>🔄</button>
                  <button onClick={() => setWaPanel(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
                </div>
              </div>
              {/* Search bar */}
              {!selectedConv && (
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: cs.muted, pointerEvents: "none" }}>🔍</span>
                  <input value={waSearch} onChange={e => setWaSearch(e.target.value)}
                    placeholder="Cari nama, nomor, atau isi pesan..."
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "7px 30px 7px 30px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                  {waSearch && <button onClick={() => setWaSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Conversation list */}
              <div style={{ width: "100%", overflowY: "auto", display: selectedConv ? "none" : "block" }}>
                {filteredConvs.length === 0 && (
                  <div style={{ padding: 16, fontSize: 11, color: cs.muted, textAlign: "center", lineHeight: 1.8 }}>
                    {waSearch ? (
                      <div>Tidak ada hasil untuk <b>"{waSearch}"</b></div>
                    ) : (
                      <>
                        <div style={{ fontSize: 22, marginBottom: 6 }}>📭</div>
                        <div>Belum ada pesan masuk</div>
                        <div style={{ marginTop: 6, color: cs.accent, fontSize: 10 }}>Pastikan webhook Fonnte aktif · Klik 🔄 setelah kirim WA test</div>
                      </>
                    )}
                  </div>
                )}
                {filteredConvs.map(conv => {
                  const cust = conv._cust;
                  const isKnown = !!cust;
                  return (
                    <div key={conv.id} onClick={() => {
                      setSelectedConv(conv);
                      supabase.from("wa_messages").select("id,phone,name,content,role,created_at,image_url")
                        .eq("phone", conv.phone).order("created_at", { ascending: true }).limit(100)
                        .then(({ data, error }) => {
                          if (error && error.code === "42703") {
                            supabase.from("wa_messages").select("id,phone,name,content,role,created_at")
                              .eq("phone", conv.phone).order("created_at", { ascending: true }).limit(100)
                              .then(({ data: d2 }) => { if (d2) setWaMessages(d2); });
                          } else if (data) setWaMessages(data);
                        });
                      supabase.from("wa_conversations").update({ unread: 0 }).eq("phone", conv.phone).then(() => {});
                      setWaConversations(prev => prev.map(cv => cv.id === conv.id ? { ...cv, unread: 0 } : cv));
                    }}
                      style={{ padding: "10px 14px", borderBottom: "1px solid " + cs.border, cursor: "pointer", background: "transparent", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = cs.card}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                            <span style={{ fontWeight: 700, color: cs.text, fontSize: 12 }}>{conv.name}</span>
                            {isKnown ? (
                              <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "#25D36622", color: "#25D366", fontWeight: 700, flexShrink: 0 }}>✓ {cust.name}</span>
                            ) : (
                              <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: cs.yellow + "22", color: cs.yellow, fontWeight: 600, flexShrink: 0 }}>Baru</span>
                            )}
                          </div>
                          <div style={{ fontSize: 9, color: cs.accent, marginBottom: 2 }}>{conv.phone}{isKnown && cust.total_orders > 0 ? ` · ${cust.total_orders}× order` : ""}</div>
                          <div style={{ fontSize: 10, color: cs.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.last_message || conv.last || ""}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                          {conv.unread > 0 && <span style={{ background: "#25D366", color: "#fff", fontSize: 9, borderRadius: "50%", minWidth: 16, height: 16, padding: "0 3px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{conv.unread}</span>}
                          {conv.updated_at && <span style={{ fontSize: 9, color: cs.muted }}>{new Date(conv.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Chat detail */}
              <div style={{ flex: 1, flexDirection: "column", display: !selectedConv ? "none" : "flex" }}>
                {selectedConv ? (
                  <>
                    {/* Chat header dengan info customer */}
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid " + cs.border, flexShrink: 0, background: cs.card }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: selConvCust ? 6 : 0 }}>
                        <button onClick={() => { setSelectedConv(null); }} style={{ background: "none", border: "none", color: cs.accent, fontSize: 22, cursor: "pointer", padding: "0 4px", lineHeight: 1, fontWeight: 700 }}>‹</button>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{selectedConv.name}</div>
                          <div style={{ fontSize: 10, color: cs.muted }}>{selectedConv.phone}{selectedConv.intent ? " · " + selectedConv.intent : ""}</div>
                        </div>
                        {/* Tombol buat customer jika belum terdaftar */}
                        {!selConvCust && isOwnerAdmin && (
                          <button onClick={async () => {
                            const name = window.prompt("Nama customer untuk " + selectedConv.phone + ":", selectedConv.name || "");
                            if (!name?.trim()) return;
                            const { data: newCust, error } = await supabase.from("customers").insert({ name: name.trim(), phone: normalizePhone(selectedConv.phone), area: "", total_orders: 0 }).select().single();
                            if (error) { showNotif("❌ Gagal buat customer: " + error.message); return; }
                            setCustomersData(prev => [...prev, newCust]);
                            showNotif("✅ Customer " + name.trim() + " ditambahkan!");
                          }} style={{ padding: "5px 10px", background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 7, cursor: "pointer", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                            + Simpan Customer
                          </button>
                        )}
                      </div>
                      {/* Customer info strip */}
                      {selConvCust && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#25D36622", color: "#25D366", fontWeight: 700 }}>✓ {selConvCust.name}</span>
                          {selConvCust.area && <span style={{ fontSize: 10, color: cs.muted }}>{selConvCust.area}</span>}
                          {selConvCust.total_orders > 0 && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: cs.accent + "22", color: cs.accent, fontWeight: 600 }}>{selConvCust.total_orders}× order</span>}
                          {selConvCust.is_vip && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: cs.yellow + "22", color: cs.yellow, fontWeight: 700 }}>⭐ VIP</span>}
                          {selConvOrders.length > 0 && (
                            <button onClick={() => { setWaPanel(false); setActiveMenu("orders"); }}
                              style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer" }}>
                              📋 {selConvOrders.length} order terakhir
                            </button>
                          )}
                        </div>
                      )}
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
        );
      })()}

      {/* ═══════ MODAL TAMBAH/EDIT PENGGUNA ═══════ */}
      <Suspense fallback={null}>
        <UserFormModal
          open={modalAddUser}
          onClose={() => { setModalAddUser(false); setNewUserForm({ name: "", email: "", role: "Admin", password: "", phone: "" }); }}
          newUserForm={newUserForm}
          setNewUserForm={setNewUserForm}
          userAccounts={userAccounts}
          setUserAccounts={setUserAccounts}
          setTeknisiData={setTeknisiData}
          currentUser={currentUser}
          showNotif={showNotif}
          showConfirm={showConfirm}
          addAgentLog={addAgentLog}
          _apiHeaders={_apiHeaders}
        />
      </Suspense>

      {/* ═══════ MODAL CUSTOMER — CustomerFormModal ═══════ */}
      <Suspense fallback={null}>
        <CustomerFormModal
          open={modalAddCustomer}
          onClose={() => { setModalAddCustomer(false); setNewCustomerForm({ name: "", phone: "", address: "", area: "", notes: "", is_vip: false }); }}
          selectedCustomer={selectedCustomer}
          presetForm={newCustomerForm}
          customersData={customersData}
          ordersData={ordersData}
          showNotif={showNotif}
          addAgentLog={addAgentLog}
          setCustomersData={setCustomersData}
          setSelectedCustomer={setSelectedCustomer}
          setOrdersData={setOrdersData}
          setInvoicesData={setInvoicesData}
        />
      </Suspense>
      {false && modalAddCustomer && (
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
                  <input type={type} value={newCustomerForm[key] || ""} onChange={e => {
                    const val = key === "phone" ? (normalizePhone(e.target.value) || e.target.value) : e.target.value;
                    setNewCustomerForm(f => ({ ...f, [key]: val }));
                  }}
                    placeholder={ph} style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  {key === "phone" && (() => {
                    const samePhoneCustomers = newCustomerForm.phone
                      ? customersData.filter(cu => samePhone(cu.phone, newCustomerForm.phone) && cu.id !== (selectedCustomer?.id || ""))
                      : [];
                    return samePhoneCustomers.length > 0 ? (
                      <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                        ℹ️ HP ini sudah dipakai: {samePhoneCustomers.map(c => c.name).join(", ")} — boleh tambah dengan nama berbeda (multi-lokasi)
                      </div>
                    ) : null;
                  })()}
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
                  const _normPhone = normalizePhone(newCustomerForm.phone);
                  if (!_normPhone || !/^\d{9,15}$/.test(_normPhone)) { showNotif("⚠️ Nomor HP tidak valid — harus angka 9-15 digit (contoh: 08123456789)"); return; }
                  // Cek duplikat: phone + nama harus unik (beda nama = beda lokasi, diizinkan)
                  const existExact = customersData.find(cu => sameCustomer(cu, newCustomerForm.phone, newCustomerForm.name) && cu.id !== (selectedCustomer?.id || ""));
                  if (existExact) { showNotif(`⚠️ Customer "${existExact.name}" dengan nomor HP ini sudah terdaftar.`); return; }
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
                    else {
                      const newName = newCustomerForm.name.trim();
                      const oldName = selectedCustomer.name;
                      const newPhone = normalizePhone(newCustomerForm.phone);
                      const oldPhone = (selectedCustomer.phone || "").trim();
                      const linkedJobIds = ordersData
                        .filter(o => o.customer_id === selectedCustomer.id)
                        .map(o => o.id);

                      // Cascade NAMA — orders, invoices, service_reports
                      if (newName !== oldName) {
                        await supabase.from("orders").update({ customer: newName }).eq("customer_id", selectedCustomer.id);
                        if (linkedJobIds.length > 0) {
                          await supabase.from("invoices").update({ customer: newName }).in("job_id", linkedJobIds);
                          await supabase.from("service_reports").update({ customer: newName }).in("job_id", linkedJobIds);
                        }
                        setOrdersData(prev => prev.map(o => o.customer_id === selectedCustomer.id ? { ...o, customer: newName } : o));
                      }

                      // Cascade PHONE + invalidate PDF cache invoice
                      // Tanpa ini: PDF lama tetap pakai phone lama, payment match & WA reminder rusak.
                      if (newPhone && newPhone !== oldPhone) {
                        await supabase.from("orders").update({ phone: newPhone }).eq("customer_id", selectedCustomer.id);
                        if (linkedJobIds.length > 0) {
                          await supabase.from("invoices").update({
                            phone: newPhone,
                            pdf_url: null,            // invalidate cached PDF → auto-regenerate
                            pdf_generated_at: null,
                          }).in("job_id", linkedJobIds);
                          await supabase.from("service_reports").update({ phone: newPhone }).in("job_id", linkedJobIds);
                        }
                        setOrdersData(prev => prev.map(o => o.customer_id === selectedCustomer.id ? { ...o, phone: newPhone } : o));
                        setInvoicesData(prev => prev.map(i => linkedJobIds.includes(i.job_id) ? { ...i, phone: newPhone, pdf_url: null, pdf_generated_at: null } : i));
                        showNotif("✅ Phone customer diupdate — " + linkedJobIds.length + " order/invoice ikut ter-sync, PDF akan regenerate otomatis");
                      } else {
                        showNotif("✅ Data " + newName + " berhasil diupdate");
                      }
                      addAgentLog("CUSTOMER_UPDATED", "Customer " + newName + " diupdate oleh " + auditUserName() + (newPhone !== oldPhone ? " (phone cascaded ke " + linkedJobIds.length + " order/invoice)" : ""), "SUCCESS");
                    }
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
                      showNotif("⚠️ Gagal simpan customer: " + cErr.message);
                      return;
                    }
                    setCustomersData(prev => [...prev, savedCust || { ...dbCust, id: "CUST_" + Date.now() }]);
                    addAgentLog("CUSTOMER_ADDED", "Customer baru: " + newCustomerForm.name + " (" + newCustomerForm.area + ")", "SUCCESS");
                    showNotif("✅ Customer " + newCustomerForm.name + " berhasil ditambahkan");
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

      {/* ═══════ MODAL EDIT ORDER — EditOrderModal ═══════ */}
      <Suspense fallback={null}>
        <EditOrderModal
          open={modalEditOrder}
          onClose={() => { setModalEditOrder(false); setEditOrderItem(null); }}
          editOrderItem={editOrderItem}
          ordersData={ordersData}
          teknisiData={teknisiData}
          priceListData={priceListData}
          effectiveServiceTypes={effectiveServiceTypes}
          hitungJamSelesai={hitungJamSelesai}
          hitungDurasi={hitungDurasi}
          cekTeknisiAvailable={cekTeknisiAvailable}
          araSchedulingSuggest={araSchedulingSuggest}
          cekTeknisiAvailableDB={cekTeknisiAvailableDB}
          sendWA={sendWA}
          addAgentLog={addAgentLog}
          auditUserName={auditUserName}
          appSettings={appSettings}
          showNotif={showNotif}
          setOrdersData={setOrdersData}
        />
      </Suspense>
      {false && modalEditOrder && editOrderItem && (
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
                      {effectiveServiceTypes.map(s => <option key={s}>{s}</option>)}
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
                      sendWA(tek.phone, `Halo ${editOrderForm.teknisi}, ada *perubahan jadwal*:\n📋 ${editOrderItem.id} — ${editOrderForm.customer || editOrderItem.customer}\n🔧 ${editOrderForm.service} ${editOrderForm.units} unit\n📅 ${editOrderForm.date} jam ${editOrderForm.time}–${timeEnd}\n📍 ${editOrderForm.address || editOrderItem.address}\n${editOrderForm.notes ? "📝 " + editOrderForm.notes + "\n" : ""}Mohon konfirmasi. — ${appSettings.app_name || "AClean"}`);
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
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted }}>Memuat...</div>}>
          <LaporanDetailModal ctx={{
            INSTALL_ITEMS, KONDISI_SBL, KONDISI_SDH, PEKERJAAN_OPT, SATUAN_OPT, TIPE_AC_OPT,
            _apiFetch, _apiHeaders, activeEditUnitIdx, addAgentLog, auditUserName, currentUser,
            downloadServiceReportPDF, editGratisAlasan, editLaporanForm, editLaporanFotos, editLaporanMode, editPhotoMode,
            editRepairType, editStockMats, getBracketKey, hargaPerUnitFromTipe, hitungLabor, invUnitsData,
            inventoryData, invoicesData, isMobile, laporanBarangItems, laporanInstallItems, lookupHargaGlobal,
            ordersData, priceListData, safeArr, selectedLaporan, setActiveEditUnitIdx, setEditGratisAlasan,
            setEditLaporanForm, setEditLaporanFotos, setEditLaporanMode, setEditPhotoMode, setEditRepairType, setEditStockMats,
            setInvoicesData, setLaporanInstallItems, setLaporanReports, setModalLaporanDetail, showNotif, supabase,
            syncTrackedStock, updateInvoice, updateServiceReport,
          }} />
        </Suspense>
      )}

      {/* ═══ MODAL BERITA ACARA PROJECT — bypass submitLaporan biasa ═══ */}
      {laporanModal && !laporanSubmitted && laporanModal.project_id && (
        <Suspense fallback={null}>
          <ProjectLaporanModal
            order={laporanModal}
            currentUser={currentUser}
            supabase={supabase}
            apiFetch={_apiFetch}
            apiHeaders={_apiHeaders}
            fotoSrc={fotoSrc}
            showNotif={showNotif}
            onClose={() => setLaporanModal(null)}
          />
        </Suspense>
      )}

      {/* ═══════════════════════════════════════════════════════
          MODAL LAPORAN TEKNISI v3 — diekstrak ke src/views/LaporanTeknisiModal.jsx
      ═══════════════════════════════════════════════════════ */}
      {laporanModal && !laporanModal.project_id && (
        <Suspense fallback={null}>
          <LaporanTeknisiModal
            open={!laporanSubmitted}
            laporanSubmitted={laporanSubmitted}
            laporanModal={laporanModal}
            setLaporanModal={setLaporanModal}
            setLaporanSubmitted={setLaporanSubmitted}
            setActiveMenu={setActiveMenu}
            laporanStep={laporanStep} setLaporanStep={setLaporanStep}
            laporanUnits={laporanUnits} setLaporanUnits={setLaporanUnits}
            laporanMaterials={laporanMaterials} setLaporanMaterials={setLaporanMaterials}
            laporanJasaItems={laporanJasaItems} setLaporanJasaItems={setLaporanJasaItems}
            laporanBarangItems={laporanBarangItems} setLaporanBarangItems={setLaporanBarangItems}
            laporanInstallItems={laporanInstallItems} setLaporanInstallItems={setLaporanInstallItems}
            laporanCleaningInRepair={laporanCleaningInRepair} setLaporanCleaningInRepair={setLaporanCleaningInRepair}
            laporanFotos={laporanFotos} setLaporanFotos={setLaporanFotos}
            laporanRekomendasi={laporanRekomendasi} setLaporanRekomendasi={setLaporanRekomendasi}
            laporanCatatan={laporanCatatan} setLaporanCatatan={setLaporanCatatan}
            laporanSurveyHasil={laporanSurveyHasil} setLaporanSurveyHasil={setLaporanSurveyHasil}
            laporanSurveyCatatan={laporanSurveyCatatan} setLaporanSurveyCatatan={setLaporanSurveyCatatan}
            activeUnitIdx={activeUnitIdx} setActiveUnitIdx={setActiveUnitIdx}
            showUnitPresetModal={showUnitPresetModal} setShowUnitPresetModal={setShowUnitPresetModal}
            unitPresetHistory={unitPresetHistory} setUnitPresetHistory={setUnitPresetHistory}
            unitPresetSelected={unitPresetSelected} setUnitPresetSelected={setUnitPresetSelected}
            maintUnitPool={maintUnitPool}
            acUnitPool={acUnitPool}
            fotoInputRef={fotoInputRef}
            fotoUnitInputRef={fotoUnitInputRef}
            fotoTargetUnitRef={fotoTargetUnitRef}
            ordersData={ordersData}
            laporanReports={laporanReports}
            invoicesData={invoicesData}
            customersData={customersData}
            priceListData={priceListData}
            inventoryData={inventoryData}
            invUnitsData={invUnitsData}
            userAccounts={userAccounts}
            submitLaporan={submitLaporan}
            handleFotoUpload={handleFotoUpload}
            buildCustomerHistory={buildCustomerHistory}
            fotoSrc={fotoSrc}
            showNotif={showNotif}
            addAgentLog={addAgentLog}
            sendWA={sendWA}
            findCustomer={findCustomer}
            insertOrder={insertOrder}
            setOrdersData={setOrdersData}
            supabase={supabase}
            _apiFetch={_apiFetch}
            _apiHeaders={_apiHeaders}
            currentUser={currentUser}
            isMobile={isMobile}
          />
        </Suspense>
      )}

      {/* BAP Offline Sync Indicator — muncul untuk Teknisi/Helper kalau ada BAP menunggu sync */}
      {pendingBAPCount > 0 && currentUser && ["Teknisi", "Helper"].includes(currentUser.role) && (
        <div onClick={triggerBAPSync}
          style={{
            position: "fixed", bottom: 18, left: 18, zIndex: 590,
            background: bapSyncing ? cs.accent + "33" : cs.yellow + "22",
            border: "1px solid " + (bapSyncing ? cs.accent : cs.yellow) + "66",
            color: bapSyncing ? cs.accent : cs.yellow,
            borderRadius: 99, padding: "9px 16px", fontSize: 12, fontWeight: 700,
            cursor: "pointer", boxShadow: "0 6px 20px #0007", display: "flex", alignItems: "center", gap: 8,
          }}
          title="Klik untuk sync sekarang">
          {bapSyncing ? "☁️ Syncing..." : `📡 ${pendingBAPCount} BAP menunggu sync`}
        </div>
      )}

      {/* BAP Modal — TTD customer di HP teknisi sebelum laporan */}
      {bapModalOrder && (
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted }}>Memuat BAP...</div>}>
          <BAPModal
            order={bapModalOrder}
            onClose={() => setBapModalOrder(null)}
            onSubmitted={onBAPSubmitted}
            supabase={supabase}
            showNotif={showNotif}
            currentUser={currentUser}
            apiHeaders={_apiHeaders}
            appSettings={appSettings}
            getLocalDate={getLocalDate}
            fotoSrc={fotoSrc}
          />
        </Suspense>
      )}

      {/* Material Bring Modal — declare unit material dibawa per job */}
      {materialBringJob && (
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted }}>Memuat...</div>}>
          <MaterialBringModal
            open={!!materialBringJob}
            job={materialBringJob}
            onClose={() => setMaterialBringJob(null)}
            currentUser={currentUser}
            inventoryData={inventoryData}
            invUnitsData={invUnitsData}
            supabase={supabase}
            showNotif={showNotif}
            onSaved={() => { refreshMaterialsBroughtMap(); }}
          />
        </Suspense>
      )}

      {/* SATU PINTU: Laporan & Material per job (hub) */}
      {jobReportJob && (
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted }}>Memuat...</div>}>
          <JobReportFlow
            open={!!jobReportJob}
            job={jobReportJob}
            onClose={() => setJobReportJob(null)}
            currentUser={currentUser}
            supabase={supabase}
            materialsBroughtMap={materialsBroughtMap}
            laporanReports={laporanReports}
            onOpenBring={(o) => setMaterialBringJob(o)}
            onOpenLaporan={(o) => openLaporanModal(o)}
          />
        </Suspense>
      )}

      {/* Toast Notification */}
      {notification && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "linear-gradient(135deg,#1e293b,#0f172a)", border: "1px solid " + cs.accent + "66", color: cs.text, padding: "12px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: "0 8px 32px #000a", maxWidth: 360 }}>
          {notification}
        </div>
      )}

      {/* Undo Toast — muncul 10 detik setelah delete */}
      {undoToast && (
        <div style={{ position: "fixed", bottom: notification ? 80 : 24, right: 24, background: "#1e293b", border: "1px solid #f9731666", color: cs.text, padding: "12px 16px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 1001, boxShadow: "0 8px 32px #000a", maxWidth: 380, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>🗑 {undoToast.label}</span>
          <button onClick={async () => { await undoToast.onUndo(); dismissUndoToast(); }}
            style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            ↩ Undo
          </button>
          <button onClick={dismissUndoToast}
            style={{ background: "transparent", color: cs.muted, border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>✕</button>
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
              const bankNote = sugg.bank ? "transfer_" + sugg.bank.toLowerCase().replace(/\s/g,"_") : "transfer";
              // Cari semua invoice UNPAID/OVERDUE/PARTIAL_PAID dari nomor ini
              const unpaidByPhone = invoicesData.filter(i =>
                (i.phone === sugg.phone || (sugg.phone && i.phone && samePhone(i.phone, sugg.phone))) &&
                ["UNPAID","OVERDUE","PARTIAL_PAID"].includes(i.status)
              );
              if (!unpaidByPhone.length) {
                // Coba match by invoice_id langsung
                const byId = sugg.invoice_id ? invoicesData.find(i => i.id === sugg.invoice_id) : null;
                if (!byId) {
                  showNotif("⚠️ Invoice tidak ditemukan untuk nomor ini. Cari manual di halaman Invoice.");
                  setActiveMenu("invoice");
                  setSearchInvoice(sugg.phone || "");
                } else {
                  await markPaid(byId, bankNote, "Auto-detect WA: " + (sugg.raw_message||"").slice(0,100), true, sugg.image_url || null);
                  supabase.from("payment_suggestions").update({
                    status:"CONFIRMED", resolved_at: new Date(Date.now()+7*3600000).toISOString(), resolved_by: currentUser?.name||"Admin"
                  }).eq("id", sugg.id).then(() => {});
                  setPaymentSuggestions(prev => prev.filter(p => p.id !== sugg.id));
                  setActiveMenu("invoice");
                  setSearchInvoice(byId.id);
                  setInvoiceFilter("Semua");
                }
              } else if (unpaidByPhone.length === 1) {
                // Normal flow — 1 invoice saja
                await markPaid(unpaidByPhone[0], bankNote, "Auto-detect WA: " + (sugg.raw_message||"").slice(0,100), true, sugg.image_url || null);
                supabase.from("payment_suggestions").update({
                  status:"CONFIRMED", resolved_at: new Date(Date.now()+7*3600000).toISOString(), resolved_by: currentUser?.name||"Admin"
                }).eq("id", sugg.id).then(() => {});
                setPaymentSuggestions(prev => prev.filter(p => p.id !== sugg.id));
                setActiveMenu("invoice");
                setSearchInvoice(unpaidByPhone[0].id);
                setInvoiceFilter("Semua");
              } else {
                // Multi-invoice → buka Group Payment modal
                setGroupPaymentCtx({
                  phone: sugg.phone,
                  invoices: unpaidByPhone,
                  suggestedAmount: sugg.amount ? Number(sugg.amount) : unpaidByPhone.reduce((s,i) => s + (i.total||0), 0),
                  proofUrl: sugg.image_url || null,
                  method: bankNote,
                  suggId: sugg.id,
                });
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

      {/* ── Group Payment Modal ── */}
      {groupPaymentCtx && (
        <GroupPaymentModal
          ctx={groupPaymentCtx}
          onConfirm={async (invoiceIds, totalReceived, proofUrl, method) => {
            await handleGroupPayment(groupPaymentCtx.phone, invoiceIds, totalReceived, proofUrl, method);
            if (groupPaymentCtx.suggId) {
              supabase.from("payment_suggestions").update({
                status: "CONFIRMED",
                resolved_at: new Date(Date.now() + 7 * 3600000).toISOString(),
                resolved_by: currentUser?.name || "Admin",
              }).eq("id", groupPaymentCtx.suggId).then(() => {});
              setPaymentSuggestions(prev => prev.filter(p => p.id !== groupPaymentCtx.suggId));
            }
            setGroupPaymentCtx(null);
            setActiveMenu("invoice");
          }}
          onClose={() => setGroupPaymentCtx(null)}
          fmt={fmt}
          cs={cs}
        />
      )}

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
