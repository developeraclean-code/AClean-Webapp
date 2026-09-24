export const ORDER_TEKNISI_FIELDS = ["teknisi", "teknisi2", "teknisi3"];
export const ORDER_HELPER_FIELDS = ["helper", "helper2", "helper3"];

export function emptyOrderTeamAssignment() {
  return Object.fromEntries(
    [...ORDER_TEKNISI_FIELDS, ...ORDER_HELPER_FIELDS].map(field => [field, null])
  );
}

// Ubah roster harian menjadi enam kolom personel order secara deterministik.
// Selalu tulis semua kolom agar anggota dari slot lama tidak tertinggal.
export function buildOrderTeamAssignment(members = []) {
  const normalized = members
    .map(member => ({
      name: String(member?.name || "").trim(),
      role: String(member?.role || "").toLowerCase(),
    }))
    .filter(member => member.name);

  let teknisi = normalized.filter(member => member.role === "teknisi");
  let helpers = normalized.filter(member => member.role !== "teknisi");

  // Order reguler perlu satu penanggung jawab. Bila roster hanya berisi helper,
  // anggota pertama menjadi teknisi utama, sama seperti perilaku lama.
  if (teknisi.length === 0 && helpers.length > 0) {
    teknisi = [helpers[0]];
    helpers = helpers.slice(1);
  }

  const payload = emptyOrderTeamAssignment();
  ORDER_TEKNISI_FIELDS.forEach((field, index) => {
    payload[field] = teknisi[index]?.name || null;
  });
  ORDER_HELPER_FIELDS.forEach((field, index) => {
    payload[field] = helpers[index]?.name || null;
  });
  return payload;
}

// Satu resolver untuk create/edit/quick-assign order reguler.
// null berarti slot dipilih tetapi roster/preset belum tersedia dan save harus ditahan.
export function resolveRegularOrderTeam({ teamSlot, members = [], presetTeknisi = "" }) {
  if (!teamSlot) return emptyOrderTeamAssignment();
  if (members.some(member => String(member?.name || "").trim())) {
    return buildOrderTeamAssignment(members);
  }
  if (String(presetTeknisi || "").trim()) {
    return {
      ...emptyOrderTeamAssignment(),
      teknisi: String(presetTeknisi).trim(),
    };
  }
  return null;
}
