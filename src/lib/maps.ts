/** Utilidades de mapas (sin dependencias, para poder probarlas). */

export const googleMapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const googleDirectionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const wazeUrl = (lat: number, lng: number) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * Saca coordenadas de un enlace de Google Maps (o de "13.69, -89.19").
 * Los enlaces cortos (maps.app.goo.gl) no traen coordenadas: hay que abrirlos primero.
 */
export function parseMapsLink(text: string): { ok: true; lat: number; lng: number } | { ok: false; error: string } {
  const t = decodeURIComponent(text.trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // posición exacta del lugar
    /[?&](?:q|query|ll|destination|daddr|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, // centro del mapa
    /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/, // "13.69, -89.19"
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) return { ok: true, lat, lng };
    }
  }
  if (/goo\.gl|maps\.app/i.test(t)) {
    return { ok: false, error: 'Ese es un enlace corto: abrilo en el navegador, copiá el enlace largo de la barra de direcciones y pegalo aquí (o tocá el mapa).' };
  }
  return { ok: false, error: 'No encontré coordenadas en ese texto. Pegá el enlace de Google Maps del lugar o tocá el mapa.' };
}
