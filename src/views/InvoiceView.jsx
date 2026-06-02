import { memo, useState, useMemo, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { statusColor } from "../constants/status.js";
import { smartSearchNormalize, samePhone } from "../lib/phone.js";
import AcUnitInvoiceModal from "./AcUnitInvoiceModal.jsx";
import QuotationView from "./QuotationView.jsx";
import { BlobProvider } from "@react-pdf/renderer";
import QuotationPDF from "../components/QuotationPDF.jsx";

function InvoiceView({ invoiceFilterMemo, invoicesData, setInvoicesData, invoicePage, setInvoicePage, currentUser, isMobile, invoiceFilter, setInvoiceFilter, searchInvoice, invoiceDateFrom, setInvoiceDateFrom, invoiceDateTo, setInvoiceDateTo, setSearchInvoice, setSelectedInvoice, setModalPDF, setEditInvoiceData, setEditInvoiceForm, setEditJasaItems, setEditInvoiceItems, setModalEditInvoice, ordersData, setOrdersData, setActiveMenu, setAuditModal, invoiceReminderWA, mergedInvoiceWA, createConsolidatedInvoice, previewMergedInvoicePDF, approveInvoice, approveSaveOnly, markPaid, showConfirm, showNotif, addAgentLog, auditUserName, markInvoicePaid, revertInvoicePaid, updateOrderStatus, deleteInvoice, updateInvoice, getLocalDate, fmt, parseMD, jasaSvcNames, downloadRekapHarian, supabase, TODAY, INV_PAGE_SIZE, laporanReports, uploadServiceReportPDFForWA, sendWAFn, apiHeaders, setGroupPaymentCtx, customersData, priceListData, quotationsData, setQuotationsData, uploadQuotationPDFFn, appSettings, searchLoading }) {
const { filteredInv, garansiAktif, garansiKritis, unpaidCnt } = invoiceFilterMemo;
const todayDateStr = getLocalDate();
const [scanningBukti, setScanningBukti] = useState(false);
const [confirmingCash, setConfirmingCash] = useState(false);
const [showAcUnitModal, setShowAcUnitModal] = useState(false);
const [dpInvId, setDpInvId] = useState(null);
const [dpAmount, setDpAmount] = useState("");

// ── Multi-payment panel ──
const [payPanelInvId, setPayPanelInvId] = useState(null); // invoice.id yang panel terbuka
const [payHistory, setPayHistory]       = useState([]);   // invoice_payments rows
const [payLoading, setPayLoading]       = useState(false);
const [payForm, setPayForm]             = useState({ amount: "", method: "transfer", notes: "", paid_at: "" });
const [paySaving, setPaySaving]         = useState(false);

const openPayPanel = async (inv) => {
  setPayPanelInvId(inv.id);
  setPayForm({ amount: "", method: "transfer", notes: "", paid_at: getLocalDate() });
  setPayLoading(true);
  const { data } = await supabase.from("invoice_payments")
    .select("id,amount,method,notes,paid_at,recorded_by_name,created_at")
    .eq("invoice_id", inv.id)
    .order("paid_at", { ascending: true });
  setPayHistory(data || []);
  setPayLoading(false);
};

const savePayment = async (inv) => {
  const amt = Number(payForm.amount);
  if (!amt || amt <= 0) { showNotif("⚠️ Jumlah tidak valid"); return; }
  const remaining = Math.max(0, (inv.remaining_amount ?? inv.total) - amt);
  const newPaidAmount = (Number(inv.paid_amount) || 0) + amt;
  const newStatus = remaining <= 0 ? "PAID" : "PARTIAL_PAID";
  setPaySaving(true);
  try {
    // Insert ke invoice_payments
    const { error: e1 } = await supabase.from("invoice_payments").insert({
      invoice_id: inv.id,
      amount: amt,
      method: payForm.method,
      notes: payForm.notes || null,
      paid_at: payForm.paid_at || getLocalDate(),
      recorded_by_name: currentUser?.name || "Admin",
    });
    if (e1) throw e1;

    // Update invoice aggregate
    const updateFields = {
      paid_amount: newPaidAmount,
      remaining_amount: remaining,
      status: newStatus,
    };
    if (newStatus === "PAID") updateFields.paid_at = payForm.paid_at || getLocalDate();
    const { error: e2 } = await supabase.from("invoices").update(updateFields).eq("id", inv.id);
    if (e2) throw e2;

    setInvoicesData(prev => prev.map(i => i.id === inv.id ? { ...i, ...updateFields } : i));
    // Refresh history
    const { data } = await supabase.from("invoice_payments")
      .select("id,amount,method,notes,paid_at,recorded_by_name,created_at")
      .eq("invoice_id", inv.id).order("paid_at", { ascending: true });
    setPayHistory(data || []);
    setPayForm({ amount: "", method: "transfer", notes: "", paid_at: getLocalDate() });
    showNotif(`✅ Pembayaran ${fmt(amt)} tercatat — ${remaining > 0 ? "sisa " + fmt(remaining) : "LUNAS"}`);
    if (newStatus === "PAID") setPayPanelInvId(null);
  } catch (err) {
    showNotif("❌ Gagal simpan: " + err.message, "error");
  } finally {
    setPaySaving(false);
  }
};
// ── Mode Gabung Invoice (2 stage: picker → select) ──
// Stage "picker"  : tampilkan modal list customer yang punya >=2 invoice
// Stage "select"  : setelah customer dipilih, filter invoice ke customer itu saja, user centang max 5
const MERGE_MAX = 5;
const [mergeStage, setMergeStage]     = useState(null); // null | "picker" | "select"
const [mergePhone, setMergePhone]     = useState(null); // phone customer yang dipilih
const [mergeSelectedIds, setMergeSelectedIds] = useState([]);
const [mergeSending, setMergeSending] = useState(false);
const [mergeApproving, setMergeApproving] = useState(false);
const [mergePreviewing, setMergePreviewing] = useState(false);
const [mergeConsolidating, setMergeConsolidating] = useState(false);
// Snapshot invoice list yang terakhir gagal kirim — agar bisa di-retry tanpa hilang state UI
const [lastFailedMerge, setLastFailedMerge] = useState(null); // { invList, customer, phone, ts }

const mergeMode = mergeStage === "select"; // backward-compat untuk card render

const toggleMergeId = (id) => {
  setMergeSelectedIds(prev => {
    if (prev.includes(id)) return prev.filter(x => x !== id);
    if (prev.length >= MERGE_MAX) {
      showNotif(`⚠️ Maksimal ${MERGE_MAX} invoice per gabungan`);
      return prev;
    }
    return [...prev, id];
  });
};
const clearMergeSelection = () => { setMergeSelectedIds([]); };
const exitMergeMode = () => { setMergeStage(null); setMergePhone(null); setMergeSelectedIds([]); };

// Invoice yang terpilih (selalu sub-set dari customer yang dipilih)
const mergeSelectedInvs = useMemo(
  () => mergeSelectedIds.map(id => invoicesData.find(i => i.id === id)).filter(Boolean),
  [mergeSelectedIds, invoicesData]
);

// True jika semua invoice yang dipilih sudah di-approve (tidak perlu approve lagi)
const allMergeAlreadyApproved = mergeSelectedInvs.length >= 2 &&
  mergeSelectedInvs.every(i => i.status !== "PENDING_APPROVAL" && i.status !== "PENDING" && i.status);

// Preview PDF gabungan tanpa kirim — buka di tab baru
const handlePreviewMerged = async () => {
  if (mergeSelectedInvs.length < 2) { showNotif("⚠️ Pilih minimal 2 invoice"); return; }
  if (typeof previewMergedInvoicePDF !== "function") { showNotif("⚠️ Preview belum tersedia"); return; }
  setMergePreviewing(true);
  await previewMergedInvoicePDF(mergeSelectedInvs);
  setMergePreviewing(false);
};

const handleSendMerged = async (retryInvList = null) => {
  const invs = retryInvList || mergeSelectedInvs;
  if (invs.length < 2) { showNotif("⚠️ Pilih minimal 2 invoice"); return; }
  if (typeof mergedInvoiceWA !== "function") { showNotif("⚠️ Fitur belum tersedia"); return; }
  const customer = invs[0].customer || "customer";
  const isRetry = !!retryInvList;
  if (!isRetry) {
    const ok = await showConfirm({
      title: "Gabung & Kirim Invoice",
      message: `Kirim ${invs.length} invoice digabung jadi 1 PDF ke ${customer} (${invs[0].phone})?\n\nInvoice yang dipilih:\n${invs.map(i => `• ${i.id} — ${fmt(i.total)}`).join("\n")}`,
    });
    if (!ok) return;
  }
  setMergeSending(true);
  const res = await mergedInvoiceWA(invs);
  setMergeSending(false);
  if (res.ok) {
    setLastFailedMerge(null);
    exitMergeMode();
  } else if (res.error === "send_failed" && res.retryContext) {
    // Simpan untuk retry — panel retry akan muncul
    setLastFailedMerge({
      invList: res.retryContext.invList,
      customer,
      phone: invs[0].phone,
      ts: new Date(),
    });
  }
};

// Approve semua invoice yang dipilih ke UNPAID tanpa kirim WA
const handleApproveMerged = async () => {
  const invs = mergeSelectedInvs;
  if (invs.length < 2) { showNotif("⚠️ Pilih minimal 2 invoice"); return; }
  // Hanya approve yang masih PENDING_APPROVAL (belum UNPAID)
  const toApprove = invs.filter(i => i.status === "PENDING_APPROVAL" || i.status === "PENDING" || !i.status);
  if (toApprove.length === 0) { showNotif("ℹ️ Semua sudah di-approve. Langsung klik Gabung & Kirim."); return; }
  const customer = invs[0].customer || "customer";
  const ok = await showConfirm({
    title: "Approve & Simpan Invoice",
    message: `Approve ${toApprove.length} invoice untuk ${customer} tanpa kirim WA?\n\n${toApprove.map(i => `• ${i.id} — ${fmt(i.total)}`).join("\n")}\n\nInvoice akan berstatus UNPAID. WA bisa dikirim terpisah.`,
    confirmText: "Ya, Approve",
  });
  if (!ok) return;
  setMergeApproving(true);
  let successCount = 0;
  for (const inv of toApprove) {
    try {
      await approveSaveOnly(inv);
      successCount++;
    } catch (e) {
      console.warn("[handleApproveMerged] gagal approve", inv.id, e.message);
    }
  }
  setMergeApproving(false);
  showNotif(`✅ ${successCount} invoice di-approve — belum dikirim ke customer`);
  exitMergeMode();
};

// Buat 1 invoice baru di DB gabungan dari semua invoice yang dipilih
const handleConsolidateInvoice = async () => {
  const invs = mergeSelectedInvs;
  if (invs.length < 2) { showNotif("⚠️ Pilih minimal 2 invoice"); return; }
  const customer = invs[0].customer || "customer";
  const total = invs.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const ok = await showConfirm({
    title: "Gabungkan Jadi 1 Invoice Baru",
    message: `Gabungkan ${invs.length} invoice untuk ${customer} menjadi 1 invoice baru?\n\n${invs.map(i => `• ${i.id} — ${fmt(i.total)}`).join("\n")}\n\nTotal: ${fmt(total)}\n\n⚠️ Invoice asli akan di-CANCELLED dan diganti invoice gabungan baru.`,
    confirmText: "Ya, Gabungkan",
  });
  if (!ok) return;
  setMergeConsolidating(true);
  const res = await createConsolidatedInvoice(invs);
  setMergeConsolidating(false);
  if (res?.ok) exitMergeMode();
};

const handleRetryFailed = async () => {
  if (!lastFailedMerge) return;
  // Ambil snapshot terbaru dari invoicesData — jangan pakai snapshot lama
  // (status invoice mungkin sudah berubah sejak gagal kirim)
  const freshInvs = lastFailedMerge.invList
    .map(old => invoicesData.find(i => i.id === old.id))
    .filter(Boolean);
  if (freshInvs.length < 2) {
    showNotif("⚠️ Beberapa invoice sudah dihapus — tidak bisa retry");
    dismissRetry();
    return;
  }
  await handleSendMerged(freshInvs);
};
const dismissRetry = () => setLastFailedMerge(null);

const [invoiceSubTab, setInvoiceSubTab] = useState("invoice"); // "invoice" | "quotation" | "voucher" | "pending_ai"

// Pending AI: payment_suggestions menunggu validasi (dari grup Finance / reverse-flow personal)
const [pendingPayments, setPendingPayments] = useState([]);
const [loadingPendingPayments, setLoadingPendingPayments] = useState(false);
const [pendingSelectedInvoice, setPendingSelectedInvoice] = useState({}); // { suggestion_id: invoice_id }
const [pendingPaymentBusy, setPendingPaymentBusy] = useState(null);
const loadPendingPayments = async () => {
  if (!supabase) return;
  setLoadingPendingPayments(true);
  try {
    const { data, error } = await supabase
      .from("payment_suggestions")
      .select("*, ai_extractions:ai_extraction_id(*)")
      .eq("validation_status", "PENDING")
      .or("ai_extraction_id.not.is.null,forwarded_to_group.not.is.null")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    setPendingPayments(data || []);
  } catch (e) {
    showNotif?.("Gagal load Pending AI: " + e.message, "error");
  } finally {
    setLoadingPendingPayments(false);
  }
};
useEffect(() => { if (invoiceSubTab === "pending_ai") loadPendingPayments(); /* eslint-disable-line */ }, [invoiceSubTab]);

// Cari kandidat invoice berdasarkan amount + phone match
const findInvoiceCandidates = (sug) => {
  const target = Number(sug.amount) || 0;
  if (!target) return [];
  const phone = (sug.phone || "").replace(/\D/g, "");
  const unpaid = (invoicesData || []).filter(i =>
    ["UNPAID", "OVERDUE", "PARTIAL_PAID"].includes(i.status) &&
    Math.abs(Number(i.total || 0) - target) < 1000  // toleransi Rp 1.000
  );
  // ranking: phone exact > nama partial > amount only
  const ranked = unpaid.map(i => {
    let score = 1;
    const cust = (customersData || []).find(c => c.id === i.customer_id) || {};
    if (phone && (cust.phone || "").replace(/\D/g, "").endsWith(phone.slice(-9))) score += 5;
    if (sug.sender_name && (cust.name || "").toLowerCase().includes(String(sug.sender_name).toLowerCase().split(" ")[0])) score += 2;
    return { inv: i, cust, score };
  }).sort((a, b) => b.score - a.score);
  return ranked.slice(0, 3);
};

const handleLinkPayment = async (sug) => {
  const invId = pendingSelectedInvoice[sug.id];
  if (!invId) { showNotif?.("Pilih invoice dulu", "error"); return; }
  setPendingPaymentBusy(sug.id);
  try {
    const paidAt = getLocalDate ? getLocalDate() : new Date().toISOString().slice(0,10);
    const { error: payErr } = await markInvoicePaid(supabase, invId, paidAt, auditUserName ? auditUserName() : "AI Validator");
    if (payErr) throw payErr;
    // Patch payment_proof_url di invoice kalau belum ada
    if (sug.image_url) {
      await supabase.from("invoices").update({ payment_proof_url: sug.image_url }).eq("id", invId).is("payment_proof_url", null);
    }
    await supabase.from("payment_suggestions").update({ validation_status: "LINKED", status: "CONFIRMED", invoice_id: invId, resolved_at: new Date().toISOString(), resolved_by: auditUserName ? auditUserName() : "AI Validator" }).eq("id", sug.id);
    if (sug.ai_extraction_id) {
      await supabase.from("ai_extractions").update({ status: "approved", linked_table: "invoices", linked_id: invId }).eq("id", sug.ai_extraction_id);
    }
    showNotif?.("✓ Linked & marked PAID: " + invId, "success");
    setPendingPayments(prev => prev.filter(x => x.id !== sug.id));
  } catch (e) {
    showNotif?.("Gagal link: " + e.message, "error");
  } finally { setPendingPaymentBusy(null); }
};
const handleRejectPayment = async (sug) => {
  showConfirm?.({
    title: "Tolak bukti TF ini?",
    message: "Entri akan ditandai REJECTED. Yakin?",
    onConfirm: async () => {
      setPendingPaymentBusy(sug.id);
      try {
        await supabase.from("payment_suggestions").update({ validation_status: "REJECTED", status: "DISMISSED" }).eq("id", sug.id);
        if (sug.ai_extraction_id) {
          await supabase.from("ai_extractions").update({ status: "rejected" }).eq("id", sug.ai_extraction_id);
        }
        showNotif?.("✕ Rejected", "info");
        setPendingPayments(prev => prev.filter(x => x.id !== sug.id));
      } catch (e) {
        showNotif?.("Gagal: " + e.message, "error");
      } finally { setPendingPaymentBusy(null); }
    }
  });
};
const [voucherList, setVoucherList]     = useState([]);
const [voucherStats, setVoucherStats]   = useState(null);
const [voucherFilter, setVoucherFilter] = useState("active"); // "all" | "active" | "claimed" | "expired"
const [voucherSearch, setVoucherSearch] = useState("");
const [voucherLoading, setVoucherLoading] = useState(false);

const loadVouchers = async (filter = voucherFilter, search = voucherSearch) => {
  setVoucherLoading(true);
  try {
    const hdrs = await apiHeaders();
    const params = new URLSearchParams({ status: filter });
    if (search.trim()) params.set("search", search.trim());
    const r = await fetch("/api/admin-vouchers?" + params.toString(), { headers: hdrs });
    const d = r.ok ? await r.json() : {};
    setVoucherList(d.vouchers || []);
    setVoucherStats(d.stats || null);
  } catch { /* silent */ }
  finally { setVoucherLoading(false); }
};
const [quoPDFData, setQuoPDFData] = useState(null); // quotation untuk preview PDF
const [quoLogoUrl, setQuoLogoUrl] = useState(null);  // logo AClean (data URL) untuk PDF quotation
useEffect(() => {
  let alive = true;
  fetch("/aclean-logo.png").then(r => r.ok ? r.blob() : null).then(blob => {
    if (!blob || !alive) return;
    const reader = new FileReader();
    reader.onload = () => { if (alive) setQuoLogoUrl(reader.result); };
    reader.readAsDataURL(blob);
  }).catch(() => {});
  return () => { alive = false; };
}, []);
const [addonModalInvId, setAddonModalInvId] = useState(null);
const [addonItems, setAddonItems] = useState([]);
const [existingAddons, setExistingAddons] = useState([]); // addon yg sudah tersimpan di DB
const [loadingAddons, setLoadingAddons] = useState(false);
const [savingAddon, setSavingAddon] = useState(false);
const addonModalInv = addonModalInvId ? invoicesData.find(i => i.id === addonModalInvId) || null : null;

// Material & jasa instalasi dari price list — filter Install + Material category
const addonPriceOptions = useMemo(() => {
  return (priceListData || [])
    .filter(p => p.is_active !== false)
    .map(p => ({ nama: p.type, satuan: p.unit || "Unit", harga: Number(p.price) || 0, service: p.service }))
    .sort((a, b) => a.service.localeCompare(b.service) || a.nama.localeCompare(b.nama));
}, [priceListData]);

// Recalculate invoice total dari invoice_items di DB — single source of truth
const recalcInvoiceFromItems = async (invoiceId) => {
  const { data: items } = await supabase
    .from("invoice_items").select("item_type,qty,unit_price,subtotal").eq("invoice_id", invoiceId);
  if (!items) return null;
  const sumUnit   = items.filter(i => i.item_type === "unit_ac").reduce((s, i) => s + (i.subtotal || i.qty * i.unit_price), 0);
  const sumPaket  = items.filter(i => ["paket","jasa"].includes(i.item_type)).reduce((s, i) => s + (i.subtotal || i.qty * i.unit_price), 0);
  const sumAddon  = items.filter(i => i.item_type === "addon").reduce((s, i) => s + (i.subtotal || i.qty * i.unit_price), 0);
  const inv = invoicesData.find(i => i.id === invoiceId);
  const discount   = inv?.discount || 0;
  const tradeIn    = inv?.trade_in_amount || 0;
  const paidAmount = Number(inv?.paid_amount) || 0;
  const newTotal     = sumUnit + sumPaket + sumAddon - discount - tradeIn;
  const newMaterial  = sumAddon;
  const newLabor     = sumPaket;
  const newRemaining = Math.max(0, newTotal - paidAmount);
  // Status logic:
  // - remaining = 0  → PAID
  // - remaining > 0 + paid_amount > 0  → PARTIAL_PAID (DP/cicilan)
  // - remaining > 0 + paid_amount = 0  → pertahankan status (UNPAID/OVERDUE/PENDING_APPROVAL)
  //   kecuali status lama PAID (artinya ada tambahan tagihan setelah lunas) → demote ke UNPAID
  let newStatus;
  if (newRemaining <= 0) {
    newStatus = "PAID";
  } else if (paidAmount > 0) {
    newStatus = "PARTIAL_PAID";
  } else if (inv?.status === "PAID") {
    newStatus = "UNPAID"; // ada tambahan tagihan setelah lunas
  } else {
    newStatus = inv?.status || "UNPAID";
  }
  const { error } = await supabase.from("invoices").update({
    total: newTotal, material: newMaterial, labor: newLabor,
    remaining_amount: newRemaining, status: newStatus,
  }).eq("id", invoiceId);
  if (error) throw error;
  setInvoicesData(prev => prev.map(i => i.id === invoiceId
    ? { ...i, total: newTotal, material: newMaterial, labor: newLabor, remaining_amount: newRemaining, status: newStatus }
    : i));
  return { newTotal, newMaterial, newRemaining, newStatus };
};

const handleSaveAddon = async () => {
  if (!addonModalInv) return;
  const validItems = addonItems.filter(a => a.nama && a.qty > 0 && a.harga > 0);
  if (validItems.length === 0) { showNotif("⚠️ Isi minimal 1 item"); return; }
  setSavingAddon(true);
  try {
    // Merge item nama+harga sama dalam satu session
    const merged = [];
    validItems.forEach(a => {
      const ex = merged.find(m => m.nama === a.nama && m.harga === a.harga);
      if (ex) ex.qty += a.qty;
      else merged.push({ ...a });
    });
    // qty & unit_price di DB adalah INTEGER — round eksplisit
    const rows = merged.map(a => ({
      invoice_id: addonModalInv.id, item_type: "addon",
      description: a.nama,
      qty: Math.max(1, parseInt(a.qty, 10) || 1),
      unit_price: Math.max(0, parseInt(a.harga, 10) || 0),
    }));
    const { error: itemErr } = await supabase.from("invoice_items").insert(rows);
    if (itemErr) throw itemErr;

    await recalcInvoiceFromItems(addonModalInv.id);

    // Refresh existing addons list
    const { data } = await supabase.from("invoice_items").select("id,description,qty,unit_price,subtotal,item_type")
      .eq("invoice_id", addonModalInv.id).eq("item_type", "addon");
    setExistingAddons(data || []);
    setAddonItems([]);
    showNotif(`✅ ${merged.length} item material disimpan`);
  } catch (err) {
    showNotif("❌ Gagal simpan: " + (err.message || err));
  } finally {
    setSavingAddon(false);
  }
};

const handleDeleteAddon = async (item) => {
  if (!addonModalInv) return;
  try {
    const { error } = await supabase.from("invoice_items").delete().eq("id", item.id);
    if (error) throw error;
    setExistingAddons(prev => prev.filter(a => a.id !== item.id));
    await recalcInvoiceFromItems(addonModalInv.id);
    showNotif("🗑 Item dihapus");
  } catch (err) {
    showNotif("❌ Gagal hapus: " + (err.message || err));
  }
};

// Deteksi customer dengan multi-invoice unpaid untuk Group Payment
const multiInvoiceCustomers = useMemo(() => {
  const phoneMap = {};
  invoicesData.forEach(inv => {
    if (!inv.phone || !["UNPAID","OVERDUE","PARTIAL_PAID"].includes(inv.status)) return;
    if (!phoneMap[inv.phone]) phoneMap[inv.phone] = [];
    phoneMap[inv.phone].push(inv);
  });
  return Object.entries(phoneMap).filter(([, arr]) => arr.length > 1);
}, [invoicesData]);

// ── Customer dengan multi-invoice belum lunas, untuk fitur Mode Gabung kirim WA ──
// Pakai samePhone() agar 08xxx vs +62xxx dari customer yg sama ter-group jadi satu.
// Filter status sama dengan mergeFilteredInv supaya picker & stage-select konsisten.
const mergeCandidates = useMemo(() => {
  const groups = []; // [{ phone, customer, invoices: [...] }]
  invoicesData.forEach(inv => {
    if (!inv.phone) return;
    if (!["UNPAID","OVERDUE","PARTIAL_PAID"].includes(inv.status)) return;
    const found = groups.find(g => samePhone(g.phone, inv.phone));
    if (found) found.invoices.push(inv);
    else groups.push({ phone: inv.phone, customer: inv.customer || "(tanpa nama)", invoices: [inv] });
  });
  return groups
    .filter(g => g.invoices.length >= 2)
    .map(g => ({
      ...g,
      invoices: [...g.invoices].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
      totalAll: g.invoices.reduce((s, i) => s + (Number(i.total) || 0), 0),
      sisaAll: g.invoices.reduce((s, i) => {
        if (i.status === "PAID") return s;
        const sisa = i.remaining_amount > 0 ? Number(i.remaining_amount) : Number(i.total) || 0;
        return s + sisa;
      }, 0),
    }))
    .sort((a, b) => b.invoices.length - a.invoices.length); // banyak dulu
}, [invoicesData]);
// Saat Mode Gabung "select" aktif, tampilkan HANYA invoice customer terpilih (semua, tanpa pagination)
// Filter status: hanya invoice yang masih punya tagihan (UNPAID/OVERDUE/PARTIAL_PAID) — sesuai intent fitur.
const mergeFilteredInv = useMemo(() => {
  if (mergeStage !== "select" || !mergePhone) return null;
  return invoicesData
    .filter(i => i.phone && samePhone(i.phone, mergePhone) && ["UNPAID","OVERDUE","PARTIAL_PAID"].includes(i.status))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}, [mergeStage, mergePhone, invoicesData]);

const displayInv = mergeFilteredInv || filteredInv;
const totPgI = mergeFilteredInv ? 1 : (Math.ceil(filteredInv.length / INV_PAGE_SIZE) || 1);
const curPgI = Math.min(invoicePage, totPgI);
const pageInv = mergeFilteredInv ? mergeFilteredInv : filteredInv.slice((curPgI - 1) * INV_PAGE_SIZE, curPgI * INV_PAGE_SIZE);
return (
  <div style={{ display: "grid", gap: 14 }}>
    {/* Sub-tab: Invoice | Quotation | Voucher */}
    <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + cs.border, paddingBottom: 8 }}>
      {[
        { key: "invoice",   label: "🧾 Invoice" },
        ...(currentUser?.role !== "Finance" ? [{ key: "quotation", label: "📋 Quotation" }] : []),
        ...(["Owner","Admin"].includes(currentUser?.role) ? [{ key: "voucher", label: "🎁 Voucher" }] : []),
        ...(["Owner","Admin"].includes(currentUser?.role) ? [{ key: "pending_ai", label: "🤖 Pending AI" + (pendingPayments.length ? ` (${pendingPayments.length})` : "") }] : []),
      ].map(t => (
        <button key={t.key} onClick={() => {
          setInvoiceSubTab(t.key);
          if (t.key === "voucher") loadVouchers("active", "");
        }}
          style={{ padding: "7px 18px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: invoiceSubTab === t.key ? 800 : 500,
            background: invoiceSubTab === t.key ? cs.accent + "22" : "transparent",
            color: invoiceSubTab === t.key ? cs.accent : cs.muted }}>
          {t.label}
        </button>
      ))}
    </div>

    {/* Quotation sub-view */}
    {invoiceSubTab === "quotation" && (
      <QuotationView
        quotationsData={quotationsData || []}
        setQuotationsData={setQuotationsData}
        customersData={customersData}
        showNotif={showNotif}
        showConfirm={showConfirm}
        currentUser={currentUser}
        supabase={supabase}
        getLocalDate={getLocalDate}
        fmt={fmt}
        priceListData={priceListData}
        invoicesData={invoicesData}
        setInvoicesData={setInvoicesData}
        ordersData={ordersData}
        setOrdersData={setOrdersData}
        sendWAFn={sendWAFn}
        onOpenPDF={(quo) => setQuoPDFData(quo)}
        uploadQuotationPDFFn={uploadQuotationPDFFn}
      />
    )}

    {/* Quotation PDF Preview Modal */}
    {quoPDFData && (
      <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 450, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setQuoPDFData(null)}>
        <div style={{ background: cs.surface, borderRadius: 16, padding: 16, width: "100%", maxWidth: 540 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>👁 Preview PDF — {quoPDFData.id}</div>
            <button onClick={() => setQuoPDFData(null)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
          </div>
          <BlobProvider document={<QuotationPDF quo={quoPDFData} appSettings={appSettings || {}} logoUrl={quoLogoUrl} />}>
            {({ url, loading, error }) => {
              if (loading) return <div style={{ textAlign: "center", padding: 24, color: cs.muted }}>Membuat PDF...</div>;
              if (error) return <div style={{ textAlign: "center", padding: 24, color: "#f87171" }}>Gagal buat PDF</div>;
              return (
                <div style={{ display: "flex", gap: 10 }}>
                  <a href={url} target="_blank" rel="noreferrer"
                    style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: cs.accent, color: "#fff", fontWeight: 700, fontSize: 13, textAlign: "center", textDecoration: "none" }}>
                    🔗 Buka PDF
                  </a>
                  <a href={url} download={`${quoPDFData.id}.pdf`}
                    style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: "#22c55e22", border: "1px solid #22c55e44", color: "#4ade80", fontWeight: 700, fontSize: 13, textAlign: "center", textDecoration: "none" }}>
                    ⬇️ Download
                  </a>
                </div>
              );
            }}
          </BlobProvider>
          <div style={{ marginTop: 10, padding: "8px 12px", background: cs.card, borderRadius: 8, fontSize: 12, color: cs.muted }}>
            Customer: <strong style={{ color: cs.text }}>{quoPDFData.customer}</strong> · Total: <strong style={{ color: cs.accent }}>{fmt(quoPDFData.total)}</strong>
          </div>
        </div>
      </div>
    )}

    {/* Voucher Admin sub-view */}
    {invoiceSubTab === "voucher" && (
      <VoucherAdminTab
        voucherList={voucherList}
        voucherStats={voucherStats}
        voucherFilter={voucherFilter}
        setVoucherFilter={setVoucherFilter}
        voucherSearch={voucherSearch}
        setVoucherSearch={setVoucherSearch}
        voucherLoading={voucherLoading}
        loadVouchers={loadVouchers}
        apiHeaders={apiHeaders}
        showNotif={showNotif}
        fmt={fmt}
      />
    )}

    {/* Invoice view (default) */}
    {/* Pending AI sub-view (Owner/Admin) */}
    {invoiceSubTab === "pending_ai" && (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 12, color: cs.muted }}>
            Bukti TF dari grup Finance / reverse-flow personal. Pilih invoice yang dimaksud lalu Link.
          </div>
          <button onClick={loadPendingPayments} disabled={loadingPendingPayments}
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
            {loadingPendingPayments ? "Loading..." : "↻ Refresh"}
          </button>
        </div>
        {pendingPayments.length === 0 && !loadingPendingPayments && (
          <div style={{ padding: 24, background: cs.card, borderRadius: 10, textAlign: "center", color: cs.muted, fontSize: 13 }}>
            Tidak ada bukti TF menunggu validasi.
          </div>
        )}
        {pendingPayments.map(sug => {
          const ai = sug.ai_extractions || {};
          const candidates = findInvoiceCandidates(sug);
          const conf = sug.ai_extractions?.confidence || "?";
          const confColor = conf === "HIGH" ? "#10b981" : conf === "MEDIUM" ? "#f59e0b" : "#ef4444";
          const selected = pendingSelectedInvoice[sug.id] || candidates[0]?.inv?.id;
          return (
            <div key={sug.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 14, display: "flex", gap: 14 }}>
              {sug.image_url && (
                <a href={sug.image_url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                  <img src={sug.image_url} alt="bukti TF" style={{ width: 160, height: 200, objectFit: "cover", borderRadius: 8, border: "1px solid " + cs.border }}
                    onError={e => { e.target.style.display = "none"; }} />
                </a>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: cs.text }}>{fmt(sug.amount || 0)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: confColor + "22", color: confColor }}>{conf}</span>
                  {sug.forwarded_to_group && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "#ec489922", color: "#ec4899" }}>📥 Auto-forwarded</span>}
                </div>
                <div style={{ fontSize: 12, color: cs.text, marginBottom: 4 }}>🏦 {sug.bank || "—"} · 📅 {sug.transfer_date || "—"}</div>
                <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8 }}>👤 {sug.sender_name || "—"} ({sug.phone || "—"})</div>
                {ai.notes && <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic", marginBottom: 8 }}>🧠 {ai.notes}</div>}

                <div style={{ marginTop: 8, padding: 10, background: cs.surface, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Match Candidates ({candidates.length})</div>
                  {candidates.length === 0 && <div style={{ fontSize: 11, color: cs.muted }}>Tidak ada invoice UNPAID dengan jumlah {fmt(sug.amount || 0)}.</div>}
                  {candidates.map(({ inv, cust, score }) => (
                    <label key={inv.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer", fontSize: 12, color: cs.text }}>
                      <input type="radio" name={`cand-${sug.id}`}
                        checked={selected === inv.id}
                        onChange={() => setPendingSelectedInvoice(s => ({ ...s, [sug.id]: inv.id }))} />
                      <span><b>{cust.name || "?"}</b> · {inv.id} · {fmt(inv.total)} · <span style={{ color: cs.muted }}>{inv.status}</span> · <span style={{ color: "#10b981", fontSize: 10 }}>score {score}</span></span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button disabled={pendingPaymentBusy === sug.id || !selected} onClick={() => handleLinkPayment(sug)}
                    style={{ background: "#10b98122", border: "1px solid #10b98155", color: "#10b981", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: selected ? "pointer" : "not-allowed", opacity: selected ? 1 : 0.5 }}>
                    ✓ Link & Mark PAID
                  </button>
                  <button disabled={pendingPaymentBusy === sug.id} onClick={() => handleRejectPayment(sug)}
                    style={{ background: "#ef444422", border: "1px solid #ef444455", color: "#ef4444", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
                    ✕ Reject
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {invoiceSubTab === "invoice" && <>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>🧾 Invoice <span style={{ fontSize: 13, color: cs.muted, fontWeight: 400 }}>({filteredInv.length})</span></div>
      {currentUser?.role !== "Finance" && (
        <button onClick={() => setShowAcUnitModal(true)} style={{
          background: "#f59e0b22", border: "1px solid #f59e0b55", color: "#f59e0b",
          padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12
        }}>🛒 Jual Unit AC</button>
      )}
      <button onClick={() => {
        const unpaid = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE");
        if (unpaid.length === 0) { showNotif("Tidak ada invoice UNPAID/OVERDUE."); return; }
        const ok = window.confirm(`Kirim reminder WhatsApp ke ${unpaid.length} customer dengan invoice belum lunas?\n\nYakin ingin melanjutkan?`);
        if (!ok) return;
        unpaid.forEach(inv => invoiceReminderWA(inv));
        showNotif(`📨 Reminder dikirim ke ${unpaid.length} customer`);
      }}
        style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
        🔔 Kirim Reminder ({unpaidCnt})
      </button>
      {currentUser?.role !== "Finance" && (
        <button onClick={() => {
          if (mergeStage) { exitMergeMode(); return; }
          if (mergeCandidates.length === 0) {
            showNotif("Tidak ada customer dengan lebih dari 1 invoice");
            return;
          }
          setMergeStage("picker");
        }}
          style={{
            background: mergeStage ? cs.accent : cs.accent + "22",
            border: "1px solid " + cs.accent + (mergeStage ? "" : "44"),
            color: mergeStage ? "#fff" : cs.accent,
            padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12
          }}
          title={mergeStage ? "Keluar mode gabung" : `Gabung 2-${MERGE_MAX} invoice dari customer yang sama jadi 1 PDF`}
        >
          {mergeStage ? "✕ Keluar Mode Gabung" : `🗂️ Mode Gabung Invoice (${mergeCandidates.length})`}
        </button>
      )}
      <button onClick={async () => {
        try {
          if (!window.XLSX) {
            await new Promise((res, rej) => {
              const s = document.createElement("script");
              s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
              s.onload = res; s.onerror = rej;
              document.head.appendChild(s);
            });
          }
          const XLSX = window.XLSX;
          const rows = filteredInv;
          const rangeLabel = invoiceDateFrom || invoiceDateTo
            ? `${invoiceDateFrom || "awal"}_sd_${invoiceDateTo || "skrg"}`
            : (invoiceFilter !== "Semua" ? invoiceFilter.replace(/\s/g, "_") : "Semua");
          const data = rows.map((inv, i) => ({
            "No": i + 1, "ID Invoice": inv.id || "-",
            "Tgl Dibuat": inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID") : "-",
            "Customer": inv.customer || "-", "No HP": inv.phone || "-",
            "Layanan": inv.service || "-", "Unit": Array.isArray(inv.units) ? inv.units.length : (inv.units || 1),
            "Status": inv.status || "-", "Total (Rp)": inv.total || 0,
            "Dibayar (Rp)": inv.status === "PAID" ? (inv.total || 0) : (inv.paid_amount || 0),
            "Sisa (Rp)": inv.status === "PARTIAL_PAID" ? (inv.remaining_amount ?? ((inv.total||0)-(inv.paid_amount||0))) : (["UNPAID","OVERDUE"].includes(inv.status) ? (inv.total||0) : 0),
            "Teknisi": inv.teknisi || "-",
            "Tgl Bayar": inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("id-ID") : "-",
            "Metode Bayar": inv.paid_method || "-",
          }));
          const totalPaid = rows.filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
          const totalPartial = rows.filter(i => i.status === "PARTIAL_PAID").reduce((s, i) => s + (i.paid_amount || 0), 0);
          const totalUnpaid = rows.filter(i => ["UNPAID", "OVERDUE"].includes(i.status)).reduce((s, i) => s + (i.total || 0), 0);
          const summary = [
            { "Keterangan": "Total Invoice", "Nilai": rows.length },
            { "Keterangan": "Invoice PAID", "Nilai": rows.filter(i => i.status === "PAID").length },
            { "Keterangan": "Invoice PARTIAL", "Nilai": rows.filter(i => i.status === "PARTIAL_PAID").length },
            { "Keterangan": "Invoice UNPAID", "Nilai": rows.filter(i => i.status === "UNPAID").length },
            { "Keterangan": "Invoice OVERDUE", "Nilai": rows.filter(i => i.status === "OVERDUE").length },
            { "Keterangan": "Omset Terbayar (Rp)", "Nilai": totalPaid },
            { "Keterangan": "Partial Terbayar (Rp)", "Nilai": totalPartial },
            { "Keterangan": "Belum Terbayar (Rp)", "Nilai": totalUnpaid },
          ];
          const wb = XLSX.utils.book_new();
          const ws1 = XLSX.utils.json_to_sheet(data);
          ws1["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 13 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 5 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
          const ws2 = XLSX.utils.json_to_sheet(summary);
          ws2["!cols"] = [{ wch: 22 }, { wch: 16 }];
          XLSX.utils.book_append_sheet(wb, ws1, "Invoice");
          XLSX.utils.book_append_sheet(wb, ws2, "Summary");
          XLSX.writeFile(wb, `Invoice_${rangeLabel}_${getLocalDate()}.xlsx`);
          showNotif(`✅ Export ${rows.length} invoice → .xlsx berhasil!`);
        } catch (err) { showNotif("❌ Export gagal: " + err.message); }
      }}
        style={{
          background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green,
          padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
          display: "flex", alignItems: "center", gap: 6
        }}>
        📊 Export XLSX ({filteredInv.length})
      </button>
      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "4px 8px"
        }}>
          <span style={{ fontSize: 11, color: cs.muted, whiteSpace: "nowrap" }}>📥 Rekap Harian:</span>
          <input type="date" id="rekapDatePickerInv"
            defaultValue={TODAY}
            style={{
              background: cs.card, border: "1px solid " + cs.border, borderRadius: 6,
              padding: "4px 8px", fontSize: 11, color: cs.text, colorScheme: "dark", cursor: "pointer"
            }}
          />
          <button
            onClick={() => {
              const d = document.getElementById("rekapDatePickerInv")?.value || TODAY;
              downloadRekapHarian(d);
            }}
            style={{
              background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent,
              padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12,
              whiteSpace: "nowrap"
            }}>
            ⬇️ Download
          </button>
        </div>
      )}
    </div>
    {/* ── Date range picker + Download rekap ── */}
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 12px"
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>📅 Filter Tanggal:</span>
      <input type="date" value={invoiceDateFrom}
        onChange={e => { setInvoiceDateFrom(e.target.value); setInvoicePage(1); }}
        style={{
          background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
          padding: "5px 9px", fontSize: 12, color: cs.text, colorScheme: "dark", cursor: "pointer"
        }}
      />
      <span style={{ fontSize: 12, color: cs.muted }}>–</span>
      <input type="date" value={invoiceDateTo}
        onChange={e => { setInvoiceDateTo(e.target.value); setInvoicePage(1); }}
        style={{
          background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
          padding: "5px 9px", fontSize: 12, color: cs.text, colorScheme: "dark", cursor: "pointer"
        }}
      />
      {(invoiceDateFrom || invoiceDateTo) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: cs.accent, fontWeight: 600 }}>
            {filteredInv.length} invoice
          </span>
          <button onClick={() => { setInvoiceDateFrom(""); setInvoiceDateTo(""); setInvoicePage(1); }}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 99,
              background: cs.red + "22", border: "1px solid " + cs.red + "44",
              color: cs.red, cursor: "pointer", fontWeight: 600
            }}>
            ✕ Reset
          </button>
        </div>
      )}

      {/* ── Download sesuai filter tanggal aktif ── */}
      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
        <button onClick={async () => {
          try {
            if (!window.XLSX) {
              await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
              });
            }
            showNotif("⏳ Mengambil data dari server...");
            let q = supabase.from("invoices")
              .select("id,job_id,customer,phone,service,units,labor,material,discount,trade_in,trade_in_amount,total,status,due,paid_at,sent_at,created_at,teknisi,paid_method")
              .order("created_at", { ascending: false });
            if (invoiceDateFrom) q = q.gte("created_at", invoiceDateFrom + "T00:00:00");
            if (invoiceDateTo) q = q.lte("created_at", invoiceDateTo + "T23:59:59");
            const { data: rows, error } = await q;
            if (error) { showNotif("❌ Gagal fetch: " + error.message); return; }
            const label = invoiceDateFrom || invoiceDateTo
              ? `${invoiceDateFrom || "awal"}_sd_${invoiceDateTo || "skrg"}`
              : "Semua";
            const XLSX = window.XLSX;
            const data = (rows || []).map((inv, i) => ({
              "No": i + 1,
              "ID Invoice": inv.id || "-",
              "Tgl Dibuat": inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID") : "-",
              "Customer": inv.customer || "-",
              "No HP": inv.phone || "-",
              "Layanan": inv.service || "-",
              "Unit": inv.units || 1,
              "Teknisi": inv.teknisi || "-",
              "Status": inv.status || "-",
              "Jasa (Rp)": inv.labor || 0,
              "Material (Rp)": inv.material || 0,
              "Discount (Rp)": inv.discount || 0,
              "Trade-In (Rp)": inv.trade_in ? (inv.trade_in_amount || 0) : 0,
              "Total (Rp)": inv.total || 0,
              "Dibayar (Rp)": inv.status === "PAID" ? (inv.total || 0) : (inv.paid_amount || 0),
              "Sisa (Rp)": inv.status === "PARTIAL_PAID" ? (inv.remaining_amount ?? ((inv.total||0)-(inv.paid_amount||0))) : (["UNPAID","OVERDUE"].includes(inv.status) ? (inv.total||0) : 0),
              "Tgl Bayar": inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("id-ID") : "-",
              "Metode Bayar": inv.paid_method || "-",
            }));
            const totalPaid = (rows || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
            const totalPartial = (rows || []).filter(i => i.status === "PARTIAL_PAID").reduce((s, i) => s + (i.paid_amount || 0), 0);
            const totalUnpaid = (rows || []).filter(i => ["UNPAID", "OVERDUE"].includes(i.status)).reduce((s, i) => s + (i.total || 0), 0);
            const totalDiskon = (rows || []).reduce((s, i) => s + (i.discount || 0) + (i.trade_in ? (i.trade_in_amount || 0) : 0), 0);
            const summary = [
              { "Keterangan": "Periode", "Nilai": label },
              { "Keterangan": "Total Invoice", "Nilai": (rows || []).length },
              { "Keterangan": "Invoice PAID", "Nilai": (rows || []).filter(i => i.status === "PAID").length },
              { "Keterangan": "Invoice PARTIAL", "Nilai": (rows || []).filter(i => i.status === "PARTIAL_PAID").length },
              { "Keterangan": "Invoice UNPAID", "Nilai": (rows || []).filter(i => i.status === "UNPAID").length },
              { "Keterangan": "Invoice OVERDUE", "Nilai": (rows || []).filter(i => i.status === "OVERDUE").length },
              { "Keterangan": "Omset Terbayar (Rp)", "Nilai": totalPaid },
              { "Keterangan": "Partial Terbayar (Rp)", "Nilai": totalPartial },
              { "Keterangan": "Belum Terbayar (Rp)", "Nilai": totalUnpaid },
              { "Keterangan": "Total Potongan/Diskon (Rp)", "Nilai": totalDiskon },
            ];
            const wb = XLSX.utils.book_new();
            const ws1 = XLSX.utils.json_to_sheet(data);
            ws1["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 13 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 5 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }];
            const ws2 = XLSX.utils.json_to_sheet(summary);
            ws2["!cols"] = [{ wch: 24 }, { wch: 18 }];
            XLSX.utils.book_append_sheet(wb, ws1, "Invoice");
            XLSX.utils.book_append_sheet(wb, ws2, "Summary");
            XLSX.writeFile(wb, `Invoice_${label}_${getLocalDate()}.xlsx`);
            showNotif(`✅ Export ${(rows || []).length} invoice berhasil!`);
          } catch (err) { showNotif("❌ Export gagal: " + err.message); }
        }}
          style={{
            marginLeft: "auto", fontSize: 11, padding: "4px 12px", borderRadius: 7, whiteSpace: "nowrap",
            background: cs.green + "20", border: "1px solid " + cs.green + "44", color: cs.green,
            cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5
          }}>
          ⬇️ Download {invoiceDateFrom || invoiceDateTo ? "Filter Ini" : "Semua"}
        </button>
      )}
    </div>

    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: cs.muted, pointerEvents: "none" }}>🔍</span>
      <input id="searchInvoice" value={searchInvoice} onChange={e => { setSearchInvoice(smartSearchNormalize(e.target.value)); setInvoicePage(1); }}
        placeholder="Cari customer, telp, ID invoice, Job ID, atau teknisi..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
      {searchInvoice && <button onClick={() => { setSearchInvoice(""); setInvoicePage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
    </div>
    {searchInvoice && searchInvoice.length >= 2 && (
      <div style={{ fontSize: 11, color: cs.muted, marginTop: -8, paddingLeft: 4 }}>
        {searchLoading ? "🔎 Mencari di seluruh database..." : "📂 Termasuk hasil dari arsip lama (server search aktif)"}
      </div>
    )}
    {/* Status filter pills — SIM-3 */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[
        ["Semua", cs.muted],
        ["Hari Ini", "#f97316"],
        ["PENDING_APPROVAL", cs.accent],
        ["UNPAID", cs.yellow],
        ["OVERDUE", cs.red],
        ["PARTIAL_PAID", "#06b6d4"],
        ["PAID", cs.green],
        ["Garansi", "#22d3ee"],
        ["Tanpa Bukti", "#f43f5e"],
      ].map(([s, col]) => {
        const todayStr = getLocalDate();
        const tanpaBuktiCnt = invoicesData.filter(i => i.status === "PAID" && i.total > 0 && !i.payment_proof_url && i.payment_proof_url !== "verified-no-proof").length;
        const cnt = s === "Semua" ? invoicesData.length
          : s === "Hari Ini" ? invoicesData.filter(inv => (inv.created_at || "").slice(0, 10) === todayStr).length
            : s === "Garansi" ? garansiAktif.length
              : s === "Tanpa Bukti" ? tanpaBuktiCnt
                : invoicesData.filter(i => i.status === s).length;
        const showBadge = s === "Garansi" && garansiKritis.length > 0;
        const showTanpaBuktiBadge = s === "Tanpa Bukti" && tanpaBuktiCnt > 0;
        return (
          <button key={s} onClick={() => { setInvoiceFilter(s); setInvoicePage(1); }}
            style={{
              padding: "6px 14px", borderRadius: 99, border: "1px solid " + (invoiceFilter === s ? col : cs.border),
              background: invoiceFilter === s ? col + "22" : cs.card, color: invoiceFilter === s ? col : cs.muted,
              cursor: "pointer", fontSize: 12, fontWeight: invoiceFilter === s ? 700 : 500, position: "relative"
            }}>
            {s === "Semua" ? "Semua" : s === "PENDING_APPROVAL" ? "Approval" : s === "PARTIAL_PAID" ? "💳 Partial" : s === "Garansi" ? "🛡️ Garansi" : s === "Tanpa Bukti" ? "⚠️ Tanpa Bukti" : s} ({cnt})
            {showBadge && <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 9, padding: "1px 5px", fontWeight: 800 }}>{garansiKritis.length}</span>}
            {showTanpaBuktiBadge && <span style={{ position: "absolute", top: -4, right: -4, background: "#f43f5e", color: "#fff", borderRadius: 99, fontSize: 9, padding: "1px 5px", fontWeight: 800 }}>{tanpaBuktiCnt}</span>}
          </button>
        );
      })}
    </div>
    {/* Group Payment banner — muncul jika ada customer multi-invoice */}
    {multiInvoiceCustomers.length > 0 && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && setGroupPaymentCtx && (
      <div style={{ background: "#06b6d418", border: "1px solid #06b6d444", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#06b6d4" }}>💳 Multi-Invoice</span>
        <span style={{ fontSize: 12, color: cs.muted, flex: 1 }}>
          {multiInvoiceCustomers.length} customer punya {multiInvoiceCustomers.reduce((s,[,arr]) => s + arr.length, 0)} invoice unpaid
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {multiInvoiceCustomers.slice(0, 3).map(([phone, invs]) => (
            <button key={phone}
              onClick={() => setGroupPaymentCtx({
                phone,
                invoices: invs,
                suggestedAmount: invs.reduce((s, i) => s + (i.total || 0), 0),
                proofUrl: null,
                method: "transfer",
                suggId: null,
              })}
              style={{ background: "#06b6d422", border: "1px solid #06b6d466", color: "#06b6d4", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              {invs[0]?.customer || phone} ({invs.length} inv · {fmt(invs.reduce((s,i) => s+(i.total||0), 0))})
            </button>
          ))}
          {multiInvoiceCustomers.length > 3 && (
            <span style={{ fontSize: 11, color: cs.muted, alignSelf: "center" }}>+{multiInvoiceCustomers.length - 3} lainnya</span>
          )}
        </div>
      </div>
    )}

    {invoiceFilter === "Tanpa Bukti" && (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          disabled={scanningBukti}
          onClick={async () => {
            setScanningBukti(true);
            try {
              const headers = apiHeaders ? await apiHeaders() : {};
              const res = await fetch("/api/cron-reminder?task=bukti-bayar", { method: "GET", headers });
              const json = await res.json().catch(() => ({}));
              const updated = json.updated ?? 0;
              if (updated > 0) {
                const { data } = await supabase
                  .from("invoices")
                  .select("id,job_id,customer,phone,service,units,labor,material,discount,trade_in,trade_in_amount,total,status,due,paid_at,sent,sent_at,created_at,follow_up,teknisi,garansi_days,garansi_expires,paid_method,materials_detail,payment_proof_url,repair_gratis")
                  .order("created_at", { ascending: false })
                  .limit(300);
                if (data) setInvoicesData(data);
                showNotif(`Scan selesai — ${updated} bukti bayar ditemukan & dilink`);
              } else {
                showNotif("Scan selesai — tidak ada bukti baru ditemukan di R2");
              }
            } catch (e) {
              showNotif("Scan gagal: " + e.message);
            } finally {
              setScanningBukti(false);
            }
          }}
          style={{
            padding: "7px 16px", borderRadius: 8, border: "1px solid #f43f5e66",
            background: scanningBukti ? cs.surface : "#f43f5e18", color: scanningBukti ? cs.muted : "#f43f5e",
            cursor: scanningBukti ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
          }}>
          {scanningBukti ? "Sedang scan R2..." : "Scan Bukti Sekarang"}
        </button>
        {/* Konfirmasi Cash — hanya Finance & Owner */}
        {(currentUser?.role === "Finance" || currentUser?.role === "Owner") && (() => {
          const targets = filteredInv.filter(i => i.status === "PAID" && i.total > 0 && !i.repair_gratis && !i.payment_proof_url);
          if (targets.length === 0) return null;
          return (
            <button
              disabled={confirmingCash}
              onClick={async () => {
                setConfirmingCash(true);
                try {
                  const ids = targets.map(i => i.id);
                  const { error } = await supabase.from("invoices")
                    .update({ payment_proof_url: "verified-no-proof", notes: "Dikonfirmasi cash oleh Finance" })
                    .in("id", ids);
                  if (error) throw error;
                  setInvoicesData(prev => prev.map(i => ids.includes(i.id)
                    ? { ...i, payment_proof_url: "verified-no-proof", notes: "Dikonfirmasi cash oleh Finance" }
                    : i));
                  addAgentLog("FINANCE_CONFIRM_CASH", `${ids.length} invoice dikonfirmasi cash: ${ids.slice(0,3).join(", ")}${ids.length > 3 ? "..." : ""}`, "SUCCESS");
                  showNotif(`✅ ${ids.length} invoice dikonfirmasi sebagai cash`);
                } catch (e) {
                  showNotif("❌ Gagal konfirmasi: " + e.message);
                } finally {
                  setConfirmingCash(false);
                }
              }}
              style={{
                padding: "7px 16px", borderRadius: 8, border: "1px solid #10b98166",
                background: confirmingCash ? cs.surface : "#10b98118", color: confirmingCash ? cs.muted : "#10b981",
                cursor: confirmingCash ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
              }}>
              {confirmingCash ? "Memproses..." : `✓ Konfirmasi Cash (${targets.length})`}
            </button>
          );
        })()}
        <span style={{ fontSize: 11, color: cs.muted }}>Cari bukti transfer di R2 dan link ke invoice PAID tanpa bukti</span>
      </div>
    )}

    {/* ── Retry panel: muncul jika pengiriman terakhir gagal ── */}
    {lastFailedMerge && (
      <div style={{
        background: "#f59e0b18", border: "1px solid #f59e0b66", borderRadius: 10,
        padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 10
      }}>
        <div style={{ fontSize: 12, color: cs.text }}>
          <b style={{ color: "#f59e0b" }}>⚠️ Pengiriman terakhir gagal</b>
          <span style={{ marginLeft: 8, color: cs.muted }}>
            {lastFailedMerge.invList.length} invoice ke {lastFailedMerge.customer} ({lastFailedMerge.phone}) — {lastFailedMerge.ts.toLocaleTimeString("id-ID")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={handleRetryFailed} disabled={mergeSending}
            style={{
              background: mergeSending ? cs.muted + "44" : "#f59e0b",
              border: "none", color: "#fff",
              padding: "7px 14px", borderRadius: 8,
              cursor: mergeSending ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 12
            }}>
            {mergeSending ? "⏳ Mengirim..." : "🔄 Coba Lagi"}
          </button>
          <button onClick={dismissRetry}
            style={{ background: "transparent", border: "1px solid " + cs.muted + "55", color: cs.muted, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
            Tutup
          </button>
        </div>
      </div>
    )}

    {/* ── Mode Gabung — banner instruksi (stage select) ── */}
    {mergeMode && (() => {
      const cust = pageInv[0] || {};
      return (
        <div style={{
          background: cs.accent + "12", border: "1px dashed " + cs.accent + "66", borderRadius: 10,
          padding: "10px 14px", marginBottom: 4, display: "flex", justifyContent: "space-between",
          alignItems: "center", flexWrap: "wrap", gap: 10
        }}>
          <div style={{ fontSize: 12, color: cs.text }}>
            <b style={{ color: cs.accent }}>🗂️ Mode Gabung Invoice — {cust.customer || "—"}</b>
            <span style={{ marginLeft: 8, color: cs.muted }}>
              📱 {cust.phone || "—"} · {pageInv.length} invoice tersedia · centang 2-{MERGE_MAX} untuk gabung
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { setMergeStage("picker"); setMergeSelectedIds([]); }}
              style={{ background: "transparent", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
              ← Ganti Customer
            </button>
            {mergeSelectedIds.length > 0 && (
              <button onClick={clearMergeSelection}
                style={{ background: "transparent", border: "1px solid " + cs.muted + "55", color: cs.muted, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                Bersihkan ({mergeSelectedIds.length})
              </button>
            )}
          </div>
        </div>
      );
    })()}

    <div style={{ display: "grid", gap: 12 }}>
      {pageInv.map(inv => {
        const isSelected = mergeMode && mergeSelectedIds.includes(inv.id);
        const atCapacity = mergeMode && !isSelected && mergeSelectedIds.length >= MERGE_MAX;
        return (
        <div key={inv.id} style={{
          background: isSelected ? cs.accent + "12" : cs.card,
          border: "2px solid " + (isSelected ? cs.accent : (statusColor[inv.status] || cs.border) + "44"),
          opacity: atCapacity ? 0.5 : 1,
          borderRadius: 14, padding: 18,
          transition: "all 0.15s",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {mergeMode && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={atCapacity}
                  onChange={() => toggleMergeId(inv.id)}
                  style={{ width: 20, height: 20, cursor: atCapacity ? "not-allowed" : "pointer", accentColor: cs.accent }}
                  title={atCapacity ? `Maksimal ${MERGE_MAX} invoice per gabungan` : "Pilih invoice untuk digabung"}
                />
              )}
              <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 14 }}>{inv.id}</span>
              <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 99, background: (statusColor[inv.status] || cs.muted) + "22", color: statusColor[inv.status] || cs.muted, border: "1px solid " + (statusColor[inv.status] || cs.muted) + "44", fontWeight: 700 }}>{inv.status.replace(/_/g, " ")}</span>
              {inv.follow_up > 0 && <span style={{ fontSize: 10, color: cs.yellow }}>Follow-up: {inv.follow_up}x</span>}
              {/* Badge audit kirim WA — tampil jika sudah pernah dikirim */}
              {(inv.wa_sent_count || 0) > 0 && (
                <span
                  title={`Terakhir kirim: ${inv.wa_last_sent_at ? new Date(inv.wa_last_sent_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}${inv.wa_last_sent_mode ? " (" + inv.wa_last_sent_mode + ")" : ""}`}
                  style={{ fontSize: 10, padding: "2px 6px", borderRadius: 99, background: "#25D36618", color: "#25D366", border: "1px solid #25D36644", fontWeight: 700 }}>
                  📨 {inv.wa_sent_count}x{inv.wa_last_sent_mode === "merged" ? " (gabung)" : ""}
                </span>
              )}
              {/* Badge multi-hari: tampil jika ada child orders MULTI-DAY terkait invoice ini */}
              {(() => {
                const parentOrder = (ordersData || []).find(o => o.id === inv.job_id);
                const childOrders = (ordersData || []).filter(o => o.parent_job_id === inv.job_id && o.is_multi_day);
                if (childOrders.length === 0 && !parentOrder?.is_multi_day) return null;
                const totalDays = 1 + childOrders.length;
                return (
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "#f9731618", color: "#f97316", border: "1px solid #f9731644", fontWeight: 700 }}>
                    📋 Multi-Hari ({totalDays} hari)
                  </span>
                );
              })()}
              {inv.garansi_expires && (() => {
                const daysLeft = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
                if (daysLeft < 0) return <span style={{ fontSize: 10, color: cs.muted, background: cs.surface, padding: "1px 6px", borderRadius: 4 }}>🔒 Garansi selesai</span>;
                if (daysLeft <= 7) return <span style={{ fontSize: 10, color: "#ef4444", background: "#ef444418", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>⚠️ Garansi {daysLeft}h lagi</span>;
                if (daysLeft <= 30) return <span style={{ fontSize: 10, color: cs.yellow, background: cs.yellow + "18", padding: "1px 6px", borderRadius: 4 }}>🛡️ Garansi {daysLeft}h</span>;
                return <span style={{ fontSize: 10, color: cs.green, background: cs.green + "18", padding: "1px 6px", borderRadius: 4 }}>✅ Garansi {daysLeft}h</span>;
              })()}
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, color: cs.text, fontFamily: "monospace" }}>{fmt(inv.total)}</div>
          </div>
          {/* GAP 3 — breakdown nilai */}
          {inv.invoice_type === "ac_unit_sale" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 6, fontSize: 11 }}>
              <div style={{ background: "#f59e0b12", border: "1px solid #f59e0b33", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ color: "#f59e0b" }}>Unit AC</div>
                <div style={{ color: cs.text, fontWeight: 700 }}>{fmt(inv.unit_ac_amount)}</div>
              </div>
              <div style={{ background: cs.accent + "12", border: "1px solid " + cs.accent + "33", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ color: cs.accent }}>Paket Instalasi</div>
                <div style={{ color: cs.text, fontWeight: 700 }}>{fmt(inv.labor)}</div>
              </div>
              <div style={{ background: cs.surface, borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ color: cs.muted }}>Omset AClean</div>
                <div style={{ color: cs.green, fontWeight: 700 }}>{fmt((inv.labor || 0) + (inv.material || 0))}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginBottom: 6, fontSize: 11 }}>
              <div style={{ background: inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? cs.green + "10" : cs.surface, borderRadius: 6, padding: "6px 10px", border: inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? "1px solid " + cs.green + "33" : "none" }}><div style={{ color: cs.muted }}>Jasa</div><div style={{ color: inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? cs.green : cs.text, fontWeight: 700 }}>{inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? "Rp 0 (Garansi)" : fmt(inv.labor)}</div></div>
              <div style={{ background: cs.surface, borderRadius: 6, padding: "6px 10px" }}><div style={{ color: cs.muted }}>Material</div><div style={{ color: cs.text, fontWeight: 700 }}>{fmt(inv.material)}</div></div>
            </div>
          )}
          {((inv.discount || 0) > 0 || inv.trade_in) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginBottom: 6, fontSize: 11 }}>
              {(inv.discount || 0) > 0 && (
                <div style={{ background: "#be123c18", borderRadius: 6, padding: "6px 10px", border: "1px solid #be123c33" }}>
                  <div style={{ color: cs.muted }}>
                    {(inv.member_discount || 0) > 0
                      ? `Diskon Member ${inv.member_discount === inv.discount ? "" : "(+manual)"}`
                      : "Discount"}
                  </div>
                  <div style={{ color: "#f43f5e", fontWeight: 700 }}>-{fmt(inv.discount)}</div>
                  {(inv.member_discount || 0) > 0 && (
                    <div style={{ fontSize: 9, color: "#f43f5e99", marginTop: 1 }}>Dari tier: -{fmt(inv.member_discount)}</div>
                  )}
                </div>
              )}
              {inv.trade_in && (inv.trade_in_amount || 0) > 0 && (
                <div style={{ background: "#be123c18", borderRadius: 6, padding: "6px 10px", border: "1px solid #be123c33" }}><div style={{ color: cs.muted }}>Trade-In AC</div><div style={{ color: "#f43f5e", fontWeight: 700 }}>-{fmt(inv.trade_in_amount)}</div></div>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "4px 20px", fontSize: 12, color: cs.muted, marginBottom: 12 }}>
            <span>👤 {inv.customer}</span><span>📱 {inv.phone}</span>
            <span>🔧 {inv.service} · {Array.isArray(inv.units) ? inv.units.length : (inv.units || 1)} unit</span>
            {inv.due && <span>⏰ Jatuh tempo: {inv.due}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>👁 Preview</button>
            {/* Edit Material — khusus invoice AC unit sale (Owner only, kecuali CANCELLED) */}
            {inv.invoice_type === "ac_unit_sale" && currentUser?.role === "Owner" && inv.status !== "CANCELLED" && (
              <button onClick={async () => {
                setAddonModalInvId(inv.id);
                setAddonItems([]);
                setExistingAddons([]);
                setLoadingAddons(true);
                const { data } = await supabase.from("invoice_items").select("id,description,qty,unit_price,subtotal,item_type").eq("invoice_id", inv.id).eq("item_type", "addon");
                setExistingAddons(data || []);
                setLoadingAddons(false);
              }}
                style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                🔩 Edit Material
              </button>
            )}
            {/* Edit invoice — hanya untuk invoice NON ac_unit_sale */}
            {inv.invoice_type !== "ac_unit_sale" && inv.status !== "PAID" &&
              (currentUser?.role === "Owner" ||
                (currentUser?.role === "Admin" && inv.status === "PENDING_APPROVAL")) && (
                <button onClick={() => {
                  setEditInvoiceData(inv); setEditInvoiceForm({ labor: inv.labor, material: inv.material, discount: inv.discount || 0, trade_in: inv.trade_in || false, trade_in_amount: inv.trade_in_amount || 250000, notes: "" }); const _allItems = parseMD(inv.materials_detail).map((m, idx) => ({ ...m, _idx: idx }));
                  const _jasaItems = _allItems.filter(m => jasaSvcNames.some(s => (m.nama || "").includes(s)));
                  const _matItems = _allItems.filter(m => !jasaSvcNames.some(s => (m.nama || "").includes(s)));
                  setEditJasaItems(_jasaItems);
                  setEditInvoiceItems(_matItems); setModalEditInvoice(true);
                }}
                  style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit Nilai</button>
              )}
            {/* FREE REPAIR APPROVAL — Special handling for zero-cost repairs */}
            {inv.status === "PENDING_APPROVAL" && inv.repair_gratis && (
              <div style={{ gridColumn: "1 / -1", padding: "10px 12px", background: cs.yellow + "15", border: "1px dashed " + cs.yellow + "44", borderRadius: 8, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, color: cs.yellow, fontWeight: 700 }}>
                  🎁 {inv.repair_gratis === "gratis-garansi" ? "REPAIR GRATIS (Garansi Aktif)" : inv.repair_gratis === "gratis-customer" ? "REPAIR GRATIS (Arrangement)" : "REPAIR GRATIS"}
                </div>
                <div style={{ fontSize: 11, color: cs.muted }}>
                  Invoice Rp {fmt(inv.total)} untuk {inv.customer}.
                  {" "}
                  <b>Perlu disetujui Owner/Admin</b> sebelum dikirim ke customer atau dianggap PAID.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={async () => {
                    if (!await showConfirm({
                      icon: "🎁", title: "Setuju Repair Gratis?",
                      message: `Setujui invoice ${inv.id} Repair Gratis (Rp 0) untuk ${inv.customer}?\n\nInvoice akan dicatat LUNAS. TIDAK ada WA yang dikirim ke customer.`,
                      confirmText: "Setuju & Catat Lunas"
                    })) return;

                    const paidAt = new Date().toISOString();
                    setInvoicesData(prev => prev.map(i => i.id === inv.id
                      ? { ...i, status: "PAID", paid_at: paidAt } : i));
                    setOrdersData(prev => prev.map(o => o.id === inv.job_id
                      ? { ...o, status: "PAID" } : o));

                    const { error: upErr } = await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
                    if (!upErr) {
                      await updateOrderStatus(supabase, inv.job_id, "PAID", auditUserName());
                      addAgentLog("REPAIR_GRATIS_APPROVED",
                        `Invoice ${inv.id} (${inv.repair_gratis}) APPROVED & PAID oleh ${currentUser?.name}. Tidak ada WA terkirim.`,
                        "SUCCESS");
                      showNotif(`✅ Repair gratis disetujui dan dicatat LUNAS. Tidak dikirim ke customer.`);
                    } else {
                      showNotif("⚠️ Persetujuan lokal berhasil, tapi DB update gagal: " + upErr.message);
                    }
                  }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, flex: 1 }}>✅ Setuju Gratis</button>
                  <button onClick={async () => {
                    if (!await showConfirm({
                      icon: "❌", title: "Tolak Repair Gratis?",
                      message: `Tolak invoice ${inv.id} repair gratis?\n\nInvoice akan dihapus dan laporan perlu diedit ulang.`,
                      confirmText: "Tolak & Hapus"
                    })) return;
                    setInvoicesData(prev => prev.filter(i => i.id !== inv.id));
                    await deleteInvoice(supabase, inv.id, auditUserName(), "REPAIR_GRATIS_REJECTED");
                    if (inv.job_id) await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName(), { invoice_id: null });
                    addAgentLog("REPAIR_GRATIS_REJECTED", `Invoice ${inv.id} repair gratis REJECTED oleh ${currentUser?.name}`, "WARNING");
                    showNotif(`❌ Repair gratis ditolak — laporan ${inv.job_id} kembali ke COMPLETED`);
                    // Navigate to laporan page for quick edit
                    setActiveMenu("laporan");
                    setTimeout(() => {
                      showNotif(`💡 Cari laporan Job ID: ${inv.job_id} di halaman Laporan untuk diedit ulang.`);
                    }, 1500);
                  }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, flex: 1 }}>❌ Tolak & Edit</button>
                </div>
              </div>
            )}

            {/* COMPLAIN GARANSI OVERRIDE — Owner/Admin override auto-detect */}
            {inv.status === "PENDING_APPROVAL" && (inv.service || "").startsWith("Complain") &&
              (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                <div style={{ gridColumn: "1 / -1", padding: "10px 12px", background: "#8b5cf615", border: "1px dashed #8b5cf644", borderRadius: 8, display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700 }}>
                    🛡️ Status Garansi: {inv.garansi_status === "GARANSI_AKTIF" || inv.garansi_status === "GARANSI_DENGAN_MATERIAL"
                      ? <span style={{ color: cs.green }}>Dalam Garansi (auto-detect)</span>
                      : inv.garansi_status === "GARANSI_EXPIRED"
                        ? <span style={{ color: cs.yellow }}>Garansi Expired</span>
                        : <span style={{ color: cs.muted }}>Tidak Ada Garansi</span>}
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted }}>
                    Override manual jika perlu: paksa Gratis atau paksa Berbayar sebelum approve.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={async () => {
                      if (!await showConfirm({
                        icon: "🎁", title: "Override → Gratis?",
                        message: `Ubah invoice ${inv.id} menjadi GRATIS (Rp 0) dan langsung LUNAS?\n\nTidak ada WA terkirim ke customer.`,
                        confirmText: "Override Gratis & Lunas"
                      })) return;
                      const paidAt = new Date().toISOString();
                      const upd = { total: 0, labor: 0, material: 0, discount: 0, trade_in: false, trade_in_amount: 0, garansi_status: "GARANSI_OVERRIDE_FREE", status: "PAID", paid_at: paidAt };
                      const { garansi_status: _gs1, ...updDB } = upd; // garansi_status tidak ada di DB
                      setInvoicesData(prev => prev.map(i => i.id === inv.id ? { ...i, ...upd } : i));
                      setOrdersData(prev => prev.map(o => o.id === inv.job_id ? { ...o, status: "PAID" } : o));
                      const { error } = await updateInvoice(supabase, inv.id, updDB, auditUserName());
                      if (error) { showNotif("⚠️ DB update gagal: " + error.message); return; }
                      if (inv.job_id) await updateOrderStatus(supabase, inv.job_id, "PAID", auditUserName());
                      addAgentLog("COMPLAIN_OVERRIDE_FREE", `Invoice ${inv.id} override GRATIS & LUNAS oleh ${currentUser?.name}`, "SUCCESS");
                      showNotif("✅ Invoice di-override GRATIS dan dicatat LUNAS");
                    }} style={{ flex: 1, background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      Override: Gratis
                    </button>
                    <button onClick={async () => {
                      if (!await showConfirm({
                        icon: "💰", title: "Override → Berbayar?",
                        message: `Ubah invoice ${inv.id} menjadi BERBAYAR?\n\nJika total sekarang Rp 0, silakan edit nilai dulu via tombol Edit Nilai.`,
                        confirmText: "Override Berbayar"
                      })) return;
                      const upd = { garansi_status: "GARANSI_OVERRIDE_PAID", status: "PENDING_APPROVAL", repair_gratis: null };
                      const { garansi_status: _gs2, ...updDB2 } = upd; // garansi_status tidak ada di DB
                      setInvoicesData(prev => prev.map(i => i.id === inv.id ? { ...i, ...upd } : i));
                      const { error } = await updateInvoice(supabase, inv.id, updDB2, auditUserName());
                      if (error) { showNotif("⚠️ DB update gagal: " + error.message); return; }
                      addAgentLog("COMPLAIN_OVERRIDE_PAID", `Invoice ${inv.id} di-override BERBAYAR oleh ${currentUser?.name}`, "INFO");
                      showNotif("✅ Invoice di-override menjadi BERBAYAR — edit nilai jika perlu sebelum approve");
                    }} style={{ flex: 1, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      Override: Berbayar
                    </button>
                  </div>
                </div>
              )}
            {inv.status === "PENDING_APPROVAL" && !inv.repair_gratis && (
              <>
                <button onClick={() => approveInvoice(inv)} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✅ Approve</button>
                <span style={{ fontSize: 11, color: cs.accent, alignSelf: "center" }}>Belum dikirim ke customer</span>
              </>
            )}
            {/* Kirim Invoice PDF ke Customer — hanya setelah UNPAID (sudah approved) */}
            {inv.status === "UNPAID" && (
              <>
                <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📤 Kirim ke Customer</button>
                <button onClick={async () => {
                  if (await showConfirm({
                    icon: "💰", title: "Tandai Lunas?",
                    message: `Tandai invoice ${inv.id} (${fmt(inv.total)}) sudah LUNAS?`,
                    confirmText: "Ya, Lunas"
                  })) { const pp = invoicesData.find(i => i.id === inv.id); markPaid(pp || inv); }
                }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>💰 Tandai Lunas</button>
                <button onClick={() => payPanelInvId === inv.id ? setPayPanelInvId(null) : openPayPanel(inv)}
                  style={{ background: "#06b6d422", border: "1px solid #06b6d444", color: "#06b6d4", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                  {payPanelInvId === inv.id ? "✕ Tutup" : "💳 Catat Pembayaran"}
                </button>
                {(inv.invoice_type === "quotation_converted" || inv.invoice_type === "ac_unit_sale") && (
                  <button onClick={() => { setDpInvId(inv.id); setDpAmount(""); }}
                    style={{ background: "#06b6d422", border: "1px solid #06b6d444", color: "#06b6d4", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                    💳 Catat DP
                  </button>
                )}
                {/* Inline DP input */}
                {dpInvId === inv.id && (
                  <div style={{ width: "100%", background: "#06b6d410", border: "1px solid #06b6d433", borderRadius: 8, padding: "10px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#06b6d4", fontWeight: 700 }}>💳 Jumlah DP:</span>
                    <input type="number" value={dpAmount} onChange={e => setDpAmount(e.target.value)} min={1} max={inv.total - 1}
                      placeholder="Rp..." style={{ flex: 1, minWidth: 100, background: "#0f172a", border: "1px solid #06b6d444", borderRadius: 6, padding: "6px 10px", color: "#f8fafc", fontSize: 13, outline: "none" }} />
                    <button onClick={async () => {
                      const amt = Number(dpAmount);
                      if (!amt || amt <= 0 || amt >= inv.total) { showNotif("⚠️ Jumlah DP tidak valid"); return; }
                      const remaining = inv.total - amt;
                      const { error } = await supabase.from("invoices").update({
                        paid_amount: amt, remaining_amount: remaining, status: "PARTIAL_PAID",
                        notes: (inv.notes ? inv.notes + " · " : "") + `DP ${fmt(amt)}`
                      }).eq("id", inv.id);
                      if (error) { showNotif("❌ Gagal catat DP: " + error.message); return; }
                      setInvoicesData(prev => prev.map(i => i.id === inv.id
                        ? { ...i, paid_amount: amt, remaining_amount: remaining, status: "PARTIAL_PAID", notes: (i.notes ? i.notes + " · " : "") + `DP ${fmt(amt)}` } : i));
                      setDpInvId(null); setDpAmount("");
                      showNotif(`✅ DP ${fmt(amt)} tercatat — sisa ${fmt(remaining)}`);
                    }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#06b6d4", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                      Simpan DP
                    </button>
                    <button onClick={() => { setDpInvId(null); setDpAmount(""); }} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #64748b44", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>Batal</button>
                  </div>
                )}
                <button onClick={() => invoiceReminderWA(inv)} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>🔔 Reminder</button>
              </>
            )}
            {inv.status === "OVERDUE" && (
              <>
                <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📤 Kirim ke Customer</button>
                <button onClick={async () => {
                  if (await showConfirm({
                    icon: "💰", title: "Tandai Lunas?",
                    message: `Tandai invoice ${inv.id} (${fmt(inv.total)}) sudah LUNAS?`,
                    confirmText: "Ya, Lunas"
                  })) { const pp = invoicesData.find(i => i.id === inv.id); markPaid(pp || inv); }
                }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>💰 Tandai Lunas</button>
                <button onClick={() => payPanelInvId === inv.id ? setPayPanelInvId(null) : openPayPanel(inv)}
                  style={{ background: "#06b6d422", border: "1px solid #06b6d444", color: "#06b6d4", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                  {payPanelInvId === inv.id ? "✕ Tutup" : "💳 Catat Pembayaran"}
                </button>
                <button onClick={() => invoiceReminderWA(inv)} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>⚠️ Reminder OVERDUE</button>
              </>
            )}
            {/* Partial payment panel — invoice DP / cicilan */}
            {inv.status === "PARTIAL_PAID" && (
              <>
                <div style={{ width: "100%", background: "#06b6d415", border: "1px dashed #06b6d444", borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>
                  <span style={{ color: "#06b6d4", fontWeight: 700 }}>💳 Partial: {fmt(Number(inv.paid_amount) || 0)} terbayar</span>
                  <span style={{ color: cs.muted }}> · sisa {fmt(Number(inv.remaining_amount) ?? ((inv.total || 0) - (Number(inv.paid_amount) || 0)))}</span>
                </div>
                <button onClick={async () => {
                  if (await showConfirm({
                    icon: "💰", title: "Lunasi Sisa?",
                    message: `Lunasi sisa ${fmt(Number(inv.remaining_amount) ?? ((inv.total||0)-(Number(inv.paid_amount)||0)))} untuk invoice ${inv.id}?`,
                    confirmText: "Ya, Lunas"
                  })) { const pp = invoicesData.find(i => i.id === inv.id); markPaid(pp || inv); }
                }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>💰 Lunasi Sisa</button>
                <button onClick={() => payPanelInvId === inv.id ? setPayPanelInvId(null) : openPayPanel(inv)}
                  style={{ background: "#06b6d422", border: "1px solid #06b6d444", color: "#06b6d4", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                  {payPanelInvId === inv.id ? "✕ Tutup" : "💳 Riwayat Bayar"}
                </button>
                {setGroupPaymentCtx && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                  <button onClick={() => {
                    const sameCust = invoicesData.filter(i => i.phone === inv.phone && ["UNPAID","OVERDUE","PARTIAL_PAID"].includes(i.status));
                    setGroupPaymentCtx({ phone: inv.phone, invoices: sameCust.length > 0 ? sameCust : [inv], suggestedAmount: 0, proofUrl: null, method: "transfer", suggId: null });
                  }} style={{ background: "#06b6d422", border: "1px solid #06b6d444", color: "#06b6d4", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                    💳 Group Payment
                  </button>
                )}
                <button onClick={() => invoiceReminderWA(inv)} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>🔔 Reminder</button>
              </>
            )}
            {/* Hapus Invoice — Owner only.
                Allowed:
                - PENDING_APPROVAL: invoice biasa belum approve
                - ac_unit_sale (any status): admin batalin transaksi penjualan AC */}
            {currentUser?.role === "Owner" && (inv.status === "PENDING_APPROVAL" || inv.invoice_type === "ac_unit_sale") && (
              <button onClick={async () => {
                const isAcSale = inv.invoice_type === "ac_unit_sale";
                const warnPaid = isAcSale && (Number(inv.paid_amount) || 0) > 0
                  ? `\n\n⚠️ Customer SUDAH BAYAR ${fmt(Number(inv.paid_amount) || 0)}. Pastikan refund sudah diproses sebelum hapus.`
                  : "";
                if (!await showConfirm({
                  icon: "🗑️", title: "Hapus Invoice?", danger: true,
                  message: `Hapus invoice ${inv.id}?\n\nInvoice + invoice_items + payment history akan dihapus permanen.\nOrder install terkait tetap ada (linkage di-unset).${warnPaid}`,
                  confirmText: "Hapus Permanen"
                })) return;
                setInvoicesData(prev => prev.filter(i => i.id !== inv.id));
                const { error } = await deleteInvoice(supabase, inv.id, auditUserName(), "OWNER_HAPUS_MANUAL");
                if (error) { showNotif("⚠️ Hapus lokal OK, DB gagal: " + error.message); return; }
                if (inv.job_id) await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName(), { invoice_id: null });
                addAgentLog("INVOICE_DELETED", `Invoice ${inv.id} (${inv.customer}) dihapus oleh ${currentUser?.name}`, "WARNING");
                showNotif("🗑️ Invoice " + inv.id + " berhasil dihapus");
              }} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Hapus Invoice</button>
            )}
            {/* Revert PAID → Belum Bayar — Owner only, untuk koreksi nilai invoice lunas */}
            {currentUser?.role === "Owner" && inv.status === "PAID" && inv.invoice_type !== "ac_unit_sale" && revertInvoicePaid && (
              <button onClick={() => revertInvoicePaid(inv)}
                title="Kembalikan ke Belum Bayar agar nilai bisa dikoreksi"
                style={{ background: "#f9731622", border: "1px solid #f9731644", color: "#f97316", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                ↩️ Revert ke Belum Bayar
              </button>
            )}
            {/* Kirim Report Card manual — hanya Owner/Admin, status sudah approved, ada laporan terkait */}
            {inv.status !== "CANCELLED" &&
              (currentUser?.role === "Owner" || currentUser?.role === "Admin") &&
              inv.phone && laporanReports?.find(r => r.job_id === inv.job_id) && (
              <button onClick={async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = "⏳ Mengirim...";
                try {
                  const laporan = laporanReports.find(r => r.job_id === inv.job_id);
                  const srUrl = await uploadServiceReportPDFForWA(laporan, inv);
                  if (srUrl) {
                    const srMsg = `📋 *Service Report Card* — ${inv.service || "Servis AC"} untuk ${inv.customer}\n\nDokumen ini berisi detail pengerjaan & dokumentasi foto teknisi.\n\nTerima kasih telah mempercayai AClean Service! 🙏`;
                    await sendWAFn(inv.phone, srMsg, { url: srUrl, filename: `ServiceReport-${inv.job_id}.pdf` });
                    showNotif(`📋 Service Report Card terkirim ke ${inv.customer}`);
                  } else {
                    showNotif("⚠️ Gagal upload report card");
                  }
                } catch (err) {
                  showNotif("⚠️ Error: " + err.message);
                } finally {
                  if (btn) {
                    btn.disabled = false;
                    btn.textContent = "📋 Kirim Report Card";
                  }
                }
              }}
              style={{ background: "#0ea5e922", border: "1px solid #0ea5e944", color: "#38bdf8", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                📋 Kirim Report Card
              </button>
            )}
            {/* Bukti bayar — ada URL: tombol lihat. "verified-no-proof": dikonfirmasi manual. PAID tanpa bukti: warning */}
            {inv.status === "PAID" && inv.total > 0 && (
              inv.payment_proof_url === "verified-no-proof" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#0ea5e918", border: "1px solid #0ea5e944", color: "#0ea5e9", padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                  ✅ Dikonfirmasi Manual
                </span>
              ) : inv.payment_proof_url ? (
                <button
                  onClick={() => window.open(inv.payment_proof_url.startsWith("/api/") ? window.location.origin + inv.payment_proof_url : inv.payment_proof_url, "_blank")}
                  style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                >📷 Bukti Bayar ✓</button>
              ) : currentUser?.role === "Owner" ? (
                <button
                  onClick={async () => {
                    const ok = await showConfirm({
                      title: "Konfirmasi Lunas Tanpa Bukti",
                      message: `Tandai invoice ${inv.id} (${inv.customer} · ${fmt(inv.total)}) sebagai lunas tanpa bukti bayar?\n\nTidak ada notifikasi WA yang dikirim. Invoice akan keluar dari daftar "Tanpa Bukti".`,
                    });
                    if (!ok) return;
                    try {
                      const { error } = await supabase.from("invoices")
                        .update({ payment_proof_url: "verified-no-proof", notes: "Lunas paksa tanpa bukti oleh Owner" })
                        .eq("id", inv.id);
                      if (error) throw error;
                      setInvoicesData(prev => prev.map(i => i.id === inv.id
                        ? { ...i, payment_proof_url: "verified-no-proof", notes: "Lunas paksa tanpa bukti oleh Owner" }
                        : i));
                      addAgentLog("OWNER_CONFIRM_NO_PROOF", `Invoice ${inv.id} dikonfirmasi lunas tanpa bukti oleh Owner`, "SUCCESS");
                      showNotif(`✅ ${inv.id} dikonfirmasi lunas tanpa bukti`);
                    } catch (e) {
                      showNotif("❌ Gagal konfirmasi: " + e.message);
                    }
                  }}
                  title="Tandai lunas tanpa bukti bayar (tanpa kirim WA)"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f43f5e18", border: "1px solid #f43f5e66", color: "#f43f5e", padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  ⚠️ Belum Ada Bukti — Klik Lunas Paksa
                </button>
              ) : currentUser?.role === "Admin" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f43f5e18", border: "1px solid #f43f5e44", color: "#f43f5e", padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                  ⚠️ Belum Ada Bukti Bayar
                </span>
              ) : null
            )}
            <button
              onClick={() => setAuditModal({ tableName: "invoices", rowId: inv.id })}
              style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
            >📜 Riwayat</button>
          </div>

          {/* ── Multi-Payment Panel ── */}
          {payPanelInvId === inv.id && (
            <div style={{ borderTop: "1px solid #06b6d433", background: "#06b6d408", padding: "14px 18px" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#06b6d4", marginBottom: 10 }}>💳 Riwayat Pembayaran — {inv.id}</div>
              {/* Progress bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: cs.muted }}>Terbayar: <b style={{ color: cs.text }}>{fmt(Number(inv.paid_amount) || 0)}</b></span>
                  <span style={{ color: cs.muted }}>Total: <b style={{ color: cs.text }}>{fmt(inv.total)}</b></span>
                </div>
                <div style={{ height: 8, background: cs.surface, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 99, background: inv.total > 0 && (Number(inv.paid_amount) || 0) >= inv.total ? cs.green : "#06b6d4",
                    width: inv.total > 0 ? Math.min(100, Math.round(((Number(inv.paid_amount) || 0) / inv.total) * 100)) + "%" : "0%" }} />
                </div>
              </div>
              {/* History list */}
              {payLoading ? (
                <div style={{ fontSize: 12, color: cs.muted, padding: "8px 0" }}>⏳ Memuat riwayat...</div>
              ) : payHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: cs.muted, fontStyle: "italic", padding: "4px 0 8px" }}>Belum ada pembayaran tercatat.</div>
              ) : (
                <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                  {payHistory.map((p, pi) => (
                    <div key={p.id || pi} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 8, alignItems: "center", fontSize: 12, background: cs.card, borderRadius: 7, padding: "7px 10px" }}>
                      <span style={{ fontSize: 16 }}>{p.method === "cash" ? "💵" : p.method === "qris" ? "📱" : "🏦"}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: cs.text }}>{fmt(p.amount)}</div>
                        <div style={{ fontSize: 10, color: cs.muted }}>{p.paid_at} · {p.method} {p.notes ? "· " + p.notes : ""}</div>
                      </div>
                      <div style={{ fontSize: 10, color: cs.muted }}>{p.recorded_by_name || "—"}</div>
                      <span style={{ fontSize: 10, background: cs.green + "22", color: cs.green, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>
                        #{pi + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Form tambah bayar baru */}
              {["UNPAID","OVERDUE","PARTIAL_PAID"].includes(inv.status) && (
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 8 }}>+ Tambah Pembayaran</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Jumlah (Rp) *</div>
                      <input type="number" min="1" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder={fmt(inv.remaining_amount ?? inv.total)}
                        style={{ width: "100%", background: cs.surface, border: "1px solid #06b6d444", borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Metode</div>
                      <select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none" }}>
                        <option value="transfer">Transfer Bank</option>
                        <option value="cash">Cash</option>
                        <option value="qris">QRIS</option>
                        <option value="lainnya">Lainnya</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Tanggal Bayar</div>
                      <input type="date" value={payForm.paid_at} onChange={e => setPayForm(f => ({ ...f, paid_at: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Catatan (opsional)</div>
                      <input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder="DP pertama, cicilan, dll..."
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  {payForm.amount && Number(payForm.amount) > 0 && (
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>
                      Sisa setelah bayar: <b style={{ color: Number(payForm.amount) >= (inv.remaining_amount ?? inv.total) ? cs.green : "#06b6d4" }}>
                        {fmt(Math.max(0, (inv.remaining_amount ?? inv.total) - Number(payForm.amount)))}
                      </b>
                      {Number(payForm.amount) >= (inv.remaining_amount ?? inv.total) && " (LUNAS ✅)"}
                    </div>
                  )}
                  <button onClick={() => savePayment(inv)} disabled={paySaving}
                    style={{ width: "100%", background: "#06b6d4", border: "none", color: "#0a0f1e", borderRadius: 9, padding: "10px", fontWeight: 800, fontSize: 13, cursor: "pointer", opacity: paySaving ? 0.7 : 1 }}>
                    {paySaving ? "⏳ Menyimpan..." : "✅ Simpan Pembayaran"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        );
      })}
    </div>
    {/* Pagination Invoice */}
    {totPgI > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
        <button onClick={() => setInvoicePage(p => Math.max(1, p - 1))} disabled={curPgI === 1}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgI === 1 ? cs.surface : cs.card, color: curPgI === 1 ? cs.muted : cs.text, cursor: curPgI === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
        <span style={{ fontSize: 12, color: cs.text }}>Hal {curPgI}/{totPgI}</span>
        <button onClick={() => setInvoicePage(p => Math.min(totPgI, p + 1))} disabled={curPgI === totPgI}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgI === totPgI ? cs.surface : cs.card, color: curPgI === totPgI ? cs.muted : cs.text, cursor: curPgI === totPgI ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
        <span style={{ fontSize: 11, color: cs.muted }}>{filteredInv.length} invoice</span>
      </div>
    )}

    {/* ── Modal Edit Material AC Unit ── */}
    {addonModalInv && (
      <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
        onClick={e => { if (e.target === e.currentTarget) { setAddonModalInvId(null); setAddonItems([]); } }}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", padding: "18px 20px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>🔩 Edit Material</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{addonModalInv.id} · {addonModalInv.customer}</div>
            </div>
            <button onClick={() => { setAddonModalInvId(null); setAddonItems([]); }}
              style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
          </div>

          {/* Info ringkas invoice */}
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: cs.muted }}>Total saat ini</span>
              <span style={{ fontWeight: 700, color: cs.text, fontFamily: "monospace" }}>{fmt(addonModalInv.total)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: cs.muted }}>Material tersimpan</span>
              <span style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(addonModalInv.material)}</span>
            </div>
          </div>

          {/* Existing addons — edit qty / delete */}
          {(loadingAddons || existingAddons.length > 0) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>MATERIAL TERSIMPAN</div>
              {loadingAddons ? (
                <div style={{ fontSize: 11, color: cs.muted, padding: "8px 0" }}>Memuat...</div>
              ) : existingAddons.map((a, ai) => (
                <div key={a.id || ai} style={{ background: cs.card, borderRadius: 8, padding: "8px 12px", marginBottom: 5 }}>
                  <div style={{ fontSize: 12, color: cs.text, fontWeight: 600, marginBottom: 5 }}>{a.description}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 32px", gap: 6, alignItems: "center" }}>
                    <input type="number" min="1" step="1" value={a.qty}
                      onChange={async e => {
                        const newQty = parseInt(e.target.value, 10) || 0;
                        if (newQty <= 0) return;
                        const { error } = await supabase.from("invoice_items").update({ qty: newQty }).eq("id", a.id);
                        if (error) { showNotif("❌ Gagal update: " + error.message); return; }
                        setExistingAddons(prev => prev.map(x => x.id === a.id ? { ...x, qty: newQty } : x));
                        await recalcInvoiceFromItems(addonModalInv.id);
                      }}
                      style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "5px 8px", color: cs.text, fontSize: 12, textAlign: "center", boxSizing: "border-box" }} />
                    <div style={{ fontSize: 11, color: cs.muted }}>× {fmt(a.unit_price)} = <span style={{ color: cs.green, fontWeight: 700 }}>{fmt(a.qty * a.unit_price)}</span></div>
                    <button onClick={() => handleDeleteAddon(a)}
                      style={{ background: "#ef444415", border: "1px solid #ef444433", color: "#ef4444", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>×</button>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid " + cs.border, marginTop: 10, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: cs.muted }}>Total material tersimpan</span>
                <span style={{ fontWeight: 700, color: cs.green, fontFamily: "monospace" }}>{fmt(existingAddons.reduce((s, a) => s + a.qty * a.unit_price, 0))}</span>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>TAMBAH MATERIAL BARU</div>
          {/* Item list — dropdown dari price list */}
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            {addonItems.map((a, ai) => (
              <div key={a._id} style={{ background: cs.card, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6 }}>
                {/* Baris 1: dropdown item full width */}
                <select
                  value={a.nama}
                  onChange={e => {
                    const picked = addonPriceOptions.find(p => p.nama === e.target.value);
                    setAddonItems(prev => prev.map((x, xi) => xi === ai
                      ? { ...x, nama: e.target.value, harga: picked?.harga || x.harga, satuan: picked?.satuan || x.satuan }
                      : x));
                  }}
                  style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: a.nama ? cs.text : cs.muted, fontSize: 12, boxSizing: "border-box" }}>
                  <option value="">— Pilih item dari price list —</option>
                  {["Install", "Material", "Repair", "Cleaning", "Complain"].map(svc => {
                    const items = addonPriceOptions.filter(p => p.service === svc);
                    if (items.length === 0) return null;
                    return (
                      <optgroup key={svc} label={"── " + svc + " ──"}>
                        {items.map((p, pi) => (
                          <option key={pi} value={p.nama}>{p.nama} ({p.satuan}){p.harga > 0 ? "  •  Rp " + p.harga.toLocaleString("id-ID") : ""}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                {/* Baris 2: qty + satuan + harga + hapus */}
                <div style={{ display: "grid", gridTemplateColumns: "70px 50px 1fr 32px", gap: 6, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 9, color: cs.muted, marginBottom: 2 }}>QTY</div>
                    <input type="number" min="1" step="1" value={a.qty}
                      onChange={e => setAddonItems(p => p.map((x, xi) => xi === ai ? { ...x, qty: parseInt(e.target.value, 10) || 0 } : x))}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 6px", color: cs.text, fontSize: 12, textAlign: "center", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ fontSize: 10, color: cs.muted, paddingTop: 14, textAlign: "center" }}>{a.satuan || "Unit"}</div>
                  <div>
                    <div style={{ fontSize: 9, color: cs.muted, marginBottom: 2 }}>HARGA/SAT (Rp)</div>
                    <input type="number" min="0" step="1000" value={a.harga || ""}
                      onChange={e => setAddonItems(p => p.map((x, xi) => xi === ai ? { ...x, harga: parseInt(e.target.value) || 0 } : x))}
                      placeholder="0"
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.green, fontSize: 12, fontFamily: "monospace", textAlign: "right", boxSizing: "border-box" }} />
                  </div>
                  <button onClick={() => setAddonItems(p => p.filter((_, xi) => xi !== ai))}
                    style={{ background: "#ef444415", border: "none", color: "#ef4444", borderRadius: 6, padding: "6px", cursor: "pointer", fontSize: 14, marginTop: 14 }}>×</button>
                </div>
                {/* Subtotal per baris */}
                {a.qty > 0 && a.harga > 0 && (
                  <div style={{ textAlign: "right", fontSize: 11, color: cs.muted }}>
                    Subtotal: <span style={{ fontWeight: 700, color: cs.green, fontFamily: "monospace" }}>{fmt(a.qty * a.harga)}</span>
                  </div>
                )}
              </div>
            ))}
            <button onClick={() => setAddonItems(p => [...p, { _id: Date.now(), nama: "", qty: 1, harga: 0 }])}
              style={{ padding: "10px", borderRadius: 8, background: cs.card, border: "1px dashed " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 12 }}>
              + Tambah Baris
            </button>
          </div>

          {/* Total material baru */}
          {addonItems.some(a => a.qty > 0 && a.harga > 0) && (
            <div style={{ background: cs.green + "12", border: "1px solid " + cs.green + "33", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: cs.muted }}>Total material baru</span>
              <span style={{ fontWeight: 800, color: cs.green, fontFamily: "monospace" }}>
                + {fmt(addonItems.reduce((s, a) => s + (a.qty * a.harga || 0), 0))}
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setAddonModalInvId(null); setAddonItems([]); }} disabled={savingAddon}
              style={{ flex: 1, padding: "11px", borderRadius: 10, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 13 }}>Batal</button>
            <button onClick={handleSaveAddon} disabled={savingAddon}
              style={{ flex: 2, padding: "11px", borderRadius: 10, background: savingAddon ? cs.border : cs.green, border: "none", color: "#fff", fontWeight: 700, cursor: savingAddon ? "not-allowed" : "pointer", fontSize: 13 }}>
              {savingAddon ? "Menyimpan..." : "✅ Simpan Material"}
            </button>
          </div>
        </div>
      </div>
    )}

    {showAcUnitModal && (
      <AcUnitInvoiceModal
        onClose={() => setShowAcUnitModal(false)}
        supabase={supabase}
        customersData={customersData || []}
        ordersData={ordersData || []}
        setOrdersData={setOrdersData}
        showNotif={showNotif}
        setInvoicesData={setInvoicesData}
        getLocalDate={getLocalDate}
        priceListData={priceListData || []}
      />
    )}

    {/* ── Modal Picker: pilih customer untuk Mode Gabung ── */}
    {mergeStage === "picker" && (
      <div onClick={exitMergeMode}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 0, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: cs.text }}>🗂️ Pilih Customer untuk Digabung</div>
              <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{mergeCandidates.length} customer punya 2+ invoice belum lunas (max {MERGE_MAX} invoice per gabungan)</div>
            </div>
            <button onClick={exitMergeMode} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", padding: 4 }}>✕</button>
          </div>
          <div style={{ overflowY: "auto", padding: "8px 12px" }}>
            {mergeCandidates.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: cs.muted }}>
                Tidak ada customer dengan lebih dari 1 invoice.
              </div>
            ) : (
              mergeCandidates.map(g => {
                // Cek apakah ada invoice yang baru di-kirim < 24 jam (tanda over-spam)
                const recentSent = g.invoices.some(i => {
                  if (!i.wa_last_sent_at) return false;
                  return (Date.now() - new Date(i.wa_last_sent_at).getTime()) < 24 * 3600 * 1000;
                });
                return (
                <button key={g.phone}
                  onClick={() => {
                    setMergePhone(g.phone);
                    setMergeStage("select");
                    setMergeSelectedIds([]);
                    setInvoicePage(1);
                  }}
                  style={{
                    width: "100%", textAlign: "left",
                    background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10,
                    padding: "12px 14px", marginBottom: 8, cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = cs.accent + "18"; e.currentTarget.style.borderColor = cs.accent + "66"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = cs.surface; e.currentTarget.style.borderColor = cs.border; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: cs.text, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 }}>
                      {g.customer}
                      {recentSent && (
                        <span title="Sudah dikirim < 24 jam lalu — jangan over-spam"
                          style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b66", fontWeight: 700 }}>
                          ⏰ baru kirim
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                      📱 {g.phone} · {g.invoices.length} invoice
                      {g.sisaAll > 0 && <span style={{ color: "#f43f5e", marginLeft: 8 }}>· Sisa {fmt(g.sisaAll)}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: cs.text }}>{fmt(g.totalAll)}</div>
                    <div style={{ fontSize: 10, color: cs.accent, marginTop: 2 }}>Pilih →</div>
                  </div>
                </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    )}

    {/* ── Floating Action Bar: Gabung & Kirim ── */}
    {mergeMode && mergeSelectedIds.length > 0 && (
      <div style={{
        position: "fixed",
        bottom: isMobile ? 12 : 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        background: cs.card,
        border: "1px solid " + cs.accent + "66",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        borderRadius: 14,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        maxWidth: "92vw",
      }}>
        <div style={{ fontSize: 12, color: cs.text }}>
          <b style={{ color: cs.accent }}>{mergeSelectedIds.length} invoice dipilih</b>
          {mergeSelectedInvs.length > 0 && (
            <span style={{ marginLeft: 8, color: cs.muted }}>
              · Total {fmt(mergeSelectedInvs.reduce((s, i) => s + (Number(i.total) || 0), 0))}
            </span>
          )}
        </div>
        <button onClick={handlePreviewMerged}
          disabled={mergePreviewing || mergeSending || mergeSelectedIds.length < 2}
          style={{
            background: (mergePreviewing || mergeSending || mergeSelectedIds.length < 2) ? cs.muted + "33" : cs.accent + "22",
            border: "1px solid " + cs.accent + ((mergePreviewing || mergeSending || mergeSelectedIds.length < 2) ? "33" : "66"),
            color: (mergePreviewing || mergeSending || mergeSelectedIds.length < 2) ? cs.muted : cs.accent,
            padding: "8px 14px", borderRadius: 9,
            cursor: (mergePreviewing || mergeSending || mergeSelectedIds.length < 2) ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 12,
          }}
          title="Buka PDF gabungan di tab baru untuk cek isi sebelum kirim">
          {mergePreviewing ? "⏳" : "👁 Preview"}
        </button>
        <button onClick={handleApproveMerged}
          disabled={mergeApproving || mergeSending || mergePreviewing || mergeSelectedIds.length < 2 || allMergeAlreadyApproved}
          style={{
            background: (mergeApproving || mergeSending || mergePreviewing || mergeSelectedIds.length < 2 || allMergeAlreadyApproved) ? cs.muted + "22" : "#22c55e22",
            border: "1px solid " + ((mergeApproving || mergeSending || mergePreviewing || mergeSelectedIds.length < 2 || allMergeAlreadyApproved) ? cs.muted + "33" : "#22c55e66"),
            color: (mergeApproving || mergeSending || mergePreviewing || mergeSelectedIds.length < 2 || allMergeAlreadyApproved) ? cs.muted : "#4ade80",
            padding: "8px 14px", borderRadius: 9,
            cursor: (mergeApproving || mergeSending || mergePreviewing || mergeSelectedIds.length < 2 || allMergeAlreadyApproved) ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 12,
          }}
          title={allMergeAlreadyApproved ? "Semua sudah di-approve — langsung klik Gabung & Kirim" : "Approve semua invoice yang dipilih ke UNPAID tanpa kirim WA"}>
          {mergeApproving ? "⏳ Approving..." : allMergeAlreadyApproved ? "✓ Sudah Approved" : `✅ Approve & Simpan (${mergeSelectedIds.length})`}
        </button>
        <button onClick={handleConsolidateInvoice}
          disabled={mergeConsolidating || mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2 || !allMergeAlreadyApproved}
          title={allMergeAlreadyApproved ? "Buat 1 invoice baru gabungan di database — invoice asli di-cancel" : "Approve dulu semua invoice sebelum konsolidasi"}
          style={{
            background: (!allMergeAlreadyApproved || mergeConsolidating || mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? cs.muted + "22" : "#f59e0b22",
            border: "1px solid " + ((!allMergeAlreadyApproved || mergeConsolidating || mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? cs.muted + "33" : "#f59e0b66"),
            color: (!allMergeAlreadyApproved || mergeConsolidating || mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? cs.muted : "#f59e0b",
            padding: "8px 14px", borderRadius: 9,
            cursor: (!allMergeAlreadyApproved || mergeConsolidating || mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 12,
          }}>
          {mergeConsolidating ? "⏳ Membuat..." : `💾 Simpan Jadi 1 Invoice`}
        </button>
        <button onClick={() => handleSendMerged()}
          disabled={mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2}
          style={{
            background: (mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? cs.muted + "44" : "#25D366",
            border: "none",
            color: (mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? cs.muted : "#fff",
            padding: "8px 18px", borderRadius: 9,
            cursor: (mergeSending || mergePreviewing || mergeApproving || mergeSelectedIds.length < 2) ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 12,
          }}>
          {mergeSending ? "⏳ Mengirim..." : `📨 Gabung & Kirim (${mergeSelectedIds.length})`}
        </button>
        <button onClick={exitMergeMode}
          style={{ background: "transparent", border: "1px solid " + cs.muted + "55", color: cs.muted, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
          ✕ Batal
        </button>
      </div>
    )}
    </>}
  </div>
);
}

// ── Voucher Admin Tab ──────────────────────────────────────────────────────────
function VoucherAdminTab({ voucherList, voucherStats, voucherFilter, setVoucherFilter, voucherSearch, setVoucherSearch, voucherLoading, loadVouchers, apiHeaders, showNotif, fmt }) {
  const [cancellingId, setCancellingId] = useState(null);

  const handleCancel = async (v) => {
    if (!window.confirm(`Batalkan voucher ${v.code} milik ${v.customer_name}?`)) return;
    setCancellingId(v.id);
    try {
      const hdrs = await apiHeaders();
      const r = await fetch("/api/cancel-voucher", { method: "POST", headers: hdrs, body: JSON.stringify({ id: v.id }) });
      if (r.ok) {
        showNotif(`✅ Voucher ${v.code} dibatalkan`);
        loadVouchers(voucherFilter, voucherSearch);
      } else showNotif("❌ Gagal membatalkan voucher", "error");
    } catch { showNotif("❌ Gagal membatalkan voucher", "error"); }
    finally { setCancellingId(null); }
  };

  const today = new Date().toISOString().slice(0, 10);
  const getVoucherStatus = (v) => {
    if (v.claimed_at) return { label: "Diklaim", color: "#22c55e", bg: "#f0fdf4" };
    if (!v.is_valid)  return { label: "Dibatalkan", color: "#94a3b8", bg: "#f1f5f9" };
    if (v.expires_at && v.expires_at < today) return { label: "Expired", color: "#f87171", bg: "#fef2f2" };
    return { label: "Aktif", color: "#0ea5e9", bg: "#f0f9ff" };
  };

  const typeLabel = (v) => v.type === "discount_pct" ? `Diskon ${v.value}%`
    : v.type === "free_unit" ? `${v.value} Unit Gratis` : v.type;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Stats */}
      {voucherStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {[
            { label: "Total", val: voucherStats.total, color: cs.text },
            { label: "Aktif", val: voucherStats.active, color: "#0ea5e9" },
            { label: "Diklaim", val: voucherStats.claimed, color: "#22c55e" },
            { label: "Expired", val: voucherStats.expired, color: "#f87171" },
          ].map(s => (
            <div key={s.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: cs.muted }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter + Search */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["active","claimed","expired","all"].map(f => (
            <button key={f} onClick={() => { setVoucherFilter(f); loadVouchers(f, voucherSearch); }}
              style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid " + (voucherFilter === f ? cs.accent : cs.border), background: voucherFilter === f ? cs.accent + "22" : "transparent", color: voucherFilter === f ? cs.accent : cs.muted, cursor: "pointer", fontSize: 12, fontWeight: voucherFilter === f ? 700 : 400 }}>
              {{ active: "Aktif", claimed: "Diklaim", expired: "Expired", all: "Semua" }[f]}
            </button>
          ))}
        </div>
        <input value={voucherSearch} onChange={e => setVoucherSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && loadVouchers(voucherFilter, voucherSearch)}
          placeholder="Cari kode / phone / nama..."
          style={{ flex: 1, minWidth: 180, padding: "7px 12px", borderRadius: 8, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 12 }} />
        <button onClick={() => loadVouchers(voucherFilter, voucherSearch)}
          style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: cs.accent, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
          {voucherLoading ? "..." : "Cari"}
        </button>
      </div>

      {/* List */}
      {voucherLoading ? (
        <div style={{ textAlign: "center", padding: 32, color: cs.muted }}>Memuat voucher...</div>
      ) : voucherList.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: cs.muted }}>Tidak ada voucher ditemukan</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {voucherList.map(v => {
            const st = getVoucherStatus(v);
            const canCancel = !v.claimed_at && v.is_valid;
            return (
              <div key={v.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: cs.text, letterSpacing: 1 }}>{v.code}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12, background: st.bg, color: st.color }}>{st.label}</span>
                    <span style={{ fontSize: 11, color: cs.muted, background: cs.surface, padding: "2px 8px", borderRadius: 12 }}>{typeLabel(v)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
                    {v.customer_name || "—"} · {v.phone}
                    {v.expires_at && <span style={{ marginLeft: 8 }}>Exp: {v.expires_at}</span>}
                    {v.claimed_at && v.claimed_order_id && <span style={{ marginLeft: 8, color: "#22c55e" }}>→ {v.claimed_order_id}</span>}
                  </div>
                  {v.description && <div style={{ fontSize: 11, color: cs.muted, marginTop: 2, fontStyle: "italic" }}>{v.description}</div>}
                </div>
                {canCancel && (
                  <button onClick={() => handleCancel(v)} disabled={cancellingId === v.id}
                    style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #f8717144", background: "#fef2f2", color: "#f87171", cursor: cancellingId === v.id ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {cancellingId === v.id ? "..." : "Batalkan"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(InvoiceView);
