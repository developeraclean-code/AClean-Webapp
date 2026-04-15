// Indonesia timezone (UTC+7) helpers.
const OFFSET_MS = 7 * 60 * 60 * 1000;

export const getLocalDate = () =>
  new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);

export const getLocalDateObj = () =>
  new Date(Date.now() + OFFSET_MS);

export const getLocalISOString = () =>
  new Date(Date.now() + OFFSET_MS).toISOString();
