export const EXPENSE_APPROVAL_THRESHOLD = 500_000;

export function needsExpenseApproval(role, amount) {
  return role === "Admin" && Number(amount) >= EXPENSE_APPROVAL_THRESHOLD;
}

export function expenseAllocationStatus(form = {}) {
  if (form.category !== "material_purchase") return "NOT_REQUIRED";
  if (form.stock_linked_at) return "STOCK";
  if (form.order_id) return "JOB";
  if (form.allocation_status === "NON_STOCK") return "NON_STOCK";
  return "UNRESOLVED";
}

export function validateExpenseForm(form = {}) {
  const errors = {};
  const amount = Number(form.amount);
  if (!form.subcategory) errors.subcategory = "Sub-kategori wajib dipilih";
  if (form.amount === "" || form.amount == null) errors.amount = "Jumlah wajib diisi";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Jumlah harus lebih dari 0";
  else if (amount > 1_000_000_000) errors.amount = "Jumlah terlalu besar — periksa kembali";
  if (!form.date) errors.date = "Tanggal wajib diisi";
  if (form.category === "petty_cash" && ["Kasbon Karyawan", "Lembur", "Bonus"].includes(form.subcategory) && !String(form.teknisi_name || "").trim()) {
    errors.teknisi_name = "Nama teknisi/helper wajib dipilih";
  }
  if (form.category === "material_purchase" && !String(form.item_name || "").trim()) {
    errors.item_name = "Nama barang wajib diisi";
  }
  return errors;
}

export function buildExpenseCreateMeta({ role, amount, category, orderId, userId } = {}) {
  const needApproval = needsExpenseApproval(role, amount);
  return {
    approval_status: needApproval ? "PENDING_APPROVAL" : "APPROVED",
    created_by_user_id: userId || null,
    source: "manual",
    allocation_status: expenseAllocationStatus({ category, order_id: orderId }),
  };
}

// Kemiripan nilai hanya untuk warning. Exact duplicate wajib memakai source_ref/hash.
export function expenseSimilarityKey(expense = {}) {
  return [
    expense.date || "",
    Number(expense.amount) || 0,
    String(expense.category || "").trim().toLowerCase(),
    String(expense.subcategory || "").trim().toLowerCase(),
    String(expense.teknisi_name || expense.item_name || "").trim().toLowerCase(),
  ].join("|");
}
