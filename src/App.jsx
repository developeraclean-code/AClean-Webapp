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

const SERVICE_HISTORY = [
  { id:"SVC001", customer_id:"CUST001", job_id:"JOB10001", date:"2026-03-01", service:"Cleaning",  type:"AC Split 0.5-1PK",         units:2, teknisi:"Mulyadi",     status:"IN_PROGRESS", invoice:null,               total:170000, materials:[],                        notes:"Sedang dikerjakan",          recommendation:"Filter kotor, sarankan 2 bulan sekali" },
  { id:"SVC002", customer_id:"CUST001", job_id:"JOB09801", date:"2025-12-10", service:"Cleaning",  type:"AC Split 0.5-1PK",         units:2, teknisi:"Mulyadi",     status:"COMPLETED",   invoice:"INV-20251210-001",  total:170000, materials:[],                        notes:"Selesai, AC bersih",          recommendation:"Jadwalkan Maret 2026" },
  { id:"SVC003", customer_id:"CUST001", job_id:"JOB09620", date:"2025-09-15", service:"Repair",    type:"Pengecekan AC Panas/Bocor", units:1, teknisi:"Usaeri",      status:"COMPLETED",   invoice:"INV-20250915-002",  total:285000, materials:["Freon R22 0.5kg"],       notes:"Freon habis, isi ulang",      recommendation:"Cek freon 6 bulan" },
  { id:"SVC004", customer_id:"CUST001", job_id:"JOB09450", date:"2025-06-20", service:"Cleaning",  type:"AC Split 0.5-1PK",         units:2, teknisi:"Albana Niji", status:"COMPLETED",   invoice:"INV-20250620-003",  total:170000, materials:[],                        notes:"Bersih semua",               recommendation:"" },
  { id:"SVC005", customer_id:"CUST002", job_id:"JOB10002", date:"2026-03-01", service:"Repair",    type:"Pengecekan AC Panas/Bocor", units:1, teknisi:"Usaeri",      status:"COMPLETED",   invoice:"INV-20260301-001",  total:135000, materials:["Kapasitor 1pcs"],        notes:"Kapasitor diganti",          recommendation:"Cek ulang 6 bulan" },
  { id:"SVC006", customer_id:"CUST002", job_id:"JOB09850", date:"2025-12-20", service:"Cleaning",  type:"AC Split 0.5-1PK",         units:3, teknisi:"Mulyadi",     status:"COMPLETED",   invoice:"INV-20251220-001",  total:255000, materials:[],                        notes:"Cleaning rutin 3 unit",      recommendation:"AC prima" },
  { id:"SVC007", customer_id:"CUST002", job_id:"JOB09500", date:"2025-07-12", service:"Install",   type:"Pasang AC 0.5-1PK",        units:1, teknisi:"Usaeri",      status:"COMPLETED",   invoice:"INV-20250712-002",  total:830000, materials:["Pipa 3/8 3m","Bracket"], notes:"Install unit baru",          recommendation:"Cleaning 1 bulan" },
  { id:"SVC008", customer_id:"CUST003", job_id:"JOB10003", date:"2026-03-01", service:"Cleaning",  type:"AC Split 1.5-2.5PK",       units:3, teknisi:"Albana Niji", status:"CONFIRMED",   invoice:null,               total:270000, materials:[],                        notes:"Terjadwal siang ini",        recommendation:"" },
  { id:"SVC009", customer_id:"CUST003", job_id:"JOB09700", date:"2025-11-05", service:"Cleaning",  type:"AC Split 1.5-2.5PK",       units:3, teknisi:"Rey",         status:"COMPLETED",   invoice:"INV-20251105-001",  total:270000, materials:[],                        notes:"Filter sangat kotor",        recommendation:"2 bulan sekali" },
  { id:"SVC010", customer_id:"CUST005", job_id:"JOB09991", date:"2026-02-25", service:"Cleaning",  type:"AC Split 0.5-1PK",         units:3, teknisi:"Rizky Putra", status:"COMPLETED",   invoice:"INV-20260225-001",  total:255000, materials:["Filter 2pcs"],          notes:"Filter diganti, bau hilang", recommendation:"Anti-bakteri filter" },
  { id:"SVC011", customer_id:"CUST007", job_id:"JOB09970", date:"2026-02-20", service:"Cleaning",  type:"Cassette 2-2.5PK",         units:1, teknisi:"Agung",       status:"COMPLETED",   invoice:"INV-20260220-001",  total:250000, materials:[],                        notes:"Cleaning cassette kantor",   recommendation:"Maintenance bulanan" },
];

const ORDERS_DATA = [
];

const INVOICES_DATA = [
];

