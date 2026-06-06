#!/usr/bin/env node
// scripts/backfill-wa-grup-ai.mjs
//
// One-off backfill: process image grup webhook hari ini yang GAGAL ke AI Vision.
// Latar belakang: TDZ bug (fix 61441eb) bikin 100% image grup crash sebelum
// wa_group_logs INSERT. Foto-foto pagi sudah expired di Fonnte CDN, tapi yang
// 2-3 jam terakhir masih ada → kita coba reuse via Anthropic vision URL fetch.
//
// Behavior:
//   1. Query wa_webhook_raw → image grup hari ini yang TIDAK ada di wa_group_logs
//   2. Untuk tiap entry: HEAD URL → kalau 200, classifyImage
//   3. persistClassification → ai_extractions + Pending AI row
//   4. Respect groupConfig.ai_*_enabled toggles
//   5. Print summary: ok / expired / skip_intent / err

// Manual env loader (avoid dotenv dep)
import { readFileSync } from "node:fs";
try {
  const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env[m[1]] = val;
    }
  }
} catch (e) { console.warn("(no .env.local loaded:", e.message, ")"); }

import { classifyImage, persistClassification } from "../api/_ai-vision.js";

const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
if (!SU || !SK) { console.error("Missing SUPABASE env"); process.exit(1); }
if (!process.env.LLM_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY / LLM_API_KEY"); process.exit(1);
}

function normalizePhone(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/@.*$/, "").replace(/[^0-9+]/g, "");
  if (n.startsWith("+62")) n = n.substring(1);
  if (n.startsWith("0")) n = "62" + n.substring(1);
  if (!n.startsWith("62")) n = "62" + n;
  if (!/^62\d{9,12}$/.test(n)) return null;
  return n;
}

async function urlAlive(url) {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000) });
    return r.ok && r.status === 200;
  } catch { return false; }
}

async function main() {
  const todayStart = "2026-06-03 00:00:00+00";

  // Ambil webhook image grup hari ini — filter di sisi DB biar tidak ke-cap limit
  const q = `select=payload,created_at&created_at=gte.${encodeURIComponent(todayStart)}&payload->>type=eq.image&payload->>sender=like.*%40g.us&order=created_at.desc&limit=500`;
  const wrRes = await fetch(SU + "/rest/v1/wa_webhook_raw?" + q, {
    headers: { apikey: SK, Authorization: "Bearer " + SK },
  });
  if (!wrRes.ok) { console.error("Failed to fetch wa_webhook_raw:", await wrRes.text()); process.exit(1); }
  const allRaw = await wrRes.json();
  const candidates = allRaw.filter(r =>
    r.payload?.type === "image" &&
    typeof r.payload?.sender === "string" &&
    r.payload.sender.endsWith("@g.us") &&
    typeof r.payload?.url === "string" &&
    r.payload.url.includes("fonnte.com")
  );

  console.log(`📋 Total image grup hari ini: ${candidates.length}\n`);

  // Cache group config (1 lookup per group)
  const groupCfgCache = new Map();
  async function getGroupCfg(groupId) {
    if (groupCfgCache.has(groupId)) return groupCfgCache.get(groupId);
    const cols = "group_id,group_name,enabled,ai_expense_enabled,ai_material_enabled,ai_payment_enabled,ai_selesai_enabled,ai_quotation_enabled,ai_forward_target,ai_forward_min_conf";
    const url = SU + "/rest/v1/wa_monitored_groups?select=" + cols + "&group_id=eq." + encodeURIComponent(groupId) + "&limit=1";
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    const rows = r.ok ? await r.json() : [];
    const cfg = rows[0] || null;
    groupCfgCache.set(groupId, cfg);
    return cfg;
  }

  // Cache user_profiles
  const profileCache = new Map();
  async function getProfile(phone) {
    if (profileCache.has(phone)) return profileCache.get(phone);
    const r = await fetch(SU + "/rest/v1/user_profiles?select=name,role&phone=eq." + encodeURIComponent(phone) + "&active=eq.true&limit=1",
      { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    const rows = r.ok ? await r.json() : [];
    const profile = rows[0] || null;
    profileCache.set(phone, profile);
    return profile;
  }

  const stats = { total: candidates.length, expired: 0, no_config: 0, no_profile: 0, no_ai_toggle: 0, ok: 0, unknown: 0, err: 0 };
  const inserted = [];

  for (const entry of candidates) {
    const wb = entry.payload;
    const ts = entry.created_at;
    const groupId = wb.sender;
    const memberPhone = normalizePhone(wb.member);
    const url = wb.url;
    const caption = (wb.message && wb.message !== url) ? wb.message : null;
    const tag = `[${new Date(ts).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }).slice(11, 16)}] ${groupId.slice(0, 18)}.. — ${(caption || "(no caption)").slice(0, 50)}`;

    // Cek URL alive
    if (!(await urlAlive(url))) {
      console.log(`✕ EXPIRED  ${tag}`);
      stats.expired++; continue;
    }

    // Cek group config
    const cfg = await getGroupCfg(groupId);
    if (!cfg || !cfg.enabled) {
      console.log(`- NO_CFG   ${tag}`);
      stats.no_config++; continue;
    }

    // Cek any AI toggle on
    const anyAi = !!(cfg.ai_expense_enabled || cfg.ai_material_enabled || cfg.ai_payment_enabled);
    if (!anyAi) {
      console.log(`- NO_TOGGLE ${tag}`);
      stats.no_ai_toggle++; continue;
    }

    // Cek sender profile
    const profile = memberPhone ? await getProfile(memberPhone) : null;
    if (!profile) {
      console.log(`- NO_PROF  ${tag}`);
      stats.no_profile++; continue;
    }

    // Classify + persist
    try {
      const classification = await classifyImage({
        imageUrl: url,
        groupCfg: cfg,
        sender: { phone: memberPhone, name: profile.name },
        messageText: caption,
      });
      if (classification?.error) {
        console.log(`✕ ERR:${classification.error}  ${tag}`);
        stats.err++; continue;
      }
      if (!classification || classification.intent === "unknown") {
        console.log(`- UNKNOWN  ${tag}`);
        stats.unknown++; continue;
      }
      const persistResult = await persistClassification({
        SU, SK,
        classification,
        sender: { phone: memberPhone, name: profile.name },
        groupCfg: cfg,
        imageUrl: url,
        messageText: caption,
      });
      console.log(`✓ OK:${classification.intent.padEnd(8)} ${tag}`);
      stats.ok++;
      inserted.push({ ts, intent: classification.intent, sender: profile.name, caption, extractionId: persistResult?.extractionId });
    } catch (e) {
      console.log(`✕ EXC      ${tag} :: ${e.message}`);
      stats.err++;
    }
  }

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`📊 Summary:`);
  console.log(`   Total candidates : ${stats.total}`);
  console.log(`   ✓ OK (processed) : ${stats.ok}`);
  console.log(`   ✕ Expired URL    : ${stats.expired}`);
  console.log(`   ✕ AI errors      : ${stats.err}`);
  console.log(`   - Intent unknown : ${stats.unknown}`);
  console.log(`   - No group cfg   : ${stats.no_config}`);
  console.log(`   - No AI toggle   : ${stats.no_ai_toggle}`);
  console.log(`   - No user prof   : ${stats.no_profile}`);
  if (inserted.length > 0) {
    console.log(`\n📝 ${inserted.length} entries processed:`);
    inserted.forEach(i => console.log(`   - ${i.intent.padEnd(8)} | ${i.sender.padEnd(12)} | ${(i.caption || "").slice(0, 40)}`));
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
