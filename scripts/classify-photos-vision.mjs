/**
 * AI Vision photo classification for PT Belfood BSD maintenance logs.
 * Assigns 1-2 photos per unit based on brand/capacity visual matching.
 *
 * Run: node scripts/classify-photos-vision.mjs
 */

import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── Data from DB ──────────────────────────────────────────────────────────────

const JOB1_PHOTOS = [
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/fc7691d99f757d5b.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/4717a29fe4cd8084.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/5b2dea09369671b0.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/2d0030688605e88e.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/7617869f3555f109.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/5ab6738065f582bd.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/4ddd47c2494ceff9.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/c3946b18ef2f1730.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/18d3e49dd9b59fd7.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/7210640603a6d580.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/6d70f3ed633e1f15.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/e28f5bc15dadc49b.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/4d2b4b04b1b4d7e3.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/164f1d930cbc6f18.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/41ef1eaf976e41d7.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/810e9b46fd61449e.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/5c57e3b31c3adb30.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/314c1d7e828ffb8c.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/c66d77905f77f7e1.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS33V-JBX/0d9cfd6cd3e4dc5a.jpg",
];

const JOB2_PHOTOS = [
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/0d76e0f23aba2846.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/26fc87a59cfad945.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/15cb62116fc9896d.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/9662c0b747ce1fab.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/79ba16bb79f2b6b9.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/43fb1e7f86bb6565.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/f4e2392a67749b0f.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/9a7d1dc4b2a06840.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/7fbb5821a01782e6.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/e4aa7d3c13eca724.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/1af54a17bdf05c63.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/e22958e1939a5cf9.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/a7a16a6e63990b0a.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/405ddc4b07247bbd.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/12f338d2468fb3ca.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/90cf95940eb02e46.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/9178c9aacf4fc35f.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/3916da2a303b36c4.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/eecbebfa2d1fcc06.jpg",
  "https://pub-e159d4365c734ed9a6a9c37494df7cb6.r2.dev/laporan/JOB-7VS45F-HA0/a35b1ecde505682d.jpg",
];

// maintenance_logs: [{ log_id, unit_code, location, brand, capacity_pk }]
const JOB1_UNITS = [
  { log_id: "70e683c0-f6f5-44db-aef3-83388493f7d0", unit_code: "AC-BSD-01", location: "Lobby", brand: "Samsung", capacity_pk: "1" },
  { log_id: "443226e2-1c00-4497-a302-1d7b9e4c42d8", unit_code: "AC-BSD-02", location: "Ruang Tunggu", brand: "Daikin", capacity_pk: "1" },
  { log_id: "b3ec67b4-5ee7-48bd-a84a-a642b66ba753", unit_code: "AC-BSD-03", location: "Ruang Meeting Royal", brand: "Panasonic", capacity_pk: "2" },
  { log_id: "d8865af3-905e-43b0-a860-5cc41acc3552", unit_code: "AC-BSD-04", location: "Ruang Meeting Royal", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "d5ebce8b-7ca4-4231-abe1-8f8b0062b32d", unit_code: "AC-BSD-05", location: "Ruang Meeting Favorit", brand: "Daikin", capacity_pk: "2" },
  { log_id: "66d324e7-472e-4455-bb32-2847a1e3e47b", unit_code: "AC-BSD-06", location: "Ruang Meeting Favorit", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "668034ca-127b-43f5-81a7-49adaafef812", unit_code: "AC-BSD-07", location: "Ruang Meeting Uenak", brand: "Daikin", capacity_pk: "1" },
  { log_id: "9841e246-7449-42c8-abf2-6ae3d9a3a7e4", unit_code: "AC-BSD-08", location: "Ruangan Sales MT", brand: "Samsung", capacity_pk: "1" },
  { log_id: "e29694d0-670c-4a04-830e-552badd5235c", unit_code: "AC-BSD-09", location: "Ruang Pak Irvan Cahyana", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "2c75e3bc-afae-4d77-bedb-aaef364a4f57", unit_code: "AC-BSD-11", location: "Bu Putri", brand: "Daikin", capacity_pk: "1" },
  { log_id: "3c377cc0-db4f-4d14-8c59-78536ee703a9", unit_code: "AC-BSD-12", location: "Mesin Fotocopy", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "4e1499da-c2ca-484f-84bf-035557de3968", unit_code: "AC-BSD-13", location: "Bu Nana", brand: "Daikin", capacity_pk: "1" },
  { log_id: "ab824c75-cf35-460a-be2c-855f945ab13b", unit_code: "AC-BSD-15", location: "Ruang Pak Budi Darmawan", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "9c820512-bd98-4964-8852-a585d13eb6f5", unit_code: "AC-BSD-16", location: "Bu Ina Cahyani", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "3601ee4e-b461-4841-9d98-428fec215218", unit_code: "AC-BSD-17", location: "Pak Faiz", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "9bb77798-22bd-4369-a55a-9dde70c3454e", unit_code: "AC-BSD-18", location: "Bu Annisa", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "9c6b8947-815a-47e3-a36c-fc2eebf79989", unit_code: "AC-BSD-19", location: "Pak Rudi Bastian", brand: "Daikin", capacity_pk: "1" },
  { log_id: "023c08c9-4f0e-4ce5-bd27-4c43f6ef49a4", unit_code: "AC-BSD-20", location: "Ruang Pak Andri Yuliardi", brand: "Daikin", capacity_pk: "2" },
  { log_id: "a6106ebc-d39b-438b-84b6-f8b2454e3e98", unit_code: "AC-BSD-21", location: "Pak Denden Surangga", brand: "Daikin", capacity_pk: "2" },
];

