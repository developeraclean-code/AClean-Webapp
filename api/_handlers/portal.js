// api/_handlers/portal.js — Handler grup portal & maintenance B2B (Batch 3 pemecahan
// router, Jul 2026). Isi blok dipindah APA ADANYA (ekstraksi programatik) dari
// api/[route].js — di-dispatch oleh router; auth/PUBLIC_ROUTES tetap di router.
import { checkRateLimit } from "../_auth.js";
import { validateAndNormalizePhone, buildPhoneVariants, sanitizeName } from "../_validate.js";
import { sentryCatch } from "../_report.js";

    // ── MANAGE-USER: Create/Update/Deactivate/Reset-Password via Admin API ──
    // ── PROJECT MODULE: hapus baris (Owner only) — RLS anon sengaja tanpa DELETE ──
export async function projectDelete(req, res) {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!await checkRateLimit(req, res, 30, 60000)) return;
      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Supabase service key tidak dikonfigurasi" });

      // Role check: Owner only (App Token claims, atau fallback Supabase Bearer → user_profiles)
      let callerRole = "";
      if (req.appClaims?.role) {
        callerRole = req.appClaims.role;
      } else {
        const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
        if (bearer) {
          try {
            const parts = bearer.split(".");
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
              if (payload.sub) {
                const pr = await fetch(`${SU}/rest/v1/user_profiles?id=eq.${encodeURIComponent(payload.sub)}&select=role&limit=1`, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
                const pd = pr.ok ? await pr.json() : [];
                callerRole = pd[0]?.role ? (pd[0].role.charAt(0).toUpperCase() + pd[0].role.slice(1).toLowerCase()) : "";
              }
            }
          } catch (e) { console.warn("[project-delete] JWT decode:", e.message); }
        }
      }
      if (callerRole !== "Owner") return res.status(403).json({ error: "Forbidden: hanya Owner yang bisa hapus data Project" });

      const { table, id } = req.body || {};
      const ALLOWED = ["project_projects", "project_dp", "project_materials", "project_alokasi", "project_usage", "project_tools", "project_expenses", "project_purchases", "project_harian", "project_documents"];
      if (!ALLOWED.includes(table) || !id) return res.status(400).json({ error: "table/id tidak valid" });

      const delRes = await fetch(`${SU}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
      });
      if (!delRes.ok) { const t = await delRes.text(); console.error("[project-delete] gagal:", delRes.status, t); return res.status(502).json({ error: "Hapus gagal: " + t.slice(0, 200) }); }
      return res.status(200).json({ success: true });
}

    // Resolusi role pemanggil untuk gate role level-endpoint:
    // - App Token → req.appClaims.role (diisi validateInternalToken).
    // - Supabase Bearer → decode sub → user_profiles.role.
    // - Tanpa keduanya → null = pemanggil lolos validateInternalToken lewat legacy
    //   INTERNAL_API_SECRET (server-to-server) — dianggap sistem.
async function resolveCallerRole(req, SU, SK) {
  if (req.appClaims?.role) return req.appClaims.role;
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return null;
  try {
    const parts = bearer.split(".");
    if (parts.length !== 3) return "";
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload.sub) return "";
    const pr = await fetch(`${SU}/rest/v1/user_profiles?id=eq.${encodeURIComponent(payload.sub)}&select=role&limit=1`, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    const pd = pr.ok ? await pr.json() : [];
    return pd[0]?.role ? (pd[0].role.charAt(0).toUpperCase() + pd[0].role.slice(1).toLowerCase()) : "";
  } catch { return ""; }
}

    // ════════════════════════════════════════════════════════════
    // MAINTENANCE (INTERNAL — butuh X-Internal-Token, Owner/Admin)
    // Semua CRUD modul Maintenance lewat sini (tabel RLS-restrictive,
    // anon key diblok → wajib service key). Dispatch via body.action.
    // ════════════════════════════════════════════════════════════
export async function maintenance(req, res) {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };
      const REST = (p) => `${SU}/rest/v1/${p}`;
      const body = req.body || {};
      const action = String(body.action || "");

      // ── Auto-roll jadwal PM: dipanggil tiap kali log servis tercatat (autolog
      // dari verify laporan + create-log manual). Tanpa ini roda PPM tidak maju:
      // servis tercatat tapi next_service_date diam → unit tampak overdue selamanya
      // (temuan audit 18 Jul 2026: TIDAK ADA satupun titik tulis otomatis sebelumnya).
      // Cukup tulis last_service_date — next_service_date DIHITUNG TRIGGER DB
      // trg_compute_next_service (migrasi 064: last + interval bulan, default 3).
      // Jangan hitung next di sini: trigger BEFORE UPDATE menimpa nilai app (satu
      // sumber kebenaran = trigger). Guard anti-mundur: log backfill tanggal lama
      // tidak menimpa jadwal yang lebih baru.
      const rollUnitSchedule = async (unitIdList, svcDate) => {
        const ids = [...new Set((unitIdList || []).filter(Boolean))];
        if (!ids.length || !svcDate) return;
        try {
          const uRes = await fetch(REST("maintenance_units?id=in.(" + encodeURIComponent(ids.join(",")) + ")&select=id,last_service_date"), { headers });
          const uData = await uRes.json();
          await Promise.all((Array.isArray(uData) ? uData : []).map(u => {
            if (u.last_service_date && svcDate < u.last_service_date) return null; // anti-mundur
            return fetch(REST("maintenance_units?id=eq." + encodeURIComponent(u.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ last_service_date: svcDate }) });
          }));
        } catch (e) { console.warn("[maintenance] roll jadwal gagal (non-blocking):", e.message); }
      };

      // ── Role gate per-action: mutasi & data finansial = Owner/Admin saja ──
      // Teknisi/Helper hanya boleh aksi read-only non-finansial yang dipakai
      // prefill modal laporan (openLaporanModal & modal order: klien + unit registry).
      // list-unit-health & propose-new-unit: dipakai teknisi/helper dari modal laporan,
      // TIDAK di-gate Owner/Admin di sini — masing-masing punya gate SENDIRI di bawah
      // (lebih longgar tapi scope datanya sempit). CATATAN: "list-logs" SENGAJA TIDAK
      // di-exempt — responsnya memuat cost + enrich total/paid invoice (data finansial).
      const ROLE_EXEMPT = new Set(["list-clients", "list-units", "list-unit-health", "propose-new-unit"]);
      if (!ROLE_EXEMPT.has(action)) {
        const callerRole = await resolveCallerRole(req, SU, SK);
        // null = legacy INTERNAL_API_SECRET (server-to-server) → sistem, izinkan.
        if (callerRole !== null && callerRole !== "Owner" && callerRole !== "Admin") {
          return res.status(403).json({ error: "Forbidden: aksi maintenance ini butuh role Owner/Admin" });
        }
      }

      // Gate lapangan: Teknisi/Helper/Owner/Admin. Role DIVERIFIKASI SERVER-SIDE lewat
      // resolveCallerRole (decode JWT → lookup user_profiles.role), JANGAN percaya role
      // yang dikirim di body — X-Internal-Token dipegang semua user login, termasuk teknisi.
      const requireFieldStaff = async () => {
        const role = await resolveCallerRole(req, SU, SK);
        if (role === null) return null;                            // server-to-server (cron) → izinkan
        if (["Owner", "Admin", "Teknisi", "Helper"].includes(role)) return role;
        return false;                                              // "" (token invalid) atau role lain
      };

      const genToken = () => "mtk_" + Array.from({ length: 40 }, () =>
        "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

      try {
        // ---- CLIENTS ----
        if (action === "list-clients") {
          const r = await fetch(REST("maintenance_clients?select=*&order=created_at.desc"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          return res.status(200).json({ clients: await r.json() });
        }

        // ── T3: overview lintas-klien — cockpit harian Owner/Admin di halaman depan
        // Maintenance. 3 query agregat (BUKAN per-klien) → per client_id: unit
        // total/overdue, temuan open, tunggakan invoice. Frontend gabung by id.
        if (action === "overview") {
          const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // WIB
          const [uRes, fRes, iRes, oRes] = await Promise.all([
            fetch(REST("maintenance_units?select=client_id,status,next_service_date&limit=5000"), { headers }),
            fetch(REST("maintenance_followups?select=client_id,status&status=in.(open,scheduled,in_progress)&limit=2000"), { headers }),
            // SEMUA invoice outstanding (bukan cuma yang ber-maintenance_client_id) —
            // atribusi klien juga via order job_id, SAMA dgn list-invoices, supaya angka
            // cockpit = angka panel Tunggakan di dalam klien (jangan dua kebenaran).
            fetch(REST("invoices?select=job_id,maintenance_client_id,total,status,remaining_amount,paid_amount&status=in.(UNPAID,OVERDUE,PARTIAL_PAID)&limit=2000"), { headers }),
            fetch(REST("orders?select=id,maintenance_client_id&maintenance_client_id=not.is.null&limit=5000"), { headers }),
          ]);
          const units = uRes.ok ? await uRes.json() : [];
          const fus = fRes.ok ? await fRes.json() : [];
          const invs = iRes.ok ? await iRes.json() : [];
          const ords = oRes.ok ? await oRes.json() : [];
          const orderClient = new Map(ords.map(o => [o.id, o.maintenance_client_id]));
          const by = {};
          const g = (id) => (by[id] = by[id] || { units: 0, overdue: 0, followups: 0, tunggakan: 0, tunggakan_n: 0 });
          units.forEach(u => {
            if (!u.client_id) return;
            const c = g(u.client_id);
            if (u.status !== "retired" && u.status !== "nonaktif") c.units++;
            // Overdue termasuk unit rusak/perlu_perbaikan — justru paling butuh perhatian.
            // Dikecualikan: retired/nonaktif (keluar armada) & baru (belum mulai siklus).
            if (!["retired", "nonaktif", "baru"].includes(u.status) && u.next_service_date && u.next_service_date < today) c.overdue++;
          });
          fus.forEach(f => { if (f.client_id) g(f.client_id).followups++; });
          invs.forEach(i => {
            const cid = i.maintenance_client_id || orderClient.get(i.job_id);
            if (!cid) return; // bukan invoice klien maintenance
            const c = g(cid);
            // Paritas dgn panel Tunggakan InvoiceTab: remaining_amount → fallback
            // total - paid_amount (clamp ≥0), bukan langsung total penuh.
            const sisa = i.remaining_amount != null
              ? Number(i.remaining_amount)
              : Math.max(0, Number(i.total || 0) - Number(i.paid_amount || 0));
            c.tunggakan += sisa; c.tunggakan_n++;
          });
          return res.status(200).json({ overview: by, today });
        }
        // ---- LINK AUDIT (pemeriksa missing-link maintenance) ----
        // Mendeteksi pekerjaan maintenance yang link unit/client/invoice-nya putus, supaya
        // ketahuan SEBELUM menumpuk. Tidak mengubah data — murni laporan.
        if (action === "link-audit") {
          const days = Math.min(Math.max(Number(body.days) || 120, 7), 3650);
          const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
          const _arr = (v) => { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };
          const j = async (url) => { try { const r = await fetch(REST(url), { headers }); return r.ok ? await r.json() : []; } catch { return []; } };

          // 1) Order yang SUDAH ter-link ke client maintenance dalam window
          const linkedOrders = await j(`orders?maintenance_client_id=not.is.null&date=gte.${since}&select=id,customer,phone,service,status,date,maintenance_client_id,maintenance_unit_ids&order=date.desc&limit=3000`);
          const linkedIds = new Set(linkedOrders.map(o => o.id));
          // 2) Laporan VERIFIED dalam window (units_json untuk cek maint_unit_id)
          const verifiedReports = await j(`service_reports?status=eq.VERIFIED&date=gte.${since}&select=job_id,total_units,units_json&limit=6000`);
          const repByJob = {}; verifiedReports.forEach(r => { if (!repByJob[r.job_id]) repByJob[r.job_id] = r; });
          // 3) maintenance_logs dalam window → order mana yang sudah punya log
          const logsRows = await j(`maintenance_logs?service_date=gte.${since}&select=order_id&limit=10000`);
          const loggedOrders = new Set(logsRows.map(l => l.order_id).filter(Boolean));
          // 4) Clients (untuk nama & phone variants)
          const clients = await j(`maintenance_clients?select=id,name,pic_phone`);
          const clientName = Object.fromEntries(clients.map(c => [c.id, c.name]));
          // 5) Invoices dalam window (cek link ke client)
          const invoices = await j(`invoices?created_at=gte.${since}T00:00:00&select=id,job_id,customer,total,maintenance_client_id,status&limit=5000`);

          // === Temuan A: laporan VERIFIED tapi 0 log (history unit kosong) ===
          // Hanya laporan yang PUNYA unit (Survey/Cek tanpa unit tidak perlu log → bukan missing-link).
          const missing_logs = linkedOrders
            .filter(o => repByJob[o.id] && _arr(repByJob[o.id].units_json).length > 0 && !loggedOrders.has(o.id))
            .map(o => ({ order_id: o.id, customer: o.customer, client: clientName[o.maintenance_client_id] || "?", service: o.service, date: o.date, status: o.status }));

          // === Temuan B: link lemah — sudah ada log TAPI laporan punya unit tanpa maint_unit_id ===
          // (dicatat lewat pencocokan posisi yang rawan salah AC)
          const weak_links = linkedOrders
            .filter(o => repByJob[o.id] && loggedOrders.has(o.id))
            .map(o => {
              const units = _arr(repByJob[o.id].units_json);
              const noId = units.filter(u => u && !u.maint_unit_id).length;
              return noId > 0 ? { order_id: o.id, customer: o.customer, client: clientName[o.maintenance_client_id] || "?", service: o.service, date: o.date, units_total: units.length, units_no_id: noId } : null;
            })
            .filter(Boolean);

          // === Temuan C: laporan maintenance belum diverifikasi (autolog belum jalan) ===
          const submittedReports = await j(`service_reports?status=eq.SUBMITTED&date=gte.${since}&select=job_id,customer,date,service&limit=3000`);
          const unverified = submittedReports
            .filter(r => linkedIds.has(r.job_id))
            .map(r => ({ order_id: r.job_id, customer: r.customer, date: r.date, service: r.service }));

          // === Temuan D: invoice order maintenance belum ter-link ke client ===
          const invoice_unlinked = invoices
            .filter(iv => iv.job_id && linkedIds.has(iv.job_id) && !iv.maintenance_client_id)
            .map(iv => ({ invoice_id: iv.id, order_id: iv.job_id, customer: iv.customer, total: iv.total, status: iv.status }));

          // === Temuan E: order BELUM ter-link tapi nomor HP cocok perusahaan maintenance ===
          const phoneToClient = {};
          clients.forEach(c => { const np = validateAndNormalizePhone(c.pic_phone); if (np) buildPhoneVariants(np).forEach(v => { phoneToClient[v] = c; }); });
          const variants = Object.keys(phoneToClient);
          let unlinked_candidates = [];
          if (variants.length) {
            const unlinkedOrders = await j(`orders?maintenance_client_id=is.null&phone=in.(${encodeURIComponent(variants.join(","))})&date=gte.${since}&select=id,customer,phone,service,status,date&order=date.desc&limit=2000`);
            unlinked_candidates = unlinkedOrders.map(o => ({ order_id: o.id, customer: o.customer, phone: o.phone, service: o.service, date: o.date, status: o.status, suggest_client: phoneToClient[o.phone]?.name || "?", suggest_client_id: phoneToClient[o.phone]?.id || null }));
          }

          return res.status(200).json({
            window_days: days,
            summary: { missing_logs: missing_logs.length, weak_links: weak_links.length, unverified: unverified.length, invoice_unlinked: invoice_unlinked.length, unlinked_candidates: unlinked_candidates.length },
            missing_logs, weak_links, unverified, invoice_unlinked, unlinked_candidates,
          });
        }

        // Tautkan order yang belum ter-link ke perusahaan maintenance (1 klik dari tab Cek Link).
        // ── Tautkan KLIEN kontrak ke baris customers (fondasi auto-link order) ──
        // maintenance_clients.customer_id adalah SATU-SATUNYA kunci penautan order
        // (bukan nama/HP — 1 HP bisa menunjuk banyak site & bisa dipakai bersama
        // customer perorangan). Selama kolom ini kosong, auto-link tak menemukan
        // apa pun. Relasi dijaga 1:1: satu baris customers hanya boleh dimiliki
        // satu klien kontrak, kalau tidak order jadi ambigu menuju site mana.
        if (action === "link-client-customer") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const custId = body.customer_id == null ? null : String(body.customer_id).trim();
          if (custId) {
            // Customer harus ada
            const uRes = await fetch(REST("customers?id=eq." + encodeURIComponent(custId) + "&select=id,name&limit=1"), { headers });
            const uRow = uRes.ok ? (await uRes.json())[0] : null;
            if (!uRow) return res.status(400).json({ error: "Customer tidak ditemukan" });
            // Jaga 1:1 — tolak bila sudah dipakai klien LAIN
            const dRes = await fetch(REST("maintenance_clients?customer_id=eq." + encodeURIComponent(custId) + "&select=id,name"), { headers });
            const dRows = dRes.ok ? await dRes.json() : [];
            const bentrok = (Array.isArray(dRows) ? dRows : []).find(x => x.id !== body.client_id);
            if (bentrok) return res.status(400).json({ error: `Customer ini sudah ditautkan ke "${bentrok.name}". Lepas dulu dari sana.` });
          }
          const r = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.client_id)), {
            method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify({ customer_id: custId || null }),
          });
          if (!r.ok) return res.status(400).json({ error: "Gagal tautkan customer", detail: await r.text() });
          const updated = (await r.json())[0];
          if (!updated) return res.status(404).json({ error: "Perusahaan tidak ditemukan" });
          return res.status(200).json({ ok: true, client: updated });
        }

        // Kandidat baris customers untuk ditautkan ke klien kontrak (dipakai UI
        // penautan). Pencocokan by NOMOR HP PIC — sengaja hanya SARAN, keputusan
        // tetap di tangan Owner, karena satu HP bisa menaungi beberapa site
        // sekaligus customer perorangan.
        if (action === "customer-candidates") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const cRes = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.client_id) + "&select=id,name,pic_phone&limit=1"), { headers });
          const klien = cRes.ok ? (await cRes.json())[0] : null;
          if (!klien) return res.status(404).json({ error: "Perusahaan tidak ditemukan" });
          const hp = String(klien.pic_phone || "").replace(/\D/g, "");
          let rows = [];
          if (hp) {
            const q = await fetch(REST("customers?phone=eq." + encodeURIComponent(hp) + "&select=id,name,phone,address&order=name&limit=50"), { headers });
            rows = q.ok ? await q.json() : [];
          }
          // Tandai customer yang SUDAH dipakai klien lain agar tak dipilih dua kali
          let terpakai = {};
          if (rows.length) {
            const ids = rows.map(r2 => r2.id).map(encodeURIComponent).join(",");
            const t = await fetch(REST("maintenance_clients?customer_id=in.(" + ids + ")&select=id,name,customer_id"), { headers });
            const tr = t.ok ? await t.json() : [];
            (Array.isArray(tr) ? tr : []).forEach(x => { if (x.id !== body.client_id) terpakai[x.customer_id] = x.name; });
          }
          return res.status(200).json({ client: klien, candidates: rows, taken: terpakai });
        }

        if (action === "link-order") {
          if (!body.order_id || !body.client_id) return res.status(400).json({ error: "order_id & client_id wajib" });
          // Pastikan klien ada (hindari set FK sembarangan)
          const cRes = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.client_id) + "&select=id&limit=1"), { headers });
          if (!cRes.ok || !(await cRes.json())[0]) return res.status(400).json({ error: "Perusahaan tidak ditemukan" });
          const r = await fetch(REST("orders?id=eq." + encodeURIComponent(body.order_id)), {
            method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify({ maintenance_client_id: body.client_id }),
          });
          if (!r.ok) return res.status(400).json({ error: "Gagal tautkan order", detail: await r.text() });
          const updated = (await r.json())[0];
          if (!updated) return res.status(404).json({ error: "Order tidak ditemukan" });
          return res.status(200).json({ ok: true, order: updated });
        }

        // Ambil unit laporan (units_json) untuk modal "Petakan Unit" di tab Cek Link.
        if (action === "report-units") {
          if (!body.order_id) return res.status(400).json({ error: "order_id wajib" });
          const _arr = (v) => { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };
          const r = await fetch(REST("service_reports?job_id=eq." + encodeURIComponent(body.order_id) + "&select=units_json,total_units,service,date&order=updated_at.desc&limit=1"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          const rep = (await r.json())[0];
          if (!rep) return res.status(200).json({ units: [], found: false });
          const units = _arr(rep.units_json).map((u, idx) => ({
            idx, label: u.label || "", tipe: u.tipe || "", merk: u.merk || "", pk: u.pk || "",
            model: u.model || "", maint_unit_id: u.maint_unit_id || null,
          }));
          return res.status(200).json({ units, service: rep.service, date: rep.date, found: true });
        }

        // Petakan unit laporan → unit registry (set maint_unit_id), lalu siap re-autolog.
        // body: { order_id, mapping: [{ idx, maint_unit_id }] }
        if (action === "remap-report-units") {
          if (!body.order_id || !Array.isArray(body.mapping)) return res.status(400).json({ error: "order_id & mapping wajib" });
          const _arr = (v) => { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };
          // Order (sumber field maintenance)
          const oRes = await fetch(REST("orders?id=eq." + encodeURIComponent(body.order_id) + "&select=id,maintenance_client_id,maintenance_unit_ids&limit=1"), { headers });
          const order = (await oRes.json())[0];
          if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
          // Laporan terbaru
          const rRes = await fetch(REST("service_reports?job_id=eq." + encodeURIComponent(body.order_id) + "&select=id,units_json&order=updated_at.desc&limit=1"), { headers });
          const rep = (await rRes.json())[0];
          if (!rep) return res.status(404).json({ error: "Laporan tidak ditemukan" });
          // Validasi unit_id milik klien ini
          const clientId = order.maintenance_client_id;
          if (!clientId) return res.status(400).json({ error: "Order belum ter-link perusahaan — tautkan dulu" });
          const uRes = await fetch(REST("maintenance_units?client_id=eq." + encodeURIComponent(clientId) + "&select=id"), { headers });
          const validSet = new Set((await uRes.json()).map(u => u.id));
          const units = _arr(rep.units_json);
          const usedIds = [];
          for (const m of body.mapping) {
            const i = Number(m.idx);
            if (i >= 0 && i < units.length && m.maint_unit_id && validSet.has(m.maint_unit_id)) {
              units[i] = { ...units[i], maint_unit_id: m.maint_unit_id };
              usedIds.push(m.maint_unit_id);
            }
          }
          if (!usedIds.length) return res.status(400).json({ error: "Tidak ada pemetaan valid" });
          // 1) Simpan maint_unit_id ke units_json laporan
          const pr = await fetch(REST("service_reports?id=eq." + encodeURIComponent(rep.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ units_json: units }) });
          if (!pr.ok) return res.status(400).json({ error: "Gagal simpan laporan", detail: await pr.text() });
          // 2) Pastikan order.maintenance_unit_ids memuat unit yang dipetakan
          const newUnitIds = [...new Set([...(Array.isArray(order.maintenance_unit_ids) ? order.maintenance_unit_ids : []), ...usedIds])];
          await fetch(REST("orders?id=eq." + encodeURIComponent(body.order_id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ maintenance_unit_ids: newUnitIds }) });
          // 3) Hapus log lama order ini supaya re-autolog bersih (cegah dobel / posisi lama)
          await fetch(REST("maintenance_logs?order_id=eq." + encodeURIComponent(body.order_id)), { method: "DELETE", headers });
          return res.status(200).json({ ok: true, mapped: usedIds.length });
        }

        if (action === "create-client") {
          const name = sanitizeName(body.name);
          if (!name) return res.status(400).json({ error: "Nama perusahaan wajib" });
          const payload = {
            name,
            address: body.address || null,
            pic_name: body.pic_name || null,
            pic_phone: validateAndNormalizePhone(body.pic_phone) || null,
            notes: body.notes || null,
            portal_token: genToken(),
            token_active: true,
            hide_costs: body.hide_costs !== false,
            contract_start_date: body.contract_start_date || null,
            contract_end_date: body.contract_end_date || null,
            contract_value: body.contract_value ? Number(body.contract_value) : null,
          };
          const r = await fetch(REST("maintenance_clients"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
          if (!r.ok) return res.status(400).json({ error: "Gagal buat klien", detail: await r.text() });
          return res.status(200).json({ client: (await r.json())[0] });
        }
        if (action === "update-client") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const upd = {};
          ["name", "address", "pic_name", "notes", "contract_status"].forEach(k => { if (body[k] !== undefined) upd[k] = body[k]; });
          if (body.contract_start_date !== undefined) upd.contract_start_date = body.contract_start_date || null;
          if (body.contract_end_date !== undefined) upd.contract_end_date = body.contract_end_date || null;
          if (body.contract_value !== undefined) upd.contract_value = body.contract_value ? Number(body.contract_value) : null;
          if (body.pic_phone !== undefined) upd.pic_phone = validateAndNormalizePhone(body.pic_phone) || null;
          if (body.hide_costs !== undefined) upd.hide_costs = !!body.hide_costs;
          if (body.token_active !== undefined) upd.token_active = !!body.token_active;
          if (body.token_expires_at !== undefined) upd.token_expires_at = body.token_expires_at || null;
          if (body.customer_id !== undefined) upd.customer_id = body.customer_id || null;
          const r = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(upd) });
          if (!r.ok) return res.status(400).json({ error: "Gagal update klien", detail: await r.text() });
          return res.status(200).json({ client: (await r.json())[0] });
        }
        if (action === "regen-token") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const tok = genToken();
          const r = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ portal_token: tok }) });
          if (!r.ok) return res.status(400).json({ error: "Gagal regenerate", detail: await r.text() });
          return res.status(200).json({ client: (await r.json())[0] });
        }
        if (action === "delete-client") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const r = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.id)), { method: "DELETE", headers });
          if (!r.ok) return res.status(400).json({ error: "Gagal hapus", detail: await r.text() });
          return res.status(200).json({ ok: true });
        }

        // ---- DOCUMENTS (BA / Commissioning / Garansi / Surat Barang) ----
        if (action === "list-documents") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST("maintenance_documents?maintenance_client_id=eq." + encodeURIComponent(body.client_id) + "&select=*&order=created_at.desc"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          return res.status(200).json({ documents: await r.json() });
        }
        if (action === "create-document") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          if (!body.jenis) return res.status(400).json({ error: "jenis wajib" });
          const payload = {
            maintenance_client_id: body.client_id,
            jenis: body.jenis,
            nomor: body.nomor || null,
            tanggal: body.tanggal || null,
            kepada: body.kepada || null,
            periode: body.periode || null,
            uraian: body.uraian || null,
            items: Array.isArray(body.items) ? body.items : [],
            checklist: Array.isArray(body.checklist) ? body.checklist : [],
            foto: Number(body.foto) || 0,
          };
          const r = await fetch(REST("maintenance_documents"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
          if (!r.ok) return res.status(400).json({ error: "Gagal buat dokumen", detail: await r.text() });
          return res.status(200).json({ document: (await r.json())[0] });
        }
        if (action === "update-document") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const upd = {};
          ["jenis", "nomor", "tanggal", "kepada", "periode", "uraian", "ttd_teknisi", "ttd_customer", "ttd_customer_img"].forEach(k => { if (body[k] !== undefined) upd[k] = body[k] || null; });
          if (body.items !== undefined) upd.items = Array.isArray(body.items) ? body.items : [];
          if (body.checklist !== undefined) upd.checklist = Array.isArray(body.checklist) ? body.checklist : [];
          if (body.foto !== undefined) upd.foto = Number(body.foto) || 0;
          const r = await fetch(REST("maintenance_documents?id=eq." + encodeURIComponent(body.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(upd) });
          if (!r.ok) return res.status(400).json({ error: "Gagal update dokumen", detail: await r.text() });
          return res.status(200).json({ document: (await r.json())[0] });
        }
        if (action === "delete-document") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const r = await fetch(REST("maintenance_documents?id=eq." + encodeURIComponent(body.id)), { method: "DELETE", headers });
          if (!r.ok) return res.status(400).json({ error: "Gagal hapus dokumen", detail: await r.text() });
          return res.status(200).json({ ok: true });
        }

        // ---- UNITS ----
        if (action === "list-units") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST("maintenance_units?client_id=eq." + encodeURIComponent(body.client_id) + "&select=*&order=unit_code.asc"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          return res.status(200).json({ units: await r.json() });
        }
        // ── Riwayat unit versi RINGKAS untuk badge kesehatan di modal laporan teknisi ──
        // Sengaja TIDAK memakai "list-logs": itu mengembalikan select=* (termasuk cost)
        // + enrich total/paid invoice = data finansial yang hanya untuk Owner/Admin.
        // Di sini hanya kolom yang dibutuhkan unitHealth() (src/lib/maintenanceHealth.js):
        // unit_id, service_date, measurements, description, materials (materials ditulis
        // autolog TANPA harga — lihat komentar "Harga TIDAK disertakan" di autolog).
        if (action === "list-unit-health") {
          const roleOk = await requireFieldStaff();
          if (roleOk === false) return res.status(403).json({ error: "Forbidden" });
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST("maintenance_logs?client_id=eq." + encodeURIComponent(body.client_id)
            + "&select=unit_id,service_date,measurements,description,materials&order=service_date.desc&limit=2000"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          return res.status(200).json({ logs: await r.json() });
        }

        // ── Unit baru ditemukan teknisi di lapangan → masuk registry sbg 'baru' ──
        // Scope SEMPIT: hanya INSERT 1 baris. Tidak bisa update/hapus unit existing
        // (itu tetap milik save-units/delete-unit yang Owner/Admin-only). status='baru'
        // = antre verifikasi admin; konvensi existing memperlakukan 'baru' sebagai
        // "belum perlu servis" (di-skip autolog & hitungan PM overdue).
        if (action === "propose-new-unit") {
          const roleOk = await requireFieldStaff();
          if (roleOk === false) return res.status(403).json({ error: "Forbidden" });
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const u = body.unit || {};
          const lokasi = String(u.location || "").trim();
          const kode = String(u.unit_code || "").trim();
          if (!lokasi && !kode) return res.status(400).json({ error: "Lokasi atau kode unit wajib diisi" });
          // UNIQUE(client_id, unit_code) per migrasi 059 → auto-generate bila kosong.
          const unitCode = kode || ("BARU-" + Date.now().toString(36).toUpperCase().slice(-5));
          const pengaju = String(body.proposed_by || "").trim() || "teknisi";
          const payload = {
            client_id: body.client_id,
            unit_code: unitCode,
            location: lokasi || null,
            brand: u.brand || null,
            ac_type: u.ac_type || null,
            capacity_pk: u.capacity_pk != null && u.capacity_pk !== "" ? Number(u.capacity_pk) : null,
            refrigerant: u.refrigerant || null,
            status: "baru",
            service_interval_months: 3,
            notes: `Diajukan dari lapangan oleh ${pengaju}${body.job_id ? " (order " + body.job_id + ")" : ""}`,
          };
          const r = await fetch(REST("maintenance_units"), {
            method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload),
          });
          if (!r.ok) {
            const detail = await r.text();
            const dup = /duplicate key|unique/i.test(detail);
            return res.status(400).json({ error: dup ? "Kode unit sudah dipakai di klien ini — ganti kode" : "Gagal simpan unit baru", detail });
          }
          const saved = (await r.json())[0];
          // Notifikasi admin (pola sama MAINTENANCE_REGISTRY_REVIEW) — non-blocking.
          fetch(SU + "/rest/v1/agent_logs", {
            method: "POST",
            headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "MAINTENANCE_NEW_UNIT_PROPOSED",
              severity: "warn", category: "maintenance", status: "WARNING",
              detail: `Unit baru "${saved.unit_code}" (${saved.location || "-"}) diajukan ${pengaju} dari order ${body.job_id || "-"}. Cek & aktifkan di Maintenance → tab Unit.`,
              metadata: { client_id: body.client_id, unit_id: saved.id, job_id: body.job_id || null, proposed_by: pengaju },
              time: new Date().toISOString(),
            }),
          }).catch(() => {});
          return res.status(200).json({ unit: saved });
        }

        if (action === "save-units") {
          // batch unit (insert baru / update existing). body.units = [{id?, client_id, unit_code, ...}]
          // Row ber-id → PATCH by id (aman saat ganti unit_code). Row baru → INSERT.
          if (!Array.isArray(body.units) || !body.units.length) return res.status(400).json({ error: "units kosong" });
          const clean = (u) => ({
            client_id: body.client_id || u.client_id,
            unit_code: String(u.unit_code || "").trim(),
            location: u.location || null,
            brand: u.brand || null,
            ac_type: u.ac_type || null,
            capacity_pk: u.capacity_pk != null && u.capacity_pk !== "" ? Number(u.capacity_pk) : null,
            refrigerant: u.refrigerant || null,
            year_installed: u.year_installed ? parseInt(u.year_installed) : null,
            serial_no: u.serial_no || null,
            // Whitelist LENGKAP sesuai opsi UI (STATUSES di MaintenanceView) — dulu cuma
            // 3 nilai → status "baru"/"perlu_perbaikan"/dll dipaksa jadi "active" DIAM-DIAM
            // (bug: unit baru langsung dianggap aktif & ikut ke-autolog). Temuan audit 18 Jul.
            status: ["active", "baru", "perlu_perbaikan", "dalam_perbaikan", "nonaktif", "rusak", "retired"].includes(u.status) ? u.status : "active",
            notes: u.notes || null,
            high_freq: u.high_freq === true || u.high_freq === "true",
            service_interval_months: u.service_interval_months != null && u.service_interval_months !== "" ? Number(u.service_interval_months) : 3,
            // last_service_date opsional (dipakai GantiUnitModal utk baseline unit pengganti;
            // trigger DB lantas menghitung next_service_date) — tanpa ini pengganti tak punya
            // jadwal & hilang dari radar PM sampai servis pertama.
            ...(u.last_service_date ? { last_service_date: u.last_service_date } : {}),
          });
          const valid = body.units.filter(u => String(u.unit_code || "").trim());
          if (!valid.length) return res.status(400).json({ error: "unit_code wajib di tiap unit" });
          const out = [];
          for (const u of valid) {
            const payload = clean(u);
            let r;
            if (u.id) {
              r = await fetch(REST("maintenance_units?id=eq." + encodeURIComponent(u.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
            } else {
              r = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
            }
            if (!r.ok) {
              const detail = await r.text();
              const dup = /duplicate key|unique/i.test(detail);
              return res.status(400).json({ error: dup ? `Kode unit "${payload.unit_code}" sudah ada` : "Gagal simpan unit", detail });
            }
            const arr = await r.json(); if (arr[0]) out.push(arr[0]);
          }
          return res.status(200).json({ units: out });
        }
        if (action === "delete-unit") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const r = await fetch(REST("maintenance_units?id=eq." + encodeURIComponent(body.id)), { method: "DELETE", headers });
          if (!r.ok) return res.status(400).json({ error: "Gagal hapus unit", detail: await r.text() });
          return res.status(200).json({ ok: true });
        }

        // ---- PRICE BOOK per-klien (harga deal khusus per perusahaan) ----
        if (action === "list-prices") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST("maintenance_client_prices?client_id=eq." + encodeURIComponent(body.client_id) + "&select=*&order=service_type.asc,capacity_pk.asc"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          return res.status(200).json({ prices: await r.json() });
        }
        if (action === "save-price") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          if (!body.service_type) return res.status(400).json({ error: "service_type wajib" });
          if (body.unit_price == null || body.unit_price === "") return res.status(400).json({ error: "unit_price wajib" });
          const payload = {
            client_id: body.client_id,
            service_type: String(body.service_type).trim(),
            ac_type: body.ac_type ? String(body.ac_type).trim() : null,
            capacity_pk: body.capacity_pk != null && body.capacity_pk !== "" ? Number(body.capacity_pk) : null,
            unit_price: Math.round(Number(body.unit_price)),
            notes: body.notes || null,
          };
          let r;
          if (body.id) {
            r = await fetch(REST("maintenance_client_prices?id=eq." + encodeURIComponent(body.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
          } else {
            r = await fetch(REST("maintenance_client_prices"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
          }
          if (!r.ok) {
            const detail = await r.text();
            const dup = /duplicate key|unique/i.test(detail);
            return res.status(400).json({ error: dup ? "Kombinasi servis + tipe + kapasitas itu sudah ada" : "Gagal simpan harga", detail });
          }
          return res.status(200).json({ price: (await r.json())[0] });
        }
        if (action === "delete-price") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const r = await fetch(REST("maintenance_client_prices?id=eq." + encodeURIComponent(body.id)), { method: "DELETE", headers });
          if (!r.ok) return res.status(400).json({ error: "Gagal hapus harga", detail: await r.text() });
          return res.status(200).json({ ok: true });
        }

        // ---- LOGS ----
        if (action === "list-logs") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST("maintenance_logs?client_id=eq." + encodeURIComponent(body.client_id) + "&select=*&order=service_date.desc"), { headers });
          if (!r.ok) return res.status(500).json({ error: "DB error", detail: await r.text() });
          let logs = await r.json();

          // ── Enrich biaya & status invoiced dari invoice yang tersambung (jalur order) ──
          // Log jalur order dibuat cost=null (biaya ada di modul Invoice, bukan di log) → Statistik
          // tampil Rp 0. Join via log.order_id = invoice.job_id supaya Statistik mencerminkan invoice
          // live (billed/paid). Pemicu = cost masih kosong; log B2B (cost manual) dibiarkan apa adanya.
          try {
            const needOrderIds = [...new Set(
              (Array.isArray(logs) ? logs : [])
                .filter(l => l.cost == null && l.order_id)
                .map(l => l.order_id)
            )];
            if (needOrderIds.length) {
              const inFilter = needOrderIds.map(encodeURIComponent).join(",");
              const ivRes = await fetch(REST(`invoices?job_id=in.(${inFilter})&select=job_id,total,status,paid_amount,created_at&order=created_at.desc`), { headers });
              const ivRows = ivRes.ok ? await ivRes.json() : [];
              // 1 invoice per job_id (ambil terbaru — sudah desc by created_at)
              const invByJob = {};
              for (const iv of (Array.isArray(ivRows) ? ivRows : [])) {
                if (!invByJob[iv.job_id]) invByJob[iv.job_id] = iv;
              }
              // Hitung jumlah log per order_id → bagi rata biaya invoice antar unit (ranking adil, total tetap akurat)
              const logCountByOrder = {};
              for (const l of logs) {
                if (l.cost == null && l.order_id && invByJob[l.order_id]) {
                  logCountByOrder[l.order_id] = (logCountByOrder[l.order_id] || 0) + 1;
                }
              }
              logs = logs.map(l => {
                if (l.cost != null || !l.order_id) return l;
                const iv = invByJob[l.order_id];
                if (!iv) return l;
                const n = logCountByOrder[l.order_id] || 1;
                return {
                  ...l,
                  cost: Math.round((Number(iv.total) || 0) / n),
                  invoiced: true,
                  invoice_status: iv.status || null,
                };
              });
            }
          } catch (_) { /* non-blocking — kalau gagal, kembalikan logs apa adanya */ }

          return res.status(200).json({ logs });
        }

        // ---- HISTORY SERVICE: semua invoice tersambung ke klien maintenance ----
        // Link andal (tanpa false-positive nomor HP bersama):
        //   a) invoices.maintenance_client_id = client_id (B2B + order-path ter-link)
        //   b) invoices.job_id ∈ orders milik klien (order-path, walau invoice belum ter-link langsung)
        if (action === "list-invoices") {
          if (!body.client_id) return res.status(400).json({ error: "client_id wajib" });
          const SELECT = "id,job_id,customer,service,units,total,labor,material,status,due,paid_at,paid_amount,remaining_amount,created_at,garansi_expires,invoice_type,maintenance_client_id";
          const byId = {};
          const addRows = (rows) => { for (const iv of (Array.isArray(rows) ? rows : [])) byId[iv.id] = iv; };
          // a. langsung ter-link
          try {
            const r = await fetch(REST(`invoices?maintenance_client_id=eq.${encodeURIComponent(body.client_id)}&select=${SELECT}`), { headers });
            if (r.ok) addRows(await r.json());
          } catch (_) {}
          // b. via order milik klien
          try {
            const oRes = await fetch(REST("orders?maintenance_client_id=eq." + encodeURIComponent(body.client_id) + "&select=id"), { headers });
            const oRows = oRes.ok ? await oRes.json() : [];
            const orderIds = (Array.isArray(oRows) ? oRows : []).map(o => o.id).filter(Boolean);
            if (orderIds.length) {
              const inFilter = orderIds.map(encodeURIComponent).join(",");
              const r = await fetch(REST(`invoices?job_id=in.(${inFilter})&select=${SELECT}`), { headers });
              if (r.ok) addRows(await r.json());
            }
          } catch (_) {}
          const invoices = Object.values(byId).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
          return res.status(200).json({ invoices });
        }

        if (action === "create-log") {
          if (!body.unit_id || !body.client_id || !body.service_date) return res.status(400).json({ error: "unit_id, client_id, service_date wajib" });
          const payload = {
            unit_id: body.unit_id,
            client_id: body.client_id,
            service_date: body.service_date,
            service_type: body.service_type || null,
            technician: body.technician || null,
            description: body.description || null,
            parts_used: Array.isArray(body.parts_used) ? body.parts_used : [],
            cost: body.cost != null && body.cost !== "" ? Math.round(Number(body.cost)) : null,
            photos: Array.isArray(body.photos) ? body.photos : [],
            order_id: body.order_id || null,
            created_by: body.created_by || null,
          };
          const r = await fetch(REST("maintenance_logs"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
          if (!r.ok) return res.status(400).json({ error: "Gagal simpan log", detail: await r.text() });
          await rollUnitSchedule([payload.unit_id], payload.service_date); // roda PPM maju
          return res.status(200).json({ log: (await r.json())[0] });
        }
        if (action === "update-log") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const allowed = ["description", "technician", "cost", "service_type", "service_category", "photos", "materials", "invoiced"];
          const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
          if (!Object.keys(patch).length) return res.status(400).json({ error: "Tidak ada field yang diupdate" });
          const r = await fetch(REST("maintenance_logs?id=eq." + encodeURIComponent(body.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(patch) });
          if (!r.ok) return res.status(400).json({ error: "Gagal update log", detail: await r.text() });
          return res.status(200).json({ log: (await r.json())[0] });
        }
        if (action === "delete-log") {
          if (!body.id) return res.status(400).json({ error: "id wajib" });
          const r = await fetch(REST("maintenance_logs?id=eq." + encodeURIComponent(body.id)), { method: "DELETE", headers });
          if (!r.ok) return res.status(400).json({ error: "Gagal hapus log", detail: await r.text() });
          return res.status(200).json({ ok: true });
        }

        // ---- FOLLOW-UP ACTIONS ----
        // Tracking temuan lapangan (kapasitor rusak, bocor freon, dll) per unit.
        if (action === "list-followups") {
          const { client_id, unit_id, status: fStatus } = body;
          if (!client_id) return res.status(400).json({ error: "client_id wajib" });
          let q = "maintenance_followups?client_id=eq." + encodeURIComponent(client_id) + "&order=found_date.desc&select=*,maintenance_units(unit_code,location,brand)";
          if (unit_id) q += "&unit_id=eq." + encodeURIComponent(unit_id);
          if (fStatus) q += "&status=eq." + encodeURIComponent(fStatus);
          const fRes = await fetch(REST(q), { headers });
          if (!fRes.ok) return res.status(400).json({ error: "Gagal fetch followups" });
          return res.status(200).json({ followups: await fRes.json() });
        }
        if (action === "create-followup") {
          const { unit_id, client_id, issue_type, description: fDesc, found_by, priority, log_id, estimated_cost } = body;
          if (!unit_id || !client_id || !issue_type) return res.status(400).json({ error: "unit_id, client_id, issue_type wajib" });
          const payload = { unit_id, client_id, issue_type, found_by: found_by || null, priority: priority || "normal", status: "open", found_date: body.found_date || new Date().toISOString().slice(0, 10) };
          if (fDesc) payload.description = fDesc;
          if (log_id) payload.log_id = log_id;
          if (estimated_cost) payload.estimated_cost = estimated_cost;
          const fRes = await fetch(REST("maintenance_followups"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(payload) });
          if (!fRes.ok) return res.status(400).json({ error: "Gagal buat followup", detail: await fRes.text() });
          return res.status(200).json({ followup: (await fRes.json())[0] });
        }
        if (action === "update-followup") {
          const { id: fId, status: fStatus, resolved_by, resolution, order_id: fOrderId } = body;
          if (!fId) return res.status(400).json({ error: "id wajib" });
          const patch = {};
          if (fStatus) patch.status = fStatus;
          if (resolved_by) patch.resolved_by = resolved_by;
          if (resolution) patch.resolution = resolution;
          if (fOrderId) patch.order_id = fOrderId; // link temuan→order (kolom migrasi 099)
          if (fStatus === "done" && !patch.resolved_date) patch.resolved_date = new Date().toISOString().slice(0, 10);
          const fRes = await fetch(REST("maintenance_followups?id=eq." + encodeURIComponent(fId)), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(patch) });
          if (!fRes.ok) return res.status(400).json({ error: "Gagal update followup", detail: await fRes.text() });
          return res.status(200).json({ followup: (await fRes.json())[0] });
        }

        // ---- PRE-SERVICE MANIFEST ----
        // Perencanaan penugasan tim SEBELUM berangkat ke lokasi.
        if (action === "create-manifest") {
          const { client_id, service_date, order_id: mOid, notes: mNotes, items } = body;
          if (!client_id || !service_date) return res.status(400).json({ error: "client_id & service_date wajib" });
          // Upsert manifest (1 per klien per hari)
          const mPayload = { client_id, service_date, status: "draft" };
          if (mOid) mPayload.order_id = mOid;
          if (mNotes) mPayload.notes = mNotes;
          if (body.created_by) mPayload.created_by = body.created_by;
          const mRes = await fetch(REST("pre_service_manifests"), { method: "POST", headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(mPayload) });
          if (!mRes.ok) return res.status(400).json({ error: "Gagal buat manifest", detail: await mRes.text() });
          const manifest = (await mRes.json())[0];
          // Insert items jika dikirim sekaligus
          if (Array.isArray(items) && items.length) {
            const itemRows = items.map(it => ({ manifest_id: manifest.id, unit_id: it.unit_id, team_label: it.team_label || null, technician: it.technician || null, helper: it.helper || null, service_category: it.service_category || "cuci_rutin" }));
            await fetch(REST("pre_service_manifest_items"), { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(itemRows) });
          }
          return res.status(200).json({ manifest });
        }
        if (action === "get-manifest") {
          const { client_id, service_date } = body;
          if (!client_id || !service_date) return res.status(400).json({ error: "client_id & service_date wajib" });
          const mRes = await fetch(REST("pre_service_manifests?client_id=eq." + encodeURIComponent(client_id) + "&service_date=eq." + encodeURIComponent(service_date) + "&select=*,pre_service_manifest_items(*)&limit=1"), { headers });
          if (!mRes.ok) return res.status(400).json({ error: "Gagal fetch manifest" });
          const rows = await mRes.json();
          return res.status(200).json({ manifest: rows[0] || null });
        }

        // ---- INVOICE B2B (GROUP) ----
        // Buat 1 invoice gabungan dari beberapa log servis yang dipilih.
        // Harga per unit: l.cost jika ada; fallback ke price_list (Cleaning, PK-based).
        // preview=true → hitung saja, tidak buat invoice (untuk preview di UI).
        if (action === "create-invoice" || action === "preview-invoice") {
          const isPreview = action === "preview-invoice";
          if (!body.client_id || !Array.isArray(body.log_ids) || !body.log_ids.length)
            return res.status(400).json({ error: "client_id & log_ids wajib" });

          // Ambil klien
          const cRes = await fetch(REST("maintenance_clients?id=eq." + encodeURIComponent(body.client_id) + "&select=*"), { headers });
          const cRows = await cRes.json();
          if (!cRows.length) return res.status(404).json({ error: "Klien tidak ditemukan" });
          const client = cRows[0];

          // Ambil logs terpilih
          const idFilter = body.log_ids.join(",");
          const lRes = await fetch(REST(`maintenance_logs?id=in.(${encodeURIComponent(idFilter)})&select=id,service_type,service_date,cost,unit_id,order_id&order=service_date.asc`), { headers });
          const logs = await lRes.json();
          if (!Array.isArray(logs) || !logs.length) return res.status(400).json({ error: "Log tidak ditemukan" });

          // Ambil unit details (brand, pk, lokasi) untuk semua log sekaligus
          const unitIds = [...new Set(logs.map(l => l.unit_id).filter(Boolean))];
          const uRes = await fetch(REST(`maintenance_units?id=in.(${encodeURIComponent(unitIds.join(","))})&select=id,unit_code,location,brand,capacity_pk`), { headers });
          const unitRows = uRes.ok ? await uRes.json() : [];
          const unitById = Object.fromEntries((Array.isArray(unitRows) ? unitRows : []).map(u => [u.id, u]));

          // Ambil price_list Cleaning untuk fallback harga
          const plRes = await fetch(REST(`price_list?service=eq.Cleaning&is_active=eq.true&select=type,price`), { headers });
          const plRows = plRes.ok ? await plRes.json() : [];
          const plMap = Object.fromEntries((Array.isArray(plRows) ? plRows : []).map(r => [r.type, Number(r.price)]));
          const priceFor = (pk) => {
            const pkN = parseFloat(pk) || 1;
            if (pkN <= 1)   return plMap["AC Split 0.5-1PK"]   || 95000;
            if (pkN <= 2.5) return plMap["AC Split 1.5-2.5PK"] || 100000;
            if (pkN <= 3.5) return plMap["AC Split Duct 3PK"]  || 300000;
            return plMap["AC Split Duct 4PK"] || 400000;
          };

          // Bangun line items: 1 baris per log
          const lineItems = logs.map(l => {
            const u = unitById[l.unit_id] || {};
            const price = Number(l.cost) > 0 ? Number(l.cost) : priceFor(u.capacity_pk);
            return {
              unit_code: u.unit_code || "-",
              location: u.location || "-",
              brand: u.brand || "-",
              pk: u.capacity_pk || "-",
              service_type: l.service_type || "Maintenance",
              service_date: l.service_date || "-",
              price,
              log_id: l.id,
            };
          });

          const labor = lineItems.reduce((s, i) => s + i.price, 0);
          const discount = Number(body.discount) || 0;
          const total = Math.max(0, labor - discount);

          if (isPreview) return res.status(200).json({ line_items: lineItems, labor, discount, total, count: lineItems.length });

          // Generate invoice id (format: INV-YYYYMMDD-XXXXX)
          const now = new Date();
          const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
          const seq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
          const invId = "INV-" + ymd + "-" + seq;

          // Rentang tanggal servis untuk catatan invoice
          const dates = [...new Set(lineItems.map(i => i.service_date).filter(d => d !== "-"))].sort();
          const period = dates.length === 1 ? dates[0] : dates.length > 1 ? `${dates[0]} s/d ${dates[dates.length - 1]}` : "-";

          const invPayload = {
            id: invId,
            customer: client.name,
            phone: client.pic_phone || null,
            address: client.address || null,
            service: `Maintenance ${lineItems.length} unit — ${period}`,
            job_id: null,
            invoice_type: "service",
            units: lineItems.length,
            labor,
            material: 0,
            discount,
            total,
            status: "PENDING_APPROVAL",
            maintenance_client_id: client.id,
            materials_detail: JSON.stringify(lineItems),
            notes: body.notes || null,
            created_at: new Date().toISOString(),
          };
          const iRes = await fetch(REST("invoices"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(invPayload) });
          if (!iRes.ok) return res.status(400).json({ error: "Gagal buat invoice", detail: await iRes.text() });
          // Tandai logs sudah di-invoice
          await fetch(REST(`maintenance_logs?id=in.(${encodeURIComponent(idFilter)})`), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ invoiced: true }) });
          return res.status(200).json({ invoice: (await iRes.json())[0], line_items: lineItems, total });
        }

        // ---- AUTO-LOG dari order yang laporannya diverifikasi (Opsi B) ----
        // Idempotent: kalau order ini sudah punya log → skip (cegah dobel saat verify ulang).
        if (action === "autolog-from-order") {
          if (!body.order_id) return res.status(400).json({ error: "order_id wajib" });
          // Ambil order (sumber kebenaran field maintenance)
          const oRes = await fetch(REST("orders?id=eq." + encodeURIComponent(body.order_id) + "&select=id,phone,customer,maintenance_client_id,maintenance_unit_ids,teknisi,service,date"), { headers });
          const oRows = await oRes.json();
          if (!Array.isArray(oRows) || !oRows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
          const order = oRows[0];
          let clientId = order.maintenance_client_id || null;
          let unitIds = Array.isArray(order.maintenance_unit_ids) ? order.maintenance_unit_ids.slice() : [];

          // ── Lapis 2 (jaring pengaman): order belum ter-link tapi telpon cocok klien maintenance? ──
          // Berlaku untuk SEMUA jalur order (WA inbound, manual) & semua jenis servis.
          if (!clientId && order.phone) {
            const np = validateAndNormalizePhone(order.phone);
            if (np) {
              try {
                const orFilter = buildPhoneVariants(np).map(v => "pic_phone.eq." + v).join(",");
                const mcRes = await fetch(REST("maintenance_clients?or=(" + encodeURIComponent(orFilter) + ")&select=id&limit=1"), { headers });
                const mc = await mcRes.json();
                if (Array.isArray(mc) && mc.length) clientId = mc[0].id;
              } catch (_) {}
            }
          }
          if (!clientId) return res.status(200).json({ skipped: true, reason: "bukan order maintenance" });

          const explicitUnits = unitIds.length > 0;        // admin sudah pilih unit di Planning Order?
          // Default SEMUA unit HANYA untuk servis cleaning (servis massal seluruh lokasi).
          // Repair/Pasang/Complain → admin WAJIB pilih unit dulu (cegah salah catat ke 22 unit).
          const svcRaw = String(order.service || "").toLowerCase();
          const isCleaning = svcRaw.includes("cleaning") || svcRaw.includes("cuci");

          // ── Ambil laporan teknisi LEBIH AWAL (sebelum guard non-cleaning) ──
          // Laporan bisa jadi sumber kebenaran unit: teknisi memilih AC spesifik via
          // "Tambah dari Daftar Maintenance" di modal laporan (maint_unit_id terisi) walaupun
          // admin belum pilih unit di Planning Order. Tanpa ini, servis Repair/Pasang yang unitnya
          // dipilih di laporan (bukan di order) tidak pernah ter-log ke history per unit.
          const _arr = (v) => { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };
          let report = null;
          try {
            const rpRes = await fetch(REST("service_reports?job_id=eq." + encodeURIComponent(order.id) + "&select=units_json,foto_urls,fotos,materials_json,total_freon&order=updated_at.desc&limit=1"), { headers });
            const rp = await rpRes.json();
            if (Array.isArray(rp) && rp.length) report = rp[0];
          } catch (_) {}
          const repUnits = _arr(report?.units_json);
          const reportMaintIds = [...new Set(repUnits.map(ru => (ru && ru.maint_unit_id) || null).filter(Boolean))];
          // Laporan menunjuk unit spesifik & order belum punya pilihan → pakai unit dari laporan.
          if (!explicitUnits && reportMaintIds.length) unitIds = reportMaintIds.slice();

          // Bail HANYA bila tak ada info unit dari mana pun (order kosong, bukan cleaning, laporan
          // juga tak menunjuk unit). Kalau laporan sudah menunjuk unit → lanjut catat per unit.
          if (!explicitUnits && !isCleaning && !reportMaintIds.length) {
            // Bukan cleaning & unit belum dipilih → JANGAN auto-catat. Link klien saja, minta admin pilih.
            if (!order.maintenance_client_id) {
              fetch(REST("orders?id=eq." + encodeURIComponent(order.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ maintenance_client_id: clientId }) }).catch(() => {});
            }
            fetch(SU + "/rest/v1/agent_logs", {
              method: "POST",
              headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "MAINTENANCE_UNIT_SELECT_NEEDED",
                severity: "warn", category: "maintenance", status: "WARNING",
                detail: `Order ${order.id} (${order.customer || ""}) servis ${order.service || "-"} = customer maintenance, tapi unit belum dipilih. Admin pilih AC mana + konfirmasi ke customer sebelum catat ke history.`,
                metadata: { order_id: order.id, client_id: clientId, service: order.service },
                time: new Date().toISOString(),
              }),
            }).catch(sentryCatch("agent_log_maintenance_select", { order_id: order.id, client_id: clientId }));
            return res.status(200).json({ skipped: true, needs_unit_selection: true, reason: "servis non-cleaning — admin pilih unit dulu", client_linked: clientId });
          }

          // Cleaning tanpa pilihan eksplisit → default semua unit aktif (bukan baru/nonaktif/rusak).
          if (!unitIds.length) {
            try {
              const auRes = await fetch(REST("maintenance_units?client_id=eq." + encodeURIComponent(clientId) + "&status=eq.active&select=id&order=unit_code.asc"), { headers });
              const au = await auRes.json();
              if (Array.isArray(au)) unitIds = au.map(u => u.id);
            } catch (_) {}
          }
          if (!unitIds.length) return res.status(200).json({ skipped: true, reason: "klien maintenance tanpa unit aktif" });

          // Filter unit berstatus 'baru' dari daftar (AC BARU tidak perlu service).
          // Berlaku untuk unitIds eksplisit maupun auto-fetch — cegah log hantu ke AC yang belum aktif.
          try {
            const stRes = await fetch(REST("maintenance_units?id=in.(" + encodeURIComponent(unitIds.join(",")) + ")&select=id,status"), { headers });
            const stData = await stRes.json();
            const baruIds = new Set((Array.isArray(stData) ? stData : []).filter(u => u.status === "baru").map(u => u.id));
            if (baruIds.size > 0) {
              unitIds = unitIds.filter(id => !baruIds.has(id));
              console.log(`[autolog] Skip ${baruIds.size} unit status=baru`);
            }
          } catch (_) {}
          if (!unitIds.length) return res.status(200).json({ skipped: true, reason: "semua unit berstatus baru — tidak perlu log" });

          // Persist hasil resolusi balik ke order → order tampil ter-link di UI (non-blocking).
          if (!order.maintenance_client_id) {
            fetch(REST("orders?id=eq." + encodeURIComponent(order.id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ maintenance_client_id: clientId, maintenance_unit_ids: unitIds }) }).catch(() => {});
          }

          // ── Invoice linking selalu dijalankan (bahkan saat log sudah ada) ──
          // Penting: multi-team = tiap order punya invoice sendiri, semua harus ter-link ke client.
          try {
            const ivRes2 = await fetch(REST("invoices?job_id=eq." + encodeURIComponent(order.id) + "&select=id,maintenance_client_id&order=created_at.desc&limit=1"), { headers });
            const iv2 = await ivRes2.json();
            if (Array.isArray(iv2) && iv2.length && !iv2[0].maintenance_client_id) {
              fetch(REST("invoices?id=eq." + encodeURIComponent(iv2[0].id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ maintenance_client_id: clientId }) }).catch(() => {});
            }
          } catch (_) {}

          // Idempotency: sudah ada log utk order ini? (cek SETELAH invoice linking)
          const exRes = await fetch(REST("maintenance_logs?order_id=eq." + encodeURIComponent(order.id) + "&select=id&limit=1"), { headers });
          const ex = await exRes.json();
          if (Array.isArray(ex) && ex.length) return res.status(200).json({ skipped: true, reason: "sudah ter-log" });

          // ── Perkaya log dari laporan + invoice (visi "1-stop all-in") ──
          // 1) Laporan teknisi (sudah di-fetch lebih awal di atas): foto + material level-laporan.
          // foto_urls = URL penuh R2; MaintenanceView & portal render via /api/foto?key=<R2 key> → strip domain.
          const repFotos = _arr(report?.foto_urls).map(u => String(u || "").replace(/^https?:\/\/[^/]+\//, "")).filter(Boolean);
          // ── Foto PER-UNIT (numbering sesuai input teknisi) ──
          // Kolom `fotos` menyimpan tiap foto ber-tag unit_no (posisi unit di laporan, 1-based),
          // sedangkan `foto_urls` = daftar URL polos tanpa tag. Dulu autolog pakai repFotos (polos)
          // → SEMUA foto nempel ke SETIAP unit. Sekarang: tiap unit hanya dapat foto miliknya.
          // Foto tanpa unit_no (foto umum Step 3) = konteks bersama → ditempel ke semua unit.
          // Fallback: laporan lama tanpa kolom `fotos` → pakai repFotos (perilaku lama, tak putus).
          const stripFotoDom = (u) => String(u || "").replace(/^https?:\/\/[^/]+\//, "");
          const repFotosTagged = _arr(report?.fotos);
          const hasTaggedFotos = repFotosTagged.length > 0;
          const fotosByUnitNo = {};
          const fotosGlobal = [];
          for (const f of repFotosTagged) {
            const url = f && f.url ? stripFotoDom(f.url) : "";
            if (!url) continue;
            if (f.unit_no == null) fotosGlobal.push(url);
            else (fotosByUnitNo[f.unit_no] = fotosByUnitNo[f.unit_no] || []).push(url);
          }
          // Foto untuk 1 unit laporan (lu) = foto ber-tag unit_no-nya + foto global.
          const photosForUnit = (lu) => {
            if (!hasTaggedFotos) return repFotos;               // laporan lama → semua (perilaku lama)
            const own = (lu && lu.unit_no != null && fotosByUnitNo[lu.unit_no]) ? fotosByUnitNo[lu.unit_no] : [];
            return [...own, ...fotosGlobal];
          };
          const repMats = _arr(report?.materials_json);
          // Material level-laporan non-freon (barang/jasa) → ditaruh di log unit pertama saja
          const repMatsNonFreon = repMats.filter(m => String(m?.keterangan || "").toLowerCase() !== "freon");

          // 2) Invoice (sudah dibuat saat laporan submit) → hanya link ke maintenance client.
          //    Biaya per-AC TIDAK dicatat ke log (tidak ditampilkan di history/portal).
          try {
            const ivRes = await fetch(REST("invoices?job_id=eq." + encodeURIComponent(order.id) + "&select=id,maintenance_client_id&order=created_at.desc&limit=1"), { headers });
            const iv = await ivRes.json();
            if (Array.isArray(iv) && iv.length && !iv[0].maintenance_client_id) {
              // Link invoice ↔ maintenance client (jalur order, bukan B2B create-invoice)
              fetch(REST("invoices?id=eq." + encodeURIComponent(iv[0].id)), { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ maintenance_client_id: clientId }) }).catch(() => {});
            }
          } catch (_) {}

          // 3) Deteksi mismatch registry (unit baru / ganti AC) → flag utk konfirmasi admin.
          //    Persistent di agent_logs (Monitoring → Audit Log), tidak auto-ubah registry.
          try {
            const ruRes = await fetch(REST("maintenance_units?id=in.(" + encodeURIComponent(unitIds.join(",")) + ")&select=id,unit_code,brand,capacity_pk"), { headers });
            const regUnits = await ruRes.json();
            const regById = Object.fromEntries((Array.isArray(regUnits) ? regUnits : []).map(u => [u.id, u]));
            const issues = [];
            // a. Laporan punya lebih banyak unit dari yang dipilih → kemungkinan AC baru
            if (repUnits.length > unitIds.length)
              issues.push(`${repUnits.length - unitIds.length} unit di laporan tidak ada di registry (kemungkinan AC baru)`);
            // b. Merk/PK laporan beda dari registry per-posisi → kemungkinan unit diganti
            unitIds.forEach((uid, i) => {
              const lu = repUnits[i], reg = regById[uid];
              if (!lu || !reg) return;
              const luMerk = String(lu.merk || "").trim().toLowerCase();
              const regMerk = String(reg.brand || "").trim().toLowerCase();
              if (luMerk && regMerk && luMerk !== regMerk)
                issues.push(`${reg.unit_code}: merk laporan "${lu.merk}" ≠ registry "${reg.brand}"`);
            });
            if (issues.length) {
              fetch(SU + "/rest/v1/agent_logs", {
                method: "POST",
                headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "MAINTENANCE_REGISTRY_REVIEW",
                  severity: "warn", category: "maintenance", status: "WARNING",
                  detail: `Order ${order.id} (${clientId}): ${issues.join("; ")}. Perlu konfirmasi admin di registry.`,
                  metadata: { order_id: order.id, client_id: clientId, issues },
                  time: new Date().toISOString(),
                }),
              }).catch(sentryCatch("agent_log_maintenance_review", { order_id: order.id, client_id: clientId }));
            }
          } catch (_) {}

          // Map jenis servis order → vocabulary maintenance
          const SVC_MAP = { "Cleaning": "Cuci", "Cuci AC": "Cuci", "Install": "Pasang", "Pasang": "Pasang", "Bongkar Pasang": "Pasang", "Repair": "Perbaikan", "Perbaikan": "Perbaikan", "Isi Freon": "Isi Freon", "Survey": "Cek" };
          const svcType = SVC_MAP[order.service] || order.service || "Maintenance";

          // Cap unitIds ke jumlah unit yang benar-benar dilaporkan di laporan teknisi.
          // Tanpa ini: 12 unit direncanakan tapi 10 dilaporkan → 12 log dibuat (2 log hantu).
          // Jika repUnits kosong (laporan belum masuk), tetap pakai semua unitIds.
          const effectiveUnitIds = repUnits.length > 0 && repUnits.length < unitIds.length
            ? unitIds.slice(0, repUnits.length)
            : unitIds;

          // Map svcType → service_category (billing classifier)
          const SVC_CATEGORY_MAP = {
            "Cuci": "cuci_rutin", "Cuci AC": "cuci_rutin",
            "Perbaikan": "perbaikan", "Repair": "perbaikan",
            "Pasang": "perbaikan", "Bongkar Pasang": "perbaikan",
            "Isi Freon": "perbaikan",
            "Cek": "pengecekan", "Survey": "pengecekan", "Inspeksi": "inspeksi",
          };
          const svcCategory = SVC_CATEGORY_MAP[svcType] || "cuci_rutin";

          // ── Keterikatan per-unit: utamakan maint_unit_id dari laporan, bukan posisi array ──
          // Laporan maintenance membawa maint_unit_id per unit (di-preset dari registry saat
          // modal dibuka). Mencocokkan log ke AC lewat ID itu = tahan terhadap urutan berbeda
          // atau unit ditambah/dihapus teknisi di lapangan (pencocokan posisi lama bisa salah AC).
          // Laporan lama tanpa maint_unit_id → fallback ke pencocokan posisi (perilaku lama).
          const reportedMaintIds = [...new Set(repUnits.map(ru => (ru && ru.maint_unit_id) || null).filter(Boolean))];
          let unitPairs; // [{ uid, lu }] — lu = unit laporan (boleh null)
          if (reportedMaintIds.length) {
            // Validasi kepemilikan: unit harus milik klien ini. Status 'baru' SENGAJA
            // TIDAK dikecualikan di jalur ini — teknisi menyebut unit itu secara
            // EKSPLISIT di laporan, artinya benar-benar dikerjakan, jadi riwayatnya
            // wajib tercatat. (Skip 'baru' tetap berlaku di jalur bulk/default baris
            // ~953, yang memang untuk mencegah AC baru dipasang ikut ter-log massal.)
            // Tanpa pengecualian ini, unit yang diajukan teknisi via "+ Tambah Unit
            // Baru" (masuk sbg status 'baru') hilang dari history tanpa error apa pun.
            const candidateIds = [...new Set([...unitIds, ...reportedMaintIds])];
            let validSet = new Set(candidateIds);
            try {
              const vRes = await fetch(REST("maintenance_units?id=in.(" + encodeURIComponent(candidateIds.join(",")) + ")&client_id=eq." + encodeURIComponent(clientId) + "&select=id,status"), { headers });
              const vData = await vRes.json();
              if (Array.isArray(vData)) validSet = new Set(vData.map(u => u.id));
            } catch (_) {}
            const seen = new Set();
            unitPairs = repUnits
              .filter(ru => ru && ru.maint_unit_id && validSet.has(ru.maint_unit_id))
              .filter(ru => (seen.has(ru.maint_unit_id) ? false : (seen.add(ru.maint_unit_id), true)))
              .map(ru => ({ uid: ru.maint_unit_id, lu: ru }));
          } else {
            unitPairs = effectiveUnitIds.map((uid, i) => ({ uid, lu: repUnits[i] || null }));
          }
          if (!unitPairs.length) return res.status(200).json({ skipped: true, reason: "tidak ada unit valid untuk dicatat" });

          // Buat 1 log per unit yang benar-benar dikerjakan.
          // PENTING: format description di bawah ("Kondisi: …", "Freon +X", "Ampere Y")
          // DIPARSE balik oleh logMeasurements (src/lib/maintenanceHealth.js) sebagai
          // fallback log lama. Ubah format di sini → sinkronkan regex parser-nya.
          const rows = unitPairs.map(({ uid, lu }, i) => {
            // Deskripsi per-AC dari laporan
            let desc = `Servis via order ${order.id}`;
            if (lu) {
              const parts = [];
              if (Array.isArray(lu.pekerjaan) && lu.pekerjaan.length) parts.push(lu.pekerjaan.join(", "));
              if (Array.isArray(lu.kondisi_setelah) && lu.kondisi_setelah.length) parts.push("Kondisi: " + lu.kondisi_setelah.join(", "));
              if (lu.freon_ditambah) parts.push("Freon +" + lu.freon_ditambah);
              if (lu.ampere_akhir) parts.push("Ampere " + lu.ampere_akhir);
              if (lu.catatan_unit) parts.push(lu.catatan_unit);
              if (parts.length) desc = parts.join(" • ");
            }
            // Material per-AC: freon unit ini + (unit pertama) material level-laporan.
            // Harga TIDAK disertakan (biaya tidak ditampilkan di history/portal).
            // Shape WAJIB { nama, qty, satuan } agar terrender di MaintenanceView & portal (filter m.nama).
            const mats = [];
            // freon_ditambah = TEKANAN psi (bukan gram!) — label harus jujur, dan
            // logMeasurements (src/lib/maintenanceHealth.js) MENGECUALIKAN baris
            // "Tekanan"/psi dari deteksi freon_added (indikasi bocor). Salah label
            // "Freon ... gr" membuat setiap catatan tekanan terhitung "tambah freon"
            // → unit sehat ke-flag bocor. Jangan ganti nama/satuan tanpa sinkron parser.
            if (lu?.freon_ditambah) mats.push({ nama: "Tekanan Freon" + (lu.tipe ? " " + lu.tipe : ""), qty: lu.freon_ditambah, satuan: "psi" });
            if (i === 0 && repMatsNonFreon.length) {
              repMatsNonFreon.forEach(m => mats.push({ nama: m.nama || m.name || m.keterangan || "Material", qty: m.qty ?? m.jumlah ?? "", satuan: m.satuan || "" }));
            }
            // Measurements terstruktur (migrasi 125) — data yang sama dgn desc di atas
            // tapi query-able: tren ampere, frekuensi tambah freon, kondisi terakhir.
            // description tetap diisi untuk tampilan history/portal.
            let measurements = null;
            if (lu) {
              const m = {};
              if (Array.isArray(lu.pekerjaan) && lu.pekerjaan.length) m.pekerjaan = lu.pekerjaan;
              if (Array.isArray(lu.kondisi_sebelum) && lu.kondisi_sebelum.length) m.kondisi_sebelum = lu.kondisi_sebelum;
              if (Array.isArray(lu.kondisi_setelah) && lu.kondisi_setelah.length) m.kondisi_setelah = lu.kondisi_setelah;
              const amp = parseFloat(String(lu.ampere_akhir ?? "").replace(",", "."));
              if (!isNaN(amp) && amp > 0) m.ampere = amp;
              // freon_ditambah = TEKANAN psi (label form "Tekanan Freon (psi)"), bukan kg.
              const frn = parseFloat(String(lu.freon_ditambah ?? "").replace(",", "."));
              if (!isNaN(frn) && frn > 0) m.freon_psi = frn;
              if (Object.keys(m).length) measurements = m;
            }
            return {
              unit_id: uid,
              client_id: clientId,
              service_date: order.date || new Date().toISOString().slice(0, 10),
              service_type: svcType,
              service_category: svcCategory,
              technician: order.teknisi || null,
              description: desc,
              materials: mats,
              measurements,
              photos: photosForUnit(lu),
              order_id: order.id,
              cost: null,
              created_by: body.created_by || "auto-verify",
            };
          });
          const r = await fetch(REST("maintenance_logs"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(rows) });
          if (!r.ok) return res.status(400).json({ error: "Gagal auto-log", detail: await r.text() });
          const createdLogs = await r.json();

          // Auto-detect followup dari description tiap log
          const FOLLOWUP_DETECT = [
            { re: /bocor|bocoran|kebocoran|freon\s*habis|leak/i,        type: "bocor_freon",      priority: "high"   },
            { re: /kapasitor|kondensator|capacitor/i,                    type: "kapasitor_rusak",  priority: "high"   },
            { re: /kompresor|compressor/i,                               type: "kompresor_lemah",  priority: "high"   },
            { re: /drain.*(mampet|buntu)|mampet.*drain|saluran.*buntu/i, type: "drain_tersumbat",  priority: "normal" },
            { re: /pcb\s*rusak|modul\s*rusak|board\s*rusak/i,           type: "pcb_rusak",        priority: "high"   },
            { re: /filter.*(buntu|kotor|ganti)/i,                        type: "filter_buntu",     priority: "normal" },
            { re: /fan[\s-]?motor|motor[\s-]?kipas/i,                    type: "fan_motor_lemah",  priority: "normal" },
            { re: /indikasi|perlu\s*perbaikan|butuh\s*perbaikan|perlu\s*diganti/i, type: "lainnya", priority: "normal" },
          ];
          const followupRows = [];
          for (const log of createdLogs) {
            const desc = log.description || "";
            const svcDate = log.service_date;
            for (const rule of FOLLOWUP_DETECT) {
              if (rule.re.test(desc)) {
                followupRows.push({
                  unit_id:     log.unit_id,
                  client_id:   log.client_id,
                  log_id:      log.id,
                  issue_type:  rule.type,
                  description: desc,
                  found_date:  svcDate,
                  found_by:    log.technician || null,
                  status:      "open",
                  priority:    rule.priority,
                });
                break; // 1 log → max 1 followup (issue paling spesifik)
              }
            }
          }
          let followupsCreated = 0;
          if (followupRows.length > 0) {
            // ON CONFLICT DO NOTHING — hindari duplikat jika autolog dipanggil ulang
            const fRes = await fetch(
              REST("maintenance_followups"),
              { method: "POST", headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(followupRows) }
            );
            if (fRes.ok) followupsCreated = (await fRes.json()).length;
            else console.warn("[autolog] followup insert warn:", await fRes.text());
          }

          // ── T1: roda PPM maju — roll jadwal semua unit yang tercatat servis ──
          const svcDateRoll = order.date || new Date().toISOString().slice(0, 10);
          await rollUnitSchedule(unitPairs.map(p => p.uid), svcDateRoll);

          // ── T1: auto-close temuan yang order-nya ini (follow-up → order → verified) ──
          // Temuan dibuatkan order via tombol "Buat Order" (order_id tersimpan);
          // begitu laporan order diverifikasi (autolog jalan) → temuan otomatis tuntas.
          let followupsClosed = 0;
          try {
            const fuQ = "maintenance_followups?order_id=eq." + encodeURIComponent(order.id) + "&status=in.(open,scheduled,in_progress)";
            const fuChk = await fetch(REST(fuQ + "&select=id"), { headers });
            const fuOpen = await fuChk.json();
            if (Array.isArray(fuOpen) && fuOpen.length) {
              const fuUpd = await fetch(REST(fuQ), {
                method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
                body: JSON.stringify({
                  status: "done", resolved_date: svcDateRoll,
                  resolved_by: order.teknisi || "auto-verify",
                  resolution: "Selesai via order " + order.id + " (laporan terverifikasi)",
                }),
              });
              if (fuUpd.ok) followupsClosed = (await fuUpd.json()).length;
              else console.warn("[autolog] auto-close followup warn:", await fuUpd.text());
            }
          } catch (e) { console.warn("[autolog] auto-close followup gagal (non-blocking):", e.message); }

          const capped = repUnits.length > 0 && repUnits.length < unitIds.length;
          return res.status(200).json({
            created: createdLogs.length,
            followups_created: followupsCreated,
            followups_closed: followupsClosed,
            enriched: { photos: repFotos.length, units_detail: repUnits.length },
            ...(capped ? { capped_from: unitIds.length, capped_to: effectiveUnitIds.length, reason: "hanya unit yang dilaporkan di laporan teknisi" } : {}),
          });
        }

        // ── CONTRACTS ──────────────────────────────────────────────────
        if (action === "list-contracts") {
          const { client_id } = body;
          if (!client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST(`maintenance_contracts?client_id=eq.${client_id}&order=start_date.desc`), { headers });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ contracts: await r.json() });
        }

        if (action === "create-contract") {
          const { client_id, contract_number, title, start_date, end_date, value, billing_cycle, billing_amount, services_included, visits_per_year, notes, auto_invoice } = body;
          if (!client_id || !contract_number || !start_date || !end_date) return res.status(400).json({ error: "client_id, contract_number, start_date, end_date wajib" });
          const r = await fetch(REST("maintenance_contracts"), {
            method: "POST", headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify({ client_id, contract_number, title, start_date, end_date, value, billing_cycle, billing_amount, services_included, visits_per_year, notes, auto_invoice, created_by: body.created_by || "admin" }),
          });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ contract: (await r.json())[0] });
        }

        if (action === "update-contract") {
          const { id, ...patch } = body;
          if (!id) return res.status(400).json({ error: "id wajib" });
          const allowed = ["title","start_date","end_date","value","billing_cycle","billing_amount","services_included","visits_per_year","notes","status","auto_invoice","contract_number"];
          const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
          const r = await fetch(REST(`maintenance_contracts?id=eq.${id}`), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(clean) });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ contract: (await r.json())[0] });
        }

        if (action === "delete-contract") {
          const { id } = body;
          if (!id) return res.status(400).json({ error: "id wajib" });
          const r = await fetch(REST(`maintenance_contracts?id=eq.${id}`), { method: "DELETE", headers });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ ok: true });
        }

        // ── WORK ORDERS ─────────────────────────────────────────────────
        if (action === "list-work-orders") {
          const { client_id } = body;
          if (!client_id) return res.status(400).json({ error: "client_id wajib" });
          const r = await fetch(REST(`maintenance_work_orders?client_id=eq.${client_id}&order=created_at.desc`), { headers });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ work_orders: await r.json() });
        }

        if (action === "create-work-order") {
          const { client_id } = body;
          if (!client_id || !body.title) return res.status(400).json({ error: "client_id dan title wajib" });
          // Generate WO number: WO-{client_code}-{YYYY}-{NNN}
          const cRes = await fetch(REST(`maintenance_clients?id=eq.${client_id}&select=name`), { headers });
          const cData = await cRes.json();
          const clientCode = ((cData[0]?.name || "CLT").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 5));
          const year = new Date().getFullYear();
          const countRes = await fetch(REST(`maintenance_work_orders?client_id=eq.${client_id}&select=id`), { headers });
          const countData = await countRes.json();
          const seq = String((countData?.length || 0) + 1).padStart(3, "0");
          const wo_number = `WO-${clientCode}-${year}-${seq}`;
          const fields = { client_id, wo_number, title: body.title, description: body.description, wo_type: body.wo_type || "preventive", scheduled_date: body.scheduled_date, unit_ids: body.unit_ids || [], assigned_to: body.assigned_to, estimated_cost: body.estimated_cost, contract_id: body.contract_id || null, followup_id: body.followup_id || null, notes: body.notes, created_by: body.created_by || "admin", status: "draft" };
          const r = await fetch(REST("maintenance_work_orders"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(fields) });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ work_order: (await r.json())[0] });
        }

        if (action === "update-work-order") {
          const { id, ...patch } = body;
          if (!id) return res.status(400).json({ error: "id wajib" });
          const allowed = ["title","description","wo_type","scheduled_date","unit_ids","assigned_to","status","estimated_cost","actual_cost","approved_by","approved_at","completed_at","invoice_id","notes","contract_id","followup_id"];
          const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
          if (clean.status === "approved" && !clean.approved_at) clean.approved_at = new Date().toISOString();
          if (clean.status === "done" && !clean.completed_at) clean.completed_at = new Date().toISOString();
          const r = await fetch(REST(`maintenance_work_orders?id=eq.${id}`), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(clean) });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          return res.status(200).json({ work_order: (await r.json())[0] });
        }

        // ── PPM CALENDAR — level SITE (per klien), bukan per unit ─────────
        // Tiap perusahaan = 1 kartu jatuh tempo (kunjungan rutin), bukan 1 baris per unit.
        // Tanggal jatuh tempo site = next_service_date TERAWAL di antara unit reguler klien itu.
        // Unit high_freq (intensitas tinggi, mis. 2-mingguan) DIKELUARKAN — punya checklist sendiri
        // di tab Unit supaya tak mengganggu ritme kunjungan standar. limit dinaikkan (per-site jauh
        // lebih sedikit barisnya, tapi unit mentah tetap bisa banyak → ambil cukup besar).
        if (action === "ppm-calendar") {
          const { months_ahead = 3 } = body;
          const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() + months_ahead);
          const r = await fetch(REST(`maintenance_units?select=id,unit_code,location,client_id,next_service_date,status,high_freq&next_service_date=lte.${cutoff.toISOString().slice(0,10)}&status=not.in.(retired,rusak)&high_freq=eq.false&order=next_service_date.asc&limit=2000`), { headers });
          if (!r.ok) return res.status(400).json({ error: await r.text() });
          const units = await r.json();
          const clientIds = [...new Set(units.map(u => u.client_id).filter(Boolean))];
          let clientMap = {};
          if (clientIds.length) {
            const cRes = await fetch(REST(`maintenance_clients?id=in.(${clientIds.join(",")})&select=id,name,pic_phone`), { headers });
            if (cRes.ok) { const cd = await cRes.json(); cd.forEach(c => { clientMap[c.id] = c; }); }
          }
          // Agregasi per klien: tanggal jatuh tempo terawal + jumlah unit jatuh tempo.
          const byClient = {};
          for (const u of units) {
            const k = u.client_id || "—";
            if (!byClient[k]) byClient[k] = { client_id: u.client_id, units: [], earliest: u.next_service_date };
            byClient[k].units.push(u);
            if (u.next_service_date && (!byClient[k].earliest || u.next_service_date < byClient[k].earliest)) byClient[k].earliest = u.next_service_date;
          }
          const events = Object.values(byClient).map(g => ({
            client_id: g.client_id,
            client_name: clientMap[g.client_id]?.name || "—",
            client_phone: clientMap[g.client_id]?.pic_phone || "",
            next_service_date: g.earliest,
            due_count: g.units.length,
            unit_codes: g.units.map(u => u.unit_code),
          }));
          events.sort((a, b) => String(a.next_service_date).localeCompare(String(b.next_service_date)));
          return res.status(200).json({ events });
        }

        // ── AUTO-INVOICE dari kontrak ────────────────────────────────────
        // Skema mengikuti create-invoice B2B (kolom nyata tabel invoices: total/labor/
        // units/invoice_type/notes — TIDAK ada kolom amount/type/description/contract_id).
        // Referensi kontrak disimpan di notes. Status PENDING_APPROVAL → masuk alur
        // approve Owner di menu Invoice (bukan langsung UNPAID).
        if (action === "generate-contract-invoice") {
          const { contract_id, client_id, period_label, unit_count, amount, notes: invNotes } = body;
          if (!client_id || !amount) return res.status(400).json({ error: "client_id dan amount wajib" });
          // Ambil data klien
          const cRes = await fetch(REST(`maintenance_clients?id=eq.${encodeURIComponent(client_id)}&select=name,pic_name,pic_phone,address`), { headers });
          const cData = await cRes.json();
          const client = cData[0];
          if (!client) return res.status(404).json({ error: "Klien tidak ditemukan" });
          // Nomor kontrak untuk catatan invoice (kolom contract_id tidak ada di invoices)
          let contractNo = "";
          if (contract_id) {
            try {
              const ctRes = await fetch(REST(`maintenance_contracts?id=eq.${encodeURIComponent(contract_id)}&select=contract_number&limit=1`), { headers });
              const ct = ctRes.ok ? await ctRes.json() : [];
              contractNo = ct[0]?.contract_number || "";
            } catch (_) {}
          }
          // Generate invoice number
          const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          const inv_id = `INV-M-${today}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          const totalRp = Math.round(Number(amount)) || 0;
          const inv = {
            id: inv_id,
            customer: client.name,
            phone: client.pic_phone || null,
            address: client.address || null,
            service: `${period_label || "Maintenance kontrak"} — ${unit_count || 0} unit`,
            job_id: null,
            invoice_type: "service",
            units: Number(unit_count) || 0,
            labor: totalRp,
            material: 0,
            total: totalRp,
            status: "PENDING_APPROVAL",
            maintenance_client_id: client_id,
            notes: [contractNo ? `Kontrak ${contractNo}` : null, invNotes || null].filter(Boolean).join(" — ") || null,
            created_at: new Date().toISOString(),
          };
          const r = await fetch(REST("invoices"), { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(inv) });
          if (!r.ok) return res.status(400).json({ error: "Gagal buat invoice kontrak", detail: await r.text() });
          return res.status(200).json({ invoice: (await r.json())[0] || inv });
        }

        return res.status(400).json({ error: "Action tidak dikenal: " + action });
      } catch (e) {
        console.error("[maintenance] error:", e.message);
        return res.status(500).json({ error: "Server error" });
      }
}

    // ── M-PORTAL (PUBLIC) — portal customer korporat, token PERMANEN ──
    // Gate akses & strip cost DI BACKEND (anon key tidak bisa baca tabel langsung).