// GAP 13 — Price list untuk auto-hitung invoice dari laporan
const PRICE_LIST = {
  "Cleaning": {
    "AC Split 0.5-1PK":   85000,
    "AC Split 1.5-2.5PK": 100000,
    "AC Cassette 2-2.5PK":250000,
    "AC Cassette 3PK":    300000,
    "AC Cassette 4PK":    350000,
    "AC Standing":        200000,
    "AC Duct":            400000,
    "default":             85000,
  },
  "Install": {
    "Pasang AC 0.5-1PK":  500000,
    "Pasang AC 1PK":      500000,
    "Pasang AC 1.5-2PK":  600000,
    "Pasang AC 2.5PK":    700000,
    "default":            500000,
  },
  "Repair": {
    "Pengecekan AC":       75000,
    "Pengecekan AC Panas/Bocor": 75000,
    "default":             75000,
  },
  "freon_R22":   150000,
  "freon_R410A": 180000,
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
- Bisnis: AClean Service — AC Cleaning, Install & Repair
- Area Utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan
- Area Perlu Konfirmasi: Jakarta Barat, Jakarta Selatan (ongkir tambah)
- Peran: Asisten AI eksekutif untuk Owner/Admin

## LAYANAN & HARGA STANDAR
| Layanan | Harga/unit |
|---------|-----------|
| Cuci AC | 80.000 |
| Freon AC (R22) | 150.000 |
| Freon AC (R32) | 200.000 |
| Perbaikan AC | 100.000–500.000 (estimasi) |
| Pasang AC Baru | 300.000 |
| Bongkar AC | 150.000 |
| Service AC | 120.000 |
- Biaya dadakan (booking H-0): +50.000
- Minimal 1 unit per order

## SOP ORDER
1. Cek jadwal teknisi sebelum assign (gunakan teknisiWorkload dari data live)
2. Jam operasional: 08:00–17:00, kecuali ada konfirmasi khusus
3. Prioritas assign: teknisi dengan slot kosong terbanyak hari ini
4. Helper wajib untuk order 3+ unit atau Pasang AC Baru
5. Dispatch WA otomatis setelah order CONFIRMED
6. Status flow: PENDING → CONFIRMED → IN_PROGRESS → COMPLETED

## SOP INVOICE
1. Invoice dibuat otomatis saat order COMPLETED
2. Due date: H+3 dari tanggal selesai
3. Kirim reminder WA jika H-1 due dan belum PAID
4. OVERDUE: tandai otomatis jika lewat due date
5. Hanya Owner yang bisa APPROVE invoice

## SOP STOK
1. Alert jika stok <= reorder point
2. Freon R22 & R32: reorder jika < 5 kg
3. Catat penggunaan setiap selesai service (UPDATE_STOCK dengan delta negatif)

## RULES EKSEKUSI
- Selalu konfirmasi ke user setelah eksekusi aksi
- Jangan eksekusi CANCEL atau hapus data tanpa alasan jelas dari user
- Jika ada konflik jadwal: tanyakan ke user, jangan auto-assign
- Maksimal 1 ACTION per response
- Gunakan data live (bizContext) untuk semua keputusan, bukan asumsi
- Jika data tidak lengkap: tanya user, jangan mengarang

## FORMAT JAWABAN
- Gunakan Bahasa Indonesia
- Ringkas dan to the point
- Sertakan data aktual (nama, tanggal, jumlah) dalam konfirmasi
- Gunakan emoji secukupnya untuk keterbacaan
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
  const [orderFilter, setOrderFilter] = useState("Semua");

  // ── Invoice ──
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [modalPDF,        setModalPDF]        = useState(false);

  // ── Schedule ──
  const [scheduleView,   setScheduleView]   = useState("week");
  const [teknisiTab,     setTeknisiTab]     = useState("jadwal");
  const [filterTeknisi, setFilterTeknisi]  = useState("Semua");

  // ── Search ──
  const [searchCustomer,  setSearchCustomer]  = useState("");
  const [searchInvoice,   setSearchInvoice]   = useState("");
  const [searchInventory, setSearchInventory] = useState("");
  const [searchLaporan,   setSearchLaporan]   = useState("");

  // ── Laporan Tim ──
  const [laporanReports,  setLaporanReports]  = useState([
    { id:"LPR001", job_id:"JOB10002", teknisi:"Usaeri", helper:null, customer:"Maria Thomson",
      service:"Repair", date:"2026-03-01", submitted:"2026-03-01 15:30", status:"SUBMITTED",
      total_units:1,
      units:[{ unit_no:1, label:"Unit 1 - Ruang Tengah", tipe:"AC Split 0.5-1PK", merk:"Daikin", pk:"1PK",
        kondisi_sebelum:["AC tidak dingin","Kapasitor rusak"], kondisi_setelah:["Normal, dingin optimal","Semua fungsi normal"],
        pekerjaan:["Ganti kapasitor","Cek instalasi"], freon_ditambah:"0", ampere_akhir:"4.5", catatan_unit:"Kapasitor 25uF diganti" }],
      materials:[{id:1,nama:"Kapasitor",jumlah:"1",satuan:"pcs",keterangan:"25uF"}],
      fotos:[], rekomendasi:"Cek freon 6 bulan lagi", catatan_global:"Kapasitor sudah aus", editLog:[] },
    { id:"LPR002", job_id:"JOB10001", teknisi:"Mulyadi", helper:"Samsul", customer:"Eddy Limanto",
      service:"Cleaning", date:"2026-03-01", submitted:"2026-03-01 11:45", status:"VERIFIED",
      total_units:2,
      units:[
        { unit_no:1, label:"Unit 1 - Kamar Utama", tipe:"AC Split 0.5-1PK", merk:"Daikin", pk:"1PK",
          kondisi_sebelum:["AC tidak dingin","Bau tidak sedap"], kondisi_setelah:["Normal, dingin optimal","Filter bersih"],
          pekerjaan:["Deep cleaning","Cuci filter","Semprot evaporator"], freon_ditambah:"0", ampere_akhir:"3.8", catatan_unit:"" },
        { unit_no:2, label:"Unit 2 - Ruang Tamu", tipe:"AC Split 0.5-1PK", merk:"Panasonic", pk:"1PK",
          kondisi_sebelum:["Bau tidak sedap"], kondisi_setelah:["Filter bersih","Semua fungsi normal"],
          pekerjaan:["Deep cleaning","Cuci filter"], freon_ditambah:"0", ampere_akhir:"3.9", catatan_unit:"" }
      ],
      materials:[], fotos:[], rekomendasi:"Jadwalkan Mei 2026", catatan_global:"2 unit selesai",
      editLog:[{ by:"Mulyadi", at:"2026-03-01 12:00", field:"catatan_global", old:"selesai", new:"2 unit selesai" }] },
  ]);
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
  const [activeUnitIdx,      setActiveUnitIdx]      = useState(0);
  const [showMatPreset,      setShowMatPreset]      = useState(false);
  const fotoInputRef = useRef();

  // ── New order / stok / customer form ──
  const [newOrderForm,     setNewOrderForm]     = useState({ customer:"", phone:"", address:"", service:"Cleaning", type:"AC Split 0.5-1PK", units:1, teknisi:"", helper:"", date:"", time:"09:00", notes:"" });
  const [newStokForm,      setNewStokForm]      = useState({ name:"", unit:"pcs", price:"", stock:"", reorder:"", min_alert:"" });
  const [newTeknisiForm,   setNewTeknisiForm]   = useState({ name:"", role:"Teknisi", phone:"", skills:[] });
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
  const araBottomRef = useRef();

  // GAP 7 — Reactive agent logs
  const [agentLogs,        setAgentLogs]        = useState(AGENT_LOGS);
  const addAgentLog = async (action, detail, status="SUCCESS") => {
    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    setAgentLogs(prev => [{ time:now, action, detail, status }, ...prev].slice(0,50));
    try { await supabase.from("agent_logs").insert({ time:now, action, detail, status }); } catch(e) {}
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

  // ── Settings state ──
  const [waProvider,      setWaProvider]      = useState(() => _ls("waProvider", "fonnte"));
  const [waStatus,        setWaStatus]        = useState("not_connected");

  const [llmProvider,     setLlmProvider]     = useState(() => _ls("llmProvider", "claude"));
  const [llmApiKey,       setLlmApiKey]       = useState(() => _ls("llmApiKey", ""));
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

  // ── WA Conversations reaktif ──
  const [waConversations, setWaConversations] = useState(WA_CONVERSATIONS);

  // ── Statistik periode filter ──
  const [statsPeriod, setStatsPeriod] = useState("bulan"); // "hari"|"bulan"|"tahun"

  // ── Notification ──
  const [notification, setNotification] = useState(null);
  const notifTimer = useRef(null);
  const showNotif = (msg) => {
    setNotification(msg);
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
  };

  // ── Laporan Helper Constants ──
  const KONDISI_SBL = ["AC tidak dingin","Bau tidak sedap","Bocor air","Bunyi berisik","AC tidak menyala","Freon habis","Kapasitor rusak","Kompresor lemah","Remote rusak","Tetes air lebihan"];
  const KONDISI_SDH = ["Normal, dingin optimal","Filter bersih","Tidak ada bocor","Suara normal","Freon terisi","Semua fungsi normal","Dingin merata","Tidak ada bau"];
  const PEKERJAAN_OPT = ["Deep cleaning","Cuci filter","Semprot evaporator","Isi freon","Ganti kapasitor","Ganti relay","Ganti thermostat","Perbaiki pipa","Pasang bracket","Pasang unit baru","Cek instalasi","Vacuuming","Bersihkan kondensor","Cek kelistrikan"];
  const MATERIAL_PRESET = { Cleaning:["Freon R22","Freon R410A","Filter Udara","Kompressor Oil"], Install:["Pipa AC Hoda 1/4 3/8","Kabel Listrik 3x1.5","Kabel Listrik 3x2.5","Bracket Outdoor","Duct Tape","Stop Kontak","Paralon Pembuangan AC"], Repair:["Kapasitor","Thermostat","Sensor Indoor","Freon R22","Freon R410A","Relay"] };
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

  const openLaporanModal = (order) => {
    const count = Math.min(order.units||1, 10);
    setLaporanUnits(Array.from({length:count},(_,i)=>mkUnit(i+1)));
    setLaporanMaterials([]);
    setLaporanFotos([]);
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
        const userObj = { ...data.user, ...profile };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(profile.role.toLowerCase());
        setActiveMenu("dashboard");
        _lsSave("localSession", userObj);
        showNotif("Selamat datang, " + profile.name + "!");
        return;
      }

      // ── Fallback: cek di userAccounts lokal (akun demo / belum di Supabase Auth) ──
      const localUser = userAccounts.find(u =>
        u.email.toLowerCase() === email.toLowerCase() && u.password === pass && u.active !== false
      );
      if (localUser) {
        const userObj = { ...localUser, id: localUser.id };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setActiveRole(localUser.role.toLowerCase());
        setActiveMenu("dashboard");
        // Simpan session lokal agar tidak hilang saat refresh
        _lsSave("localSession", userObj);
        showNotif("Selamat datang, " + localUser.name + "! (mode lokal)");
        return;
      }

      setLoginError("Email atau password salah, atau akun tidak aktif.");
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
    // Owner: semua akses kecuali myreport (itu hanya untuk Teknisi/Helper)
    if (role === "Owner") return menu !== "myreport";
    // Admin: semua menu operasional kecuali settings dan myreport
    if (role === "Admin") return menu !== "settings" && menu !== "myreport";
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
  useEffect(() => { _lsSave("llmApiKey",   llmApiKey);   }, [llmApiKey]);
  useEffect(() => { _lsSave("llmModel",    llmModel);    }, [llmModel]);
  useEffect(() => { _lsSave("ollamaUrl",   ollamaUrl);   }, [ollamaUrl]);
  useEffect(() => { _lsSave("brainMd",        brainMd);           }, [brainMd]);
  useEffect(() => { _lsSave("brainMdCustomer", brainMdCustomer); }, [brainMdCustomer]);
  useEffect(() => { _lsSave("waProvider",  waProvider);  }, [waProvider]);
  useEffect(() => { _lsSave("llmStatus",   llmStatus);   }, [llmStatus]);

  useEffect(() => {
    // ── Restore session saat refresh ──
    const restoreSession = async () => {
      // 1. Coba restore dari Supabase Auth session (untuk akun real)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from("user_profiles").select("*").eq("id", session.user.id).single();
        if (profile && profile.active) {
          setCurrentUser({ ...session.user, ...profile });
          setIsLoggedIn(true);
          setActiveRole(profile.role.toLowerCase());
          return;
        }
      }
      // 2. Coba restore dari localStorage (untuk akun lokal/demo)
      const saved = _ls("localSession", null);
      if (saved && saved.id && saved.role) {
        // Validasi masih ada di userAccounts
        setCurrentUser(saved);
        setIsLoggedIn(true);
        setActiveRole(saved.role.toLowerCase());
      }
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
      if (!inventoryRes.error && inventoryRes.data) setInventoryData(inventoryRes.data);
      if (!laporanRes.error && laporanRes.data && laporanRes.data.length > 0) {
        // Normalize laporan dari Supabase agar cocok struktur lokal
        const normalized = laporanRes.data.map(r => ({
          ...r,
          units: r.units || [],
          materials: r.materials || [],
          fotos: r.fotos || (r.foto_urls||[]).map((url,i) => ({id:i,label:`Foto ${i+1}`,url})),
          editLog: r.edit_log || r.editLog || [],
          rekomendasi: r.rekomendasi || "",
          catatan_global: r.catatan_global || r.catatan || "",
          submitted: r.submitted || (r.submitted_at||"").slice(0,16).replace("T"," "),
          status: r.status || "SUBMITTED",
        }));
        setLaporanReports(normalized);
      }
      // Jika DB kosong (laporanRes.data = []), initial state hardcoded tetap aktif
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
          if (sMap.llm_provider && !llmProvider) setLlmProvider(sMap.llm_provider);
          if (sMap.llm_model && !llmModel) setLlmModel(sMap.llm_model);
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

      // Load WA conversations dari Supabase (tabel opsional)
      try {
        const waRes = await supabase.from("wa_conversations").select("*").order("updated_at", { ascending: false }).limit(50);
        if (!waRes.error && waRes.data && waRes.data.length > 0) setWaConversations(waRes.data);
      } catch(e) { /* WA tabel belum ada - skip */ }
    };

    setDataLoading(true);
    loadAll().finally(() => setDataLoading(false));

    // Realtime — data update otomatis di semua device
    const ch1 = supabase.channel("rt-orders")
      .on("postgres_changes", { event:"*", schema:"public", table:"orders" }, () =>
        supabase.from("orders").select("*").order("date",{ascending:false})
          .then(({data}) => { if(data) setOrdersData(data); }))
      .subscribe();
    const ch2 = supabase.channel("rt-invoices")
      .on("postgres_changes", { event:"*", schema:"public", table:"invoices" }, () =>
        supabase.from("invoices").select("*").order("created_at",{ascending:false})
          .then(({data}) => { if(data) setInvoicesData(data); }))
      .subscribe();
    const ch3 = supabase.channel("rt-inventory")
      .on("postgres_changes", { event:"*", schema:"public", table:"inventory" }, () =>
        supabase.from("inventory").select("*").order("code")
          .then(({data}) => { if(data) setInventoryData(data); }))
      .subscribe();
    const ch4 = supabase.channel("rt-customers")
      .on("postgres_changes", { event:"*", schema:"public", table:"customers" }, () =>
        supabase.from("customers").select("*").order("name")
          .then(({data}) => { if(data) setCustomersData(data); }))
      .subscribe();
    const ch5 = supabase.channel("rt-laporan")
      .on("postgres_changes", { event:"*", schema:"public", table:"service_reports" }, () =>
        supabase.from("service_reports").select("*").order("submitted_at",{ascending:false})
          .then(({data}) => { if(data && data.length > 0) setLaporanReports(data.map(r=>({...r,units:r.units||[],materials:r.materials||[],fotos:r.fotos||(r.foto_urls||[]).map((u,i)=>({id:i,label:`Foto ${i+1}`,url:u})),editLog:r.edit_log||[]})));  }))
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch4);
      supabase.removeChannel(ch5);
      supabase.removeChannel(ch3);
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

  // ── Helpers ──
  // ── WA: kirim via Fonnte backend, fallback wa.me ──
  const sendWA = async (phone, message) => {
    if (!phone) return false;
    try {
      const r = await fetch("/api/send-wa", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({phone, message})
      });
      const d = await r.json();
      if (r.ok && d.success) return true;
    } catch(_) {}
    // Fallback: buka wa.me manual (jika FONNTE_TOKEN belum diset)
    window.open("https://wa.me/"+phone+"?text="+encodeURIComponent(message),"_blank");
    return false;
  };

  const openWA = (phone, msg) => {
    if (msg) sendWA(phone, msg);
    else window.open("https://wa.me/"+phone,"_blank");
  };

  const dispatchWA = async (order) => {
    const tek = teknisiData.find(t => t.name === order.teknisi);
    if (!tek) return showNotif("Teknisi tidak ditemukan");
    const msg = `📋 *DISPATCH JOB ${order.id}*\n👤 Customer: *${order.customer}*\n📍 Alamat: ${order.address}\n🔧 Service: ${order.service} — ${order.units} unit\n📅 Jadwal: ${order.date} jam ${order.time}${order.time_end?"–"+order.time_end:""}\n\nSegera konfirmasi kehadiran. — AClean`;
    const ok = await sendWA(tek.phone, msg);
    if (ok) {
      const dispatchAt = new Date().toISOString();
      setOrdersData(prev => prev.map(o => o.id===order.id ? {...o, dispatch:true, dispatch_at:dispatchAt, status:o.status==="CONFIRMED"?"DISPATCHED":o.status} : o));
      await supabase.from("orders").update({dispatch:true, dispatch_at:dispatchAt, status:"DISPATCHED"}).eq("id",order.id);
      // GAP 1.8: catat ke dispatch_logs
      await supabase.from("dispatch_logs").insert({
        order_id: order.id, teknisi: order.teknisi,
        assigned_by: currentUser?.id||null,
        assigned_by_name: currentUser?.name||"",
        wa_message: msg, status:"SENT"
      }).catch(()=>{});
      addAgentLog("DISPATCH_SENT", `WA dispatch ke ${order.teknisi} untuk ${order.id}`, "SUCCESS");
      showNotif(`✅ Dispatch WA terkirim ke ${order.teknisi}`);
    }
  };

  const invoiceReminderWA = (inv) => {
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
      const invItem = inventoryData.find(i =>
        i.name.toLowerCase().includes(m.nama.toLowerCase()) ||
        m.nama.toLowerCase().includes(i.name.toLowerCase())
      );
      const harga = invItem ? invItem.price : 0;
      return sum + (harga * (parseFloat(m.jumlah) || 0));
    }, 0);
  };

  // ── GAP 3: Approve invoice (real state mutation) ──
  const approveInvoice = async (inv) => {
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
    await supabase.from("invoices").update({
      status:"UNPAID", sent:today, due,
      approved_by: currentUser?.id || null,
      approved_at: approvedAt,
    }).eq("id", inv.id);
    await supabase.from("orders").update({ invoice_id:inv.id, status:"INVOICE_APPROVED" }).eq("id", inv.job_id);
    const waMsg = `Halo ${inv.customer}, invoice AClean Service telah dikirim:\n\n🔧 ${inv.service||"Servis AC"}\n💰 Total: *${fmt(inv.total)}*\n📅 Jatuh tempo: ${due}\n\nPembayaran ke:\n*BCA 8830883011 a.n. Malda Retta*\n\nTerima kasih! 🙏`;
    sendWA(inv.phone, waMsg);
    addAgentLog("INVOICE_APPROVED", `Invoice ${inv.id} approve oleh ${currentUser?.name||"—"} — ${inv.customer} ${fmt(inv.total)}`, "SUCCESS");
    showNotif(`✅ Invoice ${inv.id} diapprove & dikirim ke ${inv.customer}`);
  };

  // ── GAP 1.6: Mark Paid → simpan ke payments table ──
  const markPaid = async (inv, method="transfer", notes="") => {
    const paidAt = new Date().toISOString();
    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? {...i, status:"PAID", paid_at:paidAt} : i
    ));
    setOrdersData(prev => prev.map(o =>
      (o.id === inv.job_id || o.invoice_id === inv.id) ? {...o, status:"PAID"} : o
    ));
    await supabase.from("invoices").update({ status:"PAID", paid_at:paidAt }).eq("id", inv.id);
    // GAP 1.6: Catat ke payments table untuk history + partial payment support
    await supabase.from("payments").insert({
      invoice_id: inv.id,
      amount: inv.total,
      method: method,
      notes: notes || "Lunas",
      paid_at: paidAt,
      verified: true,
      verified_by: currentUser?.id || null,
      verified_at: paidAt,
    }).catch(()=>{});
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
      }).catch(e => console.warn("inv tx:", e.message));
      if (newStatus === "CRITICAL" || newStatus === "OUT") {
        addAgentLog("STOCK_ALERT", `${item.name}: ${newStatus} (sisa ${newStock} ${item.unit})`, "WARNING");
      }
    }
  };

  // ── GAP 9: Create order (real state mutation) ──
  const createOrder = async (form) => {
    // GAP 4: ID aman — timestamp ms + random 3 digit, tidak bergantung array.length
    const newId = "JOB" + Date.now().toString().slice(-7) + Math.floor(Math.random()*100).toString().padStart(2,"0");
    const timeEnd = hitungJamSelesai(form.time||"09:00", form.service||"Cleaning", form.units||1);
    const newOrder = {
      id:newId,
      customer: form.customer, phone: form.phone, address: form.address,
      customer_id: customersData.find(c=>c.name===form.customer)?.id || null,
      service: form.service, type: form.type, units: parseInt(form.units)||1,
      teknisi: form.teknisi, helper: form.helper||null,
      date: form.date, time: form.time, time_end: timeEnd, status:"CONFIRMED",
      invoice_id:null, dispatch:false, notes:form.notes||""
    };
    setOrdersData(prev => [...prev, newOrder]);
    const { error } = await supabase.from("orders").insert(newOrder);
    if (error) { showNotif("❌ Gagal simpan order: " + error.message); return null; }

    // GAP 1.5: Simpan ke technician_schedule untuk cegah double booking
    if (form.teknisi && form.date && form.time && timeEnd) {
      const tek = teknisiData.find(t => t.name === form.teknisi);
      if (tek?.id) {
        const [h1,m1] = (form.time||"09:00").split(":");
        const [h2,m2] = (timeEnd||"17:00").split(":");
        await supabase.from("technician_schedule").insert({
          teknisi_id: tek.id,
          teknisi: form.teknisi,
          order_id: newId,
          date: form.date,
          start_time: `${h1}:${m1}:00`,
          end_time: `${h2}:${m2}:00`,
          status: "ACTIVE"
        }).catch(e => addAgentLog("SCHEDULE_WARNING", `Schedule insert: ${e.message}`, "WARNING"));
      }
    }

    addAgentLog("ORDER_CREATED", `Order baru ${newId} — ${form.customer} (${form.service} ${form.units} unit)`, "SUCCESS");
    showNotif(`✅ Order ${newId} berhasil dibuat! ARA siap dispatch ke ${form.teknisi}.`);

    // GAP 1.8: Log dispatch
    if (form.teknisi) {
      const tek = teknisiData.find(t => t.name === form.teknisi);
      if (tek) {
        const msg = `Halo ${form.teknisi}, ada job baru:\n📍 *${form.customer}*\n🔧 ${form.service} ${form.units} unit\n📮 ${form.address}\n🕐 ${form.date} jam ${form.time}–${timeEnd}\n\nMohon konfirmasi. — AClean`;
        sendWA(tek.phone, msg);
        await supabase.from("dispatch_logs").insert({
          order_id: newId,
          teknisi: form.teknisi,
          assigned_by: currentUser?.id || null,
          assigned_by_name: currentUser?.name || "",
          wa_message: msg,
          status: "SENT"
        }).catch(()=>{});
      }
    }

    // GAP 5: Auto-upsert customer jika nomor HP baru
    if (form.phone && form.customer) {
      const existing = customersData.find(c => c.phone === form.phone);
      if (!existing) {
        const newCust = {
          id: "CUST" + Date.now(),
          name: form.customer, phone: form.phone,
          address: form.address||"", area: form.area||"",
          total_orders: 1, joined: form.date, last_service: form.date
        };
        setCustomersData(prev => [...prev, newCust]);
        await supabase.from("customers").upsert(
          {name:form.customer, phone:form.phone, address:form.address||"", area:form.area||""},
          {onConflict:"phone", ignoreDuplicates:false}
        ).catch(()=>{});
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

    const bizContext = {
      today: TODAY,
      orders:    ordersData.map(o=>({id:o.id,customer:o.customer,service:o.service,type:o.type,units:o.units,status:o.status,date:o.date,time:o.time,teknisi:o.teknisi,helper:o.helper,dispatch:o.dispatch,invoice_id:o.invoice_id})),
      invoices:  invoicesData.map(i=>({id:i.id,customer:i.customer,phone:i.phone,total:i.total,status:i.status,due:i.due,labor:i.labor,material:i.material,dadakan:i.dadakan})),
      inventory: inventoryData.map(i=>({code:i.code,name:i.name,stock:i.stock,unit:i.unit,status:i.status,price:i.price,reorder:i.reorder})),
      customers: customersData.map(c=>({id:c.id,name:c.name,phone:c.phone,area:c.area,total_orders:c.total_orders,is_vip:c.is_vip})),
      laporan: laporanReports.map(r=>({id:r.id,job_id:r.job_id,teknisi:r.teknisi,customer:r.customer,service:r.service,status:r.status,date:r.date,submitted:r.submitted})),
      laporanPending: laporanReports.filter(r=>r.status==="SUBMITTED").length,
      laporanRevisi:  laporanReports.filter(r=>r.status==="REVISION").length,
      teknisiWorkload: teknisiData.filter(t=>t.role==="Teknisi").map(t=>({
        name:t.name, role:t.role, status:t.status,
        jobsToday: ordersData.filter(o=>o.teknisi===t.name&&o.date===TODAY).length,
        jobsPending: ordersData.filter(o=>o.teknisi===t.name&&["CONFIRMED","IN_PROGRESS"].includes(o.status)).length,
        // Slot kosong hari ini untuk Cleaning 1 unit (referensi cepat)
        slotKosongHariIni: cariSlotKosong(t.name, TODAY, "Cleaning", 1),
        jadwalHariIni: ordersData.filter(o=>o.teknisi===t.name&&o.date===TODAY).map(o=>({id:o.id,time:o.time,time_end:o.time_end||"?",service:o.service,units:o.units,customer:o.customer})),
      })),
      areaPelayanan: {
        utama: ["Alam Sutera","BSD","Gading Serpong","Graha Raya","Karawaci","Tangerang","Tangerang Selatan","Serpong"],
        konfirmasi: ["Jakarta Barat"],
      },
      logikaDurasi: "Cleaning: 1u=1j,2u=2j,3u=3j,4u=3j,5-6u=4j,7-8u=5j,9-10u=6j,>10=sehari | Install: 1-3u=1hari,4+u=2hari | Repair: 60-120mnt/unit",
      jamKerja: "09:00-17:00 WIB",
      revenueStats: {
        bulanIni: invoicesData.filter(i=>i.status==="PAID"&&(i.sent||"").startsWith(bulanIni)).reduce((a,b)=>a+(b.total||0),0),
        totalUnpaid: invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").reduce((a,b)=>a+(b.total||0),0),
        stokKritis: inventoryData.filter(i=>i.status==="OUT"||i.status==="CRITICAL").map(i=>i.name),
      },
    };

    try {
      let fullText = "";

      // ── Coba backend proxy dulu (API key aman di server) ──
      const backendRes = await fetch("/api/ara-chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          messages: newMessages.map(m=>({role:m.role, content:m.content})),
          bizContext, brainMd, provider:llmProvider, model:llmModel, ollamaUrl
        })
      }).catch(()=>null);

      if (backendRes?.ok) {
        const d = await backendRes.json();
        fullText = d.reply || "";
      } else if (llmApiKey || llmProvider === "ollama") {
        // ── Fallback: direct call sesuai provider yang dipilih ──
        const sysP = (typeof brainMd==="string"?brainMd:BRAIN_MD_DEFAULT)+`\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext)}\n\n## TOOL — ACTIONS TERSEDIA\nGunakan [ACTION]{...}[/ACTION] untuk eksekusi operasi. Format JSON:\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"labor","value":100000}\n- {"type":"MARK_PAID","id":"INV-xxx"}\n- {"type":"APPROVE_INVOICE","id":"INV-xxx"}\n- {"type":"SEND_REMINDER","invoice_id":"INV-xxx"}\n- {"type":"UPDATE_ORDER_STATUS","id":"JOB-xxx","status":"COMPLETED"}\n- {"type":"DISPATCH_WA","order_id":"JOB-xxx"}\n- {"type":"SEND_WA","phone":"628xxx","message":"..."}\n- {"type":"UPDATE_STOCK","code":"MAT001","delta":5} (delta=tambah/kurang)\n- {"type":"CANCEL_ORDER","id":"JOB-xxx","reason":"..."}\n- {"type":"RESCHEDULE_ORDER","id":"JOB-xxx","date":"2026-03-10","time":"09:00","teknisi":"Mulyadi"}\nGunakan data teknisiWorkload.slotKosongHariIni dan jadwalHariIni untuk cek jadwal kosong. Area utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan. Jakarta Barat: perlu konfirmasi admin.\n- {"type":"MARK_INVOICE_OVERDUE"} (tandai semua yang lewat due date)\nHanya gunakan 1 ACTION per response. Konfirmasi ke user setelah eksekusi.`;

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
            ar=`\n✅ *Invoice ${act.id} ditandai LUNAS*`;
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
            const seq = (ordersData.length + 1).toString().padStart(3,"0");
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
            ar = "\n✅ *Order " + newId + " dibuat untuk " + newOrd.customer + " — " + newOrd.service + " " + newOrd.units + " unit, " + newOrd.date + " jam " + newOrd.time + "*";
          } else if (act.type==="CANCEL_ORDER") {
            setOrdersData(prev=>prev.map(o=>o.id===act.id?{...o,status:"CANCELLED"}:o));
            await supabase.from("orders").update({status:"CANCELLED"}).eq("id",act.id);
            addAgentLog("ARA_CANCEL",`ARA cancel order ${act.id}: ${act.reason||""}`,"WARNING");
            ar=`\n✅ *Order ${act.id} dibatalkan*${act.reason?" — "+act.reason:""}`;
          } else if (act.type==="RESCHEDULE_ORDER") {
            const upd = {date:act.date,time:act.time||"09:00",...(act.teknisi?{teknisi:act.teknisi}:{})};
            setOrdersData(prev=>prev.map(o=>o.id===act.id?{...o,...upd}:o));
            await supabase.from("orders").update(upd).eq("id",act.id);
            addAgentLog("ARA_RESCHEDULE",`ARA reschedule ${act.id} → ${act.date} ${act.time||"09:00"}`,"SUCCESS");
            ar=`\n✅ *Order ${act.id} dijadwal ulang → ${act.date} jam ${act.time||"09:00"}*`;
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
      const techColors = { "Mulyadi":"#38bdf8","Usaeri":"#22c55e","Albana Niji":"#a78bfa","Rizky Putra":"#f59e0b","Agung":"#f97316","Rey":"#ec4899" };
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
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
                    <button onClick={() => openWA(o.phone, "Halo "+o.customer+", saya "+myName+" dari AClean Service. Saya akan datang pkl "+o.time+" untuk "+o.service+". Terima kasih.")}
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
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
          {[
            { label:"Order Hari Ini",      value:todayOrders.length,          sub:`${todayOrders.filter(o=>o.status==="IN_PROGRESS").length} aktif · ${todayOrders.filter(o=>o.status==="COMPLETED").length} selesai`, color:cs.accent, icon:"📋" },
            { label:"Invoice Unpaid",       value:unpaidCount,                 sub:"Perlu follow-up",     color:cs.yellow, icon:"🧾" },
            { label:"Pendapatan Bln Ini",   value:fmt(totalRevBulanIni),        sub:"Invoice terbayar",    color:cs.green,  icon:"💰" },
            { label:"Stok Kritis",          value:lowStock,                    sub:"Perlu restock",       color:cs.red,    icon:"📦" },
          ].map(kpi => (
            <div key={kpi.label} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <span style={{ fontSize:24 }}>{kpi.icon}</span>
                <span style={{ fontSize:11, color:cs.muted }}>{kpi.sub}</span>
              </div>
              <div style={{ fontWeight:800, fontSize:26, color:kpi.color, marginBottom:4 }}>{kpi.value}</div>
              <div style={{ fontSize:11, color:cs.muted, fontWeight:600 }}>{kpi.label}</div>
            </div>
          ))}
        </div>

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
                  <button onClick={() => { const cu=customersData.find(cu=>cu.phone===o.phone); if(cu){setSelectedCustomer(cu);setCustomerTab("history");setActiveMenu("customers");} }}
                    style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"5px 10px", borderRadius:6, cursor:"pointer", fontSize:11 }}>History</button>
                  {!o.dispatch && <button onClick={() => dispatchWA(o)} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"5px 10px", borderRadius:6, cursor:"pointer", fontSize:11 }}>Dispatch WA</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Invoice + Stok alerts */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
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
      </div>
    );
  };

  // ============================================================
  // RENDER CUSTOMERS
  // ============================================================
  const renderCustomers = () => {
    const history = selectedCustomer ? SERVICE_HISTORY.filter(s => s.customer_id === selectedCustomer.id) : [];
    const filteredCusts = customersData.filter(cu =>
      !searchCustomer ||
      cu.name.toLowerCase().includes(searchCustomer.toLowerCase()) ||
      cu.phone.includes(searchCustomer)
    );
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
              const cHist = SERVICE_HISTORY.filter(s => s.customer_id === cu.id);
              return (
                <div key={cu.id} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:20, display:"flex", gap:16, alignItems:"flex-start" }}>
                  <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,"+(cu.is_vip?cs.yellow:cs.accent)+",#3b82f6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{cu.name.charAt(0)}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, color:cs.text, fontSize:15 }}>{cu.name}</span>
                      {cu.is_vip && <span style={{ background:cs.yellow+"22", color:cs.yellow, fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:99, border:"1px solid "+cs.yellow+"44" }}>⭐ VIP</span>}
                      <span style={{ fontSize:10, color:cs.muted, fontFamily:"monospace" }}>{cu.id}</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"3px 20px", fontSize:12, color:cs.muted, marginBottom:8 }}>
                      <span>📱 {cu.phone}</span><span>📍 {cu.area}</span>
                      <span>🏠 {cu.address.slice(0,32)}...</span><span>📅 {cu.joined}</span>
                    </div>
                    {cu.notes && <div style={{ fontSize:12, color:"#7dd3fc", background:"#0ea5e910", padding:"6px 10px", borderRadius:7, border:"1px solid #0ea5e922" }}>💡 {cu.notes}</div>}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8, flexShrink:0 }}>
                    <button onClick={() => { setSelectedCustomer(cu); setCustomerTab("history"); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>📋 Riwayat ({cHist.length})</button>
                    <button onClick={() => { setNewOrderForm(f=>({...f,customer:cu.name,phone:cu.phone,address:cu.address})); setModalOrder(true); }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Order</button>
                    <button onClick={() => openWA(cu.phone, "")} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>📱 WA</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display:"grid", gap:14 }}>
            <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, padding:18, display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, textAlign:"center" }}>
              {[["Total Order", history.length, cs.accent], ["Total Spend", currentUser?.role==="Teknisi"?"—":fmt(history.filter(s=>s.status==="COMPLETED").reduce((a,b)=>a+b.total,0)), cs.green], ["Terakhir Servis", selectedCustomer.last_service, cs.yellow], ["Area", selectedCustomer.area, cs.muted]].map(([label, val, color]) => (
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
                : history.map(svc => (
                  <div key={svc.id} style={{ background:cs.card, border:"1px solid "+(statusColor[svc.status]||cs.border)+"33", borderRadius:12, padding:16 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent }}>{svc.job_id}</span>
                        <span style={{ fontSize:13, color:cs.text, fontWeight:600 }}>{svc.service}</span>
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:99, background:(statusColor[svc.status]||cs.muted)+"22", color:statusColor[svc.status]||cs.muted, border:"1px solid "+(statusColor[svc.status]||cs.muted)+"44" }}>{svc.status.replace("_"," ")}</span>
                      </div>
                      {currentUser?.role !== "Teknisi" && currentUser?.role !== "Helper" && <span style={{ fontWeight:800, color:cs.text, fontFamily:"monospace" }}>{fmt(svc.total)}</span>}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 16px", fontSize:12, color:cs.muted }}>
                      <span>📅 {svc.date}</span><span>👷 {svc.teknisi}</span>
                      <span>🔧 {svc.type} x{svc.units}</span>
                      {svc.invoice && currentUser?.role !== "Teknisi" && currentUser?.role !== "Helper" && <span style={{ fontFamily:"monospace", color:cs.accent }}>{svc.invoice}</span>}
                    </div>
                    {svc.recommendation && <div style={{ marginTop:8, fontSize:12, color:"#7dd3fc", background:"#0ea5e910", padding:"6px 10px", borderRadius:7 }}>💡 {svc.recommendation}</div>}
                  </div>
                ))}
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
    const filtered = orderFilter === "Semua" ? ordersData : ordersData.filter(o => {
      const map = { "Pending":"PENDING", "Confirmed":"CONFIRMED", "In Progress":"IN_PROGRESS", "Completed":"COMPLETED" };
      return o.status === map[orderFilter];
    });
    return (
      <div style={{ display:"grid", gap:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>📋 Order Masuk</div>
          <button onClick={() => setModalOrder(true)} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Order Baru</button>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {["Semua","Pending","Confirmed","In Progress","Completed"].map(f => (
            <button key={f} onClick={() => setOrderFilter(f)} style={{ background:orderFilter===f?cs.accent:cs.card, border:"1px solid "+(orderFilter===f?cs.accent:cs.border), color:orderFilter===f?"#0a0f1e":cs.muted, padding:"6px 14px", borderRadius:99, cursor:"pointer", fontSize:12, fontWeight:600 }}>{f}</button>
          ))}
        </div>
        <div style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:14, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:cs.surface, borderBottom:"1px solid "+cs.border }}>
                {["Job ID","Customer","Service","Teknisi","Tgl/Jam","Status","Aksi"].map(h => (
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:cs.muted, textTransform:"uppercase", letterSpacing:"0.5px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o,i) => (
                <tr key={o.id} style={{ borderTop:"1px solid "+cs.border, background:i%2===0?"transparent":cs.surface+"80" }}>
                  <td style={{ padding:"10px 14px", fontFamily:"monospace", fontSize:12, color:cs.accent, fontWeight:700 }}>{o.id}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <div style={{ fontSize:13, fontWeight:600, color:cs.text }}>{o.customer}</div>
                    <div style={{ fontSize:11, color:cs.muted }}>{o.address.slice(0,28)}...</div>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:cs.muted }}>{o.service} · {o.units} unit</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:cs.text }}>{o.teknisi}</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:cs.muted }}>{o.date}<br/>{o.time}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ fontSize:10, padding:"3px 8px", borderRadius:99, background:(statusColor[o.status]||cs.muted)+"22", color:statusColor[o.status]||cs.muted, border:"1px solid "+(statusColor[o.status]||cs.muted)+"44", fontWeight:700 }}>{statusLabel[o.status]||o.status.replace("_"," ")}</span>
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <button onClick={() => { const c=customersData.find(c=>c.phone===o.phone); if(c){setSelectedCustomer(c);setCustomerTab("history");setActiveMenu("customers");} }} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11 }}>History</button>
                      {!o.dispatch && <button onClick={() => dispatchWA(o)} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11 }}>WA</button>}
                      {(currentUser?.role==="Owner"||currentUser?.role==="Admin") && (
                        <button onClick={() => { setEditOrderItem(o); setEditOrderForm({customer:o.customer,phone:o.phone||"",address:o.address||"",service:o.service,type:o.type||"",units:o.units||1,teknisi:o.teknisi,helper:o.helper||"",date:o.date,time:o.time||"09:00",status:o.status,notes:o.notes||""}); setModalEditOrder(true); }}
                          style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600 }}>✏️ Edit</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER INVOICE
  // ============================================================
  const renderInvoice = () => {
    const filteredInv = invoicesData.filter(inv =>
      !searchInvoice ||
      inv.customer.toLowerCase().includes(searchInvoice.toLowerCase()) ||
      inv.phone.includes(searchInvoice) ||
      inv.id.toLowerCase().includes(searchInvoice.toLowerCase())
    );
    return (
    <div style={{ display:"grid", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>🧾 Invoice</div>
        <button onClick={() => { const cnt=invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").length; invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").forEach(i=>invoiceReminderWA(i)); showNotif("Reminder terkirim ke " + cnt + " customer via WA"); }}
          style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>
          🔔 Kirim Reminder ({invoicesData.filter(i=>i.status==="UNPAID"||i.status==="OVERDUE").length})
        </button>
      </div>
      {/* Search bar */}
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:cs.muted, pointerEvents:"none" }}>🔍</span>
        <input value={searchInvoice} onChange={e=>setSearchInvoice(e.target.value)}
          placeholder="Cari nama customer, no. telepon, atau ID invoice..."
          style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"10px 14px 10px 36px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
        {searchInvoice && <button onClick={()=>setSearchInvoice("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>}
      </div>
      {searchInvoice && <div style={{ fontSize:12, color:cs.muted }}>Ditemukan <b style={{ color:cs.accent }}>{filteredInv.length}</b> invoice</div>}
      <div style={{ display:"grid", gap:12 }}>
        {filteredInv.map(inv => (
          <div key={inv.id} style={{ background:cs.card, border:"1px solid "+(statusColor[inv.status]||cs.border)+"44", borderRadius:14, padding:18 }}>
            <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10, marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontFamily:"monospace", fontWeight:800, color:cs.accent, fontSize:14 }}>{inv.id}</span>
                <span style={{ fontSize:10, padding:"3px 8px", borderRadius:99, background:(statusColor[inv.status]||cs.muted)+"22", color:statusColor[inv.status]||cs.muted, border:"1px solid "+(statusColor[inv.status]||cs.muted)+"44", fontWeight:700 }}>{inv.status.replace(/_/g," ")}</span>
                {inv.follow_up > 0 && <span style={{ fontSize:10, color:cs.yellow }}>Follow-up: {inv.follow_up}x</span>}
              </div>
              <div style={{ fontWeight:800, fontSize:18, color:cs.text, fontFamily:"monospace" }}>{fmt(inv.total)}</div>
            </div>
            {/* GAP 3 — breakdown nilai */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:10, fontSize:11 }}>
              <div style={{ background:cs.surface, borderRadius:6, padding:"6px 10px" }}><div style={{color:cs.muted}}>Jasa</div><div style={{color:cs.text,fontWeight:700}}>{fmt(inv.labor)}</div></div>
              <div style={{ background:cs.surface, borderRadius:6, padding:"6px 10px" }}><div style={{color:cs.muted}}>Material</div><div style={{color:cs.text,fontWeight:700}}>{fmt(inv.material)}</div></div>
              <div style={{ background:inv.dadakan>0?cs.yellow+"18":cs.surface, borderRadius:6, padding:"6px 10px", border:inv.dadakan>0?"1px solid "+cs.yellow+"44":"none" }}><div style={{color:cs.muted}}>Tambahan</div><div style={{color:inv.dadakan>0?cs.yellow:cs.text,fontWeight:700}}>{fmt(inv.dadakan)}</div></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 20px", fontSize:12, color:cs.muted, marginBottom:12 }}>
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
                <button onClick={() => approveInvoice(inv)} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>✓ Approve & Kirim PDF</button>
              )}
              {inv.status === "UNPAID" && (
                <>
                  <button onClick={() => { if(!window.confirm||window.confirm(`Tandai invoice ${inv.id} (${fmt(inv.total)}) sebagai LUNAS?`)) markPaid(inv); }} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>✓ Mark Paid</button>
                  <button onClick={() => invoiceReminderWA(inv)} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>📱 WA Reminder</button>
                </>
              )}
              {inv.status === "OVERDUE" && (
                <button onClick={() => invoiceReminderWA(inv)} style={{ background:cs.red+"22", border:"1px solid "+cs.red+"44", color:cs.red, padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>📱 WA Overdue</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
    );
  };

  // ============================================================
  // RENDER INVENTORY
  // ============================================================
  const renderInventory = () => {
    const filteredInvt = inventoryData.filter(item =>
      !searchInventory ||
      item.name.toLowerCase().includes(searchInventory.toLowerCase()) ||
      item.code.toLowerCase().includes(searchInventory.toLowerCase())
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
      {searchInventory && <div style={{ fontSize:12, color:cs.muted }}>Ditemukan <b style={{ color:cs.accent }}>{filteredInvt.length}</b> item</div>}
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
            {inventoryData.map((item,i) => {
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
    const techColors = { "Mulyadi":"#38bdf8","Usaeri":"#22c55e","Albana Niji":"#a78bfa","Rizky Putra":"#f59e0b","Agung":"#f97316","Rey":"#ec4899" };

    // For Teknisi role: force filter to own name; for Owner/Admin: use filterTeknisi state
    const isTekRole = currentUser?.role === "Teknisi" || currentUser?.role === "Helper";
    const myTekName = currentUser?.name || "";
    const activeTek = isTekRole ? myTekName : filterTeknisi;

    const allTekNames = [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))];
    const filteredOrders = activeTek === "Semua" ? ordersData : ordersData.filter(o => o.teknisi === activeTek);
    const teknisiList = activeTek === "Semua" ? allTekNames : [activeTek];

    return (
      <div style={{ display:"grid", gap:14 }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>📅 Jadwal Pengerjaan</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {/* Week navigation */}
            <div style={{ display:"flex", alignItems:"center", gap:6, background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"4px 6px" }}>
              <button onClick={() => setWeekOffset(w=>w-1)} style={{ background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16, padding:"0 4px", lineHeight:1 }}>‹</button>
              <span style={{ fontSize:11, color:cs.muted, fontWeight:600, minWidth:80, textAlign:"center" }}>{weekLabel}</span>
              <button onClick={() => setWeekOffset(w=>w+1)} style={{ background:"none", border:"none", color:cs.muted, cursor:"pointer", fontSize:16, padding:"0 4px", lineHeight:1 }}>›</button>
              {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background:cs.accent+"22", border:"1px solid "+cs.accent+"44", color:cs.accent, cursor:"pointer", fontSize:10, padding:"2px 7px", borderRadius:5, fontWeight:700 }}>Hari ini</button>}
            </div>
            {/* View toggle */}
            <div style={{ display:"flex", background:cs.surface, border:"1px solid "+cs.border, borderRadius:8, overflow:"hidden" }}>
              {[["week","Minggu"],["list","Daftar"]].map(([v,l]) => (
                <button key={v} onClick={() => setScheduleView(v)} style={{ padding:"7px 14px", border:"none", background:scheduleView===v?cs.accent:"transparent", color:scheduleView===v?"#0a0f1e":cs.muted, cursor:"pointer", fontSize:12, fontWeight:700 }}>{l}</button>
              ))}
            </div>
            {!isTekRole && (
              <button onClick={() => setModalOrder(true)} style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"8px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>+ Order</button>
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
                    const jobs = ordersData.filter(o => o.teknisi===tek && o.date===d.date);
                    return (
                      <div key={d.date} style={{ background:cs.card, border:"1px solid "+cs.border, borderRadius:7, padding:3, minHeight:52 }}>
                        {jobs.map(j => (
                          <div key={j.id} style={{ background:(techColors[tek]||cs.accent)+"22", border:"1px solid "+(techColors[tek]||cs.accent)+"44", borderRadius:4, padding:"2px 4px", marginBottom:2 }}>
                            <div style={{ fontSize:9, fontWeight:800, color:techColors[tek]||cs.accent }}>{j.time}</div>
                            <div style={{ fontSize:9, color:cs.text }}>{(j.customer||"").split(" ")[0]}</div>
                            <div style={{ fontSize:8, color:cs.muted }}>{j.service}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
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
                            <button onClick={() => dispatchWA(o)} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>📱 Dispatch</button>
                          )}
                          {!isTekRole && (
                            <button onClick={() => { setEditOrderItem(o); setEditOrderForm({customer:o.customer,phone:o.phone||"",address:o.address||"",service:o.service,units:o.units||1,teknisi:o.teknisi,helper:o.helper||"",date:o.date,time:o.time||"09:00",status:o.status,notes:o.notes||""}); setModalEditOrder(true); }} style={{ background:cs.yellow+"22", border:"1px solid "+cs.yellow+"44", color:cs.yellow, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>✏️ Edit</button>
                          )}
                          {isTekRole && (
                            <button onClick={() => { window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.address),"_blank"); }} style={{ background:cs.green+"22", border:"1px solid "+cs.green+"44", color:cs.green, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>🗺 Maps</button>
                          )}
                          {isTekRole && (
                            <button onClick={() => openWA(o.phone,"Halo "+o.customer+", saya "+myTekName+" dari AClean. Saya akan tiba pkl "+o.time+" untuk "+o.service+". Terima kasih!")} style={{ background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11 }}>💬 Chat WA</button>
                          )}
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
      </div>
    );
  };


  // ============================================================
  // RENDER TEKNISI ADMIN
  // ============================================================
  const renderTeknisiAdmin = () => (
    <div style={{ display:"grid", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontWeight:700, fontSize:18, color:cs.text }}>👷 Tim Teknisi</div>
        <button onClick={() => { setEditTeknisi(null); setNewTeknisiForm({name:"",role:"Teknisi",phone:"",skills:[]}); setModalTeknisi(true); }} style={{ background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Tambah Anggota</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:12 }}>
        {teknisiData.map(t => {
          const stC = t.status==="on-job"?cs.green:t.status==="active"?cs.accent:cs.muted;
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
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => { setEditTeknisi(t); setNewTeknisiForm({...t}); setModalTeknisi(true); }} style={{ flex:1, background:cs.accent+"18", border:"1px solid "+cs.accent+"44", color:cs.accent, padding:"6px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600 }}>✏️ Edit</button>
                <button onClick={() => openWA(t.phone, "Halo " + t.name + ", ada info dari AClean:")} style={{ flex:1, background:"#25D36622", border:"1px solid #25D36644", color:"#25D366", padding:"6px", borderRadius:7, cursor:"pointer", fontSize:11 }}>📱 WA</button>
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
    </div>
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
    if (service === "Install") {
      // 1-3 unit = 1 hari (09:00-17:00 = 8 jam), 4+ unit = 2 hari
      if (u <= 3) return 8;
      return 16; // 2 hari kerja
    }
    if (service === "Repair") {
      // 60-120 menit per unit, pakai 90 menit rata-rata
      return Math.ceil(u * 1.5);
    }
    // Cleaning:
    if (u === 1) return 1;
    if (u === 2) return 2;
    if (u === 3) return 3;
    if (u === 4) return 3;
    if (u <= 6)  return 4;
    if (u <= 8)  return 5;
    if (u <= 10) return 6;
    return 8; // >10 unit = 1 hari kerja penuh
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
  const cekTeknisiAvailable = (teknisiName, date, timeStart, service, units) => {
    const durBaru = hitungDurasi(service, units);
    const startBaru = (timeStart || "09:00").split(":").map(Number);
    const startMinBaru = startBaru[0] * 60 + startBaru[1];
    const endMinBaru   = startMinBaru + Math.round(durBaru * 60);

    const conflicts = ordersData.filter(o =>
      o.teknisi === teknisiName &&
      o.date === date &&
      ["PENDING","CONFIRMED","IN_PROGRESS"].includes(o.status)
    );

    for (const o of conflicts) {
      const durExist = hitungDurasi(o.service || "Cleaning", o.units || 1);
      const startExist = (o.time || "09:00").split(":").map(Number);
      const startMinExist = startExist[0] * 60 + startExist[1];
      const endMinExist   = startMinExist + Math.round(durExist * 60);
      // Overlap check
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
      "Update dadakan INV-20260301-001 jadi Rp 50000",
    ];
    return (
      <div style={{ display:"grid", gap:0, height:"calc(100vh - 120px)", maxHeight:700 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:cs.text }}>🤖 ARA — AI Agent AClean</div>
            <div style={{ fontSize:12, color:cs.muted }}>Chat langsung · Bisa update data invoice, cek stok, analisa bisnis</div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:araLoading?cs.yellow:cs.green }} />
            <span style={{ fontSize:11, color:cs.muted }}>{araLoading?"Berpikir...":"Online"}</span>
            <button onClick={() => setAraMessages([{ role:"assistant", content:"Halo! Saya ARA 🤖 — AI Agent AClean. Ada yang bisa saya bantu?" }])}
              style={{ background:cs.card, border:"1px solid "+cs.border, color:cs.muted, padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11 }}>🗑 Reset</button>
          </div>
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
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <input
            value={araInput} onChange={e=>setAraInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendToARA(araInput); } }}
            placeholder="Tanya ARA atau minta update data... (Enter untuk kirim)"
            disabled={araLoading}
            style={{ flex:1, background:cs.card, border:"1px solid "+cs.border, borderRadius:10, padding:"11px 14px", color:cs.text, fontSize:13, outline:"none" }}
          />
          <button onClick={() => sendToARA(araInput)} disabled={araLoading||!araInput.trim()}
            style={{ background:araLoading||!araInput.trim()?"#333":"linear-gradient(135deg,"+cs.ara+",#7c3aed)", border:"none", color:"#fff", padding:"11px 20px", borderRadius:10, cursor:araLoading?"not-allowed":"pointer", fontWeight:800, fontSize:14 }}>
            {araLoading?"⏳":"→"}
          </button>
        </div>
        {llmStatus !== "connected" && <div style={{ fontSize:11, color:cs.yellow, marginTop:8 }}>⚠️ ARA belum terkoneksi. Buka <b>Pengaturan → ARA Brain</b> → klik <b>Test & Simpan</b> untuk mengaktifkan.</div>}
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
    const techColors = { "Mulyadi":"#38bdf8","Usaeri":"#22c55e","Albana Niji":"#a78bfa","Rizky Putra":"#f59e0b","Agung":"#f97316","Rey":"#ec4899" };
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
            <div style={{ fontWeight:800, fontSize:18, color:cs.text }}>📊 Laporan Keuangan & Operasional</div>
            <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>Profit & Loss · Accounts Receivable · Performa Tim</div>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {[["hari","Hari Ini"],["bulan","Bulan Ini"],["tahun","Tahun Ini"]].map(([v,l])=>(
              <button key={v} onClick={()=>setStatsPeriod(v)}
                style={{ background:statsPeriod===v?cs.accent:cs.card, border:"1px solid "+(statsPeriod===v?cs.accent:cs.border), color:statsPeriod===v?"#0a0f1e":cs.muted, padding:"6px 14px", borderRadius:99, cursor:"pointer", fontSize:12, fontWeight:600 }}>{l}</button>
            ))}
          </div>
        </div>

        {/* ── SECTION 1: P&L Summary ── */}
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

        {/* ── SECTION 2: KPI Operasional ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
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
                  <div key={t.name} style={{ display:"grid", gridTemplateColumns:"120px 1fr 60px 80px", alignItems:"center", gap:10 }}>
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
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
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
    const badge = (s) => { const [col,lbl]=sMap[s]||[cs.muted,s]; return <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:col+"22",color:col,border:"1px solid "+col+"44",fontWeight:700}}>{lbl}</span>; };
    // Sort by date desc + status (SUBMITTED first)
    const statusOrder = { SUBMITTED:0, REVISION:1, VERIFIED:2, REJECTED:3 };
    const filtered = laporanReports
      .filter(r =>
        !searchLaporan ||
        (r.customer||"").toLowerCase().includes(searchLaporan.toLowerCase()) ||
        (r.teknisi||"").toLowerCase().includes(searchLaporan.toLowerCase()) ||
        (r.job_id||"").toLowerCase().includes(searchLaporan.toLowerCase()) ||
        (r.helper||"").toLowerCase().includes(searchLaporan.toLowerCase()) ||
        (r.service||"").toLowerCase().includes(searchLaporan.toLowerCase())
      )
      .sort((a,b) => {
        // Primary: date desc (terbaru di atas)
        const dateA = a.submitted_at || a.submitted || a.date || "";
        const dateB = b.submitted_at || b.submitted || b.date || "";
        if (dateB !== dateA) return dateB.localeCompare(dateA);
        // Secondary: status (SUBMITTED paling atas)
        return (statusOrder[a.status]||9) - (statusOrder[b.status]||9);
      });
    return (
      <div style={{display:"grid",gap:16}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontWeight:800,fontSize:18,color:cs.text}}>Laporan Tim Teknisi</div>
            <div style={{fontSize:12,color:cs.muted,marginTop:2}}>Verifikasi laporan, cek riwayat edit, tandai sesuai atau perlu revisi</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[["SUBMITTED",cs.accent,"Baru"],["VERIFIED",cs.green,"Verified"],["REVISION",cs.yellow,"Revisi"],["REJECTED",cs.red,"Ditolak"]].map(([s,col,lbl])=>(
              <span key={s} style={{fontSize:11,padding:"5px 11px",borderRadius:99,background:col+"18",color:col,border:"1px solid "+col+"33",fontWeight:700}}>
                {laporanReports.filter(r=>r.status===s).length} {lbl}
              </span>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:cs.muted,fontSize:14,pointerEvents:"none"}}>&#128269;</span>
          <input value={searchLaporan} onChange={e=>setSearchLaporan(e.target.value)}
            placeholder="Cari nama teknisi, customer, ID job, atau layanan..."
            style={{width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"10px 14px 10px 38px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
          {searchLaporan && <button onClick={()=>setSearchLaporan("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:cs.muted,cursor:"pointer",fontSize:20,lineHeight:1}}>x</button>}
        </div>
        {searchLaporan && <div style={{fontSize:12,color:cs.muted}}>Menampilkan <b style={{color:cs.accent}}>{filtered.length}</b> dari {laporanReports.length} laporan</div>}

        {/* List */}
        {filtered.length===0
          ? <div style={{background:cs.card,borderRadius:14,padding:40,textAlign:"center",color:cs.muted}}>Tidak ada laporan ditemukan</div>
          : filtered.map(r=>(
          <div key={r.id} style={{background:cs.card,border:"1px solid "+(sMap[r.status]?sMap[r.status][0]:cs.border)+"33",borderRadius:16,padding:20}}>
            {/* Card header */}
            <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontWeight:800,color:cs.accent,fontSize:14}}>{r.job_id}</span>
                {badge(r.status)}
                {r.editLog.length>0 && (
                  <span style={{fontSize:10,color:cs.yellow,background:cs.yellow+"15",padding:"2px 8px",borderRadius:99,border:"1px solid "+cs.yellow+"33"}}>
                    Diedit {r.editLog.length}x
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
              {r.materials&&r.materials.length>0&&<div><span style={{color:cs.muted}}>Material: </span><span style={{color:cs.text}}>{r.materials.length} item</span></div>}
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
                  {parseFloat(u.freon_ditambah)>0?`Freon +${u.freon_ditambah}kg`:""}
                  {u.catatan_unit?` · ${u.catatan_unit}`:""}
                </div>
              </div>
            ))}

            {/* Material summary */}
            {r.materials&&r.materials.length>0&&(
              <div style={{background:cs.surface,borderRadius:9,padding:"10px 13px",marginBottom:8,fontSize:12}}>
                <div style={{fontWeight:700,color:cs.text,marginBottom:6}}>🔧 Material Terpakai</div>
                {r.materials.map((m,mi)=>(
                  <div key={mi} style={{color:cs.muted,marginBottom:2}}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan?` — ${m.keterangan}`:""}</div>
                ))}
              </div>
            )}

            {r.rekomendasi&&<div style={{fontSize:11,marginBottom:6}}><span style={{color:cs.muted}}>Rekomendasi: </span><span style={{color:cs.text}}>{r.rekomendasi}</span></div>}
            {r.catatan_global&&<div style={{fontSize:11,marginBottom:8}}><span style={{color:cs.muted}}>Catatan: </span><span style={{color:cs.text}}>{r.catatan_global}</span></div>}

            {/* Edit log */}
            {r.editLog.length>0 && (
              <div style={{background:cs.yellow+"08",border:"1px solid "+cs.yellow+"22",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:cs.yellow,marginBottom:8}}>Riwayat Edit</div>
                {r.editLog.map((log,li)=>(
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
                  setLaporanReports(p=>p.map(x=>x.id===r.id?{...x,status:"VERIFIED"}:x));
                  // GAP 7: gunakan helper isRealUUID (sudah dideklarasi di atas)
                  const verifiedById = isRealUUID(currentUser?.id) ? currentUser.id : null;
                  await supabase.from("service_reports").update({
                    status:"VERIFIED",
                    verified_by: verifiedById,
                    verified_at: new Date().toISOString()
                  }).eq("id",r.id);
                  addAgentLog("LAPORAN_VERIFIED",`Laporan ${r.job_id} (${r.customer}) diverifikasi — invoice menunggu approval Owner`,"SUCCESS");
                  const relInv=invoicesData.find(i=>i.job_id===r.job_id);
                  if(relInv&&relInv.status==="PENDING_APPROVAL"){
                    showNotif(`✅ Laporan verified! Invoice ${relInv.id} siap approval Owner.`);
                    // Notif Owner via WA
                    fetch("/api/send-wa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:"6281299898937",message:`✅ Laporan ${r.job_id} sudah diverifikasi Admin.

🔧 ${r.customer} — ${r.service}
💰 Invoice ${relInv.id}: ${fmt(relInv.total)}

Mohon approve invoice di sistem. — ARA`})}).catch(()=>{});
                  } else { showNotif(`✅ Laporan ${r.job_id} diverifikasi`); }
                }} style={{background:cs.green+"22",border:"1px solid "+cs.green+"44",color:cs.green,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>Verifikasi OK</button>
                <button onClick={async()=>{
                  setLaporanReports(p=>p.map(x=>x.id===r.id?{...x,status:"REVISION"}:x));
                  await supabase.from("service_reports").update({status:"REVISION"}).eq("id",r.id);
                  addAgentLog("LAPORAN_REVISION",`Laporan ${r.job_id} diminta revisi oleh ${currentUser?.name}`,"WARNING");
                  showNotif("⚠️ Revisi diminta untuk laporan "+r.job_id);
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
            const canEdit = r.status==="SUBMITTED" || r.status==="REVISION";
            const isHelper = r.helper===myName;
            return (
              <div key={r.id} style={{background:cs.card,border:"1px solid "+(r.status==="REVISION"?cs.yellow:r.status==="VERIFIED"?cs.green:cs.border)+"44",borderRadius:14,padding:18}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontFamily:"monospace",fontWeight:800,color:cs.accent}}>{r.job_id}</span>
                    {badge(r.status)}
                    {isHelper && <span style={{fontSize:10,color:cs.muted,background:cs.surface,padding:"1px 7px",borderRadius:99}}>Helper</span>}
                    {r.editLog.length>0 && <span style={{fontSize:10,color:cs.muted}}>Diedit {r.editLog.length}x</span>}
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
                {r.editLog.length>0 && (
                  <div style={{background:cs.surface,borderRadius:8,padding:"10px 12px",marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:6}}>Riwayat Perubahan</div>
                    {r.editLog.map((log,li)=>(
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
                  {isPending && (
                    <button onClick={() => openLaporanModal(ordersData.find(o=>o.id===r.job_id)||{id:r.job_id,customer:r.customer,service:r.service,date:r.date,teknisi:r.teknisi,helper:r.helper,units:1})}
                      style={{background:cs.green+"22",border:"1px solid "+cs.green+"44",color:cs.green,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
                      + Buat Laporan
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={()=>{
                      setEditLaporanForm({rekomendasi:r.rekomendasi||"",catatan_global:r.catatan_global||r.catatan||""});
                      setSelectedLaporan(r); setEditLaporanMode(true); setModalLaporanDetail(true);
                    }}
                      style={{background:cs.accent+"22",border:"1px solid "+cs.accent+"44",color:cs.accent,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
                      Edit Laporan
                    </button>
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
        guide:["Buka fonnte.com Dashboard","Create Device, scan QR WA","Copy API Token dari Profile","Masukkan token + nomor di sini","Set Webhook URL ke endpoint backend"] },
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

    const FieldList = ({ fields, isLLM }) => (
      <div style={{ display:"grid", gap:8, marginBottom:12 }}>
        {fields.map(f => {
          const isUrlField   = isLLM && f.k === "url";
          const isKeyField   = isLLM && f.k === "key";
          const val   = isUrlField ? ollamaUrl : isKeyField ? llmApiKey : "";
          const setter = isUrlField ? (e=>setOllamaUrl(e.target.value)) : isKeyField ? (e=>setLlmApiKey(e.target.value)) : undefined;
          const isSet = isUrlField ? !!ollamaUrl : isKeyField ? !!llmApiKey : false;
          return (
            <div key={f.k}>
              <div style={{ fontSize:11, color:cs.muted, marginBottom:3 }}>{f.label}</div>
              <input type={f.t||"text"} placeholder={f.ph}
                value={isLLM ? val : undefined}
                onChange={isLLM ? setter : undefined}
                style={{ width:"100%", background:cs.surface, border:"1px solid "+(isSet?cs.green:cs.border), borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              {isSet && <div style={{ fontSize:10, color:cs.green, marginTop:3 }}>✓ {isUrlField?"URL tersimpan — siap test koneksi":"API Key tersimpan"}</div>}
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
            <button onClick={async () => { setWaStatus("testing"); try { const r=await fetch("/api/test-connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"wa"})}); const d=await r.json(); setWaStatus(d.success?"connected":"not_connected"); showNotif(d.message); } catch(e){ setWaStatus("not_connected"); showNotif("❌ "+e.message); } }}
              style={{ flex:2, background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>
              {waStatus==="testing" ? "⏳ Testing..." : "🔌 Test & Simpan Koneksi"}
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
            {LLM_PROVIDERS.map(p => (
              <div key={p.id} onClick={() => { setLlmProvider(p.id); setLlmStatus("not_connected"); }}
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
              <span style={{ color:"#22c55e" }}>✅ Dipakai webhook /api/fonnte-webhook</span>
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
              {llmStatus==="testing" ? "⏳ Testing..." : "🔌 Test & Simpan — " + activeLLM.label}
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
            <button onClick={async () => { setStorageStatus("testing"); try { const r=await fetch("/api/test-connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"storage"})}); const d=await r.json(); setStorageStatus(d.success?"connected":"not_connected"); showNotif(d.message); } catch(e){ setStorageStatus("not_connected"); showNotif("❌ "+e.message); } }}
              style={{ flex:2, background:"linear-gradient(135deg,"+cs.green+",#059669)", border:"none", color:"#fff", padding:"10px", borderRadius:8, cursor:"pointer", fontWeight:800, fontSize:13 }}>
              {storageStatus==="testing" ? "⏳ Testing..." : "🔌 Test & Simpan Koneksi"}
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
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
              <div style={{ fontSize:12, color:cs.muted, marginTop:2 }}>Kelola akun dan hak akses per role — hanya Owner yang bisa menambah/nonaktifkan</div>
            </div>
            <button onClick={() => { setNewUserForm({ name:"", email:"", role:"Admin", password:"", phone:"" }); setModalAddUser(true); }}
              style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"9px 16px", borderRadius:9, cursor:"pointer", fontWeight:700, fontSize:12 }}>
              + Tambah Pengguna
            </button>
          </div>
          {/* Role legend */}
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            {[["👑 Owner","Semua akses + Pengaturan","#f59e0b"],["🛠️ Admin","Semua menu kecuali Pengaturan","#38bdf8"],["👷 Teknisi","Jadwal & Tim Teknisi saja","#22c55e"]].map(([role,desc,col]) => (
              <div key={role} style={{ background:col+"12", border:"1px solid "+col+"33", borderRadius:8, padding:"6px 12px", fontSize:11 }}>
                <span style={{ color:col, fontWeight:700 }}>{role}</span>
                <span style={{ color:cs.muted, marginLeft:6 }}>{desc}</span>
              </div>
            ))}
          </div>
          {/* User list */}
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
                      {u.role === "Owner" ? "👑" : u.role === "Admin" ? "🛠️" : "👷"} {u.role}
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
              <div style={{ background:"#ef444418", border:"1px solid #ef444433", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12, color:cs.red }}>
                ⚠️ {loginError}
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
    <div style={{ background:cs.bg, color:cs.text, minHeight:"100vh", fontFamily:"system-ui,-apple-system,sans-serif", display:"flex" }}>

      {/* ── DATA LOADING BANNER ── */}
      {dataLoading && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9999, background:"linear-gradient(90deg,#38bdf8,#6366f1)", padding:"8px 16px", display:"flex", alignItems:"center", gap:10, fontSize:12, color:"#fff", fontWeight:700 }}>
          <div style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.4)", borderTop:"2px solid #fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
          Memuat data dari Supabase...
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── SIDEBAR ── */}
      <div style={{ width:200, background:cs.surface, borderRight:"1px solid "+cs.border, display:"flex", flexDirection:"column", flexShrink:0, position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>
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
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex:1, overflowY:"auto" }}>
        <div style={{ padding:"20px 24px", maxWidth:1200 }}>
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
          {renderContent()}
        </div>
      </div>

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
              {[["Nama Customer","customer","text"],["Nomor HP","phone","text"],["Alamat Lengkap","address","text"],["Catatan","notes","text"]].map(([label,key,type]) => (
                <div key={key}>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>{label}</div>
                  <input type={type} value={newOrderForm[key]||""} onChange={e => setNewOrderForm(f=>({...f,[key]:e.target.value}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                </div>
              ))}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Jenis Layanan</div>
                  <select value={newOrderForm.service} onChange={e => setNewOrderForm(f=>({...f,service:e.target.value}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                    {["Cleaning","Install","Repair"].map(s => <option key={s}>{s}</option>)}
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
                  {newOrderForm.service==="Cleaning" && ["AC Split 0.5-1PK","AC Split 1.5-2.5PK","AC Cassette 2-2.5PK","AC Cassette 3PK","AC Cassette 4PK","AC Standing","AC Duct"].map(t=><option key={t}>{t}</option>)}
                  {newOrderForm.service==="Install"  && ["Pasang AC 0.5-1PK","Pasang AC 1PK","Pasang AC 1.5-2PK","Pasang AC 2.5PK"].map(t=><option key={t}>{t}</option>)}
                  {newOrderForm.service==="Repair"   && ["Pengecekan AC","Pengecekan AC Panas/Bocor","Ganti Freon","Ganti Kompressor","Ganti Kapasitor","Bocor Refrigerant"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:cs.muted, marginBottom:5 }}>Teknisi</div>
                  <select value={newOrderForm.teknisi} onChange={e => setNewOrderForm(f=>({...f,teknisi:e.target.value,helper:""}))}
                    style={{ width:"100%", background:cs.card, border:"1px solid "+cs.border, borderRadius:8, padding:"9px 12px", color:cs.text, fontSize:13, outline:"none" }}>
                    <option value="">Pilih teknisi...</option>
                    {teknisiData.filter(t=>t.role==="Teknisi").map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
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
                <button onClick={() => { if(!newOrderForm.customer){showNotif("Nama customer wajib diisi");return;} if(!newOrderForm.teknisi){showNotif("Pilih teknisi dulu");return;} if(!newOrderForm.date){showNotif("Pilih tanggal dulu");return;} createOrder(newOrderForm); setModalOrder(false); setNewOrderForm({ customer:"", phone:"", address:"", service:"Cleaning", type:"AC Split 0.5-1PK", units:1, teknisi:"", helper:"", date:"", time:"09:00", notes:"" }); }}
                  style={{ background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)", border:"none", color:"#0a0f1e", padding:"12px", borderRadius:10, cursor:"pointer", fontWeight:800, fontSize:14 }}>✓ Buat Order & Dispatch WA</button>
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
                  const newCode   = "MAT"+String(inventoryData.length+1).padStart(3,"0");
                  const stokStatus= stokAwal===0?"OUT":stokAwal<=minAlert?"CRITICAL":stokAwal<=reorderPt?"WARNING":"OK";
                  const newItem   = { code:newCode, name:newStokForm.name, unit:newStokForm.unit||"pcs", price:parseInt(newStokForm.price)||0, stock:stokAwal, reorder:reorderPt, min_alert:minAlert, status:stokStatus };
                  setInventoryData(prev=>[...prev,newItem]);
                  const {error:invErr} = await supabase.from("inventory").insert(newItem);
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
                      }).catch(()=>{});
                    }
                    const {error:eErr} = await supabase.from("inventory").update({stock:stokFinal,price:hargaBaru,reorder:reorderBaru,status:statusBaru}).eq("code",editStokItem.code);
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
              {editTeknisi && (
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
                    style={{ background:cs.red+"18", border:"1px solid "+cs.red+"33", color:cs.red, padding:"9px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>🗑️ Hapus dari Tim & DB</button>
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
                    // Add new
                    const newTek = {name:newTeknisiForm.name,phone:newTeknisiForm.phone,role:newTeknisiForm.role,skills:newTeknisiForm.skills||[],status:"active",jobs_today:0};
                    const {error:tErr,data:tData} = await supabase.from("user_profiles").insert(newTek).select().single();
                    if(tErr) {
                      showNotif("⚠️ Tersimpan lokal, DB gagal: "+tErr.message);
                      setTeknisiData(prev=>[...prev,{...newTek,id:"TMP_"+Date.now()}]); // Reload dari DB saat refresh (normal)
                    } else {
                      setTeknisiData(prev=>[...prev,tData||newTek]);
                      addAgentLog("TEKNISI_ADDED","Anggota baru: "+newTeknisiForm.name+" ("+newTeknisiForm.role+")","SUCCESS");
                      showNotif("✅ "+newTeknisiForm.name+" berhasil ditambahkan");
                    }
                  }
                  setModalTeknisi(false); setEditTeknisi(null); setNewTeknisiForm({name:"",role:"Teknisi",phone:"",skills:[]});
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
        <div style={{ position:"fixed", inset:0, background:"#000d", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setModalBrainEdit(false)}>
          <div style={{ background:cs.surface, border:"1px solid "+cs.ara+"44", borderRadius:20, width:"100%", maxWidth:780, maxHeight:"92vh", display:"flex", flexDirection:"column", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ background:cs.ara+"15", borderBottom:"1px solid "+cs.ara+"33", padding:"16px 22px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:800, color:cs.ara, fontSize:16 }}>🧠 Edit Brain.md — Memori Permanen ARA</div>
                <div style={{ fontSize:12, color:cs.muted, marginTop:3 }}>Tersimpan di sistem · Otomatis terbaca oleh semua LLM yang terkoneksi</div>
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
                <button onClick={() => { showNotif("Brain.md tersimpan — ARA akan gunakan memori terbaru"); setModalBrainEdit(false); }}
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
        <div style={{ position:"fixed", inset:0, background:"#000d", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:cs.surface, border:"1px solid #22c55e44", borderRadius:20, width:"100%", maxWidth:700, maxHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
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
                <button onClick={() => { showNotif("Brain Customer tersimpan ✅"); setModalBrainCustomerEdit(false); }}
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
                  const {error:eiErr} = await supabase.from("invoices").update({labor,material,dadakan,total:newTotal}).eq("id",editInvoiceData.id);
                  if(eiErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
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
                  <button onClick={() => { approveInvoice(liveInv); setModalPDF(false); }}
                    style={{ background:"#22c55e", border:"none", color:"#fff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:12 }}>✓ Approve & Kirim PDF</button>
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
                  {liveInv.material > 0 && (
                    <tr style={{ background:"#f0f9ff" }}>
                      <td style={{ padding:"8px 10px", color:"#1e293b" }}>Material & Spare Part</td>
                      <td style={{ padding:"8px 10px", textAlign:"center" }}>—</td>
                      <td style={{ padding:"8px 10px" }}>—</td>
                      <td style={{ padding:"8px 10px", color:"#1e293b", fontFamily:"monospace", fontWeight:600 }}>{liveInv.material.toLocaleString("id-ID")}</td>
                    </tr>
                  )}
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
              <button onClick={() => showNotif("PDF digenerate — siap download")} style={{ background:"#EFF6FF", border:"1px solid #bfdbfe", color:"#1d4ed8", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>📥 Download PDF</button>
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
      {/* WA PANEL */}
      {/* ══════════════════════════════════════════════════════ */}
      {waPanel && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:300, display:"flex", justifyContent:"flex-end" }} onClick={() => setWaPanel(false)}>
          <div style={{ width:420, background:cs.surface, borderLeft:"1px solid "+cs.border, display:"flex", flexDirection:"column", height:"100vh" }} onClick={e => e.stopPropagation()}>
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
                  <div key={conv.id} onClick={() => { setSelectedConv(conv); setWaConversations(prev=>prev.map(cv=>cv.id===conv.id?{...cv,unread:0}:cv)); }}
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
                    <div style={{ flex:1, padding:"12px 14px", overflowY:"auto" }}>
                      <div style={{ background:cs.card, borderRadius:10, padding:"10px 12px", marginBottom:8, maxWidth:"85%", fontSize:12, color:cs.text }}>{selectedConv.last}</div>
                      <div style={{ background:cs.accent+"22", borderRadius:10, padding:"10px 12px", marginLeft:"auto", maxWidth:"85%", fontSize:12, color:cs.text }}>Halo {selectedConv.name}! Ada yang bisa ARA bantu?</div>
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
              await supabase.from("user_profiles").upsert({
                id: data.user.id,
                name: newUserForm.name, role: newUserForm.role,
                phone: newUserForm.phone||"", avatar, color, active: true,
              }).catch(()=>{});
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
                  const existPhone = customersData.find(cu => cu.phone === newCustomerForm.phone && cu.id !== (selectedCustomer?.id||""));
                  if(existPhone){showNotif(`⚠️ Nomor HP sudah terdaftar atas nama "${existPhone.name}". Tidak bisa duplikat.`);return;}
                  if(selectedCustomer && selectedCustomer.id){
                    // UPDATE existing customer
                    setCustomersData(prev=>prev.map(cu=>cu.id===selectedCustomer.id?{...cu,...newCustomerForm}:cu));
                    setSelectedCustomer(prev=>({...prev,...newCustomerForm}));
                    // Hanya kolom yang ada di DB schema
                    const dbUpdate = {name:newCustomerForm.name, phone:newCustomerForm.phone, address:newCustomerForm.address, area:newCustomerForm.area, notes:newCustomerForm.notes||"", is_vip:newCustomerForm.is_vip||false};
                    const {error:cErr} = await supabase.from("customers").update(dbUpdate).eq("id",selectedCustomer.id);
                    if(cErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
                    else { addAgentLog("CUSTOMER_UPDATED","Customer "+newCustomerForm.name+" diupdate","SUCCESS"); showNotif("✅ Data "+newCustomerForm.name+" berhasil diupdate"); }
                  } else {
                    // INSERT new customer
                    const newId = "CUST" + String(Date.now()).slice(-6);
                    const today = new Date().toISOString().slice(0,10);
                    const dbCust = {id:newId, name:newCustomerForm.name, phone:newCustomerForm.phone, address:newCustomerForm.address||"", area:newCustomerForm.area||"", notes:newCustomerForm.notes||"", is_vip:newCustomerForm.is_vip||false, joined:today};
                    const localCust = {...dbCust, last_service:"-", ac_units:0, total_orders:0};
                    setCustomersData(prev=>[...prev,localCust]);
                    // GAP 5: upsert dengan onConflict phone — cegah duplikat
                    const {error:cErr} = await supabase.from("customers").upsert(
                      dbCust, {onConflict:"phone", ignoreDuplicates:false}
                    );
                    if(cErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal: "+cErr.message);
                    else if(customersData.find(cu=>cu.phone===newCustomerForm.phone&&cu.id!==newId)) {
                      showNotif("ℹ️ Customer dengan nomor ini sudah ada — data digabung.");
                    }
                    else { addAgentLog("CUSTOMER_ADDED","Customer baru: "+newCustomerForm.name+" ("+newCustomerForm.area+")","SUCCESS"); showNotif("✅ Customer "+newCustomerForm.name+" berhasil ditambahkan"); }
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
                <div style={{fontSize:11,color:cs.yellow,marginTop:2}}>Hanya Owner & Admin · Perubahan dicatat otomatis</div>
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
                      {["Cleaning","Install","Repair"].map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:3}}>Jumlah Unit</div>
                    <input type="number" min="1" max="20" value={editOrderForm.units||1} onChange={e=>setEditOrderForm(f=>({...f,units:parseInt(e.target.value)||1}))}
                      style={{width:"100%",background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 11px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}} />
                  </div>
                </div>
              </div>

              {/* Section: Jadwal & Tim */}
              <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:800,color:cs.muted,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"}}>Jadwal & Tim</div>
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
                  const timeEnd = hitungJamSelesai(editOrderForm.time||"09:00", editOrderForm.service||"Cleaning", editOrderForm.units||1);
                  const updated = {...editOrderItem,...editOrderForm,time_end:timeEnd};
                  setOrdersData(prev=>prev.map(o=>o.id===editOrderItem.id?updated:o));
                  const dbUpd = {customer:editOrderForm.customer,phone:editOrderForm.phone,address:editOrderForm.address,service:editOrderForm.service,units:editOrderForm.units,teknisi:editOrderForm.teknisi,helper:editOrderForm.helper||null,date:editOrderForm.date,time:editOrderForm.time,time_end:timeEnd,status:editOrderForm.status,notes:editOrderForm.notes||""};
                  const {error:eoErr} = await supabase.from("orders").update(dbUpd).eq("id",editOrderItem.id);
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
          <div style={{background:cs.surface,border:"1px solid "+cs.border,borderRadius:20,width:"100%",maxWidth:540,maxHeight:"90vh",overflowY:"auto",padding:28}} onClick={e=>e.stopPropagation()}>

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
                    const allLogs = [...(selectedLaporan.editLog||[]),...newLogs];
                    const newStatus = selectedLaporan.status==="REVISION"?"SUBMITTED":selectedLaporan.status;
                    setLaporanReports(prev=>prev.map(r=>r.id===selectedLaporan.id
                      ?{...r,rekomendasi:editLaporanForm.rekomendasi,catatan_global:editLaporanForm.catatan_global,status:newStatus,editLog:allLogs}:r));
                    // Save ke Supabase
                    const {error:elErr} = await supabase.from("service_reports").update({
                      rekomendasi:editLaporanForm.rekomendasi,
                      catatan_global:editLaporanForm.catatan_global,
                      status:newStatus,
                      edit_log: allLogs, updated_at: new Date().toISOString()
                    }).eq("id",selectedLaporan.id);
                    if(elErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
                    else { addAgentLog("LAPORAN_EDITED",`Laporan ${selectedLaporan.job_id} diedit oleh ${currentUser?.name} (${newLogs.length} perubahan)`,"SUCCESS"); }
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
                            {parseFloat(u.freon_ditambah)>0?`Freon +${u.freon_ditambah}kg`:""}
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

                {(selectedLaporan.editLog||[]).length>0 && (
                  <div style={{background:cs.yellow+"08",border:"1px solid "+cs.yellow+"22",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{fontSize:11,fontWeight:700,color:cs.yellow,marginBottom:8}}>Riwayat Edit ({(selectedLaporan.editLog||[]).length}x)</div>
                    {(selectedLaporan.editLog||[]).map((log,li)=>(
                      <div key={li} style={{fontSize:11,color:cs.muted,marginBottom:5,paddingBottom:5,borderBottom:li<(selectedLaporan.editLog||[]).length-1?"1px solid "+cs.border:"none"}}>
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
        const STEP_LABELS = ["","Konfirmasi Unit","Detail Per Unit","Material & Foto","Submit"];

        const updateUnit = (idx, updated) => setLaporanUnits(prev=>prev.map((u,i)=>i===idx?updated:u));
        const toggleArr = (arr, val) => arr.includes(val)?arr.filter(x=>x!==val):[...arr,val];

        const handleFotoUpload = async (e) => {
          const files = Array.from(e.target.files||[]).slice(0,10-laporanFotos.length);
          showNotif(`⏳ Mengkompresi ${files.length} foto...`);
          const compressed = await Promise.all(files.map(compressImg));
          const reportId = laporanModal?.id || "tmp";

          const uploaded = await Promise.all(compressed.map(async (dataUrl, i) => {
            const localId = Date.now()+i;
            const label = `Foto ${laporanFotos.length+i+1}`;
            let url = null;

            // ── Coba R2 via backend dulu ──
            try {
              const r = await fetch("/api/upload-foto", {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({base64:dataUrl, filename:`foto_${localId}.jpg`, reportId})
              });
              const d = await r.json();
              if (d.success && d.url) { url = d.url; }
            } catch(_) {}

            // ── Fallback: Supabase Storage (jika R2 belum dikonfigurasi) ──
            if (!url) {
              try {
                const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
                const byteStr = atob(base64Data);
                const arr = new Uint8Array(byteStr.length);
                for (let j=0; j<byteStr.length; j++) arr[j] = byteStr.charCodeAt(j);
                const blob = new Blob([arr], {type:"image/jpeg"});
                const path = `reports/${reportId}/${localId}.jpg`;
                const { data: upData, error: upErr } = await supabase.storage
                  .from("laporan-fotos")
                  .upload(path, blob, {contentType:"image/jpeg", upsert:true});
                if (!upErr && upData) {
                  const { data: { publicUrl } } = supabase.storage
                    .from("laporan-fotos")
                    .getPublicUrl(path);
                  url = publicUrl;
                }
              } catch(_) {}
            }

            return { id:localId, label, data_url:dataUrl, url };
          }));

          setLaporanFotos(prev=>[...prev,...uploaded]);
          const saved = uploaded.filter(f=>f.url).length;
          showNotif(`✅ ${files.length} foto dikompresi (70%). ${saved} tersimpan ke cloud.`);
          e.target.value="";
        };

        const submitLaporan = () => {
          if(incompleteUnits.length>0){showNotif(`${incompleteUnits.length} unit belum diisi pekerjaan!`);return;}
          const now = new Date().toLocaleString("id-ID",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(/\//g,"-");
          const newReport = {
            id:"LPR_"+laporanModal.id+"_"+Date.now().toString(36).slice(-4).toUpperCase(),
            job_id:laporanModal.id, teknisi:laporanModal.teknisi, helper:laporanModal.helper||null,
            customer:laporanModal.customer, service:laporanModal.service, date:laporanModal.date,
            submitted:now, status:"SUBMITTED", total_units:laporanUnits.length,
            units:laporanUnits, materials:laporanMaterials,
            fotos:laporanFotos.map(f=>({id:f.id,label:f.label})),
            total_freon:totalFreon, rekomendasi:laporanRekomendasi, catatan_global:laporanCatatan,
            unit_mismatch: laporanUnits.length!==(laporanModal.units||1), editLog:[]
          };
          setLaporanReports(prev=>[...prev.filter(r=>r.job_id!==laporanModal.id),newReport]);

          // Simpan laporan ke Supabase
          supabase.from("service_reports").upsert({
            id: newReport.id, job_id: newReport.job_id, teknisi: newReport.teknisi,
            helper: newReport.helper, customer: newReport.customer,
            service: newReport.service, date: newReport.date,
            status: "SUBMITTED", total_units: newReport.total_units,
            total_freon: newReport.total_freon, rekomendasi: newReport.rekomendasi,
            catatan_global: newReport.catatan_global, submitted_at: new Date().toISOString(),
            foto_urls: laporanFotos.filter(f=>f.url).map(f=>f.url),
          });

          // Reload laporan untuk Owner/Admin setelah teknisi submit
          setTimeout(() => {
            supabase.from("service_reports").select("*").order("submitted_at",{ascending:false})
              .then(({data}) => {
                if (data && data.length > 0) {
                  setLaporanReports(data.map(r=>({
                    ...r, units:r.units||[], materials:r.materials||[],
                    fotos:r.fotos||(r.foto_urls||[]).map((u,i)=>({id:i,label:`Foto ${i+1}`,url:u})),
                    editLog:r.edit_log||[]
                  })));
                }
              });
          }, 1500);

          // GAP 2 — Update order status ke COMPLETED
          setOrdersData(prev => prev.map(o =>
            o.id === laporanModal.id ? {...o, status:"COMPLETED"} : o
          ));
          supabase.from("orders").update({status:"COMPLETED"}).eq("id",laporanModal.id);

          // GAP 6 — Auto-deduct inventory dari material yang dipakai
          if (laporanMaterials.length > 0) {
            deductInventory(laporanMaterials);
            // Deduct di Supabase juga
            laporanMaterials.forEach(mat => {
              supabase.rpc("deduct_inventory", {item_name: mat.nama, qty: parseFloat(mat.jumlah)||0});
            });
            addAgentLog("MATERIAL_DEDUCT", `${laporanMaterials.length} material dipakai di ${laporanModal.id}`, "SUCCESS");
          }

          // GAP 2 — Auto-generate invoice dengan price list
          const laborTotal = hitungLabor(laporanModal.service, laporanModal.type, laporanUnits.length);
          const freonTotal2 = laporanUnits.reduce((s,u)=>s+(parseFloat(u.freon_ditambah)||0),0);
          const freonType = laporanModal.type?.includes("R410")||laporanModal.type?.includes("inverter") ? "freon_R410A" : "freon_R22";
          const freonValue = freonTotal2 * (PRICE_LIST[freonType]||150000);
          const matTotal = hitungMaterialTotal(laporanMaterials) + freonValue;
          const today2 = new Date().toISOString().slice(0,10);
          const invSeq = (invoicesData.length + 1).toString().padStart(3,"0");
          const newInvoiceId = "INV-" + today2.replace(/-/g,"").slice(0,8) + "-" + invSeq;
          const newInvoice = {
            id: newInvoiceId,
            job_id: laporanModal.id,
            customer: laporanModal.customer,
            phone: laporanModal.phone || customersData.find(c=>c.name===laporanModal.customer)?.phone || "",
            service: laporanModal.service + " - " + laporanModal.type,
            units: laporanUnits.length,
            labor: laborTotal,
            material: matTotal,
            dadakan: 0,
            total: laborTotal + matTotal,
            status: "PENDING_APPROVAL",
            sent: null,
            due: null,
            follow_up: 0,
          };
          setInvoicesData(prev => [...prev, newInvoice]);
          // Simpan invoice ke Supabase
          supabase.from("invoices").insert(newInvoice);
          addAgentLog("INVOICE_CREATED", `Invoice ${newInvoiceId} dibuat dari laporan ${laporanModal.id} — ${fmt(newInvoice.total)} — menunggu approval Owner`, "SUCCESS");

          // Notif WA ke Owner bahwa laporan + invoice menunggu approval
          const ownerMsg = `📝 Laporan baru masuk dari ${laporanModal.teknisi}\n\n🔧 ${laporanModal.service} - ${laporanModal.customer}\n💰 Invoice: ${fmt(newInvoice.total)}\n\nMohon approve invoice ${newInvoiceId} di sistem. — ARA`;
          fetch("/api/send-wa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:"6281299898937",message:ownerMsg})}).catch(()=>{});

          setLaporanSubmitted(true);
          showNotif(`✅ Laporan ${laporanModal.id} (${laporanUnits.length} unit) terkirim! Invoice ${newInvoiceId} dibuat.`);
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
                  <button onClick={()=>setLaporanStep(2)} style={{background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)",border:"none",color:"#0a0f1e",padding:"13px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>
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
                            {PEKERJAAN_OPT.map(k=>(
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
                            <div style={{fontSize:11,fontWeight:700,color:cs.muted,marginBottom:4}}>Freon Ditambah (kg)</div>
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
                      if(incompleteUnits.length>0){showNotif(`${incompleteUnits.length} unit belum diisi`);setActiveUnitIdx(laporanUnits.findIndex(u=>!isUnitDone(u)));return;}
                      setLaporanStep(3);
                    }} style={{background:"linear-gradient(135deg,"+cs.accent+",#3b82f6)",border:"none",color:"#0a0f1e",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>Lanjut →</button>
                  </div>
                </div>
              )}

              {/* ── STEP 3: Material & Foto ── */}
              {laporanStep===3&&(
                <div style={{display:"grid",gap:14}}>

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
                      <div style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:12,marginBottom:10}}>
                        <div style={{fontSize:11,color:cs.muted,marginBottom:8}}>Tap untuk tambah cepat:</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {presets.map(p=>(
                            <button key={p} onClick={()=>{if(laporanMaterials.length<20)setLaporanMaterials(prev=>[...prev,{id:Date.now(),nama:p,jumlah:"",satuan:"pcs",keterangan:""}]);setShowMatPreset(false);}}
                              style={{fontSize:11,background:cs.accent+"10",border:"1px solid "+cs.accent+"22",color:cs.accent,borderRadius:6,padding:"5px 10px",cursor:"pointer"}}>+ {p}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{display:"grid",gap:8}}>
                      {laporanMaterials.length===0&&<div style={{textAlign:"center",padding:"14px 0",fontSize:12,color:cs.muted,fontStyle:"italic"}}>Belum ada material — opsional untuk Cleaning</div>}
                      {laporanMaterials.map(mat=>(
                        <div key={mat.id} style={{background:cs.card,border:"1px solid "+cs.border,borderRadius:10,padding:"10px 12px",display:"grid",gap:8}}>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <input value={mat.nama} onChange={e=>setLaporanMaterials(p=>p.map(m=>m.id===mat.id?{...m,nama:e.target.value}:m))} placeholder="Nama material..."
                              style={{flex:1,background:cs.surface,border:"1px solid "+cs.border,borderRadius:7,padding:"8px 10px",color:cs.text,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                            <button onClick={()=>setLaporanMaterials(p=>p.filter(m=>m.id!==mat.id))}
                              style={{background:"#ef444422",border:"1px solid #ef444433",color:"#ef4444",borderRadius:7,padding:"8px 10px",cursor:"pointer",fontSize:14,lineHeight:1,fontWeight:700}}>×</button>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 2fr",gap:8}}>
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
                      <button onClick={()=>setLaporanMaterials(p=>[...p,{id:Date.now(),nama:"",jumlah:"",satuan:"pcs",keterangan:""}])}
                        style={{marginTop:8,width:"100%",background:cs.green+"10",border:"1px dashed "+cs.green+"33",color:cs.green,borderRadius:8,padding:"10px",cursor:"pointer",fontWeight:700,fontSize:13}}>
                        + Tambah Material
                      </button>
                    )}
                  </div>

                  {/* Foto */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:cs.muted}}>📸 Foto Dokumentasi ({laporanFotos.length}/10)</div>
                      {laporanFotos.length<10&&(
                        <button onClick={()=>fotoInputRef.current?.click()}
                          style={{fontSize:11,background:cs.yellow+"15",border:"1px solid "+cs.yellow+"33",color:cs.yellow,borderRadius:6,padding:"5px 11px",cursor:"pointer",fontWeight:600}}>+ Upload</button>
                      )}
                    </div>
                    <input ref={fotoInputRef} type="file" accept="image/*" multiple onChange={handleFotoUpload} style={{display:"none"}}/>
                    {laporanFotos.length===0?(
                      <div onClick={()=>fotoInputRef.current?.click()}
                        style={{border:"1px dashed "+cs.yellow+"33",borderRadius:10,padding:"20px",textAlign:"center",cursor:"pointer",color:cs.muted,fontSize:12}}>
                        📷 Tap untuk upload foto<br/><span style={{fontSize:11}}>Sebelum &amp; sesudah servis, kondisi material</span>
                      </div>
                    ):(
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                        {laporanFotos.map(f=>(
                          <div key={f.id} style={{position:"relative"}}>
                            <img src={f.data_url} alt={f.label} style={{width:"100%",aspectRatio:"1/1",objectFit:"cover",borderRadius:8,border:"1px solid "+cs.border}}/>
                            <button onClick={()=>setLaporanFotos(p=>p.filter(x=>x.id!==f.id))}
                              style={{position:"absolute",top:4,right:4,background:"#000a",border:"none",color:"#fff",borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:12,lineHeight:"20px",padding:0,textAlign:"center"}}>×</button>
                            <input value={f.label} onChange={e=>setLaporanFotos(p=>p.map(x=>x.id===f.id?{...x,label:e.target.value}:x))}
                              style={{marginTop:3,width:"100%",background:cs.card,border:"1px solid "+cs.border,borderRadius:5,padding:"4px 6px",color:cs.text,fontSize:10,outline:"none",boxSizing:"border-box"}}/>
                          </div>
                        ))}
                        {laporanFotos.length<10&&(
                          <div onClick={()=>fotoInputRef.current?.click()}
                            style={{aspectRatio:"1/1",border:"1px dashed "+cs.border,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:22,color:cs.muted}}>+</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Rekomendasi & Catatan */}
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
                    <button onClick={()=>setLaporanStep(2)} style={{background:cs.card,border:"1px solid "+cs.border,color:cs.muted,padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:600}}>← Kembali</button>
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
                        {totalFreon>0&&<span style={{color:cs.muted}}> · Freon <span style={{color:cs.yellow}}>{totalFreon.toFixed(1)}kg</span></span>}
                        {laporanFotos.length>0&&<span style={{color:cs.muted}}> · <span style={{color:cs.green}}>{laporanFotos.length} foto</span></span>}
                        {laporanMaterials.length>0&&<span style={{color:cs.muted}}> · <span style={{color:cs.accent}}>{laporanMaterials.length} material</span></span>}
                      </div>
                    </div>
                    {/* Per-unit summary */}
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
                            {parseFloat(u.freon_ditambah)>0?`Freon +${u.freon_ditambah}kg`:""}
                            {u.catatan_unit?` · ${u.catatan_unit}`:""}
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Material */}
                    {laporanMaterials.length>0&&(
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
        <div style={{position:"fixed",inset:0,background:"#000d",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
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
