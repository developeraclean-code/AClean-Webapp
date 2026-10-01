import { normalizePhone } from "./phone.js";

export const QUOTATION_PAYMENT = Object.freeze({
  FULL_TRANSFER: "FULL_TRANSFER",
  DOWN_PAYMENT: "DOWN_PAYMENT",
});

export const quotationHalfPayment = (total) => Math.round(Math.max(0, Number(total) || 0) / 2);

export const quotationPaymentDetails = ({ method, downPaymentAmount, total }) => {
  const safeTotal = Math.max(0, Number(total) || 0);
  const paymentMethod = method === QUOTATION_PAYMENT.DOWN_PAYMENT
    ? QUOTATION_PAYMENT.DOWN_PAYMENT
    : QUOTATION_PAYMENT.FULL_TRANSFER;
  const requestedDp = Math.max(0, Math.round(Number(downPaymentAmount) || 0));
  const dpAmount = paymentMethod === QUOTATION_PAYMENT.DOWN_PAYMENT
    ? Math.min(requestedDp, safeTotal)
    : 0;

  return {
    method: paymentMethod,
    downPaymentAmount: dpAmount,
    remainingAmount: Math.max(0, safeTotal - dpAmount),
  };
};

const textKey = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const customerKey = (customer) => customer?.id
  || `${textKey(customer?.name)}|${normalizePhone(customer?.phone || "")}|${textKey(customer?.address)}`;

// Pencarian quotation harus tetap menemukan nomor yang sama walaupun admin mengetik
// 08…, 62…, +62…, spasi, atau tanda hubung. Urutan hasil mengutamakan nomor/nama
// yang persis sama, lalu awalan, baru hasil yang sekadar mengandung query.
export const filterQuotationCustomers = (customers, query, limit = 100) => {
  const list = Array.isArray(customers) ? customers : [];
  const qText = textKey(query);
  if (!qText) return list.slice(0, limit);

  const rawDigits = String(query || "").replace(/\D/g, "");
  const qPhone = rawDigits ? normalizePhone(String(query || "")) : "";

  return list
    .map((customer, index) => {
      const name = textKey(customer?.name);
      const area = textKey(customer?.area);
      const address = textKey(customer?.address);
      const phone = normalizePhone(customer?.phone || "");
      let score = Number.POSITIVE_INFINITY;

      if (qPhone && phone === qPhone) score = 0;
      else if (name === qText) score = 1;
      else if (qPhone && phone.startsWith(qPhone)) score = 2;
      else if (name.startsWith(qText)) score = 3;
      else if (qPhone && phone.includes(qPhone)) score = 4;
      else if (name.includes(qText)) score = 5;
      else if (area.includes(qText) || address.includes(qText)) score = 6;

      return { customer, index, score };
    })
    .filter(row => Number.isFinite(row.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(row => row.customer);
};

export const mergeQuotationCustomers = (...groups) => {
  const seen = new Set();
  const merged = [];
  groups.flat().forEach(customer => {
    if (!customer) return;
    const key = customerKey(customer);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(customer);
  });
  return merged;
};
