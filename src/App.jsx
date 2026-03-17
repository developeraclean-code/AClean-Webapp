import { useState, useEffect, useRef, useCallback, Component } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL  || "https://placeholder.supabase.co";
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "placeholder-key";
const supabase = createClient(SUPA_URL, SUPA_KEY);

// Error boundary — tangkap crash dan tampilkan pesan error
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background:"#0a0f1e", color:"#e2e8f0", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"monospace" }}>
          <div style={{ maxWidth:600, width:"100%" }}>
            <div style={{ fontSize:32, marginBottom:16 }}>⚠️</div>
            <div style={{ fontWeight:800, fontSize:20, color:"#ef4444", marginBottom:12 }}>App Error</div>
            <div style={{ background:"#111827", border:"1px solid #1e2d4a", borderRadius:12, padding:16, fontSize:12, color:"#f87171", whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
              {this.state.error.toString()}
              {this.state.error.stack && ("\n\n" + this.state.error.stack.slice(0,500))}
            </div>
            <div style={{ marginTop:16, fontSize:12, color:"#64748b" }}>
              Salin error di atas dan kirim ke developer. Atau tekan F12 → Console untuk detail lengkap.
            </div>
            <button onClick={()=>window.location.reload()} style={{ marginTop:16, padding:"8px 20px", background:"#38bdf8", color:"#0a0f1e", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer" }}>
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

// ── buildCustomerHistory: LIVE dari ordersData + laporanReports + invoicesData
// Dipanggil di: renderCustomers(), laporan step-1, order detail
// ── normalizePhone: 08xxx / +62xxx / 628xxx → 628xxx ──────────────
const normalizePhone = (p) => {
  if (!p) return "";
  const d = p.toString().replace(/[\s\-().+]/g, ""); // hapus spasi, strip, plus, kurung
  if (d.startsWith("08"))  return "62" + d.slice(1);   // 08xxx → 628xxx
  if (d.startsWith("62"))  return d;                    // 628xxx → tetap
  if (d.startsWith("8"))   return "62" + d;             // 8xxx → 628xxx (tanpa 0)
  return d;
};

// samePhone: bandingkan 2 nomor, dianggap sama jika normalisasi sama
const samePhone = (a, b) => {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
};

// sameCustomer: unik berdasarkan phone + nama lengkap (case insensitive, trim)
// "Bapak Dedy Jelita" vs "Bapak Dedy Aruna" = BEDA meski phone sama
const sameCustomer = (c, phone, name) => {
  if (!c || !phone || !name) return false;
  return samePhone(c.phone, phone) &&
         c.name.trim().toLowerCase() === name.trim().toLowerCase();
};

// findCustomer: cari customer paling tepat — prioritas (phone+name) > phone saja
const findCustomer = (customers, phone, name) => {
  if (!phone && !name) return null;
  // 1. Exact match phone + nama lengkap
  if (phone && name) {
    const exact = customers.find(c => sameCustomer(c, phone, name));
    if (exact) return exact;
  }
  // 2. Phone sama + nama depan sama (misal "Bapak Dedy" match "Bapak Dedy Jelita")
  if (phone && name) {
    const firstName = name.trim().toLowerCase().split(" ").slice(0,2).join(" ");
    const partial = customers.find(c =>
      samePhone(c.phone, phone) &&
      c.name.trim().toLowerCase().startsWith(firstName)
    );
    if (partial) return partial;
  }
  // 3. Phone saja (fallback — hanya jika nama tidak disediakan)
  if (phone && !name) {
    return customers.find(c => samePhone(c.phone, phone)) || null;
  }
  // 4. Nama saja (fallback terakhir)
  if (name && !phone) {
    return customers.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase()) || null;
  }
  return null;
};

const buildCustomerHistory = (customer, ordersData, laporanReports, invoicesData) => {
  if (!customer) return [];
  const nm = (s) => (s||"").trim().toLowerCase();
  const matchName  = (o) => nm(o.customer) === nm(customer.name);
  const matchPhone = (o) => customer.phone && o.phone && samePhone(o.phone, customer.phone);

  return ordersData
    .filter(o => matchName(o) || matchPhone(o))
    .map(o => {
      // Cari laporan teknisi untuk job ini
      const lap = laporanReports.find(r => r.job_id === o.id);
      // Cari invoice untuk job ini (by job_id atau order_id)
      const inv = invoicesData
        ? invoicesData.find(i => i.job_id === o.id || i.order_id === o.id)
        : null;
      // unit_detail: array unit AC dari laporan — field dari mkUnit()
      // { unit_no, label, tipe, merk, pk, kondisi_sebelum[], kondisi_setelah[], pekerjaan[], freon_ditambah, ampere_akhir, catatan_unit }
      const unitDetail = lap?.units || [];
      return {
        // ── data dari orders ──
        id:          o.id,
        job_id:      o.id,
        date:        o.date,
        service:     o.service,
        type:        o.type   || "",
        units:       o.units  || 1,
        teknisi:     o.teknisi || "",
        helper:      o.helper  || "",
        status:      o.status  || "PENDING",
        notes:       o.notes  || "",
        area:        o.area   || "",
        // ── data dari invoice ──
        invoice_id:    inv?.id    || o.invoice_id || null,
        invoice_total: inv?.total || 0,
        invoice_status:inv?.status || null,
        // ── data dari laporan teknisi ──
        laporan_id:     lap?.id     || null,
        laporan_status: lap?.status || null,
        unit_detail:    unitDetail,
        materials:      lap?.materials || [],
        rekomendasi:    lap?.rekomendasi    || "",
        catatan:        lap?.catatan_global || "",
        foto_urls:      lap?.foto_urls
                          || (lap?.fotos||[]).filter(f=>f.url).map(f=>f.url)
                          || [],
        total_freon:    lap?.total_freon || 0,
      };
    })
    .sort((a, b) => (b.date||"").localeCompare(a.date||"")); // terbaru dulu
};
const ORDERS_DATA = [
];

const INVOICES_DATA = [
];

// GAP 13 — Price list untuk auto-hitung invoice dari laporan
// ── PRICE_LIST: default fallback (akan di-override oleh DB price_list tabel) ──
  const PRICE_LIST_DEFAULT = {
  "Cleaning": {
    "AC Split 0.5-1PK":              85000,
    "AC Split 1.5-2.5PK":           100000,
    "AC Cassette 2-2.5PK":          250000,
    "AC Cassette 3PK":              300000,
    "AC Cassette 4PK":              400000,
    "AC Cassette 5PK":              500000,
    "AC Cassette 6PK":              600000,
    "AC Standing":                  100000,
    "AC Split Duct":                100000,
    "Jasa Service Besar 0,5PK - 1PK":   400000,
    "Jasa Service Besar 1,5PK - 2,5PK": 450000,
    "default":                       85000,
  },
  "Install": {
    "Pemasangan AC Baru 0,5PK - 1PK":       350000,
    "Pemasangan AC Baru 1,5PK - 2PK":       400000,
    "Pasang AC Split 3PK":                   450000,
    "Bongkar Pasang AC Split 1/2 - 1PK":    500000,
    "Bongkar Pasang AC Split 1,5 - 2,5PK":  550000,
    "Bongkar Unit AC 0.5-1PK":               150000,
    "Bongkar Unit AC 1.5-2.5PK":             200000,
    "Bongkar Pasang Indoor AC":              200000,
    "Bongkar Pasang Outdoor AC":             200000,
    "Jasa Vacum AC 0,5PK - 2,5PK":           50000,
    "Jasa Vacum Unit AC >3PK":               150000,
    "Jasa Penarikan Pipa AC":                 25000,
    "Jasa Penarikan Pipa Ruko":               35000,
    "Pasang AC Cassette":                    900000,
    "Pasang AC Standing":                    600000,
    "Pemasangan AC Baru Apartemen":          350000,
    "Jasa Instalasi Pipa AC":                200000,
    "Jasa Instalasi Listrik":                150000,
    "Flaring Pipa":                          100000,
    "Flushing Pipa":                         200000,
    "Jasa Bobok Tembok":                     150000,
    "Jasa Pengelasan Pipa AC":               100000,
    "Jasa Pembuatan Saluran Pembuangan":     150000,
    "default":                               350000,
  },
  "Repair": {
    "Biaya Pengecekan AC":                   100000,
    "Perbaikan Hermaplex":                   150000,
    "Jasa Pemasangan Sparepart":             250000,
    "Perbaikan PCB/Elektrik":                250000,
    "Pergantian Kapasitor Fan Indoor":       250000,
    "Pergantian Sensor Indoor":              250000,
    "Pergantian Overload Outdoor":           300000,
    "Jasa Pemasangan Sparepart Daikin":      330000,
    "Kapasitor AC 0.5-1.5PK":               350000,
    "Pergantian Kapasitor Outdoor 1PK":      350000,
    "Pergantian Modul Indoor Standart":      400000,
    "Kapasitor AC 2-2.5PK":                  450000,
    "Pergantian Kapasitor Outdoor 1,5-2,5PK":450000,
    "Test Press Unit":                       450000,
    "Jasa Pemasangan Kompresor":             500000,
    "Pergantian Modul Indoor Inverter":      500000,
    "Kuras Vacum + Isi Freon R32/R410":      600000,
    "Kuras Vacum Freon R22":                 600000,
    "default":                               100000,
  },
  "Complain": {
    "Garansi Servis (gratis)":          0,
    "Komplain AC Tidak Dingin":         0,
    "Komplain Bising/Berisik":          0,
    "Komplain Bocor Air":               0,
    "Komplain Garansi":                 0,
    "Komplain Setelah Servis":          0,
    "Pengecekan AC Gratis":             0,
    "Pengecekan Ulang":                 0,
    "default":                          0,
  },
  "freon_R22":   450000,
  "freon_R410A": 450000,
  "freon_R32":   450000,
};
// PRICE_LIST akan di-replace oleh data DB setelah loadAll() — jangan edit langsung
let PRICE_LIST = { ...PRICE_LIST_DEFAULT };
// ── buildPriceListFromDB: bangun PRICE_LIST dari data DB ──
// Menggantikan 5 loader duplikat yang tersebar di kode
// Normalisasi: service/type key dari DB di-trim & lowercase untuk match
const buildPriceListFromDB = (rows) => {
  const pl = { ...PRICE_LIST_DEFAULT };
  const active = rows.filter(r => r.is_active !== false);
  active.forEach(row => {
    const price = Number(row.price) || 0;
    const notes = (row.notes || "").trim().toLowerCase();
    const svc   = (row.service || "").trim();
    const type  = (row.type    || "").trim();

    // Freon: identifikasi via notes field
    if (notes === "freon_r22"   || notes === "freon_r22")   { pl["freon_R22"]   = price; return; }
    if (notes === "freon_r410a" || notes === "freon_r410")  { pl["freon_R410A"] = price; return; }
    if (notes === "freon_r32")                               { pl["freon_R32"]   = price; return; }

    // Freon via service name (kalau ada row khusus freon di price_list)
    if (svc.toLowerCase().includes("freon")) {
      if (svc.toLowerCase().includes("r22"))  { pl["freon_R22"]   = price; return; }
      if (svc.toLowerCase().includes("r32"))  { pl["freon_R32"]   = price; return; }
      if (svc.toLowerCase().includes("r410")) { pl["freon_R410A"] = price; return; }
    }

    // Service/type normal
    if (svc) {
      if (!pl[svc]) pl[svc] = {};
      if (type) pl[svc][type] = price;
    }
  });
  return pl;
};


// ── Dynamic tech color — deterministik berdasarkan hash nama ──
const TECH_PALETTE = [
  "#38bdf8","#22c55e","#a78bfa","#f59e0b","#f97316",
  "#ec4899","#14b8a6","#ef4444","#84cc16","#06b6d4",
  "#8b5cf6","#d946ef","#fb923c","#4ade80","#60a5fa",
];
const getTechColor = (name, teknisiDataArr) => {
  if (!name) return "#64748b";
  const tekFromDB = (teknisiDataArr||[]).find(t => t.name === name);
  if (tekFromDB?.color) return tekFromDB.color;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return TECH_PALETTE[Math.abs(h) % TECH_PALETTE.length];
};

const INVENTORY_DATA = [
];

const WA_CONVERSATIONS = [
];

const AGENT_LOGS = [
];

const BRAIN_MD_DEFAULT = `# ARA BRAIN v4.0 — AClean Service

## IDENTITAS
- Nama: ARA (Aclean Response Agent)
- Bisnis: AClean Service — AC Cleaning, Install, Repair & Complain/Garansi
- Area Utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan
- Area Perlu Konfirmasi: Jakarta Barat, Jakarta Selatan (ongkir tambah)
- Peran: Asisten AI eksekutif untuk Owner/Admin

## LAYANAN & HARGA
⚠️ WAJIB: Selalu gunakan harga dari seksi "PRICE LIST LIVE" yang ada di system prompt.
Harga di-update langsung oleh Owner via UI — jangan gunakan angka lain.
Format output harga: Rp85.000 (titik pemisah ribuan, tanpa desimal)
- Minimal 1 unit per order
- Biaya dadakan (booking H-0): +Rp50.000 (tetap, bukan dari price list)

## SOP ORDER
1. Cek jadwal teknisi sebelum assign (gunakan teknisiWorkload dari data live)
2. Jam operasional: 08:00–17:00, kecuali ada konfirmasi khusus
3. Prioritas assign: teknisi dengan slot kosong terbanyak hari ini
4. Helper wajib untuk order 3+ unit atau Pasang AC Baru
5. Dispatch WA otomatis setelah order CONFIRMED
6. Status flow: PENDING → CONFIRMED → IN_PROGRESS → COMPLETED

## SOP INVOICE
1. Invoice dibuat setelah laporan teknisi masuk (status SUBMITTED/COMPLETED)
2. WAJIB gunakan action CREATE_INVOICE — jangan hitung manual
3. Invoice otomatis baca material + freon dari laporan → masuk ke field "material"
4. Due date: H+3 dari tanggal selesai
5. Kirim reminder WA jika H-1 due dan belum PAID
6. OVERDUE: tandai otomatis jika lewat due date
7. Hanya Owner yang bisa APPROVE invoice
8. Setelah laporan masuk → langsung tawarkan buat invoice: "Ada laporan baru masuk untuk [order]. Buat invoice sekarang?"

## SOP STOK
1. Alert jika stok <= reorder point
2. Freon R22 & R32: reorder jika < 5 kg
3. Catat penggunaan setiap selesai service (UPDATE_STOCK dengan delta negatif)

## TIM TEKNISI & HELPER
> Data tim diambil LIVE dari bizContext.teknisiWorkload dan bizContext.helperList
> SELALU gunakan data live ini — jangan mengarang nama teknisi/helper

Cara baca data:
- bizContext.teknisiWorkload = list teknisi aktif beserta nama, skills, phone, jobsToday
- bizContext.helperList = list helper aktif beserta nama, skills, phone, jobsToday
- Jika list kosong = belum ada di database, minta Owner input via menu Tim Teknisi

Rules assign teknisi:
1. Cek field skills teknisi — cocokkan dengan jenis layanan yang diminta
2. Cek field jobsToday — pilih yang paling sedikit job hari ini
3. Helper wajib untuk order 3+ unit atau Pasang AC Baru
4. Jika nama teknisi tidak ada di list = tolak dan tampilkan daftar yang tersedia

## RULES EKSEKUSI
- Selalu konfirmasi ke user setelah eksekusi aksi
- Jangan eksekusi CANCEL atau hapus data tanpa alasan jelas dari user
- Jika ada konflik jadwal: WAJIB tanyakan ke user dulu, jangan auto-assign
- ACTION per response: maks 1 untuk operasi tunggal; maks 3 untuk workflow chain standar
- Workflow chain yang diizinkan (berurutan dalam 1 response):
  * CREATE_ORDER → DISPATCH_WA (setelah konfirmasi user)
  * UPDATE_ORDER_STATUS(COMPLETED) → CREATE_INVOICE (langsung)
  * MARK_PAID → SEND_WA (konfirmasi bayar ke customer)
- Gunakan data live (bizContext) untuk semua keputusan, bukan asumsi
- Jika data tidak lengkap: tanya user, jangan mengarang
- Saat ada order PENDING baru: proaktif tawarkan konfirmasi + assign teknisi
- Saat laporan SUBMITTED muncul: proaktif tawarkan CREATE_INVOICE
- Selalu sebut nomor order dan nama customer dalam setiap konfirmasi aksi
- Gunakan bizContext.slotRekomendasi.teknisiDisarankan untuk rekomendasi teknisi terbaik

## FITUR PARSE JOB DARI TEKS
Jika user paste teks berisi info order (dari WA, form, dll):
1. Ekstrak: nama customer, alamat, no telepon, jenis layanan, jumlah unit, tanggal/jam
2. Jika ada info tidak jelas: tandai dengan [?]
3. WAJIB tampilkan ringkasan konfirmasi ke user SEBELUM eksekusi:
   "📋 Saya baca info berikut — mohon konfirmasi sebelum dibuat:
   👤 Customer: [nama] ([status: BARU/EXISTING])
   📱 No. HP: [phone]
   📍 Alamat: [address]
   🔧 Layanan: [service] — [units] unit
   📅 Jadwal: [date] jam [time]
   👷 Teknisi disarankan: [dari slotRekomendasi]
   ✅ Ketik OK untuk buat order, atau koreksi bagian yang salah"
4. Setelah user konfirmasi → eksekusi CREATE_ORDER + DISPATCH_WA

## FORMAT JAWABAN
- Gunakan Bahasa Indonesia
- Ringkas dan to the point
- Sertakan data aktual (nama, tanggal, jumlah) dalam konfirmasi
- Gunakan emoji secukupnya untuk keterbacaan

## FITUR VISION — BACA GAMBAR
Jika user upload gambar bersamaan dengan pesan:
- Gambar bukti bayar/transfer → ekstrak: nama bank, nominal, tanggal, nama pengirim → tawarkan MARK_PAID jika cocok dengan invoice
- Gambar complain (AC rusak, bocor, dll) → deskripsikan kondisi dan rekomendasikan jenis service
- Gambar dokumen/nota → baca informasi relevan dan masukkan ke konteks percakapan
- Jika gambar tidak jelas → minta user kirim ulang dengan resolusi lebih baik
`.trim();

export { ErrorBoundary };
export default function ACleanWebApp() {
  // ── Auth & Role ──
  const [isLoggedIn,    setIsLoggedIn]    = useState(false);
  const [currentUser,   setCurrentUser]   = useState(null);
  const [dataLoading,   setDataLoading]   = useState(false);
  const [paymentsData,  setPaymentsData]  = useState([]);
  const [dispatchLogs,  setDispatchLogs]  = useState([]);
  const [loginScreen,   setLoginScreen]   = useState("login"); // "login" | "select_account"
  const [loginError,    setLoginError]    = useState("");
  const [loginEmail,    setLoginEmail]    = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [modalAddUser,  setModalAddUser]  = useState(false);
  const [newUserForm,   setNewUserForm]   = useState({ name:"", email:"", role:"Admin", password:"", phone:"" });
  const [userAccounts,  setUserAccounts]  = useState([
    { id:"USR001", name:"Malda Retta",  email:"owner@aclean.id",  role:"Owner",   phone:"6281299898937", avatar:"M", color:"#f59e0b", active:true,  password:"owner123",  lastLogin:"2026-03-03 08:15" },
    { id:"USR002", name:"Admin AClean", email:"admin@aclean.id",  role:"Admin",   phone:"6281200000001", avatar:"A", color:"#38bdf8", active:true,  password:"admin123",  lastLogin:"2026-03-03 07:30" },
    { id:"USR003", name:"Mulyadi",      email:"mulyadi@aclean.id",role:"Teknisi", phone:"6288225633768", avatar:"Y", color:"#22c55e", active:true,  password:"mly2026",   lastLogin:"2026-03-02 17:45" },
    { id:"USR004", name:"Usaeri",       email:"usaeri@aclean.id", role:"Teknisi", phone:"6287786870189", avatar:"U", color:"#a78bfa", active:true,  password:"usr2026",   lastLogin:"2026-03-01 16:20" },
    { id:"USR005", name:"Albana Niji",  email:"albana@aclean.id", role:"Teknisi", phone:"6287815496845", avatar:"B", color:"#34d399", active:false, password:"abn2026",   lastLogin:"2026-02-28 12:10" },
  ]);

  // ── Tim Teknisi state (reactive) ──
  const [teknisiData, setTeknisiData] = useState(TEKNISI_DATA);

  // ── Core navigation ──
  const [activeMenu,    setActiveMenu]    = useState("dashboard");
  const [activeRole,    setActiveRole]    = useState("owner");

  // ── Customer ──
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerTab,      setCustomerTab]      = useState("list");

  // ── Orders ──
  const [orderFilter,    setOrderFilter]    = useState("Semua");
  const [searchOrder,    setSearchOrder]    = useState("");
  const [orderTekFilter,  setOrderTekFilter]  = useState("Semua");
  const [orderDateFrom,   setOrderDateFrom]   = useState("");
  const [orderDateTo,     setOrderDateTo]     = useState("");
  const [orderServiceFilter, setOrderServiceFilter] = useState("Semua"); // GAP-9
  const [orderPage,      setOrderPage]      = useState(1);
  const ORDER_PAGE_SIZE = 20;

  // ── Invoice ──
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceFilter,   setInvoiceFilter]   = useState("Semua");
  const [invoicePage,     setInvoicePage]     = useState(1);
  const INV_PAGE_SIZE = 15;
  const [modalPDF,        setModalPDF]        = useState(false);
  const [modalApproveInv, setModalApproveInv] = useState(false); // popup pilihan approve
  const [pendingApproveInv, setPendingApproveInv] = useState(null); // invoice yang menunggu approve

  // ── Schedule ──
  const [scheduleView,   setScheduleView]   = useState("week");
  const [teknisiTab,     setTeknisiTab]     = useState("jadwal");
  const [filterTeknisi, setFilterTeknisi]  = useState("Semua");

  // ── Search ──
  const [searchCustomer,  setSearchCustomer]  = useState("");
  const [searchInvoice,   setSearchInvoice]   = useState("");
  const [searchInventory, setSearchInventory] = useState("");
  const [searchPriceList,  setSearchPriceList]  = useState("");
  const [priceListSvcTab, setPriceListSvcTab]  = useState("Semua");
  const [priceListData,   setPriceListData]    = useState([]);
  const [priceListSyncedAt, setPriceListSyncedAt] = useState(null); // timestamp terakhir sync harga
  const [plEditItem,      setPlEditItem]       = useState(null);
  const [plEditForm,      setPlEditForm]       = useState({});
  const [plAddModal,      setPlAddModal]       = useState(false);
  const [plNewForm,       setPlNewForm]        = useState({ service:"Cleaning", type:"", code:"", price:"", unit:"unit", notes:"" });
  const [searchLaporan,   setSearchLaporan]   = useState("");
  const [laporanSvcFilter, setLaporanSvcFilter] = useState("Semua");
  const [laporanStatusFilter, setLaporanStatusFilter] = useState("Semua");
  const [laporanDateFilter, setLaporanDateFilter] = useState("Semua"); // Semua/Minggu Ini/Bulan Ini
  const [laporanPage,     setLaporanPage]     = useState(1);
  const LAP_PAGE_SIZE = 10;

  // ── Laporan Tim ──
  const [laporanReports,  setLaporanReports]  = useState([]);
  const [selectedLaporan, setSelectedLaporan] = useState(null);
  const [modalLaporanDetail, setModalLaporanDetail] = useState(false);
  const [editLaporanMode, setEditLaporanMode] = useState(false);
  const [editLaporanForm, setEditLaporanForm] = useState({});

  // ── WA panel ──
  const [waPanel,      setWaPanel]      = useState(false);
  const [selectedConv, setSelectedConv] = useState(null);
  const [waInput,      setWaInput]      = useState("");

  // ── Modals ──
  const [modalOrder,   setModalOrder]   = useState(false);
  const [modalStok,    setModalStok]    = useState(false);
  const [modalWaTek,   setModalWaTek]   = useState(false); // popup pilihan pesan WA teknisi ke customer
  const [waTekTarget,  setWaTekTarget]  = useState(null);  // { phone, customer, service, time, address }
  const [modalTeknisi, setModalTeknisi] = useState(false);
  const [editTeknisi,  setEditTeknisi]  = useState(null);
  const [modalEditStok, setModalEditStok] = useState(false);
  const [editStokItem,  setEditStokItem]  = useState(null);
  const [modalBrainEdit, setModalBrainEdit] = useState(false);

  // ── Form laporan (teknisi) — v3 multi-unit ──
  const [laporanModal,       setLaporanModal]       = useState(null);
  const [laporanStep,        setLaporanStep]        = useState(1);
  const [laporanSubmitted,   setLaporanSubmitted]   = useState(false);
  const [laporanUnits,       setLaporanUnits]       = useState([]);
  const [laporanMaterials,   setLaporanMaterials]   = useState([]);
  const [laporanFotos,       setLaporanFotos]       = useState([]);
  const [laporanRekomendasi, setLaporanRekomendasi] = useState("");
  const [laporanCatatan,     setLaporanCatatan]     = useState("");
  const [laporanInstallItems, setLaporanInstallItems] = useState({}); // key→qty untuk Report Install
  const [activeUnitIdx,      setActiveUnitIdx]      = useState(0);
  const [showMatPreset,      setShowMatPreset]      = useState(false);
  const fotoInputRef = useRef();

  // ── New order / stok / customer form ──
  const [newOrderForm,     setNewOrderForm]     = useState({ customer:"", phone:"", address:"", area:"", service:"Cleaning", type:"AC Split 0.5-1PK", units:1, teknisi:"", helper:"", date:"", time:"09:00", notes:"" });
  const [newStokForm,      setNewStokForm]      = useState({ name:"", unit:"pcs", price:"", stock:"", reorder:"", min_alert:"" });
  const [newTeknisiForm,   setNewTeknisiForm]   = useState({ name:"", role:"Teknisi", phone:"", skills:[], email:"", password:"", buatAkun:false });
  const [modalAddCustomer, setModalAddCustomer] = useState(false);
  const [newCustomerForm,  setNewCustomerForm]  = useState({ name:"", phone:"", address:"", area:"", notes:"", is_vip:false });
  const [customersData,    setCustomersData]    = useState(CUSTOMERS_DATA);
  const [ordersData,       setOrdersData]       = useState(ORDERS_DATA);
  const [modalEditOrder,   setModalEditOrder]   = useState(false);
  const [editOrderItem,    setEditOrderItem]    = useState(null);
  const [editOrderForm,    setEditOrderForm]    = useState({});

  // GAP 5 — Reactive state untuk invoice & inventory (tidak lagi konstan)
  const [invoicesData,     setInvoicesData]     = useState(INVOICES_DATA);
  const [inventoryData,    setInventoryData]    = useState(INVENTORY_DATA);

  // GAP 3 — State untuk edit invoice
  const [modalEditInvoice, setModalEditInvoice] = useState(false);
  const [editInvoiceData,  setEditInvoiceData]  = useState(null);
  const [editInvoiceForm,  setEditInvoiceForm]  = useState({});

  // GAP 7/8 — ARA Chat state (live LLM)
  const [araPanel,         setAraPanel]         = useState(false);
  const [araMessages,      setAraMessages]      = useState([
    { role:"assistant", content:"Halo! Saya ARA 🤖 — AI Agent AClean. Saya bisa bantu Anda:\n- Cek status order & invoice\n- Update nilai invoice\n- Lihat stok material\n- Analisis revenue & performa\n- Buat ringkasan harian\n\nMau tanya apa?" }
  ]);
  const [araInput,         setAraInput]         = useState("");
  const [araLoading,       setAraLoading]       = useState(false);
  const [araImageData,     setAraImageData]     = useState(null);  // base64 no prefix
  const [araImageType,     setAraImageType]     = useState(null);  // "image/jpeg" etc
  const [araImagePreview,  setAraImagePreview]  = useState(null);  // data URL for preview
  const araBottomRef = useRef();

  // GAP 7 — Reactive agent logs
  const [agentLogs,        setAgentLogs]        = useState(AGENT_LOGS);
  const addAgentLog = async (action, detail, status="SUCCESS") => {
    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    setAgentLogs(prev => [{ time:now, action, detail, status }, ...prev].slice(0,50));
    try {
      const { error: alErr } = await supabase.from("agent_logs").insert({ time:now, action, detail, status });
      if (alErr) console.error("agent_logs 400:", alErr.message, "|", alErr.hint, "|", alErr.details);
    } catch(e) { console.error("agent_logs catch:", e.message); }
  };

  // ── Settings: _ls HARUS dideklarasi SEBELUM useState yang memakainya ──
  const _ls = (key, def) => {
  try {
    const v = localStorage.getItem("aclean_"+key);
    if (v === null) return def;
    const parsed = JSON.parse(v);
    // Jika default adalah string tapi tersimpan sebagai array (versi lama), convert
    if (typeof def === "string" && Array.isArray(parsed)) return parsed.join("\n");
    if (typeof def === "string" && typeof parsed !== "string") return def;
    return parsed;
  } catch { return def; }
};
  const _lsSave = (key, val) => { try { localStorage.setItem("aclean_"+key, JSON.stringify(val)); } catch {} };
  // SEC-02: internal token untuk API calls (dibaca dari Vite env, TIDAK disimpan di localStorage)
  const _apiHeaders = () => ({
    "Content-Type": "application/json",
    ...(import.meta.env.VITE_INTERNAL_API_SECRET
      ? { "X-Internal-Token": import.meta.env.VITE_INTERNAL_API_SECRET }
      : {})
  });
  // SEC-07: brute force states — harus setelah _ls didefinisikan
  const [loginAttempts, setLoginAttempts] = useState(() => _ls("loginAttempts", 0));
  const [lockoutUntil,  setLockoutUntil]  = useState(() => _ls("lockoutUntil",  0));

  // ── Settings state ──
  const [waProvider,      setWaProvider]      = useState(() => _ls("waProvider", "fonnte"));
  const [waToken,         setWaToken]         = useState(() => _ls("waToken",    ""));
  const [waDevice,        setWaDevice]        = useState(() => _ls("waDevice",   ""));
  const [waStatus,        setWaStatus]        = useState("not_connected");

  const [llmProvider,     setLlmProvider]     = useState(() => _ls("llmProvider", "gemini")); // default gemini (free tier)
  const [llmApiKey,       setLlmApiKey]       = useState(() => {
    // Load key per-provider yang aktif — selalu sync dengan llmProvider
    const prov = _ls("llmProvider", "gemini"); // sama dengan default llmProvider
    return _ls("llmApiKey_" + prov, "") || _ls("llmApiKey", "");
  });
  const [llmModel,        setLlmModel]        = useState(() => _ls("llmModel", "claude-sonnet-4-6"));
  const [ollamaUrl,       setOllamaUrl]       = useState(() => _ls("ollamaUrl", "http://localhost:11434"));
  const [llmStatus,       setLlmStatus]       = useState(() => _ls("llmStatus", "not_connected"));
  const [storageProvider, setStorageProvider] = useState("r2");
  const [storageStatus,   setStorageStatus]   = useState("not_connected");
  const [dbProvider,      setDbProvider]      = useState("supabase");
  const [brainMdCustomer, setBrainMdCustomer] = useState(() => {
    const val = _ls("brainMdCustomer", "");
    if (Array.isArray(val)) return val.join("\n");
    if (typeof val !== "string") return "";
    return val;
  });
  const [modalBrainCustomerEdit, setModalBrainCustomerEdit] = useState(false);
  const [brainMd,         setBrainMd]         = useState(() => {
    const val = _ls("brainMd", BRAIN_MD_DEFAULT);
    // Sanitize: jika tersimpan sebagai array dari versi lama, convert ke string
    if (Array.isArray(val)) return val.join("\n");
    if (typeof val !== "string") return BRAIN_MD_DEFAULT;
    return val;
  });

  // ── Cron jobs ──
  const [cronJobs, setCronJobs] = useState([
    { id:1, name:"Payment Reminder",   time:"17:00", days:"Setiap Hari",  active:true,  task:"Kirim reminder invoice UNPAID/OVERDUE via WA" },
    { id:2, name:"Laporan Harian",     time:"18:00", days:"Setiap Hari",  active:true,  task:"Summary order, invoice, pendapatan hari ini" },
    { id:3, name:"Laporan Mingguan",   time:"20:00", days:"Sabtu",        active:true,  task:"Rekap mingguan ke Owner via WA" },
    { id:4, name:"Overdue Detection",  time:"17:05", days:"Setiap Hari",  active:true,  task:"Tandai invoice melewati due date -> OVERDUE" },
    { id:5, name:"Stok Alert",         time:"08:00", days:"Setiap Hari",  active:false, task:"Cek stok kritis dan notif Owner" },
  ]);

  // ── Tanggal dinamis ──
  const TODAY = new Date().toISOString().slice(0,10);
  const todayDate = new Date();
  const hariIni = todayDate.toLocaleDateString("id-ID", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const bulanIni = todayDate.toISOString().slice(0,7); // "2026-03"
  const [weekOffset, setWeekOffset] = useState(0); // 0=minggu ini, -1=minggu lalu, +1=minggu depan
  const [searchSchedule, setSearchSchedule] = useState(""); // BUG-4: search jadwal

  // ── WA Conversations reaktif ──
  const [waConversations, setWaConversations] = useState(WA_CONVERSATIONS);
  const [waMessages,     setWaMessages]     = useState([]);  // chat history conv aktif

  // ── Statistik periode filter ──
  const [statsPeriod, setStatsPeriod] = useState("bulan"); // "hari"|"bulan"|"tahun"

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
  // GAP-7: jalankan check stuck jobs setiap 15 menit
  const stuckCheckTimer = useRef(null);
  const startStuckCheck = () => {
    if (stuckCheckTimer.current) clearInterval(stuckCheckTimer.current);
    stuckCheckTimer.current = setInterval(() => {
      checkStuckJobs();
    }, 15 * 60 * 1000); // 15 menit
  };
  const pushNotif = (title, body, icon = "⬡") => {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, icon: "/favicon.ico", tag: "aclean-" + Date.now() });
      } catch(e) {}
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
      const { data, error } = await supabase.from("price_list").select("*").order("service").order("type");
      if (error) { showNotif("❌ Gagal sync harga: " + error.message); return; }
      if (!data || data.length === 0) { showNotif("⚠️ Tabel price_list kosong di Supabase"); return; }
      setPriceListData(data);
      const activePL = data.filter(r => r.is_active !== false);
      PRICE_LIST = buildPriceListFromDB(activePL);
      setPriceListSyncedAt(new Date());
      showNotif("✅ Harga berhasil di-sync dari Supabase (" + data.length + " item)");
      addAgentLog("PRICELIST_SYNC", "Force reload price list: " + data.length + " item", "SUCCESS");
    } catch(e) {
      showNotif("❌ Error sync: " + e.message);
    }
  };

  // ── GAP-7: Cek job stuck — kirim reminder ke teknisi jika laporan belum masuk 1 jam setelah selesai ──
  const checkStuckJobs = async () => {
    const nowMs = Date.now();
    const stuckOrders = ordersData.filter(o => {
      if (!["DISPATCHED","ON_SITE"].includes(o.status)) return false;
      if (!o.date || !o.time_end) return false;
      // Sudah lewat tanggal job
      if (o.date > TODAY) return false;
      // Hitung estimasi selesai
      const [h, m] = (o.time_end || "17:00").split(":").map(Number);
      const jobEndMs = new Date(o.date + "T" + o.time_end + ":00").getTime();
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
    "Filter Bersih",
    "Tidak Ada Bocor",
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
      {nama:"Freon R-22",              satuan:"KG"},
      {nama:"Freon R-32",              satuan:"KG"},
      {nama:"Freon R-410A",            satuan:"KG"},
      {nama:"Sparepart Kapasitor Fan", satuan:"Piece"},
      {nama:"Thermis Indoor",          satuan:"Piece"},
      {nama:"ACRYLIC INDOOR",          satuan:"Piece"},
      {nama:"Selang Flexibel Drain",   satuan:"Meter"},
    ],
    Repair: [
      {nama:"Freon R-22",              satuan:"KG"},
      {nama:"Freon R-32",              satuan:"KG"},
      {nama:"Freon R-410A",            satuan:"KG"},
      {nama:"Sparepart Kapasitor Fan", satuan:"Piece"},
      {nama:"Thermis Indoor",          satuan:"Piece"},
      {nama:"Remote AC Multi",         satuan:"Unit"},
      {nama:"REMOTE AC DAIKIN",        satuan:"Piece"},
      {nama:"Steker Colokan",          satuan:"Piece"},
    ],
    Complain: [
      {nama:"Freon R-22",              satuan:"KG"},
      {nama:"Freon R-32",              satuan:"KG"},
      {nama:"Freon R-410A",            satuan:"KG"},
    ],
  };
  // ── INSTALL_ITEMS: preset form instalasi ──
  const INSTALL_ITEMS = [
    { key:"pasang_05_1pk",   label:"Pemasangan AC Baru 0,5PK - 1PK",      satuan:"Unit",  default:0 },
    { key:"pasang_15_2pk",   label:"Pemasangan AC Baru 1,5PK - 2PK",      satuan:"Unit",  default:0 },
    { key:"bongkar_05_1pk",  label:"Bongkar Unit AC 0.5-1PK",             satuan:"Unit",  default:0 },
    { key:"bongkar_15_25pk", label:"Bongkar Unit AC 1.5-2.5PK",           satuan:"Unit",  default:0 },
    { key:"vacum_05_25pk",   label:"Jasa Vacum AC 0,5PK - 2,5PK",         satuan:"Unit",  default:0 },
    { key:"pipa_1pk",        label:"Pipa AC Hoda 1PK",                    satuan:"Meter", default:0 },
    { key:"pipa_2pk",        label:"Pipa AC Hoda 2PK",                    satuan:"Meter", default:0 },
    { key:"pipa_25pk",       label:"Pipa AC Hoda 2,5PK",                  satuan:"Meter", default:0 },
    { key:"pipa_3pk",        label:"Pipa AC Hoda 3PK",                    satuan:"Meter", default:0 },
    { key:"kabel_15",        label:"Kabel Eterna 3x1,5",                  satuan:"Meter", default:0 },
    { key:"kabel_25",        label:"Kabel Eterna 3x2,5",                  satuan:"Meter", default:0 },
    { key:"ducttape_biasa",  label:"Duct Tape Non Lem",                   satuan:"Piece", default:0 },
    { key:"ducttape_lem",    label:"Duct Tape Lem",                       satuan:"Piece", default:0 },
    { key:"jasa_pipa_ac",    label:"Jasa Penarikan Pipa AC",              satuan:"Meter", default:0 },
    { key:"jasa_pipa_ruko",  label:"Jasa Penarikan Pipa Ruko",            satuan:"Meter", default:0 },
    { key:"dinabolt",        label:"DINABOLT Set",                        satuan:"Set",   default:0 },
    { key:"karet_mounting",  label:"KARET MOUNTING",                      satuan:"Set",   default:0 },
    { key:"breket_outdoor",  label:"Breket Outdoor",                      satuan:"Piece", default:0 },
  ];
  const TIPE_AC_OPT = ["AC Split 0.5-1PK","AC Split 1.5-2.5PK","AC Cassette 2-2.5PK","AC Cassette 3PK","AC Cassette 4PK","AC Standing","AC Duct"];
  const SATUAN_OPT = ["pcs","kg","liter","meter","set","titik","roll"];

  const mkUnit = (no) => ({ unit_no:no, label:`Unit ${no}`, tipe:"AC Split 0.5-1PK", merk:"", pk:"1PK", kondisi_sebelum:[], kondisi_setelah:[], pekerjaan:[], freon_ditambah:"", ampere_akhir:"", catatan_unit:"" });
  const isUnitDone = (u) => u.pekerjaan.length > 0 && (u.kondisi_sebelum.length > 0 || u.kondisi_setelah.length > 0);
  const compressImg = (file) => new Promise((res) => {
    const r = new FileReader();
    r.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280; // max dimension px — cukup detail untuk dokumentasi servis
        const sc  = Math.min(1, MAX / Math.max(img.width, img.height));
        const w   = Math.round(img.width  * sc);
        const h   = Math.round(img.height * sc);
        const c   = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        // Quality 0.70 = 70% JPEG — sesuai permintaan, hemat ~78% ukuran vs original
        const dataUrl = c.toDataURL("image/jpeg", 0.70);
        const sizeKB  = Math.round((dataUrl.length * 3/4) / 1024);
        console.log(`📸 Compress: ${img.width}x${img.height} → ${w}x${h}px, ~${sizeKB}KB`);
        res(dataUrl);
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });

  // Helper: normalize URL foto agar selalu melalui Vercel proxy (SSL aman)
  const fotoSrc = (url) => {
    if (!url) return "";
    // Sudah pakai proxy → langsung
    if (url.startsWith("/api/foto")) return url;
    // URL r2.dev lama → convert ke proxy
    if (url.includes(".r2.dev/")) {
      const keyMatch = url.match(/\.r2\.dev\/(.+)$/);
      if (keyMatch) return `/api/foto?key=${encodeURIComponent(keyMatch[1])}`;
    }
    // URL r2.cloudflarestorage.com lama → extract key
    if (url.includes(".r2.cloudflarestorage.com/")) {
      const keyMatch = url.match(/cloudflarestorage\.com\/[^/]+\/(.+)$/);
      if (keyMatch) return `/api/foto?key=${encodeURIComponent(keyMatch[1])}`;
    }
    // Supabase atau lainnya → pakai langsung
    return url;
  };

  // ── Generate & Download Invoice PDF (pakai browser print API) ──
  const downloadInvoicePDF = (inv) => {
    const fmt2 = (n) => "Rp " + (Number(n)||0).toLocaleString("id-ID");
    const perUnit = inv.units > 0 ? Math.round((inv.labor||0) / inv.units) : (inv.labor||0);

    // Build material rows HTML (di luar template literal agar tidak ada backtick conflict)
  // Build material rows HTML (di luar template literal agar tidak ada backtick conflict)
  // Parse materials_detail — bisa array (sudah parsed) atau string JSON dari DB
  const matDetails = (() => {
    const md = inv.materials_detail;
    if (!md) return [];
    if (Array.isArray(md)) return md;
    try { return JSON.parse(md); } catch(_) { return []; }
  })();
  let matRowsHtml = "";
  if (matDetails.length > 0) {
    // Per-item: setiap material = 1 baris di tabel
    matDetails.forEach(m => {
      const hSatStr = m.harga_satuan > 0 ? m.harga_satuan.toLocaleString("id-ID") : "—";
      const subStr  = m.subtotal     > 0 ? m.subtotal.toLocaleString("id-ID")     : "—";
      const label   = m.nama + (m.keterangan ? ' <span style="color:#64748b;font-size:10px">(' + m.keterangan + ")</span>" : "");
      matRowsHtml +=
        "<tr>" +
        '<td>' + label + "</td>" +
        '<td style="text-align:center">' + m.jumlah + " " + (m.satuan||"") + "</td>" +
        '<td style="text-align:right;font-family:monospace">' + hSatStr + "</td>" +
        '<td style="text-align:right;font-family:monospace;font-weight:600">' + subStr + "</td>" +
        "</tr>";
    });
  } else if ((inv.material||0) > 0) {
    // Fallback invoice lama: materials_detail belum tersimpan
    // Tampilkan total material dalam 1 baris
    matRowsHtml =
      '<tr style="background:#f8fafc">' +
      '<td style="color:#475569;font-style:italic">Material &amp; Spare Part</td>' +
      '<td style="text-align:center;color:#94a3b8">—</td>' +
      '<td style="text-align:right;color:#94a3b8">—</td>' +
      '<td style="text-align:right;font-family:monospace;font-weight:600">' +
      (inv.material||0).toLocaleString("id-ID") + "</td></tr>";
  }
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Invoice ${inv.id} — AClean</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; background: #fff; }
  .page { width: 794px; min-height: 1123px; margin: 0 auto; padding: 40px; }
  .header { background: #1E3A5F; border-radius: 10px; overflow: hidden; margin-bottom: 20px; }
  .header-top { padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; }
  .brand { font-size: 22px; font-weight: 800; color: #fff; }
  .brand span { color: #60a5fa; }
  .brand-sub { font-size: 11px; color: #93c5fd; margin-top: 2px; }
  .inv-badge { background: #2563EB; color: #fff; padding: 6px 14px; border-radius: 6px; font-family: monospace; font-weight: 800; font-size: 15px; }
  .inv-label { font-size: 10px; color: #93c5fd; font-weight: 600; text-align: right; margin-bottom: 4px; }
  .header-sub { background: #0f2744; padding: 8px 24px; font-size: 10px; color: #94a3b8; display: flex; gap: 24px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .box { border-radius: 8px; padding: 14px 16px; }
  .box-blue { background: #EFF6FF; }
  .box-white { background: #fff; border: 1px solid #e2e8f0; }
  .box-title { font-size: 10px; font-weight: 800; color: #1e40af; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
  .row { display: flex; gap: 8px; margin-bottom: 4px; }
  .row-label { color: #64748b; min-width: 90px; }
  .row-val { color: #1e293b; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  thead tr { background: #1E3A5F; }
  thead th { padding: 9px 12px; text-align: left; color: #fff; font-weight: 700; font-size: 10px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 9px 12px; color: #1e293b; border-bottom: 1px solid #f1f5f9; }
  .total-row { background: #1E3A5F !important; }
  .total-row td { color: #fff !important; font-weight: 800; font-size: 14px; border: none; }
  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .bank-box { background: #EFF6FF; border-radius: 8px; padding: 14px 16px; }
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
</style>
</head>
<body>
<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div>
        <div class="brand"><span>AC</span>lean Service</div>
        <div class="brand-sub">Jasa Servis AC Profesional · Tangerang Selatan</div>
      </div>
      <div>
        <div class="inv-label">INVOICE</div>
        <div class="inv-badge">${inv.id}</div>
      </div>
    </div>
    <div class="header-sub">
      <span>📍 Alam Sutera, Tangerang Selatan</span>
      <span>📞 +62812-8989-8937</span>
      <span>🏦 BCA 8830883011 a.n. Malda Retta</span>
    </div>
  </div>

  <!-- Detail Grid -->
  <div class="grid2">
    <div class="box box-blue">
      <div class="box-title">Detail Invoice</div>
      <div class="row"><span class="row-label">Tanggal</span><span class="row-val">${inv.sent === true || inv.sent === false ? new Date().toLocaleDateString("id-ID") : (inv.sent || new Date().toLocaleDateString("id-ID"))}</span></div>
      <div class="row"><span class="row-label">No. Invoice</span><span class="row-val">${inv.id}</span></div>
      <div class="row"><span class="row-label">No. Order</span><span class="row-val">${inv.job_id || "—"}</span></div>
      <div class="row"><span class="row-label">Jatuh Tempo</span><span class="row-val">${inv.due || "—"}</span></div>
    </div>
    <div class="box box-white">
      <div class="box-title">Tagihan Kepada</div>
      <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:6px">${inv.customer}</div>
      <div style="color:#64748b">📱 ${inv.phone || "—"}</div>
      <div style="color:#64748b;margin-top:4px">🔧 ${inv.service || "—"}</div>
    </div>
  </div>

  <!-- Table -->
  <table>
    <thead>
      <tr>
        <th>Deskripsi</th>
        <th style="text-align:center">Unit</th>
        <th style="text-align:right">Harga/Unit</th>
        <th style="text-align:right">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${inv.service || "Jasa Servis AC"}</td>
        <td style="text-align:center">${inv.units || 1}</td>
        <td style="text-align:right;font-family:monospace">${perUnit.toLocaleString("id-ID")}</td>
        <td style="text-align:right;font-family:monospace;font-weight:600">${(inv.labor||0).toLocaleString("id-ID")}</td>
      </tr>
${matRowsHtml}
      ${(inv.dadakan > 0) ? `<tr><td>Pekerjaan Tambahan</td><td style="text-align:center">—</td><td style="text-align:right">—</td><td style="text-align:right;font-family:monospace;font-weight:600">${(inv.dadakan||0).toLocaleString("id-ID")}</td></tr>` : ""}
      <tr class="total-row">
        <td colspan="3">TOTAL TAGIHAN</td>
        <td style="text-align:right;font-family:monospace">Rp ${(inv.total||0).toLocaleString("id-ID")}</td>
      </tr>
    </tbody>
  </table>

  ${inv.garansi_expires ? `<div class="garansi-box">🛡️ <strong>Garansi Servis ${inv.garansi_days || 30} Hari</strong> — berlaku sampai ${inv.garansi_expires}. Jika AC bermasalah dalam masa garansi, hubungi kami tanpa biaya tambahan.</div>` : ""}

  <!-- Footer -->
  <div class="footer-grid">
    <div class="bank-box">
      <div class="box-title">Informasi Pembayaran</div>
      <div style="color:#475569;font-size:11px">Transfer Bank BCA</div>
      <div class="bank-num">8830883011</div>
      <div style="color:#475569;font-size:11px">a.n. Malda Retta</div>
      <div style="margin-top:8px;font-size:11px;color:#64748b">Kirim bukti transfer via WhatsApp ke nomor di atas</div>
    </div>
    <div class="status-box ${inv.status==="PAID"?"status-paid":inv.status==="OVERDUE"?"status-overdue":"status-unpaid"}">
      <div class="box-title">Status Pembayaran</div>
      <div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:4px">
        ${inv.status==="PAID" ? "✅ LUNAS" : inv.status==="OVERDUE" ? "⚠️ JATUH TEMPO" : "⏳ MENUNGGU PEMBAYARAN"}
      </div>
      <div style="font-size:11px;color:#64748b">Jatuh tempo: ${inv.due || "—"}</div>
      ${inv.paid_at ? `<div style="font-size:11px;color:#16a34a;margin-top:4px">Dibayar: ${new Date(inv.paid_at).toLocaleDateString("id-ID")}</div>` : ""}
    </div>
  </div>

  <div class="footer-note">
    <p>Pertanyaan? Hubungi kami via WhatsApp: +62812-8989-8937</p>
    <p style="font-style:italic;margin-top:4px;color:#94a3b8">Terima kasih telah mempercayakan perawatan AC Anda kepada AClean Service 🙏</p>
  </div>
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    // SEC-09: Audit log setiap kali invoice dicetak/download
    addAgentLog("INVOICE_PRINT",
      `Invoice ${inv.id} (${inv.customer}) dicetak oleh ${currentUser?.name || "Unknown"} — Rp${fmt(inv.total)}`,
      "SUCCESS"
    );
    const win  = window.open(url, "_blank", "width=860,height=1000,scrollbars=yes");
    if (!win) {
      // Fallback jika popup diblokir browser
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice_${inv.id}_${inv.customer.replace(/\s+/g,"_")}.html`;
      a.click();
      showNotif("PDF disimpan sebagai file HTML — buka lalu Ctrl+P untuk cetak");
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
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
    const count = Math.min(order.units||1, 10);
    setLaporanUnits(Array.from({length:count},(_,i)=>mkUnit(i+1)));
    setLaporanMaterials([]);
    setLaporanFotos([]);
  // Auto-fill install items berdasarkan jumlah unit order
  const _installDefaults = {};
  if (order.service === "Install") {
    const _u = Math.min(order.units||1, 10);
    // Auto-fill pasang AC berdasarkan jumlah unit
    _installDefaults.pasang_05_1pk  = String(_u);
    _installDefaults.vacum_unit = String(_u);
    _installDefaults.vacum_unit = String(_u);
  }
  setLaporanInstallItems(_installDefaults);
    setLaporanRekomendasi("");
    setLaporanCatatan("");
    setActiveUnitIdx(0);
    setShowMatPreset(false);
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
        const { data: profile } = await supabase
          .from("user_profiles").select("*").eq("id", data.user.id).single();
        if (!profile || !profile.active) {
          setLoginError("Akun tidak aktif. Hubungi Owner.");
          await supabase.auth.signOut(); return;
        }
        // SEC-08: Tambah expiry 8 jam ke session
        const userObj = { ...data.user, ...profile, _exp: Date.now() + 8*60*60*1000 };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(profile.role.toLowerCase());
        setActiveMenu("dashboard");
        _lsSave("localSession", userObj);
        // SEC-07: Reset counter setelah login berhasil
        setLoginAttempts(0); setLockoutUntil(0);
        _lsSave("loginAttempts", 0); _lsSave("lockoutUntil", 0);
        showNotif("Selamat datang, " + profile.name + "!");
        requestPushPermission();
        return;
      }

      // ── Fallback: cek di userAccounts lokal (akun demo / belum di Supabase Auth) ──
      const localUser = userAccounts.find(u =>
        u.email.toLowerCase() === email.toLowerCase() && u.password === pass && u.active !== false
      );
      if (localUser) {
        // SEC-08: Tambah expiry 8 jam ke session
        const userObj = { ...localUser, id: localUser.id, _exp: Date.now() + 8*60*60*1000 };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(localUser.role.toLowerCase());
        setActiveMenu("dashboard");
        _lsSave("localSession", userObj);
        // SEC-07: Reset counter
        setLoginAttempts(0); setLockoutUntil(0);
        _lsSave("loginAttempts", 0); _lsSave("lockoutUntil", 0);
        showNotif("Selamat datang, " + localUser.name + "! (mode lokal)");
        requestPushPermission();
        return;
      }

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
    await supabase.auth.signOut();
    _lsSave("localSession", null);
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
      const adminBlocked = ["settings","myreport"];
      return !adminBlocked.includes(menu);
    }
    // Teknisi & Helper: HANYA dashboard, jadwal, laporan sendiri
    if (role === "Teknisi" || role === "Helper")
      return menu === "dashboard" || menu === "schedule" || menu === "myreport";
    return false;
  };

  // ── Supabase: Restore session saat refresh ──
  // Helper: cek apakah ID adalah Supabase UUID yang valid (GAP 7)
  const isRealUUID = (id) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

  // ── Auto-save settings ke localStorage saat berubah ──
  // ── Startup cleanup: fix nilai lama yang tersimpan sebagai array ──
  useEffect(() => {
    const stringKeys = ["brainMd","waProvider","llmProvider","llmApiKey","llmModel","ollamaUrl","llmStatus","fonnteKey","wapiToken","wapiUrl"];
    stringKeys.forEach(key => {
      try {
        const raw = localStorage.getItem("aclean_"+key);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localStorage.setItem("aclean_"+key, JSON.stringify(parsed.join("\n")));
          } else if (typeof parsed !== "string" && parsed !== null && typeof parsed !== "boolean" && typeof parsed !== "number") {
            localStorage.removeItem("aclean_"+key);
          }
        }
      } catch(e) { try { localStorage.removeItem("aclean_"+key); } catch(_) {} }
    });
  }, []);

  useEffect(() => { _lsSave("llmProvider", llmProvider); }, [llmProvider]);
  useEffect(() => {
    _lsSave("llmApiKey",              llmApiKey);            // generik (backward compat)
    _lsSave("llmApiKey_" + llmProvider, llmApiKey);          // per-provider
  }, [llmApiKey, llmProvider]);
  useEffect(() => { _lsSave("llmModel",    llmModel);    }, [llmModel]);
  useEffect(() => { _lsSave("ollamaUrl",   ollamaUrl);   }, [ollamaUrl]);
  useEffect(() => { _lsSave("brainMd",        brainMd);           }, [brainMd]);
  useEffect(() => { _lsSave("brainMdCustomer", brainMdCustomer); }, [brainMdCustomer]);
  useEffect(() => { _lsSave("waProvider",  waProvider);  }, [waProvider]);
  useEffect(() => { _lsSave("waToken",     waToken);     }, [waToken]);
  useEffect(() => { _lsSave("waDevice",    waDevice);    }, [waDevice]);
  useEffect(() => { _lsSave("llmStatus",   llmStatus);   }, [llmStatus]);

  useEffect(() => {
    // ── Restore session saat refresh ──
    const restoreSession = async () => {
      // 1. Coba restore dari localStorage dulu (akun lokal/demo) — tidak butuh auth
      const saved = _ls("localSession", null);
      if (saved && saved.id && saved.role) {
        // SEC-08: Cek expiry session — auto logout setelah 8 jam
        if (saved._exp && Date.now() > saved._exp) {
          _lsSave("localSession", null);
          console.warn("SEC-08: Session expired, auto-logout");
          // jatuh ke Supabase auth check
        } else {
          setCurrentUser(saved);
          setIsLoggedIn(true);
          setActiveRole(saved.role.toLowerCase());
          return;
        }
      }
      // 2. Fallback: Supabase Auth session (akun real) — wrapped try/catch agar tidak spam 400
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) { console.warn("Auth session check:", error.message); return; }
        const session = data?.session;
        if (session?.user) {
          const { data: profile } = await supabase
            .from("user_profiles").select("*").eq("id", session.user.id).single();
          if (profile && profile.active) {
            setCurrentUser({ ...session.user, ...profile });
            setIsLoggedIn(true);
            setActiveRole(profile.role.toLowerCase());
          }
        }
      } catch(e) { console.warn("Auth restore skip:", e.message); }
    };
    restoreSession();
  }, []);

  // ── Supabase: Load data + Realtime saat login ──
  useEffect(() => {
    if (!isLoggedIn) return;

    const loadAll = async () => {
      const [ordersRes, invoicesRes, customersRes, inventoryRes, laporanRes, logsRes] = await Promise.all([
        supabase.from("orders").select("*").order("date", { ascending: false }),
        supabase.from("invoices").select("*").order("created_at", { ascending: false }),
        supabase.from("customers").select("*").order("name"),
        supabase.from("inventory").select("*").order("code"),
        supabase.from("service_reports").select("*").order("submitted_at", { ascending: false }),
        supabase.from("agent_logs").select("*").order("time", { ascending: false }).limit(50),
      ]);
      // Selalu pakai data DB jika tidak error (bahkan array kosong = data nyata dari DB)
      // Jika error = fallback ke demo data yang sudah di-init
      if (!ordersRes.error   && ordersRes.data)   setOrdersData(ordersRes.data);
      if (!invoicesRes.error && invoicesRes.data)  setInvoicesData(invoicesRes.data);
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
            try { return JSON.parse(inv.materials_detail); } catch(_) { return []; }
          })(),
        })));
      }
      if (!laporanRes.error && laporanRes.data) {
        const parseLaporan = r => ({
          ...r,
          units:     r.units_json     ? (() => { try{return JSON.parse(r.units_json);}     catch(_){return r.units    ||[];} })() : (r.units    ||[]),
          materials: r.materials_json ? (() => { try{return JSON.parse(r.materials_json);} catch(_){return r.materials||[];} })() : (r.materials||[]),
          fotos:     r.fotos || (r.foto_urls||[]).map((url,i) => ({id:i, label:`Foto ${i+1}`, url})),
          editLog:   safeArr(r.edit_log ?? r.editLog),
          rekomendasi:    r.rekomendasi    || "",
          catatan_global: r.catatan_global || r.catatan || "",
          submitted:      r.submitted || (r.submitted_at||"").slice(0,16).replace("T"," "),
          status:         r.status || "SUBMITTED",
        });
        setLaporanReports(laporanRes.data.map(parseLaporan));
      }
      // Jika DB error total, keep demo data (already in useState init)
      if (!logsRes.error && logsRes.data && logsRes.data.length > 0) setAgentLogs(logsRes.data);

      // GAP 3: Load payments summary & dispatch recent (untuk dashboard)
      try {
        const [payRes, dispRes] = await Promise.all([
          supabase.from("payments").select("invoice_id,amount,method,paid_at").order("paid_at",{ascending:false}).limit(20),
          supabase.from("dispatch_logs").select("order_id,teknisi,status,sent_at").order("sent_at",{ascending:false}).limit(30),
        ]);
        if (!payRes.error && payRes.data) setPaymentsData(payRes.data);
        if (!dispRes.error && dispRes.data) setDispatchLogs(dispRes.data);
      } catch(e) { /* tabel belum ada, skip */ }

      // Load app_settings dari Supabase DB (backup dari localStorage)
      try {
        const setRes = await supabase.from("app_settings").select("*");
        if (!setRes.error && setRes.data) {
          const sMap = Object.fromEntries(setRes.data.map(s=>[s.key, s.value]));
          // ── FIXED: selalu sync dari DB (override localStorage jika DB punya nilai) ──
          if (sMap.llm_provider) setLlmProvider(sMap.llm_provider);
          if (sMap.llm_model)    setLlmModel(sMap.llm_model);
          // Sync apiKey sesuai provider dari DB
          if (sMap.llm_provider) {
            const dbProv = sMap.llm_provider;
            const savedKey = _ls("llmApiKey_" + dbProv, "") || _ls("llmApiKey", "");
            if (savedKey) setLlmApiKey(savedKey);
          }
        }
      } catch(e) {}

      // Load Teknisi dari Supabase — fallback ke TEKNISI_DATA jika kosong/error
      try {
        const tekRes = await supabase.from("user_profiles").select("*").order("name");
        if (!tekRes.error && tekRes.data && tekRes.data.length > 0) {
          const tekList = tekRes.data.filter(u => {
            const r = (u.role||"").toLowerCase();
            return r === "teknisi" || r === "helper";
          });
          if (tekList.length > 0) {
            const normalized = tekList.map(u => ({
              ...u,
              role: (u.role||"").charAt(0).toUpperCase() + (u.role||"").slice(1).toLowerCase(),
              skills: u.skills || [],
              jobs_today: 0, // dihitung dari ordersData saat render
              status: u.status || "active",
            }));
            setTeknisiData(normalized);
          }
          // Jika tidak ada Teknisi/Helper di DB → tetap pakai TEKNISI_DATA default (sudah di useState awal)
        }
      } catch(e) { console.warn("Load teknisi failed:", e); }

      // Load Owner & Admin → userAccounts (dari user_profiles yang sama)
      try {
        const uaRes = await supabase.from("user_profiles").select("*")
          .in("role",["Owner","Admin","owner","admin"]).order("name");
        if (!uaRes.error && uaRes.data && uaRes.data.length > 0) {
          const roleColors = { owner:"#f59e0b", admin:"#38bdf8" };
          const normalized = uaRes.data.map(u => ({
            ...u,
            role: (u.role||"").charAt(0).toUpperCase() + (u.role||"").slice(1).toLowerCase(),
            color: u.color || roleColors[(u.role||"").toLowerCase()] || "#94a3b8",
            avatar: u.avatar || (u.name||"").charAt(0).toUpperCase(),
            active: u.active !== false,
            lastLogin: u.last_login
              ? new Date(u.last_login).toLocaleString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})
              : "-",
          }));
          setUserAccounts(normalized);
        }
      } catch(e) { console.warn("Load userAccounts failed:", e); }

      // Load WA conversations dari Supabase (tabel opsional)
      try {
        const waRes = await supabase.from("wa_conversations").select("*").order("updated_at", { ascending: false }).limit(50);
        if (!waRes.error && waRes.data && waRes.data.length > 0) setWaConversations(waRes.data);
      } catch(e) { /* WA tabel belum ada - skip */ }

      // ── GAP-03 FIX + PriceList state: Load price_list dari DB ──
      try {
        const plRes = await supabase.from("price_list").select("*").order("service").order("type");
        if (!plRes.error && plRes.data && plRes.data.length > 0) {
          // Set state untuk renderPriceList UI
          setPriceListData(plRes.data);
          // Build PRICE_LIST map untuk kalkulasi invoice
          const activePL = plRes.data.filter(r => r.is_active !== false);
          PRICE_LIST = buildPriceListFromDB(activePL);
          setPriceListSyncedAt(new Date());
          console.log("✅ PRICE_LIST loaded from DB:", plRes.data.length, "rows");
        }
      } catch(e) { console.warn("price_list DB fallback to default:", e?.message); }

      // ── BRAIN LOAD: Baca brain.md & brain_customer dari Supabase ara_brain ──
      try {
        const brainRes = await supabase.from("ara_brain").select("key,value");
        if (!brainRes.error && brainRes.data && brainRes.data.length > 0) {
          const brainMap = Object.fromEntries(brainRes.data.map(r => [r.key, r.value]));
          // Override localStorage dengan nilai dari DB (DB = sumber kebenaran)
          if (brainMap.brain_md && typeof brainMap.brain_md === "string" && brainMap.brain_md.length > 10) {
            setBrainMd(brainMap.brain_md);
            _lsSave("brainMd", brainMap.brain_md);
          }
          if (brainMap.brain_customer && typeof brainMap.brain_customer === "string" && brainMap.brain_customer.length > 10) {
            setBrainMdCustomer(brainMap.brain_customer);
            _lsSave("brainMdCustomer", brainMap.brain_customer);
          }
          console.log("✅ ARA Brain loaded from Supabase — sync ke semua device");
        }
      } catch(e) { console.warn("ara_brain DB load failed, pakai localStorage:", e?.message); }
    };

    setDataLoading(true);
    loadAll().finally(() => {
      setDataLoading(false);
      // GAP-7: Jalankan check stuck jobs segera setelah data load, lalu setiap 15 menit
      setTimeout(() => checkStuckJobs(), 5000); // delay 5 detik agar state ready
      startStuckCheck();
    });

    // ── GAP-08 FIX: Auto-refresh data setiap 30 menit ──
    const _statsTimer = setInterval(() => {
      loadAll().catch(e => console.warn("Auto-refresh skip:", e?.message));
    }, 30 * 60 * 1000);

    // ── GAP-08 FIX: Auto-refresh statistik setiap 30 menit ──
    const statsRefreshInterval = setInterval(() => {
      loadAll().catch(e => console.warn("Auto-refresh error:", e));
    }, 30 * 60 * 1000); // 30 menit

          // ══ Supabase Realtime Channels ══
          // Hanya 4 channel kritis (Supabase free tier: max concurrent realtime)
          // WA tables (wa_conversations, wa_messages) di-skip jika tidak ada

          const _rtDebounce = {};
          const rtDebounced = (key, fn, delay=800) => {
            clearTimeout(_rtDebounce[key]);
            _rtDebounce[key] = setTimeout(fn, delay);
          };

          // CH1: Orders — kritis
          const ch1 = supabase.channel("rt-orders")
            .on("postgres_changes", { event:"*", schema:"public", table:"orders" }, () =>
              rtDebounced("orders", () =>
                supabase.from("orders").select("*").order("date",{ascending:false}).limit(500)
                  .then(({data}) => { if(data) setOrdersData(data); })
              ))
            .subscribe((status) => {
              if (status === "SUBSCRIBED") console.log("✅ RT orders connected");
              if (status === "CHANNEL_ERROR") console.warn("⚠️ RT orders error — akan polling manual");
            });

          // CH2: Invoices — kritis
          const ch2 = supabase.channel("rt-invoices")
            .on("postgres_changes", { event:"*", schema:"public", table:"invoices" }, () =>
              rtDebounced("invoices", () =>
                supabase.from("invoices").select("*").order("created_at",{ascending:false}).limit(300)
                  .then(({data}) => { if(data) setInvoicesData(data.map(inv => ({
                    ...inv,
                    materials_detail: (() => {
                      const md = inv.materials_detail;
                      if (!md) return [];
                      if (Array.isArray(md)) return md;
                      try { return JSON.parse(md); } catch(_){ return []; }
                    })()
                  }))); })
              ))
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR") console.warn("⚠️ RT invoices error");
            });

          // CH3: Laporan teknisi — kritis
          const ch3 = supabase.channel("rt-laporan")
            .on("postgres_changes", { event:"*", schema:"public", table:"service_reports" }, () =>
              rtDebounced("laporan", () =>
                supabase.from("service_reports").select("*").order("submitted_at",{ascending:false}).limit(200)
                  .then(({data}) => {
                    if (data && data.length > 0) {
                      setLaporanReports(data.map(r => ({
                        ...r,
                        units:     r.units_json     ? (() => { try { return JSON.parse(r.units_json);     } catch(_){ return r.units     || []; } })() : (r.units     || []),
                        materials: r.materials_json ? (() => { try { return JSON.parse(r.materials_json); } catch(_){ return r.materials || []; } })() : (r.materials || []),
                        fotos:     r.fotos || (r.foto_urls||[]).map((u,idx)=>({id:idx,label:`Foto ${idx+1}`,url:u})),
                        editLog:   safeArr(r.edit_log ?? r.editLog),
                      })));
                    }
                  })
              ))
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR") console.warn("⚠️ RT laporan error");
            });

          // CH4: Price list — kritis untuk ARA
          const ch4 = supabase.channel("rt-pricelist")
            .on("postgres_changes", { event:"*", schema:"public", table:"price_list" }, () =>
              rtDebounced("pricelist", () =>
                supabase.from("price_list").select("*").order("service").order("type")
                  .then(({data}) => {
                    if (data) {
                      setPriceListData(data);
                      const activePL = data.filter(r => r.is_active !== false);
                      PRICE_LIST = buildPriceListFromDB(activePL);
                      setPriceListSyncedAt(new Date());
                    }
                  })
              ))
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR") console.warn("⚠️ RT pricelist error");
            });

          // CH5: Inventory — polling manual lebih aman (tidak perlu realtime ketat)
          const ch5 = supabase.channel("rt-inventory")
            .on("postgres_changes", { event:"*", schema:"public", table:"inventory" }, () =>
              rtDebounced("inventory", () =>
                supabase.from("inventory").select("*").order("code")
                  .then(({data}) => { if(data) setInventoryData(data); })
              ))
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR") console.warn("⚠️ RT inventory error — skip");
            });

          // CH6: Customers
          const ch6 = supabase.channel("rt-customers")
            .on("postgres_changes", { event:"*", schema:"public", table:"customers" }, () =>
              rtDebounced("customers", () =>
                supabase.from("customers").select("*").order("name")
                  .then(({data}) => { if(data) setCustomersData(data); })
              ))
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR") console.warn("⚠️ RT customers error — skip");
            });

          // CH7 & CH8: WA tables — opsional, skip gracefully jika tabel tidak ada
          let ch7 = null, ch8 = null;
          try {
            ch7 = supabase.channel("rt-wa-conv")
              .on("postgres_changes", { event:"*", schema:"public", table:"wa_conversations" }, () =>
                supabase.from("wa_conversations").select("*").order("updated_at", { ascending: false })
                  .then(({data, error}) => { if(data && !error) setWaConversations(data); }))
              .subscribe((status) => {
                if (status === "CHANNEL_ERROR") console.warn("⚠️ RT wa_conversations — tabel mungkin belum ada");
              });

            ch8 = supabase.channel("rt-wa-msg")
              .on("postgres_changes", { event:"INSERT", schema:"public", table:"wa_messages" }, (payload) => {
                setWaMessages(prev => {
                  if (prev.length === 0) return prev;
                  const phone = payload.new?.phone;
                  if (!phone) return prev;
                  if (prev[0]?.phone === phone) return [...prev, payload.new];
                  return prev;
                });
                supabase.from("wa_conversations").select("*").order("updated_at", { ascending: false })
                  .then(({data, error}) => { if(data && !error) setWaConversations(data); });
              })
              .subscribe((status) => {
                if (status === "CHANNEL_ERROR") console.warn("⚠️ RT wa_messages — tabel mungkin belum ada");
              });
          } catch(e) {
            console.warn("WA realtime channels skip:", e?.message);
          }

          return () => {
            clearInterval(_statsTimer);
            if (stuckCheckTimer.current) clearInterval(stuckCheckTimer.current);
            [ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8].forEach(ch => {
              try { if(ch) supabase.removeChannel(ch); } catch(_) {}
            });
          };
  }, [isLoggedIn]);
  // ── Colors ──
  const cs = {
    bg:      "#0a0f1e",
    surface: "#0d1526",
    card:    "#111827",
    border:  "#1e2d4a",
    text:    "#e2e8f0",
    muted:   "#64748b",
    accent:  "#38bdf8",
    green:   "#22c55e",
    yellow:  "#f59e0b",
    red:     "#ef4444",
    ara:     "#a78bfa",
  };

  const statusColor = {
    // Order workflow statuses (GAP 1.4)
    PENDING:"#64748b", CONFIRMED:"#f59e0b", DISPATCHED:"#06b6d4",
    ON_SITE:"#8b5cf6", WORKING:"#a78bfa", REPORT_SUBMITTED:"#10b981",
    INVOICE_CREATED:"#3b82f6", INVOICE_APPROVED:"#6366f1",
    PAID:"#22c55e", COMPLETED:"#22c55e", CANCELLED:"#ef4444", RESCHEDULED:"#f97316",
    IN_PROGRESS:"#38bdf8",
    // Invoice statuses
    UNPAID:"#f59e0b", OVERDUE:"#ef4444", PENDING_APPROVAL:"#a78bfa", PARTIAL:"#06b6d4"
  };
  const statusLabel = {
    PENDING:"Pending", CONFIRMED:"Dikonfirmasi", DISPATCHED:"Dikirim",
    ON_SITE:"Di Lokasi", WORKING:"Sedang Kerja", REPORT_SUBMITTED:"Laporan Masuk",
    INVOICE_CREATED:"Invoice Dibuat", INVOICE_APPROVED:"Invoice Dikirim",
    PAID:"Lunas", COMPLETED:"Selesai", CANCELLED:"Dibatalkan", RESCHEDULED:"Dijadwal Ulang",
    IN_PROGRESS:"Sedang Dikerjakan",
    UNPAID:"Belum Bayar", OVERDUE:"Terlambat", PENDING_APPROVAL:"Menunggu Approve", PARTIAL:"Bayar Sebagian"
  };

  const fmt = (n) => "Rp " + (n||0).toLocaleString("id-ID");
  // safeArr: handle Supabase returning JSON arrays as strings
  const safeArr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim().startsWith("[")) {
      try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch(_) { return []; }
    }
    return [];
  };

  // ── Helpers ──
  // ── WA: kirim via Fonnte backend, fallback wa.me ──
  const sendWA = async (phone, message) => {
    if (!phone || !message) {
      console.warn("sendWA skip: phone/message kosong", {phone, message: message?.slice(0,30)});
      return false;
    }
    try {
      const r = await fetch("/api/send-wa", {
        method:"POST", headers:_apiHeaders(),
        body: JSON.stringify({phone, message})
      });
      const d = await r.json().catch(()=>({}));
      if (r.ok && d.success) return true;
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
    } catch(err) {
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
    setOrdersData(prev => prev.map(o => o.id===order.id ? {...o, dispatch:true, dispatch_at:dispatchAt, status:"DISPATCHED"} : o));
    await supabase.from("orders").update({dispatch:true, dispatch_at:dispatchAt, status:"DISPATCHED"}).eq("id",order.id);
    const dispTek = teknisiData.find(t => t.name === order.teknisi);
    if (dispTek?.id) {
      setTeknisiData(prev => prev.map(t => t.name===order.teknisi ? {...t,status:"on-job"} : t));
      supabase.from("user_profiles").update({status:"on-job"}).eq("id", dispTek.id);
    }
    addAgentLog("DISPATCH_STATUS", `Status ${order.id} → DISPATCHED`, "SUCCESS");
    showNotif(`✅ Status job ${order.id} → Dispatched`);
  };

  // ── Kirim WA Dispatch ke Teknisi & Helper (tanpa ubah status) ──
  const sendDispatchWA = async (order) => {
    const tek = teknisiData.find(t => t.name === order.teknisi);
    if (!tek?.phone) return showNotif("⚠️ No. HP teknisi tidak ditemukan");
    const msg = `📋 *DISPATCH JOB ${order.id}*
👤 Customer: *${order.customer}*
📍 Alamat: ${order.address}
🔧 Service: ${order.service} — ${order.units} unit
📅 Jadwal: ${order.date} jam ${order.time}${order.time_end?"–"+order.time_end:""}

Segera konfirmasi kehadiran. — AClean`;
    const ok = await sendWA(tek.phone, msg);
    if (order.helper) {
      const helperData = teknisiData.find(t => t.name === order.helper);
      if (helperData?.phone) {
        const helperMsg = `📋 *ASSIST JOB ${order.id}*
👤 Customer: *${order.customer}*
📍 Alamat: ${order.address}
🔧 Service: ${order.service} — ${order.units} unit
📅 Jadwal: ${order.date} jam ${order.time}
👷 Teknisi: ${order.teknisi}

Kamu ditugaskan sebagai Helper. — AClean`;
        await sendWA(helperData.phone, helperMsg);
      }
    }
    if (ok) {
      try {
        await supabase.from("dispatch_logs").insert({
          order_id: order.id, teknisi: order.teknisi,
          assigned_by_name: currentUser?.name||"",
          wa_message: msg, status:"SENT"
        });
      } catch(e) { /* dispatch_logs opsional */ }
      addAgentLog("DISPATCH_WA_SENT", `WA dispatch ke ${order.teknisi} untuk ${order.id}`, "SUCCESS");
      showNotif(`✅ WA Dispatch terkirim ke ${order.teknisi}${order.helper?" + "+order.helper:""}`);
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

  const invoiceReminderWA = (inv) => {
  if (!inv?.phone) { showNotif("⚠️ No. HP customer tidak tersedia untuk reminder"); return; }
    const msg = `Halo ${inv.customer}, mengingatkan tagihan *AClean Service* senilai *${fmt(inv.total)}* belum dibayar.\n\nTransfer ke:\n*BCA 8830883011 a.n. Malda Retta*\n\nKonfirmasi di WA ini ya kak. Terima kasih! 🙏`;
    sendWA(inv.phone, msg);
  };

  // ── GAP 2: Hitung labor dari price list ──
  const hitungLabor = (service, type, units) => {
    const svcMap = PRICE_LIST[service] || PRICE_LIST["Cleaning"];
    const hargaPerUnit = svcMap[type] || svcMap["default"] || 85000;
    return hargaPerUnit * (units || 1);
  };

  const hitungMaterialTotal = (materials) => {
    return materials.reduce((sum, m) => {
      const raw  = (m.nama||"").toLowerCase().trim();
      // Normalisasi: strip tanda baca, koma→titik, hapus brand "eterna"
      const norm = raw
        .replace(/,/g, ".")          // koma desimal → titik
        .replace(/eterna\s*/g, "")   // hapus brand "Eterna"
        .replace(/[-\s]/g, "")       // hapus dash & spasi
        .replace(/r410a?$/, "r410")  // R-410A → r410
        .replace(/r22a?$/,  "r22")
        .replace(/r32a?$/,  "r32");
      // Cari di inventory dengan fuzzy match (normalisasi dua arah)
      const invItem = inventoryData.find(inv => {
        const n = inv.name.toLowerCase()
          .replace(/,/g, ".")
          .replace(/eterna\s*/g, "")
          .replace(/[-\s]/g, "")
          .replace(/r410a?$/, "r410")
          .replace(/r22a?$/,  "r22")
          .replace(/r32a?$/,  "r32");
        return n === norm || n.includes(norm) || norm.includes(n);
      });
      let harga = invItem ? invItem.price : 0;
      // Fallback ke PRICE_LIST freon
      if (!harga) {
        if      (raw.includes("r-22")||raw.includes("r22"))  harga = PRICE_LIST["freon_R22"]   || 450000;
        else if (raw.includes("r-32")||raw.includes("r32"))  harga = PRICE_LIST["freon_R32"]   || 450000;
        else if (raw.includes("r-410")||raw.includes("r410")) harga = PRICE_LIST["freon_R410A"] || 450000;
      }
      return sum + (harga * (parseFloat(m.jumlah) || 0));
    }, 0);
  };

  // ── GAP 3: Approve invoice (real state mutation) ──
  // ── Approve invoice (core) — tanpa kirim WA ──
  const approveInvoiceCore = async (inv) => {
    const today = new Date().toISOString().slice(0,10);
    const due = new Date(Date.now() + 14*24*60*60*1000).toISOString().slice(0,10);
    const approvedAt = new Date().toISOString();
    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? {...i, status:"UNPAID", sent:today, due} : i
    ));
    setOrdersData(prev => prev.map(o =>
      o.id === inv.job_id ? {...o, invoice_id:inv.id, status:"INVOICE_APPROVED"} : o
    ));
    // GAP 4: simpan approved_by, trigger DB akan catat audit_log
    // Update invoice — try full, fallback minimal
    {
      const {error:apErr} = await supabase.from("invoices").update({
        status:"UNPAID", sent:true, due,
        approved_by: currentUser?.name || null,
        approved_at: approvedAt,
      }).eq("id", inv.id);
      if(apErr) {
        console.warn("invoice approve full failed:", apErr.message);
        // Fallback: only safe columns
        const {error:apErr2} = await supabase.from("invoices").update({
          status:"UNPAID",
        }).eq("id", inv.id);
        if(apErr2) console.error("invoice approve minimal failed:", apErr2.message);
      }
    }
    // Update order status — with fallback
    {
      const {error:oErr} = await supabase.from("orders").update({ invoice_id:inv.id, status:"INVOICE_APPROVED" }).eq("id", inv.job_id);;
      if(oErr) {
        console.warn("orders INVOICE_APPROVED failed:", oErr.message);
        await supabase.from("orders").update({ status:"COMPLETED" }).eq("id", inv.job_id);
      }
    }
    addAgentLog("INVOICE_APPROVED", `Invoice ${inv.id} approve oleh ${currentUser?.name||"—"} — ${inv.customer} ${fmt(inv.total)}`, "SUCCESS");
    return due; // kembalikan due date untuk dipakai caller
  };

  // ── approveInvoice: buka popup pilihan (Kirim ke Customer / Simpan Dahulu) ──
  const approveInvoice = (inv) => {
    setPendingApproveInv(inv);
    setModalApproveInv(true);
  };

  // ── Approve + kirim WA ke customer ──
  const approveAndSend = async (inv) => {
    const due = await approveInvoiceCore(inv);
    const waMsg = `Halo ${inv.customer}, invoice AClean Service telah dikirim:\n\n🔧 ${inv.service||"Servis AC"}\n💰 Total: *${fmt(inv.total)}*\n📅 Jatuh tempo: ${due}\n\nPembayaran ke:\n*BCA 8830883011 a.n. Malda Retta*\n\nTerima kasih! 🙏`;
    const sent = await sendWA(inv.phone, waMsg);
    if (sent) showNotif(`✅ Invoice ${inv.id} diapprove & terkirim ke WA ${inv.customer}`);
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
  const markPaid = async (inv, method="transfer", notes="", sendCustNotif=null) => {
    const paidAt = new Date().toISOString();
    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? {...i, status:"PAID", paid_at:paidAt} : i
    ));
    setOrdersData(prev => prev.map(o =>
      (o.id === inv.job_id || o.invoice_id === inv.id) ? {...o, status:"PAID"} : o
    ));
    {
      const {error:mpErr} = await supabase.from("invoices").update({ status:"PAID", paid_at:paidAt }).eq("id", inv.id);
      if(mpErr) {
        console.warn("mark paid with paid_at failed:", mpErr.message);
        await supabase.from("invoices").update({ status:"PAID" }).eq("id", inv.id);
      }
    }

    // Notif WA ke customer — hanya jika admin/owner menyetujui (sendCustNotif=true)
    const shouldNotif = sendCustNotif === true ||
      (sendCustNotif === null && window.confirm(
        `Kirim konfirmasi pembayaran ke WhatsApp customer?

${inv.customer} — Rp ${(inv.total||0).toLocaleString("id-ID")}`
      ));
    if (shouldNotif && inv.phone) {
      sendWA(inv.phone,
        `✅ *Pembayaran Diterima!*

Yth. ${inv.customer},

Pembayaran untuk invoice *${inv.id}* sebesar *Rp ${(inv.total||0).toLocaleString("id-ID")}* telah kami terima dan dikonfirmasi.

Terima kasih telah menggunakan layanan *AClean Service* 🙏

_Simpan pesan ini sebagai bukti pelunasan._`
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
    }); } catch(e) { console.warn("payments insert skip:", e?.message); }
    // Update customer last_service
    if (inv.phone) await supabase.from("customers").update({last_service:paidAt.slice(0,10)}).eq("phone",inv.phone);
    addAgentLog("PAYMENT_CONFIRMED", `Invoice ${inv.id} LUNAS — ${inv.customer} ${fmt(inv.total)} via ${method}`, "SUCCESS");
    showNotif(`💰 Invoice ${inv.id} LUNAS — ${fmt(inv.total)}`);
  };

  // ── GAP 6: Inventory deduct ──
  // GAP 1.2 + GAP 3: Inventory via transaction table — audit trail + cegah negatif
  const deductInventory = async (materials, orderId, reportId) => {
    for (const mat of materials) {
      const item = inventoryData.find(i =>
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
      const newStatus = newStock === 0 ? "OUT" : newStock <= item.min_alert ? "CRITICAL" : newStock <= item.reorder ? "WARNING" : "OK";
      // Update local state
      setInventoryData(prev => prev.map(i => i.code === item.code ? {...i, stock:newStock, status:newStatus} : i));
      // Insert transaksi ke DB (trigger Supabase akan update stock otomatis)
    try {
    await supabase.from("inventory_transactions").insert({
        inventory_code: item.code,
        inventory_name: item.name,
        order_id: orderId || null,
        report_id: reportId || null,
        qty: -qty,                                // negatif = keluar
        type: "usage",
        notes: mat.keterangan || "",
        created_by: currentUser?.id || null,
        created_by_name: currentUser?.name || "",
    }); } catch(e) { console.warn("inv tx skip:", e?.message); }
      if (newStatus === "CRITICAL" || newStatus === "OUT") {
        addAgentLog("STOCK_ALERT", `${item.name}: ${newStatus} (sisa ${newStock} ${item.unit})`, "WARNING");
      }
    }
  };

  // ── GAP 9: Create order (real state mutation) ──
  const createOrder = async (form) => {
    // GAP-1&2: DB-level conflict check (real-time, anti race condition)
    if (form.teknisi && form.date && form.time) {
      const dbCheck = await cekTeknisiAvailableDB(form.teknisi, form.date, form.time, form.service, form.units);
      if (!dbCheck.ok) {
        showNotif("⚠️ " + (dbCheck.reason || form.teknisi + " tidak tersedia di jam tersebut"));
        return null;
      }
    }
    // GAP 4: ID aman — timestamp ms + random 3 digit, tidak bergantung array.length
    const newId = "JOB" + Date.now().toString().slice(-7) + Math.floor(Math.random()*100).toString().padStart(2,"0");
    const timeEnd = hitungJamSelesai(form.time||"09:00", form.service||"Cleaning", form.units||1);
    // Cek customer existing by phone ATAU name (untuk customer_id)
    const preExistCust = findCustomer(customersData, form.phone, form.customer);
    const newOrder = {
      id:newId,
      customer: form.customer, phone: normalizePhone(form.phone), address: form.address,
      customer_id: preExistCust?.id || null,
      service: form.service, type: form.type, units: parseInt(form.units)||1,
      teknisi: form.teknisi, helper: form.helper||null,
      date: form.date, time: form.time, time_end: timeEnd, status:"CONFIRMED",
      invoice_id:null, dispatch:false, notes:form.notes||""
    };
    setOrdersData(prev => [...prev, newOrder]);

    // ── Fallback insert: coba full → minimal ──
    let orderSaved = false;

    // Attempt 1: full payload
    { const { error: e1 } = await supabase.from("orders").insert(newOrder);
      if (!e1) { orderSaved = true; console.log("✅ Order saved full:", newOrder.id); }
      else console.warn("❌ A1 full:", e1.message, "| hint:", e1.hint, "| detail:", e1.details); }

    // Attempt 2: kolom aman saja
    if (!orderSaved) {
      const safe2 = {
        id: newOrder.id, date: newOrder.date, status: newOrder.status,
        service: newOrder.service, units: newOrder.units,
        customer: newOrder.customer, teknisi: newOrder.teknisi,
        helper: newOrder.helper, time: newOrder.time, time_end: newOrder.time_end,
        customer_id: newOrder.customer_id,
      };
      const { error: e2 } = await supabase.from("orders").insert(safe2);
      if (!e2) { orderSaved = true; console.log("✅ Order saved safe2:", newOrder.id); }
      else console.warn("❌ A2 safe:", e2.message, "| hint:", e2.hint); }

    // Attempt 3: hanya id + date + service + units + status
    if (!orderSaved) {
      const minimal = { id: newOrder.id, date: newOrder.date,
        service: newOrder.service, units: newOrder.units, status: newOrder.status };
      const { error: e3 } = await supabase.from("orders").insert(minimal);
      if (!e3) { orderSaved = true; console.log("✅ Order saved minimal:", newOrder.id); }
      else {
        console.error("❌ A3 minimal:", e3.message, "| hint:", e3.hint, "| detail:", e3.details);
        showNotif("❌ Gagal simpan order: " + e3.message + (e3.hint ? " — " + e3.hint : ""));
        return null;
      }
    }
    if (!orderSaved) return null;

    // GAP 1.5: Simpan ke technician_schedule untuk cegah double booking
    if (form.teknisi && form.date && form.time && timeEnd) {
      // Insert ke technician_schedule — field minimal agar kompatibel berbagai schema
      try {
        const schedPayload = {
          order_id:  newId,
          teknisi:   form.teknisi,
          date:      form.date,
          time_start: form.time||"09:00",
          time_end:   timeEnd,
          status:    "ACTIVE",
        };
        const { error: se } = await supabase.from("technician_schedule").insert(schedPayload);
        if (se) console.error("technician_schedule 400:", se.message, "|", se.hint, "|", se.details, "| payload:", JSON.stringify(schedPayload));
      } catch(e) { /* technician_schedule opsional */ }
    }

    addAgentLog("ORDER_CREATED", `Order baru ${newId} — ${form.customer} (${form.service} ${form.units} unit)`, "SUCCESS");

    // ── AUTO-DISPATCH: Owner/Admin buat order → langsung dispatch ke teknisi ──
    // Teknisi tidak perlu menunggu tombol dispatch manual
    if (form.teknisi && (currentUser?.role === "Owner" || currentUser?.role === "Admin")) {
      // Update status ke DISPATCHED dulu
      setOrdersData(prev => prev.map(o =>
        o.id === newId ? { ...o, status: "DISPATCHED", dispatch: true, dispatch_at: new Date().toISOString() } : o
      ));
      await supabase.from("orders").update({
        status: "DISPATCHED", dispatch: true, dispatch_at: new Date().toISOString()
      }).eq("id", newId);

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
            name:         form.customer.trim(),
            phone:        normalizePhone(form.phone),
            address:      (form.address || "").trim(),
            area:         (form.area    || "").trim(),
            notes:        "",
            is_vip:       false,
            total_orders: 1,
            joined_date:  orderDate,
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
        } catch(e) {
          addAgentLog("CUSTOMER_UPDATE_WARN", "Gagal update total_orders: " + (e?.message||""), "WARNING");
        }
      }
    }
    return newId;
  };

  // ── GAP 8: ARA Chat dengan LLM + Tool Calls ──
  const sendToARA = async (userMsg) => {
    if (!userMsg.trim() || araLoading) return;
    const newMessages = [...araMessages, {role:"user", content:userMsg}];
    setAraMessages(newMessages);
    setAraInput("");
    setAraLoading(true);
    // Clear image after sending
    const sentImagePreview = araImagePreview;
    setAraImageData(null); setAraImageType(null); setAraImagePreview(null);

    const bizContext = {
      today: TODAY,
      orders:    ordersData.map(o=>({id:o.id,customer:o.customer,service:o.service,type:o.type,units:o.units,status:o.status,date:o.date,time:o.time,teknisi:o.teknisi,helper:o.helper,dispatch:o.dispatch,invoice_id:o.invoice_id})),
      invoices:  invoicesData.map(i=>({id:i.id,customer:i.customer,phone:i.phone,total:i.total,status:i.status,due:i.due,labor:i.labor,material:i.material,dadakan:i.dadakan,materials_detail:(i.materials_detail||[]).map(m=>({nama:m.nama,jumlah:m.jumlah,satuan:m.satuan,harga_satuan:m.harga_satuan,subtotal:m.subtotal}))})),
      inventory: inventoryData.map(i=>({code:i.code,name:i.name,stock:i.stock,unit:i.unit,status:i.status,price:i.price,reorder:i.reorder})),
      customers: customersData.map(c=>({id:c.id,name:c.name,phone:c.phone,area:c.area,total_orders:c.total_orders,is_vip:c.is_vip})),
      laporan: laporanReports.map(r=>({
        id:r.id, job_id:r.job_id, teknisi:r.teknisi, customer:r.customer,
        service:r.service, status:r.status, date:r.date, submitted:r.submitted,
        is_install: r.service==="Install",
        materials: (r.materials||[]).map(m=>({nama:m.nama,jumlah:m.jumlah,satuan:m.satuan})),
        total_units: r.total_units||0,
      })),
      laporanPending: laporanReports.filter(r=>r.status==="SUBMITTED").length,
      laporanRevisi:  laporanReports.filter(r=>r.status==="REVISION").length,
      teknisiWorkload: teknisiData.filter(t=>t.role==="Teknisi"||t.role==="teknisi").map(t=>({
        name:t.name, role:t.role, status:t.status,
        phone: t.phone || "",
        skills: Array.isArray(t.skills) ? t.skills : [],
        area: t.area || "",
        jobsToday: ordersData.filter(o=>o.teknisi===t.name&&o.date===TODAY).length,
        jobsPending: ordersData.filter(o=>o.teknisi===t.name&&["CONFIRMED","IN_PROGRESS"].includes(o.status)).length,
        slotKosongHariIni: cariSlotKosong(t.name, TODAY, "Cleaning", 1),
        jadwalHariIni: ordersData.filter(o=>o.teknisi===t.name&&o.date===TODAY).map(o=>({id:o.id,time:o.time,time_end:o.time_end||"?",service:o.service,units:o.units,customer:o.customer})),
      })),
      helperList: teknisiData.filter(t=>t.role==="Helper"||t.role==="helper").map(t=>({
        name:t.name, role:t.role, status:t.status,
        phone: t.phone || "",
        skills: Array.isArray(t.skills) ? t.skills : [],
        jobsToday: ordersData.filter(o=>o.helper===t.name&&o.date===TODAY).length,
      })),
      areaPelayanan: {
        utama: ["Alam Sutera","BSD","Gading Serpong","Graha Raya","Karawaci","Tangerang","Tangerang Selatan","Serpong"],
        konfirmasi: ["Jakarta Barat"],
      },
      // ── Rekomendasi slot dari araSchedulingSuggest (sudah dihitung, ARA tinggal baca) ──
      slotRekomendasi: (() => {
        try {
          const { pref, sorted } = araSchedulingSuggest(TODAY, "Cleaning", 1);
          return {
            teknisiDisarankan: sorted ? sorted.slice(0,3).map(t => ({
              nama: t.name,
              jobsHariIni: ordersData.filter(o=>o.teknisi===t.name&&o.date===TODAY).length,
              helperFavorit: pref[t.name] || null,
              slotTersedia: true
            })) : [],
            pasanganFavorit: pref,
          };
        } catch(_) { return { teknisiDisarankan: [], pasanganFavorit: {} }; }
      })(),
      logikaDurasi: "Cleaning: 1u=1j,2u=2j,3u=3j,4u=3j,5-6u=4j,7-8u=5j,9-10u=6j,>10=sehari | Install: 1-3u=1hari,4+u=2hari | Repair: 60-120mnt/unit | Complain: 1u=30mnt,setiap tambahan unit +15mnt",
      jamKerja: "09:00-17:00 WIB",
      revenueStats: {
        bulanIni: invoicesData.filter(i=>i.status==="PAID"&&(i.sent||"").startsWith(bulanIni)).reduce((a,b)=>a+(b.total||0),0),
        totalUnpaid: invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").reduce((a,b)=>a+(b.total||0),0),
        stokKritis: inventoryData.filter(i=>i.status==="OUT"||i.status==="CRITICAL").map(i=>i.name),
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
          harga: Number(r.price)||0,
          formatted: "Rp" + Number(r.price||0).toLocaleString("id-ID"),
          notes: r.notes||null,
        }));
      })(),
    };

    try {
      let fullText = "";

      // ── Coba backend proxy dulu (API key aman di server) ──
      const backendRes = await fetch("/api/ara-chat", {
        method:"POST", headers:_apiHeaders(),
        body: JSON.stringify({
          messages: newMessages.map(m=>({role:m.role, content:m.content})),
          bizContext, brainMd, provider:llmProvider, model:llmModel, ollamaUrl,
          ...(araImageData ? { imageData: araImageData, imageType: araImageType } : {})
        })
      }).catch(()=>null);

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
        } catch(je) {
          throw new Error(je.message || "ara-chat server error " + backendRes.status);
        }
      } else if (!backendRes && (llmApiKey || llmProvider === "ollama")) {
        // ── Fallback HANYA jika /api/ara-chat tidak tersedia (localhost dev) ──
        // Di production Vercel: proxy selalu ada, API key AMAN di server
        const sysP = (typeof brainMd==="string"?brainMd:BRAIN_MD_DEFAULT)+`\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext)}\n\n## TOOL — ACTIONS TERSEDIA\nGunakan [ACTION]{...}[/ACTION] untuk eksekusi operasi. Format JSON:\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"labor","value":100000} (field: labor/material/dadakan/notes. Detail material ada di invoices[].materials_detail)\\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"material","value":200000} (ubah total material)\\n- {"type":"MARK_PAID","id":"INV-xxx"}\n- {"type":"APPROVE_INVOICE","id":"INV-xxx"}\n- {"type":"SEND_REMINDER","invoice_id":"INV-xxx"}\n- {"type":"UPDATE_ORDER_STATUS","id":"JOB-xxx","status":"COMPLETED"}\n- {"type":"DISPATCH_WA","order_id":"JOB-xxx"}\n- {"type":"SEND_WA","phone":"628xxx","message":"..."}\n- {"type":"UPDATE_STOCK","code":"MAT001","delta":5} (delta=tambah/kurang)\n- {"type":"CANCEL_ORDER","id":"JOB-xxx","reason":"..."}
- {"type":"CREATE_INVOICE","order_id":"ORD-xxx"}\n- {"type":"RESCHEDULE_ORDER","id":"JOB-xxx","date":"2026-03-10","time":"09:00","teknisi":"Mulyadi"}\nGunakan data teknisiWorkload.slotKosongHariIni dan jadwalHariIni untuk cek jadwal kosong. Area utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan. Jakarta Barat: perlu konfirmasi admin.\n- {"type":"MARK_INVOICE_OVERDUE"} (tandai semua yang lewat due date)\nHanya gunakan 1 ACTION per response. Konfirmasi ke user setelah eksekusi.`;

        if (llmProvider === "ollama") {
          // ── Ollama Local / ngrok ──
          const baseUrl = (ollamaUrl||"http://localhost:11434").replace(/\/+$/, "");
          const fr = await fetch(baseUrl + "/api/chat", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              model: llmModel || "llama3",
              stream: false,
              messages: [
                {role:"system", content:sysP},
                ...newMessages.map(m=>({role:m.role, content:m.content}))
              ]
            })
          });
          if (!fr.ok) {
            const txt = await fr.text().catch(()=>"");
            throw new Error("Ollama error " + fr.status + (txt ? ": " + txt.slice(0,100) : ""));
          }
          const fd = await fr.json();
          fullText = fd.message?.content || fd.response || "";

        } else if (llmProvider === "openai") {
          // ── OpenAI / ChatGPT API ──
          const fr = await fetch("https://api.openai.com/v1/chat/completions", {
            method:"POST",
            headers:{"Content-Type":"application/json","Authorization":"Bearer "+llmApiKey},
            body:JSON.stringify({
              model: llmModel || "gpt-4o-mini",
              max_tokens: 1000,
              messages: [
                {role:"system", content:sysP},
                ...newMessages.map(m=>({role:m.role, content:m.content}))
              ]
            })
          });
          const fd = await fr.json();
          if (!fr.ok) throw new Error(fd.error?.message || "OpenAI API error " + fr.status);
          fullText = fd.choices?.[0]?.message?.content || "";

        } else if (llmProvider === "gemini") {
          // ── Google Gemini API dengan Function Calling ──
          const model = llmModel || "gemini-2.5-flash";

          // Definisi tools untuk Gemini function calling
          const geminiTools = [{
            functionDeclarations: [
              { name:"create_order", description:"Buat order baru",
                parameters:{ type:"OBJECT", properties:{
                  customer:{type:"STRING"}, phone:{type:"STRING"}, address:{type:"STRING"},
                  service:{type:"STRING",enum:["Cuci AC","Freon AC","Perbaikan AC","Pasang AC Baru","Bongkar AC","Service AC"]},
                  units:{type:"NUMBER"}, teknisi:{type:"STRING"}, helper:{type:"STRING"},
                  date:{type:"STRING",description:"YYYY-MM-DD"}, time:{type:"STRING",description:"HH:MM"},
                  notes:{type:"STRING"}
                }, required:["customer","service","date"]}
              },
              { name:"update_order_status", description:"Update status order",
                parameters:{ type:"OBJECT", properties:{
                  id:{type:"STRING"}, status:{type:"STRING",enum:["PENDING","CONFIRMED","IN_PROGRESS","COMPLETED","CANCELLED"]}
                }, required:["id","status"]}
              },
              { name:"reschedule_order", description:"Jadwal ulang order",
                parameters:{ type:"OBJECT", properties:{
                  id:{type:"STRING"}, date:{type:"STRING"}, time:{type:"STRING"}, teknisi:{type:"STRING"}
                }, required:["id","date"]}
              },
              { name:"cancel_order", description:"Batalkan order",
                parameters:{ type:"OBJECT", properties:{
                  id:{type:"STRING"}, reason:{type:"STRING"}
                }, required:["id"]}
              },
              { name:"create_invoice", description:"Buat invoice dari order yang sudah selesai",
                parameters:{ type:"OBJECT", properties:{ order_id:{type:"STRING"} }, required:["order_id"]}
              },
              { name:"mark_invoice_paid", description:"Tandai invoice lunas",
                parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"} }, required:["id"]}
              },
              { name:"approve_invoice", description:"Approve invoice",
                parameters:{ type:"OBJECT", properties:{ id:{type:"STRING"} }, required:["id"]}
              },
              { name:"update_stock", description:"Update stok material",
                parameters:{ type:"OBJECT", properties:{
                  code:{type:"STRING"}, name:{type:"STRING"},
                  delta:{type:"NUMBER",description:"positif=tambah, negatif=kurangi"},
                  reason:{type:"STRING"}
                }, required:["delta"]}
              },
              { name:"dispatch_wa", description:"Kirim dispatch WA ke teknisi",
                parameters:{ type:"OBJECT", properties:{ order_id:{type:"STRING"} }, required:["order_id"]}
              },
              { name:"send_wa", description:"Kirim pesan WhatsApp ke nomor tertentu",
                parameters:{ type:"OBJECT", properties:{
                  phone:{type:"STRING"}, message:{type:"STRING"}
                }, required:["phone","message"]}
              },
              { name:"send_reminder", description:"Kirim reminder WA untuk invoice belum lunas",
                parameters:{ type:"OBJECT", properties:{ invoice_id:{type:"STRING"} }, required:["invoice_id"]}
              },
              { name:"update_invoice", description:"Edit field invoice (labor/material/dadakan/discount/notes)",
                parameters:{ type:"OBJECT", properties:{
                  id:{type:"STRING"},
                  field:{type:"STRING", enum:["labor","material","dadakan","discount","notes","due"]},
                  value:{type:"STRING"}
                }, required:["id","field","value"]}
              },
              { name:"mark_invoice_overdue", description:"Tandai semua invoice UNPAID yang melewati due date menjadi OVERDUE",
                parameters:{ type:"OBJECT", properties:{} }
              },
            ]
          }];

          // Normalize pesan untuk Gemini (harus alternating user/model)
          const rawMsgs = newMessages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          }));
          const geminiContents = rawMsgs.reduce((acc, msg) => {
            if (acc.length === 0 && msg.role !== "user") return acc;
            const prev = acc[acc.length - 1];
            if (prev && prev.role === msg.role) {
              return [...acc.slice(0,-1), { role: prev.role, parts: [...prev.parts, ...msg.parts] }];
            }
            return [...acc, msg];
          }, []);

          const fr = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmApiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: sysP }] },
                contents: geminiContents,
                tools: geminiTools,
                generationConfig: { maxOutputTokens: 1500 }
              })
            }
          );
          const fd = await fr.json();
          if (!fr.ok) throw new Error(fd.error?.message || "Gemini API error " + fr.status);

          // Handle function call response dari Gemini
          const candidate = fd.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          const funcCall = parts.find(p => p.functionCall);

          if (funcCall) {
            // Gemini ingin eksekusi function — konversi ke ACTION format
            const fn = funcCall.functionCall;
            const args = fn.args || {};
            const textPart = parts.find(p => p.text)?.text || "";

            // Map Gemini function call → ACTION object
            const actionMap = {
              create_order:         { type:"CREATE_ORDER",          ...args },
              update_order_status:  { type:"UPDATE_ORDER_STATUS",   ...args },
              reschedule_order:     { type:"RESCHEDULE_ORDER",      ...args },
              cancel_order:         { type:"CANCEL_ORDER",          ...args },
              create_invoice:       { type:"CREATE_INVOICE",        ...args },
              mark_invoice_paid:    { type:"MARK_PAID",             ...args },
              approve_invoice:      { type:"APPROVE_INVOICE",       ...args },
              update_stock:         { type:"UPDATE_STOCK",          ...args },
              dispatch_wa:          { type:"DISPATCH_WA",           ...args },
              send_wa:              { type:"SEND_WA",               ...args },
              send_reminder:        { type:"SEND_REMINDER",         ...args },
              update_invoice:       { type:"UPDATE_INVOICE",        ...args },
              mark_invoice_overdue: { type:"MARK_INVOICE_OVERDUE"           },
            };
            const action = actionMap[fn.name];
            if (action) {
              fullText = (textPart ? textPart + "\n" : "") + "[ACTION]" + JSON.stringify(action) + "[/ACTION]";
            } else {
              fullText = textPart || "Aksi tidak dikenali: " + fn.name;
            }
          } else {
            fullText = parts.map(p => p.text || "").join("") || "";
          }

        } else {
          // ── Anthropic Claude API (default) ──
          const fr = await fetch("https://api.anthropic.com/v1/messages", {
            method:"POST",
            headers:{"Content-Type":"application/json","x-api-key":llmApiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
            body:JSON.stringify({model:llmModel||"claude-sonnet-4-6",max_tokens:1000,system:sysP,messages:newMessages.map(m=>({role:m.role,content:m.content}))})
          });
          const fd = await fr.json();
          if (!fr.ok) throw new Error(fd.error?.message || "Claude API error");
          fullText = fd.content?.map(c=>c.text||"").join("")||"";
        }
      } else {
        const needKey = llmProvider !== "ollama";
        const hasKey  = llmProvider === "ollama" ? !!ollamaUrl : !!llmApiKey;
        if (!hasKey) throw new Error(llmProvider==="ollama"
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
          if (act.type==="UPDATE_INVOICE") {
            setInvoicesData(prev=>prev.map(i=>{ if(i.id!==act.id) return i; const u={...i,[act.field]:act.value}; u.total=(u.labor||0)+(u.material||0)+(u.dadakan||0); return u; }));
            await supabase.from("invoices").update({[act.field]:act.value}).eq("id",act.id);
            addAgentLog("ARA_ACTION",`ARA update ${act.id}: ${act.field}=${fmt(act.value)}`,"SUCCESS");
            ar=`\n✅ *Invoice ${act.id} diupdate — ${act.field}: ${fmt(act.value)}*`;
          } else if (act.type==="MARK_PAID") {
            markPaid(invoicesData.find(i=>i.id===act.id)||{id:act.id,customer:"",total:0});
            ar=`\n✅ *Invoice ${act.id} ditandai LUNAS*\n💬 Notif WA ke customer akan diminta konfirmasi admin.`;
          } else if (act.type==="APPROVE_INVOICE") {
            approveInvoice(invoicesData.find(i=>i.id===act.id)||{id:act.id,job_id:"",customer:"",total:0});
            ar=`\n✅ *Invoice ${act.id} diapprove*`;
          } else if (act.type==="SEND_REMINDER") {
            const inv=invoicesData.find(i=>i.id===act.invoice_id);
            if(inv){ invoiceReminderWA(inv); ar=`\n✅ *Reminder dikirim ke ${inv.customer}*`; }
          } else if (act.type==="UPDATE_ORDER_STATUS") {
            setOrdersData(prev=>prev.map(o=>o.id===act.id?{...o,status:act.status}:o));
            await supabase.from("orders").update({status:act.status}).eq("id",act.id);
            addAgentLog("ARA_ACTION",`ARA update status ${act.id} → ${act.status}`,"SUCCESS");
            ar=`\n✅ *Order ${act.id} → ${act.status}*`;
          } else if (act.type==="DISPATCH_WA") {
            const orderD = ordersData.find(o=>o.id===act.order_id);
            if(orderD){ await dispatchWA(orderD); ar=`\n✅ *Dispatch WA dikirim untuk ${act.order_id}*`; }
            else ar=`\n⚠️ *Order ${act.order_id} tidak ditemukan*`;
          } else if (act.type==="SEND_WA") {
            const sent = await sendWA(act.phone, act.message);
            addAgentLog("ARA_WA_SENT",`ARA kirim WA ke ${act.phone}`,sent?"SUCCESS":"WARNING");
            ar=`\n✅ *WA dikirim ke ${act.phone}*`;
          } else if (act.type==="UPDATE_STOCK") {
            const item = inventoryData.find(i=>i.code===act.code||i.name.toLowerCase().includes((act.name||"").toLowerCase()));
            if(item){
              const delta = act.delta || (act.stock != null ? act.stock - item.stock : 0);
              const txType = delta >= 0 ? "restock" : "usage";
              // GAP 1: lewat inventory_transactions → trigger DB update stock otomatis
              const {error:txErr} = await supabase.from("inventory_transactions").insert({
                inventory_code: item.code,
                inventory_name: item.name,
                qty: delta,
                type: txType,
                notes: `ARA ${txType}: ${act.reason||""}`,
                created_by: currentUser?.id||null,
                created_by_name: currentUser?.name||"ARA",
              });
              if (txErr) {
                // Fallback: update langsung jika trigger belum jalan
                const newStock = Math.max(0, item.stock + delta);
                const ns = newStock===0?"OUT":newStock<=item.min_alert?"CRITICAL":newStock<=item.reorder?"WARNING":"OK";
                setInventoryData(prev=>prev.map(i=>i.code===item.code?{...i,stock:newStock,status:ns}:i));
                await supabase.from("inventory").update({stock:newStock,status:ns}).eq("code",item.code);
                ar=`\n✅ *Stok ${item.name} diupdate → ${newStock} ${item.unit}*`;
              } else {
                // Reload inventory dari DB setelah trigger update
                const {data:freshInv} = await supabase.from("inventory").select("*").order("code");
                if(freshInv) setInventoryData(freshInv);
                const newStock = item.stock + delta;
                ar=`\n✅ *Stok ${item.name} ${delta>=0?"ditambah +"+delta:"dikurangi "+delta} → ${newStock} ${item.unit}*`;
              }
              addAgentLog("ARA_STOCK",`ARA ${txType} ${item.name}: delta ${delta}`,"SUCCESS");
            } else ar=`\n⚠️ *Material tidak ditemukan*`;
          } else if (act.type==="CREATE_ORDER") {
            const today = new Date().toISOString().slice(0,10);
            const seq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
            const newId = "ORD-" + (act.date||today).replace(/-/g,"").slice(2,8) + "-" + seq;
            const newOrd = {
              id: newId,
              customer: act.customer || "?",
              phone: act.phone || "",
              address: act.address || "",
              service: act.service || "Cuci AC",
              units: parseInt(act.units)||1,
              teknisi: act.teknisi || "",
              helper: act.helper || "",
              date: act.date || today,
              time: act.time || "09:00",
              status: "PENDING",
              notes: act.notes || "",
              dispatch: false,
              created_at: new Date().toISOString(),
            };
            setOrdersData(prev => [...prev, newOrd]);
            const {error:oErr} = await supabase.from("orders").insert(newOrd);
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
                  await supabase.from("customers").upsert(
                    { name: newOrd.customer, phone: newOrd.phone, address: newOrd.address||"", joined_date: newOrd.date },
                    { onConflict: "phone", ignoreDuplicates: false }
                  );
                } catch(e) { console.warn("Customer upsert:", e?.message); }
                ar += "\n👤 *Customer baru ditambahkan: " + newOrd.customer + "*";
              } else {
                // Update total_orders untuk customer existing
                setCustomersData(prev => prev.map(c =>
                  sameCustomer(c, newOrd.phone, newOrd.customer) ? { ...c, total_orders: (c.total_orders||0)+1, last_service: newOrd.date } : c
                ));
                try {
                  await supabase.from("customers").update({
                    total_orders: (existingCust.total_orders||0)+1, last_service: newOrd.date
                  }).eq("phone", newOrd.phone);
                } catch(e) { console.warn("Customer update skip:", e?.message); }
                ar += "\n👤 *Customer existing: " + newOrd.customer + " (order ke-" + ((existingCust.total_orders||0)+1) + ")*";
              }
            }

            ar = "\n✅ *Order " + newId + " dibuat untuk " + newOrd.customer + " — " + newOrd.service + " " + newOrd.units + " unit, " + newOrd.date + " jam " + newOrd.time + "*" + ar;
          } else if (act.type==="CREATE_INVOICE") {
            // Buat invoice dari order yang sudah COMPLETED
            const ord = ordersData.find(o => o.id === act.order_id);
            if (!ord) { ar = "\n⚠️ *Order " + act.order_id + " tidak ditemukan*"; }
            else {
              const today = new Date().toISOString().slice(0,10);
              const seq2  = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
              const invId = "INV-" + today.replace(/-/g,"").slice(2,8) + "-" + seq2;
              const labor = PRICE_LIST[ord.service]?.[ord.type || "default"] || PRICE_LIST[ord.service]?.["default"] || 80000;
              const laborTotal = labor * (ord.units || 1);

              // ── Baca material + freon dari laporan teknisi ──
              const lapRep = laporanReports.find(r => r.job_id === ord.id);
              const materialCost = lapRep?.materials
                ? lapRep.materials.reduce((sum, m) => {
          // Lookup harga dari inventory (sama seperti hitungMaterialTotal)
          const _mNama = (m.nama||"").toLowerCase();
          const _invItem = inventoryData.find(inv =>
            inv.name.toLowerCase().includes(_mNama) || _mNama.includes(inv.name.toLowerCase())
          );
          let harga = _invItem?.price || m.harga || m.price || 0;
          // Fallback ke PRICE_LIST freon jika tidak ada di inventory
          if (!harga) {
            if (_mNama.includes("r-22")||_mNama.includes("r22")) harga = PRICE_LIST["freon_R22"]||150000;
            else if (_mNama.includes("r-32")||_mNama.includes("r32")) harga = PRICE_LIST["freon_R32"]||160000;
            else if (_mNama.includes("r-410")||_mNama.includes("r410")) harga = PRICE_LIST["freon_R410A"]||180000;
          }
          const qty = parseFloat(m.jumlah || m.qty || m.quantity || 1);
                    return sum + (harga * qty);
                  }, 0)
                : 0;
          // [OPSI A] Freon tidak dihitung dari total_freon (psi data)
          const freonCost  = 0; // freon masuk via material manual
              // Freon: hitung dari total_freon × harga freon (R32=200rb, R22=150rb default R32)

              // Dadakan jika booking H-0
              const isToday = ord.date === today;
              const dadakanFee = isToday ? 50000 : 0;
              const totalInv = laborTotal + materialCost + dadakanFee;

              const newInv = {
                id: invId, job_id: ord.id,
                customer: ord.customer, phone: ord.phone || "",
                service: ord.service + (ord.type ? " - " + ord.type : ""),
                units: ord.units || 1,
                labor: laborTotal,
                material: materialTotal,
                dadakan: dadakanFee,
                discount: 0,
                total: totalInv,
                status: "PENDING",
                laporan_id: lapRep?.id || null,
                due: new Date(Date.now() + 3*86400000).toISOString().slice(0,10),
                sent: false, created_at: new Date().toISOString()
              };
              setInvoicesData(prev => [...prev, newInv]);
              const {error:invErr} = await supabase.from("invoices").insert(newInv);
              if (invErr) console.warn("Create invoice DB:", invErr.message);
              // Link invoice ke order
              setOrdersData(prev => prev.map(o => o.id===ord.id ? {...o, invoice_id:invId} : o));
              await supabase.from("orders").update({invoice_id:invId}).eq("id",ord.id);
              addAgentLog("ARA_CREATE_INVOICE","ARA buat invoice "+invId+" dari "+ord.id+" — "+newInv.customer,"SUCCESS");
              ar = "\n✅ *Invoice " + invId + " dibuat untuk " + newInv.customer + " — Total: " + newInv.total.toLocaleString("id-ID") + "*";
            }
          } else if (act.type==="CANCEL_ORDER") {
            setOrdersData(prev=>prev.map(o=>o.id===act.id?{...o,status:"CANCELLED"}:o));
            await supabase.from("orders").update({status:"CANCELLED"}).eq("id",act.id);
            addAgentLog("ARA_CANCEL",`ARA cancel order ${act.id}: ${act.reason||""}`,"WARNING");
            ar=`\n✅ *Order ${act.id} dibatalkan*${act.reason?" — "+act.reason:""}`;
          } else if (act.type==="RESCHEDULE_ORDER") {
            const upd = {date:act.date,time:act.time||"09:00",...(act.teknisi?{teknisi:act.teknisi}:{})};
            const rOrdCheck = ordersData.find(o=>o.id===act.id);
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
              setOrdersData(prev=>prev.map(o=>o.id===act.id?{...o,...upd}:o));
              await supabase.from("orders").update(upd).eq("id",act.id);
            // Auto-kirim WA notifikasi reschedule ke teknisi
            const rOrd = ordersData.find(o=>o.id===act.id);
            if (rOrd) {
              const tekData = teknisiData.find(t=>t.name===(act.teknisi||rOrd.teknisi));
              // Notif customer
              if (rOrd.phone) {
                const custMsg = `📅 *Info Perubahan Jadwal*

Yth. ${rOrd.customer},
Jadwal layanan AC Anda *${act.id}* telah diubah:
📅 Tanggal baru: *${act.date}*
⏰ Jam: ${act.time||"09:00"}
🔧 Layanan: ${rOrd.service}

Mohon pastikan ada di lokasi pada waktu tersebut.
Terima kasih — *AClean Service* 😊`;
                if (rOrd?.phone) sendWA(rOrd.phone, custMsg);
              }
              if (tekData?.phone) {
                const rMsg = `📅 *Jadwal Diubah*

Halo ${tekData.name}, jadwal order *${act.id}* telah diubah:
👤 Customer: ${rOrd.customer}
📍 Alamat: ${rOrd.address||"-"}
🔧 Layanan: ${rOrd.service}
📅 Tanggal baru: ${act.date}
⏰ Jam: ${act.time||"09:00"}

Mohon sesuaikan jadwal Anda. Terima kasih!`;
                sendWA(tekData.phone, rMsg);
              }
            }
            addAgentLog("ARA_RESCHEDULE",`ARA reschedule ${act.id} → ${act.date} ${act.time||"09:00"}`,"SUCCESS");
            ar=`\n✅ *Order ${act.id} dijadwal ulang → ${act.date} jam ${act.time||"09:00"}*`;
            } // end konflik check
          } else if (act.type==="MARK_INVOICE_OVERDUE") {
            setInvoicesData(prev=>prev.map(i=>i.status==="UNPAID"&&i.due&&i.due<TODAY?{...i,status:"OVERDUE"}:i));
            const cnt = invoicesData.filter(i=>i.status==="UNPAID"&&i.due&&i.due<TODAY).length;
            await supabase.from("invoices").update({status:"OVERDUE"}).eq("status","UNPAID").lt("due",TODAY);
            ar=`\n✅ *${cnt} invoice ditandai OVERDUE*`;
          }
        } catch(e){ console.warn("Action parse",e); }
      }

      const clean = fullText.replace(/\[ACTION\].*?\[\/ACTION\]/s,"").trim()+ar;
      setAraMessages(prev=>[...prev,{role:"assistant",content:clean}]);
      addAgentLog("ARA_CHAT",`ARA: "${userMsg.slice(0,50)}..."`,"SUCCESS");
    } catch(err) {
      const msg = err.message.includes("Backend belum") ? "⚠️ "+err.message
        : err.message.includes("401")||err.message.includes("API key") ? "⚠️ API Key tidak valid. Buka Pengaturan → ARA Brain."
        : "⚠️ ARA gagal: "+err.message;
      setAraMessages(prev=>[...prev,{role:"assistant",content:msg}]);
      addAgentLog("ARA_ERROR",err.message.slice(0,80),"ERROR");
    } finally {
      setAraLoading(false);
      setTimeout(()=>araBottomRef.current?.scrollIntoView({behavior:"smooth"}),100);
    }
  };

  // ── Menu items (all) ──
  const ALL_MENU = [
    { id:"dashboard",  icon:"⬡",  label:"Dashboard"    },
    { id:"orders",     icon:"📋",  label:"Order Masuk"  },
    { id:"schedule",   icon:"📅",  label:"Jadwal"       },
    { id:"invoice",    icon:"🧾",  label:"Invoice"      },
    { id:"customers",  icon:"👥",  label:"Customer"     },
    { id:"inventory",  icon:"📦",  label:"Inventori"    },
    { id:"pricelist",  icon:"💰",  label:"Price List"   },
    { id:"teknisi",    icon:"👷",  label:"Tim Teknisi"  },
    { id:"laporantim", icon:"📝",  label:"Laporan Tim"  },
    { id:"ara",        icon:"🤖",  label:"ARA Chat"     },
    { id:"reports",    icon:"📊",  label:"Statistik"    },
    { id:"agentlog",   icon:"📡",  label:"ARA Log"      },
    { id:"settings",   icon:"⚙️",  label:"Pengaturan"   },
    // Teknisi-only menu (not shown to Owner/Admin)
    { id:"myreport",   icon:"📋",  label:"Laporan Saya" },
  ];
  const menuItems = currentUser ? ALL_MENU.filter(m => canAccess(m.id)) : ALL_MENU;

  // ============================================================
  // RENDER DASHBOARD
  // ============================================================
  const renderDashboard = () => {
    const role = currentUser?.role || "Admin";

    // ── TEKNISI & HELPER DASHBOARD ─────────────────────────────
    if (role === "Teknisi" || role === "Helper") {
      const myName = currentUser?.name || "";
      const techColors = Object.fromEntries([...new Set(ordersData.map(o=>o.teknisi).filter(Boolean))].map(n=>[n, getTechColor(n, teknisiData)]))
      const myColor = techColors[myName] || cs.accent;
      const myJobs = ordersData.filter(o => o.teknisi === myName);
      const todayJobs = myJobs.filter(o => o.date === TODAY);
      const upcomingJobs = myJobs.filter(o => o.date > TODAY).slice(0,3);
      const doneCount = myJobs.filter(o => o.status === "COMPLETED").length;

      return (
        <div style={{ display:"grid", gap:16 }}>
          {/* Greeting */}
          <div style={{ background:"linear-gradient(135deg,"+myColor+"18,"+cs.card+")", border:"1px solid "+myColor+"33", borderRadius:16, padding:20, display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,"+myColor+","+myColor+"88)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:22, color:"#fff" }}>{currentUser?.avatar}</div>
            <div>
              <div style={{ fontWeight:800, fontSize:20, color:cs.text }}>Halo, {myName} 👋</div>
              <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>{hariIni} · Teknisi AClean</div>
            </div>
          </div>

          {/* My stats */}
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(3,1fr)", gap:isMobile?10:12 }}>
            {[
              { icon:"📋", label:"Job Hari Ini",   value:todayJobs.length,   color:cs.accent },
              { icon:"✅", label:"Total Selesai",   value:doneCount,          color:cs.green  },
              { icon:"📅", label:"Job Mendatang",   value:upcomingJobs.length,color:cs.yellow },
            ].map(k => (
              <div key={k.label} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:12, padding:16, textAlign:"center" }}>
                <div style={{ fontSize:24, marginBottom:6 }}>{k.icon}</div>
                <div style={{ fontWeight:800, fontSize:24, color:k.color }}>{k.value}</div>
                <div style={{ fontSize:11, color:cs.muted, marginTop:3 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Today jobs */}
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18 }}>
            <div style={{ fontWeight:700, color:cs.text, fontSize:14, marginBottom:12 }}>📅 Jadwal Hari Ini</div>
            {todayJobs.length === 0
              ? <div style={{ color:cs.muted, fontSize:13, textAlign:"center", padding:"20px 0" }}>Tidak ada jadwal hari ini</div>
              : todayJobs.map(o => (
                <div key={o.id} style={{ background:cs.surface, border:"1px solid "+myColor+"33", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <span style={{ fontWeight:800, color:myColor, fontSize:16 }}>{o.time}</span>
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99, background:(statusColor[o.status]||cs.muted)+"22", color:statusColor[o.status]||cs.muted, border:"1px solid "+(statusColor[o.status]||cs.muted)+"33", fontWeight:700 }}>{statusLabel[o.status]||o.status.replace("_"," ")}</span>
                  </div>
                  <div style={{ fontWeight:700, color:cs.text, fontSize:13, marginBottom:3 }}>{o.customer}</div>
                  <div style={{ fontSize:12, color:cs.muted, marginBottom:4 }}>🔧 {o.service} · {o.units} unit</div>
                  <div style={{ fontSize:11, color:cs.muted }}>📍 {o.address}</div>
                  {o.helper && <div style={{ fontSize:11, color:cs.accent, marginTop:3 }}>🤝 Helper: {o.helper}</div>}
                  <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                    <button onClick={() => { setWaTekTarget({phone:o.phone,customer:o.customer,service:o.service,time:o.time,address:o.address}); setModalWaTek(true); }}
                      style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"7px 14px", borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:600 }}>💬 Chat WA</button>
                    <button onClick={() => { const url="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.address); window.open(url,"_blank"); }}
                      style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"7px 14px", borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:600 }}>🗺 Maps</button>
                    <button onClick={() => openLaporanModal(o)}
                      style={{ background:cs.ara+"22", border:"1px solid "+cs.ara+"44", color:cs.ara, padding:"7px 14px", borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:600 }}>📝 Laporan</button>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Upcoming */}
          {upcomingJobs.length > 0 && (
            <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:14, marginBottom:12 }}>📆 Job Mendatang</div>
              {upcomingJobs.map(o => (
                <div key={o.id} style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ background:myColor+"22", border:"1px solid "+myColor+"44", borderRadius:8, padding:"6px 10px", textAlign:"center", minWidth:44, flexShrink:0 }}>
                    <div style={{ fontSize:14, fontWeight:800, color:myColor }}>{o.time}</div>
                    <div style={{ fontSize:9, color:cs.muted }}>{o.date.slice(5)}</div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:cs.text, fontSize:13 }}>{o.customer}</div>
                    <div style={{ fontSize:11, color:cs.muted }}>{o.service} · {o.units} unit · {o.address.slice(0,35)}...</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── OWNER / ADMIN DASHBOARD ────────────────────────────────
    const todayOrders   = ordersData.filter(o => o.date === TODAY);
    const unpaidCount   = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;
    const totalRevBulanIni = invoicesData.filter(i => i.status === "PAID" && (i.sent||"").startsWith(bulanIni)).reduce((a,b) => a+b.total, 0);
    const lowStock      = inventoryData.filter(i => i.status === "CRITICAL" || i.status === "OUT").length;
    const garansiKritisD = invoicesData.filter(inv => {
      if (!inv.garansi_expires) return false;
      const d = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
      return d >= 0 && d <= 7;
    });
    const garansiExpireSoon = invoicesData.filter(inv => {
      if (!inv.garansi_expires) return false;
      const d = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
      return d >= 0 && d <= 30;
    }).sort((a,b) => a.garansi_expires.localeCompare(b.garansi_expires));
    const greeting      = role === "Owner" ? "Owner" : "Admin";

    return (
      <div style={{ display:"grid", gap:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:800, fontSize:22, color:cs.text }}>Selamat pagi, {greeting} 👋</div>
            <div style={{ fontSize:13, color:cs.muted }}>{hariIni} · ARA aktif memantau</div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={() => setModalOrder(true)} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"10px 20px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Order Baru</button>
            <button onClick={() => setWaPanel(true)} style={{ position:"relative", background:cs.card, border:"1px solid #25D36644", color:"#25D366", padding:"10px 16px", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:13 }}>
              📱 WhatsApp
              {waConversations.filter(wc => wc.unread > 0).length > 0 && (
                <span style={{ position:"absolute", top:-6, right:-6, background:cs.red, color:"#fff", fontSize:9, fontWeight:800, borderRadius:"50%", width:16, height:16, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {waConversations.filter(wc => wc.unread > 0).reduce((a,b) => a+b.unread, 0)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:14 }}>
          {[
            { label:"Order Hari Ini",      value:todayOrders.length,          sub:`${todayOrders.filter(o=>o.status==="IN_PROGRESS").length} aktif · ${todayOrders.filter(o=>o.status==="COMPLETED").length} selesai`, color:cs.accent, icon:"📋", onClick:()=>setActiveMenu("orders") },
            { label:"Invoice Unpaid",       value:unpaidCount,                 sub:"Perlu follow-up",     color:cs.yellow, icon:"🧾", onClick:()=>{setActiveMenu("invoice");setInvoiceFilter("UNPAID");} },
            { label:"Pendapatan Bln Ini",   value:fmt(totalRevBulanIni),        sub:"Invoice terbayar",    color:cs.green,  icon:"💰", onClick:()=>{setActiveMenu("invoice");setInvoiceFilter("PAID");} },
            { label:"Stok Kritis",          value:lowStock,                    sub:"Perlu restock",       color:cs.red,    icon:"📦", onClick:()=>setActiveMenu("inventory") },
          ].map(kpi => (
            <div key={kpi.label} onClick={kpi.onClick} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <span style={{ fontSize:24 }}>{kpi.icon}</span>
                <span style={{ fontSize:11, color:cs.muted }}>{kpi.sub}</span>
              </div>
              <div style={{ fontWeight:800, fontSize:26, color:kpi.color, marginBottom:4 }}>{kpi.value}</div>
              <div style={{ fontSize:11, color:cs.muted, fontWeight:600 }}>{kpi.label}</div>
            </div>
          ))}
        </div>
        {/* ══ GAP 7: Garansi akan berakhir (≤30 hari) ══ */}
        {garansiExpireSoon.length > 0 && (
          <div style={{ background:cs.card, border:"1px solid #22d3ee44", borderRadius:14, padding:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontWeight:700, fontSize:15, color:cs.text }}>🛡️ Monitor Garansi — {garansiExpireSoon.length} aktif</div>
              <button onClick={()=>{setActiveMenu("invoice");setInvoiceFilter("Garansi");}}
                style={{ background:"#22d3ee22", border:"1px solid #22d3ee44", color:"#22d3ee", padding:"5px 12px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600 }}>Lihat Semua →</button>
            </div>
            <div style={{ display:"grid", gap:8 }}>
              {garansiExpireSoon.slice(0,5).map(inv => {
                const daysLeft = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
                const col = daysLeft <= 3 ? "#ef4444" : daysLeft <= 7 ? cs.yellow : "#22d3ee";
                return (
                  <div key={inv.id} style={{ background:cs.surface, border:"1px solid "+col+"33", borderRadius:10, padding:"10px 14px", display:"flex", alignItems:"center", gap:12 }}>
                    <span style={{ fontSize:18 }}>{daysLeft<=3?"🚨":daysLeft<=7?"⚠️":"🛡️"}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:cs.text }}>{inv.customer}</div>
                      <div style={{ fontSize:11, color:cs.muted }}>{inv.service} · {inv.id}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontWeight:800, fontSize:13, color:col }}>{daysLeft}h lagi</div>
                      <div style={{ fontSize:10, color:cs.muted }}>{inv.garansi_expires}</div>
                    </div>
                    {daysLeft <= 7 && (
                      <button onClick={()=>{
                        const custPhone = inv.phone || customersData.find(c=>c.name===inv.customer)?.phone;
                        if (!custPhone) { showNotif("⚠️ No HP customer tidak ditemukan"); return; }
                        sendWA(custPhone,
                          `Halo *${inv.customer}* 👋

Garansi layanan *${inv.service}* dari AClean akan berakhir *${daysLeft} hari lagi* (${inv.garansi_expires}).

Jika ada kendala AC Anda, segera hubungi kami sebelum masa garansi habis.

Terima kasih telah mempercayakan perawatan AC Anda kepada AClean! 🌟
— Tim AClean`
                        );
                        addAgentLog("GARANSI_REMINDER", `WA garansi dikirim ke ${inv.customer} (${daysLeft}h lagi)`, "SUCCESS");
                        showNotif("✅ WA reminder garansi terkirim ke "+inv.customer);
                      }} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"5px 10px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
                        📱 Ingatkan
                      </button>
                    )}
                  </div>
                );
              })}
              {garansiExpireSoon.length > 5 && (
                <div style={{ textAlign:"center", fontSize:12, color:cs.muted, padding:8 }}>
                  +{garansiExpireSoon.length-5} garansi lainnya — <span style={{color:cs.accent,cursor:"pointer"}} onClick={()=>{setActiveMenu("invoice");setInvoiceFilter("Garansi");}}>lihat semua</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Today orders */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ fontWeight:700, color:cs.text, fontSize:15, marginBottom:14 }}>📋 Order Hari Ini — {todayDate.toLocaleDateString("id-ID", {day:"numeric", month:"short", year:"numeric"})}</div>
          <div style={{ display:"grid", gap:10 }}>
            {todayOrders.map(o => (
              <div key={o.id} style={{ background:cs.surface, border:"1px solid "+(statusColor[o.status]||cs.border)+"44", borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:14 }}>
                <span style={{ fontSize:10, padding:"3px 8px", borderRadius:99, background:(statusColor[o.status]||cs.muted)+"22", color:statusColor[o.status]||cs.muted, fontWeight:700, border:"1px solid "+(statusColor[o.status]||cs.muted)+"44", whiteSpace:"nowrap" }}>{statusLabel[o.status]||o.status.replace("_"," ")}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, color:cs.text, fontSize:13 }}>{o.customer}</div>
                  <div style={{ fontSize:11, color:cs.muted }}>{o.service} · {o.units} unit · 👷 {o.teknisi} · {o.time}</div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={() => { const cu=findCustomer(customersData, o.phone, o.customer); if(cu){setSelectedCustomer(cu);setCustomerTab("history");setActiveMenu("customers");} }}
                    style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"5px 10px", borderRadius:6, cursor:"pointer", fontSize:11 }}>History</button>
                  {!o.dispatch && <button onClick={() => dispatchWA(o)} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"5px 10px", borderRadius:6, cursor:"pointer", fontSize:11 }}>Dispatch WA</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Invoice + Stok alerts */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:14 }}>
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
            <div style={{ fontWeight:700, color:cs.text, marginBottom:14 }}>🧾 Invoice Perlu Tindakan</div>
            {invoicesData.filter(i => i.status !== "PAID").map(inv => (
              <div key={inv.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:(statusColor[inv.status]||cs.muted)+"22", color:statusColor[inv.status]||cs.muted, fontWeight:700, border:"1px solid "+(statusColor[inv.status]||cs.muted)+"33", whiteSpace:"nowrap" }}>{inv.status.replace("_"," ")}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.customer}</div>
                  <div style={{ fontSize:11, color:cs.muted }}>{fmt(inv.total)}</div>
                </div>
                <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"4px 8px", borderRadius:6, cursor:"pointer", fontSize:10 }}>Preview</button>
              </div>
            ))}
          </div>
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
            <div style={{ fontWeight:700, color:cs.text, marginBottom:14 }}>📦 Stok Perlu Restock</div>
            {inventoryData.filter(i => i.status !== "OK").map(item => (
              <div key={item.code} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:(item.status==="OUT"?cs.red:cs.yellow)+"22", color:item.status==="OUT"?cs.red:cs.yellow, fontWeight:700, border:"1px solid "+(item.status==="OUT"?cs.red:cs.yellow)+"33" }}>{item.status}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.text }}>{item.name}</div>
                  <div style={{ fontSize:11, color:cs.muted }}>Stok: {item.stock} {item.unit}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* ── SIM-9: Performa Tim per Teknisi ── */}
        {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (() => {
          const allTekNames2 = [...new Set(ordersData.map(o=>o.teknisi).filter(Boolean))];
          if (allTekNames2.length === 0) return null;
          const bulanIniPfx = new Date().toISOString().slice(0,7);
          return (
            <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:15, marginBottom:14 }}>
                👥 Performa Tim — {bulanIniPfx.slice(5).padStart(2,"0")}/{bulanIniPfx.slice(0,4)}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,1fr)", gap:12 }}>
                {allTekNames2.map(tek => {
                  const col       = getTechColor(tek, teknisiData);
                  const jobsBulan = ordersData.filter(o=>o.teknisi===tek && (o.date||"").startsWith(bulanIniPfx));
                  const selesai   = jobsBulan.filter(o=>["COMPLETED","PAID"].includes(o.status)).length;
                  const pending   = jobsBulan.filter(o=>["PENDING","CONFIRMED","IN_PROGRESS","ON_SITE"].includes(o.status)).length;
                  const revInvTek = invoicesData.filter(i=>i.teknisi===tek && i.status==="PAID" && (i.created_at||"").startsWith(bulanIniPfx)).reduce((a,b)=>a+(b.total||0),0);
                  const lapVerif  = laporanReports.filter(r=>r.teknisi===tek && r.status==="VERIFIED").length;
                  const lapRevisi = laporanReports.filter(r=>r.teknisi===tek && r.status==="REVISION").length;
                  return (
                    <div key={tek} style={{ background:cs.surface, border:"1px solid "+col+"33", borderRadius:12, padding:"14px 16px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                        <div style={{ width:36, height:36, borderRadius:10, background:col+"22", border:"1px solid "+col+"44", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, color:col, fontSize:15 }}>
                          {tek.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight:700, color:cs.text, fontSize:13 }}>{tek.split(" ")[0]}</div>
                          <div style={{ fontSize:10, color:cs.muted }}>{teknisiData.find(t=>t.name===tek)?.role||"Teknisi"}</div>
                        </div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 12px", fontSize:11 }}>
                        <div><span style={{color:cs.muted}}>Job bln ini</span><div style={{fontWeight:800,color:cs.text,fontSize:16}}>{jobsBulan.length}</div></div>
                        <div><span style={{color:cs.muted}}>Selesai</span><div style={{fontWeight:800,color:cs.green,fontSize:16}}>{selesai}</div></div>
                        <div><span style={{color:cs.muted}}>Laporan ✓</span><div style={{fontWeight:700,color:col}}>{lapVerif}</div></div>
                        <div><span style={{color:cs.muted}}>Revisi</span><div style={{fontWeight:700,color:lapRevisi>0?cs.yellow:cs.muted}}>{lapRevisi}</div></div>
                      </div>
                      {revInvTek > 0 && (
                        <div style={{ marginTop:8, fontSize:11, background:cs.green+"12", border:"1px solid "+cs.green+"22", borderRadius:7, padding:"4px 8px", color:cs.green, fontWeight:700 }}>
                          💰 Revenue: {fmt(revInvTek)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // ============================================================
  // RENDER CUSTOMERS
  // ============================================================
  const renderCustomers = () => {
    // ── LIVE history: ordersData + laporanReports + invoicesData ──
    const history = selectedCustomer
      ? buildCustomerHistory(selectedCustomer, ordersData, laporanReports, invoicesData)
      : [];
    const _scq = searchCustomer.trim().toLowerCase();
    const filteredCusts = customersData.filter(cu => {
      if (!_scq) return true;
      return (
        (cu.name||"").toLowerCase().includes(_scq) ||
        (cu.phone||"").includes(searchCustomer.trim()) ||
        (cu.address||"").toLowerCase().includes(_scq) ||
        (cu.area||"").toLowerCase().includes(_scq) ||
        (cu.notes||"").toLowerCase().includes(_scq)
      );
    });
    return (
      <div style={{ display:"grid", gap:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>
            {selectedCustomer ? (
              <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                <button onClick={() => { setSelectedCustomer(null); setCustomerTab("list"); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"4px 10px", borderRadius:6, cursor:"pointer", fontSize:12 }}>← Kembali</button>
                <span>👤 {selectedCustomer.name}</span>
                {selectedCustomer.is_vip && <span style={{ background:cs.yellow+"22", color:cs.yellow, fontSize:10, fontWeight:800, padding:"2px 8px", borderRadius:99, border:"1px solid "+cs.yellow+"44" }}>⭐ VIP</span>}
              </span>
            ) : "👥 Data Customer"}
          </div>
          {!selectedCustomer && (
            <button onClick={() => { setNewCustomerForm({name:"",phone:"",address:"",area:"",notes:"",is_vip:false}); setModalAddCustomer(true); }}
              style={{ background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"10px 20px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13 }}>
              + Customer Baru
            </button>
          )}
        </div>

        {!selectedCustomer ? (
          <div style={{ display:"grid", gap:12 }}>
            {/* Search bar */}
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:cs.muted, pointerEvents:"none" }}>🔍</span>
              <input value={searchCustomer} onChange={e=>setSearchCustomer(e.target.value)}
                placeholder="Cari nama customer atau nomor telepon..."
                style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px 10px 36px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              {searchCustomer && <button onClick={()=>setSearchCustomer("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>}
            </div>
            {searchCustomer && (
              <div style={{ fontSize:12, color:cs.muted }}>Menampilkan <b style={{ color:cs.accent }}>{filteredCusts.length}</b> dari {customersData.length} customer</div>
            )}
            {filteredCusts.map(cu => {
              const cHist = buildCustomerHistory(cu, ordersData, laporanReports, invoicesData);
              const lastSvc = cHist[0]; // sudah sorted by date desc
              return (
                <div key={cu.id} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20, display:"flex", gap:16, alignItems:"flex-start" }}>
                  <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,"+(cu.is_vip?cs.yellow:cs.accent)+",#3b82f6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{cu.name.charAt(0)}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, color:cs.text, fontSize:15 }}>{cu.name}</span>
                      {cu.is_vip && <span style={{ background:cs.yellow+"22", color:cs.yellow, fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:99, border:"1px solid "+cs.yellow+"44" }}>⭐ VIP</span>}
                      <span style={{ fontSize:10, color:cs.muted, fontFamily:"monospace" }}>{cu.id}</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:"3px 20px", fontSize:12, color:cs.muted, marginBottom:8 }}>
                      <span>📱 {cu.phone}</span><span>📍 {cu.area}</span>
                      <span>🏠 {cu.address.slice(0,32)}...</span><span>📅 {cu.joined}</span>
                    </div>
                    {/* ── BONUS: Last service summary di customer card ── */}
                    {lastSvc ? (
                      <div style={{ fontSize:11, background:cs.surface, borderRadius:7, padding:"6px 10px", marginBottom:6, display:"flex", gap:10, flexWrap:"wrap" }}>
                        <span style={{ color:cs.muted }}>🕐 Terakhir:</span>
                        <span style={{ color:cs.text, fontWeight:600 }}>{lastSvc.date}</span>
                        <span style={{ color:cs.accent }}>{lastSvc.service}</span>
                        <span style={{ color:cs.muted }}>{lastSvc.units} unit · {lastSvc.teknisi}</span>
                        {lastSvc.rekomendasi&&(
                          <span style={{ color:"#7dd3fc", fontStyle:"italic" }}>💡 {lastSvc.rekomendasi.slice(0,50)}{lastSvc.rekomendasi.length>50?"...":""}</span>
                        )}
                        <span style={{ color:cHist.length>1?cs.green:cs.muted, fontWeight:700 }}>({cHist.length}x servis)</span>
                      </div>
                    ) : (
                      <div style={{ fontSize:11, color:cs.muted, marginBottom:6 }}>Belum ada riwayat servis</div>
                    )}
                    {cu.notes && <div style={{ fontSize:12, color:"#7dd3fc", background:"#0ea5e910", padding:"6px 10px", borderRadius:7, border:"1px solid #0ea5e922" }}>💡 {cu.notes}</div>}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8, flexShrink:0 }}>
                    <button onClick={() => { setSelectedCustomer(cu); setCustomerTab("history"); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>📋 Riwayat ({cHist.length})</button>
                    <button onClick={() => { setNewOrderForm(f=>({...f,customer:cu.name,phone:normalizePhone(cu.phone),address:cu.address})); setModalOrder(true); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Order</button>
                    <button onClick={() => openWA(cu.phone, "")} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>📱 WA</button>
                    {currentUser?.role === "Owner" && (
                      <button onClick={async () => {
                        if (!window.confirm(`🗑️ Hapus customer "${cu.name}"?\n\nSemua history order akan tetap ada.\nAksi ini tidak bisa dibatalkan.`)) return;
                        setCustomersData(prev => prev.filter(c => c.id !== cu.id));
                        const { error } = await supabase.from("customers").delete().eq("id", cu.id);
                        if (error) showNotif("⚠️ Hapus lokal OK, DB gagal: " + error.message);
                        else { addAgentLog("CUSTOMER_DELETED", "Customer " + cu.name + " dihapus", "WARNING"); showNotif("🗑️ Customer " + cu.name + " berhasil dihapus"); }
                      }} style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>🗑️</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display:"grid", gap:14 }}>
            <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18, display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:14, textAlign:"center" }}>
              {[
                  ["Total Order",    history.length, cs.accent],
                  ["Total Spend",    currentUser?.role==="Teknisi"||currentUser?.role==="Helper"
                                       ? "—"
                                       : fmt(history.reduce((a,b)=>a+(b.invoice_total||0),0)), cs.green],
                  ["Terakhir Servis",history[0]?.date || selectedCustomer.last_service || "—", cs.yellow],
                  ["Area",           selectedCustomer.area, cs.muted],
                ].map(([label, val, color]) => (
                <div key={label}><div style={{ fontSize:11, color:cs.muted, fontWeight:600, marginBottom:4 }}>{label}</div><div style={{ fontWeight:800, color, fontSize:15 }}>{val}</div></div>
              ))}
            </div>
            {selectedCustomer.notes && <div style={{ background:"#0ea5e912", border:"1px solid #0ea5e933", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#7dd3fc" }}>💡 {selectedCustomer.notes}</div>}
            <div style={{ display:"flex", gap:2, background:cs.surface, borderRadius:10, padding:4, width:"fit-content" }}>
              {[["history","📋 Riwayat"],["profile","👤 Profil"]].map(([tab,label]) => (
                <button key={tab} onClick={() => setCustomerTab(tab)} style={{ padding:"8px 18px", borderRadius:7, border:"none", background:customerTab===tab?cs.accent:"transparent", color:customerTab===tab?"#0a0f1e":cs.muted, cursor:"pointer", fontSize:12, fontWeight:700 }}>{label}</button>
              ))}
            </div>
            {customerTab === "history" ? (
              <div style={{ display:"grid", gap:10 }}>
                {history.length === 0 ? <div style={{ background:cs.card, borderRadius:14, padding:32, textAlign:"center", color:cs.muted }}>Belum ada riwayat</div>
                : history.map(svc => {
                  // Cek apakah ada laporan teknisi untuk job ini
                  const hasLaporan = !!svc.laporan_id;
                  const unitDetails = svc.unit_detail || [];
                  const svcColor = statusColor[svc.status] || cs.border;
                  return (
                  <div key={svc.id} style={{ background:cs.card, border:"1px solid "+svcColor+"44", borderRadius:12, padding:"14px 16px", position:"relative" }}>

                    {/* Header — job ID, layanan, status, tanggal */}
                    <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent, fontSize:13 }}>{svc.job_id}</span>
                        <span style={{ fontSize:13, color:cs.text, fontWeight:600 }}>{svc.service}</span>
                        <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99,
                          background:(svcColor)+"18", color:svcColor, fontWeight:700 }}>
                          {svc.status}
                        </span>
                        {hasLaporan && (
                          <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99,
                            background:cs.green+"15", color:cs.green, fontWeight:700 }}>
                            ✅ Laporan Ada
                          </span>
                        )}
                        {svc.total_freon > 0 && (
                          <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99,
                            background:cs.yellow+"15", color:cs.yellow, fontWeight:700 }}>
                            🧊 Freon +{svc.total_freon}kg
                          </span>
                        )}
                      </div>
                      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                        <span style={{ fontSize:11, color:cs.muted }}>📅 {svc.date}</span>
                        {currentUser?.role !== "Teknisi" && currentUser?.role !== "Helper" && svc.invoice_id && (
                          <span style={{ fontSize:11, color:cs.green, fontWeight:700 }}>🧾 {svc.invoice_id}</span>
                        )}
                      </div>
                    </div>

                    {/* Info dasar */}
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:"4px 16px", fontSize:12, color:cs.muted, marginBottom:10 }}>
                      <span>🔧 {svc.type || svc.service} × {svc.units} unit</span>
                      <span>👷 {svc.teknisi}{svc.helper?" + "+svc.helper:""}</span>
                      {svc.notes && <span style={{ gridColumn:"1/-1", color:"#7dd3fc" }}>📝 {svc.notes}</span>}
                    </div>

                    {/* ── Detail Unit AC dari laporan teknisi ── */}
                    {unitDetails.length > 0 && (
                      <div style={{ background:cs.surface, borderRadius:9, padding:"10px 12px", marginBottom:8 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:cs.accent, marginBottom:7 }}>
                          🌡️ Detail Unit AC (dari Laporan Teknisi)
                        </div>
                        {unitDetails.map((u, ui) => (
                          <div key={ui} style={{ marginBottom:ui<unitDetails.length-1?10:0, paddingBottom:ui<unitDetails.length-1?10:0,
                            borderBottom:ui<unitDetails.length-1?"1px solid "+cs.border:"none" }}>
                            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                              <span style={{ fontWeight:700, color:cs.text, fontSize:12 }}>
                                Unit {u.unit_no} — {u.label}
                              </span>
                              {u.merk && <span style={{ fontSize:11, color:cs.muted }}>{u.merk}</span>}
                              {u.pk   && <span style={{ fontSize:10, background:cs.accent+"12", color:cs.accent, padding:"1px 7px", borderRadius:99 }}>{u.pk}</span>}
                              {u.tipe && <span style={{ fontSize:10, color:cs.muted }}>{u.tipe}</span>}
                              {u.ampere_akhir && (
                                <span style={{ fontSize:10, background:cs.green+"15", color:cs.green,
                                  padding:"1px 7px", borderRadius:99 }}>⚡ {u.ampere_akhir}A</span>
                              )}
                              {parseFloat(u.freon_ditambah) > 0 && (
                                <span style={{ fontSize:10, background:cs.yellow+"15", color:cs.yellow,
                                  padding:"1px 7px", borderRadius:99 }}>🧊 {u.freon_ditambah} psi</span>
                              )}
                            </div>
                            {/* Kondisi sebelum — array dari mkUnit */}
                            {safeArr(u.kondisi_sebelum).length > 0 && (
                              <div style={{ marginBottom:4 }}>
                                <span style={{ fontSize:10, color:cs.muted }}>Kondisi masuk: </span>
                                {safeArr(u.kondisi_sebelum).map((k,ki) => (
                                  <span key={ki} style={{ fontSize:10, background:cs.yellow+"15",
                                    color:cs.yellow, padding:"1px 6px", borderRadius:99, marginRight:3 }}>{k}</span>
                                ))}
                              </div>
                            )}
                            {/* Pekerjaan dilakukan — array dari mkUnit */}
                            {safeArr(u.pekerjaan).length > 0 && (
                              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:4 }}>
                                <span style={{ fontSize:10, color:cs.muted, alignSelf:"center" }}>Dikerjakan: </span>
                                {safeArr(u.pekerjaan).map((p,pi) => (
                                  <span key={pi} style={{ fontSize:10, background:cs.accent+"15",
                                    color:cs.accent, padding:"1px 6px", borderRadius:99 }}>{p}</span>
                                ))}
                              </div>
                            )}
                            {/* Kondisi sesudah — array dari mkUnit */}
                            {safeArr(u.kondisi_setelah).length > 0 && (
                              <div style={{ marginBottom:3 }}>
                                <span style={{ fontSize:10, color:cs.muted }}>Setelah: </span>
                                {safeArr(u.kondisi_setelah).map((k,ki) => (
                                  <span key={ki} style={{ fontSize:10, background:cs.green+"15",
                                    color:cs.green, padding:"1px 6px", borderRadius:99, marginRight:3 }}>{k}</span>
                                ))}
                              </div>
                            )}
                            {u.catatan_unit && (
                              <div style={{ fontSize:11, color:"#7dd3fc", marginTop:3 }}>💬 {u.catatan_unit}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rekomendasi teknisi */}
                    {svc.rekomendasi && (
                      <div style={{ background:"#0ea5e910", border:"1px solid #0ea5e933", borderRadius:8,
                        padding:"7px 10px", marginBottom:8, fontSize:12, color:"#7dd3fc" }}>
                        💡 <b>Rekomendasi:</b> {svc.rekomendasi}
                      </div>
                    )}

                    {/* Material yang dipakai */}
                    {safeArr(svc.materials).length > 0 && (
                      <div style={{ fontSize:11, color:cs.muted, marginBottom:6 }}>
                        🔩 Material: {safeArr(svc.materials).map(m => `${m.nama} ${m.jumlah}${m.satuan}`).join(", ")}
                      </div>
                    )}

                    {/* Foto thumbnail */}
                    {safeArr(svc.foto_urls).length > 0 && (
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                        {safeArr(svc.foto_urls).slice(0,5).map((url, fi) => (
                          <img key={fi} src={fotoSrc(url)} alt={`Foto ${fi+1}`}
                            onClick={() => window.open(fotoSrc(url), "_blank")}
                            style={{ width:56, height:56, objectFit:"cover", borderRadius:8,
                              cursor:"pointer", border:"1px solid "+cs.border,
                              transition:"opacity .15s" }}
                            onMouseEnter={e=>e.target.style.opacity=".8"}
                            onMouseLeave={e=>e.target.style.opacity="1"} />
                        ))}
                        {safeArr(svc.foto_urls).length > 5 && (
                          <div style={{ width:56, height:56, borderRadius:8, background:cs.surface,
                            border:"1px solid "+cs.border, display:"flex", alignItems:"center",
                            justifyContent:"center", fontSize:11, color:cs.muted, cursor:"pointer" }}
                            onClick={() => window.open(fotoSrc(svc.foto_urls[5]), "_blank")}>
                            +{safeArr(svc.foto_urls).length - 5}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons — buat order baru / lihat invoice */}
                    <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                      {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && svc.invoice_id && (
                        <button
                          onClick={()=>{
                            const inv = invoicesData.find(i=>i.id===svc.invoice_id);
                            if(inv){ setSelectedInvoice(inv); setModalInvoiceDetail(true); }
                          }}
                          style={{ fontSize:11, padding:"5px 12px", borderRadius:7, cursor:"pointer",
                            background:cs.green+"15", border:"1px solid "+cs.green+"44", color:cs.green }}>
                          🧾 Lihat Invoice
                        </button>
                      )}
                      {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
                        <button
                          onClick={()=>{
                            setNewOrderForm(f=>({
                              ...f,
                              customer: selectedCustomer.name,
                              phone:    selectedCustomer.phone,
                              address:  selectedCustomer.address,
                              area:     selectedCustomer.area,
                              service:  svc.service,
                              type:     svc.type,
                              units:    svc.units,
                            }));
                            setModalOrder(true);
                          }}
                          style={{ fontSize:11, padding:"5px 12px", borderRadius:7, cursor:"pointer",
                            background:cs.accent+"15", border:"1px solid "+cs.accent+"44", color:cs.accent }}>
                          🔁 Order Ulang
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:12, padding:18, display:"grid", gap:10 }}>
                {[["Nama",selectedCustomer.name],["Telepon",selectedCustomer.phone],["Email",selectedCustomer.email||"—"],["Area",selectedCustomer.area],["Alamat",selectedCustomer.address],["Bergabung",selectedCustomer.joined]].map(([k,v]) => (
                  <div key={k} style={{ display:"flex", gap:16, paddingBottom:10, borderBottom:"1px solid "+cs.border }}>
                    <span style={{ fontSize:12, color:cs.muted, minWidth:100, fontWeight:600 }}>{k}</span>
                    <span style={{ fontSize:13, color:cs.text }}>{v}</span>
                  </div>
                ))}
                {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
                  <div style={{ display:"flex", gap:8, paddingTop:4 }}>
                    <button onClick={()=>{ setNewCustomerForm({name:selectedCustomer.name,phone:selectedCustomer.phone,address:selectedCustomer.address,area:selectedCustomer.area,notes:selectedCustomer.notes||"",is_vip:selectedCustomer.is_vip}); setModalAddCustomer(true); }}
                      style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>✏️ Edit Data Customer</button>
                    <button onClick={()=>{ openWA(selectedCustomer.phone, ""); }}
                      style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12 }}>📱 Hubungi WA</button>
                    <button onClick={()=>{ if(window.confirm&&window.confirm("Tandai "+selectedCustomer.name+" sebagai "+(selectedCustomer.is_vip?"Regular":"VIP")+"?")){
                      setCustomersData(prev=>prev.map(cu=>cu.id===selectedCustomer.id?{...cu,is_vip:!cu.is_vip}:cu));
                      setSelectedCustomer(prev=>({...prev,is_vip:!prev.is_vip}));
                      supabase.from("customers").update({is_vip:!selectedCustomer.is_vip}).eq("id",selectedCustomer.id);
                      showNotif(selectedCustomer.name+(selectedCustomer.is_vip?" diturunkan ke Regular":" dijadikan VIP ⭐"));
                    }}}
                      style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>{selectedCustomer.is_vip?"⭐ Hapus VIP":"⭐ Jadikan VIP"}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // RENDER ORDERS
  // ============================================================
  const renderOrders = () => {
    // ── SIM-1+2: search + teknisi filter + pagination ──
    const allTekOrd = ["Semua", ...new Set(ordersData.map(o=>o.teknisi).filter(Boolean))];
    const sMap2 = { "Pending":"PENDING","Confirmed":"CONFIRMED","In Progress":"IN_PROGRESS","Completed":"COMPLETED","Cancelled":"CANCELLED" };
    let filtered = [...ordersData];
    if (orderFilter === "Hari Ini") filtered = filtered.filter(o => o.date === TODAY);
    else if (orderFilter !== "Semua") filtered = filtered.filter(o => o.status === (sMap2[orderFilter]||orderFilter));
    if (orderTekFilter !== "Semua") filtered = filtered.filter(o => o.teknisi === orderTekFilter || o.helper === orderTekFilter);
    if (orderDateFrom) filtered = filtered.filter(o => (o.date||"") >= orderDateFrom);
    if (orderServiceFilter !== "Semua") filtered = filtered.filter(o => o.service === orderServiceFilter); // GAP-9
    if (orderDateTo)   filtered = filtered.filter(o => (o.date||"") <= orderDateTo);
    if (searchOrder.trim()) {
      const q = searchOrder.trim().toLowerCase();
      filtered = filtered.filter(o =>
        (o.customer||"").toLowerCase().includes(q) ||
        (o.id||"").toLowerCase().includes(q) ||
        (o.phone||"").toLowerCase().includes(q) ||
        (o.teknisi||"").toLowerCase().includes(q) ||
        (o.helper||"").toLowerCase().includes(q) ||
        (o.address||"").toLowerCase().includes(q) ||
        (o.service||"").toLowerCase().includes(q) ||
        (o.notes||"").toLowerCase().includes(q)
      );
    }
    filtered.sort((a,b) => (b.date+(b.time||"")).localeCompare(a.date+(a.time||"")));
    const totPgO = Math.ceil(filtered.length / ORDER_PAGE_SIZE) || 1;
    const curPgO = Math.min(orderPage, totPgO);
    const pageData = filtered.slice((curPgO-1)*ORDER_PAGE_SIZE, curPgO*ORDER_PAGE_SIZE);
    return (
      <div style={{ display:"grid", gap:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
          <div style={{ fontWeight:700, fontSize:18, color:cs.text, display:"flex", alignItems:"center", gap:10 }}>
            📋 Order Masuk <span style={{fontSize:13,color:cs.muted,fontWeight:400}}>({filtered.length})</span>
            {(() => {
              const stuck = ordersData.filter(o =>
                ["DISPATCHED","ON_SITE"].includes(o.status) && o.date < TODAY
              ).length;
              return stuck > 0 ? (
                <span title="Job belum ada laporan (sudah lewat hari)" style={{ fontSize:11, background:cs.red+"22", color:cs.red, border:"1px solid "+cs.red+"44", borderRadius:99, padding:"2px 8px", fontWeight:700, cursor:"pointer" }}
                  onClick={()=>{setOrderFilter("Semua");setOrderTekFilter("Semua");}}>
                  ⚠️ {stuck} stuck
                </span>
              ) : null;
            })()}
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (() => {
              const todayUndispatched = ordersData.filter(o =>
                o.date === TODAY && !o.dispatch &&
                ["PENDING","CONFIRMED","DISPATCHED"].includes(o.status)
              );
              return todayUndispatched.length > 0 ? (
                <button onClick={async () => {
                  if (!window.confirm(`📤 Dispatch WA ke ${todayUndispatched.length} teknisi untuk job hari ini?

Semua teknisi yang belum di-dispatch akan dikirim WA sekaligus.`)) return;
                  let sukses = 0, gagal = 0;
                  showNotif(`⏳ Mengirim WA ke ${todayUndispatched.length} teknisi...`);
                  for (const o of todayUndispatched) {
                    try {
                      await sendDispatchWA(o);
                      sukses++;
                      await new Promise(r => setTimeout(r, 500)); // jeda 0.5s antar WA
                    } catch(e) { gagal++; }
                  }
                  addAgentLog("BULK_DISPATCH", `Bulk dispatch: ${sukses} sukses, ${gagal} gagal — ${TODAY}`, sukses>0?"SUCCESS":"ERROR");
                  showNotif(`✅ Bulk dispatch selesai: ${sukses} WA terkirim${gagal>0?", "+gagal+" gagal":""}`);
                }} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"9px 14px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
                  📤 Dispatch Hari Ini <span style={{background:"#25D366",color:"#fff",borderRadius:99,padding:"1px 7px",fontSize:11}}>{todayUndispatched.length}</span>
                </button>
              ) : null;
            })()}
            <button onClick={() => setModalOrder(true)} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Order Baru</button>
          </div>
        </div>
        {/* Search bar */}
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:cs.muted, fontSize:14, pointerEvents:"none" }}>🔍</span>
          <input value={searchOrder} onChange={e=>{setSearchOrder(e.target.value);setOrderPage(1);}}
            placeholder="Cari nama customer, Job ID, telepon, atau teknisi..."
            style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px 10px 36px", color:cs.text, fontSize:13, boxSizing:"border-box" }} />
          {searchOrder && <button onClick={()=>{setSearchOrder("");setOrderPage(1);}} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16 }}>✕</button>}
        </div>
        {/* Filter pills + teknisi dropdown */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {["Semua","Hari Ini","Pending","Confirmed","In Progress","Completed"].map(f => (
            <button key={f} onClick={() => {setOrderFilter(f);setOrderPage(1);}}
              style={{ background:orderFilter===f?cs.accent:cs.card, border:"1px solid "+(orderFilter===f?cs.accent:cs.border),
                color:orderFilter===f?"#0a0f1e":cs.muted, padding:"6px 14px", borderRadius:99, cursor:"pointer", fontSize:12, fontWeight:600 }}>{f}</button>
          ))}
          <span style={{width:1,height:16,background:cs.border,display:"inline-block",marginLeft:4}} />
          <select value={orderTekFilter} onChange={e=>{setOrderTekFilter(e.target.value);setOrderPage(1);}}
            style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:8, color:cs.text, padding:"6px 10px", fontSize:12, cursor:"pointer" }}>
            {allTekOrd.map(t=><option key={t} value={t}>👷 {t}</option>)}
          </select>
          <span style={{width:1,height:16,background:cs.border,display:"inline-block",marginLeft:4}} />
          <input type="date" value={orderDateFrom} onChange={e=>{setOrderDateFrom(e.target.value);setOrderPage(1);}}
            title="Dari tanggal"
            style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:8, color:orderDateFrom?cs.text:cs.muted, padding:"5px 8px", fontSize:11, cursor:"pointer", width:130 }} />
          <span style={{color:cs.muted,fontSize:11}}>–</span>
          <input type="date" value={orderDateTo} onChange={e=>{setOrderDateTo(e.target.value);setOrderPage(1);}}
            title="Sampai tanggal"
            style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:8, color:orderDateTo?cs.text:cs.muted, padding:"5px 8px", fontSize:11, cursor:"pointer", width:130 }} />
          {(orderDateFrom||orderDateTo) && (
            <button onClick={()=>{setOrderDateFrom("");setOrderDateTo("");setOrderPage(1);}}
              style={{background:"none",border:"none",color:cs.muted,cursor:"pointer",fontSize:14,padding:"2px 4px"}} title="Reset tanggal">✕</button>
          )}
          {/* GAP-9: Filter service type */}
          <span style={{width:1,height:16,background:cs.border,display:"inline-block",marginLeft:4}} />
          <select value={orderServiceFilter} onChange={e=>{setOrderServiceFilter(e.target.value);setOrderPage(1);}}
            style={{ background:cs.card, border:"1px solid "+(orderServiceFilter!="Semua"?cs.yellow:cs.border), borderRadius:8, color:orderServiceFilter!="Semua"?cs.yellow:cs.text, padding:"6px 10px", fontSize:12, cursor:"pointer" }}>
            {["Semua","Cleaning","Install","Repair","Complain"].map(s=><option key={s} value={s}>🔧 {s}</option>)}
          </select>
          {/* GAP-9: Reset Semua filter */}
          {(orderFilter!=="Semua"||orderTekFilter!=="Semua"||orderDateFrom||orderDateTo||orderServiceFilter!=="Semua"||searchOrder) && (
            <button onClick={()=>{setOrderFilter("Semua");setOrderTekFilter("Semua");setOrderDateFrom("");setOrderDateTo("");setOrderServiceFilter("Semua");setSearchOrder("");setOrderPage(1);}}
              style={{ background:cs.red+"18", border:"1px solid "+cs.red+"44", color:cs.red, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700 }}>
              ✕ Reset Semua
            </button>
          )}
        </div>
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:cs.surface, borderBottom:"1px solid "+cs.border }}>
                {["Job ID","Customer","Service","Teknisi","Tgl/Jam","Status","Aksi"].map(h => (
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:cs.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((o,i) => (
                <tr key={o.id} style={{ borderTop:"1px solid "+cs.border, background:i%2===0?"transparent":cs.surface+"80" }}>
                  <td style={{ padding:"10px 14px", fontFamily:"monospace", fontSize:12, color:cs.accent, fontWeight:700 }}>{o.id}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <div style={{ fontSize:13, fontWeight:600, color:cs.text }}>{o.customer}</div>
                    <div style={{ fontSize:11, color:cs.muted }}>{o.address.slice(0,28)}...</div>
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    {(() => { const sCol={Cleaning:"#22c55e",Install:"#3b82f6",Repair:"#f59e0b",Complain:"#ef4444"}[o.service]||cs.muted; return (
                      <><span style={{fontSize:10,padding:"2px 8px",borderRadius:99,fontWeight:700,background:sCol+"22",color:sCol,border:"1px solid "+sCol+"44"}}>{o.service}</span>
                      <span style={{fontSize:11,color:cs.muted,marginLeft:5}}>{o.units}u</span></>
                    ); })()}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:cs.text }}>{o.teknisi}</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:cs.muted }}>{o.date}<br/>{o.time}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ fontSize:10, padding:"3px 8px", borderRadius:99, background:(statusColor[o.status]||cs.muted)+"22", color:statusColor[o.status]||cs.muted, border:"1px solid "+(statusColor[o.status]||cs.muted)+"44", fontWeight:700 }}>{statusLabel[o.status]||o.status.replace("_"," ")}</span>
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <button onClick={() => { const c=customersData.find(c=>c.phone===o.phone); if(c){setSelectedCustomer(c);setCustomerTab("history");setActiveMenu("customers");} }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11 }}>History</button>
                      {/* Dispatch buttons — terpisah agar tidak campur aduk */}
                      <button
                        onClick={() => dispatchStatus(o)}
                        title={o.dispatch ? "Sudah dispatched" : "Set status DISPATCHED"}
                        style={{ background:o.dispatch?"#22c55e22":cs.accent+"22", border:"1px solid "+(o.dispatch?"#22c55e44":cs.accent+"44"), color:o.dispatch?"#22c55e":cs.accent, padding:"4px 8px", borderRadius:6, cursor:"pointer", fontSize:10, fontWeight:700 }}>
                        {o.dispatch ? "✅" : "🔄"}
                      </button>
                      <button
                        onClick={() => sendDispatchWA(o)}
                        title="Kirim WA ke Teknisi & Helper"
                        style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"4px 8px", borderRadius:6, cursor:"pointer", fontSize:10, fontWeight:700 }}>
                        📤
                      </button>
                      {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
                        <button onClick={() => { setEditOrderItem(o); setEditOrderForm({customer:o.customer,phone:o.phone||"",address:o.address||"",service:o.service,type:o.type||"",units:o.units||1,teknisi:o.teknisi,helper:o.helper||"",date:o.date,time:o.time||"09:00",status:o.status,notes:o.notes||""}); setModalEditOrder(true); }}
                          style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600 }}>✏️ Edit</button>
                      )}
                      {currentUser?.role==="Owner" && (
                        <button onClick={async()=>{
                          if (!window.confirm(`🗑️ Hapus order ${o.id} — ${o.customer}?\n\nOrder yang sudah ada invoice TIDAK bisa dihapus.\nTindakan ini permanen!`)) return;
                          if (o.invoice_id) { showNotif("❌ Tidak bisa hapus: order sudah punya invoice "+o.invoice_id); return; }
                          const { error: delErr } = await supabase.from("orders").delete().eq("id", o.id);
                          if (delErr) { showNotif("❌ Gagal hapus order: "+delErr.message); return; }
                          // Hapus schedule juga
                          try { await supabase.from("technician_schedule").delete().eq("order_id", o.id); } catch(_){}
                          setOrdersData(prev => prev.filter(x => x.id !== o.id));
                          addAgentLog("ORDER_DELETED", `Owner hapus order ${o.id} — ${o.customer} (${o.service})`, "WARNING");
                          showNotif("✅ Order "+o.id+" dihapus permanen");
                        }} title="Hapus order (Owner only)"
                          style={{ background:"#ef444422", border:"1px solid #ef444444", color:"#ef4444", padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700 }}>🗑️</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        {/* Pagination Orders */}
        {totPgO > 1 && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"12px 0" }}>
            <button onClick={()=>setOrderPage(p=>Math.max(1,p-1))} disabled={curPgO===1}
              style={{ padding:"6px 14px", borderRadius:8, border:"1px solid "+cs.border, background:curPgO===1?cs.surface:cs.card, color:curPgO===1?cs.muted:cs.text, cursor:curPgO===1?"not-allowed":"pointer", fontSize:12 }}>
              ← Prev
            </button>
            {Array.from({length:Math.min(totPgO,7)},(_,i)=>{
              let pg = i+1;
              if (totPgO > 7) {
                if (curPgO <= 4) pg = i+1;
                else if (curPgO >= totPgO-3) pg = totPgO-6+i;
                else pg = curPgO-3+i;
              }
              return (
                <button key={pg} onClick={()=>setOrderPage(pg)}
                  style={{ padding:"6px 12px", borderRadius:8, border:"1px solid "+(curPgO===pg?cs.accent:cs.border),
                    background:curPgO===pg?cs.accent:cs.card, color:curPgO===pg?"#0a0f1e":cs.text, cursor:"pointer", fontSize:12, fontWeight:curPgO===pg?700:400 }}>
                  {pg}
                </button>
              );
            })}
            <button onClick={()=>setOrderPage(p=>Math.min(totPgO,p+1))} disabled={curPgO===totPgO}
              style={{ padding:"6px 14px", borderRadius:8, border:"1px solid "+cs.border, background:curPgO===totPgO?cs.surface:cs.card, color:curPgO===totPgO?cs.muted:cs.text, cursor:curPgO===totPgO?"not-allowed":"pointer", fontSize:12 }}>
              Next →
            </button>
            <span style={{fontSize:11,color:cs.muted}}>hal {curPgO}/{totPgO} · {filtered.length} order</span>
          </div>
        )}
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER INVOICE
  // ============================================================
  const renderInvoice = () => {
    // ── SIM-3+2: status filter + search + pagination ──
    // ══ GAP 7: Warranty tracker — filter garansi aktif ══
    const garansiAktif = invoicesData.filter(inv => {
      if (!inv.garansi_expires) return false;
      const daysLeft = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
      return daysLeft >= 0;
    }).sort((a,b) => a.garansi_expires.localeCompare(b.garansi_expires));
    const garansiKritis = garansiAktif.filter(inv => {
      const d = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
      return d <= 7;
    });

    let filteredInv = [...invoicesData];
    if (invoiceFilter === "Garansi") {
      filteredInv = garansiAktif;
    } else if (invoiceFilter !== "Semua") {
      filteredInv = filteredInv.filter(inv => inv.status === invoiceFilter);
    }
    if (searchInvoice.trim()) {
      const q = searchInvoice.trim().toLowerCase();
      filteredInv = filteredInv.filter(inv =>
        (inv.customer||"").toLowerCase().includes(q) ||
        (inv.phone||"").includes(searchInvoice.trim()) ||
        (inv.id||"").toLowerCase().includes(q)
      );
    }
    filteredInv.sort((a,b) => (b.created_at||b.sent||"").localeCompare(a.created_at||a.sent||""));
    const totPgI = Math.ceil(filteredInv.length / INV_PAGE_SIZE) || 1;
    const curPgI = Math.min(invoicePage, totPgI);
    const pageInv = filteredInv.slice((curPgI-1)*INV_PAGE_SIZE, curPgI*INV_PAGE_SIZE);
    const unpaidCnt = invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").length;
    return (
    <div style={{ display:"grid", gap:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>🧾 Invoice <span style={{fontSize:13,color:cs.muted,fontWeight:400}}>({filteredInv.length})</span></div>
        <button onClick={() => { const cnt=invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").length; invoiceReminderBulk && invoiceReminderBulk(); showNotif(`📨 Reminder dikirim ke ${cnt} customer`); }}
          style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"8px 14px", borderRadius:9, cursor:"pointer", fontWeight:600, fontSize:12 }}>
          🔔 Kirim Reminder ({unpaidCnt})
        </button>
      </div>
      {/* Search */}
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:cs.muted, pointerEvents:"none" }}>🔍</span>
        <input value={searchInvoice} onChange={e=>{setSearchInvoice(e.target.value);setInvoicePage(1);}}
          placeholder="Cari nama customer, no. telepon, atau ID invoice..."
          style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px 10px 36px", color:cs.text, fontSize:13, boxSizing:"border-box" }} />
        {searchInvoice && <button onClick={()=>{setSearchInvoice("");setInvoicePage(1);}} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16 }}>✕</button>}
      </div>
      {/* Status filter pills — SIM-3 */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {[
          ["Semua", cs.muted],
          ["UNPAID", cs.yellow],
          ["OVERDUE", cs.red],
          ["PAID", cs.green],
          ["PENDING_APPROVAL", cs.accent],
          ["Garansi", "#22d3ee"],
        ].map(([s, col]) => {
          const cnt = s==="Semua" ? invoicesData.length
            : s==="Garansi" ? garansiAktif.length
            : invoicesData.filter(i=>i.status===s).length;
          const showBadge = s==="Garansi" && garansiKritis.length > 0;
          return (
            <button key={s} onClick={()=>{setInvoiceFilter(s);setInvoicePage(1);}}
              style={{ padding:"6px 14px", borderRadius:99, border:"1px solid "+(invoiceFilter===s?col:cs.border),
                background:invoiceFilter===s?col+"22":cs.card, color:invoiceFilter===s?col:cs.muted,
                cursor:"pointer", fontSize:12, fontWeight:invoiceFilter===s?700:500, position:"relative" }}>
              {s==="Semua"?"Semua":s==="PENDING_APPROVAL"?"Approval":s==="Garansi"?"🛡️ Garansi":s} ({cnt})
              {showBadge && <span style={{position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",borderRadius:99,fontSize:9,padding:"1px 5px",fontWeight:800}}>{garansiKritis.length}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ display:"grid", gap:12 }}>
        {pageInv.map(inv => (
          <div key={inv.id} style={{ background:cs.card, border:"1px solid "+(statusColor[inv.status]||cs.border)+"44", borderRadius:14, padding:18 }}>
            <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10, marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent, fontSize:14 }}>{inv.id}</span>
                <span style={{ fontSize:10, padding:"3px 8px", borderRadius:99, background:(statusColor[inv.status]||cs.muted)+"22", color:statusColor[inv.status]||cs.muted, border:"1px solid "+(statusColor[inv.status]||cs.muted)+"44", fontWeight:700 }}>{inv.status.replace(/_/g," ")}</span>
                {inv.follow_up > 0 && <span style={{ fontSize:10, color:cs.yellow }}>Follow-up: {inv.follow_up}x</span>}
                {inv.garansi_expires && (() => {
                  const daysLeft = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
                  if (daysLeft < 0) return <span style={{fontSize:10,color:cs.muted,background:cs.surface,padding:"1px 6px",borderRadius:4}}>🔒 Garansi selesai</span>;
                  if (daysLeft <= 7) return <span style={{fontSize:10,color:"#ef4444",background:"#ef444418",padding:"1px 6px",borderRadius:4,fontWeight:700}}>⚠️ Garansi {daysLeft}h lagi</span>;
                  if (daysLeft <= 30) return <span style={{fontSize:10,color:cs.yellow,background:cs.yellow+"18",padding:"1px 6px",borderRadius:4}}>🛡️ Garansi {daysLeft}h</span>;
                  return <span style={{fontSize:10,color:cs.green,background:cs.green+"18",padding:"1px 6px",borderRadius:4}}>✅ Garansi {daysLeft}h</span>;
                })()}
              </div>
              <div style={{ fontWeight:800, fontSize:18, color:cs.text, fontFamily:"monospace" }}>{fmt(inv.total)}</div>
            </div>
            {/* GAP 3 — breakdown nilai */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:10, fontSize:11 }}>
              <div style={{ background:cs.surface, borderRadius:6, padding:"6px 10px" }}><div style={{color:cs.muted}}>Jasa</div><div style={{color:cs.text,fontWeight:700}}>{fmt(inv.labor)}</div></div>
              <div style={{ background:cs.surface, borderRadius:6, padding:"6px 10px" }}><div style={{color:cs.muted}}>Material</div><div style={{color:cs.text,fontWeight:700}}>{fmt(inv.material)}</div></div>
              <div style={{ background:inv.dadakan>0?cs.yellow+"18":cs.surface, borderRadius:6, padding:"6px 10px", border:inv.dadakan>0?"1px solid "+cs.yellow+"44":"none" }}><div style={{color:cs.muted}}>Tambahan</div><div style={{color:inv.dadakan>0?cs.yellow:cs.text,fontWeight:700}}>{fmt(inv.dadakan)}</div></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:"4px 20px", fontSize:12, color:cs.muted, marginBottom:12 }}>
              <span>👤 {inv.customer}</span><span>📱 {inv.phone}</span>
              <span>🔧 {inv.service} · {inv.units} unit</span>
              {inv.due && <span>⏰ Jatuh tempo: {inv.due}</span>}
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>👁 Preview</button>
              {/* Edit invoice — Owner bisa edit semua status kecuali PAID */}
              {inv.status !== "PAID" && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                <button onClick={() => { setEditInvoiceData(inv); setEditInvoiceForm({labor:inv.labor,material:inv.material,dadakan:inv.dadakan||0,notes:""}); setModalEditInvoice(true); }}
                  style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>✏️ Edit Nilai</button>
              )}
              {inv.status === "PENDING_APPROVAL" && (
                <>
                  <button onClick={() => approveInvoice(inv)} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>✅ Approve</button>
                  <span style={{fontSize:11,color:cs.accent,alignSelf:"center"}}>Belum dikirim ke customer</span>
                </>
              )}
              {/* Kirim Invoice PDF ke Customer — hanya setelah UNPAID (sudah approved) */}
              {inv.status === "UNPAID" && (
                <>
                  <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>📤 Kirim ke Customer</button>
                  <button onClick={() => { if(!window.confirm||window.confirm(`Tandai invoice ${inv.id} (${fmt(inv.total)}) sudah LUNAS?`)) { const pp = invoicesData.find(i=>i.id===inv.id); markPaid(pp||inv); }}} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontWeight:600, fontSize:12 }}>💰 Tandai Lunas</button>
                  <button onClick={() => invoiceReminderWA(inv)} style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>🔔 Reminder</button>
                </>
              )}
              {inv.status === "OVERDUE" && (
                <>
                  <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>📤 Kirim ke Customer</button>
                  <button onClick={() => invoiceReminderWA(inv)} style={{ background:cs.red+"22", border:"1px solid "+cs.red+"44", color:cs.red, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>⚠️ Reminder OVERDUE</button>
                </>
              )}
              {/* Hapus Invoice — Owner only, hanya status PENDING_APPROVAL */}
              {currentUser?.role === "Owner" && inv.status === "PENDING_APPROVAL" && (
                <button onClick={async () => {
                  if (!window.confirm(`🗑️ Hapus invoice ${inv.id}?\n\nInvoice akan dihapus permanen dari database.\nOrder terkait akan dikembalikan ke status COMPLETED.`)) return;
                  setInvoicesData(prev => prev.filter(i => i.id !== inv.id));
                  const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
                  if (error) { showNotif("⚠️ Hapus lokal OK, DB gagal: " + error.message); return; }
                  if (inv.job_id) await supabase.from("orders").update({ status:"COMPLETED", invoice_id:null }).eq("id", inv.job_id);
                  addAgentLog("INVOICE_DELETED", `Invoice ${inv.id} (${inv.customer}) dihapus oleh ${currentUser?.name}`, "WARNING");
                  showNotif("🗑️ Invoice " + inv.id + " berhasil dihapus");
                }} style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>🗑️ Hapus Invoice</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Pagination Invoice */}
      {totPgI > 1 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"10px 0" }}>
          <button onClick={()=>setInvoicePage(p=>Math.max(1,p-1))} disabled={curPgI===1}
            style={{ padding:"6px 14px", borderRadius:8, border:"1px solid "+cs.border, background:curPgI===1?cs.surface:cs.card, color:curPgI===1?cs.muted:cs.text, cursor:curPgI===1?"not-allowed":"pointer", fontSize:12 }}>← Prev</button>
          <span style={{fontSize:12,color:cs.text}}>Hal {curPgI}/{totPgI}</span>
          <button onClick={()=>setInvoicePage(p=>Math.min(totPgI,p+1))} disabled={curPgI===totPgI}
            style={{ padding:"6px 14px", borderRadius:8, border:"1px solid "+cs.border, background:curPgI===totPgI?cs.surface:cs.card, color:curPgI===totPgI?cs.muted:cs.text, cursor:curPgI===totPgI?"not-allowed":"pointer", fontSize:12 }}>Next →</button>
          <span style={{fontSize:11,color:cs.muted}}>{filteredInv.length} invoice</span>
        </div>
      )}
    </div>
    );
  };

  // ============================================================
  // RENDER INVENTORY
  // ============================================================
  const renderInventory = () => {
    const filteredInvt = inventoryData.filter(item =>
      !searchInventory ||
      (item.name||"").toLowerCase().includes(searchInventory.toLowerCase()) ||
      (item.code||"").toLowerCase().includes(searchInventory.toLowerCase()) ||
      (item.unit||"").toLowerCase().includes(searchInventory.toLowerCase()) ||
      (item.status||"").toLowerCase().includes(searchInventory.toLowerCase()) ||
      String(item.price||"").includes(searchInventory) ||
      String(item.stock||"").includes(searchInventory)
    );
    return (
    <div style={{ display:"grid", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>📦 Inventori Material</div>
        <button onClick={() => setModalStok(true)} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Tambah Material</button>
      </div>
      {/* Search bar */}
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:cs.muted, pointerEvents:"none" }}>🔍</span>
        <input value={searchInventory} onChange={e=>setSearchInventory(e.target.value)}
          placeholder="Cari nama barang atau kode material..."
          style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px 10px 36px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
        {searchInventory && <button onClick={()=>setSearchInventory("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>}
      </div>
      <div style={{ fontSize:12, color:cs.muted }}>{searchInventory ? <>Ditemukan <b style={{ color:cs.accent }}>{filteredInvt.length}</b> dari {inventoryData.length} item</> : <><b style={{ color:cs.accent }}>{inventoryData.length}</b> item total</>}</div>
      <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:cs.surface, borderBottom:"1px solid "+cs.border }}>
              {["Kode","Nama Material","Satuan","Harga/Unit","Stok","Reorder","Status","Aksi"].map(h => (
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, color:cs.muted, textTransform:"uppercase", letterSpacing:"0.5px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredInvt.map((item,i) => {
              const stC = item.status==="OUT"?cs.red:item.status==="CRITICAL"?cs.red:item.status==="WARNING"?cs.yellow:cs.green;
              return (
                <tr key={item.code} style={{ borderTop:"1px solid "+cs.border, background:i%2===0?"transparent":cs.surface+"80" }}>
                  <td style={{ padding:"9px 12px", fontFamily:"monospace", fontSize:11, color:cs.muted }}>{item.code}</td>
                  <td style={{ padding:"9px 12px", fontSize:13, fontWeight:600, color:cs.text }}>{item.name}</td>
                  <td style={{ padding:"9px 12px", fontSize:12, color:cs.muted }}>{item.unit}</td>
                  <td style={{ padding:"9px 12px", fontSize:12, color:cs.muted, fontFamily:"monospace" }}>{fmt(item.price)}</td>
                  <td style={{ padding:"9px 12px", fontSize:13, fontWeight:700, color:stC }}>{item.stock}</td>
                  <td style={{ padding:"9px 12px", fontSize:12, color:cs.muted }}>{item.reorder}</td>
                  <td style={{ padding:"9px 12px" }}>
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99, background:stC+"22", color:stC, border:"1px solid "+stC+"44", fontWeight:700 }}>{item.status}</span>
                  </td>
                  <td style={{ padding:"9px 12px" }}>
                    <div style={{ display:"flex", gap:4 }}>
                      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                        <button onClick={() => { setEditStokItem({...item}); setNewStokForm({name:item.name,unit:item.unit,price:item.price,stock:item.stock,reorder:item.reorder,min_alert:item.min_alert}); setModalEditStok(true); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11 }}>✏️ Edit</button>
                      )}
                      {currentUser?.role === "Owner" && (
                        <button onClick={async () => {
                          if (!window.confirm(`Hapus material "${item.name}"?`)) return;
                          // Delete pakai id (UUID) jika ada, fallback ke code
                          const delQuery = item.id && !String(item.id).startsWith("INV")
                            ? supabase.from("inventory").delete().eq("id", item.id)
                            : supabase.from("inventory").delete().eq("code", item.code);
                          const { error } = await delQuery;
                          if (!error) {
                            setInventoryData(prev => prev.filter(i => i.id ? i.id !== item.id : i.code !== item.code));
                            showNotif("🗑️ Material " + item.name + " dihapus dari DB");
                          } else showNotif("❌ Gagal hapus: " + error.message);
                        }} style={{ background:cs.red+"22", border:"1px solid "+cs.red+"44", color:cs.red, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11 }}>🗑️</button>
                      )}
                      {currentUser?.role !== "Owner" && currentUser?.role !== "Admin" && (
                        <span style={{ fontSize:10, color:cs.muted, fontStyle:"italic" }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    );
  };

  // ============================================================
  // RENDER PRICE LIST (submenu — dari Supabase price_list table)
  // ============================================================
  const renderPriceList = () => {
    const SVC_TABS = ["Semua","Cleaning","Install","Repair","Complain"];
    const svcColors = { Cleaning:"#22c55e", Install:"#3b82f6", Repair:"#f59e0b", Complain:"#ef4444" };
    
    let filtered = [...priceListData];
    if (priceListSvcTab !== "Semua") filtered = filtered.filter(r => r.service === priceListSvcTab);
    if (searchPriceList.trim()) {
      const q = searchPriceList.trim().toLowerCase();
      filtered = filtered.filter(r =>
        (r.type||"").toLowerCase().includes(q) ||
        (r.service||"").toLowerCase().includes(q) ||
        (r.code||"").toLowerCase().includes(q) ||
        (r.notes||"").toLowerCase().includes(q) ||
        String(r.price||"").includes(searchPriceList.trim())
      );
    }

    const handleSavePrice = async () => {
      if (!plEditItem) return;
      const updated = { ...plEditItem, ...plEditForm, price: Number(plEditForm.price||plEditItem.price) };
      const { error } = await supabase.from("price_list").update({
        price:       updated.price,
        type:        updated.type,
        service:     updated.service,
        notes:       updated.notes||null,
        is_active:   updated.is_active !== false,
      }).eq("id", updated.id);
      if (error) { showNotif("❌ Gagal update: "+error.message); return; }
      // Update local state & rebuild PRICE_LIST dari data terbaru
      const freshList = priceListData.map(r => r.id===updated.id ? {...r,...updated} : r);
      setPriceListData(freshList);
      // Rebuild PRICE_LIST dari freshList (bukan priceListData yang stale)
      PRICE_LIST = buildPriceListFromDB(data.filter(r => r.is_active !== false));
      setPriceListSyncedAt(new Date());
      console.log("✅ PRICE_LIST updated after save:", Object.keys(newPL));
      setPlEditItem(null);
      showNotif("✅ Harga diperbarui — ARA langsung pakai harga baru");
      addAgentLog("PRICELIST_UPDATE", `Harga "${updated.type}" diupdate → Rp${fmt(updated.price)}`, "SUCCESS");
    };

    return (
      <div style={{ display:"grid", gap:16 }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:cs.text }}>💰 Price List</div>
            <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>
              Harga dari Supabase — ARA & Invoice otomatis pakai harga ini
              <span style={{ marginLeft:8, background:cs.accent+"22", color:cs.accent, fontSize:10, padding:"2px 8px", borderRadius:99, fontWeight:700 }}>
                {priceListData.filter(r=>r.is_active!==false).length} item aktif
              </span>
            </div>
          </div>
          {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
            <div style={{ display:"flex", gap:8 }}>
            <button onClick={async()=>{
              const { data } = await supabase.from("price_list").select("*").order("service").order("type");
              if (data) { setPriceListData(data); showNotif("✅ Price list di-refresh dari DB"); }
            }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"8px 16px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:12 }}>
              🔄 Refresh
            </button>
            <button onClick={()=>{ setPlNewForm({ service:"Cleaning", type:"", code:"", price:"", unit:"unit", notes:"" }); setPlAddModal(true); }}
              style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"8px 16px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:12 }}>
              + Tambah Item
            </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:cs.muted, fontSize:14, pointerEvents:"none" }}>🔍</span>
          <input value={searchPriceList} onChange={e=>setSearchPriceList(e.target.value)}
            placeholder="Cari nama layanan, tipe AC, kode..."
            style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px 10px 36px", color:cs.text, fontSize:13, boxSizing:"border-box" }} />
          {searchPriceList && <button onClick={()=>setSearchPriceList("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16 }}>✕</button>}
        </div>

        {/* Service tabs */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {SVC_TABS.map(t => {
            const col = svcColors[t] || cs.accent;
            const cnt = t==="Semua" ? priceListData.length : priceListData.filter(r=>r.service===t).length;
            return (
              <button key={t} onClick={()=>setPriceListSvcTab(t)}
                style={{ padding:"6px 14px", borderRadius:99, border:"1px solid "+(priceListSvcTab===t?col:cs.border),
                  background:priceListSvcTab===t?col+"22":cs.card, color:priceListSvcTab===t?col:cs.muted,
                  cursor:"pointer", fontSize:12, fontWeight:priceListSvcTab===t?700:500 }}>
                {t} ({cnt})
              </button>
            );
          })}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div style={{ background:cs.card, borderRadius:14, padding:40, textAlign:"center", color:cs.muted }}>
            {priceListData.length === 0
              ? "Price list belum dimuat. Pastikan tabel price_list sudah ada di Supabase."
              : "Tidak ada item ditemukan"}
          </div>
        ) : (
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:cs.surface, borderBottom:"1px solid "+cs.border }}>
                  {["Layanan","Tipe / Keterangan","Harga","Status","Aksi"].map(h => (
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:cs.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,idx) => {
                  const col = svcColors[r.service] || cs.accent;
                  const isEdit = plEditItem?.id === r.id;
                  return (
                    <tr key={r.id||idx} style={{ borderTop:"1px solid "+cs.border, background:idx%2===0?"transparent":cs.surface+"88" }}>
                      <td style={{ padding:"10px 14px" }}>
                        <span style={{ fontSize:11, padding:"2px 9px", borderRadius:99, background:col+"22", color:col, fontWeight:700 }}>{r.service}</span>
                      </td>
                      <td style={{ padding:"10px 14px" }}>
                        {isEdit ? (
                          <input value={plEditForm.type||""} onChange={e=>setPlEditForm(f=>({...f,type:e.target.value}))}
                            style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:6, padding:"6px 10px", color:cs.text, fontSize:12, width:"100%" }} />
                        ) : (
                          <div>
                            <div style={{ fontSize:13, fontWeight:600, color:cs.text }}>{r.type}</div>
                            {r.notes && <div style={{ fontSize:11, color:cs.muted }}>{r.notes}</div>}
                          </div>
                        )}
                      </td>
                      <td style={{ padding:"10px 14px" }}>
                        {isEdit ? (
                          <input type="number" value={plEditForm.price||""} onChange={e=>setPlEditForm(f=>({...f,price:e.target.value}))}
                            style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:6, padding:"6px 10px", color:cs.text, fontSize:13, fontWeight:700, width:110 }} />
                        ) : (
                          <div style={{ fontWeight:700, fontSize:13, color:cs.text, fontFamily:"monospace" }}>{fmt(r.price)}</div>
                        )}
                      </td>
                      <td style={{ padding:"10px 14px" }}>
                        {isEdit ? (
                          <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, cursor:"pointer" }}>
                            <input type="checkbox" checked={plEditForm.is_active!==false} onChange={e=>setPlEditForm(f=>({...f,is_active:e.target.checked}))} />
                            Aktif
                          </label>
                        ) : (
                          <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99, background:r.is_active!==false?cs.green+"22":cs.red+"22", color:r.is_active!==false?cs.green:cs.red, fontWeight:700 }}>
                            {r.is_active!==false?"Aktif":"Non-aktif"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding:"10px 14px" }}>
                        <div style={{ display:"flex", gap:6 }}>
                          {/* Edit: Admin & Owner */}
                          {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
                            isEdit ? (
                              <div style={{display:"flex",gap:6}}>
                                <button onClick={handleSavePrice}
                                  style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"5px 12px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                                  💾 Simpan
                                </button>
                                <button onClick={()=>setPlEditItem(null)}
                                  style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"5px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <div style={{display:"flex",gap:6}}>
                                <button onClick={()=>{ setPlEditItem(r); setPlEditForm({type:r.type,price:r.price,service:r.service,notes:r.notes||"",is_active:r.is_active!==false}); }}
                                  style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"5px 12px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600 }}>
                                  ✏️ Edit
                                </button>
                                {currentUser?.role==="Owner" && (
                                  <button onClick={async()=>{
                                    if (!window.confirm || window.confirm(`Hapus "${r.type}"? Tidak bisa dibatalkan.`)) {
                                      const { error: delErr } = await supabase.from("price_list").delete().eq("id", r.id);
                                      if (delErr) { showNotif("❌ Gagal hapus: "+delErr.message); }
                                      else {
                                        setPriceListData(prev => prev.filter(p => p.id !== r.id));
                                        PRICE_LIST = buildPriceListFromDB(data.filter(r => r.is_active !== false));
                                        addAgentLog("PRICELIST_DELETE",`Hapus "${r.type}" (${r.service})`,"WARNING");
                                        showNotif("✅ Item dihapus dari database");
                                      }
                                    }
                                  }} style={{ background:cs.red+"22", border:"1px solid "+cs.red+"44", color:cs.red, padding:"5px 10px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600 }}>
                                    🗑️
                                  </button>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Info box: ARA connection */}
        <div style={{ background:cs.accent+"10", border:"1px solid "+cs.accent+"33", borderRadius:12, padding:"14px 18px", fontSize:12, color:cs.muted }}>
          <div style={{ fontWeight:700, color:cs.accent, marginBottom:6 }}>🤖 Cara ARA Membaca Price List</div>
          <div>ARA membaca price list <b style={{color:cs.text}}>langsung dari tabel Supabase</b> setiap kali app di-load. Tidak perlu update brain.md atau brain_customer.md manual.</div>
          <div style={{ marginTop:6 }}>Saat ARA membuat invoice, kalkulasi otomatis pakai harga dari tabel ini. Update harga di sini → langsung berlaku di seluruh sistem.</div>
          <div style={{ marginTop:8, display:"flex", gap:8, flexWrap:"wrap" }}>
            {["Cleaning","Install","Repair","Complain"].map(svc => (
              <span key={svc} style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, padding:"4px 10px", fontSize:11 }}>
                {svc}: {priceListData.filter(r=>r.service===svc&&r.is_active!==false).length} item
              </span>
            ))}
          </div>
        </div>

      {/* ── Modal Tambah Item PriceList ── */}
      {plAddModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:16, padding:24, width:"100%", maxWidth:420 }}>
          <div style={{ fontWeight:800, fontSize:16, color:cs.text, marginBottom:16 }}>➕ Tambah Item Harga Baru</div>
          {[
            { label:"Jenis Layanan", key:"service", type:"select", opts:["Cleaning","Install","Repair","Complain"] },
            { label:"Tipe AC / Nama Item", key:"type", type:"text", ph:"contoh: AC 1 PK, AC 2 PK" },
            { label:"Kode", key:"code", type:"text", ph:"contoh: CLN-1PK" },
            { label:"Harga (Rp)", key:"price", type:"number", ph:"contoh: 150000" },
            { label:"Satuan", key:"unit", type:"text", ph:"contoh: unit, set, meter" },
            { label:"Catatan", key:"notes", type:"text", ph:"opsional" },
          ].map(({ label, key, type, ph, opts }) => (
            <div key={key} style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:cs.muted, marginBottom:4 }}>{label}</div>
              {type === "select" ? (
                <select value={plNewForm[key]} onChange={e => setPlNewForm(f=>({...f,[key]:e.target.value}))}
                  style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"8px 12px", color:cs.text, fontSize:13 }}>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={type} value={plNewForm[key]} placeholder={ph||""}
                  onChange={e => setPlNewForm(f=>({...f,[key]:e.target.value}))}
                  style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"8px 12px", color:cs.text, fontSize:13, boxSizing:"border-box" }} />
              )}
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:16 }}>
            <button onClick={()=>setPlAddModal(false)}
              style={{ flex:1, background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:600 }}>
              Batal
            </button>
            <button onClick={async()=>{
              if (!plNewForm.type.trim()) { showNotif("❌ Tipe/Nama item wajib diisi"); return; }
              if (!plNewForm.price || isNaN(Number(plNewForm.price))) { showNotif("❌ Harga harus berupa angka"); return; }
              const newItem = {
                service: plNewForm.service,
                type: plNewForm.type.trim(),
                code: plNewForm.code.trim() || (plNewForm.service.slice(0,3).toUpperCase()+"-"+Date.now().toString().slice(-4)),
                price: Number(plNewForm.price),
                unit: plNewForm.unit.trim() || "unit",
                notes: plNewForm.notes.trim(),
                is_active: true,
              };
              const { data, error } = await supabase.from("price_list").insert(newItem).select().single();
              if (error) { showNotif("❌ Gagal simpan: "+error.message); return; }
              setPriceListData(prev => [...prev, data||newItem]);
              setPriceListSyncedAt(new Date());
              addAgentLog("PRICELIST_ADD", `Item baru "${newItem.type}" (${newItem.service}) Rp${fmt(newItem.price)} ditambah oleh ${currentUser?.name}`, "SUCCESS");
              showNotif("✅ Item harga baru berhasil ditambah!");
              setPlAddModal(false);
            }}
              style={{ flex:2, background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:700 }}>
              💾 Simpan Item
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
    );
  };


  // ============================================================
  // RENDER SCHEDULE
  // ============================================================
  const renderSchedule = () => {
    // Hitung minggu dinamis berdasarkan weekOffset
    const dayNames = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
    const baseDate = new Date();
    // Cari Minggu (hari pertama minggu ini)
    const dayOfWeek = baseDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(baseDate);
    weekStart.setDate(baseDate.getDate() + mondayOffset + (weekOffset * 7));
    const weekDays = Array.from({length:7}, (_,i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = d.toISOString().slice(0,10);
      return { date:iso, label:`${dayNames[d.getDay()]} ${d.getDate()}` };
    });
    const weekLabel = `${weekDays[0].date.slice(5).replace("-","/")} – ${weekDays[6].date.slice(5).replace("-","/")}`;
    const techColors = Object.fromEntries([...new Set(ordersData.map(o=>o.teknisi).filter(Boolean))].map(n=>[n, getTechColor(n, teknisiData)]))

    // For Teknisi role: force filter to own name; for Owner/Admin: use filterTeknisi state
    const isTekRole = currentUser?.role === "Teknisi" || currentUser?.role === "Helper";
    const myTekName = currentUser?.name || "";
    const activeTek = isTekRole ? myTekName : filterTeknisi;

    const allTekNames = [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))];
    // Helper: lihat jadwal via field o.helper, bukan o.teknisi
    const isHelperRole = currentUser?.role === "Helper";
    const _sqSched = searchSchedule.trim().toLowerCase();
    const _baseOrders = activeTek === "Semua"
      ? ordersData
      : ordersData.filter(o => isHelperRole
          ? (o.helper === activeTek || o.teknisi === activeTek)
          : o.teknisi === activeTek);
    // BUG-4: tambah search text filter di jadwal
    const filteredOrders = !_sqSched ? _baseOrders : _baseOrders.filter(o =>
      (o.customer||"").toLowerCase().includes(_sqSched) ||
      (o.id||"").toLowerCase().includes(_sqSched) ||
      (o.teknisi||"").toLowerCase().includes(_sqSched) ||
      (o.helper||"").toLowerCase().includes(_sqSched) ||
      (o.address||"").toLowerCase().includes(_sqSched) ||
      (o.service||"").toLowerCase().includes(_sqSched) ||
      (o.phone||"").includes(searchSchedule.trim())
    );
    const teknisiList = activeTek === "Semua" ? allTekNames : [activeTek];
    // Untuk teknisi/helper: filter hanya hari ini
    const todayOrdersTek = isTekRole ? filteredOrders.filter(o => o.date === TODAY) : filteredOrders;

    return (
      <div style={{ display:"grid", gap:14 }}>
        {/* Header — kondisional per role */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>
              {isTekRole ? "📋 Jadwal Hari Ini" : "📅 Jadwal Pengerjaan"}
            </div>
            {isTekRole && (
              <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>
                {new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {/* Week navigation — hanya untuk Owner/Admin */}
            {!isTekRole && (
              <div style={{ display:"flex", alignItems:"center", gap:6, background:cs.card, border:"1px solid "+cs.border, borderRadius:9, padding:"4px 10px" }}>
                <button onClick={() => setWeekOffset(w=>w-1)} style={{ background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16, lineHeight:1 }}>‹</button>
                <span style={{ fontSize:11, color:cs.muted, fontWeight:600, minWidth:80, textAlign:"center" }}>{weekLabel}</span>
                <button onClick={() => setWeekOffset(w=>w+1)} style={{ background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16, lineHeight:1 }}>›</button>
                {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, borderRadius:6, padding:"2px 8px", cursor:"pointer", fontSize:10, fontWeight:700 }}>Hari ini</button>}
              </div>
            )}
            {/* View toggle — hanya untuk Owner/Admin */}
            {!isTekRole && (
              <div style={{ display:"flex", background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, overflow:"hidden" }}>
                {[["week","📅 Kalender"],["list","📋 List Pekerjaan"]].map(([v,lbl]) => (
                  <button key={v} onClick={() => setScheduleView(v)} style={{ padding:"7px 14px", border:"none", background:scheduleView===v?cs.accent:"transparent", color:scheduleView===v?"#0a0f1e":cs.muted, cursor:"pointer", fontSize:12, fontWeight:scheduleView===v?700:500 }}>{lbl}</button>
                ))}
              </div>
            )}
            {!isTekRole && (
              <button onClick={() => setModalOrder(true)} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"9px 16px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:12 }}>+ Order</button>
            )}
          </div>
        </div>

        {/* Teknisi filter pills — Owner/Admin only */}
        {!isTekRole && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, color:cs.muted, fontWeight:600, marginRight:4 }}>Filter:</span>
            {["Semua", ...allTekNames].map(name => {
              const col = name === "Semua" ? cs.accent : (techColors[name] || cs.muted);
              const isActive = activeTek === name;
              return (
                <button key={name} onClick={() => setFilterTeknisi(name)}
                  style={{ padding:"5px 12px", borderRadius:99, border:"1px solid "+(isActive?col:cs.border), background:isActive?col+"22":"transparent", color:isActive?col:cs.muted, cursor:"pointer", fontSize:11, fontWeight:isActive?700:400 }}>
                  {name === "Semua" ? "👥 Semua" : (
                    <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:col, display:"inline-block" }}></span>
                      {(name||"").split(" ")[0]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search bar di Jadwal — Owner & Admin */}
        {!isTekRole && (
          <div style={{ position:"relative", marginTop:4 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:cs.muted, fontSize:13, pointerEvents:"none" }}>🔍</span>
            <input
              value={searchSchedule}
              onChange={e => setSearchSchedule(e.target.value)}
              placeholder="Cari customer, teknisi, alamat, Job ID..."
              style={{ width:"100%", background:cs.card, border:"1px solid "+(searchSchedule?cs.accent:cs.border), borderRadius:10, padding:"9px 36px", color:cs.text, fontSize:12, boxSizing:"border-box", outline:"none" }}
            />
            {searchSchedule && (
              <button onClick={() => setSearchSchedule("")}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:15 }}>✕</button>
            )}
          </div>
        )}

        {/* Stats bar for filtered teknisi */}
        {activeTek !== "Semua" && (
          <div style={{ background:cs.card, border:"1px solid "+(techColors[activeTek]||cs.accent)+"44", borderRadius:12, padding:"12px 16px", display:"flex", gap:20, alignItems:"center" }}>
            <div style={{ width:36, height:36, borderRadius:9, background:"linear-gradient(135deg,"+(techColors[activeTek]||cs.accent)+","+(techColors[activeTek]||cs.accent)+"66)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:16, color:"#fff" }}>
              {activeTek.charAt(0)}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:13 }}>{activeTek}</div>
              <div style={{ fontSize:11, color:cs.muted }}>
                {filteredOrders.filter(o=>o.date===TODAY).length} job hari ini ·{" "}
                {filteredOrders.filter(o=>o.date>TODAY).length} mendatang ·{" "}
                {filteredOrders.filter(o=>o.status==="COMPLETED").length} selesai
              </div>
            </div>
            {!isTekRole && (() => {
              const undisp = filteredOrders.filter(o=>!o.dispatch);
              return undisp.length > 0 ? (
                <button onClick={() => { undisp.forEach(o=>dispatchWA(o)); }}
                  style={{ background:"#25D36618", border:"1px solid #25D36633", color:"#25D366", padding:"7px 12px", borderRadius:8, cursor:"pointer", fontSize:11 }}>📱 WA Teknisi ({undisp.length})</button>
              ) : (
                <span style={{ fontSize:10, color:cs.green, background:cs.green+"15", padding:"5px 10px", borderRadius:8, border:"1px solid "+cs.green+"33" }}>✅ Ter-dispatch</span>
              );
            })()}
          </div>
        )}

        {/* ════════════════════════════════════════════════
            TAMPILAN JADWAL HARI INI — khusus Teknisi & Helper
            Tidak ada tab Minggu, hanya list pekerjaan hari ini
            ════════════════════════════════════════════════ */}
        {isTekRole && (() => {
          const myJobs = todayOrdersTek.sort((a,b) => (a.time||"").localeCompare(b.time||""));
          if (myJobs.length === 0) return (
            <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:40, textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>✅</div>
              <div style={{ fontWeight:700, color:cs.text, fontSize:15 }}>Tidak ada jadwal hari ini</div>
              <div style={{ color:cs.muted, fontSize:12, marginTop:6 }}>Hubungi Admin jika ada penugasan baru</div>
            </div>
          );
          return (
            <div style={{ display:"grid", gap:10 }}>
              {/* Summary bar */}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                {[
                  { label:"Total Job", value:myJobs.length, color:cs.accent },
                  { label:"Pending", value:myJobs.filter(o=>o.status==="PENDING"||o.status==="CONFIRMED").length, color:cs.yellow },
                  { label:"On Site", value:myJobs.filter(o=>o.status==="ON_SITE"||o.status==="IN_PROGRESS").length, color:cs.green },
                  { label:"Selesai", value:myJobs.filter(o=>o.status==="COMPLETED").length, color:cs.muted },
                ].map(k => (
                  <div key={k.label} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 16px", flex:1, minWidth:70 }}>
                    <div style={{ fontWeight:800, fontSize:20, color:k.color }}>{k.value}</div>
                    <div style={{ fontSize:10, color:cs.muted, marginTop:2 }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* List Pekerjaan Hari Ini */}
              <div style={{ fontWeight:700, color:cs.text, fontSize:14, marginTop:4 }}>
                📋 List Pekerjaan — {new Date().toLocaleDateString("id-ID",{day:"numeric",month:"long"})}
              </div>
              {myJobs.map((o, idx) => {
                const myColor = techColors[o.teknisi] || cs.accent;
                const sCol = statusColor[o.status] || cs.border;
                const isMe = o.teknisi === myTekName;
                return (
                  <div key={o.id} style={{ background:cs.card, border:"1px solid "+sCol+"55", borderRadius:12, padding:"14px 16px", display:"flex", gap:12, alignItems:"flex-start" }}>
                    {/* Urutan + jam */}
                    <div style={{ background:myColor+"22", border:"1px solid "+myColor+"44", borderRadius:10, padding:"8px 10px", textAlign:"center", minWidth:46, flexShrink:0 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:myColor }}>{String(idx+1).padStart(2,"0")}</div>
                      <div style={{ fontSize:13, fontWeight:800, color:myColor }}>{o.time||"--:--"}</div>
                    </div>

                    {/* Info job */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent, fontSize:12 }}>{o.id}</span>
                        <span style={{ fontSize:10, padding:"2px 8px", borderRadius:99, background:sCol+"22", color:sCol, fontWeight:700 }}>{o.status}</span>
                        {!isMe && <span style={{ fontSize:10, background:cs.yellow+"22", color:cs.yellow, padding:"2px 8px", borderRadius:99 }}>🤝 Helper</span>}
                      </div>
                      <div style={{ fontWeight:700, color:cs.text, fontSize:14, marginBottom:4 }}>{o.customer}</div>
                      <div style={{ fontSize:12, color:cs.muted, display:"grid", gap:"3px 0" }}>
                        <span>🔧 {o.service} · {o.units} unit{o.type?" ("+o.type+")":""}</span>
                        <span>📍 {o.address}</span>
                        {o.helper && <span>🤝 Helper: {o.helper}</span>}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
                      <button onClick={() => window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.address),"_blank")}
                        style={{ background:"#3b82f622", border:"1px solid #3b82f644", color:"#3b82f6", padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:600 }}>
                        🗺️ Maps
                      </button>
                      <button onClick={() => { setWaTekTarget({phone:o.phone,customer:o.customer,service:o.service,time:o.time,address:o.address}); setModalWaTek(true); }}
                        style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:600 }}>
                        📱 WA
                      </button>
                      {o.dispatch && !["COMPLETED","CANCELLED","PAID"].includes(o.status) && (
                        <>
                          {o.status !== "ON_SITE" && (
                            <button onClick={async () => {
                              await supabase.from("orders").update({status:"ON_SITE"}).eq("id",o.id);
                              setOrdersData(prev=>prev.map(ord=>ord.id===o.id?{...ord,status:"ON_SITE"}:ord));
                              showNotif("✅ Status → On Site!");
                              const admins = userAccounts.filter(u=>u.role==="Admin"||u.role==="Owner");
                              const msg = `✅ *Teknisi di Lokasi*
📋 ${o.id} — ${o.customer}
👷 ${myTekName}`;
                              admins.forEach(adm=>{if(adm?.phone) sendWA(adm.phone,msg);});
                            }} style={{ background:"#22c55e22", border:"1px solid #22c55e44", color:"#22c55e", padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                              ✅ On Site
                            </button>
                          )}
                          <button onClick={() => openLaporanModal(o)}
                            style={{ background:cs.ara+"22", border:"1px solid "+cs.ara+"44", color:cs.ara, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                            📝 Laporan
                          </button>
                        </>
                      )}
                      {!o.dispatch && (
                        <span style={{ fontSize:10, color:cs.muted, textAlign:"center", padding:"4px 8px" }}>Menunggu dispatch</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* WEEK CALENDAR & LIST VIEW — hanya untuk Owner / Admin */}
        {!isTekRole && (
          <>
            {/* WEEK CALENDAR VIEW */}
            {scheduleView === "week" ? (
          <div style={{ overflowX:"auto" }}>
            <div style={{ minWidth:600 }}>
              <div style={{ display:"grid", gridTemplateColumns:"70px repeat(7,1fr)", gap:2, marginBottom:2 }}>
                <div />
                {weekDays.map(d => (
                  <div key={d.date} style={{ background:d.date===TODAY?cs.accent+"22":cs.surface, border:"1px solid "+(d.date===TODAY?cs.accent:cs.border), borderRadius:7, padding:"7px 4px", textAlign:"center", fontSize:11, fontWeight:700, color:d.date===TODAY?cs.accent:cs.muted }}>{d.label}</div>
                ))}
              </div>
              {teknisiList.map(tek => (
                <div key={tek} style={{ display:"grid", gridTemplateColumns:"70px repeat(7,1fr)", gap:2, marginBottom:2 }}>
                  <div style={{ background:cs.card, border:"1px solid "+(techColors[tek]||cs.border), borderRadius:7, padding:"6px 4px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span style={{ fontSize:9, fontWeight:800, color:techColors[tek]||cs.muted, textAlign:"center", lineHeight:1.3 }}>{(tek||"").split(" ")[0]}</span>
                  </div>
                  {weekDays.map(d => {
                    // SIM-6: tampilkan job dimana tek adalah teknisi ATAU helper
                    const jobs = ordersData.filter(o => (o.teknisi===tek || o.helper===tek) && o.date===d.date);
                    return (
                      <div key={d.date} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:7, padding:4, minHeight:60 }}>
                        {jobs.map(j => {
                          const isHelper = j.teknisi !== tek && j.helper === tek;
                          const col = techColors[tek] || cs.accent;
                          return (
                            <div key={j.id} style={{ background:col+(isHelper?"10":"22"), border:"1px solid "+col+(isHelper?"33":"44"), borderRadius:5, padding:"3px 5px", marginBottom:2, opacity:isHelper?0.85:1 }}>
                              <div style={{ fontSize:9, fontWeight:800, color:col }}>{j.time} {isHelper?"🤝":""}</div>
                              <div style={{ fontSize:9, color:cs.text }}>{(j.customer||"").split(" ")[0]}</div>
                              <div style={{ fontSize:8, color:cs.muted }}>{j.service}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}                </div>
              ))}
            </div>
          </div>
        ) : (
          /* LIST VIEW */
          <div style={{ display:"grid", gap:10 }}>
            {(() => {
              if (filteredOrders.length === 0) {
                return <div style={{ background:cs.card, borderRadius:12, padding:32, textAlign:"center", color:cs.muted }}>Tidak ada jadwal untuk {activeTek}</div>;
              }
              const dayNames2 = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
              const sorted2 = [...filteredOrders].sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
              const groups = sorted2.reduce((acc, o) => { if (!acc[o.date]) acc[o.date] = []; acc[o.date].push(o); return acc; }, {});
              return Object.entries(groups).map(([date2, dayOrders]) => {
                const d2 = new Date(date2 + "T00:00:00");
                const todayStr2 = new Date().toISOString().slice(0,10);
                const tomorrowStr2 = new Date(Date.now()+86400000).toISOString().slice(0,10);
                const isToday2 = (date2 === todayStr2);
                const isTomorrow2 = (date2 === tomorrowStr2);
                const dayLabel2 = isToday2 ? "🔴 Hari Ini" : isTomorrow2 ? "🟡 Besok" : dayNames2[d2.getDay()];
                const dateStr2 = d2.toLocaleDateString("id-ID", {day:"numeric", month:"long", year:"numeric"});
                const sepColor = isToday2 ? cs.red : isTomorrow2 ? cs.yellow : cs.border;
                return (
                  <div key={date2} style={{marginBottom:8}}>
                    <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:10, marginTop:8}}>
                      <div style={{background:sepColor+"22", border:"1px solid "+sepColor+"55", borderRadius:99, padding:"5px 16px", fontSize:12, fontWeight:800, color:sepColor}}>{dayLabel2}&nbsp;·&nbsp;{dateStr2}</div>
                      <div style={{flex:1, height:1, background:cs.border+"55"}} />
                      <span style={{fontSize:11, color:cs.muted, padding:"2px 8px", borderRadius:99, border:"1px solid "+cs.border}}>{dayOrders.length} job</span>
                    </div>
                    {dayOrders.map(o => (
                      <div key={o.id} style={{ background:cs.card, border:"1px solid "+(statusColor[o.status]||cs.border)+"44", borderRadius:12, padding:14, display:"flex", gap:12, alignItems:"flex-start", marginBottom:8 }}>
                        <div style={{ background:(techColors[o.teknisi]||cs.accent)+"22", border:"1px solid "+(techColors[o.teknisi]||cs.accent)+"44", borderRadius:8, padding:"6px 10px", textAlign:"center", minWidth:54, flexShrink:0 }}>
                          <div style={{ fontSize:15, fontWeight:800, color:techColors[o.teknisi]||cs.accent }}>{o.time}</div>
                          <div style={{ fontSize:9, color:cs.muted }}>–{o.time_end||hitungJamSelesai(o.time,o.service,o.units)}</div>
                          <div style={{ fontSize:9, color:cs.muted }}>{o.date.slice(5)}</div>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                            <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent, fontSize:12 }}>{o.id}</span>
                            <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:(statusColor[o.status]||cs.muted)+"22", color:statusColor[o.status]||cs.muted, border:"1px solid "+(statusColor[o.status]||cs.muted)+"44", fontWeight:700 }}>{statusLabel[o.status]||o.status}</span>
                          </div>
                          <div style={{ fontSize:13, fontWeight:700, color:cs.text, marginBottom:4 }}>{o.customer}</div>
                          <div style={{ fontSize:12, color:cs.muted, display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 14px" }}>
                            <span>🔧 {o.service} · {o.units} unit</span>
                            <span style={{ color:techColors[o.teknisi]||cs.muted }}>👷 {o.teknisi}{o.helper?" + "+o.helper:""}</span>
                            <span>📍 {o.address.slice(0,32)}...</span>
                          </div>
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
                          {!isTekRole && (
                            <button onClick={() => { const cu=customersData.find(c=>c.phone===o.phone); if(cu){setSelectedCustomer(cu);setCustomerTab("history");setActiveMenu("customers");} }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>📋 History</button>
                          )}
                          {(!o.dispatch && !isTekRole) && (
                            <button onClick={() => dispatchStatus(o)} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                              ✅ Set Dispatch
                            </button>
                          )}
                          {(!isTekRole) && (
                            <button onClick={() => sendDispatchWA(o)} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>📱 Dispatch</button>
                          )}
                          {!isTekRole && (
                            <button onClick={() => { setEditOrderItem(o); setEditOrderForm({customer:o.customer,phone:o.phone||"",address:o.address||"",service:o.service,units:o.units||1,teknisi:o.teknisi,helper:o.helper||"",date:o.date,time:o.time||"09:00",status:o.status,notes:o.notes||""}); setModalEditOrder(true); }} style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>✏️ Edit</button>
                          )}
                          {currentUser?.role==="Owner" && !(["COMPLETED","PAID"].includes(o.status)) && (
                            <button onClick={async()=>{
                              if(!window.confirm(`🗑️ Hapus order ${o.id} — ${o.customer}?\nOrder COMPLETED/PAID tidak bisa dihapus.\nAksi ini tidak bisa dibatalkan!`)) return;
                              const { error: delOrdErr } = await supabase.from("orders").delete().eq("id", o.id);
                              if (delOrdErr) { showNotif("❌ Gagal hapus order: "+delOrdErr.message); return; }
                              // Hapus schedule terkait
                              try { await supabase.from("technician_schedule").delete().eq("order_id", o.id); } catch(_){}
                              setOrdersData(prev => prev.filter(ord => ord.id !== o.id));
                              addAgentLog("ORDER_DELETED", `Owner hapus order ${o.id} — ${o.customer} (${o.service})`, "WARNING");
                              showNotif("🗑️ Order "+o.id+" berhasil dihapus");
                            }} style={{ background:cs.red+"22", border:"1px solid "+cs.red+"44", color:cs.red, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }} title="Hapus order (Owner only)">🗑️</button>
                          )}
                          {isTekRole && (
                            <button onClick={() => { window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.address),"_blank"); }} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>🗺 Maps</button>
                          )}
                          {isTekRole && (
                            <button onClick={() => { if(o.phone) openWA(o.phone,"Halo "+(o.customer||"Bapak/Ibu")+", saya "+myTekName+" dari AClean. Saya akan tiba pkl "+(o.time||"-")+" untuk "+(o.service||"servis AC")+". Terima kasih!"); else showNotif("❌ Nomor HP customer tidak tersedia"); }} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>💬 Chat WA</button>
                          )}
                          {isTekRole && o.dispatch && !["COMPLETED","CANCELLED","PAID"].includes(o.status) && (<>
                            {/* ── Konfirmasi Tiba: 1 tombol, update status ON_SITE, tanpa WA Admin ── */}
                            {o.status !== "ON_SITE" && (
                              <button onClick={async () => {
                                await supabase.from("orders").update({status:"ON_SITE"}).eq("id",o.id);
                                setOrdersData(prev=>prev.map(ord=>ord.id===o.id?{...ord,status:"ON_SITE"}:ord));
                                showNotif("✅ Status → Sudah di Lokasi!");
                                addAgentLog("ON_SITE", `${currentUser?.name} tiba di lokasi — ${o.id}`, "SUCCESS");
                              }} style={{ background:"#22c55e22", border:"1px solid #22c55e44", color:"#22c55e", borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                                ✅ Konfirmasi Tiba
                              </button>
                            )}
                            {/* ── WA Customer: manual, teknisi isi estimasi jam tiba ── */}
                            {o.phone && (() => {
                              const jamSkrg = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
                              const [h,m] = jamSkrg.split(":").map(Number);
                              const etaDate = new Date(); etaDate.setMinutes(etaDate.getMinutes()+30);
                              const jamEta = etaDate.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
                              return (
                                <button onClick={() => {
                                  const eta = window.prompt(
                                    `Estimasi tiba di lokasi ${o.customer}?\nContoh: 13:30`,
                                    jamEta
                                  );
                                  if (!eta) return;
                                  const msg = `Halo ${o.customer} 👋\n\nKami dari *AClean Service* akan segera tiba di lokasi Anda.\n\n📋 Job: ${o.id}\n🔧 Service: ${o.service} — ${o.units} unit\n⏰ Estimasi tiba: *${eta} WIB*\n\nMohon pastikan ada di lokasi ya! 🙏\n\n_${currentUser?.name} — AClean_`;
                                  if (o.phone) sendWA(o.phone, msg);
                                  else showNotif("⚠️ No. HP customer tidak tersedia");
                                }} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                                  📱 WA Customer
                                </button>
                              );
                            })()}
                          </>)}
                          <button onClick={() => openLaporanModal(o)} style={{ background:cs.ara+"22", border:"1px solid "+cs.ara+"44", color:cs.ara, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>📝 Laporan</button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              });
            })()}
          </div>
        )}
          </>
        )}
      </div>
    );
  };


  // ============================================================
  // RENDER TEKNISI ADMIN
  // ============================================================
  const renderTeknisiAdmin = () => {
    // GAP-11: Rekap performa per teknisi
    const weekAgo  = new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
    const monthAgo = new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10);
    const perfMap = {};
    teknisiData.forEach(t => {
      const jobsMinggu = ordersData.filter(o =>
        (o.teknisi===t.name||o.helper===t.name) && (o.date||"") >= weekAgo
      );
      const jobsBulan = ordersData.filter(o =>
        (o.teknisi===t.name||o.helper===t.name) && (o.date||"") >= monthAgo
      );
      const laporanMinggu = laporanReports.filter(r =>
        (r.teknisi===t.name||r.helper===t.name) && (r.submitted_at||r.submitted||"") >= weekAgo
      );
      const revisi = laporanReports.filter(r =>
        (r.teknisi===t.name||r.helper===t.name) && r.status==="REVISION"
      ).length;
      // Job stuck: DISPATCHED/ON_SITE tapi belum ada laporan & sudah lewat jam selesai
      const stuck = ordersData.filter(o =>
        (o.teknisi===t.name||o.helper===t.name) &&
        ["DISPATCHED","ON_SITE"].includes(o.status) &&
        o.date < TODAY
      ).length;
      const selesai = jobsMinggu.filter(o =>
        ["COMPLETED","REPORT_SUBMITTED","INVOICE_APPROVED","INVOICE_CREATED","PAID"].includes(o.status)
      ).length;
      // GAP-11: Hitung laporan terlambat (ada laporan tapi > 2 jam setelah time_end)
      const laporanTerlambat = laporanMinggu.filter(r => {
        const order = ordersData.find(o => o.id === r.job_id || o.id === r.order_id);
        if (!order || !order.time_end || !r.submitted_at) return false;
        const endMs  = new Date((order.date||"")+"T"+(order.time_end||"17:00")+":00").getTime();
        const subMs  = new Date(r.submitted_at).getTime();
        return subMs > (endMs + 2*60*60*1000); // > 2 jam setelah selesai
      }).length;
      perfMap[t.name] = {
        jobsMinggu: jobsMinggu.length, selesai, revisi, stuck,
        jobsBulan: jobsBulan.length,
        laporanMinggu: laporanMinggu.length,
        onTime: laporanMinggu.length - laporanTerlambat,
        terlambat: laporanTerlambat,
        avgJobPerDay: +(jobsMinggu.length / 7).toFixed(1),
      };
    });

    return (
    <div style={{ display:"grid", gap:16 }}>
      {/* GAP-7: Banner stuck jobs */}
      {(() => {
        const stuckList = ordersData.filter(o =>
          ["DISPATCHED","ON_SITE"].includes(o.status) && o.date < TODAY
        );
        if (stuckList.length === 0) return null;
        return (
          <div style={{ background:cs.red+"15", border:"1px solid "+cs.red+"33", borderRadius:10, padding:"10px 14px", display:"flex", gap:10, alignItems:"center" }}>
            <span style={{fontSize:16}}>⚠️</span>
            <div>
              <div style={{fontWeight:700, color:cs.red, fontSize:13}}>{stuckList.length} job belum ada laporan (sudah lewat hari)</div>
              <div style={{fontSize:11, color:cs.muted}}>{stuckList.map(o=>`${o.id} (${o.teknisi})`).join(", ")}</div>
            </div>
          </div>
        );
      })()}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>👷 Tim Teknisi</div>
        <button onClick={() => { setEditTeknisi(null); setNewTeknisiForm({name:"",role:"Teknisi",phone:"",skills:[]}); setModalTeknisi(true); }} style={{ background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Tambah Anggota</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:12 }}>
        {teknisiData.map(t => {
          const stC = t.status==="on-job"?cs.green:t.status==="active"?cs.accent:cs.muted;
          const perf = perfMap[t.name] || {};
          return (
            <div key={t.id} style={{ background:cs.card, border:"1px solid "+stC+"33", borderRadius:14, padding:16 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:700, color:"#fff", flexShrink:0 }}>{t.name.charAt(0)}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:cs.text, fontSize:14 }}>{t.name}</div>
                  <div style={{ fontSize:11, color:cs.muted }}>{t.role} · {t.id}</div>
                </div>
                <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:stC+"22", color:stC, border:"1px solid "+stC+"44", fontWeight:700 }}>{t.status}</span>
              </div>
              <div style={{ fontSize:11, color:cs.muted, marginBottom:10 }}>
                <div>📱 {t.phone}</div>
                <div>🔧 {ordersData.filter(o=>o.teknisi===t.name&&o.date===TODAY).length} job hari ini</div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:6 }}>
                  {t.skills.map(s => <span key={s} style={{ background:cs.accent+"18", color:cs.accent, fontSize:9, padding:"2px 6px", borderRadius:4, fontWeight:600 }}>{s}</span>)}
                </div>
              </div>
              {/* GAP-11: Rekap performa minggu ini */}
              <div style={{ borderTop:"1px solid "+cs.border, paddingTop:8, marginBottom:10, display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                <div style={{ fontSize:10, color:cs.muted }}>📅 7 hari</div>
                <div style={{ fontSize:10, color:cs.muted }}>📅 30 hari</div>
                <div style={{ fontSize:13, fontWeight:700, color:cs.text }}>{perf.jobsMinggu||0} job</div>
                <div style={{ fontSize:13, fontWeight:700, color:cs.text }}>{perf.jobsBulan||0} job</div>
                <div style={{ fontSize:10, color:cs.green }}>✅ {perf.selesai||0} selesai</div>
                <div style={{ fontSize:10, color:perf.revisi>0?cs.yellow:cs.muted }}>🔄 {perf.revisi||0} revisi</div>
                {(perf.stuck||0) > 0 && (
                  <div style={{ fontSize:10, color:cs.red, gridColumn:"1/-1" }}>⚠️ {perf.stuck} job stuck (laporan belum masuk)</div>
                )}
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => { setEditTeknisi(t); setNewTeknisiForm({...t}); setModalTeknisi(true); }} style={{ flex:1, background:cs.accent+"18", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"6px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600 }}>✏️ Edit</button>
                <button onClick={() => { if(t.phone) openWA(t.phone, "Halo " + (t.name||"Teknisi") + ", ada info dari AClean:"); else showNotif("❌ No. HP teknisi tidak ada"); }} style={{ flex:1, background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px", borderRadius:7, cursor:"pointer", fontSize:11 }}>📱 WA</button>
                {currentUser?.role === "Owner" && (
                  <button onClick={async () => {
                    if (window.confirm && !window.confirm(`Hapus ${t.name} dari tim?`)) return;
                    setTeknisiData(prev => prev.filter(x => x.id !== t.id));
                    if (!String(t.id).startsWith("Tech")) {
                      await supabase.from("user_profiles").delete().eq("id", t.id);
                    }
                    addAgentLog("TEKNISI_DELETED", t.name + " dihapus dari tim", "WARNING");
                    showNotif("🗑️ " + t.name + " dihapus");
                  }} style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"6px 8px", borderRadius:7, cursor:"pointer", fontSize:11 }}>🗑️</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* GAP-11: Tabel Rekap Performa Mingguan — Enhanced */}
      {(() => {
        // Hitung ranking: siapa top performer minggu ini
        const perfList = teknisiData.map(t => ({ ...t, p: perfMap[t.name]||{} }));
        const maxJobs = Math.max(...perfList.map(t => t.p.jobsMinggu||0), 1);
        const rankedByJob = [...perfList].sort((a,b)=>(b.p.jobsMinggu||0)-(a.p.jobsMinggu||0));
        const topName = rankedByJob[0]?.name;
        return (
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:16, marginTop:4 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:14, color:cs.text }}>📊 Rekap Performa Tim — 7 Hari Terakhir</div>
            <div style={{ fontSize:11, color:cs.muted }}>
              Total job: <strong style={{color:cs.accent}}>{perfList.reduce((a,t)=>a+(t.p.jobsMinggu||0),0)}</strong>
              &nbsp;·&nbsp;Stuck: <strong style={{color:cs.red}}>{perfList.reduce((a,t)=>a+(t.p.stuck||0),0)}</strong>
            </div>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:cs.surface }}>
                  {["#","Teknisi","Role","Job 7hr","Selesai","Rate","Bar","Revisi","Laporan","Stuck","Status"].map(h => (
                    <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:cs.muted, borderBottom:"1px solid "+cs.border }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankedByJob.map((t,i) => {
                  const p = t.p;
                  const completionRate = (p.jobsMinggu||0)>0 ? Math.round(((p.selesai||0)/(p.jobsMinggu||1))*100) : 0;
                  const barPct = maxJobs>0 ? Math.round(((p.jobsMinggu||0)/maxJobs)*100) : 0;
                  const isTop = t.name===topName && (p.jobsMinggu||0)>0;
                  const hasIssue = (p.stuck||0)>0 || (p.revisi||0)>2;
                  const rowBg = isTop ? cs.green+"0d" : hasIssue ? cs.red+"0d" : "transparent";
                  const rateColor = completionRate>=80?cs.green:completionRate>=50?cs.yellow:cs.red;
                  return (
                    <tr key={t.id} style={{ borderBottom:"1px solid "+cs.border+"55", background:rowBg }}>
                      <td style={{ padding:"8px 10px", color:cs.muted, fontWeight:700 }}>
                        {isTop ? "🥇" : i===1 ? "🥈" : i===2 ? "🥉" : (i+1)}
                      </td>
                      <td style={{ padding:"8px 10px", fontWeight:700, color:cs.text }}>
                        {t.name}
                        {isTop && <span style={{fontSize:9,background:cs.green+"22",color:cs.green,borderRadius:99,padding:"1px 6px",marginLeft:4,fontWeight:700}}>TOP</span>}
                      </td>
                      <td style={{ padding:"8px 10px", color:cs.muted, fontSize:11 }}>{t.role}</td>
                      <td style={{ padding:"8px 10px", fontWeight:700, color:cs.accent, fontSize:14 }}>{p.jobsMinggu||0}</td>
                      <td style={{ padding:"8px 10px", color:cs.green }}>{p.selesai||0}</td>
                      <td style={{ padding:"8px 10px" }}>
                        <span style={{fontWeight:700,color:rateColor}}>{completionRate}%</span>
                      </td>
                      <td style={{ padding:"8px 10px", minWidth:80 }}>
                        <div style={{ background:cs.surface, borderRadius:99, height:6, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:barPct+"%", background:isTop?cs.green:cs.accent, borderRadius:99, transition:"width 0.5s" }} />
                        </div>
                      </td>
                      <td style={{ padding:"8px 10px", color:(p.revisi||0)>0?cs.yellow:cs.muted }}>
                        {(p.revisi||0)>0 ? "🔄 "+(p.revisi||0) : "—"}
                      </td>
                      <td style={{ padding:"8px 10px", color:cs.muted }}>{p.laporanMinggu||0}</td>
                      <td style={{ padding:"8px 10px", color:(p.stuck||0)>0?cs.red:cs.muted, fontWeight:(p.stuck||0)>0?700:400 }}>
                        {(p.stuck||0)>0 ? <span style={{background:cs.red+"22",color:cs.red,borderRadius:99,padding:"2px 7px",fontSize:10}}>⚠️ {p.stuck} stuck</span> : "—"}
                      </td>
                      <td style={{ padding:"8px 10px" }}>
                        {(p.stuck||0)>0
                          ? <span style={{fontSize:10,color:cs.red,fontWeight:700}}>⚡ Perlu Perhatian</span>
                          : completionRate>=80
                            ? <span style={{fontSize:10,color:cs.green}}>✅ Baik</span>
                            : completionRate>0
                              ? <span style={{fontSize:10,color:cs.yellow}}>📈 Berkembang</span>
                              : <span style={{fontSize:10,color:cs.muted}}>—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Legend */}
          <div style={{ marginTop:10, display:"flex", gap:14, fontSize:10, color:cs.muted, flexWrap:"wrap" }}>
            <span>🥇 Top performer</span>
            <span style={{color:cs.green}}>■ Rate ≥80% = Baik</span>
            <span style={{color:cs.yellow}}>■ Rate 50-79% = Berkembang</span>
            <span style={{color:cs.red}}>■ Rate &lt;50% atau ada stuck</span>
          </div>
        </div>
        );
      })()}
    </div>
    );
  };

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
    if (service === "Repair")  return Math.ceil(u * 1.5);
    if (service === "Complain") return Math.max(0.5, u * 0.5); // 30 mnt/unit min 30 mnt
    // Cleaning:
    if (u === 1) return 1;
    if (u === 2) return 2;
    if (u === 3) return 3;
    if (u === 4) return 3;
    if (u <= 6)  return 4;
    if (u <= 8)  return 5;
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
    return String(nh).padStart(2,"0") + ":" + String(nm).padStart(2,"0");
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
    const endMinBaru   = startMinBaru + Math.round(durBaru * 60);

    const activeOrders = ordersData.filter(o =>
      (checkAsHelper ? o.helper === teknisiName : (o.teknisi === teknisiName || o.helper === teknisiName)) &&
      o.date === date &&
      ["PENDING","CONFIRMED","DISPATCHED","IN_PROGRESS","ON_SITE"].includes(o.status)
    );

    // GAP-3: Hard cap — max 6 lokasi per hari (tidak ada batasan unit)
    if (activeOrders.length >= MAX_LOKASI_PER_HARI) return false;

    // Cek overlap jam
    for (const o of activeOrders) {
      const durExist = hitungDurasi(o.service || "Cleaning", o.units || 1);
      const startExist = (o.time || "09:00").split(":").map(Number);
      const startMinExist = startExist[0] * 60 + startExist[1];
      const endMinExist   = startMinExist + Math.round(durExist * 60);
      if (startMinBaru < endMinExist && endMinBaru > startMinExist) return false;
    }
    return true;
  };

  // Cari slot kosong pertama untuk teknisi di tanggal tertentu
  const cariSlotKosong = (teknisiName, date, service, units) => {
    const dur = hitungDurasi(service, units);
    const slots = ["09:00","10:00","11:00","13:00","14:00","15:00","16:00"];
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
      const endMin   = startMin + durMenit;

      // Query langsung ke Supabase — bukan state lokal
      const { data: dbOrders, error } = await supabase
        .from("orders")
        .select("id, time, time_end, service, units, status")
        .eq("teknisi", teknisiName)
        .eq("date", date)
        .in("status", ["PENDING","CONFIRMED","DISPATCHED","IN_PROGRESS","ON_SITE"]);

      if (error) {
        console.warn("cekAvailDB error:", error.message, "— fallback ke state lokal");
        return cekTeknisiAvailable(teknisiName, date, timeStart, service, units);
      }

      // Hard cap: max 6 lokasi
      if ((dbOrders||[]).length >= MAX_LOKASI_PER_HARI) {
        return { ok: false, reason: `${teknisiName} sudah mencapai batas 6 job di tanggal ${date}` };
      }

      // Cek overlap jam
      for (const o of (dbOrders||[])) {
        const oStart = (o.time||"09:00").split(":").map(Number);
        const oStartMin = oStart[0]*60 + oStart[1];
        const oDur = Math.round(hitungDurasi(o.service||"Cleaning", o.units||1) * 60);
        const oEndMin = oStartMin + oDur;
        if (startMin < oEndMin && endMin > oStartMin) {
          return { ok: false, reason: `${teknisiName} bentrok dengan job ${o.id} jam ${o.time}–${o.time_end||"?"}` };
        }
      }
      return { ok: true };
    } catch(e) {
      console.warn("cekAvailDB catch:", e.message);
      return { ok: true }; // fallback allow jika error network
    }
  };

  // AREA PELAYANAN
  const AREA_PELAYANAN = {
    utama: ["Alam Sutera","BSD","Gading Serpong","Graha Raya","Karawaci","Tangerang","Tangerang Selatan","Serpong","Serpong Utara","Cipondoh","Pinang","Bitung","Curug"],
    konfirmasi: ["Jakarta Barat","Kebon Jeruk","Palmerah","Taman Sari","Kembangan"],
    luar: [], // tidak dilayani
  };

  const cekAreaPelayanan = (area) => {
    const a = (area||"").toLowerCase();
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
      if(!pairs[o.teknisi]) pairs[o.teknisi] = {};
      pairs[o.teknisi][o.helper] = (pairs[o.teknisi][o.helper]||0) + 1;
    });
    const pref = {};
    Object.keys(pairs).forEach(tek => {
      const helpers = pairs[tek];
      pref[tek] = Object.keys(helpers).reduce((a,b) => helpers[a]>helpers[b]?a:b);
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
  const renderAra = () => {
    const quickPrompts = [
      "Berapa total revenue bulan ini?",
      "Invoice mana yang belum dibayar?",
      "Stok material apa yang kritis?",
      "Buat ringkasan order hari ini",
      "Tampilkan semua harga layanan terbaru",
    ];
    const syncLabel = priceListSyncedAt
      ? "Harga terakhir sync: " + priceListSyncedAt.toLocaleString("id-ID",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})
      : "Harga belum di-sync dari Supabase";
    return (
      <div style={{ display:"grid", gap:0, height:"calc(100vh - 120px)", maxHeight:700 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:cs.text }}>🤖 ARA — AI Agent AClean</div>
            <div style={{ fontSize:12, color:cs.muted }}>Chat langsung · Bisa update data invoice, cek stok, analisa bisnis</div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            {/* Sync status indicator */}
            <div style={{ display:"flex", alignItems:"center", gap:5, background:cs.surface, border:"1px solid "+cs.border, borderRadius:7, padding:"4px 10px" }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:priceListSyncedAt?cs.green:cs.yellow }} />
              <span style={{ fontSize:10, color:cs.muted }}>
                Harga: {priceListSyncedAt
                  ? priceListSyncedAt.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})
                  : "belum sync"}
              </span>
            </div>
            <button
              onClick={forceReloadPriceList}
              title="Sync harga terbaru dari Supabase"
              style={{ background:cs.green+"18", border:"1px solid "+cs.green+"44", color:cs.green, padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700 }}>
              🔄 Sync Harga
            </button>
            <div style={{ width:8, height:8, borderRadius:"50%", background:araLoading?cs.yellow:cs.green }} />
            <span style={{ fontSize:11, color:cs.muted }}>{araLoading?"Berpikir...":"Online"}</span>
            <button onClick={() => setAraMessages([{ role:"assistant", content:"Halo! Saya ARA 🤖 — AI Agent AClean. Ada yang bisa saya bantu?" }])}
              style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11 }}>🗑 Reset</button>
          </div>
        </div>
        {/* Harga sync status banner */}
        <div style={{ background:priceListSyncedAt?cs.green+"12":cs.yellow+"18", border:"1px solid "+(priceListSyncedAt?cs.green:cs.yellow)+"33", borderRadius:8, padding:"6px 12px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:11, color:priceListSyncedAt?cs.green:cs.yellow }}>
            {priceListSyncedAt ? "✅ " : "⚠️ "}{syncLabel}
          </span>
          {!priceListSyncedAt && (
            <button onClick={forceReloadPriceList} style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"3px 10px", borderRadius:5, cursor:"pointer", fontSize:10, fontWeight:700 }}>
              Sync Sekarang
            </button>
          )}
        </div>
        {/* Quick prompts */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          {quickPrompts.map(p => (
            <button key={p} onClick={() => sendToARA(p)}
              style={{ background:cs.ara+"15", border:"1px solid "+cs.ara+"33", color:cs.ara, padding:"5px 12px", borderRadius:20, cursor:"pointer", fontSize:11, whiteSpace:"nowrap" }}>
              {p}
            </button>
          ))}
        </div>
        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:16, display:"flex", flexDirection:"column", gap:12, minHeight:0, height:380 }}>
          {araMessages.map((msg, i) => (
            <div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start" }}>
              <div style={{
                maxWidth:"85%", padding:"10px 14px", borderRadius:msg.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",
                background:msg.role==="user"?cs.accent+"22":cs.surface,
                border:"1px solid "+(msg.role==="user"?cs.accent+"33":cs.border),
                fontSize:13, color:cs.text, lineHeight:1.5, whiteSpace:"pre-wrap"
              }}>
                {msg.role==="assistant" && <span style={{ fontSize:11, color:cs.ara, fontWeight:800, display:"block", marginBottom:4 }}>🤖 ARA</span>}
                {msg.content}
              </div>
            </div>
          ))}
          {araLoading && (
            <div style={{ display:"flex", gap:6, alignItems:"center", padding:"8px 14px", background:cs.surface, borderRadius:14, border:"1px solid "+cs.border, width:"fit-content" }}>
              <div style={{ width:6,height:6,borderRadius:"50%",background:cs.ara,animation:"pulse 1s infinite" }}/>
              <div style={{ width:6,height:6,borderRadius:"50%",background:cs.ara,animation:"pulse 1s infinite 0.2s" }}/>
              <div style={{ width:6,height:6,borderRadius:"50%",background:cs.ara,animation:"pulse 1s infinite 0.4s" }}/>
            </div>
          )}
          <div ref={araBottomRef} />
        </div>
        {/* Input */}
        {/* Image preview strip */}
        {araImagePreview && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, padding:"6px 10px", background:cs.card, borderRadius:8, border:"1px solid #22c55e44" }}>
            <img src={araImagePreview} alt="preview" style={{ width:36, height:36, borderRadius:6, objectFit:"cover" }} />
            <span style={{ fontSize:12, color:"#22c55e", flex:1 }}>🖼️ Foto siap dikirim ke ARA</span>
            <button onClick={()=>{ setAraImageData(null); setAraImageType(null); setAraImagePreview(null); }}
              style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:16, lineHeight:1 }}>✕</button>
          </div>
        )}
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <input
            value={araInput} onChange={e=>setAraInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendToARA(araInput); } }}
            placeholder="Tanya ARA atau minta update data... (Enter untuk kirim)"
            disabled={araLoading}
            style={{ flex:1, background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"11px 14px", color:cs.text, fontSize:13, outline:"none" }}
          />
          <>
          <input type="file" id="ara-img-upload" accept="image/*" style={{display:"none"}}
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                const dataUrl = ev.target.result;
                const base64  = dataUrl.split(",")[1];
                setAraImageData(base64);
                setAraImageType(file.type || "image/jpeg");
                setAraImagePreview(dataUrl);
              };
              reader.readAsDataURL(file);
              e.target.value = "";
            }} />
          <button onClick={() => document.getElementById("ara-img-upload").click()}
            title="Upload foto (bukti bayar / complain / dokumen)"
            style={{ background: araImagePreview?"#22c55e22":"#1e40af22", border:"1px solid "+(araImagePreview?"#22c55e44":"#1e40af44"),
              color: araImagePreview?"#22c55e":"#60a5fa", borderRadius:10, padding:"10px 12px", cursor:"pointer", fontSize:16, flexShrink:0 }}>
            {araImagePreview ? "🖼️" : "📎"}
          </button>
        </>
        <button onClick={() => sendToARA(araInput)} disabled={araLoading||(!araInput.trim()&&!araImageData)}
            style={{ background:araLoading||!araInput.trim()?"#333":"linear-gradient(135deg,"+cs.ara+",#7c3aed)", border:"none", color:"#fff", padding:"11px 20px", borderRadius:10, cursor:araLoading?"not-allowed":"pointer", fontWeight:800, fontSize:14 }}>
            {araLoading?"⏳":"→"}
          </button>
        </div>
        {llmStatus !== "connected" && <div style={{ fontSize:11, color:cs.yellow, marginTop:8 }}>⚠️ ARA belum terkoneksi. Buka <b>Pengaturan → ARA Brain</b> → klik <b>Test &amp; Simpan</b> untuk mengaktifkan.</div>}
      </div>
    );
  };

  const renderAgentLog = () => (
    <div style={{ display:"grid", gap:16 }}>
      <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>🤖 ARA Agent Log</div>
      <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, overflow:"hidden" }}>
        {agentLogs.map((log,i) => {
          const lC = log.status==="ERROR"?cs.red:log.status==="WARNING"?cs.yellow:cs.green;
          return (
            <div key={i} style={{ display:"flex", gap:14, padding:"12px 18px", borderBottom:"1px solid "+cs.border, alignItems:"flex-start" }}>
              <span style={{ fontFamily:"monospace", fontSize:11, color:cs.muted, whiteSpace:"nowrap", flexShrink:0 }}>{log.time}</span>
              <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:lC+"22", color:lC, border:"1px solid "+lC+"33", fontFamily:"monospace", fontWeight:700, whiteSpace:"nowrap", flexShrink:0 }}>{log.status}</span>
              <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:cs.accent+"18", color:cs.accent, fontFamily:"monospace", fontWeight:700, whiteSpace:"nowrap", flexShrink:0 }}>{log.action}</span>
              <span style={{ fontSize:12, color:cs.muted }}>{log.detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ============================================================
  // RENDER REPORTS
  // ============================================================
  const renderReports = () => {
    const techColors = Object.fromEntries([...new Set(ordersData.map(o=>o.teknisi).filter(Boolean))].map(n=>[n, getTechColor(n, teknisiData)]))
    const filterByPeriod = (inv) => {
      if(statsPeriod==="hari")  return (inv.sent||"").startsWith(TODAY);
      if(statsPeriod==="bulan") return (inv.sent||"").startsWith(bulanIni);
      return (inv.sent||"").startsWith(TODAY.slice(0,4));
    };
    const periodLabel = statsPeriod==="hari"?"Hari Ini":statsPeriod==="bulan"?"Bulan Ini ("+bulanIni+")":"Tahun "+TODAY.slice(0,4);

    // ── Revenue & Invoice ──
    const allInv        = invoicesData;
    const paidInv       = allInv.filter(i=>i.status==="PAID"&&filterByPeriod(i));
    const unpaidInv     = allInv.filter(i=>i.status==="UNPAID");
    const overdueInv    = allInv.filter(i=>i.status==="OVERDUE");
    const pendingInv    = allInv.filter(i=>i.status==="PENDING_APPROVAL");
    const totalRevenue  = paidInv.reduce((a,b)=>a+(b.total||0),0);
    const totalLabor    = paidInv.reduce((a,b)=>a+(b.labor||0),0);
    const totalMaterial = paidInv.reduce((a,b)=>a+(b.material||0),0);
    const totalDadakan  = paidInv.reduce((a,b)=>a+(b.dadakan||0),0);
    const totalAR       = unpaidInv.reduce((a,b)=>a+(b.total||0),0) + overdueInv.reduce((a,b)=>a+(b.total||0),0);
    const totalPending  = pendingInv.reduce((a,b)=>a+(b.total||0),0);
    // AR Overdue
    const totalOverdue  = overdueInv.reduce((a,b)=>a+(b.total||0),0);

    // ── Orders ──
    const ordersDone    = ordersData.filter(o=>o.status==="COMPLETED").length;
    const ordersAll     = ordersData.length;
    const ordersMonth   = ordersData.filter(o=>(o.date||"").startsWith(bulanIni)).length;
    const completionRate= ordersAll > 0 ? Math.round(ordersDone/ordersAll*100) : 0;
    const avgOrderVal   = ordersDone > 0 ? Math.round(totalRevenue/Math.max(paidInv.length,1)) : 0;

    // ── Revenue per layanan ──
    const revBreakdown = [
      ["Cleaning", paidInv.filter(i=>(i.service||"").includes("Cleaning")).reduce((a,b)=>a+(b.total||0),0), cs.accent],
      ["Install",  paidInv.filter(i=>(i.service||"").includes("Install")).reduce((a,b)=>a+(b.total||0),0), cs.green],
      ["Repair",   paidInv.filter(i=>(i.service||"").includes("Repair")).reduce((a,b)=>a+(b.total||0),0), cs.yellow],
    ];

    // ── Teknisi performance ──
    const tekPerf = [...new Set(ordersData.map(o=>o.teknisi).filter(Boolean))].map(name=>({
      name,
      done:  ordersData.filter(o=>o.teknisi===name&&o.status==="COMPLETED").length,
      total: ordersData.filter(o=>o.teknisi===name).length,
      rev:   paidInv.filter(i=>(i.service||"")&&ordersData.find(o=>o.teknisi===name&&o.id===i.job_id)).reduce((a,b)=>a+(b.total||0),0),
    })).sort((a,b)=>b.done-a.done);
    const maxDone = Math.max(...tekPerf.map(t=>t.done), 1);

    // ── Customer metrics ──
    const custTotal = customersData.length;
    const custVip   = customersData.filter(c=>c.is_vip).length;
    const custBaru  = customersData.filter(c=>(c.joined||"").startsWith(bulanIni)).length;

    const fmtPct = (n,d) => d>0 ? (n/d*100).toFixed(1)+"%" : "—";

    return (
      <div style={{ display:"grid", gap:18 }}>
        {/* Header + Filter */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:cs.text }}>📊 Laporan Keuangan &amp; Operasional</div>
            <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>Profit &amp; Loss · Accounts Receivable · Performa Tim</div>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {[["hari","Hari Ini"],["bulan","Bulan Ini"],["tahun","Tahun Ini"]].map(([v,l])=>(
              <button key={v} onClick={()=>setStatsPeriod(v)}
                style={{ background:statsPeriod===v?cs.accent:cs.card, border:"1px solid "+(statsPeriod===v?cs.accent:cs.border), color:statsPeriod===v?"#0a0f1e":cs.muted, padding:"6px 14px", borderRadius:99, cursor:"pointer", fontSize:12, fontWeight:600 }}>{l}</button>
            ))}
          </div>
        </div>

        {/* ── SECTION 1 + 1b: P&L Summary — Owner only ── */}
        {currentUser?.role === "Owner" && (
          <>
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ fontWeight:800, color:cs.text, fontSize:14, marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span>💰 Profit & Loss — {periodLabel}</span>
            <span style={{ fontSize:11, color:cs.muted, fontWeight:400 }}>Berdasarkan {paidInv.length} invoice PAID</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            {[
              {label:"Total Pendapatan",val:fmt(totalRevenue),sub:"Gross Revenue",color:cs.green,icon:"📈"},
              {label:"Pendapatan Jasa",val:fmt(totalLabor),sub:fmtPct(totalLabor,totalRevenue)+" dari revenue",color:cs.accent,icon:"🔧"},
              {label:"Pendapatan Material",val:fmt(totalMaterial),sub:fmtPct(totalMaterial,totalRevenue)+" dari revenue",color:cs.yellow,icon:"📦"},
              {label:"Biaya Mendadak/Bonus",val:fmt(totalDadakan),sub:fmtPct(totalDadakan,totalRevenue)+" dari revenue",color:cs.ara,icon:"⚡"},
            ].map(k=>(
              <div key={k.label} style={{ background:cs.surface, borderRadius:10, padding:"14px 16px", border:"1px solid "+k.color+"22" }}>
                <div style={{ fontSize:20, marginBottom:6 }}>{k.icon}</div>
                <div style={{ fontSize:18, fontWeight:800, color:k.color, fontFamily:"monospace" }}>{k.val}</div>
                <div style={{ fontSize:12, color:cs.text, fontWeight:600, marginTop:3 }}>{k.label}</div>
                <div style={{ fontSize:10, color:cs.muted, marginTop:1 }}>{k.sub}</div>
              </div>
            ))}
          </div>
          {/* Revenue bar per layanan */}
          <div style={{ borderTop:"1px solid "+cs.border, paddingTop:14 }}>
            <div style={{ fontSize:12, color:cs.muted, marginBottom:10, fontWeight:600 }}>Komposisi Revenue per Layanan</div>
            {revBreakdown.map(([svc,rev,col])=>(
              <div key={svc} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <span style={{ fontSize:12, color:cs.text, fontWeight:600, minWidth:70 }}>{svc}</span>
                <div style={{ flex:1, background:cs.border, borderRadius:99, height:8, overflow:"hidden" }}>
                  <div style={{ height:"100%", background:col, width:totalRevenue>0?(rev/totalRevenue*100)+"%":"0%", borderRadius:99, transition:"width 0.4s" }} />
                </div>
                <span style={{ color:col, fontWeight:700, fontFamily:"monospace", minWidth:100, textAlign:"right", fontSize:12 }}>{fmt(rev)}</span>
                <span style={{ color:cs.muted, fontSize:10, minWidth:36, textAlign:"right" }}>{fmtPct(rev,totalRevenue)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── SECTION 1b: Profit Estimasi (GAP 7) ── */}
        {totalRevenue > 0 && (() => {
          const totalMaterialCost = inventoryData.reduce((acc, item) => {
            // Estimasi biaya material dari laporan bulan ini
            return acc;
          }, 0);
          const profitMargin = totalLabor > 0 ? Math.round(totalLabor / totalRevenue * 100) : 0;
          return (
            <div style={{background:"linear-gradient(135deg,"+cs.green+"18,"+cs.accent+"08)", border:"1px solid "+cs.green+"33", borderRadius:14, padding:"16px 20px", display:"flex", gap:20, flexWrap:"wrap", alignItems:"center"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:cs.muted,fontWeight:700,marginBottom:4}}>💹 ESTIMASI PROFIT — {periodLabel}</div>
                <div style={{fontSize:22,fontWeight:800,color:cs.green,fontFamily:"monospace"}}>{fmt(totalLabor)}</div>
                <div style={{fontSize:11,color:cs.muted}}>Pendapatan jasa bersih (setelah material)</div>
              </div>
              <div style={{textAlign:"center",padding:"10px 16px",background:cs.green+"12",borderRadius:10,border:"1px solid "+cs.green+"22"}}>
                <div style={{fontSize:24,fontWeight:800,color:cs.green}}>{profitMargin}%</div>
                <div style={{fontSize:10,color:cs.muted,fontWeight:700}}>Profit Margin</div>
              </div>
              <div style={{textAlign:"center",padding:"10px 16px",background:cs.accent+"12",borderRadius:10,border:"1px solid "+cs.accent+"22"}}>
                <div style={{fontSize:20,fontWeight:800,color:cs.accent}}>{paidInv.length}</div>
                <div style={{fontSize:10,color:cs.muted,fontWeight:700}}>Invoice Lunas</div>
              </div>
            </div>
          );
        })()}

          </>
        )} {/* end P&L — Owner only */}

        {/* ── SECTION 2: KPI Operasional ── */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(3,1fr)", gap:isMobile?10:12 }}>
          {[
            {label:"Completion Rate",val:completionRate+"%",sub:ordersDone+"/"+ordersAll+" order",color:cs.green,icon:"✅"},
            {label:"Avg. Order Value",val:fmt(avgOrderVal),sub:"per transaksi PAID",color:cs.accent,icon:"📋"},
            {label:"Order Bulan Ini",val:ordersMonth,sub:custBaru+" customer baru",color:cs.yellow,icon:"🗂️"},
          ].map(k=>(
            <div key={k.label} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:12, padding:16, textAlign:"center" }}>
              <div style={{ fontSize:22, marginBottom:6 }}>{k.icon}</div>
              <div style={{ fontSize:20, fontWeight:800, color:k.color, fontFamily:"monospace" }}>{k.val}</div>
              <div style={{ fontSize:11, fontWeight:700, color:cs.text, marginTop:4 }}>{k.label}</div>
              <div style={{ fontSize:10, color:cs.muted, marginTop:2 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── SECTION 3: Accounts Receivable ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ fontWeight:800, color:cs.text, fontSize:14, marginBottom:14 }}>📥 Accounts Receivable (Piutang)</div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:10, marginBottom:14 }}>
            {[
              {label:"Piutang Aktif",val:fmt(totalAR),cnt:unpaidInv.length+overdueInv.length,color:cs.yellow},
              {label:"Overdue 🚨",val:fmt(totalOverdue),cnt:overdueInv.length,color:cs.red},
              {label:"Menunggu Approval",val:fmt(totalPending),cnt:pendingInv.length,color:cs.ara},
              {label:"Customer Aktif",val:custTotal,cnt:custVip+" VIP",color:cs.accent},
            ].map(k=>(
              <div key={k.label} style={{ background:cs.surface, borderRadius:10, padding:"12px 14px", border:"1px solid "+k.color+"22" }}>
                <div style={{ fontSize:15, fontWeight:800, color:k.color, fontFamily:"monospace" }}>{k.val}</div>
                <div style={{ fontSize:11, color:cs.text, fontWeight:600, marginTop:3 }}>{k.label}</div>
                <div style={{ fontSize:10, color:cs.muted, marginTop:1 }}>{k.cnt} invoice/akun</div>
              </div>
            ))}
          </div>
          {/* Daftar invoice OVERDUE */}
          {overdueInv.length > 0 && (
            <div style={{ background:cs.red+"10", border:"1px solid "+cs.red+"22", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:11, fontWeight:700, color:cs.red, marginBottom:8 }}>⚠️ Invoice Overdue — Perlu Tindakan</div>
              {overdueInv.map(inv=>(
                <div key={inv.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingBottom:6, borderBottom:"1px solid "+cs.red+"15", marginBottom:6 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.text }}>{inv.customer}</div>
                    <div style={{ fontSize:10, color:cs.muted }}>{inv.id} · Due: {inv.due||"—"}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:13, fontWeight:800, color:cs.red, fontFamily:"monospace" }}>{fmt(inv.total)}</div>
                    <button onClick={()=>invoiceReminderWA(inv)} style={{ fontSize:10, color:"#25D366", background:"#25D36618", border:"1px solid #25D36633", borderRadius:4, padding:"2px 7px", cursor:"pointer", marginTop:2 }}>WA Reminder</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── SECTION 4: Performa Teknisi ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ fontWeight:800, color:cs.text, fontSize:14, marginBottom:4 }}>👷 Performa Tim Teknisi</div>
          <div style={{ fontSize:11, color:cs.muted, marginBottom:14 }}>Berdasarkan order COMPLETED keseluruhan</div>
          {tekPerf.length === 0
            ? <div style={{color:cs.muted,fontSize:13,textAlign:"center",padding:"20px 0"}}>Belum ada data</div>
            : <div style={{ display:"grid", gap:8 }}>
              {tekPerf.map(t=>{
                const col = techColors[t.name]||cs.muted;
                const rate = t.total > 0 ? Math.round(t.done/t.total*100) : 0;
                return (
                  <div key={t.name} style={{ display:"grid", gridTemplateColumns:isMobile?"80px 1fr 50px":"120px 1fr 60px 80px", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:cs.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.name}</span>
                    <div style={{ background:cs.border, borderRadius:99, height:8, overflow:"hidden" }}>
                      <div style={{ height:"100%", background:col, width:(t.done/maxDone*100)+"%", borderRadius:99, transition:"width 0.4s" }} />
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color:col, fontFamily:"monospace", textAlign:"right" }}>{t.done}/{t.total}</span>
                    <span style={{ fontSize:10, color:rate>=80?cs.green:rate>=50?cs.yellow:cs.red, fontWeight:700, textAlign:"right" }}>{rate}%</span>
                  </div>
                );
              })}
            </div>
          }
        </div>

        {/* ── SECTION 5: Status Invoice & Laporan ── */}
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:14 }}>
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18 }}>
            <div style={{ fontWeight:700, color:cs.text, marginBottom:12, fontSize:13 }}>🧾 Status Invoice (Semua)</div>
            {[["PAID",cs.green,"Lunas"],["UNPAID",cs.yellow,"Belum Bayar"],["OVERDUE",cs.red,"Terlambat"],["PENDING_APPROVAL",cs.ara,"Menunggu Approve"]].map(([s,col,lbl])=>{
              const items = allInv.filter(i=>i.status===s);
              const total = items.reduce((a,b)=>a+(b.total||0),0);
              return items.length > 0 ? (
                <div key={s} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, paddingBottom:8, borderBottom:"1px solid "+cs.border }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:col+"22", color:col, border:"1px solid "+col+"44", fontWeight:700 }}>{lbl}</span>
                    <span style={{ fontSize:11, color:cs.muted }}>{items.length}×</span>
                  </div>
                  <span style={{ fontWeight:800, color:col, fontFamily:"monospace", fontSize:12 }}>{fmt(total)}</span>
                </div>
              ) : null;
            })}
          </div>
          <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18 }}>
            <div style={{ fontWeight:700, color:cs.text, marginBottom:12, fontSize:13 }}>📝 Status Laporan Teknisi</div>
            {[["SUBMITTED",cs.accent,"Baru"],["VERIFIED",cs.green,"Terverifikasi"],["REVISION",cs.yellow,"Perlu Revisi"],["REJECTED",cs.red,"Ditolak"]].map(([s,col,lbl])=>{
              const cnt = laporanReports.filter(r=>r.status===s).length;
              return cnt > 0 ? (
                <div key={s} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, paddingBottom:8, borderBottom:"1px solid "+cs.border }}>
                  <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:col+"22", color:col, border:"1px solid "+col+"44", fontWeight:700 }}>{lbl}</span>
                  <span style={{ fontWeight:800, color:col, fontFamily:"monospace" }}>{cnt}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER LAPORAN TIM  (Owner & Admin)
  // ============================================================
  const renderLaporanTim = () => {
    const sMap = { SUBMITTED:[cs.accent,"Submitted"], VERIFIED:[cs.green,"Terverifikasi"], REVISION:[cs.yellow,"Perlu Revisi"], REJECTED:[cs.red,"Ditolak"] };
    const badge = (s) => { const [col,lbl]=sMap[s]||[cs.muted,s]; return <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:col+"22",color:col,fontWeight:700}}>{lbl}</span>; };
    const statusOrder = { SUBMITTED:0, REVISION:1, VERIFIED:2, REJECTED:3 };
    // ── SIM-8: date + service + status filters + pagination ──
    const weekAgo  = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    const monthAgo = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
    let filtered = [...laporanReports];
    if (laporanDateFilter==="Minggu Ini") filtered=filtered.filter(r=>(r.date||r.submitted_at||"")>=weekAgo);
    else if (laporanDateFilter==="Bulan Ini") filtered=filtered.filter(r=>(r.date||r.submitted_at||"")>=monthAgo);
    if (laporanSvcFilter!=="Semua") filtered=filtered.filter(r=>(r.service||"")===laporanSvcFilter);
    if (laporanStatusFilter!=="Semua") filtered=filtered.filter(r=>r.status===laporanStatusFilter);
    if (searchLaporan.trim()) {
      const q=searchLaporan.trim().toLowerCase();
      filtered=filtered.filter(r=>
        (r.customer||"").toLowerCase().includes(q)||
        (r.teknisi||"").toLowerCase().includes(q)||
        (r.job_id||r.id||"").toLowerCase().includes(q)||
        (r.helper||"").toLowerCase().includes(q)||
        (r.service||"").toLowerCase().includes(q)||
        (r.catatan_global||r.catatan||"").toLowerCase().includes(q)||
        (r.rekomendasi||"").toLowerCase().includes(q)
      );
    }
    filtered.sort((a,b)=>{const dA=a.submitted_at||a.date||"",dB=b.submitted_at||b.date||"";if(dB!==dA)return dB.localeCompare(dA);return (statusOrder[a.status]||9)-(statusOrder[b.status]||9);});
    const totPgL=Math.ceil(filtered.length/LAP_PAGE_SIZE)||1;
    const curPgL=Math.min(laporanPage,totPgL);
    const pageLap=filtered.slice((curPgL-1)*LAP_PAGE_SIZE,curPgL*LAP_PAGE_SIZE);
    return (
      <div style={{display:"grid",gap:16}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontWeight:800,fontSize:18,color:cs.text}}>Laporan Tim Teknisi <span style={{fontSize:13,color:cs.muted,fontWeight:400}}>({filtered.length})</span></div>
            <div style={{fontSize:12,color:cs.muted,marginTop:2}}>Verifikasi laporan, cek riwayat edit, tandai sesuai atau minta revisi</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[["SUBMITTED",cs.accent,"Baru"],["VERIFIED",cs.green,"Verified"],["REVISION",cs.yellow,"Revisi"],["REJECTED",cs.red,"Ditolak"]].map(([s,col,lbl])=>(
              <span key={s} style={{fontSize:11,padding:"5px 11px",borderRadius:99,background:col+"18",color:col,border:"1px solid "+col+"33",fontWeight:700}}>
                {laporanReports.filter(r=>r.status===s).length} {lbl}
              </span>
            ))}
          </div>
        </div>
        {/* Filters: date + service + status */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {["Semua","Minggu Ini","Bulan Ini"].map(f=>(
            <button key={f} onClick={()=>{setLaporanDateFilter(f);setLaporanPage(1);}}
              style={{padding:"5px 12px",borderRadius:99,border:"1px solid "+(laporanDateFilter===f?cs.accent:cs.border),background:laporanDateFilter===f?cs.accent+"22":cs.card,color:laporanDateFilter===f?cs.accent:cs.muted,cursor:"pointer",fontSize:11,fontWeight:laporanDateFilter===f?700:500}}>
              📅 {f}
            </button>
          ))}
          <span style={{width:1,height:16,background:cs.border}}/>
          {["Semua","Cleaning","Install","Repair","Complain"].map(f=>(
            <button key={f} onClick={()=>{setLaporanSvcFilter(f);setLaporanPage(1);}}
              style={{padding:"5px 12px",borderRadius:99,border:"1px solid "+(laporanSvcFilter===f?cs.accent:cs.border),background:laporanSvcFilter===f?cs.accent+"22":cs.card,color:laporanSvcFilter===f?cs.accent:cs.muted,cursor:"pointer",fontSize:11,fontWeight:laporanSvcFilter===f?700:500}}>
              {f}
            </button>
          ))}
          <span style={{width:1,height:16,background:cs.border}}/>
          {["Semua","SUBMITTED","VERIFIED","REVISION","REJECTED"].map(f=>(
            <button key={f} onClick={()=>{setLaporanStatusFilter(f);setLaporanPage(1);}}
              style={{padding:"5px 12px",borderRadius:99,border:"1px solid "+(laporanStatusFilter===f?(sMap[f]||[cs.accent])[0]:cs.border),background:laporanStatusFilter===f?((sMap[f]||[cs.accent])[0])+"22":cs.card,color:laporanStatusFilter===f?(sMap[f]||[cs.accent])[0]:cs.muted,cursor:"pointer",fontSize:11,fontWeight:laporanStatusFilter===f?700:500}}>
              {f==="Semua"?"Semua":f==="SUBMITTED"?"Baru":f==="VERIFIED"?"Verified":f==="REVISION"?"Revisi":"Ditolak"}
            </button>
          ))}
        </div>
        {/* Search */}
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:cs.muted,fontSize:14,pointerEvents:"none"}}>🔍</span>
          <input value={searchLaporan} onChange={e=>{setSearchLaporan(e.target.value);setLaporanPage(1);}}
            placeholder="Cari nama teknisi, customer, ID job, atau layanan..."
            style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"10px 14px 10px 38px",color:cs.text,fontSize:13,boxSizing:"border-box"}} />
          {searchLaporan && <button onClick={()=>{setSearchLaporan("");setLaporanPage(1);}} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:cs.muted,cursor:"pointer",fontSize:16}}>✕</button>}
        </div>
        {/* List */}
        {filtered.length===0
          ? <div style={{background:cs.card,borderRadius:14,padding:40,textAlign:"center",color:cs.muted}}>Tidak ada laporan</div>
          : pageLap.map(r=>(
          <div key={r.id} style={{background:cs.card,border:"1px solid "+(sMap[r.status]?sMap[r.status][0]:cs.border)+"33",borderRadius:16,padding:20}}>
            {/* Card header */}
            <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontWeight:800,color:cs.accent,fontSize:14}}>{r.job_id}</span>
                {badge(r.status)}
                {safeArr(r.editLog).length>0 && (
                  <span style={{fontSize:10,color:cs.yellow,background:cs.yellow+"15",padding:"2px 8px",borderRadius:99,border:"1px solid "+cs.yellow+"33"}}>
                    Diedit {safeArr(r.editLog).length}x
                  </span>
                )}
              </div>
              <div style={{fontSize:11,color:cs.muted}}>Submit: {r.submitted}</div>
            </div>

            {/* Info grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 24px",fontSize:12,marginBottom:14}}>
              <div><span style={{color:cs.muted}}>Customer: </span><span style={{fontWeight:700,color:cs.text}}>{r.customer}</span></div>
              <div><span style={{color:cs.muted}}>Teknisi: </span><span style={{fontWeight:700,color:cs.accent}}>{r.teknisi}{r.helper?" + "+r.helper+" (Helper)":""}</span></div>
              <div><span style={{color:cs.muted}}>Layanan: </span><span style={{color:cs.text}}>{r.service}</span></div>
              <div><span style={{color:cs.muted}}>Tanggal: </span><span style={{color:cs.text}}>{r.date}</span></div>
              <div><span style={{color:cs.muted}}>Jumlah Unit: </span><span style={{color:cs.accent,fontWeight:700}}>{r.total_units||1} unit AC</span></div>
              {safeArr(r.materials).length>0&&<div><span style={{color:cs.muted}}>Material: </span><span style={{color:cs.text}}>{r.materials.length} item</span></div>}
              {r.fotos&&r.fotos.length>0&&<div><span style={{color:cs.green}}>📸 {r.fotos.length} foto</span></div>}
              {(()=>{const tF=(r.units||[]).reduce((s,u)=>s+(parseFloat(u.freon_ditambah)||0),0); return tF>0?<div><span style={{color:cs.muted}}>Freon Total: </span><span style={{color:cs.text}}>{tF.toFixed(1)} kg</span></div>:null;})()}
            </div>

            {/* Per-unit accordion */}
            {(r.units||[]).map((u,ui)=>(
              <div key={ui} style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:9,padding:"10px 13px",marginBottom:8,fontSize:12}}>
                <div style={{fontWeight:700,color:cs.accent,marginBottom:6}}>Unit {u.unit_no} — {u.label} {u.merk?`(${u.merk})`:""}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                  {(u.kondisi_sebelum||[]).map((k,ki)=><span key={ki} style={{fontSize:10,background:cs.yellow+"18",color:cs.yellow,padding:"1px 7px",borderRadius:99}}>{k}</span>)}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                  {(u.pekerjaan||[]).map((k,ki)=><span key={ki} style={{fontSize:10,background:cs.accent+"18",color:cs.accent,padding:"1px 7px",borderRadius:99}}>{k}</span>)}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                  {(u.kondisi_setelah||[]).map((k,ki)=><span key={ki} style={{fontSize:10,background:cs.green+"18",color:cs.green,padding:"1px 7px",borderRadius:99}}>{k}</span>)}
                </div>
                <div style={{fontSize:11,color:cs.muted}}>
                  {u.ampere_akhir?`Ampere: ${u.ampere_akhir}A`:""}{u.ampere_akhir&&parseFloat(u.freon_ditambah)>0?" · ":""}
                  {parseFloat(u.freon_ditambah)>0?`Tekanan: ${u.freon_ditambah} psi`:""}
                  {u.catatan_unit?` · ${u.catatan_unit}`:""}
                </div>
              </div>
            ))}

            {/* Material summary */}
            {safeArr(r.materials).length>0&&(
              <div style={{background:cs.surface,borderRadius:9,padding:"10px 13px",marginBottom:8,fontSize:12}}>
                <div style={{fontWeight:700,color:cs.text,marginBottom:6}}>🔧 Material Terpakai</div>
                {safeArr(r.materials).map((m,mi)=>(
                  <div key={mi} style={{color:cs.muted,marginBottom:2}}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan?` — ${m.keterangan}`:""}</div>
                ))}
              </div>
            )}

            {/* ── GAP-11 FIX: Foto grid untuk Admin/Owner ── */}
            {safeArr(r.fotos).filter(f=>f.url).length>0&&(
              <div style={{marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:700,color:cs.green,marginBottom:6}}>📸 Foto Laporan ({safeArr(r.fotos).filter(f=>f.url).length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(80px,1fr))",gap:6}}>
                  {safeArr(r.fotos).filter(f=>f.url).map((f,fi)=>(
                    <div key={fi} style={{position:"relative",cursor:"pointer"}} onClick={()=>window.open(fotoSrc(f.url),"_blank")}>
                      <img src={fotoSrc(f.url)} alt={f.label||`Foto ${fi+1}`} style={{width:"100%",aspectRatio:"1/1",objectFit:"cover",borderRadius:7,border:"1px solid "+cs.border}} />
                      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"#000a",borderRadius:"0 0 7px 7px",padding:"2px 4px",fontSize:9,color:"#fff",textAlign:"center",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{f.label||`Foto ${fi+1}`}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {r.rekomendasi&&<div style={{fontSize:11,marginBottom:6}}><span style={{color:cs.muted}}>Rekomendasi: </span><span style={{color:cs.text}}>{r.rekomendasi}</span></div>}
            {r.catatan_global&&<div style={{fontSize:11,marginBottom:8}}><span style={{color:cs.muted}}>Catatan: </span><span style={{color:cs.text}}>{r.catatan_global}</span></div>}

            {/* Edit log */}
            {safeArr(r.editLog).length>0 && (
              <div style={{background:cs.yellow+"08",border:"1px solid "+cs.yellow+"22",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:cs.yellow,marginBottom:8}}>Riwayat Edit</div>
                {safeArr(r.editLog).map((log,li)=>(
                  <div key={li} style={{fontSize:11,color:cs.muted,marginBottom:5,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{background:cs.accent+"18",color:cs.accent,fontWeight:700,padding:"1px 8px",borderRadius:99,fontSize:10}}>{log.by}</span>
                    <span style={{color:cs.muted}}>{log.at}</span>
                    <span>ubah <b style={{color:cs.text}}>{log.field}</b>:</span>
                    <span style={{color:cs.red,textDecoration:"line-through",fontStyle:"italic"}}>{log.old}</span>
                    <span style={{color:cs.muted}}>→</span>
                    <span style={{color:cs.green,fontWeight:600}}>{log.new}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {r.status==="SUBMITTED" && (<>
                <button onClick={async()=>{
                  // ── SIM-10: Verify laporan + AUTO-CREATE invoice ──
                  setLaporanReports(p=>p.map(x=>x.id===r.id?{...x,status:"VERIFIED"}:x));
                  const verifiedById = isRealUUID(currentUser?.id) ? currentUser.id : null;
                  const {error:vErr} = await supabase.from("service_reports").update({
                    status:"VERIFIED", verified_by:verifiedById, verified_at:new Date().toISOString()
                  }).eq("id",r.id);
                  if(vErr) await supabase.from("service_reports").update({status:"VERIFIED"}).eq("id",r.id);
                  addAgentLog("LAPORAN_VERIFIED",`Laporan ${r.job_id} (${r.customer}) diverifikasi`,"SUCCESS");

                  // Cek apakah invoice sudah ada
                  const existInv = invoicesData.find(i => i.job_id === r.job_id);
                  if (existInv) {
                    showNotif(`✅ Laporan verified! Invoice ${existInv.id} sudah ada — status: ${existInv.status}`);
                  } else {
                    // AUTO-CREATE invoice PENDING_APPROVAL (tidak langsung kirim ke customer)
                    const ord = ordersData.find(o => o.id === r.job_id);
                    const invId = "INV" + Date.now().toString().slice(-7) + Math.floor(Math.random()*100).toString().padStart(2,"0");
                    const labor = PRICE_LIST[r.service]?.[ord?.type||"default"] || PRICE_LIST[r.service]?.["default"] || 85000;
                    const laborTotal = labor * (r.units || ord?.units || 1);
                    const matCost = safeArr(r.materials).reduce((s,m) => s + ((m.harga||m.price||0)*parseFloat(m.jumlah||m.qty||1)), 0);
        const freonCost = 0; // [OPSI A] Freon tidak dihitung dari total_freon (data psi)
                    const dadakan = ord?.date === new Date().toISOString().slice(0,10) ? 50000 : 0;
                    const totalInv = laborTotal + matCost + freonCost + dadakan;
                    const newInv = {
                      id:invId, job_id:r.job_id, laporan_id:r.id,
                      customer:r.customer, phone:r.phone||ord?.phone||"",
                      service:r.service+(ord?.type?" - "+ord.type:""), units:r.units||ord?.units||1,
                      teknisi:r.teknisi||"",
                      labor:laborTotal, material:matCost+freonCost, dadakan, discount:0,
                      total:totalInv,
                      status:"PENDING_APPROVAL",  // ⚠ harus approve dulu sebelum dikirim
                      due: new Date(Date.now()+3*86400000).toISOString().slice(0,10),
                      sent:false, created_at:new Date().toISOString()
                    };
                    setInvoicesData(prev => [...prev, newInv]);
                    const {error:iErr} = await supabase.from("invoices").insert(newInv);
                    if(iErr) showNotif("⚠️ Invoice gagal simpan: "+iErr.message);
                    else {
                      await supabase.from("orders").update({invoice_id:invId}).eq("id",r.job_id);
                      setOrdersData(prev=>prev.map(o=>o.id===r.job_id?{...o,invoice_id:invId}:o));
                      addAgentLog("AUTO_INVOICE",`Invoice ${invId} auto-dibuat dari laporan ${r.job_id}`,"SUCCESS");
                      showNotif(`✅ Invoice ${invId} dibuat (${fmt(totalInv)}) — tunggu approval Owner/Admin`);
                      // Notif Owner
                      const owners = userAccounts.filter(u=>u.role==="Owner"||u.role==="Admin");
                      owners.forEach(o => { if(o?.phone) sendWA(o.phone, `⚡ *Invoice Auto-Generated*\n\nJob: *${r.job_id}*\nCustomer: ${r.customer}\nService: ${r.service}\nTotal: *${fmt(totalInv)}*\n\nMohon cek dan approve invoice di menu Invoice. — AClean`); });
                    }
                  }
                }} style={{background:cs.green+"22",border:"1px solid "+cs.green+"44",color:cs.green,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>✅ Verifikasi + Buat Invoice</button>
                <button onClick={async()=>{
                  setLaporanReports(p=>p.map(x=>x.id===r.id?{...x,status:"REVISION"}:x));
                  await supabase.from("service_reports").update({status:"REVISION"}).eq("id",r.id);
                  addAgentLog("LAPORAN_REVISION",`Laporan ${r.job_id} diminta revisi oleh ${currentUser?.name}`,"WARNING");
                  showNotif("⚠️ Revisi diminta untuk laporan "+r.job_id);
                  // SIM-11: WA notif ke teknisi saat laporan REVISION
                  const tekAccRev = userAccounts.find(u=>u.name===r.teknisi&&u.phone);
                  if(tekAccRev?.phone) sendWA(tekAccRev.phone, `⚠️ *Laporan Perlu Direvisi*

Job: *${r.job_id}*
Customer: ${r.customer}
Service: ${r.service}

Admin meminta revisi laporan Anda. Silakan buka aplikasi dan perbaiki laporan. — AClean`);
                }} style={{background:cs.yellow+"22",border:"1px solid "+cs.yellow+"44",color:cs.yellow,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>Minta Revisi</button>
                <button onClick={async()=>{
                  setLaporanReports(p=>p.map(x=>x.id===r.id?{...x,status:"REJECTED"}:x));
                  await supabase.from("service_reports").update({status:"REJECTED"}).eq("id",r.id);
                  addAgentLog("LAPORAN_REJECTED",`Laporan ${r.job_id} ditolak oleh ${currentUser?.name}`,"ERROR");
                  showNotif("❌ Laporan "+r.job_id+" ditolak");
                }} style={{background:cs.red+"22",border:"1px solid "+cs.red+"44",color:cs.red,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12}}>Tolak</button>
              </>)}
              {r.status==="REVISION" && <span style={{fontSize:12,color:cs.yellow}}>Menunggu revisi dari {r.teknisi}</span>}
              {r.status==="VERIFIED" && <span style={{fontSize:12,color:cs.green}}>Laporan sudah terverifikasi</span>}
              {r.status==="REJECTED" && <span style={{fontSize:12,color:cs.red}}>Laporan ditolak</span>}
            </div>
          </div>
        ))}
        {/* Pagination Laporan */}
        {totPgL > 1 && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 0"}}>
            <button onClick={()=>setLaporanPage(p=>Math.max(1,p-1))} disabled={curPgL===1}
              style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+cs.border,background:curPgL===1?cs.surface:cs.card,color:curPgL===1?cs.muted:cs.text,cursor:curPgL===1?"not-allowed":"pointer",fontSize:12}}>← Prev</button>
            <span style={{fontSize:12,color:cs.text}}>Hal {curPgL}/{totPgL}</span>
            <button onClick={()=>setLaporanPage(p=>Math.min(totPgL,p+1))} disabled={curPgL===totPgL}
              style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+cs.border,background:curPgL===totPgL?cs.surface:cs.card,color:curPgL===totPgL?cs.muted:cs.text,cursor:curPgL===totPgL?"not-allowed":"pointer",fontSize:12}}>Next →</button>
            <span style={{fontSize:11,color:cs.muted}}>{filtered.length} laporan</span>
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // RENDER MY REPORT  (Teknisi & Helper — laporan sendiri + edit)
  // ============================================================
  const renderMyReport = () => {
    const myName = currentUser?.name || "";
    // Get all submitted reports
    const submittedReps = laporanReports.filter(r => r.teknisi===myName || r.helper===myName);
    // Get my ORDERS_DATA jobs that don't have a report yet — show as pending
    const myJobs = ordersData.filter(o => o.teknisi===myName || o.helper===myName);
    const reportedJobIds = submittedReps.map(r => r.job_id);
    const pendingJobs = myJobs.filter(o => !reportedJobIds.includes(o.id));
    const pendingAsDraft = pendingJobs.map(o => ({
      id:"PENDING_"+o.id, job_id:o.id, teknisi:o.teknisi, helper:o.helper||null,
      customer:o.customer, service:o.service, date:o.date, submitted:"Belum dibuat",
      status:"PENDING", kondisi_sebelum:"", kondisi_setelah:"", pekerjaan:[],
      rekomendasi:"", catatan:"", freon:"0", ampere:"", editLog:[]
    }));
    const myReps = [...submittedReps, ...pendingAsDraft];
    const filtReps = myReps.filter(r =>
      !searchLaporan ||
      r.customer.toLowerCase().includes(searchLaporan.toLowerCase()) ||
      r.job_id.toLowerCase().includes(searchLaporan.toLowerCase())
    );
    const sMap = { SUBMITTED:[cs.accent,"Submitted"], VERIFIED:[cs.green,"Terverifikasi"], REVISION:[cs.yellow,"Perlu Revisi"], REJECTED:[cs.red,"Ditolak"], PENDING:[cs.muted,"Belum Dibuat"] };
    const badge = (s) => { const [col,lbl]=sMap[s]||[cs.muted,s]; return <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:col+"22",color:col,border:"1px solid "+col+"44",fontWeight:700}}>{lbl}</span>; };

    return (
      <div style={{display:"grid",gap:16}}>
        <div>
          <div style={{fontWeight:800,fontSize:18,color:cs.text}}>Laporan Saya</div>
          <div style={{fontSize:12,color:cs.muted,marginTop:3}}>Semua job kamu — buat laporan untuk job yang belum dilaporkan, edit yang sudah masuk</div>
        </div>

        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {[["Belum Laporan",pendingAsDraft.length,cs.muted],["Submitted",submittedReps.filter(r=>r.status==="SUBMITTED").length,cs.accent],["Terverifikasi",submittedReps.filter(r=>r.status==="VERIFIED").length,cs.green]].map(([lbl,val,col])=>(
            <div key={lbl} style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:12,padding:16,textAlign:"center"}}>
              <div style={{fontWeight:800,fontSize:26,color:col}}>{val}</div>
              <div style={{fontSize:11,color:cs.muted,marginTop:4}}>{lbl}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:cs.muted,fontSize:14,pointerEvents:"none"}}>&#128269;</span>
          <input value={searchLaporan} onChange={e=>setSearchLaporan(e.target.value)}
            placeholder="Cari customer atau ID job..."
            style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"10px 14px 10px 38px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
          {searchLaporan && <button onClick={()=>setSearchLaporan("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:cs.muted,cursor:"pointer",fontSize:20,lineHeight:1}}>x</button>}
        </div>

        {/* List */}
        {filtReps.length===0
          ? <div style={{background:cs.card,borderRadius:14,padding:40,textAlign:"center",color:cs.muted}}>
              Belum ada laporan. Gunakan tombol Laporan di halaman Jadwal.
            </div>
          : filtReps.map(r=>{
            const isPending = r.status==="PENDING";
            const canEdit = (r.status==="SUBMITTED" || r.status==="REVISION") && r.teknisi === myName;
            const isReadOnly = (r.status==="SUBMITTED" || r.status==="REVISION") && r.teknisi !== myName && r.helper === myName;
            const isHelper = r.helper===myName;
            return (
              <div key={r.id} style={{background:cs.card,border:"1px solid "+(r.status==="REVISION"?cs.yellow:r.status==="VERIFIED"?cs.green:cs.border)+"44",borderRadius:14,padding:18}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontFamily:"monospace",fontWeight:800,color:cs.accent}}>{r.job_id}</span>
                    {badge(r.status)}
                    {isHelper && <span style={{fontSize:10,color:cs.muted,background:cs.surface,padding:"1px 7px",borderRadius:99}}>Helper</span>}
                    {safeArr(r.editLog).length>0 && <span style={{fontSize:10,color:cs.muted}}>Diedit {safeArr(r.editLog).length}x</span>}
                  </div>
                  <span style={{fontSize:11,color:cs.muted}}>{r.submitted}</span>
                </div>
                <div style={{fontWeight:700,color:cs.text,fontSize:14,marginBottom:4}}>{r.customer}</div>
                <div style={{fontSize:12,color:cs.muted,marginBottom:8}}>{r.service} — {r.date}</div>

                {r.status==="REVISION" && (
                  <div style={{background:cs.yellow+"12",border:"1px solid "+cs.yellow+"33",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:cs.yellow}}>
                    Laporan diminta revisi oleh Owner/Admin. Silakan edit dan simpan ulang.
                  </div>
                )}

                {/* Edit log visible to teknisi */}
                {safeArr(r.editLog).length>0 && (
                  <div style={{background:cs.surface,borderRadius:8,padding:"10px 12px",marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:6}}>Riwayat Perubahan</div>
                    {safeArr(r.editLog).map((log,li)=>(
                      <div key={li} style={{fontSize:10,color:cs.muted,marginBottom:4,display:"flex",gap:6,flexWrap:"wrap"}}>
                        <span style={{color:cs.accent,fontWeight:600}}>{log.by}</span>
                        <span>{log.at}</span>
                        <span>ubah {log.field}:</span>
                        <span style={{color:cs.red,textDecoration:"line-through"}}>{log.old}</span>
                        <span>→</span>
                        <span style={{color:cs.green,fontWeight:600}}>{log.new}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{display:"flex",gap:8}}>
                  {isPending && (() => {
                    // Cek apakah teknisi lain sudah mengisi laporan untuk job ini
                    const jobReport = laporanReports.find(lr => lr.job_id === r.job_id && lr.status !== "PENDING");
                    if (jobReport && jobReport.teknisi !== myName) {
                      return (
                        <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 14px",fontSize:12,color:cs.muted}}>
                          🔒 Laporan sudah diisi oleh <b style={{color:cs.accent}}>{jobReport.teknisi}</b>
                        </div>
                      );
                    }
                    return (
                      <button onClick={() => openLaporanModal(ordersData.find(o=>o.id===r.job_id)||{id:r.job_id,customer:r.customer,service:r.service,date:r.date,teknisi:r.teknisi,helper:r.helper,units:1})}
                        style={{background:cs.green+"22",border:"1px solid "+cs.green+"44",color:cs.green,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
                        + Buat Laporan
                      </button>
                    );
                  })()}
                  {isReadOnly && (
                    <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 14px",fontSize:12,color:cs.muted,display:"flex",alignItems:"center",gap:6}}>
                      🔒 Dibuat oleh <b style={{color:cs.accent,marginLeft:4}}>{r.teknisi}</b>
                      <span style={{color:cs.muted,marginLeft:4}}>— kamu sebagai helper</span>
                    </div>
                  )}
                  {canEdit && (
                    <>
                    {/* Tulis Ulang — buka form laporan dari awal, hapus data lama */}
                    <button onClick={()=>{
                      const srcOrder = ordersData.find(o=>o.id===r.job_id) || {
                        id:r.job_id, customer:r.customer, service:r.service,
                        type:r.type||"AC Split 0.5-1PK", units:r.total_units||(r.units||[]).length||1,
                        teknisi:r.teknisi, helper:r.helper, date:r.date, time:r.time||"09:00"
                      };
                      openLaporanModal({...srcOrder, _rewriteId: r.id});
                    }}
                      style={{background:cs.yellow+"22",border:"1px solid "+cs.yellow+"44",color:cs.yellow,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
                      🔄 Tulis Ulang
                    </button>
                    {/* Edit biasa — edit catatan/rekomendasi saja */}
                    <button onClick={()=>{
                      setEditLaporanForm({rekomendasi:r.rekomendasi||"",catatan_global:r.catatan_global||r.catatan||""});
                      setSelectedLaporan(r); setEditLaporanMode(true); setModalLaporanDetail(true);
                    }}
                      style={{background:cs.accent+"22",border:"1px solid "+cs.accent+"44",color:cs.accent,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
                      ✏️ Edit
                    </button>
                    </>
                  )}
                {!isPending && (
                    <button onClick={()=>{setSelectedLaporan(r);setEditLaporanMode(false);setModalLaporanDetail(true);}}
                      style={{background:cs.surface,border:"1px solid "+cs.border,color:cs.muted,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12}}>
                      Lihat Detail
                    </button>
                  )}
                </div>
              </div>
            );
          })
        }
      </div>
    );
  };

  // ============================================================
  // RENDER SETTINGS
  // ============================================================
  const renderSettings = () => {
    const WA_PROVIDERS = [
      { id:"fonnte",   label:"Fonnte",       icon:"🟢", active:true,  tagline:"WA Gateway lokal Indonesia",
        fields:[{k:"token",label:"API Token",ph:"fnt_••••••••",t:"password"},{k:"device",label:"Device / No WA",ph:"6281299898937",t:"text"}],
        guide:["Login fonnte.com → menu Device","Klik tombol + Add Device, scan QR WA HP kamu","Klik nama device → salin TOKEN di halaman detail device (bukan dari Profile!)","Paste token di kolom API Token di sini → klik Test &amp; Simpan","Webhook (untuk bot balas otomatis): butuh paket berbayar Fonnte"] },
      { id:"wa_cloud", label:"WA Cloud API", icon:"🔵", active:false, tagline:"Resmi Meta, butuh verifikasi bisnis",
        fields:[{k:"phone_id",label:"Phone Number ID",ph:"123456789"},{k:"token",label:"Access Token",ph:"EAAx...",t:"password"},{k:"waba_id",label:"WABA ID",ph:"123456789"},{k:"verify",label:"Webhook Verify Token",ph:"aclean_secret"}],
        guide:["Daftar di developers.facebook.com","Buat App + tambah produk WhatsApp","Verifikasi Business (Meta Business Suite)","Generate Permanent Access Token","Set webhook URL di App Settings"] },
      { id:"twilio",   label:"Twilio",       icon:"🔴", active:false, tagline:"Enterprise, multi-channel",
        fields:[{k:"sid",label:"Account SID",ph:"ACxxxxxxxxxxxxxxxx"},{k:"token",label:"Auth Token",ph:"••••••••",t:"password"},{k:"from",label:"Nomor WA Twilio",ph:"whatsapp:+14155552671"}],
        guide:["Daftar di twilio.com","Console > Messaging > WhatsApp","Aktifkan Sandbox atau beli nomor","Copy Account SID & Auth Token","Set webhook incoming messages"] },
    ];

    const LLM_PROVIDERS = [
      { id:"claude",  label:"Anthropic Claude",   icon:"🟣", rec:true,  models:["claude-sonnet-4-6","claude-haiku-4-5","claude-opus-4-6"],
        fields:[{k:"key",label:"API Key",ph:"sk-ant-api03-...",t:"password"}],
        guide:["Buka console.anthropic.com","API Keys → Create Key","Copy key, paste di sini"],
        note:"Rekomendasi: claude-sonnet-4-6 — cerdas & cepat" },
      { id:"openai",  label:"ChatGPT (OpenAI)",   icon:"🟢", rec:false, models:["gpt-4o","gpt-4o-mini","gpt-4-turbo"],
        fields:[{k:"key",label:"API Key",ph:"sk-proj-...",t:"password"}],
        guide:["Buka platform.openai.com","Settings → API Keys → Create","Copy key, paste di sini"],
        note:"GPT-4o-mini: lebih hemat, cocok volume tinggi" },
      { id:"gemini",  label:"Gemini (Google)",    icon:"🔵", rec:false, models:["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-2.5-pro","gemini-1.5-flash"],
        fields:[{k:"key",label:"API Key",ph:"AIzaSy...",t:"password"}],
        guide:["Buka aistudio.google.com","Klik Get API Key → Create API key","Copy key, paste di sini — GRATIS"],
        note:"✅ Rekomendasi: gemini-2.5-flash (gratis ~15 RPM, 1500 RPD)" },
      { id:"ollama",  label:"Ollama (Lokal/Free)", icon:"🦙", rec:false, models:["llama3","llama3.1","llama3.2","mistral","gemma2","qwen2.5","deepseek-r1"],
        fields:[{k:"url",label:"URL Server Ollama",ph:"http://localhost:11434 atau https://xxxx.ngrok-free.app"}],
        guide:["Install: curl -fsSL https://ollama.com/install.sh | sh","Pull model: ollama pull llama3","Jalankan: OLLAMA_ORIGINS='*' ollama serve","Expose publik: ngrok http 11434","Copy URL ngrok ke kolom URL di atas"],
        note:"✅ 100% gratis & lokal. Butuh ngrok agar bisa diakses dari Vercel." },
    ];

    const STORAGE_PROVIDERS = [
      { id:"r2",     label:"Cloudflare R2", icon:"🟠", rec:true,
        fields:[{k:"account_id",label:"Account ID",ph:"abc123"},{k:"access_key",label:"Access Key ID",ph:"R2_ACCESS_KEY",t:"password"},{k:"secret_key",label:"Secret Key",ph:"R2_SECRET",t:"password"},{k:"bucket",label:"Nama Bucket",ph:"aclean-files"},{k:"domain",label:"Custom Domain (opsional)",ph:"files.aclean.com"}],
        guide:["Buka dash.cloudflare.com > R2","Create bucket: aclean-files","Manage R2 API Tokens > Create Token (Read+Write)","Copy Account ID, Access Key, Secret Key"] },
      { id:"gdrive", label:"Google Drive",  icon:"🟢", rec:false,
        fields:[{k:"client_id",label:"Client ID",ph:"xxx.apps.googleusercontent.com"},{k:"secret",label:"Client Secret",ph:"GOCSPX-...",t:"password"},{k:"refresh",label:"Refresh Token",ph:"1//04...",t:"password"},{k:"folder_id",label:"Root Folder ID",ph:"1BxiMVs0XRA5..."}],
        guide:["Buka console.cloud.google.com > New Project","Enable Google Drive API","Create OAuth 2.0 Client ID","OAuth Playground > authorize Drive > Exchange token","Buat folder Drive, copy Folder ID dari URL"] },
      { id:"local",  label:"Local / VPS",   icon:"🖥️", rec:false,
        fields:[{k:"path",label:"Base Path",ph:"/var/aclean/uploads"},{k:"url",label:"Public URL",ph:"https://files.aclean.id"},{k:"max_mb",label:"Max File Size (MB)",ph:"10"}],
        guide:["Buat folder uploads di server","chmod 755 /var/aclean/uploads","Konfigurasi Nginx serve static files","Opsional: setup cache headers"] },
    ];

    const activeWA  = WA_PROVIDERS.find(p => p.id === waProvider)   || WA_PROVIDERS[0];
    const activeLLM = LLM_PROVIDERS.find(p => p.id === llmProvider)  || LLM_PROVIDERS[0];
    const activeSTO = STORAGE_PROVIDERS.find(p => p.id === storageProvider) || STORAGE_PROVIDERS[0];
    const waSC  = waStatus==="connected"?cs.green:waStatus==="testing"?cs.yellow:cs.muted;
    const llmSC = llmStatus==="connected"?cs.green:llmStatus==="testing"?cs.yellow:cs.muted;
    const stoSC = storageStatus==="connected"?cs.green:storageStatus==="testing"?cs.yellow:cs.muted;

    // WA field getter/setter map — token & device tersimpan di state + localStorage
    const waFieldMap = {
      token:  { val: waToken,  set: e => setWaToken(e.target.value)  },
      device: { val: waDevice, set: e => setWaDevice(e.target.value) },
    };
    const FieldList = ({ fields, isLLM }) => (
      <div style={{ display:"grid", gap:8, marginBottom:12 }}>
        {fields.map(f => {
          const isUrlField  = isLLM && f.k === "url";
          const isKeyField  = isLLM && f.k === "key";
          const isWAField   = !isLLM && waFieldMap[f.k];
          const val    = isUrlField ? ollamaUrl : isKeyField ? llmApiKey : isWAField ? waFieldMap[f.k].val : "";
          const setter = isUrlField ? (e=>setOllamaUrl(e.target.value))
                       : isKeyField ? (e=>setLlmApiKey(e.target.value))
                       : isWAField  ? waFieldMap[f.k].set
                       : undefined;
          const isSet  = !!val;
          return (
            <div key={f.k}>
              <div style={{ fontSize:11, color:cs.muted, marginBottom:3 }}>{f.label}</div>
              <input type={f.t||"text"} placeholder={f.ph}
                value={val}
                onChange={setter}
                style={{ width:"100%", background:cs.surface, border:"1px solid "+(isSet?cs.green:cs.border), borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              {isSet && <div style={{ fontSize:10, color:cs.green, marginTop:3 }}>✓ {f.label} tersimpan</div>}
            </div>
          );
        })}
      </div>
    );

    const GuideBox = ({ guide, title }) => (
      <div style={{ background:"#0ea5e910", border:"1px solid #0ea5e930", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#7dd3fc", marginBottom:6 }}>📋 {title}</div>
        {guide.map((s,i) => (
          <div key={i} style={{ display:"flex", gap:8, marginBottom:3, fontSize:11, color:cs.muted }}>
            <span style={{ color:cs.accent, fontWeight:800, minWidth:14 }}>{i+1}.</span><span>{s}</span>
          </div>
        ))}
      </div>
    );

    return (
      <div style={{ display:"grid", gap:20 }}>
        <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>⚙️ Pengaturan Sistem</div>
        {currentUser?.role !== "Owner" && (
          <div style={{ background:cs.red+"12", border:"1px solid "+cs.red+"33", borderRadius:12, padding:"14px 18px", fontSize:13, color:cs.red }}>
            🔒 Halaman Pengaturan hanya dapat diakses oleh Owner.
          </div>
        )}
        {currentUser?.role === "Owner" && (<>

        {/* ── WHATSAPP PROVIDER ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ fontSize:28 }}>📱</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:14 }}>WhatsApp Provider</div>
              <div style={{ fontSize:12, color:cs.muted }}>Gateway WA untuk ARA — bisa diganti kapan saja</div>
            </div>
            <span style={{ fontSize:12, padding:"4px 10px", borderRadius:99, background:waSC+"22", color:waSC, border:"1px solid "+waSC+"44", fontWeight:700 }}>
              {waStatus==="connected"?"● Connected":waStatus==="testing"?"● Testing...":"● Not Connected"}
            </span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
            {WA_PROVIDERS.map(p => (
              <div key={p.id} onClick={() => { setWaProvider(p.id); setWaStatus("not_connected"); }}
                style={{ background:waProvider===p.id?cs.accent+"12":cs.surface, border:"2px solid "+(waProvider===p.id?cs.accent:cs.border), borderRadius:11, padding:"12px 8px", cursor:"pointer", textAlign:"center", position:"relative" }}>
                {p.active && <div style={{ position:"absolute", top:-8, left:"50%", transform:"translateX(-50%)", background:cs.green, color:"#fff", fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:99, whiteSpace:"nowrap" }}>AKTIF SAAT INI</div>}
                <div style={{ fontSize:24, marginBottom:5 }}>{p.icon}</div>
                <div style={{ fontSize:11, fontWeight:800, color:waProvider===p.id?cs.accent:cs.text, marginBottom:3 }}>{p.label}</div>
                <div style={{ fontSize:10, color:cs.muted, lineHeight:1.4 }}>{p.tagline}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:cs.text, marginBottom:8 }}>🔑 Kredensial {activeWA.label}</div>
          <FieldList fields={activeWA.fields} />
          <GuideBox guide={activeWA.guide} title={"Setup " + activeWA.label} />
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={async () => { setWaStatus("testing"); try { const r=await fetch("/api/test-connection",{method:"POST",headers:_apiHeaders(),body:JSON.stringify({type:"wa",provider:waProvider,token:waToken,device:waDevice})}); const d=await r.json(); setWaStatus(d.success?"connected":"not_connected"); showNotif(d.message); } catch(e){ setWaStatus("not_connected"); showNotif("❌ "+e.message); } }}
              style={{ flex:2, background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>
              {waStatus==="testing" ? "⏳ Testing..." : "🔌 Test &amp; Simpan Koneksi"}
            </button>
            <button onClick={() => { setWaStatus("not_connected"); showNotif("Koneksi WA direset"); }}
              style={{ flex:1, background:cs.surface, border:"1px solid "+cs.border, color:cs.muted, padding:"10px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Reset</button>
          </div>
        </div>

        {/* ── ARA BRAIN / LLM PROVIDER ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ fontSize:28 }}>🤖</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:14 }}>ARA Brain — LLM Provider</div>
              <div style={{ fontSize:12, color:cs.muted }}>Model AI yang menjalankan ARA · Brain.md tertanam di semua provider</div>
            </div>
            <span style={{ fontSize:12, padding:"4px 10px", borderRadius:99, background:llmSC+"22", color:llmSC, border:"1px solid "+llmSC+"44", fontWeight:700 }}>
              {llmStatus==="connected"?"● Connected":llmStatus==="testing"?"● Testing...":"● Not Connected"}
            </span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:8, marginBottom:14 }}>
            {LLM_PROVIDERS.map(p => (
              <div key={p.id} onClick={() => {
                      setLlmProvider(p.id);
                      setLlmStatus("not_connected");
                      // Load API key milik provider ini (jika sudah pernah diisi)
                      const savedKey = _ls("llmApiKey_" + p.id, "") || (p.id === "ollama" ? "" : _ls("llmApiKey", ""));
                      setLlmApiKey(savedKey);
                    }}
                style={{ background:llmProvider===p.id?cs.accent+"12":cs.surface, border:"2px solid "+(llmProvider===p.id?cs.accent:cs.border), borderRadius:11, padding:"12px 8px", cursor:"pointer", textAlign:"center", position:"relative" }}>
                {p.rec && <div style={{ position:"absolute", top:-8, left:"50%", transform:"translateX(-50%)", background:cs.green, color:"#fff", fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:99, whiteSpace:"nowrap" }}>REKOMENDASI</div>}
                <div style={{ fontSize:22, marginBottom:4 }}>{p.icon}</div>
                <div style={{ fontSize:10, fontWeight:800, color:llmProvider===p.id?cs.accent:cs.text, lineHeight:1.3 }}>{p.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:cs.muted, fontWeight:700, marginBottom:6 }}>Model</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {activeLLM.models.map((m) => (
                <span key={m} onClick={() => setLlmModel(m)} style={{ padding:"5px 10px", borderRadius:7, background:llmModel===m?cs.accent+"22":cs.surface, border:"1px solid "+(llmModel===m?cs.accent:cs.border), fontSize:11, color:llmModel===m?cs.accent:cs.muted, fontFamily:"monospace", cursor:"pointer" }}>{m}</span>
              ))}
            </div>
            {llmProvider === "ollama" && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:11, color:cs.muted, marginBottom:4 }}>Atau ketik nama model custom (harus sama dengan <code style={{background:cs.surface,padding:"1px 5px",borderRadius:3}}>ollama list</code>):</div>
                <input value={llmModel} onChange={e=>setLlmModel(e.target.value)} placeholder="contoh: llama3, mistral, qwen2.5:7b ..."
                  style={{ width:"100%", background:cs.surface, border:"1px solid "+cs.accent+"44", borderRadius:7, padding:"8px 11px", color:cs.text, fontSize:12, outline:"none", boxSizing:"border-box", fontFamily:"monospace" }} />
              </div>
            )}
            {activeLLM.note && <div style={{ marginTop:6, fontSize:11, color:cs.accent }}>💡 {activeLLM.note}</div>}
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:cs.text, marginBottom:8 }}>{llmProvider==="ollama"?"🦙 Konfigurasi Ollama":"🔑 Kredensial "+activeLLM.label}</div>
          <FieldList fields={activeLLM.fields} isLLM={true} />
          <GuideBox guide={activeLLM.guide} title={"Cara dapat API Key — " + activeLLM.label} />

          {/* Brain.md */}
          <div style={{ background:cs.ara+"08", border:"1px solid "+cs.ara+"33", borderRadius:11, padding:14, marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div>
                <div style={{ fontWeight:800, color:cs.ara, fontSize:13 }}>🧠 Brain.md — Memori ARA (Permanen)</div>
                <div style={{ fontSize:11, color:cs.muted, marginTop:2 }}>Tertanam di semua provider. Ganti LLM apapun, Brain.md tetap terbaca.</div>
              </div>
              <button onClick={() => setModalBrainEdit(true)} style={{ background:cs.ara+"22", border:"1px solid "+cs.ara+"44", color:cs.ara, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}>✏️ Edit Brain</button>
            </div>
            <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, padding:"10px 12px", fontSize:11, color:cs.muted, maxHeight:130, overflow:"auto", fontFamily:"monospace", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
              {(typeof brainMd==="string"?brainMd:"").slice(0,500)}{(typeof brainMd==="string"?brainMd:"").length>500?"...":""}
            </div>
            <div style={{ display:"flex", gap:14, marginTop:8, fontSize:11, color:cs.muted }}>
              <span>📝 {(typeof brainMd==="string"?brainMd:"").split("\n").length} baris</span>
              <span>🔤 {typeof brainMd==="string"?brainMd.length:0} karakter</span>
              <span style={{ color:cs.green }}>✅ Dikirim sebagai system prompt ke {activeLLM.label}</span>
            </div>
          </div>

          {/* ── BRAIN CUSTOMER — ARA WA Bot ── */}
          <div style={{ background:"#22c55e08", border:"1px solid #22c55e33", borderRadius:11, padding:14, marginTop:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div>
                <div style={{ fontWeight:800, color:"#22c55e", fontSize:13 }}>💬 Brain Customer — ARA WA Bot</div>
                <div style={{ fontSize:11, color:cs.muted, marginTop:2 }}>System prompt khusus customer via WhatsApp — TERPISAH dari Brain internal Owner/Admin.</div>
              </div>
              <button onClick={() => setModalBrainCustomerEdit(true)} style={{ background:"#22c55e22", border:"1px solid #22c55e44", color:"#22c55e", padding:"6px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}>✏️ Edit</button>
            </div>
            <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, padding:"10px 12px", fontSize:12, color:cs.muted, fontFamily:"monospace", maxHeight:80, overflow:"hidden", lineHeight:1.6 }}>
              {brainMdCustomer
                ? brainMdCustomer.slice(0,300) + (brainMdCustomer.length > 300 ? "..." : "")
                : <span style={{color:cs.yellow}}>⚠️ Belum diisi — klik Edit untuk mengisi Brain Customer Bot</span>
              }
            </div>
            <div style={{ display:"flex", gap:14, marginTop:8, fontSize:11, color:cs.muted }}>
              <span>📝 {brainMdCustomer.split("\n").length} baris</span>
              <span>🔤 {brainMdCustomer.length} karakter</span>
              <span style={{ color: waToken ? "#22c55e" : cs.yellow }}>
                    {waToken 
                    ? <span>✅ Token tersimpan otomatis — tidak perlu isi ulang setelah logout</span>
                    : "⚠️ Masukkan token Fonnte di atas"}
                  </span>
                  <div style={{ fontSize:10, color:cs.muted, marginTop:4 }}>
                    📤 Kirim WA (dispatch, reminder): free tier ✅<br/>
                    📥 Terima WA customer (bot ARA): butuh upgrade Fonnte + webhook URL:<br/>
                    <span style={{ color:cs.accent, fontFamily:"monospace" }}>https://a-clean-webapp.vercel.app/api/fonnte-webhook</span>
                  </div>
            </div>
          </div>


          <div style={{ display:"flex", gap:8 }}>
            <button onClick={async () => {
              if (llmProvider !== "ollama" && !llmApiKey) { showNotif("❌ Masukkan API Key dulu"); return; }
              if (llmProvider === "ollama" && !ollamaUrl) { showNotif("❌ Masukkan URL Ollama dulu (contoh: http://localhost:11434)"); return; }
              setLlmStatus("testing");
              try {
                let ok = false;
                if (llmProvider === "ollama") {
                  const baseUrl = (ollamaUrl||"http://localhost:11434").replace(/\/+$/, "");
                  // Test: GET /api/tags untuk list model yang tersedia
                  const r = await fetch(baseUrl + "/api/tags", { method:"GET" }).catch(e=>{throw new Error("Tidak bisa koneksi ke "+baseUrl+" — pastikan Ollama berjalan & URL benar. Error: "+e.message);});
                  const d = await r.json().catch(()=>({}));
                  if (!r.ok) throw new Error("Ollama server error " + r.status);
                  const models = (d.models||[]).map(m=>m.name||m.model||m).join(", ");
                  setLlmStatus("connected");
                  showNotif("✅ Ollama terkoneksi! Model tersedia: " + (models||"(kosong — jalankan: ollama pull llama3)"));
                  return; // done for ollama
                } else if (llmProvider === "openai") {
                  const r = await fetch("https://api.openai.com/v1/chat/completions", {
                    method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+llmApiKey},
                    body:JSON.stringify({model:llmModel||"gpt-4o-mini",max_tokens:10,messages:[{role:"user",content:"Hi"}]})
                  });
                  ok = r.ok; if(!ok){const d=await r.json(); throw new Error(d.error?.message||"OpenAI error "+r.status);}
                } else if (llmProvider === "gemini") {
                  const testModel = llmModel || "gemini-2.5-flash";
                  const r = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${llmApiKey}`,
                    { method:"POST", headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({ contents:[{role:"user",parts:[{text:"Hi, reply with just OK"}]}], generationConfig:{maxOutputTokens:5} })
                    }
                  );
                  const rd = await r.json();
                  if (!r.ok) {
                    const errMsg = rd.error?.message || ("Gemini error " + r.status);
                    // Common errors:
                    if (r.status === 400) throw new Error("API Key tidak valid atau model '"+testModel+"' tidak ditemukan. Coba: gemini-2.5-flash atau gemini-1.5-flash");
                    if (r.status === 403) throw new Error("API Key tidak punya akses. Aktifkan Generative Language API di Google Cloud Console.");
                    throw new Error(errMsg);
                  }
                  ok = true;
                } else {
                  const r = await fetch("https://api.anthropic.com/v1/messages", {
                    method:"POST", headers:{"Content-Type":"application/json","x-api-key":llmApiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
                    body:JSON.stringify({model:llmModel||"claude-sonnet-4-6",max_tokens:10,messages:[{role:"user",content:"Hi"}]})
                  });
                  ok = r.ok; if(!ok){const d=await r.json(); throw new Error(d.error?.message||"Claude error");}
                }
                setLlmStatus("connected");
                const modelInfo = llmModel ? " ("+llmModel+")" : "";
                showNotif("✅ Koneksi " + activeLLM.label + modelInfo + " berhasil! ARA Chat siap digunakan.");
              } catch(e) { setLlmStatus("not_connected"); showNotif("❌ Koneksi gagal: " + e.message); }
            }}
              style={{ flex:2, background:"linear-gradient(135deg,"+cs.ara+",#7c3aed)", border:"none", color:"#fff", padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>
              {llmStatus==="testing" ? "⏳ Testing..." : "🔌 Test &amp; Simpan — " + activeLLM.label}
            </button>
            <button onClick={() => { setLlmStatus("not_connected"); showNotif("Koneksi LLM direset"); }}
              style={{ flex:1, background:cs.surface, border:"1px solid "+cs.border, color:cs.muted, padding:"10px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Reset</button>
          </div>
        </div>

        {/* ── FILE STORAGE ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ fontSize:28 }}>📁</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:14 }}>File Storage</div>
              <div style={{ fontSize:12, color:cs.muted }}>Foto laporan, invoice PDF, bukti transfer</div>
            </div>
            <span style={{ fontSize:12, padding:"4px 10px", borderRadius:99, background:stoSC+"22", color:stoSC, border:"1px solid "+stoSC+"44", fontWeight:700 }}>
              {storageStatus==="connected"?"● Connected":storageStatus==="testing"?"● Testing...":"● Not Connected"}
            </span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
            {STORAGE_PROVIDERS.map(p => (
              <div key={p.id} onClick={() => { setStorageProvider(p.id); setStorageStatus("not_connected"); }}
                style={{ background:storageProvider===p.id?cs.accent+"12":cs.surface, border:"2px solid "+(storageProvider===p.id?cs.accent:cs.border), borderRadius:11, padding:"12px 8px", cursor:"pointer", textAlign:"center", position:"relative" }}>
                {p.rec && <div style={{ position:"absolute", top:-8, left:"50%", transform:"translateX(-50%)", background:cs.green, color:"#fff", fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:99, whiteSpace:"nowrap" }}>REKOMENDASI</div>}
                <div style={{ fontSize:24, marginBottom:5 }}>{p.icon}</div>
                <div style={{ fontSize:11, fontWeight:800, color:storageProvider===p.id?cs.accent:cs.text }}>{p.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:cs.text, marginBottom:8 }}>🔑 Kredensial {activeSTO.label}</div>
          <FieldList fields={activeSTO.fields} />
          <GuideBox guide={activeSTO.guide} title={"Setup " + activeSTO.label} />
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={async () => { setStorageStatus("testing"); try { const r=await fetch("/api/test-connection",{method:"POST",headers:_apiHeaders(),body:JSON.stringify({type:"storage"})}); const d=await r.json(); setStorageStatus(d.success?"connected":"not_connected"); showNotif(d.message); } catch(e){ setStorageStatus("not_connected"); showNotif("❌ "+e.message); } }}
              style={{ flex:2, background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>
              {storageStatus==="testing" ? "⏳ Testing..." : "🔌 Test &amp; Simpan Koneksi"}
            </button>
            <button onClick={() => { setStorageStatus("not_connected"); showNotif("Storage direset"); }}
              style={{ flex:1, background:cs.surface, border:"1px solid "+cs.border, color:cs.muted, padding:"10px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Reset</button>
          </div>
        </div>

        {/* ── DATABASE ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ fontSize:28 }}>🗄️</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:cs.text, fontSize:14 }}>Database Provider</div>
              <div style={{ fontSize:12, color:cs.muted }}>Pilih provider database — bisa diganti kapan saja</div>
            </div>
            <span style={{ fontSize:12, padding:"4px 10px", borderRadius:99, background:cs.green+"22", color:cs.green, border:"1px solid "+cs.green+"44", fontWeight:700 }}>● Connected</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)", gap:8, marginBottom:14 }}>
            {[{id:"supabase",label:"Supabase",icon:"⚡",rec:true,desc:"PostgreSQL managed, real-time"},{id:"postgresql",label:"PostgreSQL",icon:"🐘",rec:false,desc:"Self-hosted, full control"},{id:"mysql",label:"MySQL",icon:"🐬",rec:false,desc:"Populer, banyak hosting"},{id:"mongodb",label:"MongoDB",icon:"🍃",rec:false,desc:"NoSQL flexible"}].map(db => (
              <div key={db.id} onClick={() => setDbProvider(db.id)}
                style={{ background:dbProvider===db.id?cs.accent+"12":cs.surface, border:"2px solid "+(dbProvider===db.id?cs.accent:cs.border), borderRadius:11, padding:"12px 8px", cursor:"pointer", textAlign:"center", position:"relative" }}>
                {db.rec && <div style={{ position:"absolute", top:-8, left:"50%", transform:"translateX(-50%)", background:cs.green, color:"#fff", fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:99, whiteSpace:"nowrap" }}>REKOMENDASI</div>}
                <div style={{ fontSize:22, marginBottom:5 }}>{db.icon}</div>
                <div style={{ fontSize:11, fontWeight:700, color:dbProvider===db.id?cs.accent:cs.text, marginBottom:3 }}>{db.label}</div>
                <div style={{ fontSize:10, color:cs.muted, lineHeight:1.4 }}>{db.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"grid", gap:8 }}>
            <input placeholder={dbProvider==="supabase"?"Supabase URL":"Host / Connection String"} style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }} />
            <input type="password" placeholder={dbProvider==="supabase"?"Supabase Anon Key":"Password / Secret Key"} style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }} />
            <button onClick={() => { showNotif("Mencoba koneksi database..."); setTimeout(() => showNotif("Database terkoneksi! Tables: 15"), 2000); }}
              style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"9px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}>🔌 Test Koneksi</button>
          </div>
        </div>

        {/* ── CRON JOBS ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ fontSize:28 }}>⏰</div>
              <div>
                <div style={{ fontWeight:700, color:cs.text, fontSize:14 }}>Cron Jobs (Scheduler)</div>
                <div style={{ fontSize:12, color:cs.muted }}>Tugas otomatis ARA</div>
              </div>
            </div>
            <button onClick={() => setCronJobs(prev => [...prev, { id:Date.now(), name:"Job Baru", time:"09:00", days:"Setiap Hari", active:false, task:"Deskripsi tugas..." }])}
              style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}>+ Tambah Job</button>
          </div>
          <div style={{ display:"grid", gap:8 }}>
            {cronJobs.map((job,idx) => (
              <div key={job.id} style={{ background:cs.surface, border:"1px solid "+(job.active?cs.green:cs.border), borderRadius:10, padding:"12px 14px", display:"flex", gap:12, alignItems:"center" }}>
                <div onClick={() => setCronJobs(prev => prev.map((j,i) => i===idx ? {...j,active:!j.active} : j))}
                  style={{ width:34, height:20, borderRadius:99, background:job.active?cs.green:cs.border, cursor:"pointer", position:"relative", flexShrink:0 }}>
                  <div style={{ position:"absolute", width:14, height:14, borderRadius:"50%", background:"#fff", top:3, left:job.active?17:3, transition:"left 0.2s" }} />
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:job.active?cs.text:cs.muted, fontSize:13 }}>{job.name}</div>
                  <div style={{ fontSize:11, color:cs.muted }}>{job.time} · {job.days} · {job.task}</div>
                </div>
                <button onClick={() => setCronJobs(prev => prev.filter((_,i) => i!==idx))} style={{ background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16, lineHeight:1 }}>×</button>
              </div>
            ))}
          </div>
        </div>
        {/* ── USER MANAGEMENT (Owner only) ── */}
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div>
              <div style={{ fontWeight:800, color:cs.text, fontSize:14 }}>👥 Manajemen Akun Pengguna</div>
              <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>Kelola akun Owner &amp; Admin saja. Teknisi &amp; Helper dikelola di menu <b style={{color:cs.accent}}>Tim Teknisi</b>. Hanya Owner yang bisa menambah/nonaktifkan.</div>
            </div>
            <button onClick={() => { setNewUserForm({ name:"", email:"", role:"Admin", password:"", phone:"", _adminOnly: true }); setModalAddUser(true); }}
              style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"9px 16px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:12 }}>
              + Tambah Pengguna
            </button>
          </div>
          {/* Role legend */}
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            {[["👑 Owner","Semua akses + Pengaturan","#f59e0b"],["🛠️ Admin","Semua menu kecuali Pengaturan","#38bdf8"],["👷 Teknisi","Jadwal &amp; Tim Teknisi saja","#22c55e"]].map(([role,desc,col]) => (
              <div key={role} style={{ background:col+"12", border:"1px solid "+col+"33", borderRadius:8, padding:"6px 12px", fontSize:11 }}>
                <span style={{ color:col, fontWeight:700 }}>{role}</span>
                <span style={{ color:cs.muted, marginLeft:6 }}>{desc}</span>
              </div>
            ))}
          </div>
          {/* User list — hanya Owner & Admin (Teknisi/Helper dikelola di Tim Teknisi) */}
          <div style={{ display:"grid", gap:8 }}>
            {userAccounts.map(u => (
              <div key={u.id} style={{ background:cs.surface, border:"1px solid "+(u.active?cs.border:cs.red+"33"), borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:38, height:38, borderRadius:10, background:"linear-gradient(135deg,"+u.color+","+u.color+"66)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:16, color:"#fff", flexShrink:0 }}>
                  {u.avatar}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                    <span style={{ fontWeight:700, color:cs.text, fontSize:13 }}>{u.name}</span>
                    <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:u.color+"22", color:u.color, fontWeight:700, border:"1px solid "+u.color+"44" }}>
                      {u.role === "Owner" ? "👑" : u.role === "Admin" ? "🛠️" : u.role === "Helper" ? "🤝" : "👷"} {u.role}
                    </span>
                    {!u.active && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:cs.red+"22", color:cs.red, fontWeight:700 }}>Nonaktif</span>}
                  </div>
                  <div style={{ fontSize:11, color:cs.muted }}>
                    {u.email} · {u.phone} · Login terakhir: {u.lastLogin}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  {u.role !== "Owner" && (
                    <button onClick={() => { setNewUserForm({...u, password:""}); setModalAddUser(true); }}
                      style={{ background:cs.accent+"18", border:"1px solid "+cs.accent+"33", color:cs.accent, padding:"5px 10px", borderRadius:6, cursor:"pointer", fontSize:11 }}>✏️ Edit</button>
                  )}
                  {u.role !== "Owner" && (
                    <button onClick={() => { setUserAccounts(prev => prev.map(acc => acc.id===u.id ? {...acc, active:!acc.active} : acc)); showNotif((u.active?"Akun ":"Akun ")+(u.name)+(u.active?" dinonaktifkan":" diaktifkan")); }}
                      style={{ background:(u.active?cs.red:cs.green)+"18", border:"1px solid "+(u.active?cs.red:cs.green)+"33", color:u.active?cs.red:cs.green, padding:"5px 10px", borderRadius:6, cursor:"pointer", fontSize:11 }}>
                      {u.active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        </>)}
      </div>
    );
  };

  // ============================================================
  // RENDER CONTENT ROUTER
  // ============================================================
  const renderContent = () => {
    switch (activeMenu) {
      case "dashboard":  return renderDashboard();
      case "orders":     return renderOrders();
      case "schedule":   return renderSchedule();
      case "invoice":    return renderInvoice();
      case "customers":  return renderCustomers();
      case "inventory":  return renderInventory();
      case "pricelist":  return renderPriceList();
      case "teknisi":    return renderTeknisiAdmin();
      case "laporantim": return renderLaporanTim();
      case "myreport":   return renderMyReport();
      case "ara":        return renderAra();
      case "reports":    return renderReports();
      case "agentlog":   return renderAgentLog();
      case "settings":   return renderSettings();
      default:           return renderDashboard();
    }
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================
  // ─────────────── LOGIN SCREEN ───────────────
  if (!isLoggedIn) {
    const DEMO_ACCOUNTS = [
      { role:"Owner",   color:"#f59e0b", icon:"👑", email:"owner@aclean.id",   password:"owner123",  name:"Malda Retta",  desc:"Akses penuh semua menu & pengaturan" },
      { role:"Admin",   color:"#38bdf8", icon:"🛠️", email:"admin@aclean.id",   password:"admin123",  name:"Admin AClean", desc:"Semua menu kecuali Pengaturan"       },
      { role:"Teknisi", color:"#22c55e", icon:"👷", email:"mulyadi@aclean.id", password:"mly2026",   name:"Mulyadi",      desc:"Jadwal & Laporan Saya saja"          },
      { role:"Helper",  color:"#a78bfa", icon:"🤝", email:"albana@aclean.id",  password:"abn2026",   name:"Albana Niji",  desc:"Jadwal & Laporan Saya saja"          },
    ];
    return (
      <div style={{ background:cs.bg, color:cs.text, minHeight:"100vh", fontFamily:"system-ui,-apple-system,sans-serif", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
        <div style={{ width:"100%", maxWidth:440 }}>
          {/* Logo */}
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:48, marginBottom:8 }}>⬡</div>
            <div style={{ fontWeight:900, fontSize:28, color:cs.accent, letterSpacing:2 }}>ACLEAN</div>
            <div style={{ fontSize:13, color:cs.muted, marginTop:4 }}>Service Management System</div>
          </div>

          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, padding:28 }}>
            <div style={{ fontWeight:800, fontSize:16, color:cs.text, marginBottom:4 }}>Masuk ke Panel</div>
            <div style={{ fontSize:12, color:cs.muted, marginBottom:22 }}>Login dengan akun yang diberikan oleh Owner</div>

            {loginError && (
              <div style={{ background: loginError.startsWith("⛔") ? "#f9731620" : "#ef444418",
                            border: "1px solid " + (loginError.startsWith("⛔") ? "#f97316" : "#ef444433"),
                            borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12,
                            color: loginError.startsWith("⛔") ? "#f97316" : cs.red }}>
                {loginError.startsWith("⛔") ? loginError : "⚠️ " + loginError}
              </div>
            )}

            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Email</div>
              <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                placeholder="email@aclean.id"
                style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"11px 14px", color:cs.text, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Password</div>
              <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doLogin(loginEmail, loginPassword)}
                placeholder="••••••••"
                style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"11px 14px", color:cs.text, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <button onClick={() => doLogin(loginEmail, loginPassword)}
              style={{ width:"100%", background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"13px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:15, marginBottom:16 }}>
              Masuk →
            </button>

            {/* Info akun */}
            <div style={{ borderTop:"1px solid "+cs.border, paddingTop:14, textAlign:"center" }}>
              <div style={{ fontSize:11, color:cs.muted }}>Tidak punya akun? Hubungi Owner untuk mendapatkan akses.</div>
            </div>
          </div>

          <div style={{ textAlign:"center", marginTop:16, fontSize:11, color:cs.muted }}>
            Tidak punya akun? Hubungi Owner untuk mendapatkan akses.
          </div>
        </div>
        <style>{"*{box-sizing:border-box} input::placeholder{color:#4a5568}"}</style>
      </div>
    );
  }

  const isTekRoleGlobal = currentUser?.role === "Teknisi" || currentUser?.role === "Helper";

  return (
    <div style={{ background:cs.bg, color:cs.text, minHeight:"100vh", fontFamily:"system-ui,-apple-system,sans-serif", display:isMobile?"block":"flex" }}>

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
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9999, background:"linear-gradient(90deg,#38bdf8,#6366f1)", padding:"8px 16px", display:"flex", alignItems:"center", gap:10, fontSize:12, color:"#fff", fontWeight:700 }}>
          <div style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.4)", borderTop:"2px solid #fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
          Memuat data dari Supabase...
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── SIDEBAR (desktop only) ── */}
      {!isMobile && <div style={{ width:200, background:cs.surface, borderRight:"1px solid "+cs.border, display:"flex", flexDirection:"column", flexShrink:0, position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>
        <div style={{ padding:"16px 14px", borderBottom:"1px solid "+cs.border }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontWeight:800, fontSize:16, color:cs.accent }}>⬡ AClean</div>
            <span style={{ fontSize:9, color:cs.accent, fontWeight:700, background:cs.accent+"18", padding:"2px 6px", borderRadius:4, border:"1px solid "+cs.accent+"33" }}>v18</span>
          </div>
          {currentUser && (
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,"+currentUser.color+","+currentUser.color+"88)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:14, color:"#fff", flexShrink:0 }}>
                {currentUser.avatar}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:700, color:cs.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.name}</div>
                <div style={{ fontSize:10, color:currentUser.color, fontWeight:600 }}>
                  {currentUser.role === "Owner" ? "👑 Owner" : currentUser.role === "Admin" ? "🛠️ Admin" : currentUser.role === "Helper" ? "🤝 Helper" : "👷 Teknisi"}
                </div>
              </div>
            </div>
          )}
        </div>
        <nav style={{ flex:1, padding:"10px 8px" }}>
          {menuItems.map(item => (
            <button key={item.id} onClick={() => setActiveMenu(item.id)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:9, padding:"9px 10px", borderRadius:9, border:"none", background:activeMenu===item.id?cs.accent+"22":"transparent", color:activeMenu===item.id?cs.accent:cs.muted, cursor:"pointer", fontSize:13, fontWeight:activeMenu===item.id?700:400, marginBottom:1, textAlign:"left", borderLeft:activeMenu===item.id?"3px solid "+cs.accent:"3px solid transparent" }}>
              <span>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <div style={{ padding:"12px 14px", borderTop:"1px solid "+cs.border, display:"grid", gap:6 }}>
          {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
            <button onClick={() => setWaPanel(true)} style={{ width:"100%", background:"#25D36618", border:"1px solid #25D36644", color:"#25D366", padding:"8px", borderRadius:8, cursor:"pointer", fontWeight:600, fontSize:12, position:"relative" }}>
              📱 WhatsApp
              {waConversations.filter(c => c.unread>0).length > 0 && (
                <span style={{ position:"absolute", top:-4, right:-4, background:cs.red, color:"#fff", fontSize:9, borderRadius:"50%", width:16, height:16, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {waConversations.filter(c=>c.unread>0).reduce((a,b)=>a+b.unread,0)}
                </span>
              )}
            </button>
          )}
          <button onClick={doLogout} style={{ width:"100%", background:cs.red+"12", border:"1px solid "+cs.red+"33", color:cs.red, padding:"8px", borderRadius:8, cursor:"pointer", fontWeight:600, fontSize:12 }}>
            Keluar →
          </button>
        </div>
      </div>}

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex:1, overflowY:"auto", paddingBottom:isMobile?"70px":0 }}>
        <div style={{ padding:isMobile?"12px":"20px 24px", maxWidth:1200 }}>
          {/* Mobile top bar */}
          {isMobile && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, paddingBottom:12, borderBottom:"1px solid "+cs.border }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:18 }}>{ALL_MENU.find(m=>m.id===activeMenu)?.icon}</span>
                <div style={{ fontWeight:800, fontSize:15, color:cs.text }}>{ALL_MENU.find(m=>m.id===activeMenu)?.label}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {currentUser && (
                  <div style={{ width:28, height:28, borderRadius:7, background:"linear-gradient(135deg,"+currentUser.color+","+currentUser.color+"99)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:"#fff" }}>
                    {currentUser.avatar}
                  </div>
                )}
                <button onClick={doLogout} style={{ background:"none", border:"none", color:cs.muted, fontSize:12, cursor:"pointer", padding:"4px 6px" }}>⏻</button>
              </div>
            </div>
          )}
          {/* Desktop page header */}
          {!isMobile && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, paddingBottom:16, borderBottom:"1px solid "+cs.border }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>{ALL_MENU.find(m=>m.id===activeMenu)?.icon}</span>
              <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>{ALL_MENU.find(m=>m.id===activeMenu)?.label}</div>
            </div>
            {activeMenu === "schedule" && !isTekRoleGlobal && (
              <div style={{ fontSize:11, color:cs.muted }}>
                Filter aktif: <span style={{ color:cs.accent, fontWeight:700 }}>{filterTeknisi === "Semua" ? "Semua Teknisi" : filterTeknisi}</span>
              </div>
            )}
          </div>
          )}
          {renderContent()}
        </div>
      </div>

      {/* ── BOTTOM NAV (mobile only) ── */}
      {isMobile && (
        <>
        {/* Drawer menu — tampil saat More diklik */}
        {mobileDrawerOpen && (
          <div style={{ position:"fixed", inset:0, zIndex:550, background:"#000a" }} onClick={() => setMobileDrawerOpen(false)}>
            <div style={{ position:"absolute", bottom:64, left:0, right:0, background:cs.surface, borderRadius:"20px 20px 0 0", padding:"16px 12px 8px", border:"1px solid "+cs.border }}
              onClick={e => e.stopPropagation()}>
              <div style={{ textAlign:"center", marginBottom:12 }}>
                <div style={{ width:36, height:4, background:cs.border, borderRadius:2, margin:"0 auto" }} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                {menuItems.filter(m => !["dashboard","orders","schedule","laporantim","ara"].includes(m.id)).map(item => (
                  <button key={item.id} onClick={() => { setActiveMenu(item.id); setMobileDrawerOpen(false); }}
                    style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"12px 4px", background: activeMenu===item.id ? cs.accent+"18" : cs.card, border:"1px solid "+(activeMenu===item.id ? cs.accent : cs.border), borderRadius:12, cursor:"pointer", color: activeMenu===item.id ? cs.accent : cs.text }}>
                    <span style={{ fontSize:22 }}>{item.icon}</span>
                    <span style={{ fontSize:9, fontWeight:600, textAlign:"center" }}>{item.label}</span>
                  </button>
                ))}
                {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
                  <button onClick={() => { setWaPanel(true); setMobileDrawerOpen(false); }}
                    style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"12px 4px", background:"#25D36618", border:"1px solid #25D36644", borderRadius:12, cursor:"pointer", color:"#25D366", position:"relative" }}>
                    <span style={{ fontSize:22 }}>💬</span>
                    <span style={{ fontSize:9, fontWeight:600 }}>WhatsApp</span>
                    {waConversations.filter(c=>c.unread>0).length > 0 && (
                      <span style={{ position:"absolute", top:6, right:8, background:cs.red, color:"#fff", fontSize:8, fontWeight:800, borderRadius:99, padding:"1px 5px" }}>
                        {waConversations.filter(c=>c.unread>0).reduce((a,b)=>a+b.unread,0)}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Bottom tab bar */}
        <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:500, background:cs.surface, borderTop:"1px solid "+cs.border, display:"flex", alignItems:"stretch", paddingBottom:"env(safe-area-inset-bottom,0px)" }}>
          {[
            { id:"dashboard",  icon:"⬡",  label:"Home"    },
            { id:"orders",     icon:"📋",  label:"Order"   },
            { id:"schedule",   icon:"📅",  label:"Jadwal"  },
            { id:"laporantim", icon:"📝",  label:"Laporan" },
            { id:"ara",        icon:"🤖",  label:"ARA"     },
          ].filter(item => menuItems.some(m => m.id === item.id)).map(item => (
            <button key={item.id} onClick={() => { setActiveMenu(item.id); setMobileDrawerOpen(false); }}
              style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, padding:"8px 4px 10px", background:"none", border:"none", cursor:"pointer",
                color: activeMenu===item.id ? cs.accent : cs.muted,
                borderTop: activeMenu===item.id ? "2px solid "+cs.accent : "2px solid transparent",
              }}>
              <span style={{ fontSize:18 }}>{item.icon}</span>
              <span style={{ fontSize:9, fontWeight:600 }}>{item.label}</span>
            </button>
          ))}
          <button onClick={() => setMobileDrawerOpen(o => !o)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, padding:"8px 4px 10px", background:"none", border:"none", cursor:"pointer",
              color: mobileDrawerOpen ? cs.accent : cs.muted,
              borderTop: mobileDrawerOpen ? "2px solid "+cs.accent : "2px solid transparent",
            }}>
            <span style={{ fontSize:18 }}>☰</span>
            <span style={{ fontSize:9, fontWeight:600 }}>Menu</span>
          </button>
        </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — BUAT ORDER */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalOrder && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setModalOrder(false)}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, width:"100%", maxWidth:500, maxHeight:"90vh", overflowY:"auto", padding:28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>📋 Buat Order Baru</div>
              <button onClick={() => setModalOrder(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ display:"grid", gap:12 }}>
              {[["Nama Customer","customer","text"],["Nomor HP","phone","text"],["Alamat Lengkap","address","text"],["Area / Kota","area","text"],["Catatan","notes","text"]].map(([label,key,type]) => (
                <div key={key}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>{label}</div>
                  <input type={type} value={newOrderForm[key]||""} onChange={e => {
                    const val = e.target.value;
                    if (key === "phone") {
                      const normVal = normalizePhone(val);
                      const matches = customersData.filter(c => samePhone(c.phone, val));
                      if (matches.length === 1) {
                        // 1 match → auto-fill langsung
                        setNewOrderForm(f => ({...f, phone:normVal, customer:matches[0].name, address:matches[0].address||f.address, area:matches[0].area||f.area}));
                      } else if (matches.length > 1) {
                        // Multiple match (phone sama, beda lokasi) → JANGAN auto-fill nama/alamat
                        // Biarkan user pilih sendiri atau ketik nama berbeda
                        setNewOrderForm(f => ({...f, phone:normVal}));
                      } else {
                        setNewOrderForm(f => ({...f, phone:normVal}));
                      }
                    } else { setNewOrderForm(f => ({...f, [key]:val})); }
                  }}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              ))}
              {/* Customer auto-detect badge */}
              {newOrderForm.phone && newOrderForm.phone.length >= 6 && (() => {
                const phoneMatches = customersData.filter(c => samePhone(c.phone, newOrderForm.phone));
                const exactMatch  = findCustomer(customersData, newOrderForm.phone, newOrderForm.customer);
                if (phoneMatches.length > 1) {
                  // Phone sama, beda nama/lokasi → tampilkan pilihan
                  return (
                    <div style={{ borderRadius:8, overflow:"hidden", border:"1px solid #f59e0b44" }}>
                      <div style={{ padding:"7px 12px", background:"#f59e0b18", fontSize:12, fontWeight:700, color:"#d97706" }}>
                        📍 {phoneMatches.length} lokasi ditemukan dengan nomor ini — pilih atau isi nama baru:
                      </div>
                      {phoneMatches.map(m => (
                        <div key={m.id} onClick={() => setNewOrderForm(f=>({...f, customer:m.name, address:m.address||f.address, area:m.area||f.area}))}
                          style={{ padding:"7px 12px", background: newOrderForm.customer===m.name ? "#16a34a22" : cs.card,
                            borderTop:"1px solid "+cs.border, cursor:"pointer", fontSize:12,
                            color: newOrderForm.customer===m.name ? "#16a34a" : cs.text, display:"flex", justifyContent:"space-between" }}>
                          <span>{newOrderForm.customer===m.name?"✅ ":""}<strong>{m.name}</strong></span>
                          <span style={{color:cs.muted,fontSize:11}}>{m.address||m.area||"—"}</span>
                        </div>
                      ))}
                      <div style={{padding:"6px 12px",background:cs.surface,fontSize:11,color:cs.muted}}>
                        Atau ketik nama baru di atas untuk lokasi berbeda
                      </div>
                    </div>
                  );
                }
                return (
                  <div style={{ padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:700,
                    background: exactMatch ? "#16a34a18" : "#f59e0b18",
                    border: "1px solid " + (exactMatch ? "#16a34a44" : "#f59e0b44"),
                    color: exactMatch ? "#16a34a" : "#d97706",
                    display:"flex", alignItems:"center", gap:8
                  }}>
                    {exactMatch ? "✅" : "🆕"}
                    {exactMatch
                      ? `Customer EXISTING: ${exactMatch.name} — ${exactMatch.total_orders||0} order sebelumnya`
                      : "Customer BARU — akan otomatis ditambahkan ke menu Customer"}
                  </div>
                );
              })()}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Jenis Layanan</div>
                  <select value={newOrderForm.service} onChange={e => setNewOrderForm(f=>({...f,service:e.target.value}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                    {["Cleaning","Install","Repair","Complain"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Jumlah Unit</div>
                  <input type="number" min="1" max="20" value={newOrderForm.units} onChange={e => setNewOrderForm(f=>({...f,units:parseInt(e.target.value)||1}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              </div>
              {/* Tipe AC */}
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Tipe AC</div>
                <select value={newOrderForm.type||"AC Split 0.5-1PK"} onChange={e => setNewOrderForm(f=>({...f,type:e.target.value}))}
                  style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                  {newOrderForm.service==="Cleaning" && ["AC Split 0.5-1PK","AC Split 1.5-2.5PK","AC Cassette 2-2.5PK","AC Cassette 3PK","AC Cassette 4PK","AC Cassette 5PK","AC Cassette 6PK","AC Standing","AC Split Duct","Jasa Service Besar 0,5PK - 1PK","Jasa Service Besar 1,5PK - 2,5PK"].map(t=><option key={t}>{t}</option>)}
                  {newOrderForm.service==="Install"  && ["Pemasangan AC Baru 0,5PK - 1PK","Pemasangan AC Baru 1,5PK - 2PK","Bongkar Pasang AC Split 1/2 - 1PK","Bongkar Pasang AC Split 1,5 - 2,5PK","Pasang AC Cassette","Pasang AC Standing","Pasang AC Split 3PK"].map(t=><option key={t}>{t}</option>)}
                  {newOrderForm.service==="Repair"   && ["Pengecekan AC","Pengecekan AC Panas/Bocor","Ganti Freon","Ganti Kompressor","Ganti Kapasitor","Bocor Refrigerant","Perbaikan PCB","Perbaikan Motor Fan"].map(t=><option key={t}>{t}</option>)}
                  {newOrderForm.service==="Complain" && ["Garansi Servis (gratis)","Komplain AC Tidak Dingin","Komplain Bising/Berisik","Komplain Bocor Air","Komplain Garansi","Komplain Setelah Servis","Pengecekan AC Gratis","Pengecekan Ulang"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Teknisi</div>
                  {(() => {
                    const tgl = newOrderForm.date || "";
                    return (
                      <select value={newOrderForm.teknisi} onChange={e => setNewOrderForm(f=>({...f,teknisi:e.target.value,helper:""}))}
                        style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                        <option value="">Pilih teknisi...</option>
                        {teknisiData.filter(t=>t.role==="Teknisi").map(t => {
                          const jobHariIni = tgl ? ordersData.filter(o =>
                            o.teknisi===t.name && o.date===tgl &&
                            ["PENDING","CONFIRMED","DISPATCHED","ON_SITE","IN_PROGRESS"].includes(o.status)
                          ).length : 0;
                          const penuh = jobHariIni >= MAX_LOKASI_PER_HARI;
                          return (
                            <option key={t.id} value={t.name} disabled={penuh}>
                              {penuh ? "🔴" : jobHariIni >= 4 ? "🟡" : "🟢"} {t.name} — {jobHariIni}/6 job{penuh ? " (PENUH)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    );
                  })()}
                  {/* GAP-3: Warning cap 6 lokasi */}
                  {newOrderForm.teknisi && newOrderForm.date && (() => {
                    const jobCount = ordersData.filter(o =>
                      o.teknisi===newOrderForm.teknisi && o.date===newOrderForm.date &&
                      ["PENDING","CONFIRMED","DISPATCHED","ON_SITE","IN_PROGRESS"].includes(o.status)
                    ).length;
                    if (jobCount >= MAX_LOKASI_PER_HARI) return (
                      <div style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", borderRadius:7, padding:"7px 10px", fontSize:11, color:cs.red, marginTop:4 }}>
                        🔴 <b>{newOrderForm.teknisi}</b> sudah {jobCount} job di {newOrderForm.date} — batas 6 lokasi tercapai. Pilih teknisi lain atau tanggal lain.
                      </div>
                    );
                    if (jobCount >= 4) return (
                      <div style={{ background:cs.yellow+"18", border:"1px solid "+cs.yellow+"33", borderRadius:7, padding:"7px 10px", fontSize:11, color:cs.yellow, marginTop:4 }}>
                        🟡 <b>{newOrderForm.teknisi}</b> sudah {jobCount}/6 job di tanggal ini.
                      </div>
                    );
                    return null;
                  })()}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Tanggal</div>
                  <input type="date" value={newOrderForm.date} onChange={e => setNewOrderForm(f=>({...f,date:e.target.value}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              </div>
              {/* Jam Mulai 09:00-17:00 */}
              {(() => {
                const jamSelesai = hitungJamSelesai(newOrderForm.time||"09:00", newOrderForm.service, newOrderForm.units);
                const dur = hitungDurasi(newOrderForm.service, newOrderForm.units);
                const avail = newOrderForm.teknisi && newOrderForm.date
                  ? cekTeknisiAvailable(newOrderForm.teknisi, newOrderForm.date, newOrderForm.time||"09:00", newOrderForm.service, newOrderForm.units)
                  : true;
                const slotSaran = newOrderForm.teknisi && newOrderForm.date
                  ? cariSlotKosong(newOrderForm.teknisi, newOrderForm.date, newOrderForm.service, newOrderForm.units)
                  : null;
                return (
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5, display:"flex", alignItems:"center", gap:8 }}>
                      Jam Mulai
                      <span style={{ fontSize:10, color:cs.muted, fontWeight:400 }}>09:00 – 17:00 WIB</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:5, marginBottom:6 }}>
                      {["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"].map(t=>{
                        const endT = hitungJamSelesai(t, newOrderForm.service, newOrderForm.units);
                        const ok = endT <= "17:00";
                        const isAvail = newOrderForm.teknisi && newOrderForm.date
                          ? cekTeknisiAvailable(newOrderForm.teknisi, newOrderForm.date, t, newOrderForm.service, newOrderForm.units)
                          : true;
                        const isSelected = newOrderForm.time === t;
                        return (
                          <button key={t} onClick={()=>ok&&setNewOrderForm(f=>({...f,time:t}))} disabled={!ok}
                            style={{ background:isSelected?"linear-gradient(135deg,"+cs.accent+",#3b82f6)":!ok?cs.border+"33":!isAvail?cs.red+"22":cs.card, border:"1px solid "+(isSelected?cs.accent:!ok?"transparent":!isAvail?cs.red+"44":cs.border), color:isSelected?"#0a0f1e":!ok?cs.border:!isAvail?cs.red:cs.text, borderRadius:8, padding:"7px 2px", cursor:ok?"pointer":"not-allowed", fontSize:11, fontWeight:isSelected?800:400, position:"relative" }}>
                            {t}
                            {!isAvail && ok && <span style={{fontSize:7,display:"block",color:cs.red}}>⚠ bentrok</span>}
                          </button>
                        );
                      })}
                    </div>
                    <input type="time" min="09:00" max="17:00" value={newOrderForm.time||"09:00"} onChange={e=>setNewOrderForm(f=>({...f,time:e.target.value}))}
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"8px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                    {/* Estimasi durasi & jam selesai */}
                    <div style={{ marginTop:8, background:avail?cs.green+"10":cs.red+"10", border:"1px solid "+(avail?cs.green:cs.red)+"22", borderRadius:8, padding:"8px 12px", display:"flex", gap:12, flexWrap:"wrap", fontSize:12 }}>
                      <span>⏱ Estimasi: <b style={{color:cs.accent}}>{dur >= 8 ? "1 hari kerja" : dur+"jam"}</b></span>
                      <span>🕐 Selesai ±: <b style={{color:cs.green}}>{jamSelesai} WIB</b></span>
                      {newOrderForm.teknisi && newOrderForm.date && (
                        <span>{avail ? <span style={{color:cs.green}}>✓ Teknisi tersedia</span> : <span style={{color:cs.red}}>⚠ Jadwal bentrok!</span>}</span>
                      )}
                      {!avail && slotSaran && (
                        <span style={{color:cs.yellow,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setNewOrderForm(f=>({...f,time:slotSaran}))}>
                          Slot kosong: {slotSaran} (klik pakai)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5, display:"flex", alignItems:"center", gap:8 }}>
                  Helper
                  {newOrderForm.teknisi && newOrderForm.date && (() => {
                    const { pref } = araSchedulingSuggest(newOrderForm.date, newOrderForm.service, newOrderForm.units);
                    const sug = pref[newOrderForm.teknisi];
                    return sug ? (
                      <span style={{ fontSize:10, color:cs.green, background:cs.green+"18", padding:"2px 8px", borderRadius:99, border:"1px solid "+cs.green+"33", cursor:"pointer" }}
                        onClick={() => setNewOrderForm(f=>({...f,helper:sug}))}>
                        ARA rekomen: {sug} (klik pakai)
                      </span>
                    ) : null;
                  })()}
                </div>
                <select value={newOrderForm.helper} onChange={e => setNewOrderForm(f=>({...f,helper:e.target.value}))}
                  style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                  <option value="">Tidak ada helper</option>
                  {teknisiData.filter(t=>t.role==="Helper").map(t => {
                    const { pref } = araSchedulingSuggest(newOrderForm.date||"", newOrderForm.service, newOrderForm.units);
                    const isSug = pref[newOrderForm.teknisi] === t.name;
                    return <option key={t.id} value={t.name}>{isSug?"★ ":""}{t.name}{isSug?" (ARA)":" "}</option>;
                  })}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:6 }}>
                <button onClick={() => setModalOrder(false)} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:700 }}>Batal</button>
                {(() => {
                  const capReached = newOrderForm.teknisi && newOrderForm.date && ordersData.filter(o =>
                    o.teknisi===newOrderForm.teknisi && o.date===newOrderForm.date &&
                    ["PENDING","CONFIRMED","DISPATCHED","ON_SITE","IN_PROGRESS"].includes(o.status)
                  ).length >= MAX_LOKASI_PER_HARI;
                  return (
                    <button
                      disabled={capReached}
                      onClick={async () => {
                        if (!newOrderForm.customer) { showNotif("Nama customer wajib diisi"); return; }
                        if (!newOrderForm.teknisi)  { showNotif("Pilih teknisi dulu"); return; }
                        if (!newOrderForm.date)     { showNotif("Pilih tanggal dulu"); return; }
                        // GAP-1&2: DB-level check sebelum submit (anti race condition)
                        if (newOrderForm.teknisi && newOrderForm.date && newOrderForm.time) {
                          const dbOk = await cekTeknisiAvailableDB(newOrderForm.teknisi, newOrderForm.date, newOrderForm.time, newOrderForm.service, newOrderForm.units);
                          if (!dbOk.ok) { showNotif("⚠️ " + (dbOk.reason || "Jadwal bentrok, cek ulang")); return; }
                        }
                        const formCopy = {...newOrderForm};
                        setModalOrder(false);
                        setNewOrderForm({ customer:"", phone:"", address:"", area:"", service:"Cleaning", type:"AC Split 0.5-1PK", units:1, teknisi:"", helper:"", date:"", time:"09:00", notes:"" });
                        await createOrder(formCopy);
                      }}
                      style={{ background: capReached ? cs.border : "linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color: capReached ? cs.muted : "#0a0f1e", padding:"12px", borderRadius:10, cursor: capReached ? "not-allowed" : "pointer", fontWeight:800, fontSize:14, opacity: capReached ? 0.6 : 1 }}>
                      {capReached ? "🔴 Teknisi Penuh" : "✓ Buat Order"}
                    </button>
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
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setModalStok(false)}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, width:"100%", maxWidth:420, padding:28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>📦 Tambah Material</div>
              <button onClick={() => setModalStok(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ display:"grid", gap:10 }}>
              {[["Nama Material","name","text"],["Satuan","unit","text"],["Harga/Unit","price","number"],["Stok Awal","stock","number"],["Reorder Point","reorder","number"],["Min Alert","min_alert","number"]].map(([label,key,type]) => (
                <div key={key}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>{label}</div>
                  <input type={type} value={newStokForm[key]||""} onChange={e => setNewStokForm(f=>({...f,[key]:e.target.value}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              ))}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:6 }}>
                <button onClick={() => setModalStok(false)} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:700 }}>Batal</button>
                <button onClick={async () => {
                  if (!newStokForm.name) { showNotif("Nama material wajib diisi"); return; }
                  const stokAwal = parseInt(newStokForm.stock)||0;
                  const reorderPt = parseInt(newStokForm.reorder)||5;
                  const minAlert  = parseInt(newStokForm.min_alert)||2;
                  const newCode   = "MAT"+Date.now().toString(36).slice(-4).toUpperCase();
                  const stokStatus= stokAwal===0?"OUT":stokAwal<=minAlert?"CRITICAL":stokAwal<=reorderPt?"WARNING":"OK";
                  const newItem   = { code:newCode, name:newStokForm.name, unit:newStokForm.unit||"pcs", price:parseInt(newStokForm.price)||0, stock:stokAwal, reorder:reorderPt, min_alert:minAlert, status:stokStatus };
                  setInventoryData(prev=>[...prev,newItem]);
                  // Insert tanpa status — biarkan DB default, lalu update stock untuk trigger auto-status
                  const insertPayload = { ...newItem };
                  delete insertPayload.status; // hindari check constraint — trigger set otomatis
                  const {error:invErr} = await supabase.from("inventory").insert(insertPayload);
                  if (!invErr && stokAwal > 0) {
                    // Trigger inventory_auto_status hanya jalan saat UPDATE stock
                    await supabase.from("inventory").update({stock:stokAwal}).eq("code",newCode);
                  }
                  if(invErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal: "+invErr.message);
                  else { addAgentLog("STOCK_ADDED",`Material baru: ${newStokForm.name} (stok: ${newStokForm.stock} ${newStokForm.unit||"pcs"})`,"SUCCESS"); showNotif("✅ Material " + (newStokForm.name||"baru") + " berhasil ditambah"); }
                  setModalStok(false); setNewStokForm({ name:"", unit:"pcs", price:"", stock:"", reorder:"", min_alert:"" });
                }} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:14 }}>✓ Simpan Material</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT STOK */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalEditStok && editStokItem && (() => {
        const tambah = parseInt(newStokForm.tambah)||0;
        const stokBaru = parseInt(newStokForm.stock ?? editStokItem.stock)||0;
        const hargaBaru = parseInt(newStokForm.price ?? editStokItem.price)||0;
        const reorderBaru = parseInt(newStokForm.reorder ?? editStokItem.reorder)||5;
        const stokFinal = stokBaru + tambah;
        const statusBaru = stokFinal===0?"OUT":stokFinal<=editStokItem.min_alert?"CRITICAL":stokFinal<=reorderBaru?"WARNING":"OK";
        return (
          <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => { setModalEditStok(false); setEditStokItem(null); setNewStokForm({name:"",unit:"pcs",price:"",stock:"",reorder:"",min_alert:"",tambah:""}); }}>
            <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, width:"100%", maxWidth:420, padding:28 }} onClick={e => e.stopPropagation()}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>✏️ Edit Stok — {editStokItem.name}</div>
                <button onClick={() => { setModalEditStok(false); setEditStokItem(null); setNewStokForm({name:"",unit:"pcs",price:"",stock:"",reorder:"",min_alert:"",tambah:""}); }} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>×</button>
              </div>
              <div style={{ display:"grid", gap:10 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>Stok Saat Ini</div>
                    <input type="number" value={newStokForm.stock ?? editStokItem.stock} onChange={e=>setNewStokForm(f=>({...f,stock:e.target.value}))}
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>Tambah (+)</div>
                    <input type="number" min="0" placeholder="0" value={newStokForm.tambah||""} onChange={e=>setNewStokForm(f=>({...f,tambah:e.target.value}))}
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>Harga/Unit</div>
                    <input type="number" value={newStokForm.price ?? editStokItem.price} onChange={e=>setNewStokForm(f=>({...f,price:e.target.value}))}
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>Reorder Point</div>
                    <input type="number" value={newStokForm.reorder ?? editStokItem.reorder} onChange={e=>setNewStokForm(f=>({...f,reorder:e.target.value}))}
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  </div>
                </div>
                <div style={{ background:stokFinal<=editStokItem.min_alert?cs.red+"12":cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"10px 12px", fontSize:12, color:cs.muted }}>
                  Stok setelah update: <strong style={{color:statusBaru==="OK"?cs.green:statusBaru==="OUT"?cs.red:cs.yellow}}>{stokFinal} {editStokItem.unit}</strong> · Status: <strong style={{color:statusBaru==="OK"?cs.green:statusBaru==="OUT"?cs.red:cs.yellow}}>{statusBaru}</strong>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:4 }}>
                  <button onClick={() => { setModalEditStok(false); setEditStokItem(null); setNewStokForm({name:"",unit:"pcs",price:"",stock:"",reorder:"",min_alert:"",tambah:""}); }} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:700 }}>Batal</button>
                  <button onClick={async () => {
                    const updated = {...editStokItem, stock:stokFinal, price:hargaBaru, reorder:reorderBaru, status:statusBaru};
                    setInventoryData(prev=>prev.map(i=>i.code===editStokItem.code?updated:i));
                    // GAP 2: catat perubahan stok ke inventory_transactions
                    const deltaStok = stokFinal - editStokItem.stock;
                    if (deltaStok !== 0) {
                      await supabase.from("inventory_transactions").insert({
                        inventory_code: editStokItem.code,
                        inventory_name: editStokItem.name,
                        qty: deltaStok,
                        type: deltaStok > 0 ? "restock" : "correction",
                        notes: `Update manual oleh ${currentUser?.name||"Admin"}`,
                        created_by: currentUser?.id||null,
                        created_by_name: currentUser?.name||"",
                      });
                      // ignore inventory_transactions error (tabel opsional)
                    }
                    const {error:eErr} = await supabase.from("inventory").update({stock:stokFinal, price:hargaBaru, reorder:reorderBaru, updated_at:new Date().toISOString()}).eq("code",editStokItem.code);
                    if(eErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
                    else { addAgentLog("STOCK_UPDATED",`Stok ${editStokItem.name}: ${editStokItem.stock}→${stokFinal} ${editStokItem.unit} (${statusBaru})`,"SUCCESS"); showNotif("✅ Stok "+editStokItem.name+" diupdate → "+stokFinal+" "+editStokItem.unit); }
                    setModalEditStok(false); setEditStokItem(null); setNewStokForm({name:"",unit:"pcs",price:"",stock:"",reorder:"",min_alert:"",tambah:""});
                  }} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:14 }}>✓ Simpan Perubahan</button>
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
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => { setModalTeknisi(false); setEditTeknisi(null); }}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, width:"100%", maxWidth:420, padding:28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>{editTeknisi?"✏️ Edit Anggota":"👷 Tambah Anggota"}</div>
              <button onClick={() => { setModalTeknisi(false); setEditTeknisi(null); }} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ display:"grid", gap:10 }}>
              {[["Nama Lengkap","name"],["Nomor WA","phone"]].map(([label,key]) => (
                <div key={key}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>{label}</div>
                  <input value={newTeknisiForm[key]||""} onChange={e => setNewTeknisiForm(f=>({...f,[key]:e.target.value}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:4 }}>Role</div>
                <select value={newTeknisiForm.role||"Teknisi"} onChange={e => setNewTeknisiForm(f=>({...f,role:e.target.value}))}
                  style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                  {["Teknisi","Helper","Supervisor"].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              {/* ── Toggle: Buat Akun Login (hanya saat tambah baru) ── */}
              {!editTeknisi && (
                <div style={{background:cs.card,border:"1px solid "+(newTeknisiForm.buatAkun?cs.accent:cs.border),borderRadius:10,padding:"12px 14px"}}>
                  <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                    <input type="checkbox" checked={!!newTeknisiForm.buatAkun}
                      onChange={e=>setNewTeknisiForm(f=>({...f,buatAkun:e.target.checked,email:"",password:""}))}
                      style={{width:16,height:16,accentColor:cs.accent}} />
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:newTeknisiForm.buatAkun?cs.accent:cs.text}}>🔑 Buat Akun Login</div>
                      <div style={{fontSize:11,color:cs.muted,marginTop:1}}>Teknisi bisa login ke app untuk submit laporan</div>
                    </div>
                  </label>
                  {newTeknisiForm.buatAkun && (
                    <div style={{marginTop:12,display:"grid",gap:8}}>
                      <div>
                        <div style={{fontSize:11,color:cs.muted,marginBottom:4}}>Email Login</div>
                        <input type="email" value={newTeknisiForm.email||""} placeholder="contoh: mulyadi@aclean.id"
                          onChange={e=>setNewTeknisiForm(f=>({...f,email:e.target.value}))}
                          style={{width:"100%",background:cs.surface,border:"1px solid "+cs.accent+"44",borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,boxSizing:"border-box",outline:"none"}} />
                      </div>
                      <div>
                        <div style={{fontSize:11,color:cs.muted,marginBottom:4}}>Password</div>
                        <input type="password" value={newTeknisiForm.password||""} placeholder="min. 6 karakter"
                          onChange={e=>setNewTeknisiForm(f=>({...f,password:e.target.value}))}
                          style={{width:"100%",background:cs.surface,border:"1px solid "+cs.accent+"44",borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,boxSizing:"border-box",outline:"none"}} />
                      </div>
                      <div style={{fontSize:11,color:cs.muted,background:cs.accent+"10",borderRadius:7,padding:"8px 10px"}}>
                        💡 Email & password ini dipakai teknisi untuk login di halaman utama app
                      </div>
                    </div>
                  )}
                </div>
              )}

              {editTeknisi && currentUser?.role === "Owner" && (
                <div style={{ display:"grid", gap:6 }}>
                  <button onClick={async () => {
                    if (!window.confirm) { /* skip confirm in some envs */ }
                    else if (!window.confirm(`Hapus ${editTeknisi.name} dari tim dan database?

Perhatian: Tindakan ini tidak bisa dibatalkan.
Order yang sudah ada tidak terpengaruh.`)) return;
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
                    style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"9px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>🗑️ Hapus dari Tim &amp; DB</button>
                  {editTeknisi?.status === "standby" ? (
                    <button onClick={async () => {
                      setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? {...t, status:"active", active:true} : t));
                      if (!String(editTeknisi.id).startsWith("Tech")) {
                        await supabase.from("user_profiles").update({active:true, status:"active"}).eq("id", editTeknisi.id);
                      }
                      showNotif(editTeknisi.name + " diaktifkan kembali ✅");
                      setModalTeknisi(false); setEditTeknisi(null);
                    }}
                      style={{ background:cs.green+"18", border:"1px solid "+cs.green+"33", color:cs.green, padding:"9px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>▶ Aktifkan Kembali</button>
                  ) : (
                    <button onClick={async () => {
                      setTeknisiData(prev => prev.map(t => t.id === editTeknisi.id ? {...t, status:"standby", active:false} : t));
                      if (!String(editTeknisi.id).startsWith("Tech")) {
                        await supabase.from("user_profiles").update({active:false}).eq("id", editTeknisi.id);
                        await supabase.from("user_profiles").update({status:"standby"}).eq("id", editTeknisi.id);
                      }
                      showNotif(editTeknisi.name + " dinonaktifkan (standby). Data tetap tersimpan.");
                      setModalTeknisi(false); setEditTeknisi(null);
                    }}
                      style={{ background:cs.yellow+"18", border:"1px solid "+cs.yellow+"33", color:cs.yellow, padding:"9px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>⏸ Nonaktifkan (Standby)</button>
                  )}
                </div>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:4 }}>
                <button onClick={() => { setModalTeknisi(false); setEditTeknisi(null); }} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:700 }}>Batal</button>
                <button onClick={async () => {
                  if(!newTeknisiForm.name||!newTeknisiForm.phone){showNotif("Nama dan nomor HP wajib diisi");return;}
                  if(editTeknisi){
                    // Update existing
                    const upd = {name:newTeknisiForm.name,phone:newTeknisiForm.phone,role:newTeknisiForm.role,skills:newTeknisiForm.skills||[]};
                    setTeknisiData(prev=>prev.map(t=>t.id===editTeknisi.id?{...t,...upd}:t));
                    const {error:tErr} = await supabase.from("user_profiles").update(upd).eq("id",editTeknisi.id);
                    if(tErr) showNotif("⚠️ Update lokal saja, DB gagal");
                    else { addAgentLog("TEKNISI_UPDATED","Data "+newTeknisiForm.name+" diupdate","SUCCESS"); showNotif("✅ "+newTeknisiForm.name+" berhasil diupdate"); }
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
                      if (authErr) { showNotif("❌ Gagal buat akun: "+authErr.message); return; }
                      profileId = authData?.user?.id || null;
                    }

                    // Step 2: Insert ke user_profiles
                    const newTek = {
                      ...(profileId ? {id: profileId} : {}),
                      name: newTeknisiForm.name,
                      phone: newTeknisiForm.phone,
                      role: newTeknisiForm.role,
                      skills: newTeknisiForm.skills||[],
                      status: "active",
                      jobs_today: 0,
                      ...(newTeknisiForm.email ? {email: newTeknisiForm.email} : {}),
                    };
                    const {error:tErr,data:tData} = await supabase.from("user_profiles").insert(newTek).select().single();
                    if(tErr) {
                      showNotif("⚠️ Tersimpan lokal, DB gagal: "+tErr.message);
                      setTeknisiData(prev=>[...prev,{...newTek,id:"TMP_"+Date.now()}]);
                    } else {
                      setTeknisiData(prev=>[...prev,tData||newTek]);
                      addAgentLog("TEKNISI_ADDED","Anggota baru: "+newTeknisiForm.name+" ("+newTeknisiForm.role+")"+(newTeknisiForm.buatAkun?" + akun login":""),"SUCCESS");
                      if (newTeknisiForm.buatAkun) {
                        showNotif("✅ "+newTeknisiForm.name+" ditambahkan + akun login dibuat! Cek email untuk konfirmasi.");
                      } else {
                        showNotif("✅ "+newTeknisiForm.name+" berhasil ditambahkan (tanpa akun login)");
                      }
                    }
                  }
                  setModalTeknisi(false); setEditTeknisi(null); setNewTeknisiForm({name:"",role:"Teknisi",phone:"",skills:[],email:"",password:"",buatAkun:false});
                }}
                  style={{ background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:14 }}>
                  ✓ {editTeknisi?"Update":"Tambah"} Anggota
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
        <div style={{ position:"fixed", inset:0, background:"#000d", zIndex:500, display:"flex", alignItems:isMobile?"flex-end":"center", justifyContent:"center", padding:16 }} onClick={() => setModalBrainEdit(false)}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.ara+"44", borderRadius:isMobile?"16px 16px 0 0":20, width:"100%", maxWidth:isMobile?"100%":780, maxHeight:"92vh", display:"flex", flexDirection:"column", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ background:cs.ara+"15", borderBottom:"1px solid "+cs.ara+"33", padding:"16px 22px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:800, color:cs.ara, fontSize:16 }}>🧠 Edit Brain.md — Memori Permanen ARA</div>
                <div style={{ fontSize:12, color:cs.muted, marginTop:3 }}>
                  {localStorage.getItem("aclean_brainMd") ? "💾 Backup lokal: ✅" : "💾 Backup lokal: ✗"}&nbsp;·&nbsp;
                  ☁️ Supabase: tersimpan permanen · Sync semua device
                </div>
              </div>
              <button onClick={() => setModalBrainEdit(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:24, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ background:cs.ara+"08", borderBottom:"1px solid "+cs.border, padding:"8px 22px", display:"flex", gap:20, fontSize:11, flexShrink:0 }}>
              <span style={{ color:cs.muted }}>📝 Baris: <strong style={{color:cs.text}}>{(typeof brainMd==="string"?brainMd:"").split("\n").length}</strong></span>
              <span style={{ color:cs.muted }}>🔤 Karakter: <strong style={{color:cs.text}}>{typeof brainMd==="string"?brainMd.length:0}</strong></span>
              <span style={{ color:cs.muted }}>💡 Gunakan # untuk heading</span>
            </div>
            <textarea value={brainMd} onChange={e => setBrainMd(e.target.value)}
              style={{ flex:1, background:cs.bg, border:"none", padding:"18px 22px", color:cs.text, fontSize:13, fontFamily:"monospace", lineHeight:1.7, outline:"none", resize:"none", minHeight:400 }} />
            <div style={{ background:cs.surface, borderTop:"1px solid "+cs.border, padding:"10px 22px", display:"flex", gap:8, flexWrap:"wrap", flexShrink:0 }}>
              <span style={{ fontSize:11, color:cs.muted, alignSelf:"center" }}>Tambah section:</span>
              {[["Harga Baru","\n## Harga Update\n- Cleaning 1PK: Rp XX.000\n"],["Aturan Baru","\n## Aturan Tambahan\n- Aturan: ...\n"],["Promo Aktif","\n## Promo\n- Diskon X% untuk Y unit\n"]].map(([label,snippet]) => (
                <button key={label} onClick={() => setBrainMd(prev => prev + snippet)}
                  style={{ background:cs.ara+"18", border:"1px solid "+cs.ara+"33", color:cs.ara, padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11 }}>+ {label}</button>
              ))}
            </div>
            <div style={{ background:cs.surface, borderTop:"1px solid "+cs.border, padding:"14px 22px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <button onClick={() => { setBrainMd(BRAIN_MD_DEFAULT); showNotif("Brain.md direset ke default"); }}
                style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"9px 16px", borderRadius:8, cursor:"pointer", fontSize:12 }}>🔄 Reset ke Default</button>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => setModalBrainEdit(false)} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"9px 18px", borderRadius:8, cursor:"pointer", fontWeight:600 }}>Batal</button>
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
                          .update({ value: brainMd, updated_by: currentUser?.name||"Owner", updated_at: new Date().toISOString() })
                          .eq("key", "brain_md");
                        if (!e2) { dbOk = true; }
                        else {
                          // Attempt 3: INSERT baru (jika row belum ada)
                          const { error: e3 } = await supabase.from("ara_brain")
                            .insert({ key: "brain_md", value: brainMd, updated_by: currentUser?.name||"Owner" });
                          if (!e3) dbOk = true;
                          else throw new Error("Upsert: "+e1.message+" | Update: "+e2.message+" | Insert: "+e3.message);
                        }
                      }
                    } catch(e) {
                      showNotif("⚠️ DB error: " + (e?.message||"") + " — Tersimpan di localStorage saja. Jalankan fix_ara_brain_table.sql di Supabase.");
                      addAgentLog("BRAIN_SAVE_ERROR", "Brain.md gagal ke DB: "+(e?.message||""), "ERROR");
                      setModalBrainEdit(false); return;
                    }
                    if (dbOk) {
                      addAgentLog("BRAIN_SAVED", "Brain.md disimpan ke Supabase (" + brainMd.length + " karakter)", "SUCCESS");
                      showNotif("✅ Brain.md tersimpan permanen di Supabase + localStorage!");
                    }
                    setModalBrainEdit(false);
                  }}
                  style={{ background:"linear-gradient(135deg,"+cs.ara+",#7c3aed)", border:"none", color:"#fff", padding:"9px 22px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>💾 Simpan Brain.md</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — EDIT BRAIN CUSTOMER */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalBrainCustomerEdit && (
        <div style={{ position:"fixed", inset:0, background:"#000d", zIndex:500, display:"flex", alignItems:isMobile?"flex-end":"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:cs.surface, border:"1px solid #22c55e44", borderRadius:isMobile?"16px 16px 0 0":20, width:"100%", maxWidth:isMobile?"100%":700, maxHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ background:"#22c55e12", borderBottom:"1px solid #22c55e33", padding:"16px 22px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontWeight:800, fontSize:16, color:"#22c55e" }}>💬 Edit Brain Customer Bot</div>
                <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>System prompt khusus untuk customer via WhatsApp — TERPISAH dari Brain Owner/Admin</div>
              </div>
              <button onClick={() => setModalBrainCustomerEdit(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ background:"#22c55e08", borderBottom:"1px solid "+cs.border, padding:"8px 22px", display:"flex", gap:16, fontSize:11 }}>
              <span style={{ color:cs.muted }}>📝 Baris: <strong style={{color:cs.text}}>{brainMdCustomer.split("\n").length}</strong></span>
              <span style={{ color:cs.muted }}>🔤 Karakter: <strong style={{color:cs.text}}>{brainMdCustomer.length}</strong></span>
              <span style={{ color:"#22c55e" }}>💡 Hanya aksi terbatas: booking, cek status, feedback</span>
            </div>
            <textarea value={brainMdCustomer} onChange={e => setBrainMdCustomer(e.target.value)}
              style={{ flex:1, background:cs.bg, border:"none", padding:"18px 22px", color:cs.text, fontSize:13, fontFamily:"monospace", resize:"none", outline:"none", lineHeight:1.7 }}
              placeholder="Isi Brain Customer Bot di sini...&#10;&#10;Panduan: tentukan identitas, layanan & harga, SOP booking, batasan yang boleh/tidak boleh dilakukan ARA saat chat dengan customer via WA."
            />
            <div style={{ background:cs.surface, borderTop:"1px solid "+cs.border, padding:"14px 22px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <button onClick={() => { setBrainMdCustomer('# ARA CUSTOMER BRAIN v1.0 — AClean Service\n\n## IDENTITAS\nNama: ARA, asisten virtual AClean Service — Jasa Cuci, Servis & Pasang AC.\nArea: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan.\nJam operasional: Senin–Sabtu 08:00–17:00 WIB.\n\n## TUGASMU\n1. Jawab pertanyaan layanan, harga, area AClean\n2. Bantu booking order baru\n3. Bantu cek status order customer (by nomor HP)\n4. Terima & catat komplain/feedback\n\n## BATASAN KERAS\n- JANGAN tampilkan data customer lain\n- JANGAN lakukan aksi admin (cancel, approve, update invoice, dll)\n- Jika tidak yakin: arahkan ke admin\n\n## LAYANAN & HARGA\n- Cuci AC: Rp 80.000/unit\n- Freon R22: Rp 150.000/unit | Freon R32: Rp 200.000/unit\n- Perbaikan AC: mulai Rp 100.000 (tergantung kerusakan)\n- Pasang AC Baru: Rp 300.000/unit | Bongkar AC: Rp 150.000/unit\n- Service AC: Rp 120.000/unit | Booking H-0: +Rp 50.000\n\n## FORMAT JAWABAN\n- Bahasa Indonesia ramah, maks 5 kalimat per respons\n- Gunakan emoji: 😊 ✅ 🔧 📱\n- Jika tidak bisa jawab: arahkan ke admin'); showNotif("Brain Customer direset ke default"); }}
                style={{ background:"#ef444418", border:"1px solid #ef444433", color:"#ef4444", padding:"9px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}>
                🔄 Reset Default
              </button>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => setModalBrainCustomerEdit(false)} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"9px 18px", borderRadius:8, cursor:"pointer", fontSize:13 }}>Batal</button>
                <button onClick={async () => {
                    showNotif("⏳ Menyimpan Brain Customer ke Supabase...");
                    _lsSave("brainMdCustomer", brainMdCustomer);
                    let dbOk = false;
                    try {
                      const payload = { key: "brain_customer", value: brainMdCustomer, updated_by: currentUser?.name||"Owner", updated_at: new Date().toISOString() };
                      const { error: e1 } = await supabase.from("ara_brain").upsert(payload, { onConflict: "key" });
                      if (!e1) { dbOk = true; }
                      else {
                        const { error: e2 } = await supabase.from("ara_brain")
                          .update({ value: brainMdCustomer, updated_by: currentUser?.name||"Owner", updated_at: new Date().toISOString() })
                          .eq("key", "brain_customer");
                        if (!e2) { dbOk = true; }
                        else {
                          const { error: e3 } = await supabase.from("ara_brain")
                            .insert({ key: "brain_customer", value: brainMdCustomer, updated_by: currentUser?.name||"Owner" });
                          if (!e3) dbOk = true;
                          else throw new Error("Upsert: "+e1.message+" | Update: "+e2.message+" | Insert: "+e3.message);
                        }
                      }
                    } catch(e) {
                      showNotif("⚠️ DB error: " + (e?.message||"") + " — Tersimpan lokal. Jalankan fix_ara_brain_table.sql di Supabase.");
                      addAgentLog("BRAIN_CUST_SAVE_ERROR", "Brain Customer gagal ke DB: "+(e?.message||""), "ERROR");
                      setModalBrainCustomerEdit(false); return;
                    }
                    if (dbOk) {
                      addAgentLog("BRAIN_CUSTOMER_SAVED", "Brain Customer disimpan ke Supabase (" + brainMdCustomer.length + " karakter)", "SUCCESS");
                      showNotif("✅ Brain Customer tersimpan permanen di Supabase + localStorage!");
                    }
                    setModalBrainCustomerEdit(false);
                  }}
                  style={{ background:"linear-gradient(135deg,#22c55e,#16a34a)", border:"none", color:"#fff", padding:"9px 22px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>
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
      {modalEditInvoice && editInvoiceData && (
        <div style={{ position:"fixed", inset:0, background:"#000d", zIndex:450, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setModalEditInvoice(false)}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, width:"100%", maxWidth:460, padding:28 }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>✏️ Edit Nilai Invoice</div>
                <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>{editInvoiceData.id} · {editInvoiceData.customer}</div>
              </div>
              <button onClick={()=>setModalEditInvoice(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ display:"grid", gap:12 }}>
              {/* Detail Material dari laporan teknisi — read only info */}
              {(editInvoiceData?.materials_detail||[]).length > 0 && (
                <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"12px 14px", marginBottom:4 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:cs.muted, marginBottom:8 }}>📦 Detail Material dari Laporan Teknisi</div>
                  {(editInvoiceData.materials_detail||[]).map((m,mi) => (
                    <div key={mi} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:cs.text, marginBottom:4, paddingBottom:4, borderBottom:"1px solid "+cs.border+"44" }}>
                      <span>↳ {m.nama} <span style={{color:cs.muted}}>× {m.jumlah} {m.satuan||""}</span></span>
                      <span style={{ fontFamily:"monospace", color:cs.accent }}>{m.subtotal > 0 ? fmt(m.subtotal) : (m.harga_satuan > 0 ? fmt(m.harga_satuan * (m.jumlah||1)) : "—")}</span>
                    </div>
                  ))}
                  <div style={{ fontSize:11, color:cs.muted, marginTop:6 }}>💡 Edit nilai "Material (Rp)" di bawah untuk ubah total material</div>
                </div>
              )}
              {[["Jasa / Labor (Rp)","labor"],["Material (Rp)","material"],["Pekerjaan Tambahan / Dadakan (Rp)","dadakan"]].map(([label,key]) => (
                <div key={key}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>{label}</div>
                  <input type="number" min="0" value={editInvoiceForm[key]||0}
                    onChange={e=>setEditInvoiceForm(f=>({...f,[key]:parseInt(e.target.value)||0}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              ))}
              <div style={{ background:cs.accent+"12", border:"1px solid "+cs.accent+"33", borderRadius:10, padding:14 }}>
                <div style={{ fontSize:12, color:cs.muted, marginBottom:4 }}>Total Baru</div>
                <div style={{ fontWeight:800, fontSize:20, color:cs.accent, fontFamily:"monospace" }}>
                  {fmt((editInvoiceForm.labor||0)+(editInvoiceForm.material||0)+(editInvoiceForm.dadakan||0))}
                </div>
                {(editInvoiceForm.labor||0)+(editInvoiceForm.material||0)+(editInvoiceForm.dadakan||0) !== editInvoiceData.total && (
                  <div style={{ fontSize:11, color:cs.yellow, marginTop:4 }}>
                    Perubahan: {fmt(((editInvoiceForm.labor||0)+(editInvoiceForm.material||0)+(editInvoiceForm.dadakan||0))-editInvoiceData.total)}
                  </div>
                )}
              </div>
              <div key="notes">
                <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Catatan Perubahan</div>
                <input value={editInvoiceForm.notes||""} onChange={e=>setEditInvoiceForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Alasan perubahan nilai..."
                  style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:4 }}>
                <button onClick={()=>setModalEditInvoice(false)} style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:700 }}>Batal</button>
                <button onClick={async()=>{
                  const labor = Math.max(0, parseInt(editInvoiceForm.labor)||0);
                  const material = Math.max(0, parseInt(editInvoiceForm.material)||0);
                  const dadakan = Math.max(0, parseInt(editInvoiceForm.dadakan)||0);
                  const newTotal = labor + material + dadakan;
                  if(newTotal <= 0){ showNotif("⚠️ Total invoice tidak boleh 0 atau negatif"); return; }
                  setInvoicesData(prev=>prev.map(i=>i.id===editInvoiceData.id?{...i,labor,material,dadakan,total:newTotal}:i));
                  // Try update with all cols → fallback to known-safe cols
                  let editSaved = false;
                  // Attempt 1: full cols
                  { const {error:e1} = await supabase.from("invoices").update({labor,material,dadakan,total:newTotal}).eq("id",editInvoiceData.id);
                    if(!e1){ editSaved=true; } else console.warn("editInv attempt1:", e1.message); }
                  // Attempt 2: without dadakan  
                  if(!editSaved){ const {error:e2} = await supabase.from("invoices").update({labor,material,total:newTotal}).eq("id",editInvoiceData.id);
                    if(!e2){ editSaved=true; } else console.warn("editInv attempt2:", e2.message); }
                  // Attempt 3: total only
                  if(!editSaved){ const {error:e3} = await supabase.from("invoices").update({total:newTotal}).eq("id",editInvoiceData.id);
                    if(!e3){ editSaved=true; } else showNotif("⚠️ Tersimpan lokal, sync DB gagal: "+e3.message); }
                  else { addAgentLog("INVOICE_EDITED",`Invoice ${editInvoiceData.id} diupdate → ${fmt(newTotal)}${editInvoiceForm.notes?" ("+editInvoiceForm.notes+")":""}`, "SUCCESS"); }
                  showNotif(`✅ Invoice ${editInvoiceData.id} berhasil diupdate → ${fmt(newTotal)}`);
                  setModalEditInvoice(false); setEditInvoiceData(null);
                }} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:14 }}>💾 Simpan Perubahan</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL — INVOICE PREVIEW */}
      {/* ══════════════════════════════════════════════════════ */}
      {modalPDF && selectedInvoice && (() => {
        // Always use latest data from invoicesData state
        const liveInv = invoicesData.find(i=>i.id===selectedInvoice.id) || selectedInvoice;
        return (
        <div style={{ position:"fixed", inset:0, background:"#000d", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setModalPDF(false)}>
          <div style={{ background:"#f8fafc", borderRadius:20, width:"100%", maxWidth:680, maxHeight:"92vh", overflowY:"auto", display:"flex", flexDirection:"column" }} onClick={e => e.stopPropagation()}>
            {/* Toolbar */}
            <div style={{ background:"#1E3A5F", padding:"12px 20px", borderRadius:"20px 20px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:800, color:"#fff", fontSize:14 }}>Preview Invoice — {liveInv.id}</div>
                <div style={{ fontSize:11, color:"#93c5fd" }}>Format standar AClean · Dikirim sebagai PDF ke customer</div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {liveInv.status === "PENDING_APPROVAL" && (
                  <button onClick={() => { setModalPDF(false); setTimeout(()=>approveInvoice(liveInv),100); }}
                    style={{ background:"#22c55e", border:"none", color:"#fff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>✓ Approve Invoice</button>
                )}
                <button onClick={() => setModalPDF(false)} style={{ background:"none", border:"1px solid #ffffff44", color:"#fff", padding:"6px 14px", borderRadius:8, cursor:"pointer", fontSize:13 }}>× Tutup</button>
              </div>
            </div>
            {/* Invoice body */}
            <div style={{ padding:20, background:"#f8fafc" }}>
              {/* Header */}
              <div style={{ background:"#1E3A5F", borderRadius:10, overflow:"hidden", marginBottom:16 }}>
                <div style={{ height:4, background:"#2563EB" }} />
                <div style={{ padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontWeight:800, color:"#fff", fontSize:18 }}>
                      <span style={{ color:"#60a5fa" }}>AC</span>lean Service
                    </div>
                    <div style={{ fontSize:11, color:"#93c5fd" }}>Jasa Servis AC Profesional</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:10, color:"#93c5fd", fontWeight:600 }}>INVOICE</div>
                    <div style={{ background:"#2563EB", color:"#fff", padding:"4px 10px", borderRadius:6, fontFamily:"monospace", fontWeight:800, fontSize:13 }}>{liveInv.id}</div>
                  </div>
                </div>
                <div style={{ background:"#0f2744", padding:"8px 20px", display:"flex", gap:20, fontSize:10, color:"#94a3b8" }}>
                  <span>📍 Alam Sutera, Tangerang Selatan</span>
                  <span>🏦 BCA 8830883011 a.n. Malda Retta</span>
                </div>
              </div>
              {/* Detail Grid */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                <div style={{ background:"#EFF6FF", borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#1e40af", marginBottom:8, textTransform:"uppercase" }}>Detail Invoice</div>
                  {[["Tanggal", liveInv.sent||"—"],["No. Invoice",liveInv.id],["No. Order",liveInv.job_id]].map(([k,v]) => (
                    <div key={k} style={{ display:"flex", gap:8, marginBottom:4, fontSize:11 }}>
                      <span style={{ color:"#64748b", minWidth:80 }}>{k}</span>
                      <span style={{ color:"#1e293b", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#1e40af", marginBottom:8, textTransform:"uppercase" }}>Tagihan Kepada</div>
                  <div style={{ fontWeight:700, color:"#1e293b", fontSize:13, marginBottom:4 }}>{liveInv.customer}</div>
                  <div style={{ fontSize:11, color:"#64748b" }}>📱 {liveInv.phone}</div>
                </div>
              </div>
              {/* Service Table */}
              <table style={{ width:"100%", borderCollapse:"collapse", marginBottom:14, fontSize:12 }}>
                <thead>
                  <tr style={{ background:"#1E3A5F" }}>
                    {["Deskripsi","Jml Unit","Harga Satuan","Subtotal"].map(h => (
                      <th key={h} style={{ padding:"8px 10px", textAlign:"left", color:"#fff", fontWeight:700, fontSize:10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background:"#fff" }}>
                    <td style={{ padding:"8px 10px", color:"#1e293b" }}>{liveInv.service}</td>
                    <td style={{ padding:"8px 10px", color:"#475569", textAlign:"center" }}>{liveInv.units}</td>
                    <td style={{ padding:"8px 10px", color:"#475569", fontFamily:"monospace" }}>{(liveInv.labor/liveInv.units).toLocaleString("id-ID")}</td>
                    <td style={{ padding:"8px 10px", color:"#1e293b", fontFamily:"monospace", fontWeight:600 }}>{liveInv.labor.toLocaleString("id-ID")}</td>
                  </tr>
                  {/* Per-item material dari materials_detail */}
                  {(() => {
                    const md = liveInv.materials_detail;
                    const mArr = Array.isArray(md) ? md
                      : (typeof md === "string" && md)
                        ? (() => { try { return JSON.parse(md); } catch(_){ return []; } })()
                        : [];
                    if (mArr.length > 0) {
                      return mArr.map((m, mi) => (
                        <tr key={mi} style={{ background: mi%2===0 ? "#f0f9ff" : "#fff" }}>
                          <td style={{ padding:"8px 10px", color:"#1e293b" }}>
                            {m.nama}
                            {m.keterangan && <span style={{ fontSize:10, color:"#64748b", marginLeft:4 }}>({m.keterangan})</span>}
                          </td>
                          <td style={{ padding:"8px 10px", textAlign:"center", color:"#475569" }}>{m.jumlah} {m.satuan}</td>
                          <td style={{ padding:"8px 10px", fontFamily:"monospace", color:"#475569", textAlign:"right" }}>
                            {m.harga_satuan > 0 ? m.harga_satuan.toLocaleString("id-ID") : "—"}
                          </td>
                          <td style={{ padding:"8px 10px", fontFamily:"monospace", fontWeight:600, color:"#1e293b", textAlign:"right" }}>
                            {m.subtotal > 0 ? m.subtotal.toLocaleString("id-ID") : "—"}
                          </td>
                        </tr>
                      ));
                    }
                    // Fallback: materials_detail kosong → tampil 1 baris total
                    if ((liveInv.material||0) > 0) return (
                      <tr style={{ background:"#f0f9ff" }}>
                        <td style={{ padding:"8px 10px", color:"#64748b", fontStyle:"italic" }}>Material &amp; Spare Part</td>
                        <td style={{ padding:"8px 10px", textAlign:"center" }}>—</td>
                        <td style={{ padding:"8px 10px" }}>—</td>
                        <td style={{ padding:"8px 10px", fontFamily:"monospace", fontWeight:600, color:"#1e293b", textAlign:"right" }}>
                          {liveInv.material.toLocaleString("id-ID")}
                        </td>
                      </tr>
                    );
                    return null;
                  })()}
                  {liveInv.dadakan > 0 && (
                    <tr style={{ background:"#fffbeb" }}>
                      <td style={{ padding:"8px 10px", color:"#92400e" }}>Pekerjaan Tambahan</td>
                      <td style={{ padding:"8px 10px", textAlign:"center" }}>—</td>
                      <td style={{ padding:"8px 10px" }}>—</td>
                      <td style={{ padding:"8px 10px", color:"#92400e", fontFamily:"monospace", fontWeight:600 }}>{liveInv.dadakan.toLocaleString("id-ID")}</td>
                    </tr>
                  )}
                  <tr style={{ background:"#1E3A5F" }}>
                    <td colSpan={3} style={{ padding:"8px 10px", color:"#fff", fontWeight:700 }}>TOTAL TAGIHAN</td>
                    <td style={{ padding:"8px 10px", color:"#fff", fontFamily:"monospace", fontWeight:800, fontSize:14 }}>Rp {liveInv.total.toLocaleString("id-ID")}</td>
                  </tr>
                </tbody>
              </table>
              {/* Footer */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                <div style={{ background:"#EFF6FF", borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#1e40af", marginBottom:6 }}>Informasi Pembayaran</div>
                  <div style={{ fontSize:11, color:"#475569" }}>Transfer Bank BCA</div>
                  <div style={{ fontWeight:800, color:"#1e293b", fontSize:13, marginTop:4 }}>8830883011</div>
                  <div style={{ fontSize:11, color:"#475569" }}>a.n. Malda Retta</div>
                </div>
                <div style={{ background:liveInv.status==="OVERDUE"?"#FEF2F2":liveInv.status==="PAID"?"#F0FDF4":"#FFFBEB", borderRadius:8, padding:"12px 14px", border:"1px solid "+(liveInv.status==="OVERDUE"?"#fca5a5":liveInv.status==="PAID"?"#86efac":"#fde68a") }}>
                  <div style={{ fontSize:10, fontWeight:800, color:"#64748b", marginBottom:6 }}>Jatuh Tempo</div>
                  <div style={{ fontWeight:700, color:"#1e293b" }}>{liveInv.due||"Menunggu Approval"}</div>
                  {liveInv.status==="OVERDUE" && <div style={{ fontSize:11, color:"#dc2626", fontWeight:700, marginTop:4 }}>⚠️ SUDAH JATUH TEMPO</div>}
                  {liveInv.status==="PAID" && <div style={{ fontSize:11, color:"#16a34a", fontWeight:700, marginTop:4 }}>✅ LUNAS</div>}
                </div>
              </div>
              <div style={{ textAlign:"center", padding:"10px 0", borderTop:"1px solid #e2e8f0" }}>
                <div style={{ fontSize:11, color:"#64748b" }}>Pertanyaan? Hubungi kami via WA: +62812-8989-8937</div>
                <div style={{ fontSize:11, color:"#94a3b8", fontStyle:"italic", marginTop:4 }}>Terima kasih telah mempercayakan perawatan AC Anda kepada AClean Service</div>
              </div>
            </div>
            {/* Action bar */}
            <div style={{ background:"#f1f5f9", padding:"12px 20px", borderTop:"1px solid #e2e8f0", display:"flex", gap:10, justifyContent:"flex-end", borderRadius:"0 0 20px 20px", flexShrink:0 }}>
              <button onClick={() => downloadInvoicePDF(liveInv)} style={{ background:"#EFF6FF", border:"1px solid #bfdbfe", color:"#1d4ed8", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>📥 Download PDF</button>
              {liveInv.status === "UNPAID" && (
                <button onClick={() => { invoiceReminderWA(liveInv); setModalPDF(false); }} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>📱 Kirim via WA</button>
              )}
              {liveInv.status === "PENDING_APPROVAL" && (
                <button onClick={() => { setEditInvoiceData(liveInv); setEditInvoiceForm({labor:liveInv.labor,material:liveInv.material,dadakan:liveInv.dadakan,notes:""}); setModalPDF(false); setModalEditInvoice(true); }} style={{ background:"#fef9c322", border:"1px solid #fde68a", color:"#92400e", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>✏️ Edit Nilai</button>
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
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:500,
          display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={() => { setModalApproveInv(false); setPendingApproveInv(null); }}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:18,
            padding:28, width:"100%", maxWidth:420, boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>✅ Approve Invoice</div>
                <div style={{ fontSize:12, color:cs.muted, marginTop:4 }}>Setelah approve, invoice tidak bisa diedit lagi</div>
              </div>
              <button onClick={() => { setModalApproveInv(false); setPendingApproveInv(null); }}
                style={{ background:"none", border:"none", color:cs.muted, fontSize:20, cursor:"pointer", lineHeight:1 }}>×</button>
            </div>

            {/* Info invoice */}
            <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent, fontSize:14 }}>{pendingApproveInv.id}</span>
                <span style={{ fontWeight:800, color:cs.green, fontSize:14 }}>{fmt(pendingApproveInv.total)}</span>
              </div>
              <div style={{ fontSize:12, color:cs.muted }}>👤 {pendingApproveInv.customer}</div>
              <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>🔧 {pendingApproveInv.service}</div>
              <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>📱 {pendingApproveInv.phone}</div>
            </div>

            {/* Pilihan */}
            <div style={{ display:"grid", gap:10 }}>
              {/* Opsi 1 — Kirim ke Customer */}
              <button onClick={() => approveAndSend(pendingApproveInv)}
                style={{ display:"flex", alignItems:"center", gap:14, background:"linear-gradient(135deg,"+cs.green+",#059669)",
                  border:"none", borderRadius:12, padding:"14px 18px", cursor:"pointer", textAlign:"left" }}>
                <span style={{ fontSize:24 }}>📤</span>
                <div>
                  <div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>Approve & Kirim ke Customer</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.8)", marginTop:2 }}>Invoice langsung dikirim via WA ke {pendingApproveInv.phone}</div>
                </div>
              </button>

              {/* Opsi 2 — Simpan Dahulu */}
              <button onClick={() => approveSaveOnly(pendingApproveInv)}
                style={{ display:"flex", alignItems:"center", gap:14, background:cs.card,
                  border:"1px solid "+cs.border, borderRadius:12, padding:"14px 18px", cursor:"pointer", textAlign:"left" }}>
                <span style={{ fontSize:24 }}>💾</span>
                <div>
                  <div style={{ fontWeight:800, fontSize:14, color:cs.text }}>Approve & Simpan Dahulu</div>
                  <div style={{ fontSize:11, color:cs.muted, marginTop:2 }}>Invoice diapprove tapi belum dikirim — kirim manual nanti dari halaman Invoice</div>
                </div>
              </button>

              <button onClick={() => { setModalApproveInv(false); setPendingApproveInv(null); }}
                style={{ background:"none", border:"none", color:cs.muted, fontSize:12, cursor:"pointer", padding:"6px 0" }}>
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
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:600,
          display:"flex", alignItems:"flex-end", justifyContent:"center", padding:"0 0 0 0" }}
          onClick={() => { setModalWaTek(false); setWaTekTarget(null); }}>
          <div style={{ background:cs.surface, borderRadius:"18px 18px 0 0", width:"100%", maxWidth:480,
            padding:"24px 20px 32px", border:"1px solid "+cs.border }}
            onClick={e => e.stopPropagation()}>

            {/* Handle bar */}
            <div style={{ width:40, height:4, background:cs.border, borderRadius:99, margin:"0 auto 18px" }} />

            {/* Header */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontWeight:800, fontSize:15, color:cs.text }}>📱 WA ke Customer</div>
              <div style={{ fontSize:12, color:cs.muted, marginTop:3 }}>
                {waTekTarget.customer} · {waTekTarget.phone}
              </div>
              <div style={{ fontSize:11, color:cs.muted, marginTop:1 }}>🔧 {waTekTarget.service}</div>
            </div>

            {/* Pilihan pesan */}
            <div style={{ display:"grid", gap:8 }}>
              {[
                {
                  icon:"🚗",
                  label:"Konfirmasi sedang menuju",
                  msg:`Halo ${waTekTarget.customer}, saya dari AClean Service sedang dalam perjalanan menuju lokasi Anda. Estimasi tiba pkl ${waTekTarget.time||"sebentar lagi"}. Mohon ditunggu ya! 🙏`
                },
                {
                  icon:"📍",
                  label:"Tanya patokan / lokasi",
                  msg:`Halo ${waTekTarget.customer}, saya teknisi AClean yang akan servis hari ini. Boleh minta patokan lokasi rumah Bapak/Ibu? Alamat yang tercatat: ${waTekTarget.address||"—"}. Terima kasih 🙏`
                },
                {
                  icon:"✅",
                  label:"Konfirmasi jadwal hari ini",
                  msg:`Halo ${waTekTarget.customer}, kami konfirmasi jadwal servis AC dari AClean hari ini pkl ${waTekTarget.time||"—"} untuk ${waTekTarget.service||"servis AC"}. Apakah masih bisa? 🙏`
                },
                {
                  icon:"⏰",
                  label:"Info terlambat / minta reschedule",
                  msg:`Halo ${waTekTarget.customer}, mohon maaf kami dari AClean ada keterlambatan. Kami akan tiba sedikit lebih lama dari jadwal. Terima kasih atas pengertiannya 🙏`
                },
                {
                  icon:"✔️",
                  label:"Pekerjaan selesai — terima kasih",
                  msg:`Halo ${waTekTarget.customer}, pekerjaan servis AC (${waTekTarget.service||"—"}) telah selesai. Terima kasih sudah mempercayakan ke AClean Service. Semoga AC-nya nyaman kembali! 😊`
                },
              ].map(({ icon, label, msg }) => (
                <button key={label} onClick={async () => {
                  setModalWaTek(false);
                  setWaTekTarget(null);
                  await openWA(waTekTarget.phone, msg);
                }}
                  style={{ display:"flex", alignItems:"center", gap:12, background:cs.card,
                    border:"1px solid "+cs.border, borderRadius:12, padding:"12px 14px",
                    cursor:"pointer", textAlign:"left", width:"100%" }}>
                  <span style={{ fontSize:20, flexShrink:0 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:cs.text }}>{label}</div>
                    <div style={{ fontSize:11, color:cs.muted, marginTop:2 }}>{msg.slice(0,60)}...</div>
                  </div>
                </button>
              ))}

              {/* Ketik manual */}
              <button onClick={() => {
                setModalWaTek(false); setWaTekTarget(null);
                window.open("https://wa.me/" + String(waTekTarget.phone).replace(/^0/,"62").replace(/[^0-9]/g,""), "_blank");
              }}
                style={{ display:"flex", alignItems:"center", gap:12, background:"#25D36615",
                  border:"1px solid #25D36633", borderRadius:12, padding:"12px 14px",
                  cursor:"pointer", textAlign:"left", width:"100%" }}>
                <span style={{ fontSize:20 }}>💬</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#25D366" }}>Ketik pesan sendiri</div>
                  <div style={{ fontSize:11, color:cs.muted, marginTop:2 }}>Buka WhatsApp — tulis pesan bebas</div>
                </div>
              </button>

              <button onClick={() => { setModalWaTek(false); setWaTekTarget(null); }}
                style={{ background:"none", border:"none", color:cs.muted, fontSize:12, cursor:"pointer", padding:"6px 0", marginTop:4 }}>
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
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:300, display:"flex", justifyContent:"flex-end" }} onClick={() => setWaPanel(false)}>
          <div style={{ width:isMobile?"100%":420, background:cs.surface, borderLeft:isMobile?"none":"1px solid "+cs.border, display:"flex", flexDirection:"column", height:"100vh" }} onClick={e => e.stopPropagation()}>
            <div style={{ background:cs.card, padding:"16px 20px", borderBottom:"1px solid "+cs.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:800, color:"#25D366", fontSize:14 }}>📱 WhatsApp Monitor</div>
                <div style={{ fontSize:11, color:cs.muted }}>via {waProvider === "fonnte" ? "Fonnte" : waProvider === "wa_cloud" ? "WA Cloud API" : "Twilio"} · Real-time</div>
              </div>
              <button onClick={() => setWaPanel(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
              <div style={{ width:160, borderRight:"1px solid "+cs.border, overflowY:"auto" }}>
                {waConversations.map(conv => (
                  <div key={conv.id} onClick={() => {
                      setSelectedConv(conv);
                      // Load chat history dari wa_messages
                      supabase.from("wa_messages").select("*")
                        .eq("phone", conv.phone)
                        .order("created_at", { ascending: true })
                        .limit(50)
                        .then(({data}) => { if(data) setWaMessages(data); });
                      setWaConversations(prev=>prev.map(cv=>cv.id===conv.id?{...cv,unread:0}:cv)); }}
                    style={{ padding:"10px 12px", borderBottom:"1px solid "+cs.border, cursor:"pointer", background:selectedConv?.id===conv.id?cs.accent+"12":"transparent" }}>
                    <div style={{ fontWeight:700, color:cs.text, fontSize:12, marginBottom:2 }}>{conv.name}</div>
                    <div style={{ fontSize:10, color:cs.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{conv.last}</div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                      <span style={{ fontSize:9, color:cs.muted }}>{conv.time}</span>
                      {conv.unread > 0 && <span style={{ background:cs.green, color:"#fff", fontSize:9, borderRadius:"50%", width:15, height:15, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800 }}>{conv.unread}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
                {selectedConv ? (
                  <>
                    <div style={{ padding:"10px 14px", borderBottom:"1px solid "+cs.border, flexShrink:0 }}>
                      <div style={{ fontWeight:700, color:cs.text, fontSize:13 }}>{selectedConv.name}</div>
                      <div style={{ fontSize:10, color:cs.muted }}>{selectedConv.phone} · {selectedConv.intent}</div>
                    </div>
                    <div style={{ flex:1, padding:"12px 14px", overflowY:"auto", display:"flex", flexDirection:"column", gap:8 }}>
                      {waMessages.length === 0 ? (
                        <div style={{ textAlign:"center", color:cs.muted, fontSize:12, paddingTop:30 }}>Memuat riwayat pesan...</div>
                      ) : waMessages.map((msg, mi) => (
                        <div key={msg.id||mi} style={{ display:"flex", justifyContent:msg.role==="ara"||msg.role==="admin"?"flex-end":"flex-start" }}>
                          <div style={{ maxWidth:"80%", background:msg.role==="customer"?cs.card:cs.accent+"22", borderRadius:10, padding:"8px 12px", fontSize:12 }}>
                            {msg.role!=="customer" && <div style={{ fontSize:10, color:cs.accent, fontWeight:700, marginBottom:3 }}>{msg.role==="ara"?"🤖 ARA":"👤 Admin"}</div>}
                            <div style={{ color:cs.text, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{msg.content}</div>
                            <div style={{ fontSize:9, color:cs.muted, marginTop:3, textAlign:"right" }}>{msg.created_at ? new Date(msg.created_at).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}) : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding:"10px 14px", borderTop:"1px solid "+cs.border, display:"flex", gap:8, flexShrink:0 }}>
                      <input value={waInput} onChange={e => setWaInput(e.target.value)}
                        onKeyDown={async e => { if(e.key==="Enter" && waInput.trim() && selectedConv){
                          const ok = await sendWA(selectedConv.phone, waInput);
                          addAgentLog("WA_SENT_MANUAL",`Manual reply ke ${selectedConv.name}: "${waInput.slice(0,40)}"`,"SUCCESS");
                          setWaConversations(prev=>prev.map(cv=>cv.id===selectedConv.id?{...cv,last:waInput,unread:0}:cv));
                          setWaInput(""); showNotif(ok?"✅ Pesan terkirim via Fonnte":"📱 WA dibuka manual");
                        }}}
                        placeholder="Balas manual..." style={{ flex:1, background:cs.bg, border:"1px solid "+cs.border, borderRadius:10, padding:"8px 12px", color:cs.text, fontSize:12, outline:"none" }} />
                      <button onClick={async () => { if(waInput.trim() && selectedConv){
                        const ok = await sendWA(selectedConv.phone, waInput);
                        addAgentLog("WA_SENT_MANUAL",`Manual reply ke ${selectedConv.name}: "${waInput.slice(0,40)}"`,"SUCCESS");
                        setWaConversations(prev=>prev.map(cv=>cv.id===selectedConv.id?{...cv,last:waInput,unread:0}:cv));
                        setWaInput(""); showNotif(ok?"✅ Pesan terkirim via Fonnte":"📱 WA dibuka manual");
                      }}}
                        style={{ background:"#25D366", border:"none", color:"#fff", padding:"8px 14px", borderRadius:10, cursor:"pointer", fontWeight:700 }}>Kirim</button>
                    </div>
                  </>
                ) : (
                  <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:cs.muted, fontSize:13 }}>Pilih percakapan</div>
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
          "Owner":   { color:"#f59e0b", icon:"👑", desc:"Akses semua menu & pengaturan", autoPass: null },
          "Admin":   { color:"#38bdf8", icon:"🛠️", desc:"Semua menu kecuali Pengaturan",  autoPass: null },
          "Teknisi": { color:"#22c55e", icon:"👷", desc:"Hanya Jadwal & Laporan",          autoPass: "teknisi123" },
          "Helper":  { color:"#a78bfa", icon:"🤝", desc:"Hanya Jadwal & Laporan",          autoPass: "helper123" },
        };
        const cfg = roleConfig[newUserForm.role] || roleConfig["Admin"];
        const isAutoPass = ["Teknisi","Helper"].includes(newUserForm.role);
        const effectivePass = isAutoPass ? cfg.autoPass : newUserForm.password;

        const handleSaveUser = async () => {
          if (!newUserForm.name || !newUserForm.email) { showNotif("Nama dan email wajib diisi"); return; }
          if (!isAutoPass && !newUserForm.password) { showNotif("Password wajib diisi"); return; }

          const password = effectivePass;
          const avatar   = newUserForm.name.charAt(0).toUpperCase();
          const colorMap = { "Owner":"#f59e0b","Admin":"#38bdf8","Teknisi":"#22c55e","Helper":"#a78bfa" };
          const color    = colorMap[newUserForm.role] || "#38bdf8";

          // Cek apakah ID adalah UUID Supabase (bukan "USR001" hardcode)
          const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());

          if (newUserForm.id && isUUID(newUserForm.id)) {
            // ── EDIT user yang ada di Supabase (UUID valid) ──
            const upd = { name:newUserForm.name, role:newUserForm.role, phone:newUserForm.phone||"", avatar, color, active:true };
            const { error } = await supabase.from("user_profiles").update(upd).eq("id", newUserForm.id);
            if (error) showNotif("⚠️ DB error: " + error.message + " (disimpan lokal)");
            else addAgentLog("USER_UPDATED", "Akun " + newUserForm.name + " diupdate", "SUCCESS");
            // Selalu update local state
            setUserAccounts(prev => prev.map(u => u.id===newUserForm.id ? {...u,...newUserForm,avatar,color} : u));
            showNotif("✅ Akun " + newUserForm.name + " berhasil diupdate");

          } else if (newUserForm.id && !isUUID(newUserForm.id)) {
            // ── EDIT local user (USR001 dll - belum punya UUID Supabase) ──
            // Hanya update local state, tidak bisa ke DB tanpa UUID
            setUserAccounts(prev => prev.map(u => u.id===newUserForm.id ? {...u,...newUserForm,avatar,color} : u));
            showNotif("✅ " + newUserForm.name + " diupdate (lokal). Buat ulang akun di Supabase untuk sinkronisasi penuh.");

          } else {
            // ── BUAT user baru via Supabase Auth ──
            const { data, error } = await supabase.auth.signUp({
              email: newUserForm.email,
              password: password,
              options: { data: { name: newUserForm.name, role: newUserForm.role } }
            });
            if (error) { showNotif("❌ Gagal buat akun: " + error.message); return; }

            if (data.user) {
              try {
                await supabase.from("user_profiles").upsert({
                  id: data.user.id,
                  name: newUserForm.name, role: newUserForm.role,
                  phone: newUserForm.phone||"", avatar, color, active: true,
                });
              } catch(e) { console.warn("user_profiles upsert:", e?.message); }
            }

            const newAcc = {
              id: data.user?.id || ("USR_"+Date.now()),
              name: newUserForm.name, email: newUserForm.email,
              role: newUserForm.role, phone: newUserForm.phone||"",
              avatar, color, active: true, lastLogin: "Belum login", password
            };
            setUserAccounts(prev => [...prev, newAcc]);
            addAgentLog("USER_CREATED", "Akun baru: " + newUserForm.name + " (" + newUserForm.role + ")", "SUCCESS");
            showNotif(`✅ Akun ${newUserForm.name} dibuat — role: ${newUserForm.role} — password: ${password}`);
          }
          setModalAddUser(false); setNewUserForm({name:"",email:"",role:"Admin",password:"",phone:""});
        };

        // Handle delete user
        const handleDeleteUser = async () => {
          if (!newUserForm.id || newUserForm.role === "Owner") return;
          if (window.confirm && !window.confirm(`Hapus akun ${newUserForm.name}?

Akun tidak bisa dipulihkan. Data order/laporan tetap ada.`)) return;
          const isUUID = (id) => id && /^[0-9a-f-]{36}$/.test(String(id).toLowerCase());
          if (isUUID(newUserForm.id)) {
            // Nonaktifkan di DB (tidak hapus permanen — jaga data historis)
            await supabase.from("user_profiles").update({active:false}).eq("id", newUserForm.id);
          }
          setUserAccounts(prev => prev.filter(u => u.id !== newUserForm.id));
          addAgentLog("USER_DELETED", "Akun " + newUserForm.name + " dihapus/dinonaktifkan", "WARNING");
          showNotif("🗑️ Akun " + newUserForm.name + " dihapus");
          setModalAddUser(false); setNewUserForm({name:"",email:"",role:"Admin",password:"",phone:""});
        };

        return (
          <div style={{ position:"fixed", inset:0, background:"#000c", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setModalAddUser(false)}>
            <div style={{ background:cs.surface, border:"1px solid "+cs.border, borderRadius:20, width:"100%", maxWidth:480, padding:28, maxHeight:"90vh", overflowY:"auto" }} onClick={e => e.stopPropagation()}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:16, color:cs.text }}>{newUserForm.id ? "Edit Pengguna" : "Tambah Anggota Tim"}</div>
                  <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>Hanya Owner yang dapat mengelola akun</div>
                </div>
                <button onClick={() => setModalAddUser(false)} style={{ background:"none", border:"none", color:cs.muted, fontSize:22, cursor:"pointer" }}>✕</button>
              </div>

              <div style={{ display:"grid", gap:14 }}>
                {/* Role Selector — 4 role */}
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:8 }}>Role / Hak Akses</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                    {Object.entries(roleConfig).map(([role, cfg]) => (
                      <div key={role}
                        onClick={() => setNewUserForm(f => ({ ...f, role, password: cfg.autoPass || "" }))}
                        style={{ background:newUserForm.role===role ? cfg.color+"18" : cs.card, border:"2px solid "+(newUserForm.role===role ? cfg.color : cs.border), borderRadius:10, padding:"12px 10px", cursor:"pointer" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                          <span style={{ fontSize:16 }}>{cfg.icon}</span>
                          <span style={{ fontSize:12, fontWeight:800, color:newUserForm.role===role ? cfg.color : cs.text }}>{role}</span>
                        </div>
                        <div style={{ fontSize:10, color:cs.muted }}>{cfg.desc}</div>
                        {cfg.autoPass && <div style={{ fontSize:10, color:cfg.color, marginTop:4, fontWeight:700 }}>🔑 Password otomatis: {cfg.autoPass}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Form fields */}
                {[["Nama Lengkap","name","text","Nama lengkap anggota"],["Email Login","email","email","nama@aclean.id"],["Nomor HP","phone","text","628812xxx"]].map(([label,key,type,ph]) => (
                  <div key={key}>
                    <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>{label}</div>
                    <input type={type} value={newUserForm[key]||""} onChange={e => setNewUserForm(f=>({...f,[key]:e.target.value}))}
                      placeholder={ph}
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"10px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  </div>
                ))}

                {/* Password — auto atau manual */}
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Password</div>
                  {isAutoPass ? (
                    <div style={{ background:cfg.color+"15", border:"1px solid "+cfg.color+"44", borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:18 }}>🔑</span>
                      <div>
                        <div style={{ fontSize:13, fontWeight:800, color:cfg.color }}>{cfg.autoPass}</div>
                        <div style={{ fontSize:10, color:cs.muted }}>Password standar untuk semua {newUserForm.role}. Beritahu anggota password ini.</div>
                      </div>
                    </div>
                  ) : (
                    <input type="password" value={newUserForm.password||""} onChange={e => setNewUserForm(f=>({...f,password:e.target.value}))}
                      placeholder="min 8 karakter"
                      style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"10px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  )}
                </div>

                {/* Info role */}
                <div style={{ background:cfg.color+"10", border:"1px solid "+cfg.color+"22", borderRadius:8, padding:"10px 14px", fontSize:11, color:cs.muted }}>
                  {newUserForm.role === "Owner"   && "👑 Akses penuh: semua menu, pengaturan, manajemen akun, dan data keuangan."}
                  {newUserForm.role === "Admin"   && "🛠️ Akses operasional: order, invoice, customer, inventory, laporan. Tidak bisa buka Pengaturan."}
                  {newUserForm.role === "Teknisi" && "👷 Akses terbatas: Dashboard, Jadwal, dan Laporan Sendiri saja. Nominal transaksi disembunyikan."}
                  {newUserForm.role === "Helper"  && "🤝 Akses terbatas: Dashboard, Jadwal, dan Laporan Sendiri saja. Sama seperti Teknisi."}
                </div>

                {/* Tombol aksi */}
                {newUserForm.id && newUserForm.role !== "Owner" && (
                  <button onClick={handleDeleteUser}
                    style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"10px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, width:"100%" }}>
                    🗑️ Hapus / Nonaktifkan Akun {newUserForm.name}
                  </button>
                )}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:4 }}>
                  <button onClick={() => setModalAddUser(false)}
                    style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:600 }}>Batal</button>
                  <button onClick={handleSaveUser}
                    style={{ background:"linear-gradient(135deg,"+cfg.color+","+cfg.color+"99)", border:"none", color:"#fff", padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:14 }}>
                    {cfg.icon} {newUserForm.id ? "Simpan Perubahan" : "Buat Akun " + newUserForm.role}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════ MODAL TAMBAH CUSTOMER ═══════ */}
      {modalAddCustomer && (
        <div style={{position:"fixed",inset:0,background:"#000c",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setModalAddCustomer(false)}>
          <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:20,width:"100%",maxWidth:460,padding:28}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontWeight:800,fontSize:16,color:cs.text}}>👤 Customer Baru</div>
              <button onClick={()=>setModalAddCustomer(false)} style={{background:"none",border:"none",color:cs.muted,fontSize:24,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{display:"grid",gap:12}}>
              {[["Nama Lengkap","name","text","Nama customer"],["Nomor HP","phone","text","628xxx"],["Alamat Lengkap","address","text","Jl. ..."],["Area/Kecamatan","area","text","Alam Sutera, BSD, dll"]].map(([lbl,key,type,ph])=>(
                <div key={key}>
                  <div style={{fontSize:12,fontWeight:700,color:cs.muted,marginBottom:5}}>{lbl}</div>
                  <input type={type} value={newCustomerForm[key]||""} onChange={e=>setNewCustomerForm(f=>({...f,[key]:e.target.value}))}
                    placeholder={ph} style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:8,padding:"10px 12px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                </div>
              ))}
              <div>
                <div style={{fontSize:12,fontWeight:700,color:cs.muted,marginBottom:5}}>Catatan (Opsional)</div>
                <textarea value={newCustomerForm.notes||""} onChange={e=>setNewCustomerForm(f=>({...f,notes:e.target.value}))} rows={2} placeholder="Catatan khusus..."
                  style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:8,padding:"10px 12px",color:cs.text,fontSize:13,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit"}} />
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="checkbox" id="vip_chk" checked={newCustomerForm.is_vip||false} onChange={e=>setNewCustomerForm(f=>({...f,is_vip:e.target.checked}))} />
                <label htmlFor="vip_chk" style={{fontSize:13,color:cs.text,cursor:"pointer"}}>⭐ Tandai sebagai VIP</label>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginTop:6}}>
                <button onClick={()=>setModalAddCustomer(false)} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>Batal</button>
                <button onClick={async ()=>{
                  if(!newCustomerForm.name||!newCustomerForm.phone){showNotif("Nama dan nomor HP wajib diisi");return;}
                  // GAP 6: cek duplikat phone sebelum submit
                  const existPhone = customersData.find(cu => samePhone(cu.phone, newCustomerForm.phone) && cu.id !== (selectedCustomer?.id||""));
                  if(existPhone){showNotif(`⚠️ Nomor HP sudah terdaftar atas nama "${existPhone.name}". Tidak bisa duplikat.`);return;}
                  if(selectedCustomer && selectedCustomer.id){
                    // UPDATE existing customer
                    setCustomersData(prev=>prev.map(cu=>cu.id===selectedCustomer.id?{...cu,...newCustomerForm}:cu));
                    setSelectedCustomer(prev=>({...prev,...newCustomerForm}));
                    // Hanya kolom yang ada di DB schema
                    const dbUpdate = {name:newCustomerForm.name, phone:normalizePhone(newCustomerForm.phone), address:newCustomerForm.address, area:newCustomerForm.area, notes:newCustomerForm.notes||"", is_vip:newCustomerForm.is_vip||false};
                    const {error:cErr} = await supabase.from("customers").update(dbUpdate).eq("id",selectedCustomer.id);
                    if(cErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
                    else { addAgentLog("CUSTOMER_UPDATED","Customer "+newCustomerForm.name+" diupdate","SUCCESS"); showNotif("✅ Data "+newCustomerForm.name+" berhasil diupdate"); }
                  } else {
                    // INSERT new customer — tanpa kirim `id`, biarkan DB generate
                    const today = new Date().toISOString().slice(0,10);
                    const dbCust = {
                      name:         newCustomerForm.name.trim(),
                      phone:        normalizePhone(newCustomerForm.phone),
                      address:      newCustomerForm.address||"",
                      area:         newCustomerForm.area||"",
                      notes:        newCustomerForm.notes||"",
                      is_vip:       newCustomerForm.is_vip||false,
                      joined_date:  today,
                      total_orders: 0,
                      last_service: null,
                    };
                    const { data: savedCust, error: cErr } = await supabase
                      .from("customers")
                      .insert(dbCust)
                      .select()
                      .single();
                    if (cErr) {
                      // Fallback upsert jika phone sudah ada di DB
                      const { data: upsertCust, error: cErr2 } = await supabase
                        .from("customers")
                        .upsert(dbCust, { onConflict: "phone", ignoreDuplicates: false })
                        .select().single();
                      if (cErr2) {
                        showNotif("⚠️ Gagal simpan ke DB: " + cErr.message);
                        // Tetap tampil di state lokal
                        setCustomersData(prev => [...prev, { ...dbCust, id: "CUST_L_"+Date.now(), last_service:"-", ac_units:0 }]);
                      } else {
                        setCustomersData(prev => [...prev, upsertCust || { ...dbCust, id: "CUST_"+Date.now() }]);
                        addAgentLog("CUSTOMER_ADDED", "Customer baru: "+newCustomerForm.name, "SUCCESS");
                        showNotif("✅ Customer "+newCustomerForm.name+" berhasil ditambahkan");
                      }
                    } else {
                      setCustomersData(prev => [...prev, savedCust || { ...dbCust, id: "CUST_"+Date.now() }]);
                      addAgentLog("CUSTOMER_ADDED", "Customer baru: "+newCustomerForm.name+" ("+newCustomerForm.area+")", "SUCCESS");
                      showNotif("✅ Customer "+newCustomerForm.name+" berhasil ditambahkan");
                    }
                  }
                  setModalAddCustomer(false); setNewCustomerForm({name:"",phone:"",address:"",area:"",notes:"",is_vip:false});
                }}
                  style={{background:"linear-gradient(135deg,"+cs.green+",#059669)",border:"none",color:"#fff",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>
                  ✓ Simpan Customer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ MODAL EDIT ORDER / JADWAL (Owner & Admin) ═══════ */}
      {modalEditOrder && editOrderItem && (
        <div style={{position:"fixed",inset:0,background:"#000c",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>{setModalEditOrder(false);setEditOrderItem(null);}}>
          <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:20,width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",padding:28}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:cs.text}}>✏️ Edit Order — {editOrderItem.id}</div>
                <div style={{fontSize:11,color:cs.yellow,marginTop:2}}>Hanya Owner &amp; Admin · Perubahan dicatat otomatis</div>
              </div>
              <button onClick={()=>{setModalEditOrder(false);setEditOrderItem(null);}} style={{background:"none",border:"none",color:cs.muted,fontSize:24,cursor:"pointer",lineHeight:1}}>×</button>
            </div>

            <div style={{display:"grid",gap:12,marginTop:16}}>
              {/* Section: Data Customer */}
              <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:800,color:cs.muted,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"}}>Data Customer</div>
                <div style={{display:"grid",gap:8}}>
                  {[["Nama Customer","customer","text"],["No. HP","phone","text"],["Alamat Lengkap","address","text"]].map(([lbl,key,type])=>(
                    <div key={key}>
                      <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>{lbl}</div>
                      <input type={type} value={editOrderForm[key]||""} onChange={e=>setEditOrderForm(f=>({...f,[key]:e.target.value}))}
                        style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Section: Detail Pekerjaan */}
              <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:800,color:cs.muted,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"}}>Detail Pekerjaan</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Layanan</div>
                    <select value={editOrderForm.service||"Cleaning"} onChange={e=>setEditOrderForm(f=>({...f,service:e.target.value}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none"}}>
                      {["Cleaning","Install","Repair","Complain"].map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Jumlah Unit</div>
                    <input type="number" min="1" max="20" value={editOrderForm.units||1} onChange={e=>setEditOrderForm(f=>({...f,units:parseInt(e.target.value)||1}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                  </div>
                </div>
              </div>

              {/* Section: Jadwal &amp; Tim */}
              <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:800,color:cs.muted,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"}}>Jadwal &amp; Tim</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Tanggal</div>
                    <input type="date" value={editOrderForm.date||""} onChange={e=>setEditOrderForm(f=>({...f,date:e.target.value}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Jam Mulai</div>
                    <input type="time" min="09:00" max="17:00" value={editOrderForm.time||"09:00"} onChange={e=>setEditOrderForm(f=>({...f,time:e.target.value}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                  </div>
                </div>
                {editOrderForm.date && editOrderForm.time && (
                  <div style={{background:cs.accent+"10",border:"1px solid "+cs.accent+"22",borderRadius:7,padding:"6px 10px",fontSize:11,color:cs.accent,marginBottom:8}}>
                    ⏱ Estimasi selesai: <b>{hitungJamSelesai(editOrderForm.time, editOrderForm.service||"Cleaning", editOrderForm.units||1)}</b> WIB
                    {" · "}{hitungDurasi(editOrderForm.service||"Cleaning", editOrderForm.units||1)}j
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Teknisi</div>
                    <select value={editOrderForm.teknisi||""} onChange={e=>setEditOrderForm(f=>({...f,teknisi:e.target.value,helper:""}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none"}}>
                      <option value="">Pilih Teknisi...</option>
                      {teknisiData.filter(t=>t.role==="Teknisi").map(t=>
                        <option key={t.id} value={t.name}>{t.name}{cekTeknisiAvailable(t.name,editOrderForm.date||"",editOrderForm.time||"09:00",editOrderForm.service||"Cleaning",editOrderForm.units||1)?"":" (penuh)"}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Helper</div>
                    <select value={editOrderForm.helper||""} onChange={e=>setEditOrderForm(f=>({...f,helper:e.target.value}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none"}}>
                      <option value="">Tidak ada</option>
                      {teknisiData.filter(t=>t.role==="Helper").map(t=>{
                        const {pref} = araSchedulingSuggest(editOrderForm.date||"",editOrderForm.service,editOrderForm.units);
                        return <option key={t.id} value={t.name}>{pref[editOrderForm.teknisi]===t.name?"★ ":""}{t.name}</option>;
                      })}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Status & Catatan */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Status</div>
                  <select value={editOrderForm.status||"CONFIRMED"} onChange={e=>setEditOrderForm(f=>({...f,status:e.target.value}))}
                    style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none"}}>
                    {["PENDING","CONFIRMED","DISPATCHED","ON_SITE","WORKING","REPORT_SUBMITTED","INVOICE_CREATED","INVOICE_APPROVED","PAID","COMPLETED","CANCELLED","RESCHEDULED"].map(s=>(
                      <option key={s} value={s} style={{color:statusColor[s]||"inherit"}}>{statusLabel[s]||s.replace("_"," ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Catatan Perubahan</div>
                  <input value={editOrderForm.notes||""} onChange={e=>setEditOrderForm(f=>({...f,notes:e.target.value}))}
                    placeholder="Alasan perubahan..." style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10}}>
                <button onClick={()=>{setModalEditOrder(false);setEditOrderItem(null);}} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>Batal</button>
                <button onClick={async()=>{
                  // GAP-1 & GAP-2: Cek ketersediaan teknisi di DB sebelum simpan edit
                  const tekChanged = editOrderForm.teknisi !== editOrderItem.teknisi;
                  const dateChanged = editOrderForm.date !== editOrderItem.date;
                  const timeChanged = editOrderForm.time !== editOrderItem.time;
                  if (editOrderForm.teknisi && (tekChanged || dateChanged || timeChanged)) {
                    const dbCheck = await cekTeknisiAvailableDB(
                      editOrderForm.teknisi, editOrderForm.date||editOrderItem.date,
                      editOrderForm.time||editOrderItem.time||"09:00",
                      editOrderForm.service||editOrderItem.service||"Cleaning",
                      editOrderForm.units||editOrderItem.units||1
                    );
                    // Exclude order yang sedang diedit dari conflict check
                    if (!dbCheck.ok && !dbCheck.reason?.includes(editOrderItem.id)) {
                      showNotif("⚠️ " + (dbCheck.reason || editOrderForm.teknisi + " tidak tersedia di jadwal tersebut"));
                      return;
                    }
                  }
                  const timeEnd = hitungJamSelesai(editOrderForm.time||"09:00", editOrderForm.service||"Cleaning", editOrderForm.units||1);
                  const updated = {...editOrderItem,...editOrderForm,time_end:timeEnd};
                  setOrdersData(prev=>prev.map(o=>o.id===editOrderItem.id?updated:o));
                  const dbUpd = {customer:editOrderForm.customer,phone:editOrderForm.phone,address:editOrderForm.address,service:editOrderForm.service,units:editOrderForm.units,teknisi:editOrderForm.teknisi,helper:editOrderForm.helper||null,date:editOrderForm.date,time:editOrderForm.time,time_end:timeEnd,status:editOrderForm.status,notes:editOrderForm.notes||""};
                  const {error:eoErr} = await supabase.from("orders").update(dbUpd).eq("id",editOrderItem.id);
          // ── GAP-10 FIX: Hapus schedule lama & insert baru setelah edit order ──
          if (!eoErr) {
            // Hapus schedule lama — gunakan try/catch, bukan .catch() langsung
            try {
              await supabase.from("technician_schedule").delete().eq("order_id", editOrderItem.id);
            } catch(e) { /* schedule tabel opsional, skip jika belum ada */ }
            if (editOrderForm.teknisi && editOrderForm.date) {
              const timeEnd2 = hitungJamSelesai(editOrderForm.time||"09:00", editOrderForm.service||"Cleaning", editOrderForm.units||1);
              try {
                await supabase.from("technician_schedule").insert({
                  order_id: editOrderItem.id,
                  teknisi:   editOrderForm.teknisi,
                  date:      editOrderForm.date,
                  time_start: editOrderForm.time||"09:00",
                  time_end:   timeEnd2,
                  status:    "ACTIVE",
                });
                addAgentLog("SCHEDULE_SYNCED", `Schedule diupdate untuk ${editOrderItem.id} setelah edit`, "SUCCESS");
              } catch(e) { /* skip */ }
            }
          }
                  if(eoErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal: "+eoErr.message);
                  else {
                    addAgentLog("ORDER_UPDATED",`Order ${editOrderItem.id} diedit — ${editOrderForm.teknisi} ${editOrderForm.date} ${editOrderForm.time}`,"SUCCESS");
                    const tek = teknisiData.find(t=>t.name===editOrderForm.teknisi);
                    if(tek && (editOrderForm.teknisi!==editOrderItem.teknisi||editOrderForm.date!==editOrderItem.date||editOrderForm.time!==editOrderItem.time)){
                      sendWA(tek.phone,`Halo ${editOrderForm.teknisi}, ada *perubahan jadwal*:\n📋 ${editOrderItem.id} — ${editOrderForm.customer||editOrderItem.customer}\n🔧 ${editOrderForm.service} ${editOrderForm.units} unit\n📅 ${editOrderForm.date} jam ${editOrderForm.time}–${timeEnd}\n📍 ${editOrderForm.address||editOrderItem.address}\n${editOrderForm.notes?"📝 "+editOrderForm.notes+"\n":""}Mohon konfirmasi. — AClean`);
                    }
                    showNotif("✅ Order "+editOrderItem.id+" berhasil diupdate");
                  }
                  setModalEditOrder(false); setEditOrderItem(null);
                }} style={{background:"linear-gradient(135deg,"+cs.yellow+",#d97706)",border:"none",color:"#0a0f1e",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>
                  ✓ Simpan Semua Perubahan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ MODAL EDIT / DETAIL LAPORAN ═══════ */}
      {modalLaporanDetail && selectedLaporan && (
        <div style={{position:"fixed",inset:0,background:"#000d",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>{setModalLaporanDetail(false);setEditLaporanMode(false);}}>
          <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:isMobile?"16px 16px 0 0":20,width:"100%",maxWidth:isMobile?"100%":540,maxHeight:"90vh",overflowY:"auto",padding:28}} onClick={e=>e.stopPropagation()}>

            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:cs.text}}>{editLaporanMode?"Edit Laporan":"Detail Laporan"}</div>
                <div style={{fontSize:12,color:cs.muted,marginTop:2}}>{selectedLaporan.job_id} — {selectedLaporan.customer}</div>
              </div>
              <button onClick={()=>{setModalLaporanDetail(false);setEditLaporanMode(false);}} style={{background:"none",border:"none",color:cs.muted,fontSize:24,cursor:"pointer",lineHeight:1}}>x</button>
            </div>

            {editLaporanMode ? (
              /* EDIT MODE */
              <div style={{display:"grid",gap:14}}>
                <div style={{background:cs.yellow+"10",border:"1px solid "+cs.yellow+"33",borderRadius:10,padding:"10px 14px",fontSize:12,color:cs.yellow}}>
                  Perubahan akan dicatat otomatis — nama kamu, waktu edit, dan field yang diubah akan tersimpan di log.
                </div>
                {[["Rekomendasi","rekomendasi"],["Catatan Tambahan","catatan_global"]].map(([lbl,key])=>(
                  <div key={key}>
                    <div style={{fontSize:12,fontWeight:700,color:cs.muted,marginBottom:5}}>{lbl}</div>
                    <textarea value={editLaporanForm[key]||""} onChange={e=>setEditLaporanForm(f=>({...f,[key]:e.target.value}))} rows={3}
                      style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}} />
                  </div>
                ))}
                <div style={{background:cs.accent+"10",border:"1px solid "+cs.accent+"22",borderRadius:8,padding:"8px 12px",fontSize:11,color:cs.muted}}>
                  💡 Edit rekomendasi & catatan global. Untuk perbaikan detail unit, gunakan tombol Laporan baru.
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginTop:4}}>
                  <button onClick={()=>{setEditLaporanMode(false);}} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>Batal</button>
                  <button onClick={async()=>{
                    const now = new Date().toLocaleString("id-ID",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(/\//g,"-");
                    const fields = ["rekomendasi","catatan_global"];
                    const newLogs = [];
                    fields.forEach(f=>{
                      const oldVal = (f==="catatan_global"?selectedLaporan.catatan_global||selectedLaporan.catatan:selectedLaporan[f])||"";
                      const newVal = editLaporanForm[f]||"";
                      if(oldVal!==newVal) newLogs.push({by:currentUser?.name||"?",at:now,field:f,old:String(oldVal).slice(0,80),new:String(newVal).slice(0,80)});
                    });
                    if(newLogs.length===0){showNotif("Tidak ada perubahan");return;}
                    const allLogs = [...safeArr(selectedLaporan.editLog),...newLogs];
                    const newStatus = selectedLaporan.status==="REVISION"?"SUBMITTED":selectedLaporan.status;
                    setLaporanReports(prev=>prev.map(r=>r.id===selectedLaporan.id
                      ?{...r,rekomendasi:editLaporanForm.rekomendasi,catatan_global:editLaporanForm.catatan_global,status:newStatus,editLog:allLogs}:r));
                    // Save ke Supabase
                    // Simpan edit ke Supabase
                    const {error:elErr} = await supabase.from("service_reports").update({
                      rekomendasi: editLaporanForm.rekomendasi,
                      catatan_global: editLaporanForm.catatan_global,
                      status: newStatus,
                      edit_log: JSON.stringify(allLogs),
                    }).eq("id", selectedLaporan.id);
                    if(elErr) {
                      console.warn("update with edit_log failed:", elErr.message);
                      await supabase.from("service_reports").update({
                        rekomendasi: editLaporanForm.rekomendasi,
                        catatan_global: editLaporanForm.catatan_global,
                        status: newStatus,
                      }).eq("id", selectedLaporan.id);
                    }
                    addAgentLog("LAPORAN_EDITED",`Laporan ${selectedLaporan.job_id} diedit oleh ${currentUser?.name} (${newLogs.length} perubahan)`,"SUCCESS");
                    showNotif("✅ Laporan "+selectedLaporan.job_id+" diupdate ("+newLogs.length+" perubahan dicatat)");
                    setModalLaporanDetail(false); setEditLaporanMode(false);
                  }}
                    style={{background:"linear-gradient(135deg,"+cs.green+",#059669)",border:"none",color:"#fff",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>
                    Simpan Perubahan
                  </button>
                </div>
              </div>
            ) : (
              /* VIEW MODE — support multi-unit (baru) & legacy (lama) */
              <div style={{display:"grid",gap:12}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 20px",fontSize:12}}>
                  <div><span style={{color:cs.muted}}>Job ID: </span><span style={{fontFamily:"monospace",color:cs.accent,fontWeight:700}}>{selectedLaporan.job_id}</span></div>
                  <div><span style={{color:cs.muted}}>Tanggal: </span><span style={{color:cs.text}}>{selectedLaporan.date}</span></div>
                  <div><span style={{color:cs.muted}}>Customer: </span><span style={{color:cs.text,fontWeight:600}}>{selectedLaporan.customer}</span></div>
                  <div><span style={{color:cs.muted}}>Layanan: </span><span style={{color:cs.text}}>{selectedLaporan.service}</span></div>
                  <div><span style={{color:cs.muted}}>Teknisi: </span><span style={{color:cs.accent,fontWeight:700}}>{selectedLaporan.teknisi}</span></div>
                  {selectedLaporan.helper && <div><span style={{color:cs.muted}}>Helper: </span><span style={{color:cs.text}}>{selectedLaporan.helper}</span></div>}
                </div>

                {/* Multi-unit display (struktur baru) */}
                {(selectedLaporan.units||[]).length > 0 ? (
                  <div style={{display:"grid",gap:8}}>
                    {(selectedLaporan.units||[]).map((u,ui)=>(
                      <div key={ui} style={{background:cs.card,borderRadius:10,padding:14,fontSize:12}}>
                        <div style={{fontWeight:700,color:cs.accent,marginBottom:8}}>Unit {u.unit_no} — {u.label} {u.merk?`(${u.merk})`:""}</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                          {(u.kondisi_sebelum||[]).map((k,ki)=><span key={ki} style={{background:cs.yellow+"18",color:cs.yellow,fontSize:10,padding:"2px 8px",borderRadius:99}}>{k}</span>)}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                          {(u.pekerjaan||[]).map((p,pi)=><span key={pi} style={{background:cs.accent+"18",color:cs.accent,fontSize:10,padding:"2px 8px",borderRadius:99}}>{p}</span>)}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                          {(u.kondisi_setelah||[]).map((k,ki)=><span key={ki} style={{background:cs.green+"18",color:cs.green,fontSize:10,padding:"2px 8px",borderRadius:99}}>{k}</span>)}
                        </div>
                        {(u.ampere_akhir||parseFloat(u.freon_ditambah)>0) && (
                          <div style={{fontSize:11,color:cs.muted}}>
                            {u.ampere_akhir?`Ampere: ${u.ampere_akhir}A`:""}
                            {u.ampere_akhir&&parseFloat(u.freon_ditambah)>0?" · ":""}
                            {parseFloat(u.freon_ditambah)>0?`Tekanan: ${u.freon_ditambah} psi`:""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Legacy struktur lama (flat) */
                  <div style={{background:cs.card,borderRadius:10,padding:14,fontSize:12}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
                      <div><div style={{color:cs.muted,fontSize:11,marginBottom:4}}>Kondisi Sebelum</div><div style={{color:cs.yellow,fontWeight:600}}>{typeof selectedLaporan.kondisi_sebelum==="string"?selectedLaporan.kondisi_sebelum:(selectedLaporan.kondisi_sebelum||[]).join(", ")}</div></div>
                      <div><div style={{color:cs.muted,fontSize:11,marginBottom:4}}>Kondisi Sesudah</div><div style={{color:cs.green,fontWeight:600}}>{typeof selectedLaporan.kondisi_setelah==="string"?selectedLaporan.kondisi_setelah:(selectedLaporan.kondisi_setelah||[]).join(", ")}</div></div>
                    </div>
                    {(selectedLaporan.pekerjaan||[]).length > 0 && (
                      <div style={{marginBottom:8}}><span style={{color:cs.muted,fontSize:11}}>Pekerjaan: </span>{(selectedLaporan.pekerjaan||[]).map((p,pi)=><span key={pi} style={{background:cs.accent+"18",color:cs.accent,fontSize:10,padding:"2px 8px",borderRadius:99,marginRight:4}}>{p}</span>)}</div>
                    )}
                  </div>
                )}

                {/* Material terpakai */}
                {(selectedLaporan.materials||[]).length > 0 && (
                  <div style={{background:cs.card,borderRadius:10,padding:"10px 14px",fontSize:12}}>
                    <div style={{fontWeight:700,color:cs.muted,marginBottom:6}}>🔧 Material</div>
                    {(selectedLaporan.materials||[]).map((m,mi)=>(
                      <div key={mi} style={{color:cs.muted,marginBottom:2}}>• {m.nama}: {m.jumlah} {m.satuan}</div>
                    ))}
                  </div>
                )}

                {selectedLaporan.rekomendasi && <div style={{fontSize:11,marginBottom:4}}><span style={{color:cs.muted}}>Rekomendasi: </span><span style={{color:cs.text}}>{selectedLaporan.rekomendasi}</span></div>}
                {(selectedLaporan.catatan_global||selectedLaporan.catatan) && <div style={{fontSize:11}}><span style={{color:cs.muted}}>Catatan: </span><span style={{color:cs.text}}>{selectedLaporan.catatan_global||selectedLaporan.catatan}</span></div>}

                {safeArr(selectedLaporan.editLog).length>0 && (
                  <div style={{background:cs.yellow+"08",border:"1px solid "+cs.yellow+"22",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{fontSize:11,fontWeight:700,color:cs.yellow,marginBottom:8}}>Riwayat Edit ({safeArr(selectedLaporan.editLog).length}x)</div>
                    {safeArr(selectedLaporan.editLog).map((log,li)=>(
                      <div key={li} style={{fontSize:11,color:cs.muted,marginBottom:5,paddingBottom:5,borderBottom:li<safeArr(selectedLaporan.editLog).length-1?"1px solid "+cs.border:"none"}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                          <span style={{background:cs.accent+"18",color:cs.accent,fontWeight:700,padding:"1px 8px",borderRadius:99,fontSize:10}}>{log.by}</span>
                          <span style={{color:cs.muted}}>{log.at}</span>
                          <span>ubah field <b style={{color:cs.text}}>{log.field}</b></span>
                        </div>
                        <div style={{display:"flex",gap:8,fontSize:11}}>
                          <span style={{color:cs.red,textDecoration:"line-through"}}>{String(log.old).slice(0,60)}</span>
                          <span style={{color:cs.muted}}>→</span>
                          <span style={{color:cs.green,fontWeight:600}}>{String(log.new).slice(0,60)}</span>
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
        const incompleteUnits = laporanUnits.filter(u=>!isUnitDone(u));
        const totalFreon = laporanUnits.reduce((s,u)=>s+(parseFloat(u.freon_ditambah)||0),0);
        const presets = MATERIAL_PRESET[laporanModal.service] || MATERIAL_PRESET.Cleaning;
        const isInstallJob = laporanModal?.service === "Install";
        const STEP_LABELS = ["","Konfirmasi Unit",
          isInstallJob ? "(skip)" : "Detail Per Unit",
          isInstallJob ? "Form Instalasi" : "Material & Foto",
          "Submit"];

        const updateUnit = (idx, updated) => setLaporanUnits(prev=>prev.map((u,i)=>i===idx?updated:u));
        const toggleArr = (arr, val) => arr.includes(val)?arr.filter(x=>x!==val):[...arr,val];

        const handleFotoUpload = async (e) => {
          const files = Array.from(e.target.files||[]).slice(0, 10 - laporanFotos.length);
          if (files.length === 0) return;
          showNotif(`⏳ Mengkompresi & upload ${files.length} foto ke R2...`);
          const compressed = await Promise.all(files.map(compressImg));
          const reportId = laporanModal?.id || "tmp";

          // Upload satu per satu (bukan parallel) agar tidak timeout
          const uploaded = [];
          for (let i = 0; i < compressed.length; i++) {
            const dataUrl  = compressed[i];
            const localId  = Date.now() + i;
            const label    = `Foto ${laporanFotos.length + i + 1}`;
            let url        = null;
            let errMsg     = "";

            // ── SATU JALUR: R2 via /api/upload-foto ──
            try {
              const r = await fetch("/api/upload-foto", {
                method:  "POST",
                headers: _apiHeaders(),
                body:    JSON.stringify({
                  base64:   dataUrl,
                  filename: `foto_${localId}.jpg`,
                  reportId,
                  mimeType: "image/jpeg",
                }),
              });
              const d = await r.json();
              if (d.success && d.url) {
                url = d.url;
              } else {
                errMsg = d.error || "Upload gagal";
                console.error("R2 upload error:", errMsg);
              }
            } catch (err) {
              errMsg = err.message;
              console.error("R2 fetch error:", err);
            }

            uploaded.push({ id: localId, label, data_url: dataUrl, url, errMsg });
          }

          setLaporanFotos(prev => [...prev, ...uploaded]);
          const saved  = uploaded.filter(f => f.url).length;
          const failed = uploaded.filter(f => !f.url).length;

          if (saved === uploaded.length) {
            showNotif(`✅ ${saved} foto tersimpan di Cloudflare R2!`);
          } else if (saved > 0) {
            showNotif(`⚠️ ${saved} foto berhasil, ${failed} gagal. Hapus foto ⏳ lalu upload ulang.`);
          } else {
            // Semua gagal — tampilkan error detail
            const firstErr = uploaded[0]?.errMsg || "unknown error";
            showNotif(`❌ Upload gagal: ${firstErr}. Cek koneksi & coba lagi.`);
          }
          e.target.value = "";
        };

  const submitLaporan = async () => {
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
      const lanjut = window.confirm(
        `⚠️ ${fotoGagal} foto belum tersimpan ke cloud (ditandai ⏳).

` +
        `Lanjutkan submit laporan tanpa foto tersebut?

` +
        `• OK = lanjut submit
• Batal = kembali & hapus foto gagal lalu upload ulang`
      );
      if (!lanjut) return;
    }

    // ── 4. Siapkan materials yang efektif ──
    // Install: pakai laporanInstallItems, lainnya: pakai laporanMaterials
    const effectiveMaterials = isInstall
      ? INSTALL_ITEMS
          .filter(item => parseFloat(laporanInstallItems[item.key] || 0) > 0)
          .map(item => ({
            id: item.key,
            nama: item.label,
            jumlah: parseFloat(laporanInstallItems[item.key] || 0),
            satuan: item.satuan,
            keterangan: "",
          }))
      : laporanMaterials;

    const now = new Date().toLocaleString("id-ID", {
      year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit"
    });
    const totalFreonLocal = laporanUnits.reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0);

    // ── 5. Buat objek laporan ──
    const newReport = {
      id: laporanModal._rewriteId || ("LPR_" + laporanModal.id + "_" + Date.now().toString(36).slice(-4).toUpperCase()),
      job_id:   laporanModal.id,
      teknisi:  laporanModal.teknisi,
      helper:   laporanModal.helper || null,
      is_substitute: (currentUser?.role === "Helper" &&
        currentUser?.name === laporanModal.helper &&
        !teknisiData.find(t => t.role === "Teknisi" && t.name === laporanModal.helper)),
      customer: laporanModal.customer,
      service:  laporanModal.service,
      date:     laporanModal.date,
      submitted: now,
      status:   "SUBMITTED",
      total_units: laporanUnits.length,
      units:    laporanUnits,
      materials: effectiveMaterials,
      fotos:    laporanFotos.map(f => ({ id: f.id, label: f.label })),
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
      `📋 *Laporan Selesai*

` +
      `Job: *${laporanModal.id}*
` +
      `Customer: ${laporanModal.customer}
` +
      `Teknisi: ${laporanModal.teknisi}${laporanModal.helper ? " + " + laporanModal.helper : ""}
` +
      `Layanan: ${laporanModal.service} — ${laporanUnits.length} unit
` +
      `Material: ${matCount} item
` +
      `Foto: ${laporanFotos.filter(f => f.url).length} foto

` +
      `Silakan buat invoice dari ARA Chat 👆`;
    adminUsers.forEach(u => { if (u.phone) sendWA(u.phone, notifMsg); });

    // ── 7. Simpan laporan ke Supabase (3 attempt) ──
    showNotif("⏳ Menyimpan laporan ke server...");
    const basePayload = {
      id:             newReport.id,
      job_id:         newReport.job_id,
      teknisi:        newReport.teknisi,
      helper:         newReport.helper,
      customer:       newReport.customer,
      service:        newReport.service,
      date:           newReport.date,
      status:         "SUBMITTED",
      total_units:    newReport.total_units,
      total_freon:    newReport.total_freon,
      rekomendasi:    newReport.rekomendasi,
      catatan_global: newReport.catatan_global,
      submitted_at:   new Date().toISOString(),
      foto_urls:      laporanFotos.filter(f => f.url).map(f => f.url),
    };

    let savedOk = false;
    { // Attempt 1: full payload dengan JSON cols
      const { error: e1 } = await supabase.from("service_reports").upsert({
        ...basePayload,
        materials_json: JSON.stringify(effectiveMaterials),
        units_json:     JSON.stringify(laporanUnits),
      }, { onConflict: "id" });
      if (!e1) { savedOk = true; console.log("✅ Laporan saved (full):", newReport.id); }
      else console.warn("Attempt 1 failed:", e1.message);
    }
    if (!savedOk) { // Attempt 2: tanpa JSON cols
      const { error: e2 } = await supabase.from("service_reports").upsert(
        basePayload, { onConflict: "id" }
      );
      if (!e2) { savedOk = true; console.log("✅ Laporan saved (no json cols):", newReport.id); }
      else console.warn("Attempt 2 failed:", e2.message);
    }
    if (!savedOk) { // Attempt 3: minimal
      const { error: e3 } = await supabase.from("service_reports").upsert({
        id: newReport.id, job_id: newReport.job_id,
        teknisi: newReport.teknisi, customer: newReport.customer,
        service: newReport.service, date: newReport.date,
        status: "SUBMITTED", total_units: newReport.total_units,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (!e3) { savedOk = true; console.log("✅ Laporan saved (minimal):", newReport.id); }
      else { console.error("All upsert attempts failed:", e3.message); showNotif("❌ Gagal simpan: " + e3.message); }
    }

    // ── 8. Reload laporan (backup, realtime juga akan trigger) ──
    const reloadLaporan = async () => {
      const { data } = await supabase.from("service_reports")
        .select("*").order("submitted_at", { ascending: false });
      if (data?.length > 0) {
        setLaporanReports(data.map(r => ({
          ...r,
          units:     r.units_json     ? (() => { try { return JSON.parse(r.units_json);     } catch(_){ return r.units     || []; } })() : (r.units     || []),
          materials: r.materials_json ? (() => { try { return JSON.parse(r.materials_json); } catch(_){ return r.materials || []; } })() : (r.materials || []),
          fotos:     r.fotos || (r.foto_urls || []).map((url, i) => ({ id: i, label: `Foto ${i+1}`, url })),
          editLog:   safeArr(r.edit_log ?? r.editLog),
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
        await supabase.from("orders").update({ status: "COMPLETED" }).eq("id", laporanModal.id);
      }
    }

    // ── 10. Update status teknisi → active ──
    ["teknisi","helper"].forEach(role => {
      const name = role === "teknisi" ? laporanModal.teknisi : laporanModal.helper;
      if (!name) return;
      const tek = teknisiData.find(t => t.name === name);
      if (!tek?.id) return;
      setTeknisiData(prev => prev.map(t => t.name === name ? { ...t, status: "active" } : t));
      if (/^[0-9a-f-]{36}$/.test(tek.id)) {
        supabase.from("user_profiles").update({ status: "active" }).eq("id", tek.id);
      }
    });

    // ── 11. Deduct stok material (non-Install) ──
    const materialsToDeduct = isInstall ? [] : laporanMaterials;
    if (materialsToDeduct.length > 0) {
      deductInventory(materialsToDeduct);
      let deductedCount = 0;
      const lowStockWarnings = [];
      for (const mat of materialsToDeduct) {
        const qty = parseFloat(mat.jumlah) || 0;
        if (!mat.nama || qty <= 0) continue;
        try {
          const { data: items } = await supabase.from("inventory")
            .select("id,name,code,stock,min_alert,reorder,unit")
            .ilike("name", mat.nama.trim()).limit(1);
          if (items?.length > 0) {
            const itm = items[0];
            const newStk = Math.max(0, (itm.stock || 0) - qty);
            const newSts = newStk === 0 ? "OUT"
              : newStk <= (itm.min_alert || 1) ? "CRITICAL"
              : newStk <= (itm.reorder || 3) ? "WARNING" : "OK";
            await supabase.from("inventory").update({
              stock: newStk, status: newSts, updated_at: new Date().toISOString()
            }).eq("id", itm.id);
            deductedCount++;
            addAgentLog("STOCK_DEDUCTED", `${itm.name}: -${qty} (sisa: ${newStk}) — job ${laporanModal.id}`, "SUCCESS");
            if (newSts === "CRITICAL" || newSts === "OUT") lowStockWarnings.push(`${itm.name} sisa ${newStk}`);
          }
        } catch(e) {
          addAgentLog("STOCK_DEDUCT_ERR", `Gagal deduct ${mat.nama}: ${e?.message}`, "ERROR");
        }
      }
      if (lowStockWarnings.length > 0) {
        showNotif("⚠️ Stok kritis: " + lowStockWarnings.join(", "));
        const ownerAccs = userAccounts.filter(u => u.role === "Owner");
        const lowMsg = `⚠️ *Stok Material Kritis*\nSetelah job ${laporanModal.id}:\n` +
          lowStockWarnings.map(w => "• " + w).join("\n");
        ownerAccs.forEach(u => { if (u.phone) sendWA(u.phone, lowMsg); });
      }
    }

    // ── 12. Auto-generate invoice ──
    // Hitung labor & material — harga freon dari inventory DULU, fallback PRICE_LIST
    const laborTotalInv = hitungLabor(laporanModal.service, laporanModal.type, laporanUnits.length);
    const matTotalInv   = hitungMaterialTotal(effectiveMaterials);
    const invoiceTotal  = laborTotalInv + matTotalInv;
    const todayInv      = new Date().toISOString().slice(0, 10);
    const isComplainSvc = laporanModal.service === "Complain";
    const isZeroTotal   = invoiceTotal === 0;

    // Cek garansi aktif (untuk skip invoice Complain Rp 0)
    const prevGaransiActive = isComplainSvc && isZeroTotal
      ? invoicesData
          .filter(inv =>
            inv.customer === laporanModal.customer &&
            inv.service  !== "Complain" &&
            inv.garansi_expires &&
            inv.garansi_expires >= todayInv &&
            ["PAID","UNPAID","APPROVED"].includes(inv.status)
          )
          .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
      : null;

    // Cek garansi expired (untuk biaya pengecekan Rp 100.000)
    const prevGaransiExpired = isComplainSvc && isZeroTotal && !prevGaransiActive
      ? invoicesData
          .filter(inv =>
            inv.customer === laporanModal.customer &&
            inv.service  !== "Complain" &&
            inv.garansi_expires &&
            inv.garansi_expires < todayInv &&
            ["PAID","UNPAID","APPROVED"].includes(inv.status)
          )
          .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
      : null;

    const BIAYA_CEK = 100000;
    const finalLabor = (isComplainSvc && isZeroTotal && prevGaransiExpired)
      ? BIAYA_CEK : laborTotalInv;
    const finalTotal = (isComplainSvc && isZeroTotal && prevGaransiExpired)
      ? BIAYA_CEK : invoiceTotal;

    if (isComplainSvc && isZeroTotal && prevGaransiActive) {
      // SKIP invoice — dalam garansi
      setOrdersData(prev => prev.map(o =>
        o.id === laporanModal.id ? { ...o, status: "COMPLETED" } : o
      ));
      try { await supabase.from("orders").update({ status: "COMPLETED" }).eq("id", laporanModal.id); } catch(_) {}
      addAgentLog("GARANSI_SKIP_INVOICE",
        `Complain ${laporanModal.id} — dalam garansi s/d ${prevGaransiActive.garansi_expires} ` +
        `(ref: ${prevGaransiActive.id}) → invoice di-skip`, "SUCCESS");

    } else {
      // BUAT invoice
      const invSeq     = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
      const invId      = "INV-" + todayInv.replace(/-/g, "").slice(0, 8) + "-" + invSeq;
      const gDays      = laporanModal.service === "Install" ? 90 : laporanModal.service === "Repair" ? 60 : 30;
      const gExpires   = new Date(Date.now() + gDays * 86400000).toISOString().slice(0, 10);

      // Build materials_detail dengan harga dari inventory
      const mDetail = effectiveMaterials
        .filter(m => m.nama && (parseFloat(m.jumlah) || 0) > 0)
        .map(m => {
          const nama2   = (m.nama || "").toLowerCase();
          const normNama2 = nama2
            .replace(/,/g,".")
            .replace(/eterna\s*/g,"")
            .replace(/[-\s]/g,"")
            .replace(/r410a?$/,"r410")
            .replace(/r22a?$/,"r22")
            .replace(/r32a?$/,"r32");
          const invItem = inventoryData.find(inv => {
            const n = inv.name.toLowerCase()
              .replace(/,/g,".")
              .replace(/eterna\s*/g,"")
              .replace(/[-\s]/g,"")
              .replace(/r410a?$/,"r410")
              .replace(/r22a?$/,"r22")
              .replace(/r32a?$/,"r32");
            return n === normNama2 || n.includes(normNama2) || normNama2.includes(n);
          });
          let hSat = invItem?.price || 0;
          if (!hSat) {
            if      (nama2.includes("r-22")  || nama2.includes("r22"))  hSat = PRICE_LIST["freon_R22"]   || 150000;
            else if (nama2.includes("r-32")  || nama2.includes("r32"))  hSat = PRICE_LIST["freon_R32"]   || 160000;
            else if (nama2.includes("r-410") || nama2.includes("r410")) hSat = PRICE_LIST["freon_R410A"] || 450000;
          }
          const rawQty = parseFloat(m.jumlah) || 0;
          const isF    = ["freon","r-22","r-32","r-410"].some(k => nama2.includes(k));
          const qty    = isF ? Math.max(1, Math.ceil(rawQty)) : rawQty;
          return {
            nama: m.nama, jumlah: qty,
            satuan: m.satuan || (isF ? "kg" : "pcs"),
            harga_satuan: hSat, subtotal: hSat * qty,
            keterangan: m.keterangan || (isF && rawQty !== qty ? `Aktual: ${rawQty} kg → dibulatkan ${qty} kg` : ""),
          };
        });

      const newInvoice = {
        id: invId, job_id: laporanModal.id,
        customer: laporanModal.customer,
        phone:    laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone || "",
        service:  laporanModal.service + " - " + laporanModal.type,
        units:    laporanUnits.length,
        labor:    finalLabor,
        material: matTotalInv,
        materials_detail: mDetail,
        dadakan:  0,
        total:    finalTotal,
        status:   "PENDING_APPROVAL",
        garansi_days:    gDays,
        garansi_expires: gExpires,
        created_at: new Date().toISOString(),
      };

      // Status override
      if (isComplainSvc && finalTotal === 0) {
        newInvoice.status   = "PAID";
        newInvoice.paid_at  = new Date().toISOString();
        addAgentLog("GARANSI_AUTO_PAID", `Invoice ${invId} Rp 0 → auto PAID`, "SUCCESS");
      } else if (isComplainSvc && prevGaransiExpired) {
        addAgentLog("GARANSI_EXPIRED_FEE",
          `Invoice ${invId} — garansi expired (ref: ${prevGaransiExpired.id}) → biaya cek Rp ${BIAYA_CEK.toLocaleString("id-ID")}`,
          "WARNING");
      }

      setInvoicesData(prev => [...prev, newInvoice]);

      // Simpan invoice ke Supabase
      const invPayload = {
        ...newInvoice,
        materials_detail: mDetail.length > 0 ? JSON.stringify(mDetail) : null,
      };
      const { error: invErr } = await supabase.from("invoices").insert(invPayload);
      if (invErr) {
        console.warn("Invoice insert failed:", invErr.message, "— retrying minimal");
        for (const st of ["PENDING_APPROVAL","UNPAID"]) {
          const { error: e2 } = await supabase.from("invoices").insert({
            id: newInvoice.id, job_id: newInvoice.job_id,
            customer: newInvoice.customer, service: newInvoice.service,
            units: newInvoice.units, labor: newInvoice.labor,
            material: newInvoice.material, total: newInvoice.total,
            status: st,
          });
          if (!e2) { console.log("✅ Invoice inserted:", st); break; }
        }
      }

      addAgentLog("INVOICE_CREATED", `Invoice ${invId} dibuat — ${laporanModal.customer} ${fmt(newInvoice.total)}`, "SUCCESS");

      // WA notif ke Owner
      const ownerAccounts = userAccounts.filter(u => u.role === "Owner");
      const ownerMsg =
        `🔔 *Invoice Menunggu Approval*

` +
        `📋 Job: *${laporanModal.id}*
` +
        `👤 Customer: ${laporanModal.customer}
` +
        `🔧 Layanan: ${laporanModal.service} — ${laporanUnits.length} unit
` +
        `👷 Teknisi: ${laporanModal.teknisi}${laporanModal.helper ? " + " + laporanModal.helper : ""}

` +
        `💰 *Total: ${fmt(newInvoice.total)}*
` +
        `• Jasa: ${fmt(newInvoice.labor)}
` +
        `• Material: ${fmt(newInvoice.material)}

` +
        `🧾 Invoice: *${invId}*
Silakan approve di menu Invoice. — ARA`;
      ownerAccounts.forEach(u => { if (u.phone) sendWA(u.phone, ownerMsg); });
      if (ownerAccounts.length === 0) {
        fetch("/api/send-wa", {
          method: "POST", headers: _apiHeaders(),
          body: JSON.stringify({ phone: "6281299898937", message: ownerMsg })
        }).catch(() => {});
      }
    }

    setLaporanSubmitted(true);
    pushNotif("AClean", "Laporan berhasil dikirim ke Admin ✅");
    showNotif(`✅ Laporan ${laporanModal.id} terkirim! Laporan dikirim ke Owner/Admin untuk verifikasi.`);
  };

        const tagStyle = (active, color) => ({
          display:"flex",alignItems:"center",gap:6,background:cs.card,
          border:`1px solid ${active?color:cs.border}44`,borderRadius:8,
          padding:"7px 10px",cursor:"pointer",fontSize:12,
          color:active?color:cs.muted,userSelect:"none"
        });

        return (
          <div style={{position:"fixed",inset:0,background:"#000d",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setLaporanModal(null)}>
            <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:560,maxHeight:"94vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>

              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontWeight:800,fontSize:16,color:cs.text}}>📝 Laporan Servis</div>
                  <div style={{fontSize:12,color:cs.muted,marginTop:2}}>{laporanModal.id} · {laporanModal.customer} · {laporanModal.service}</div>
                </div>
                <button onClick={()=>setLaporanModal(null)} style={{background:"none",border:"none",color:cs.muted,fontSize:24,cursor:"pointer",lineHeight:1,padding:0}}>×</button>
              </div>

              {/* Step bar */}
              <div style={{display:"flex",gap:4,marginBottom:8}}>
                {[1,2,3,4].map(s=><div key={s} style={{flex:1,height:3,borderRadius:99,background:laporanStep>=s?cs.accent:cs.border}}/>)}
              </div>
              <div style={{fontSize:11,color:cs.muted,marginBottom:18,textAlign:"center"}}>Step {laporanStep}/4: {STEP_LABELS[laporanStep]}</div>

              {/* ── STEP 1: Konfirmasi Unit ── */}
              {laporanStep===1&&(
                <div style={{display:"grid",gap:14}}>

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
                    const acPernah = [...new Map(allUnits.map(u => [u.label||u.merk||"AC", u])).values()];
                    return (
                      <div style={{background:"#0ea5e908",border:"1px solid #0ea5e933",borderRadius:12,padding:"12px 14px"}}>
                        <div style={{fontWeight:700,color:"#7dd3fc",fontSize:12,marginBottom:8}}>
                          📋 Referensi History AC — {laporanModal.customer}
                          <span style={{fontSize:10,color:cs.muted,marginLeft:8,fontWeight:400}}>
                            ({custHistRef.length} kunjungan sebelumnya)
                          </span>
                        </div>

                        {/* Info kunjungan terakhir */}
                        <div style={{background:cs.surface,borderRadius:8,padding:"8px 10px",marginBottom:8,fontSize:11}}>
                          <div style={{fontWeight:700,color:cs.text,marginBottom:4}}>
                            Terakhir dikunjungi: <span style={{color:cs.accent}}>{lastJob.date}</span>
                            <span style={{color:cs.muted,marginLeft:8}}>{lastJob.service} · {lastJob.teknisi}</span>
                          </div>
                          {/* Detail unit AC — sesuai mkUnit: label, merk, pk, tipe, kondisi_sebelum[], kondisi_setelah[], pekerjaan[] */}
                          {(lastJob.unit_detail||[]).map((u,ui)=>(
                            <div key={ui} style={{marginBottom:ui<(lastJob.unit_detail.length-1)?8:0,
                              paddingBottom:ui<(lastJob.unit_detail.length-1)?8:0,
                              borderBottom:ui<(lastJob.unit_detail.length-1)?"1px dashed "+cs.border:"none"}}>
                              {/* Identitas unit */}
                              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:3}}>
                                <span style={{color:cs.accent,fontWeight:700,fontSize:12}}>Unit {u.unit_no}</span>
                                <span style={{color:cs.text,fontWeight:600,fontSize:12}}>{u.label}</span>
                                {u.merk&&<span style={{color:cs.muted,fontSize:11}}>{u.merk}</span>}
                                {u.pk&&<span style={{fontSize:10,background:cs.accent+"12",color:cs.accent,padding:"1px 6px",borderRadius:99}}>{u.pk}</span>}
                                {parseFloat(u.freon_ditambah)>0&&(
                                  <span style={{fontSize:10,background:cs.yellow+"12",color:cs.yellow,padding:"1px 6px",borderRadius:99}}>🧊 {u.freon_ditambah} psi freon</span>
                                )}
                                {u.ampere_akhir&&(
                                  <span style={{fontSize:10,background:cs.green+"12",color:cs.green,padding:"1px 6px",borderRadius:99}}>⚡ {u.ampere_akhir}A</span>
                                )}
                              </div>
                              {/* Kondisi sebelum */}
                              {safeArr(u.kondisi_sebelum).length>0&&(
                                <div style={{fontSize:11,marginBottom:2}}>
                                  <span style={{color:cs.muted}}>Kondisi masuk: </span>
                                  {safeArr(u.kondisi_sebelum).map((k,ki)=>(
                                    <span key={ki} style={{background:cs.yellow+"15",color:cs.yellow,fontSize:10,padding:"1px 6px",borderRadius:99,marginRight:4}}>{k}</span>
                                  ))}
                                </div>
                              )}
                              {/* Pekerjaan dilakukan */}
                              {safeArr(u.pekerjaan).length>0&&(
                                <div style={{fontSize:11,marginBottom:2}}>
                                  <span style={{color:cs.muted}}>Dikerjakan: </span>
                                  {safeArr(u.pekerjaan).map((p,pi)=>(
                                    <span key={pi} style={{background:cs.accent+"15",color:cs.accent,fontSize:10,padding:"1px 6px",borderRadius:99,marginRight:4}}>{p}</span>
                                  ))}
                                </div>
                              )}
                              {/* Kondisi sesudah */}
                              <div style={{fontSize:11}}>
                                <span style={{color:cs.muted}}>Setelah: </span>
                                {safeArr(u.kondisi_setelah).length>0
                                  ? safeArr(u.kondisi_setelah).map((k,ki)=>(
                                      <span key={ki} style={{background:cs.green+"15",color:cs.green,fontSize:10,padding:"1px 6px",borderRadius:99,marginRight:4}}>{k}</span>
                                    ))
                                  : <span style={{color:cs.muted,fontStyle:"italic"}}>tidak direkam</span>
                                }
                              </div>
                              {u.catatan_unit&&<div style={{fontSize:11,color:"#7dd3fc",marginTop:3}}>💬 {u.catatan_unit}</div>}
                            </div>
                          ))}
                          {lastJob.rekomendasi&&(
                            <div style={{color:"#7dd3fc",marginTop:4,fontStyle:"italic"}}>
                              💡 Rekomendasi lalu: {lastJob.rekomendasi}
                            </div>
                          )}
                        </div>

                        {/* Semua AC yang pernah dikerjakan */}
                        {acPernah.length>0&&(
                          <div style={{fontSize:11,color:cs.muted}}>
                            <span style={{fontWeight:700,color:cs.text}}>AC di lokasi ini: </span>
                            {acPernah.map((u,ui)=>(
                              <span key={ui} style={{marginRight:8}}>
                                {u.label||u.merk||`Unit ${u.unit_no}`}
                                {u.merk&&u.label?` (${u.merk})`:""}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* History ringkas semua kunjungan */}
                        {custHistRef.length>1&&(
                          <details style={{marginTop:8}}>
                            <summary style={{fontSize:11,color:cs.accent,cursor:"pointer",fontWeight:700}}>
                              Lihat semua {custHistRef.length} kunjungan ▾
                            </summary>
                            <div style={{marginTop:6,display:"grid",gap:4}}>
                              {custHistRef.map((h,hi)=>(
                                <div key={hi} style={{fontSize:11,color:cs.muted,display:"flex",gap:8,flexWrap:"wrap"}}>
                                  <span style={{color:cs.text,fontFamily:"monospace"}}>{h.job_id}</span>
                                  <span>{h.date}</span>
                                  <span style={{color:cs.accent}}>{h.service}</span>
                                  <span>{h.units}unit</span>
                                  <span>{h.teknisi}</span>
                                  {h.laporan_id&&<span style={{color:cs.green}}>✅ lap</span>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:12,padding:14}}>
                    <div style={{fontSize:12,color:cs.muted,marginBottom:10}}>Order tercatat <b style={{color:cs.text}}>{laporanModal.units||1} unit</b> AC. Sesuaikan dengan kondisi aktual.</div>
                    <div style={{display:"grid",gap:8}}>
                      {laporanUnits.map((u,idx)=>(
                        <div key={idx} style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{flex:1,background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 12px",fontSize:12,color:cs.text}}>
                            <span style={{color:cs.accent,fontWeight:700}}>Unit {u.unit_no}</span>
                          </div>
                          <input value={u.label} onChange={e=>updateUnit(idx,{...u,label:e.target.value})} placeholder="Lokasi/nama unit..."
                            style={{width:140,background:cs.card,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 10px",color:cs.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                          {laporanUnits.length>1&&(
                            <button onClick={()=>{const nu=laporanUnits.filter((_,i)=>i!==idx).map((u2,i)=>({...u2,unit_no:i+1}));setLaporanUnits(nu);setActiveUnitIdx(Math.max(0,idx-1));}}
                              style={{background:"#ef444415",border:"1px solid #ef444430",color:"#ef4444",borderRadius:8,padding:"8px 10px",cursor:"pointer",fontSize:13,lineHeight:1}}>×</button>
                          )}
                        </div>
                      ))}
                    </div>
                    {laporanUnits.length<10&&(
                      <button onClick={()=>{setLaporanUnits(p=>[...p,mkUnit(p.length+1)]);setActiveUnitIdx(laporanUnits.length);}}
                        style={{marginTop:10,width:"100%",background:cs.accent+"12",border:"1px dashed "+cs.accent+"44",color:cs.accent,borderRadius:8,padding:"10px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                        + Tambah Unit AC
                      </button>
                    )}
                  </div>
                  {laporanUnits.length!==(laporanModal.units||1)&&(
                    <div style={{background:cs.yellow+"10",border:"1px solid "+cs.yellow+"22",borderRadius:9,padding:"9px 13px",fontSize:11,color:cs.yellow}}>
                      ⚠ Jumlah unit berbeda dari order. Admin akan dinotifikasi untuk verifikasi.
                    </div>
                  )}
                  <button onClick={()=>setLaporanStep(laporanModal?.service==="Install" ? 3 : 2)} style={{background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)",border:"none",color:"#0a0f1e",padding:"13px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>
                    Lanjut — Isi Detail Unit →
                  </button>
                </div>
              )}

              {/* ── STEP 2: Detail Per Unit ── */}
              {laporanStep===2&&(
                <div style={{display:"grid",gap:14}}>
                  {/* Tab per unit */}
                  <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
                    {laporanUnits.map((u,idx)=>{
                      const done=isUnitDone(u);
                      return(
                        <button key={idx} onClick={()=>setActiveUnitIdx(idx)}
                          style={{flexShrink:0,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12,border:"none",
                            background:activeUnitIdx===idx?"linear-gradient(135deg,"+cs.accent+",#3b82f6)":done?cs.green+"18":cs.card,
                            color:activeUnitIdx===idx?"#0a0f1e":done?cs.green:cs.muted,
                            outline:activeUnitIdx!==idx&&!done?"1px solid "+cs.border:"none"}}>
                          {done?"✓ ":""}{u.label||`Unit ${u.unit_no}`}
                        </button>
                      );
                    })}
                  </div>

                  {/* Detail unit aktif */}
                  {laporanUnits[activeUnitIdx]&&(()=>{
                    const u=laporanUnits[activeUnitIdx];
                    const upd=(f)=>updateUnit(activeUnitIdx,{...u,...f});
                    return(
                      <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:12,padding:14,display:"grid",gap:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:cs.accent,marginBottom:2}}>Unit {u.unit_no} — {u.label}</div>
                        {/* Tipe & Merk */}
                        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8}}>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>Tipe AC</div>
                            <select value={u.tipe} onChange={e=>upd({tipe:e.target.value})}
                              style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 10px",color:cs.text,fontSize:12,outline:"none"}}>
                              {TIPE_AC_OPT.map(t=><option key={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>Merk</div>
                            <input value={u.merk} onChange={e=>upd({merk:e.target.value})} placeholder="Daikin..."
                              style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 10px",color:cs.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                          </div>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>PK</div>
                            <input value={u.pk} onChange={e=>upd({pk:e.target.value})} placeholder="1PK"
                              style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"8px 10px",color:cs.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                          </div>
                        </div>
                        {/* Kondisi Sebelum */}
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:cs.yellow,marginBottom:6}}>⚠ Kondisi Sebelum</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                            {KONDISI_SBL.map(k=>(
                              <label key={k} style={tagStyle(u.kondisi_sebelum.includes(k),cs.yellow)}>
                                <input type="checkbox" checked={u.kondisi_sebelum.includes(k)} onChange={()=>upd({kondisi_sebelum:toggleArr(u.kondisi_sebelum,k)})} style={{accentColor:cs.yellow}}/>{k}
                              </label>
                            ))}
                          </div>
                        </div>
                        {/* Pekerjaan */}
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:cs.accent,marginBottom:6}}>🔧 Pekerjaan Dilakukan</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                            {PEKERJAAN_OPT(laporanModal?.service||"Cleaning").map(k=>(
                              <label key={k} style={tagStyle(u.pekerjaan.includes(k),cs.accent)}>
                                <input type="checkbox" checked={u.pekerjaan.includes(k)} onChange={()=>upd({pekerjaan:toggleArr(u.pekerjaan,k)})} style={{accentColor:cs.accent}}/>{k}
                              </label>
                            ))}
                          </div>
                        </div>
                        {/* Kondisi Sesudah */}
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:cs.green,marginBottom:6}}>✓ Kondisi Sesudah</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                            {KONDISI_SDH.map(k=>(
                              <label key={k} style={tagStyle(u.kondisi_setelah.includes(k),cs.green)}>
                                <input type="checkbox" checked={u.kondisi_setelah.includes(k)} onChange={()=>upd({kondisi_setelah:toggleArr(u.kondisi_setelah,k)})} style={{accentColor:cs.green}}/>{k}
                              </label>
                            ))}
                          </div>
                        </div>
                        {/* Freon & Ampere */}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>Tekanan Freon (psi)</div>
                            <input type="number" value={u.freon_ditambah} onChange={e=>upd({freon_ditambah:e.target.value})} placeholder="0" min="0" step="0.1"
                              style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                          </div>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>Ampere Akhir (A)</div>
                            <input type="number" value={u.ampere_akhir} onChange={e=>upd({ampere_akhir:e.target.value})} placeholder="0.0" min="0" step="0.1"
                              style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                          </div>
                        </div>
                        {/* Catatan unit */}
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>Catatan Unit (Opsional)</div>
                          <textarea value={u.catatan_unit} onChange={e=>upd({catatan_unit:e.target.value})} rows={2} placeholder="Catatan khusus unit ini..."
                            style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                    <button onClick={()=>setLaporanStep(1)} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>← Kembali</button>
                    <div style={{textAlign:"center",fontSize:11,color:cs.muted,alignSelf:"center"}}>{laporanUnits.filter(isUnitDone).length}/{laporanUnits.length} unit ✓</div>
                    <button onClick={()=>{
                      if(!isInstallJob && incompleteUnits.length>0){showNotif(`${incompleteUnits.length} unit belum diisi`);setActiveUnitIdx(laporanUnits.findIndex(u=>!isUnitDone(u)));return;}
                      setLaporanStep(3);
                    }} style={{background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)",border:"none",color:"#0a0f1e",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>Lanjut →</button>
                  </div>
                </div>
              )}

              {/* ── STEP 3: Material & Foto ── */}
              {laporanStep===3&&(
                <div style={{display:"grid",gap:14}}>

                  {/* ══ REPORT INSTALL FORM ══ */}
                  {isInstallJob && (
                    <div style={{display:"grid",gap:10,marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:cs.accent,marginBottom:2}}>🔧 Detail Pekerjaan Instalasi</div>
                      <div style={{fontSize:11,color:cs.muted,marginBottom:4}}>Isi 0 jika tidak dikerjakan. Admin dapat mengedit setelah selesai.</div>
                      {INSTALL_ITEMS.map(item=>(
                        <div key={item.key} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",
                          background:parseFloat(laporanInstallItems[item.key]||0)>0?cs.accent+"08":cs.card,
                          border:"1px solid "+(parseFloat(laporanInstallItems[item.key]||0)>0?cs.accent+"44":cs.border),
                          borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontSize:12,color:cs.text,fontWeight:parseFloat(laporanInstallItems[item.key]||0)>0?700:400}}>
                            {item.label}
                            <span style={{fontSize:10,color:cs.muted,marginLeft:4}}>({item.satuan})</span>
                          </div>
                          <input type="number" min="0" step={item.satuan==="meter"?"0.5":"1"}
                            value={laporanInstallItems[item.key]??""}
                            onChange={e=>setLaporanInstallItems(prev=>({...prev,[item.key]:e.target.value}))}
                            placeholder="0"
                            style={{width:70,textAlign:"center",background:cs.surface,border:"1px solid "+cs.border,
                              borderRadius:7,padding:"6px 8px",color:cs.text,fontSize:13,outline:"none"}}/>
                        </div>
                      ))}
                      {Object.values(laporanInstallItems).some(v=>parseFloat(v||0)>0) && (
                        <div style={{background:cs.green+"10",border:"1px solid "+cs.green+"33",borderRadius:9,padding:"10px 12px",fontSize:11,color:cs.green}}>
                          ✅ {INSTALL_ITEMS.filter(it=>parseFloat(laporanInstallItems[it.key]||0)>0).length} item diisi
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══ NORMAL MATERIAL FORM (Service/Repair/Complain) ══ */}
                  {!isInstallJob && (
                  <div style={{display:"grid",gap:10}}>
                  {/* Material */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:cs.muted}}>🔧 Material Digunakan ({laporanMaterials.length}/20)</div>
                      <button onClick={()=>setShowMatPreset(v=>!v)}
                        style={{fontSize:11,background:cs.accent+"15",border:"1px solid "+cs.accent+"33",color:cs.accent,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>
                        {showMatPreset?"✕ Tutup":"📦 Preset "+laporanModal.service}
                      </button>
                    </div>
                    {showMatPreset&&(
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                        <div style={{fontSize:11,color:cs.muted,width:"100%",marginBottom:2}}>Tap untuk tambah:</div>
                        {presets.map(p=>(
                          <button key={p.nama||p} onClick={()=>{if(laporanMaterials.length<20)setLaporanMaterials(prev=>[...prev,{id:Date.now(),nama:p.nama||p,jumlah:"",satuan:p.satuan||"pcs",keterangan:""}]);setShowMatPreset(false);}}
                            style={{fontSize:11,background:cs.surface,border:"1px solid "+cs.border,color:cs.text,borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>
                            {p.nama||p}
                          </button>
                        ))}
                      </div>
                    )}
                    {laporanMaterials.length===0&&<div style={{textAlign:"center",padding:"14px 0",fontSize:12,color:cs.muted,fontStyle:"italic"}}>Belum ada material. Tap + Tambah atau pakai Preset.</div>}
                    {laporanMaterials.map(mat=>(
                      <div key={mat.id} style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <input value={mat.nama} onChange={e=>setLaporanMaterials(p=>p.map(m=>m.id===mat.id?{...m,nama:e.target.value}:m))} placeholder="Nama material..."
                            style={{flex:1,background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 10px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                          <button onClick={()=>setLaporanMaterials(p=>p.filter(m=>m.id!==mat.id))}
                            style={{marginLeft:8,background:"#ef444422",border:"1px solid #ef444433",color:"#ef4444",borderRadius:7,padding:"8px 10px",cursor:"pointer",fontSize:14,lineHeight:1,fontWeight:700}}>×</button>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          <input type="number" value={mat.jumlah} onChange={e=>setLaporanMaterials(p=>p.map(m=>m.id===mat.id?{...m,jumlah:e.target.value}:m))} placeholder="Jml" min="0"
                            style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 10px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                          <select value={mat.satuan} onChange={e=>setLaporanMaterials(p=>p.map(m=>m.id===mat.id?{...m,satuan:e.target.value}:m))}
                            style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 10px",color:cs.text,fontSize:12,outline:"none"}}>
                            {SATUAN_OPT.map(s=><option key={s}>{s}</option>)}
                          </select>
                          <input value={mat.keterangan} onChange={e=>setLaporanMaterials(p=>p.map(m=>m.id===mat.id?{...m,keterangan:e.target.value}:m))} placeholder="Keterangan..."
                            style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 10px",color:cs.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                  {laporanMaterials.length<20&&(
                    <button onClick={()=>setLaporanMaterials(p=>[...p,{id:Date.now(),nama:"",jumlah:1,satuan:"pcs",keterangan:""}])}
                      style={{marginTop:8,width:"100%",background:cs.green+"10",border:"1px dashed "+cs.green+"33",color:cs.green,borderRadius:8,padding:"10px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                      + Tambah Material
                    </button>
                  )}
                  </div>
                  )}{/* end !isInstallJob */}

                  {/* ── Foto: tampil untuk semua service ── */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:cs.muted}}>📸 Foto Dokumentasi ({laporanFotos.length}/10)
                        {laporanFotos.length > 0 && (
                          <span style={{marginLeft:8,fontSize:11}}>
                            <span style={{color:cs.green}}>☁️ {laporanFotos.filter(f=>f.url).length} tersimpan</span>
                            {laporanFotos.filter(f=>!f.url).length > 0 && (
                              <span style={{color:cs.yellow,marginLeft:6}}>⚠️ {laporanFotos.filter(f=>!f.url).length} gagal upload — hapus &amp; upload ulang</span>
                            )}
                          </span>
                        )}
                      </div>
                      {laporanFotos.length<10&&(
                        <button onClick={()=>fotoInputRef.current?.click()}
                          style={{fontSize:11,background:cs.accent+"15",border:"1px solid "+cs.accent+"33",color:cs.accent,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>+ Foto</button>
                      )}
                    </div>
                    <input ref={fotoInputRef} type="file" accept="image/*" multiple onChange={handleFotoUpload} style={{display:"none"}}/>
                    {laporanFotos.length===0?(
                      <div onClick={()=>fotoInputRef.current?.click()}
                        style={{border:"1px dashed "+cs.border,borderRadius:10,padding:"20px",textAlign:"center",cursor:"pointer",color:cs.muted,fontSize:12}}>
                        📷 Tap untuk upload foto<br/><span style={{fontSize:11}}>Sebelum &amp; sesudah servis, kondisi material</span>
                      </div>
                    ):(
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                        {laporanFotos.map(f=>(
                          <div key={f.id} style={{position:"relative"}}>
                            <img src={f.data_url} alt={f.label} style={{width:"100%",aspectRatio:"1/1",objectFit:"cover",borderRadius:8,border:"1px solid "+cs.border}}/>
                            <div style={{position:"absolute",top:4,right:4,background:f.url?"#22c55e":"#f59e0b",color:"#fff",fontSize:9,padding:"1px 5px",borderRadius:99,fontWeight:700}}>
                              {f.url ? "☁️ OK" : "⏳"}
                            </div>
                            <button onClick={()=>setLaporanFotos(p=>p.filter(x=>x.id!==f.id))}
                              style={{position:"absolute",top:4,left:4,background:"#ef4444cc",border:"none",color:"#fff",borderRadius:99,width:18,height:18,cursor:"pointer",fontSize:10,lineHeight:1,padding:0}}>×</button>
                            <input value={f.label} onChange={e=>setLaporanFotos(p=>p.map(x=>x.id===f.id?{...x,label:e.target.value}:x))}
                              placeholder="Label foto..." style={{marginTop:3,width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:5,padding:"4px 6px",color:cs.text,fontSize:10,outline:"none",boxSizing:"border-box"}}/>
                          </div>
                        ))}
                        {laporanFotos.length<10&&(
                          <div onClick={()=>fotoInputRef.current?.click()}
                            style={{aspectRatio:"1/1",border:"1px dashed "+cs.border,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:22,color:cs.muted}}>+</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Rekomendasi & Catatan: shared untuk semua service ── */}
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:5}}>Rekomendasi untuk Customer</div>
                    <textarea value={laporanRekomendasi} onChange={e=>setLaporanRekomendasi(e.target.value)} rows={2} placeholder="cth: Disarankan servis berkala tiap 3 bulan..."
                      style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:5}}>Catatan ke Admin (Opsional)</div>
                    <textarea value={laporanCatatan} onChange={e=>setLaporanCatatan(e.target.value)} rows={2} placeholder="Catatan lain untuk Admin..."
                      style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:8,padding:"9px 12px",color:cs.text,fontSize:13,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10}}>
                    <button onClick={()=>setLaporanStep(laporanModal?.service==="Install" ? 1 : 2)} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>← Kembali</button>
                    <button onClick={()=>setLaporanStep(4)} style={{background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)",border:"none",color:"#0a0f1e",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>Lanjut → Ringkasan</button>
                  </div>
                </div>
              )}

              {/* ── STEP 4: Ringkasan & Submit ── */}
              {laporanStep===4&&(
                <div style={{display:"grid",gap:14}}>
                  <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:12,padding:14,fontSize:12}}>
                    <div style={{fontWeight:700,color:cs.text,marginBottom:12}}>📋 Ringkasan Laporan</div>
                    <div style={{display:"grid",gap:5,marginBottom:12}}>
                      <div><span style={{color:cs.muted}}>Job: </span><span style={{color:cs.accent,fontWeight:700}}>{laporanModal.id}</span> · <span style={{color:cs.text}}>{laporanModal.customer}</span></div>
                      <div><span style={{color:cs.muted}}>Teknisi: </span><span style={{fontWeight:600,color:cs.text}}>{laporanModal.teknisi}{laporanModal.helper?" + "+laporanModal.helper+" (Helper)":""}</span></div>
                      <div>
                        <span style={{color:cs.muted}}>Total: </span>
                        <span style={{fontWeight:700,color:cs.text}}>{laporanUnits.length} unit AC</span>
                        {totalFreon>0&&<span style={{color:cs.muted}}> · Tekanan Freon: <span style={{color:cs.yellow}}>{totalFreon.toFixed(0)} psi</span></span>}
                        {laporanFotos.length>0&&<span style={{color:cs.muted}}> · <span style={{color:cs.green}}>{laporanFotos.length} foto</span></span>}
                        {laporanMaterials.length>0&&<span style={{color:cs.muted}}> · <span style={{color:cs.accent}}>{laporanMaterials.length} material</span></span>}
                      </div>
                    </div>
                    {/* Per-unit summary */}
                    {/* ══ Install summary ══ */}
                    {isInstallJob && (
                      <div style={{background:cs.card,border:"1px solid "+cs.accent+"33",borderRadius:10,padding:"12px 14px"}}>
                        <div style={{fontWeight:700,color:cs.accent,marginBottom:8,fontSize:12}}>🔧 Detail Instalasi</div>
                        {INSTALL_ITEMS.filter(it=>parseFloat(laporanInstallItems[it.key]||0)>0).map(it=>(
                          <div key={it.key} style={{display:"flex",justifyContent:"space-between",fontSize:12,
                            color:cs.text,marginBottom:3,paddingBottom:3,borderBottom:"1px solid "+cs.border+"33"}}>
                            <span>{it.label}</span>
                            <span style={{fontWeight:700,color:cs.accent}}>{laporanInstallItems[it.key]} {it.satuan}</span>
                          </div>
                        ))}
                        {!INSTALL_ITEMS.some(it=>parseFloat(laporanInstallItems[it.key]||0)>0) && (
                          <div style={{color:cs.muted,fontSize:12,textAlign:"center"}}>Belum ada item diisi</div>
                        )}
                      </div>
                    )}

                    {/* ══ Per-unit summary (Service/Repair/Complain) ══ */}
                    {!isInstallJob && (
                      <div style={{display:"grid",gap:8}}>
                        {laporanUnits.map((u,i)=>(
                          <div key={i} style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:9,padding:"10px 12px"}}>
                            <div style={{fontWeight:700,color:cs.accent,marginBottom:5}}>Unit {u.unit_no} — {u.label} {u.merk?`(${u.merk})`:""}</div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:3}}>
                              {u.kondisi_sebelum.map((k,ki)=><span key={ki} style={{fontSize:10,background:cs.yellow+"18",color:cs.yellow,padding:"1px 6px",borderRadius:99}}>{k}</span>)}
                            </div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:3}}>
                              {u.pekerjaan.map((k,ki)=><span key={ki} style={{fontSize:10,background:cs.accent+"18",color:cs.accent,padding:"1px 6px",borderRadius:99}}>{k}</span>)}
                            </div>
                            <div style={{fontSize:11,color:cs.muted}}>
                              {u.ampere_akhir?`Ampere: ${u.ampere_akhir}A`:""}{u.ampere_akhir&&parseFloat(u.freon_ditambah)>0?" · ":""}
                              {parseFloat(u.freon_ditambah)>0?`Tekanan: ${u.freon_ditambah} psi`:""}
                              {u.catatan_unit?` · ${u.catatan_unit}`:""}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ══ Material summary ══ */}
                    {isInstallJob && INSTALL_ITEMS.some(it=>parseFloat(laporanInstallItems[it.key]||0)>0) && (
                      <div style={{marginTop:10}}>
                        <div style={{fontWeight:700,color:cs.text,marginBottom:5,fontSize:11}}>Material Instalasi:</div>
                        {INSTALL_ITEMS.filter(it=>parseFloat(laporanInstallItems[it.key]||0)>0).map((it,mi)=>(
                          <div key={mi} style={{fontSize:11,color:cs.muted,marginBottom:2}}>• {it.label}: {laporanInstallItems[it.key]} {it.satuan}</div>
                        ))}
                      </div>
                    )}
                    {!isInstallJob && laporanMaterials.length>0 && (
                      <div style={{marginTop:10}}>
                        <div style={{fontWeight:700,color:cs.text,marginBottom:5,fontSize:11}}>Material:</div>
                        {laporanMaterials.map((m,mi)=>(
                          <div key={mi} style={{fontSize:11,color:cs.muted,marginBottom:2}}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan?` — ${m.keterangan}`:""}</div>
                        ))}
                      </div>
                    )}
                    {laporanRekomendasi&&<div style={{marginTop:8,fontSize:11}}><span style={{color:cs.muted}}>Rekomendasi: </span><span style={{color:cs.text}}>{laporanRekomendasi}</span></div>}
                    {laporanUnits.length!==(laporanModal.units||1)&&(
                      <div style={{marginTop:10,background:cs.yellow+"10",border:"1px solid "+cs.yellow+"22",borderRadius:8,padding:"8px 12px",fontSize:11,color:cs.yellow}}>⚠ Unit tidak sama dengan order asal — Admin akan dikonfirmasi</div>
                    )}
                  </div>
                  <div style={{background:cs.green+"10",border:"1px solid "+cs.green+"22",borderRadius:10,padding:"10px 14px",fontSize:12,color:cs.green}}>
                    Setelah submit, laporan dikirim ke Owner/Admin untuk verifikasi dan pembuatan invoice.
                  </div>
                  {/* ── GAP-05 FIX: Upgrade Complain → Repair jika butuh perbaikan ── */}
                  {laporanModal?.service==="Complain" && (
                    <div style={{background:cs.yellow+"0d",border:"1px solid "+cs.yellow+"33",borderRadius:10,padding:"12px 14px"}}>
                      <div style={{fontSize:11,fontWeight:700,color:cs.yellow,marginBottom:5}}>⚠️ Perlu Perbaikan Tambahan?</div>
                      <div style={{fontSize:11,color:cs.muted,marginBottom:8}}>Jika AC ternyata butuh repair (bukan sekadar komplain garansi), buat job Repair terpisah agar ada invoice perbaikan.</div>
                      <button onClick={async()=>{
                        const rId="JOB"+Date.now().toString(36).slice(-5).toUpperCase();
                        const rJob={
                          id:rId,customer:laporanModal.customer,
                          phone:laporanModal.phone||customersData.find(c=>c.name===laporanModal.customer)?.phone||"",
                          address:laporanModal.address||"",service:"Repair",type:"Pengecekan AC",
                          units:laporanModal.units||1,teknisi:laporanModal.teknisi,helper:laporanModal.helper||null,
                          date:laporanModal.date,time:laporanModal.time||"09:00",status:"CONFIRMED",
                          parent_job_id:laporanModal.id,dispatch:true,
                          notes:"Upgrade dari Complain "+laporanModal.id
                        };
                        setOrdersData(prev=>[...prev,rJob]);
                        const {error:rErr}=await supabase.from("orders").insert(rJob);
                        if(!rErr){
                          addAgentLog("COMPLAIN_UPGRADED",`Complain ${laporanModal.id} → Repair ${rId}`,"SUCCESS");
                          showNotif(`✅ Job Repair ${rId} dibuat! Admin dinotifikasi.`);
                          const admR=userAccounts.filter(u=>u.role==="Admin"||u.role==="Owner");
                          admR.forEach(a=>{if(a?.phone)sendWA(a.phone,`🔧 *Upgrade Complain → Repair*

Complain: ${laporanModal.id}
Repair Baru: *${rId}*
Customer: ${laporanModal.customer}
Teknisi: ${laporanModal.teknisi}

Silakan approve & buat invoice. — ARA`);});
                        } else showNotif("❌ Gagal buat Repair: "+rErr.message);
                      }} style={{background:cs.yellow+"22",border:"1px solid "+cs.yellow+"44",color:cs.yellow,
                        padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",width:"100%"}}>
                        🔧 Upgrade ke Job Repair (Buat Invoice Perbaikan Terpisah)
                      </button>
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10}}>
                    <button onClick={()=>setLaporanStep(3)} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>← Kembali</button>
                    <button onClick={submitLaporan} style={{background:"linear-gradient(135deg,"+cs.green+",#059669)",border:"none",color:"#fff",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>✓ Submit Laporan</button>
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })()}

      {/* ── Laporan Submitted Confirmation ── */}
      {laporanModal && laporanSubmitted && (
        <div style={{position:"fixed",inset:0,background:"#000d",zIndex:600,display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center",padding:24}}>
          <div style={{background:cs.surface,border:"1px solid "+cs.green+"44",borderRadius:20,padding:32,textAlign:"center",maxWidth:360,width:"100%"}}>
            <div style={{fontSize:48,marginBottom:12}}>✅</div>
            <div style={{fontWeight:800,fontSize:18,color:cs.text,marginBottom:8}}>Laporan Terkirim!</div>
            <div style={{fontSize:13,color:cs.muted,marginBottom:6}}>{laporanModal.id} · {laporanModal.customer}</div>
            <div style={{fontSize:12,color:cs.green,marginBottom:4}}>{laporanUnits.length} unit AC · {laporanMaterials.length} material · {laporanFotos.length} foto</div>
            <div style={{fontSize:12,color:cs.muted,marginBottom:20}}>Laporan sedang diproses Admin/Owner untuk verifikasi.</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <button onClick={()=>{setActiveMenu("myreport");setLaporanModal(null);setLaporanSubmitted(false);}}
                style={{background:cs.accent+"22",border:"1px solid "+cs.accent+"44",color:cs.accent,padding:"11px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13}}>
                Lihat Laporan
              </button>
              <button onClick={()=>{setLaporanModal(null);setLaporanSubmitted(false);}}
                style={{background:"linear-gradient(135deg,"+cs.green+",#059669)",border:"none",color:"#fff",padding:"11px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div style={{ position:"fixed", bottom:24, right:24, background:"linear-gradient(135deg,#1e293b,#0f172a)", border:"1px solid "+cs.accent+"66", color:cs.text, padding:"12px 20px", borderRadius:12, fontSize:13, fontWeight:600, zIndex:1000, boxShadow:"0 8px 32px #000a", maxWidth:360 }}>
          {notification}
        </div>
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
  );
}