export async function mPortal(req, res) {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      if (!await checkRateLimit(req, res, 30, 60000)) return;
      const token = String(req.query.token || "").trim();
      if (!token) return res.status(400).json({ error: "Token diperlukan" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      const cRes = await fetch(`${SU}/rest/v1/maintenance_clients?portal_token=eq.${encodeURIComponent(token)}&select=id,name,token_active,token_expires_at,hide_costs`, { headers });
      if (!cRes.ok) return res.status(500).json({ error: "DB error" });
      const cRows = await cRes.json();
      if (!cRows.length) return res.status(404).json({ error: "Token tidak ditemukan", code: "NOT_FOUND" });
      const client = cRows[0];

      // Gate 1: akses dimatikan → 403 (cek SEBELUM ambil data, jangan bocor unit list)
      if (!client.token_active) return res.status(403).json({ error: "Akses portal dinonaktifkan", code: "TOKEN_DISABLED" });
      // Gate 2: expired (NULL = permanen, tidak pernah expired)
      if (client.token_expires_at && new Date(client.token_expires_at) < new Date())
        return res.status(401).json({ error: "Link portal sudah expired", code: "TOKEN_EXPIRED" });

      // Ambil unit + logs + followups (open only) + kontrak aktif
      const [uRes, lRes, fRes, ctrRes] = await Promise.all([
        fetch(`${SU}/rest/v1/maintenance_units?client_id=eq.${client.id}&select=id,unit_code,location,brand,ac_type,capacity_pk,refrigerant,status,last_service_date,next_service_date,service_interval_months,notes&order=unit_code.asc`, { headers }),
        fetch(`${SU}/rest/v1/maintenance_logs?client_id=eq.${client.id}&select=id,unit_id,service_date,service_type,technician,description,cost,photos,materials&order=service_date.desc`, { headers }),
        fetch(`${SU}/rest/v1/maintenance_followups?client_id=eq.${client.id}&status=eq.open&select=id,unit_id,issue_type,priority,description,found_date,status`, { headers }),
        fetch(`${SU}/rest/v1/maintenance_contracts?client_id=eq.${client.id}&status=eq.active&select=id,contract_number,title,start_date,end_date,visits_per_year,services_included&order=end_date.desc&limit=1`, { headers }),
      ]);
      const units = uRes.ok ? await uRes.json() : [];
      let logs = lRes.ok ? await lRes.json() : [];
      const followups = fRes.ok ? await fRes.json() : [];
      const contracts = ctrRes.ok ? await ctrRes.json() : [];

      // STRIP COST di backend kalau hide_costs (jangan andalkan CSS frontend)
      if (client.hide_costs) logs = logs.map(({ cost, ...rest }) => rest);

      // Build dashboard summary
      const now = new Date().toISOString().slice(0, 10);
      const summary = {
        total: units.length,
        active: units.filter(u => u.status === "active").length,
        baru: units.filter(u => u.status === "baru").length,
        perlu_perbaikan: units.filter(u => u.status === "perlu_perbaikan").length,
        dalam_perbaikan: units.filter(u => u.status === "dalam_perbaikan").length,
        overdue: units.filter(u => u.next_service_date && u.next_service_date < now && u.status === "active").length,
        due_soon: units.filter(u => u.next_service_date && u.next_service_date >= now && u.next_service_date <= new Date(Date.now() + 30*86400000).toISOString().slice(0,10) && u.status === "active").length,
        open_issues: followups.length,
        critical_issues: followups.filter(f => f.priority === "critical" || f.priority === "high").length,
        last_service: logs[0]?.service_date || null,
      };

      return res.status(200).json({
        client: { name: client.name, hide_costs: client.hide_costs },
        units, logs, followups,
        contract: contracts[0] || null,
        summary,
      });
}

    // ── PROJECT-PORTAL (PUBLIC) — portal customer modul Project, token permanen ──
    // Gate akses di backend (anon key tak bisa baca tabel langsung). Hanya tampilkan
    // laporan harian status VERIFIED (approval Owner/Admin = layer pengaman).
    // TIDAK pernah kirim data finansial (nilai/rab/harga) ke customer.
export async function projectPortal(req, res) {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      if (!await checkRateLimit(req, res, 30, 60000)) return;
      const token = String(req.query.token || "").trim();
      if (!token) return res.status(400).json({ error: "Token diperlukan" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      // 1) Validasi token → project (TANPA nilai/rab)
      const pRes = await fetch(`${SU}/rest/v1/project_projects?portal_token=eq.${encodeURIComponent(token)}&select=id,nama,lokasi,kategori,status,progress,mulai,target,token_active`, { headers });
      if (!pRes.ok) return res.status(500).json({ error: "DB error" });
      const pRows = await pRes.json();
      if (!pRows.length) return res.status(404).json({ error: "Token tidak ditemukan", code: "NOT_FOUND" });
      const proj = pRows[0];
      if (!proj.token_active) return res.status(403).json({ error: "Akses portal dinonaktifkan", code: "TOKEN_DISABLED" });

      // 2) Berita Acara Harian VERIFIED — sumber laporan harian tunggal yang dilihat customer
      //    (project_daily_reports; di-submit teknisi via Laporan Saya, diverifikasi Owner/Admin).
      const baRes = await fetch(`${SU}/rest/v1/project_daily_reports?project_id=eq.${encodeURIComponent(proj.id)}&status=eq.VERIFIED&select=id,tanggal,teknisi_name,helper_names,pekerjaan,kendala,foto_urls,verified_at&order=tanggal.desc&limit=200`, { headers });
      const beritaAcara = baRes.ok ? await baRes.json() : [];
      const verifiedDates = new Set(beritaAcara.map(b => b.tanggal));

      // 2b) Dokumen Serah Terima / BAST (transparansi — info & status TTD, tanpa data finansial)
      const dRes = await fetch(`${SU}/rest/v1/project_documents?project_id=eq.${encodeURIComponent(proj.id)}&select=id,jenis,nomor,tanggal,kepada,uraian,ttd_customer,ttd_teknisi&order=tanggal.desc&limit=50`, { headers });
      const docsRaw = dRes.ok ? await dRes.json() : [];
      const documents = docsRaw
        .filter(d => /berita|bast|serah|terima/i.test(d.jenis || ""))
        .map(d => ({ id: d.id, jenis: d.jenis, nomor: d.nomor, tanggal: d.tanggal, uraian: d.uraian || "",
          ttd_teknisi: d.ttd_teknisi || "", ttd_customer: (d.ttd_customer && d.ttd_customer !== "(belum)") ? d.ttd_customer : "" }));

      // 3) Pemakaian material — HANYA untuk tanggal yang Berita Acara-nya VERIFIED (ikut gate approval)
      let usage = [];
      if (verifiedDates.size > 0) {
        const uRes = await fetch(`${SU}/rest/v1/project_usage?project_id=eq.${proj.id}&select=id,tanggal,material,qty,satuan,oleh&order=tanggal.desc`, { headers });
        const uRows = uRes.ok ? await uRes.json() : [];
        usage = uRows.filter(u => verifiedDates.has(u.tanggal)).map(u => ({ tanggal: u.tanggal, material: u.material, qty: u.qty, satuan: u.satuan || "", oleh: u.oleh }));
      }

      return res.status(200).json({
        project: { nama: proj.nama, lokasi: proj.lokasi, kategori: proj.kategori, status: proj.status, progress: proj.progress, mulai: proj.mulai, target: proj.target },
        usage,
        beritaAcara,
        documents,
      });
}

