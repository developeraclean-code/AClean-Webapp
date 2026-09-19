// Satu submit memakai UUID yang sama saat diulang setelah timeout/network error.
// Label tidak unik: dua roll fisik baru boleh punya label yang sama.
export async function createInventoryUnit(supabase, unit, requestId) {
  const payload = { ...unit, id: requestId };
  const { error } = await supabase.from("inventory_units").insert(payload);
  if (!error) return payload;

  // Respons insert bisa hilang meski commit berhasil. PK UUID mencegah insert
  // kedua; hanya anggap sukses jika baris dengan ID yang SAMA benar-benar ada.
  if (error.code === "23505") {
    const { data, error: readError } = await supabase.from("inventory_units")
      .select("id,inventory_code,unit_label,capacity,stock,purchase_date,notes")
      .eq("id", requestId).maybeSingle();
    if (!readError && data && data.inventory_code === unit.inventory_code
      && data.unit_label === unit.unit_label
      && Number(data.capacity) === Number(unit.capacity)
      && Number(data.stock) === Number(unit.stock)
      && (data.purchase_date || null) === (unit.purchase_date || null)
      && (data.notes || null) === (unit.notes || null)) return data;
  }
  throw error;
}
