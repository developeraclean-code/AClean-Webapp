import { useState, useEffect, useRef, useCallback, useMemo, Component, lazy, Suspense } from "react";
import { supabase } from "./supabaseClient.js";
import { normalizePhone, samePhone } from "./lib/phone.js";
import { getLocalDate, getLocalISOString, isWorkingHours } from "./lib/dateTime.js";
import { safeJsonParse } from "./lib/safeJson.js";
import { reportError } from "./lib/reportError.js";
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
  hitungMaterialTotal as hitungMaterialTotalLib,
} from "./lib/pricing.js";
import { cs } from "./theme/cs.js";
import { statusColor, statusLabel } from "./constants/status.js";
import { SERVICE_TYPES } from "./constants/services.js";
import { DEFAULT_BONUS_CATEGORIES } from "./constants/bonus.js";
import {
  fetchOrders, fetchInvoices, fetchCustomers, fetchInventory,
  fetchServiceReports, fetchInventoryTransactions,
  fetchInvoicesSince, fetchServiceReportsSince, fetchOrdersSince,
  searchInvoicesServer, searchOrdersServer, searchServiceReportsServer,
  fetchInventoryUnits, fetchExpenses, fetchPayments, fetchDispatchLogs,
  fetchAppSettings, fetchUserProfiles, fetchUserAccounts,
  fetchWaConversations, fetchPriceList, fetchAraBrain,
  lookupCustomersByPhone, fetchKasbonRequests, fetchInvoiceById, fetchInvoicesByIds,
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
import ConfirmModal from "./views/ConfirmModal.jsx";
import CommissionPinModal from "./views/CommissionPinModal.jsx";
import KasbonWidget from "./views/KasbonWidget.jsx";
import ExpenseInputWidget from "./views/ExpenseInputWidget.jsx";
import ViewErrorBoundary from "./components/ViewErrorBoundary.jsx";
import { AppContext } from "./context/AppContext.js";
import { useSettings } from "./hooks/useSettings.js";
import { buildServiceReportHTML } from "./lib/serviceReportHtml.js";
import { downloadRekapHarian as downloadRekapHarianLib } from "./lib/reports.js";
import { createConsolidatedInvoice as createConsolidatedInvoiceLib } from "./lib/consolidatedInvoice.js";
import { createOrder as createOrderLib } from "./lib/createOrder.js";
import { sendToARA as sendToARAImpl } from "./lib/ara.js";
import { markPaid as markPaidLib } from "./lib/markPaid.js";
import { handleGroupPayment as handleGroupPaymentLib } from "./lib/groupPayment.js";
import { checkStuckJobs as checkStuckJobsLib } from "./lib/checkStuckJobs.js";
import { doLogin as doLoginLib } from "./lib/doLogin.js";
import { mergedInvoiceWA as mergedInvoiceWALib } from "./lib/mergedInvoiceWa.js";
import { approveInvoiceCore as approveInvoiceCoreLib } from "./lib/approveInvoiceCore.js";
import { submitLaporan as submitLaporanImpl } from "./lib/submitLaporan.js";
import { loadAllData } from "./lib/loadAllData.js";
import { approveKasbon as approveKasbonLib, rejectKasbon as rejectKasbonLib } from "./lib/kasbon.js";
import { handleFotoUpload as handleFotoUploadLib } from "./lib/fotoUpload.js";
import { retroMatchPayment as retroMatchPaymentLib } from "./lib/retroMatch.js";
import { syncTrackedStock as syncTrackedStockLib } from "./lib/trackedStock.js";
import { createTeamSplit as createTeamSplitLib } from "./lib/createTeamSplit.js";
import { sendDispatchWA as sendDispatchWALib } from "./lib/dispatchWa.js";
import { uploadMergedInvoicePDFForWA as uploadMergedInvoicePDFForWALib } from "./lib/mergedInvoicePdf.js";
import { openLaporanModal as openLaporanModalLib } from "./lib/openLaporanModal.js";
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
const WebsiteContentView = lazy(() => import("./views/WebsiteContentView.jsx"));
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
const CustomerHistoryModal   = lazy(() => import("./views/CustomerHistoryModal.jsx"));
const WaPanel                = lazy(() => import("./views/WaPanel.jsx"));
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
  // Wrapper (Fase 3, pola ctx): kasbon pindah ke lib/kasbon.
  const approveKasbon = (req, reviewNotes = "") => approveKasbonLib(req, reviewNotes, { addAgentLog, appSettings, auditUserName, currentUser, insertExpense, sendWA, setExpensesData, setKasbonRequests, showNotif, supabase, updateKasbonRequest });
  const rejectKasbon = (req, reviewNotes = "") => rejectKasbonLib(req, reviewNotes, { addAgentLog, appSettings, auditUserName, currentUser, sendWA, setKasbonRequests, showNotif, supabase, updateKasbonRequest });
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
  const showConfirm = useCallback((opts) => new Promise(resolve => {
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
  }), []);

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
  const addAgentLog = useCallback(async (action, detail, status = "SUCCESS") => {
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
  }, [currentUser]);

  // ── AUDIT TRAIL (stabilisasi #2B) ──
  // Pooler Supabase = transaction mode → session var ga persist. Solusi:
  // inject kolom last_changed_by langsung ke payload. Trigger baca dari NEW/OLD row.
  // auditUserName() = helper nama string user aktif.
  // setAuditUser() = legacy (coba set session var juga, fail-silent backup).
  const auditUserName = useCallback(() => currentUser?.name || currentUser?.email || currentUser?.id || "system", [currentUser]);
  const setAuditUser = async () => {
    try { await supabase.rpc("set_current_user", { uid: auditUserName() }); }
    catch { /* pooler ga support, diabaikan — last_changed_by di payload sudah cukup */ }
  };

  // ── App Settings: bank, phone, nama — load dari DB tabel app_settings ──
  // Fase 2: state appSettings + effectiveServiceTypes dipindah ke useSettings().
  // Load dari Supabase tetap di efek besar di bawah (terjalin) → panggil setAppSettings.
  const { appSettings, setAppSettings, effectiveServiceTypes } = useSettings();

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
  const _lsSave = (key, val) => { try { localStorage.setItem("aclean_" + key, JSON.stringify(val)); } catch { /* localStorage opsional — abaikan */ } };
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
      const _postExchange = (bearer) => fetch("/api/get-api-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${bearer}` }
      });
      let r = await _postExchange(jwt);
      // 401 = JWT ditolak Supabase (sesi basi walau tab masih "login"). Paksa refresh
      // sesi lalu coba SEKALI lagi dgn JWT segar. Kalau refresh gagal -> sesi mati,
      // biarkan silent (view yg butuh token akan tampil error, bukan loop tak henti).
      if (r.status === 401) {
        try {
          const refreshed = await supabase.auth.refreshSession();
          const freshJwt = refreshed?.data?.session?.access_token;
          if (freshJwt && freshJwt !== jwt) r = await _postExchange(freshJwt);
        } catch { /* refresh gagal -> sesi benar-benar mati, user perlu login ulang */ }
      }
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
  const _apiHeaders = useCallback(async () => {
    if (!_internalTokenRef.current || Date.now() >= _internalTokenExpRef.current) {
      await _exchangeApiToken();
    }
    return {
      "Content-Type": "application/json",
      ...(_internalTokenRef.current ? { "X-Internal-Token": _internalTokenRef.current } : {})
    };
  }, []); // deps kosong: hanya refs (stable) yang di-close
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
  // useCallback (Fase 1): identitas stabil supaya appContextValue (useMemo) tak
  // berubah tiap render — cegah view memo'd re-render sia-sia tiap App render.
  const pushNotif = useCallback((title, body, icon = "⬡") => {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, icon: "/favicon.ico", tag: "aclean-" + Date.now() });
      } catch { /* notifikasi browser opsional — abaikan */ }
    }
  }, []);
  const showNotif = useCallback((msg, push = false) => {
    setNotification(msg);
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
    if (push) pushNotif(appSettings.app_name || "AClean", msg.replace(/[🔔📋✅❌⚠️💰]/g, "").trim());
  }, [pushNotif, appSettings.app_name]);

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
  const checkStuckJobs = () => checkStuckJobsLib({ TODAY, addAgentLog, agentLogs, appSettings, laporanReports, ordersData, sendWA, showNotif, teknisiData, userAccounts });

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

  // Wrapper (Fase 2): rekap harian CSV pindah ke lib/reports, deps di-thread.
  // Dioper ke OrdersView/InvoiceView/ScheduleView sebagai prop — interface tetap.
  const downloadRekapHarian = (targetDate) => downloadRekapHarianLib(targetDate, { TODAY, ordersData, invoicesData, currentUser, showNotif, addAgentLog });


  // Baris invoice dari state lokal bisa basi (pdf_url/updated_at lama belum
  // ter-poll setelah edit/revisi) → cache PDF menyajikan versi lama. Refetch 1 baris
  // segar sebelum generate; gagal fetch → fallback baris lokal (degraded, bukan blokir).
  const freshInvoiceRow = async (inv) => {
    try {
      const { data, error } = await fetchInvoiceById(supabase, inv.id);
      if (!error && data) {
        // Sinkronkan state supaya jalur lain di sesi ini ikut pakai versi segar
        setInvoicesData(prev => prev.map(i => i.id === data.id ? { ...i, ...data } : i));
        return data;
      }
    } catch (err) {
      console.warn("[freshInvoiceRow] refetch gagal:", err?.message || err);
    }
    return inv;
  };

  const downloadInvoicePDF = async (invStale) => {
    showNotif("⏳ Membuat PDF invoice...");
    try {
      const inv = await freshInvoiceRow(invStale);
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
    const { getCachedPDF, setCachedPDF, invalidateCachedPDF } = await import("./lib/pdfCache.js");

    // Self-heal alamat: invoice lama (pra-fix) tidak menyalin address dari order,
    // jadi blok "Tagihan Kepada" tampil tanpa alamat pekerjaan. Ambil dari order
    // terkait, render dgn alamat, dan backfill ke DB — updateInvoice sekalian
    // meng-NULL pdf_url lama sehingga cache PDF tanpa alamat tidak dipakai lagi.
    if (!inv.address && inv.job_id) {
      const ordSrc = ordersData.find(o => o.id === inv.job_id)
        || ordersData.find(o => o.job_group_id === inv.job_id)
        || ordersData.find(o => o.parent_job_id === inv.job_id);
      const addr = ordSrc?.address ? ordSrc.address + (ordSrc.area ? ", " + ordSrc.area : "") : null;
      if (addr) {
        inv = { ...inv, address: addr, pdf_url: null };
        invalidateCachedPDF("invoice", inv.id); // blob memori lama juga tanpa alamat
        updateInvoice(supabase, inv.id, { address: addr }, "SYSTEM (backfill alamat)")
          .then(({ error }) => {
            if (!error) setInvoicesData(prev => prev.map(i =>
              i.id === inv.id ? { ...i, address: addr, pdf_url: null, pdf_generated_at: null } : i));
          })
          .catch(() => {});
      }
    }

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
      cacheInvoicePDFToR2(inv.id, blob, inv.updated_at || null).catch(err =>
        console.warn("[generateInvoicePDFBlob] background R2 cache failed:", err.message)
      );
    }
    return blob;
  };

  // Upload PDF blob ke R2 + update invoices.pdf_url di DB. Non-blocking.
  // versionUpdatedAt: tulis pdf_url hanya bila baris belum berubah sejak generate —
  // tanpa ini, edit di sela generate↔upload bisa tertimpa URL PDF versi lama.
  const cacheInvoicePDFToR2 = async (invoiceId, blob, versionUpdatedAt = null) => {
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
    let q = supabase
      .from("invoices")
      .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (versionUpdatedAt) q = q.eq("updated_at", versionUpdatedAt);
    const { error: upErr } = await q;
    if (upErr) console.warn("[cacheInvoicePDFToR2] DB update failed:", upErr.message);
    return pdfUrl;
  };

  const uploadInvoicePDFForWA = async (invStale, portalLink = null) => {
    try {
      // Refetch baris segar — fast path di bawah memakai inv.pdf_url; kalau dari state
      // basi (belum ter-poll pasca edit), PDF LAMA bisa terkirim ke customer via WA.
      const inv = await freshInvoiceRow(invStale);
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
        // Simpan ke DB juga (kalau variant tanpa portalLink) — bersyarat updated_at
        // belum berubah, agar edit di sela proses tak tertimpa URL PDF lama.
        if (!portalLink) {
          let q = supabase.from("invoices")
            .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
            .eq("id", inv.id);
          if (inv.updated_at) q = q.eq("updated_at", inv.updated_at);
          q.then(({ error }) => error && console.warn("[uploadInvoicePDFForWA] DB cache update failed:", error.message));
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
  const generateMergedInvoicePDFBlob = async (invListStale, portalLink = null) => {
    if (!Array.isArray(invListStale) || invListStale.length === 0) return null;
    // Refetch batch segar — cache key & render memakai updated_at/isi baris; dari state
    // basi (pasca edit, sebelum poll) hasilnya PDF versi lama. Gagal fetch → fallback lokal.
    let invList = invListStale;
    try {
      const { data, error } = await fetchInvoicesByIds(supabase, invListStale.map(i => i.id));
      if (!error && data?.length) {
        const freshMap = new Map(data.map(r => [r.id, r]));
        invList = invListStale.map(i => freshMap.get(i.id) || i);
        setInvoicesData(prev => prev.map(i => freshMap.has(i.id) ? { ...i, ...freshMap.get(i.id) } : i));
      }
    } catch (err) {
      console.warn("[generateMergedInvoicePDFBlob] refetch gagal:", err?.message || err);
    }
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

  // Wrapper (Fase 3, pola ctx): uploadMergedInvoicePDFForWA pindah ke lib.
  const uploadMergedInvoicePDFForWA = (invList, portalLink = null) => uploadMergedInvoicePDFForWALib(invList, portalLink, { _apiFetch, _apiHeaders, computeMergedCacheKey, generateMergedInvoicePDFBlob, supabase });

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


  // Preview / download Service Report Card di browser
  // Ambil baris laporan SEGAR dari DB sebelum render report card — anti data basi
  // (edit admin lain belum ter-poll 90 dtk / foto_urls baru belum masuk state lokal).
  // Pola sama freshInvoiceRow (83a8af9). Gagal refetch → fallback state lokal.
  const freshReportRow = async (laporan) => {
    try {
      if (!laporan?.id) return laporan;
      const { data, error } = await supabase.from("service_reports").select("*").eq("id", laporan.id).maybeSingle();
      if (!error && data) {
        const fresh = parseLaporanRow(data);
        // Sinkronkan state supaya jalur lain sesi ini ikut versi segar
        setLaporanReports(prev => prev.map(r => r.id === fresh.id ? { ...r, ...fresh } : r));
        return fresh;
      }
    } catch (err) { console.warn("[freshReportRow] refetch gagal:", err?.message || err); }
    return laporan;
  };

  const downloadServiceReportPDF = async (laporanStale, inv) => {
    const laporan = await freshReportRow(laporanStale);
    const logoUrl = await fetchInvoiceLogoUrl();
    const origin = window.location.origin;
    // Pre-fetch semua foto sebagai base64 data URL agar embedded dalam HTML (tidak butuh network saat print)
    const fotoUrls = (laporan.foto_urls || []).filter(Boolean);
    const photoDataUrls = {};
    await Promise.all(fotoUrls.map(async (url) => {
      const dataUrl = await fetchFotoAsDataUrl(url, origin);
      if (dataUrl) photoDataUrls[url] = dataUrl;
    }));
    const html = buildServiceReportHTML(laporan, inv, logoUrl, origin, photoDataUrls, false, appSettings, ordersData);
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
  const uploadServiceReportForWA = async (laporanStale, inv) => {
    try {
      const laporan = await freshReportRow(laporanStale);
      const logoUrl = await fetchInvoiceLogoUrl();
      const origin = window.location.origin;
      const fotoUrls = (laporan.foto_urls || []).filter(Boolean);
      const photoDataUrls = {};
      await Promise.all(fotoUrls.map(async (url) => {
        const dataUrl = await fetchFotoAsDataUrl(url, origin);
        if (dataUrl) photoDataUrls[url] = dataUrl;
      }));
      const html = buildServiceReportHTML(laporan, inv, logoUrl, origin, photoDataUrls, true, appSettings, ordersData); // forWA=true
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
  const uploadServiceReportPDFForWA = async (laporanStale, inv) => {
    try {
      const laporan = await freshReportRow(laporanStale);
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

  // Wrapper (Fase 2, pola ctx): openLaporanModal pindah ke lib; 50 dep via ctx.
  const openLaporanModal = (order) => openLaporanModalLib(order, {
    AC_REGISTRY_CUTOFF, _apiFetch, acUnitToHist, buildCustomerHistory, currentUser,
    customersData, fetchAcUnitsByCustomer, findCustomer, inventoryData, invoicesData,
    laporanReports, maintUnitToHist, mkUnit, ordersData, priceListData, setAcUnitPool,
    setActiveUnitIdx, setAddMaintSelected, setJasaManualText, setJasaSearchQ,
    setLaporanBarangItems, setLaporanCatatan, setLaporanCleaningInRepair, setLaporanFotos,
    setLaporanInstallItems, setLaporanJasaItems, setLaporanMaterials, setLaporanModal,
    setLaporanRekomendasi, setLaporanRepairItems, setLaporanStep, setLaporanSubmitted,
    setLaporanSurveyCatatan, setLaporanSurveyHasil, setLaporanUnits, setMaintUnitPool,
    setMatSearchQ2, setRepairManualText, setRepairSearchQ, setShowAddMaintUnitModal,
    setShowJasaSearch, setShowMatPreset, setShowMatSearch, setShowRepairSearch,
    setShowUnitPresetModal, setUnitPresetHistory, setUnitPresetSelected, showNotif,
    submitLaporanLock, supabase,
  });
  const doLogin = (email, pass) => doLoginLib(email, pass, { _ls, _lsSave, addAgentLog, loginAttempts, requestPushPermission, setActiveMenu, setActiveRole, setCurrentUser, setIsLoggedIn, setLockoutUntil, setLoginAttempts, setLoginError, showNotif, supabase });

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
      const adminBlocked = ["settings", "myreport", "matcheckout", "alatsaya", "monitoring", "wa_groups", "finance", "pricelist", "reports", "deletedaudit", "website"];
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
      try { localStorage.removeItem("aclean_" + k); } catch { /* localStorage opsional — abaikan */ }
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
      } catch (e) { try { localStorage.removeItem("aclean_" + key); } catch { /* localStorage opsional — abaikan */ } }
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

    // Wrapper (Fase 3, pola ctx): loadAll (bootstrap data) pindah ke lib/loadAllData.
    // Dipanggil dari initLoadAll (bawah) & auto-refresh polling.
    const loadAll = () => loadAllData({
      _ls, _lsSave, buildPriceListFromDB, cachedFetch, currentUser, dedupReportsByJob,
      fetchAppSettings, fetchAraBrain, fetchCustomers, fetchDispatchLogs, fetchInventory,
      fetchInventoryTransactions, fetchInventoryUnits, fetchInvoices, fetchOrders,
      fetchPayments, fetchPriceList, fetchServiceReports, fetchUserAccounts,
      fetchUserProfiles, fetchWaConversations, parseInvoiceRow, parseLaporanRow,
      setAppSettings, setBonusCategories, setBrainMd, setBrainMdCustomer, setCronJobs,
      setCustomersData, setDispatchLogs, setInvTxData, setInvUnitsData, setInventoryData,
      setInvoicesData, setLaporanReports, setLlmApiKey, setLlmModel, setLlmProvider,
      setOrdersData, setPaymentSuggestions, setPaymentsData, setPriceListData,
      setPriceListSyncedAt, setProjectDailyReports, setTeknisiData, setUserAccounts,
      setWaConversations, setWaProvider, supabase,
    });

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

    // ══ Polling ringan — pengganti Supabase Realtime / Postgres Changes ══
    // Postgres Changes (decode WAL) = sumber utama beban compute Supabase (~68%) → DIMATIKAN.
    // Diganti polling jam-kerja + sadar-visibility tab. Publication supabase_realtime dikosongkan
    // via migrasi 109. Bukti bayar (payment_suggestions) TETAP via _payPoll di bawah — tak terpengaruh.
    const POLL_MS = 90 * 1000;
    const _shouldPoll = () =>
      isWorkingHours() && (typeof document === "undefined" || document.visibilityState === "visible");

    // Inkremental: hanya tarik baris yang BERUBAH sejak poll terakhir (updated_at > cursor),
    // lalu merge by id ke state. Saat idle → 0 baris → egress ~nol. Cursor mulai dari waktu
    // efek (minus buffer 2 mnt utk toleransi skew jam). DELETE ditutup oleh loadAll penuh tiap 30 mnt.
    let _orderCursor  = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    let _invoiceCursor = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    let _reportCursor = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const _pollOrders = setInterval(() => {
      if (!_shouldPoll()) return;
      fetchOrdersSince(supabase, _orderCursor).then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        _orderCursor = data[data.length - 1].updated_at || _orderCursor;
        setOrdersData(prev => {
          const map = new Map((prev || []).map(r => [r.id, r]));
          data.forEach(r => map.set(r.id, r));
          return Array.from(map.values()).sort((a, b) => (b.date || "") > (a.date || "") ? 1 : -1);
        });
      }).catch(() => {});
    }, POLL_MS);

    const _pollInvoices = setInterval(() => {
      if (!_shouldPoll()) return;
      fetchInvoicesSince(supabase, _invoiceCursor).then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        // Query order updated_at ASC → baris terakhir = paling baru. Pakai langsung (format-agnostic).
        _invoiceCursor = data[data.length - 1].updated_at || _invoiceCursor;
        setInvoicesData(prev => {
          const map = new Map((prev || []).map(r => [r.id, r]));
          data.map(parseInvoiceRow).forEach(r => map.set(r.id, r));
          return Array.from(map.values()).sort((a, b) => (b.created_at || "") > (a.created_at || "") ? 1 : -1);
        });
      }).catch(() => {});
    }, POLL_MS);

    const _pollReports = setInterval(() => {
      if (!_shouldPoll()) return;
      fetchServiceReportsSince(supabase, _reportCursor).then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        // Query order updated_at ASC → baris terakhir = paling baru. Pakai langsung (format-agnostic).
        _reportCursor = data[data.length - 1].updated_at || _reportCursor;
        setLaporanReports(prev => {
          const map = new Map((prev || []).map(r => [r.id, r]));
          data.map(parseLaporanRow).forEach(r => map.set(r.id, r));
          return dedupReportsByJob(Array.from(map.values()))
            .sort((a, b) => (b.submitted_at || "") > (a.submitted_at || "") ? 1 : -1);
        });
      }).catch(() => {});
    }, POLL_MS);

    // WA monitor: refresh daftar percakapan saat monitor aktif (gantikan ch7/ch8 postgres_changes
    // yang sudah no-op — wa_conversations/wa_messages tidak ada di publication realtime).
    const _waMonitorOn = appSettings?.wa_monitor_enabled === "true";
    const _pollWa = _waMonitorOn ? setInterval(() => {
      if (!_shouldPoll()) return;
      fetchWaConversations(supabase, 100).then(res => {
        if (!res.error && res.data) setWaConversations(res.data);
      }).catch(() => {});
    }, POLL_MS) : null;

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
      clearInterval(_pollOrders);
      clearInterval(_pollInvoices);
      clearInterval(_pollReports);
      if (_pollWa) clearInterval(_pollWa);
      if (_payPoll) clearInterval(_payPoll);

      clearTimeout(autoVerifyTimer);
      clearInterval(_statsTimer);
      if (stuckCheckTimer.current) clearInterval(stuckCheckTimer.current);
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

  // Parser baris invoice & laporan — SATU sumber kebenaran, dipakai loadAll() awal & polling live.
  const parseInvoiceRow = (inv) => ({
    ...inv,
    materials_detail: (() => {
      if (!inv.materials_detail) return [];
      if (Array.isArray(inv.materials_detail)) return inv.materials_detail;
      return safeJsonParse(inv.materials_detail, `invoice_materials_${inv.id}`, []);
    })(),
  });

  const parseLaporanRow = (r) => ({
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

  // Dedup laporan by job_id — keep latest submitted (cegah double laporan saat rewrite).
  const dedupReportsByJob = (reports) => {
    const m = new Map();
    reports.forEach(r => {
      const ex = m.get(r.job_id);
      if (!ex) { m.set(r.job_id, r); return; }
      const rTime = r.submitted_at || r.submitted || "";
      const eTime = ex.submitted_at || ex.submitted || "";
      if (rTime > eTime) m.set(r.job_id, r);
    });
    return Array.from(m.values());
  };

  // cs / statusColor / statusLabel sudah di-import dari src/theme & src/constants (Fase 2)

  const fmt = useCallback((n) => "Rp " + (n || 0).toLocaleString("id-ID"), []);

  // useMemo (Fase 1): identitas appContextValue stabil supaya view memo'd tak
  // re-render sia-sia. WAJIB DITARUH SEBELUM early-return (layar login/loading di
  // bawah) — hook setelah early return = jumlah hook berubah antar render =
  // React error #310 (crash). Semua dep sudah terdefinisi di atas; nilai ini baru
  // dipakai di Provider pada return utama.
  const appContextValue = useMemo(() => ({
    currentUser, supabase, showNotif, showConfirm, addAgentLog,
    fmt, TODAY, isMobile, auditUserName,
  }), [currentUser, supabase, showNotif, showConfirm, addAgentLog, fmt, TODAY, isMobile, auditUserName]);
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
  // Wrapper (Fase 3, pola ctx): sendDispatchWA pindah ke lib/dispatchWa.
  const sendDispatchWA = (order) => sendDispatchWALib(order, { _apiHeaders, addAgentLog, appSettings, currentUser, sendWA, showNotif, supabase, teknisiData });

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
  const mergedInvoiceWA = (invList) => mergedInvoiceWALib(invList, { addAgentLog, appSettings, currentUser, fmt, getPortalLink, samePhone, sendWA, showNotif, uploadMergedInvoicePDFForWA, writeInvoiceSendAudit });

  // ── Buat 1 invoice baru gabungan dari beberapa invoice (untuk 1 customer) ──
  // Wrapper (Fase 2, kalibrasi pola ctx stateful): createConsolidatedInvoice
  // pindah ke lib/consolidatedInvoice; semua dep dioper via objek ctx. Dioper ke
  // InvoiceView sebagai prop — interface tak berubah.
  const createConsolidatedInvoice = (invList) => createConsolidatedInvoiceLib(invList, {
    supabase, currentUser, showNotif, addAgentLog, setInvoicesData,
    getLocalDate, samePhone, normalizeLines, summarize,
    checkInvoiceConsistency, describeInconsistency,
  });


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

  // Wrapper: total material laporan — delegasi ke lib pricing (Fase 2) dgn
  // state (priceListData/inventoryData) + PRICE_LIST cache sebagai fallback.
  const hitungMaterialTotal = (materials) => hitungMaterialTotalLib(materials, priceListData, inventoryData, PRICE_LIST);

  // ── GAP 3: Approve invoice (real state mutation) ──
  // ── Approve invoice (core) — tanpa kirim WA ──
  // ── Retro-match: cari bukti bayar yang sudah masuk untuk invoice yang baru di-approve ──
  // Dipanggil saat invoice berubah ke UNPAID. Cari payment_suggestions by phone dalam 7 hari.
  // Wrapper (Fase 3, pola ctx): retroMatchPayment pindah ke lib/retroMatch.
  const retroMatchPayment = (inv) => retroMatchPaymentLib(inv, { addAgentLog, normalizePhone, sendWA, setInvoicesData, supabase, userAccounts });

  const approveInvoiceCore = (inv) => approveInvoiceCoreLib(inv, { addAgentLog, auditUserName, currentUser, fmt, getLocalDate, getLocalISOString, ordersData, reportError, retroMatchPayment, setAuditUser, setInvoicesData, setOrdersData, showNotif, supabase, updateInvoice, updateOrderStatus, validatePositiveNumber });

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
  // Wrapper (Fase 2, pola ctx): markPaid pindah ke lib/markPaid; 18 dep via ctx.
  // Dipakai: prop InvoiceView, ctx sendToARA, panggilan langsung WA-detect.
  const markPaid = (inv, method = "transfer", notes = "", sendCustNotif = null, paymentProofUrl = null) => markPaidLib(inv, method, notes, sendCustNotif, paymentProofUrl, {
    addAgentLog, appSettings, auditUserName, fmt, getLocalISOString, markInvoicePaid,
    ordersData, reportError, retroMatchPayment, sendWA, setAuditUser, setInvoicesData,
    setOrdersData, showConfirm, showNotif, supabase, updateInvoice, validatePositiveNumber,
  });

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
  // Wrapper (Fase 2, pola ctx): handleGroupPayment pindah ke lib/groupPayment.
  const handleGroupPayment = (customerPhone, invoiceIds, totalReceived, proofUrl, method) => handleGroupPaymentLib(customerPhone, invoiceIds, totalReceived, proofUrl, method, {
    addAgentLog, auditUserName, fmt, getLocalISOString, invoicesData, markInvoicePaid,
    ordersData, setAuditUser, setInvoicesData, setOrdersData, showNotif, supabase,
  });

  // ── GAP 6: Inventory deduct ──
  // GAP 1.2 + GAP 3: Inventory via transaction table — audit trail + cegah negatif
  const deductInventory = async (materials, orderId, reportId, customerName, teknisiName, jobDate) => {
    for (const mat of materials) {
      // Match by code (spesifik) dulu. Fallback nama: HANYA exact atau kandidat tunggal (unambiguous)
      // — hindari fuzzy 2-arah lama (mis. "Pipa" nyangkut ke pipa 1PK padahal 2PK, atau salah item).
      let item;
      if (mat._useCode) {
        item = inventoryData.find(i => i.code === mat._useCode);
      } else {
        const q = (mat.nama || "").toLowerCase().trim();
        if (!q) continue;
        const cands = inventoryData.filter(i => (i.name || "").toLowerCase().trim().includes(q));
        item = inventoryData.find(i => (i.name || "").toLowerCase().trim() === q)
          || (cands.length === 1 ? cands[0] : null);
        if (!item) {
          if (cands.length > 1) {
            addAgentLog("STOCK_MATCH_AMBIGUOUS", `Job ${orderId||reportId||"?"} — "${mat.nama}" cocok ${cands.length} item, deduct di-skip (perlu kode spesifik).`, "WARNING");
          }
          continue;
        }
      }
      if (!item) continue;
      const qty = parseFloat(mat.jumlah) || 0;
      if (qty <= 0) continue;
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
      // Freon: qty_actual = null (belum ditimbang, admin confirm aktual). Non-freon: qty_actual = -qty.
      const isFreon = item.material_type === "freon" ||
        ["r22","r32","r410","freon"].some(k => (item.name||"").toLowerCase().includes(k));
      // INSERT DULU → cek error. Trigger DB yang potong stok. State lokal HANYA diupdate kalau sukses
      // (cegah stok "hilang" di UI tapi DB tak terpotong / drift saat insert gagal).
      const { error: txErr } = await supabase.from("inventory_transactions").insert({
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
      if (txErr) {
        showNotif(`⚠️ Gagal catat pemakaian ${item.name} — stok tidak dipotong.`);
        addAgentLog("STOCK_DEDUCT_FAIL", `Job ${orderId||reportId||"?"} — ${item.name}: insert transaksi gagal (${txErr.message?.slice(0,60)}). Stok tidak dipotong.`, "WARNING");
        continue;
      }
      const newStock = item.stock - qty;
      const newStatus = computeStockStatus(newStock, item.reorder);
      setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, stock: newStock, status: newStatus } : i));
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
  // Wrapper (Fase 3, pola ctx): syncTrackedStock pindah ke lib/trackedStock.
  const syncTrackedStock = (reportId, orderId, newMaterials, customerName, teknisiName, jobDate) => syncTrackedStockLib(reportId, orderId, newMaterials, customerName, teknisiName, jobDate, { addAgentLog, computeStockStatus, currentUser, invUnitsData, inventoryData, isTrackedByCode, isTrackedByName, setInvUnitsData, setInventoryData, supabase });

  // ── GAP 9: Create order (real state mutation) ──
  // Wrapper (Fase 2, pola ctx): createOrder pindah ke lib/createOrder; semua dep
  // dioper via ctx. Dipanggil langsung (createTeamSplit) & dioper ke view sbg prop.
  const createOrder = (form) => createOrderLib(form, {
    supabase, currentUser, showNotif, addAgentLog, auditUserName,
    setOrdersData, setCustomersData, customersData,
    insertOrder, updateOrderStatus, invalidateCache,
    findCustomer, sameCustomer, lookupCustomersByPhone, normalizePhone,
    cekTeknisiAvailableDB, hitungJamSelesai, sendDispatchWA,
    validateAddressLength, validateDate, validateNameLength,
    validatePhone, validatePositiveNumber, validateTime,
  });

  // ── createTeamSplit: 1 project maintenance PT dipecah jadi N sub-order paralel ──
  // Tiap tim = 1 pasangan teknisi+helper + subset unit. Semua sub-order share
  // job_group_id = id parent (sub-order pertama). Parent = order dgn id === job_group_id.
  // base: { customer, phone, address, area, service, type, date, time, notes, maintenance_client_id }
  // teams: [{ teknisi, helper, unitIds: [] }]  — minimal 2 tim dgn unit terisi.
  // Return groupId (parent id) atau null jika gagal total.
  // Wrapper (Fase 3, pola ctx): createTeamSplit pindah ke lib/createTeamSplit.
  const createTeamSplit = (arg) => createTeamSplitLib(arg, { addAgentLog, cekTeknisiAvailableDB, hitungJamSelesai, insertOrder, invalidateCache, normalizePhone, setOrdersData, showNotif, supabase });

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

      // Label provider dinamis (bukan hardcode "Minimax 2.5") — ikut provider aktif.
      const _provLabel = llmProvider === "claude" ? "Anthropic Claude" : llmProvider === "minimax" ? "Minimax" : llmProvider === "openai" ? "ChatGPT (OpenAI)" : llmProvider === "groq" ? "Groq" : llmProvider === "ollama" ? "Ollama" : (llmProvider || "LLM");
      showNotif(`✅ ARA Brain berhasil terhubung dengan ${_provLabel}${llmModel ? " (" + llmModel + ")" : ""}!`);
    } catch (e) {
      console.error("[connectAraBrain]", e);
      showNotif("❌ Gagal koneksi brain: " + e.message);
    } finally {
      setAraLoading(false);
    }
  };

  // ── GAP 8: ARA Chat dengan LLM + Tool Calls ──
  // Wrapper (Fase 2, pola ctx): sendToARA pindah ke lib/ara; 70 dep dioper via ctx.
  // Dioper ke AraView sebagai prop — interface tak berubah.
  const sendToARA = (userMsg) => sendToARAImpl(userMsg, {
    BRAIN_MD_DEFAULT, PRICE_LIST, TODAY, _apiHeaders, addAgentLog, appSettings,
    approveInvoice, araBottomRef, araImageData, araImagePreview, araImageType,
    araLoading, araMessages, araSchedulingSuggest, auditUserName, brainMd,
    buildAraContext, bulanIni, cariSlotKosong, cekTeknisiAvailableDB,
    checkInvoiceConsistency, computeStockStatus, currentUser, customersData,
    describeInconsistency, dispatchWA, fetchInventory, findCustomer, fmt,
    getLocalDate, getLocalISOString, insertExpense, insertInvoice, insertOrder,
    invalidateCache, inventoryData, invoiceReminderWA, invoicesData, laporanReports,
    llmApiKey, llmModel, llmProvider, markPaid, normalizeLines, ollamaUrl,
    ordersData, paymentSuggestions, priceListData, safeArr, sameCustomer, sendWA,
    setAraImageData, setAraImagePreview, setAraImageType, setAraInput, setAraLoading,
    setAraMessages, setAuditUser, setCustomersData, setExpensesData, setInventoryData,
    setInvoicesData, setOrdersData, summarize, supabase, teknisiData, updateInvoice,
    updateOrder, updateOrderStatus, waConversations,
  });

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
    { id: "website", icon: "🌐", label: "Konten Website" },
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
    <DashboardView ordersData={ordersData} invoicesData={invoicesData} inventoryData={inventoryData}
      teknisiData={teknisiData} omsetView={omsetView} setOmsetView={setOmsetView} waConversations={waConversations}
      bulanIni={bulanIni} setActiveMenu={setActiveMenu} setInvoiceFilter={setInvoiceFilter} setModalOrder={setModalOrder}
      setWaPanel={setWaPanel} setWaTekTarget={setWaTekTarget} setModalWaTek={setModalWaTek}
      getTechColor={getTechColor} triggerRekapHarian={triggerRekapHarian} openLaporanModal={openLaporanModal} openBAPModal={openBAPModal} bapEnabled={appSettings?.bap_enabled === "true"}
      openMaterialBringModal={openMaterialBringModal} openJobReport={openJobReport} materialsBroughtMap={materialsBroughtMap}
      sendWA={sendWA} dispatchWA={dispatchWA}
      setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      customersData={customersData} laporanReports={laporanReports} findCustomer={findCustomer}
      setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab}
      expensesData={expensesData} apiHeaders={_apiHeaders} />
    );
  };

  // ============================================================
  // RENDER CUSTOMERS
  // ============================================================
  const renderCustomers = () => (
    <CustomersView selectedCustomer={selectedCustomer} setSelectedCustomer={setSelectedCustomer} ordersData={ordersData}
      laporanReports={laporanReports} invoicesData={invoicesData} customersData={customersData} setCustomersData={setCustomersData}
      searchCustomer={searchCustomer} setSearchCustomer={setSearchCustomer} customerPage={customerPage} setCustomerPage={setCustomerPage}
      customerTab={customerTab} setCustomerTab={setCustomerTab}
      setNewCustomerForm={setNewCustomerForm} setModalAddCustomer={setModalAddCustomer} setNewOrderForm={setNewOrderForm} setModalOrder={setModalOrder}
      setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      buildCustomerHistory={buildCustomerHistory} openWA={openWA}
      deleteCustomer={deleteCustomer} updateCustomer={updateCustomer} fotoSrc={fotoSrc} safeArr={safeArr}
      CUST_PAGE_SIZE={CUST_PAGE_SIZE} downloadServiceReportPDF={downloadServiceReportPDF} />
  );

  // ============================================================
  // RENDER ORDERS
  // ============================================================
  const renderOrderInbox = () => (
    <OrderInboxView
      ordersData={ordersData} setOrdersData={setOrdersData}
      customersData={customersData} setCustomersData={setCustomersData} teknisiData={teknisiData}
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
      invoicePage={invoicePage} setInvoicePage={setInvoicePage}
      invoiceFilter={invoiceFilter} setInvoiceFilter={setInvoiceFilter} searchInvoice={searchInvoice} invoiceDateFrom={invoiceDateFrom} setInvoiceDateFrom={setInvoiceDateFrom} invoiceDateTo={invoiceDateTo} setInvoiceDateTo={setInvoiceDateTo}
      setSearchInvoice={setSearchInvoice} setSelectedInvoice={setSelectedInvoice} setModalPDF={setModalPDF}
      setEditInvoiceData={setEditInvoiceData} setEditInvoiceForm={setEditInvoiceForm} setEditJasaItems={setEditJasaItems}
      setEditInvoiceItems={setEditInvoiceItems} setModalEditInvoice={setModalEditInvoice}
      ordersData={ordersData} setOrdersData={setOrdersData} setActiveMenu={setActiveMenu} setAuditModal={setAuditModal}
      invoiceReminderWA={invoiceReminderWA} mergedInvoiceWA={mergedInvoiceWA} createConsolidatedInvoice={createConsolidatedInvoice} previewMergedInvoicePDF={previewMergedInvoicePDF} approveInvoice={approveInvoice} markPaid={markPaid}
      markInvoicePaid={markInvoicePaid} revertInvoicePaid={revertInvoicePaid} updateOrderStatus={updateOrderStatus} deleteInvoice={deleteInvoice} updateInvoice={updateInvoice}
      getLocalDate={getLocalDate} parseMD={parseMD} jasaSvcNames={jasaSvcNames} downloadRekapHarian={downloadRekapHarian}
      INV_PAGE_SIZE={INV_PAGE_SIZE}
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
      inventoryPage={inventoryPage} setInventoryPage={setInventoryPage}
      setModalStok={setModalStok} setEditStokItem={setEditStokItem}
      setModalEditStok={setModalEditStok} setInventoryData={setInventoryData}
      setModalRestock={setModalRestock} setRestockItem={setRestockItem} />
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
      teknisiData={teknisiData} weekOffset={weekOffset} setWeekOffset={setWeekOffset}
      scheduleView={scheduleView} setScheduleView={setScheduleView} filterTeknisi={filterTeknisi} setFilterTeknisi={setFilterTeknisi}
      calLaporanFilter={calLaporanFilter} setCalLaporanFilter={setCalLaporanFilter} searchSchedule={searchSchedule} setSearchSchedule={setSearchSchedule}
      schedListFilter={schedListFilter} setSchedListFilter={setSchedListFilter} schedPage={schedPage} setSchedPage={setSchedPage}
      setModalOrder={setModalOrder} setSelectedCustomer={setSelectedCustomer} setCustomerTab={setCustomerTab} setActiveMenu={setActiveMenu}
      setEditOrderItem={setEditOrderItem} setEditOrderForm={setEditOrderForm} setModalEditOrder={setModalEditOrder}
      setHistoryPreview={setHistoryPreview} setWaTekTarget={setWaTekTarget} setModalWaTek={setModalWaTek}
      getTechColor={getTechColor} dispatchStatus={dispatchStatus} sendDispatchWA={sendDispatchWA} dispatchWA={dispatchWA}
      deleteOrder={deleteOrder}
      openWA={openWA} openLaporanModal={openLaporanModal}
      openJobReport={openJobReport} materialsBroughtMap={materialsBroughtMap}
      sendWA={sendWA} updateOrderStatus={updateOrderStatus}
      hitungJamSelesai={hitungJamSelesai} downloadRekapHarian={downloadRekapHarian} triggerRekapHarian={triggerRekapHarian}
      SCHED_PAGE_SIZE={SCHED_PAGE_SIZE} getLocalDate={getLocalDate} userAccounts={userAccounts}
      uploadServiceReportPDFForWA={uploadServiceReportPDFForWA} invoicesData={invoicesData} setLaporanReports={setLaporanReports} />
  );


  // ============================================================
  // RENDER TEKNISI ADMIN
  // ============================================================
  const renderTeknisiAdmin = () => (
    <TeknisiAdminView teknisiData={teknisiData} setTeknisiData={setTeknisiData} ordersData={ordersData} laporanReports={laporanReports}
      setEditTeknisi={setEditTeknisi} setNewTeknisiForm={setNewTeknisiForm}
      setModalTeknisi={setModalTeknisi} openWA={openWA}
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

      // Query langsung ke Supabase — bukan state lokal.
      // Cek SEMUA peran (teknisi/teknisi2/3 + helper/helper2/3): orang yang jadi helper di job lain
      // pada jam bentrok juga harus terdeteksi (cegah dobel-booking lintas-peran). '.or()' aman utk
      // nama tanpa koma; sanitasi koma jaga-jaga.
      const safeName = String(teknisiName || "").replace(/,/g, " ");
      const { data: dbOrders, error } = await supabase
        .from("orders")
        .select("id, time, time_end, service, units, status")
        .or(["teknisi", "teknisi2", "teknisi3", "helper", "helper2", "helper3"].map(col => `${col}.eq.${safeName}`).join(","))
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
      teknisiData={teknisiData} inventoryData={inventoryData}
      statsPeriod={statsPeriod} setStatsPeriod={setStatsPeriod} statsMingguOff={statsMingguOff} setStatsMingguOff={setStatsMingguOff}
      statsDateFrom={statsDateFrom} setStatsDateFrom={setStatsDateFrom} statsDateTo={statsDateTo} setStatsDateTo={setStatsDateTo}
      bulanIni={bulanIni} invoiceReminderWA={invoiceReminderWA} getTechColor={getTechColor}
      expensesData={expensesData} />
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
      setModalStok={setModalStok} fetchInventoryUnits={fetchInventoryUnits} setInventoryData={setInventoryData} computeStockStatus={computeStockStatus} appSettings={appSettings} />
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
      insertExpense={insertExpense} updateExpense={updateExpense} deleteExpense={deleteExpense}
      setAuditModal={setAuditModal} EXPENSE_PAGE_SIZE={EXPENSE_PAGE_SIZE}
      appSettings={appSettings} setAppSettings={setAppSettings}
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
            setOrdersData={setOrdersData} ordersData={ordersData}
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
          <CommissionPinModal
            commissionUnlocked={commissionUnlocked} livePin={livePin}
            commissionPinAttempt={commissionPinAttempt} commissionPinError={commissionPinError}
            handleCommissionPinSubmit={handleCommissionPinSubmit}
            setCommissionPinAttempt={setCommissionPinAttempt} setCommissionPinError={setCommissionPinError}
            setCommissionUnlocked={setCommissionUnlocked} setActiveMenu={setActiveMenu}
          />
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
      case "website": return (
        <Suspense fallback={<div style={{ color: cs.muted, padding: 20 }}>Memuat...</div>}>
          <WebsiteContentView
            currentUser={currentUser} supabase={supabase}
            showNotif={showNotif} showConfirm={showConfirm}
            _apiFetch={_apiFetch} _apiHeaders={_apiHeaders}
          />
        </Suspense>
      );
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

  // ── Laporan modal handlers (diekstrak dari IIFE render — Tahap 1 refactor) ──
  // Logika murni level-komponen; incompleteUnits dihitung ulang di dalam submitLaporan.
  // Wrapper (Fase 3, pola ctx): handleFotoUpload pindah ke lib/fotoUpload.
  const handleFotoUpload = (e) => handleFotoUploadLib(e, { _apiFetch, _apiHeaders, appSettings, compressImg, currentUser, fotoTargetUnitRef, fotoUnitInputRef, laporanFotos, laporanModal, setLaporanFotos, showNotif });

  // Wrapper (Fase 3, pola ctx): submitLaporan (jalur uang) pindah ke lib/submitLaporan.
  const submitLaporan = () => submitLaporanImpl({
    INSTALL_ITEMS, _apiHeaders, addAgentLog, appSettings, auditUserName, buildInvoiceDetail,
    checkInvoiceConsistency, classifyMaterial, currentUser, customersData, deductInventory,
    deleteInvoice, describeInconsistency, fmt, hargaPerUnitFromTipe, hitungLabor,
    hitungMaterialTotal, insertInvoice, inventoryData, invoicesData, isTrackedByCode,
    isTrackedByName, isUnitDone, laporanBarangItems, laporanCatatan, laporanCleaningInRepair,
    laporanFotos, laporanInstallItems, laporanJasaItems, laporanMaterials, laporanModal,
    laporanRekomendasi, laporanRepairItems, laporanRepairType, laporanSurveyCatatan,
    laporanSurveyHasil, laporanUnits, lookupHargaGlobal, multiDayProjectKey, normalizeLines,
    normalizePhone, ordersData, priceListData, pushNotif, quotationsData,
    refreshMaterialsBroughtMap, reportError, resolveMultiDayInvoiceAction, safeArr,
    seedAcRegistry, sendWA, setInvoicesData, setLaporanModal, setLaporanReports,
    setLaporanSubmitted, setOrdersData, setQuotationsData, setTeknisiData, showConfirm,
    showNotif, submitLaporanLock, summarize, supabase, syncTrackedStock, teknisiData,
    updateOrderStatus, userAccounts,
  });

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
      </Suspense>


      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT INVOICE (GAP 3) */}
      {/* ══════════════════════════════════════════════════════ */}
      {/* ══ MODAL HISTORY PREVIEW — Teknisi view-only ══ */}
      <Suspense fallback={null}>
        <CustomerHistoryModal
          customer={historyPreview}
          onClose={() => setHistoryPreview(null)}
          ordersData={ordersData}
          laporanReports={laporanReports}
          invoicesData={invoicesData}
          customersData={customersData}
          fotoSrc={fotoSrc}
        />
      </Suspense>

      {/* ══ CONFIRM MODAL — ganti semua window.confirm() ══ */}
      <ConfirmModal confirmModal={confirmModal} />

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
      <Suspense fallback={null}>
        <WaPanel
          open={waPanel}
          onClose={() => setWaPanel(false)}
          waSearch={waSearch} setWaSearch={setWaSearch}
          waConversations={waConversations} setWaConversations={setWaConversations}
          selectedConv={selectedConv} setSelectedConv={setSelectedConv}
          waMessages={waMessages} setWaMessages={setWaMessages}
          waInput={waInput} setWaInput={setWaInput}
          customersData={customersData} setCustomersData={setCustomersData}
          ordersData={ordersData}
          waProvider={waProvider} isMobile={isMobile} currentUser={currentUser}
          supabase={supabase} showNotif={showNotif} sendWA={sendWA}
          addAgentLog={addAgentLog} setActiveMenu={setActiveMenu}
        />
      </Suspense>

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
            materialConfirmDeductOn={appSettings?.material_confirm_deduct_enabled === "true"}
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
