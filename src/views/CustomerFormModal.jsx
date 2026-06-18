import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { getLocalDate } from "../lib/dateTime.js";
import { sameCustomer } from "../lib/customers.js";
import { insertCustomer, updateCustomer } from "../data/writes.js";
import { cs } from "../theme/cs.js";

const inp = (err) => ({
  width: "100%", background: cs.surface,
  border: "1px solid " + (err ? cs.red : cs.border),
  borderRadius: 8, padding: "9px 12px", color: cs.text,
  fontSize: 13, outline: "none", boxSizing: "border-box",
});
const lbl = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 };
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" };
const secTitle = { fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 };

export default function CustomerFormModal({
  open,
  onClose,
  selectedCustomer,         // null = baru, object = edit
  customersData = [],
  ordersData = [],
  showNotif,
  addAgentLog,
  setCustomersData,
  setSelectedCustomer,
  setOrdersData,
  setInvoicesData,
}) {
  const isEdit = !!(selectedCustomer?.id);

  const blank = { name: "", phone: "", address: "", area: "", notes: "", is_vip: false };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm(isEdit ? {
      name: selectedCustomer.name || "",
      phone: selectedCustomer.phone || "",
      address: selectedCustomer.address || "",
      area: selectedCustomer.area || "",
      notes: selectedCustomer.notes || "",
      is_vip: selectedCustomer.is_vip || false,
    } : blank);
    setErrors({});
    setSaving(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const samePhoneCusts = form.phone
    ? customersData.filter(cu => samePhone(cu.phone, form.phone) && cu.id !== (selectedCustomer?.id || ""))
    : [];

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Nama wajib diisi";
    if (!form.phone.trim()) e.phone = "Nomor HP wajib diisi";
    else {
      const n = normalizePhone(form.phone);
      if (!n || !/^\d{9,15}$/.test(n)) e.phone = "Format tidak valid — gunakan format 628xxx (9–15 digit)";
    }
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const existExact = customersData.find(cu =>
      sameCustomer(cu, form.phone, form.name) && cu.id !== (selectedCustomer?.id || "")
    );
    if (existExact) { showNotif(`⚠️ Customer "${existExact.name}" dengan nomor HP ini sudah terdaftar.`); return; }

    setSaving(true);
    try {
      if (isEdit) {
        const dbUpd = {
          name: form.name.trim(),
          phone: normalizePhone(form.phone),
          address: form.address || "",
          area: form.area || "",
          notes: form.notes || "",
          is_vip: form.is_vip || false,
        };
        const { error: cErr } = await updateCustomer(supabase, selectedCustomer.id, dbUpd);
        if (cErr) { showNotif("⚠️ Gagal simpan: " + cErr.message); return; }

        const newName = form.name.trim();
        const oldName = selectedCustomer.name;
        const newPhone = normalizePhone(form.phone);
        const oldPhone = (selectedCustomer.phone || "").trim();
        const linkedJobIds = ordersData.filter(o => o.customer_id === selectedCustomer.id).map(o => o.id);

        // Cascade nama → orders, invoices, service_reports
        if (newName !== oldName) {
          await supabase.from("orders").update({ customer: newName }).eq("customer_id", selectedCustomer.id);
          if (linkedJobIds.length) {
            await supabase.from("invoices").update({ customer: newName }).in("job_id", linkedJobIds);
            await supabase.from("service_reports").update({ customer: newName }).in("job_id", linkedJobIds);
          }
          setOrdersData(prev => prev.map(o => o.customer_id === selectedCustomer.id ? { ...o, customer: newName } : o));
        }

        // Cascade phone + invalidate PDF cache
        if (newPhone && newPhone !== oldPhone) {
          await supabase.from("orders").update({ phone: newPhone }).eq("customer_id", selectedCustomer.id);
          if (linkedJobIds.length) {
            await supabase.from("invoices").update({ phone: newPhone, pdf_url: null, pdf_generated_at: null }).in("job_id", linkedJobIds);
            await supabase.from("service_reports").update({ phone: newPhone }).in("job_id", linkedJobIds);
          }
          setOrdersData(prev => prev.map(o => o.customer_id === selectedCustomer.id ? { ...o, phone: newPhone } : o));
          setInvoicesData(prev => prev.map(i => linkedJobIds.includes(i.job_id)
            ? { ...i, phone: newPhone, pdf_url: null, pdf_generated_at: null } : i));
          showNotif("✅ Phone diupdate — " + linkedJobIds.length + " order/invoice ter-sync, PDF regenerate otomatis");
        } else {
          showNotif("✅ Data " + newName + " berhasil diupdate");
        }

        const updated = { ...selectedCustomer, ...dbUpd };
        setCustomersData(prev => prev.map(cu => cu.id === selectedCustomer.id ? updated : cu));
        if (setSelectedCustomer) setSelectedCustomer(updated);
        addAgentLog("CUSTOMER_UPDATED", "Customer " + newName + " diupdate" + (newPhone !== oldPhone ? " (phone cascaded ke " + linkedJobIds.length + " order/invoice)" : ""), "SUCCESS");

      } else {
        const today = getLocalDate();
        const dbCust = {
          name: form.name.trim(),
          phone: normalizePhone(form.phone),
          address: form.address || "",
          area: form.area || "",
          notes: form.notes || "",
          is_vip: form.is_vip || false,
          joined_date: today,
          total_orders: 0,
          last_service: null,
        };
        const { data: saved, error: cErr } = await insertCustomer(supabase, dbCust);
        if (cErr) { showNotif("⚠️ Gagal simpan customer: " + cErr.message); return; }
        setCustomersData(prev => [...prev, saved || { ...dbCust, id: "CUST_" + Date.now() }]);
        addAgentLog("CUSTOMER_ADDED", "Customer baru: " + form.name + " (" + (form.area || "-") + ")", "SUCCESS");
        showNotif("✅ Customer " + form.name + " berhasil ditambahkan");
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 440, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              {isEdit ? "✏️ Edit Customer" : "👤 Customer Baru"}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              {isEdit
                ? "Perubahan nama/HP otomatis disync ke semua order & invoice"
                : "Tambahkan pelanggan baru ke database AClean"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Card 1 — Identitas */}
          <div style={card}>
            <div style={secTitle}>Identitas Pelanggan</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

              {/* Nama */}
              <div>
                <label style={lbl}>Nama Lengkap <span style={{ color: cs.red }}>*</span></label>
                <input
                  value={form.name}
                  onChange={e => { set("name", e.target.value); if (errors.name) setErrors(prev => ({ ...prev, name: "" })); }}
                  placeholder="Nama customer"
                  style={inp(errors.name)}
                />
                {errors.name && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.name}</div>}
              </div>

              {/* Phone */}
              <div>
                <label style={lbl}>Nomor HP <span style={{ color: cs.red }}>*</span></label>
                <input
                  value={form.phone}
                  onChange={e => {
                    const v = normalizePhone(e.target.value) || e.target.value;
                    set("phone", v);
                    if (errors.phone) setErrors(prev => ({ ...prev, phone: "" }));
                  }}
                  placeholder="628xxx"
                  style={inp(errors.phone)}
                />
                {errors.phone && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.phone}</div>}
                {!errors.phone && samePhoneCusts.length > 0 && (
                  <div style={{ background: cs.yellow + "12", border: "1px solid " + cs.yellow + "44", borderRadius: 8, padding: "7px 10px", marginTop: 6, fontSize: 11, color: cs.yellow, lineHeight: 1.5 }}>
                    ℹ️ HP sudah dipakai: <b>{samePhoneCusts.map(c => c.name).join(", ")}</b>
                    <br />Boleh tambah dengan nama berbeda (multi-lokasi)
                  </div>
                )}
              </div>

              {/* VIP Toggle */}
              <div
                onClick={() => set("is_vip", !form.is_vip)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 12px",
                  background: form.is_vip ? cs.yellow + "12" : cs.surface,
                  border: "1px solid " + (form.is_vip ? cs.yellow + "55" : cs.border),
                  borderRadius: 10, cursor: "pointer",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: form.is_vip ? cs.yellow : cs.text }}>⭐ Customer VIP</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>Prioritas layanan & notifikasi khusus</div>
                </div>
                <div style={{ width: 40, height: 22, borderRadius: 11, background: form.is_vip ? cs.yellow : cs.border, position: "relative", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 3, left: form.is_vip ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left .15s" }} />
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 — Lokasi & Info */}
          <div style={card}>
            <div style={secTitle}>Lokasi & Informasi</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={lbl}>Alamat Lengkap</label>
                <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="Jl. ..." style={inp()} />
              </div>
              <div>
                <label style={lbl}>Area / Kecamatan</label>
                <input value={form.area} onChange={e => set("area", e.target.value)} placeholder="Alam Sutera, BSD, Tangerang..." style={inp()} />
              </div>
              <div>
                <label style={lbl}>Catatan Internal</label>
                <textarea
                  value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
                  placeholder="Catatan khusus (opsional)..."
                  style={{ ...inp(), resize: "none", fontFamily: "inherit", lineHeight: 1.5 }}
                />
              </div>
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} disabled={saving}
            style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            Batal
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 2, background: saving ? cs.green + "88" : "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Menyimpan..." : (isEdit ? "✓ Simpan Perubahan" : "✓ Tambah Customer")}
          </button>
        </div>
      </div>
    </div>
  );
}