const JOB2_UNITS = [
  { log_id: "63b7f76f-96d1-4322-8cb5-6888fb0df3de", unit_code: "AC-BSD-24", location: "Bapak Raditya", brand: "Panasonic", capacity_pk: "2" },
  { log_id: "dcf3d576-1983-4d5a-85cd-145b4f628adc", unit_code: "AC-BSD-25", location: "Ibu Rina", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "07763785-8539-4085-9559-c0913f64f4d3", unit_code: "AC-BSD-26", location: "Bapak Rahadhitya", brand: "Panasonic", capacity_pk: "2" },
  { log_id: "5153d522-962a-473e-8427-667e7bf2ced4", unit_code: "AC-BSD-27", location: "Ruangan Musholla", brand: "Panasonic", capacity_pk: "1" },
  { log_id: "8392ce1d-4ffc-41d5-b54f-5d863f734ec2", unit_code: "AC-BSD-28", location: "Pak Guruh", brand: "Panasonic", capacity_pk: "2" },
  { log_id: "48cd2488-683f-48c4-8c8c-7b6d0a793807", unit_code: "AC-BSD-29", location: "Ruang Server", brand: "Daikin", capacity_pk: "1" },
  { log_id: "3e958b09-2cbb-4fe6-8df5-d734253d1fcd", unit_code: "AC-BSD-30", location: "Ruang Training", brand: "Daikin", capacity_pk: "2" },
  { log_id: "e54f81de-5d84-42c2-9684-fc7ae959a660", unit_code: "AC-BSD-31", location: "Ruang Training", brand: "Daikin", capacity_pk: "2" },
  { log_id: "c5e494c5-0b0e-4df5-b3d1-898bf695fc5c", unit_code: "AC-BSD-32", location: "Ruang Training", brand: "Daikin", capacity_pk: "2" },
];

// ── Vision classification ─────────────────────────────────────────────────────

