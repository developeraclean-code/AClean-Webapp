// Coarse operational zones, based on the saved area or words in the job address.
// Plain addresses are not geocoded; an unknown location must remain unknown.
export const SERVICE_AREAS = [
  'Gading Serpong', 'BSD', 'Alam Sutera', 'Bintaro', 'Graha Raya',
  'Tangerang', 'Jakarta Barat', 'Karawaci', 'Suvarna Sutera',
];

const patterns = [
  ['Suvarna Sutera', /\bsuvarna\s+sutera\b/],
  ['Graha Raya', /\bgraha\s+raya\b/],
  ['Gading Serpong', /\bgading\s+serpong\b/],
  ['Alam Sutera', /\balam\s+sutera\b/],
  ['BSD', /\b(?:bsd|bumi\s+serpong\s+damai)\b/],
  ['Jakarta Barat', /\b(?:jakarta\s+barat|jakbar)\b/],
  ['Karawaci', /\bkarawaci\b/],
  ['Bintaro', /\bbintaro\b/],
  ['Tangerang', /\btangerang\b(?!\s+selatan)/],
];

const normalized = value => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const detect = value => {
  const text = normalized(value);
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] || null;
};

export function resolveServiceArea({ area, address } = {}) {
  const saved = detect(area);
  const fromAddress = detect(address);
  // A broad city label should not hide a more useful neighborhood in the address.
  const label = saved && saved !== 'Tangerang' ? saved : fromAddress || saved;
  return { label: label || 'Area belum jelas', source: label ? (label === saved ? 'tersimpan' : 'alamat') : 'belum jelas',
    conflict: !!saved && !!fromAddress && saved !== fromAddress && saved !== 'Tangerang' && fromAddress !== 'Tangerang' };
}

export function areaMapsUrl(address) {
  const text = String(address || '').trim();
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}
