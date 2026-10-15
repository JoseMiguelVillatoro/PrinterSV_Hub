// Mapa de ubicación del cliente (Leaflet + OpenStreetMap: gratis, sin API key).
// Se carga solo cuando se usa (lazy) para no engordar el resto de la app.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Link2, Loader2, MapPin, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from './ui';
import { parseMapsLink } from '@/lib/maps';

const SV_CENTER: L.LatLngTuple = [13.6929, -89.2182]; // San Salvador
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const PIN = L.divIcon({
  className: '',
  iconSize: [30, 40],
  iconAnchor: [15, 39],
  html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 2px rgba(15,23,42,.35))">
    <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="#1d6fe8" stroke="#fff" stroke-width="2"/>
    <circle cx="15" cy="15" r="5.5" fill="#fff"/></svg>`,
});

function useLeafletMap(ref: React.RefObject<HTMLDivElement>, center: L.LatLngTuple, zoom: number, interactive: boolean) {
  const mapRef = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      center,
      zoom,
      scrollWheelZoom: interactive,
      attributionControl: true,
      zoomControl: true,
    });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(false);
    mapRef.current = map;
    // Dentro de un modal el contenedor mide 0 al principio: recalcular al aparecer
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mapRef;
}

/** Mapa de solo lectura con el pin del cliente. */
export function ClientMapView({ lat, lng, className = 'h-44' }: { lat: number; lng: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(ref, [lat, lng], 15, false);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const marker = L.marker([lat, lng], { icon: PIN, keyboard: false }).addTo(m);
    m.setView([lat, lng], m.getZoom());
    return () => {
      marker.remove();
    };
  }, [map, lat, lng]);
  return <div ref={ref} className={`z-0 w-full overflow-hidden rounded-lg border border-slate-200 ${className}`} data-testid="client-map" />;
}

interface SearchHit {
  display_name: string;
  lat: string;
  lon: string;
}

/** Mapa para elegir la ubicación: buscar dirección, tocar el mapa, arrastrar el pin, usar GPS o pegar un enlace. */
export function LocationPicker({
  lat,
  lng,
  query,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  query: string;
  onChange: (lat: number | null, lng: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const has = lat !== null && lng !== null;
  const map = useLeafletMap(ref, has ? [lat, lng] : SV_CENTER, has ? 16 : 12, true);
  const marker = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [q, setQ] = useState(query);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'gps' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');

  // Tocar el mapa coloca el pin
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const click = (e: L.LeafletMouseEvent) => onChangeRef.current(round(e.latlng.lat), round(e.latlng.lng));
    m.on('click', click);
    return () => {
      m.off('click', click);
    };
  }, [map]);

  // Sincronizar el pin con lat/lng
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!has) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { icon: PIN, draggable: true }).addTo(m);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        onChangeRef.current(round(p.lat), round(p.lng));
      });
    } else {
      marker.current.setLatLng([lat, lng]);
    }
    if (!m.getBounds().contains([lat, lng])) m.setView([lat, lng], Math.max(m.getZoom(), 15));
  }, [map, has, lat, lng]);

  function goTo(la: number, ln: number) {
    onChange(round(la), round(ln));
    map.current?.setView([la, ln], 17);
  }

  async function search() {
    if (!q.trim()) return;
    setBusy('search');
    setMsg(null);
    setHits(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=sv&accept-language=es&q=${encodeURIComponent(q.trim())}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as SearchHit[];
      if (!data.length) setMsg('No se encontró esa dirección. Probá con menos detalle (colonia, municipio) y tocá el mapa para afinar.');
      else if (data.length === 1) goTo(Number(data[0].lat), Number(data[0].lon));
      else setHits(data);
    } catch {
      setMsg('No se pudo buscar ahora. Podés tocar el mapa para colocar el pin.');
    } finally {
      setBusy(null);
    }
  }

  function gps() {
    if (!navigator.geolocation) return setMsg('Este dispositivo no permite obtener la ubicación.');
    setBusy('gps');
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(null);
        goTo(p.coords.latitude, p.coords.longitude);
      },
      () => {
        setBusy(null);
        setMsg('No se pudo obtener tu ubicación (¿diste permiso al navegador?).');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function applyLink(text: string) {
    setLink(text);
    if (!text.trim()) return;
    const r = parseMapsLink(text);
    if (r.ok) {
      goTo(r.lat, r.lng);
      setLinkMode(false);
      setLink('');
      setMsg(null);
    } else setMsg(r.error);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            className="pl-9"
            aria-label="Buscar dirección en el mapa"
            placeholder="Buscar dirección, colonia o lugar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" loading={busy === 'search'} onClick={() => void search()}>
          Buscar
        </Button>
      </div>
      {hits && (
        <ul className="max-h-40 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  goTo(Number(h.lat), Number(h.lon));
                  setHits(null);
                }}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <span className="text-slate-700">{h.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="z-0 h-64 w-full overflow-hidden rounded-lg border border-slate-200" data-testid="location-picker" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" icon={busy === 'gps' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} onClick={gps}>
          Usar mi ubicación
        </Button>
        <Button type="button" size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} onClick={() => setLinkMode((v) => !v)}>
          Pegar enlace de Google Maps
        </Button>
        {has && (
          <Button type="button" size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(null, null)}>
            Quitar ubicación
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-500">{has ? `${lat!.toFixed(5)}, ${lng!.toFixed(5)}` : 'Sin ubicación'}</span>
      </div>
      {linkMode && (
        <Input autoFocus aria-label="Enlace de Google Maps" placeholder="https://www.google.com/maps/…  o  13.6989, -89.1914" value={link} onChange={(e) => applyLink(e.target.value)} />
      )}
      {msg && <p className="text-xs text-amber-700">{msg}</p>}
      <p className="text-xs text-slate-500">Tocá el mapa para poner el pin y arrastralo para afinar. En el celular, "Usar mi ubicación" sirve cuando estás en el lugar.</p>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