async function classifyPhoto(photoUrl, unitList) {
  const unitDesc = unitList
    .map((u) => `- ${u.unit_code}: ${u.brand} ${u.capacity_pk}PK, lokasi: ${u.location}`)
    .join("\n");

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: photoUrl } },
          {
            type: "text",
            text: `Kamu adalah teknisi AC. Analisa foto ini dan identifikasi unit AC mana yang tampak.

Daftar unit yang mungkin:
${unitDesc}

Jawab HANYA dengan format JSON satu baris:
{"unit_code":"AC-BSD-XX","confidence":"high|medium|low","reason":"alasan singkat"}

Perhatikan: brand (logo/tulisan pada unit), ukuran unit (1PK lebih kecil dari 2PK), dan konteks ruangan jika terlihat.
Jika foto close-up coil/filter tanpa brand terlihat, gunakan confidence "low".`,
          },
        ],
      },
    ],
  });

  const text = resp.content[0].text.trim();
  try {
    const match = text.match(/\{[^}]+\}/);
    return match ? JSON.parse(match[0]) : { unit_code: null, confidence: "low", reason: "parse error" };
  } catch {
    return { unit_code: null, confidence: "low", reason: "parse error: " + text.slice(0, 60) };
  }
}

// ── Assignment logic ──────────────────────────────────────────────────────────

function assignPhotosToUnits(classifications, photos, units) {
  // Group photos by classified unit_code
  const byUnit = {};
  const unassigned = [];

  for (let i = 0; i < classifications.length; i++) {
    const { unit_code, confidence } = classifications[i];
    const photoKey = photos[i].replace(/^https?:\/\/[^/]+\//, "");

    if (unit_code && confidence !== "low" && units.find((u) => u.unit_code === unit_code)) {
      if (!byUnit[unit_code]) byUnit[unit_code] = [];
      byUnit[unit_code].push({ key: photoKey, confidence });
    } else {
      unassigned.push({ key: photoKey, idx: i });
    }
  }

  // Max 2 photos per unit (keep highest confidence first)
  for (const code of Object.keys(byUnit)) {
    byUnit[code].sort((a, b) => (a.confidence === "high" ? -1 : 1));
    byUnit[code] = byUnit[code].slice(0, 2).map((p) => p.key);
  }

  // Distribute unassigned photos to units that have 0 photos (round-robin)
  const unitWithoutPhoto = units.filter((u) => !byUnit[u.unit_code]);
  let ui = 0;
  for (const p of unassigned) {
    if (ui >= unitWithoutPhoto.length) break;
    const code = unitWithoutPhoto[ui].unit_code;
    if (!byUnit[code]) byUnit[code] = [];
    if (byUnit[code].length < 2) {
      byUnit[code].push(p.key);
      if (byUnit[code].length >= 1) ui++; // move to next empty unit
    }
  }

  return byUnit;
}

// ── Supabase update ───────────────────────────────────────────────────────────

async function updateLog(logId, photos) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/maintenance_logs?id=eq.${logId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ photos }),
    }
  );
  return res.ok;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processJob(jobName, photos, units) {
  console.log(`\n── ${jobName} (${photos.length} foto, ${units.length} unit) ──`);
  const results = [];

  for (let i = 0; i < photos.length; i++) {
    process.stdout.write(`  Foto ${i + 1}/${photos.length}... `);
    const res = await classifyPhoto(photos[i], units);
    results.push(res);
    console.log(`→ ${res.unit_code || "?"} [${res.confidence}] ${res.reason}`);
    // small delay to avoid rate limit
    if (i < photos.length - 1) await new Promise((r) => setTimeout(r, 300));
  }

  const assignment = assignPhotosToUnits(results, photos, units);

  console.log("\n  Assignment hasil:");
  for (const unit of units) {
    const photos = assignment[unit.unit_code] || [];
    console.log(`    ${unit.unit_code} (${unit.brand} ${unit.capacity_pk}PK, ${unit.location}): ${photos.length} foto`);
  }

  console.log("\n  Updating DB...");
  for (const unit of units) {
    const unitPhotos = assignment[unit.unit_code] || [];
    const ok = await updateLog(unit.log_id, unitPhotos);
    console.log(`    ${unit.unit_code}: ${ok ? "✓" : "✗ GAGAL"} (${unitPhotos.length} foto)`);
  }
}

async function main() {
  await processJob("JOB-7VS33V-JBX (Lt1+Lt2, Rey)", JOB1_PHOTOS, JOB1_UNITS);
  await processJob("JOB-7VS45F-HA0 (Lt3, Fikri)", JOB2_PHOTOS, JOB2_UNITS);
  console.log("\n✅ Selesai!");
}

main().catch(console.error);
