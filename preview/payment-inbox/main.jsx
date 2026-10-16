import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PaymentInboxHealthPanel from "../../src/components/PaymentInboxHealthPanel.jsx";
import { usePaymentInbox } from "../../src/hooks/usePaymentInbox.js";
import PaymentSuggestionBanner from "../../src/components/PaymentSuggestionBanner.jsx";
import InvoiceView from "../../src/views/InvoiceView.jsx";
import { AppContext } from "../../src/context/AppContext.js";

const seed = Array.from({ length: 250 }, (_, i) => ({ id: `DEMO-${i}`, sender_name: `Customer contoh ${i}`, status: "PENDING", validation_status: "PENDING", created_at: "2026-10-01T00:00:00Z" }));
let rows = seed;
let readCalls = 0;
const fakeSupabase = { from(table) {
  if (table !== "payment_suggestions") throw new Error("Preview hanya boleh membaca suggestion contoh");
  let status = "PENDING";
  return { select() { return this; }, eq(key, value) { if (key === "status") status = value; return this; },
    not() { return this; }, gte() { return this; }, order() { return this; }, async range(from, to) { readCalls++; return { data: status === "PENDING" ? rows.slice(from, to + 1) : [] }; } };
} };
function Demo() {
  const [snapshot, setSnapshot] = useState([]);
  const [role, setRole] = useState("Owner");
  const [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState(0);
  const [banner, setBanner] = useState(null);
  const [invoiceVisible, setInvoiceVisible] = useState(false);
  const inbox = usePaymentInbox({ supabase: fakeSupabase, userId: "demo-owner", enabled: ["Owner", "Admin"].includes(role),
    onData: setSnapshot, onNew: items => { setNotifications(n => n + items.length); setNotice(`Bukti/media baru: ${items.length}`); setBanner(items[0]); } });
  return <main><h1>Bukti Pembayaran WA · Preview lokal</h1>
    <div className="notice">Data simulasi saja · 250 suggestion · Tidak terhubung ke Supabase/Fonnte/AI. API status wajib di-mock oleh smoke test; permintaan lain diblok.</div>
    <nav>
      <button onClick={() => { rows = [{ id: "NEW-DEMO", created_at: "2026-01-01", status: "PENDING", validation_status: "PENDING" }, ...rows]; inbox.refresh(); }}>Simulasikan bukti baru</button>
      <button onClick={() => { rows = []; inbox.refresh(); }}>Simulasikan semua selesai</button>
      <button onClick={() => { setRole("Teknisi"); setNotice("Role teknisi: inbox privat dihentikan"); }}>Uji role teknisi</button>
      <button onClick={() => setInvoiceVisible(v => !v)}>Buka Invoice asli (simulasi)</button>
    </nav>
    <div role="status">{snapshot.length} suggestion · {notifications} notifikasi baru · {readCalls} halaman dibaca · role {role}</div>
    {notice && <p>{notice}</p>}
    {["Owner", "Admin"].includes(role) && <PaymentInboxHealthPanel apiHeaders={async () => ({ "X-Demo": "local-only" })} inbox={inbox} onOpenPending={() => setNotice("Pending AI dapat diperiksa tanpa mengubah status invoice")} />}
    {banner && <PaymentSuggestionBanner suggestion={banner} onClose={() => setBanner(null)} onReview={() => { setBanner(null); setNotice("Navigasi review saja: tidak ada pembayaran diubah"); }} />}
    {invoiceVisible && <section aria-label="Invoice asli simulasi"><AppContext.Provider value={{ currentUser: { role, name: "Owner contoh" }, isMobile: innerWidth < 700, supabase: fakeSupabase, showNotif: setNotice, showConfirm: async () => false, fmt: n => `Rp ${Number(n || 0).toLocaleString("id-ID")}`, TODAY: "2026-10-16" }}>
      <InvoiceView invoiceFilterMemo={{ filteredInv: [], garansiAktif: [], garansiKritis: [], unpaidCnt: 0 }}
        invoicesData={[]} invoicesDataMerged={[]} ordersData={[]} customersData={[]} priceListData={[]} quotationsData={[]} laporanReports={[]}
        invoicePage={1} invoiceFilter="Semua" invoiceDateFrom="" invoiceDateTo="" searchInvoice="" INV_PAGE_SIZE={20}
        getLocalDate={() => "2026-10-16"} apiHeaders={async () => ({ "X-Demo": "local-only" })}
        paymentSuggestions={snapshot} setPaymentSuggestions={setSnapshot} paymentInbox={inbox} appSettings={{}}
        setInvoicePage={() => {}} setInvoiceFilter={() => {}} setInvoiceDateFrom={() => {}} setInvoiceDateTo={() => {}} setSearchInvoice={() => {}} />
    </AppContext.Provider></section>}
  </main>;
}
createRoot(document.getElementById("root")).render(<Demo />);
