// Form validation helpers — pure, regex based.
export const validateEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());

export const validatePhone = (phone) =>
  /^(08|62|0|6)[0-9]{8,12}$/.test(String(phone || "").replace(/\D/g, ""));

export const validateTime = (time) =>
  /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(String(time || ""));

export const validateDate = (date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) && !isNaN(new Date(date));

export const validatePositiveNumber = (num) =>
  !isNaN(num) && Number(num) > 0;

export const validateAddressLength = (addr) =>
  String(addr || "").trim().length >= 5 && String(addr || "").length <= 255;

export const validateNameLength = (name) =>
  String(name || "").trim().length >= 2 && String(name || "").length <= 100;

export const validateFileSize = (bytes, maxMB = 5) =>
  bytes <= maxMB * 1024 * 1024;

export const validationError = (field, message) => ({ ok: false, field, message });
export const validationOk = () => ({ ok: true });
