// Indonesia timezone (UTC+7) helpers.
const OFFSET_MS = 7 * 60 * 60 * 1000;

export const getLocalDate = () =>
  new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);

export const getLocalDateObj = () =>
  new Date(Date.now() + OFFSET_MS);

export const getLocalISOString = () =>
  new Date(Date.now() + OFFSET_MS).toISOString();

export const isWorkingHours = () => {
  // Parse ISO string to extract local (UTC+7) date/time components
  const iso = new Date(Date.now() + OFFSET_MS).toISOString();
  const localHour = parseInt(iso.slice(11, 13));
  const localMinute = parseInt(iso.slice(14, 16));
  // Separate date calc: determine local day of week
  const localDate = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const localDay = new Date(localDate.getTime() + OFFSET_MS).getUTCDay();
  const timeMinutes = localHour * 60 + localMinute;
  return localDay >= 1 && localDay <= 6 && timeMinutes >= 480 && timeMinutes < 1140;
};
