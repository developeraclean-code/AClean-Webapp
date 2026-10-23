import { INVOICE_UNPAID_STATUSES } from "../constants/status.js";

export const isUsablePaymentProof = (url) => !!url && ![
  "verified-no-proof", "verified-manual-no-proof", "purged-90d",
].includes(url);

export const settlementBalance = (invoice) => Math.max(0,
  Number(invoice?.remaining_amount ?? (Number(invoice?.total || 0) - Number(invoice?.paid_amount || 0))) || 0,
);

export const canReviewSettlement = ({ invoice, method, reason, acknowledged, typedInvoiceId }) =>
  !!invoice && INVOICE_UNPAID_STATUSES.includes(invoice.status) && settlementBalance(invoice) > 0
  && acknowledged && typedInvoiceId?.trim().toUpperCase() === invoice.id?.toUpperCase()
  && (method === "cash"
    ? !isUsablePaymentProof(invoice.payment_proof_url) && reason?.trim().length >= 10
    : method === "transfer" && isUsablePaymentProof(invoice.payment_proof_url));
