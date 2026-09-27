// Check-in lokasi bersifat opsional dan hanya dibaca sekali saat tombol Tiba
// ditekan. Kegagalan/penolakan izin tidak boleh menghambat status lapangan.
export function captureOptionalCheckin(navigatorLike = globalThis.navigator, now = () => new Date()) {
  return new Promise(resolve => {
    const base = { on_site_at: now().toISOString() };
    const geolocation = navigatorLike?.geolocation;
    if (!geolocation?.getCurrentPosition) {
      resolve(base);
      return;
    }
    geolocation.getCurrentPosition(position => resolve({
      ...base,
      on_site_latitude: Number(position.coords.latitude.toFixed(7)),
      on_site_longitude: Number(position.coords.longitude.toFixed(7)),
      on_site_accuracy_m: Math.max(0, Math.round(position.coords.accuracy || 0)),
      on_site_location_captured_at: now().toISOString(),
    }), () => resolve(base), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60_000,
    });
  });
}
