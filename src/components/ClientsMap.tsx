// Mapa de todos los clientes + armado de ruta de visitas (Leaflet + OpenStreetMap).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { ArrowDownUp, CalendarClock, ExternalLink, MapPin, Navigation, Phone, Plus, Route, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CLIENT_STATUS_LABEL, dateTime, money } from '@/lib/format';
import { googleDirectionsUrl, orderByProximity, routeUrl, wazeUrl } from '@/lib/maps';
import type { Client, ClientStatus } from '@/lib/types';
import { Button } from './ui';

export const PIN_COLOR: Record<ClientStatus, string> = { prospecto: '#1d6fe8', activo: '#10b981', inactivo: '#94a3b8' };
export const MAX_STOPS = 10; // Google Maps admite destino + 9 paradas intermedias

export type MapClient = Client & { latitude: number; longitude: number };

function pinIcon(color: string, active: boolean, stop: number | null) {
  const w = active ? 36 : 28;
  const h = Math.round(w * 1.33);
  const label = stop
    ? `<text x="15" y="19.5" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="${color}">${stop}</text>`
    : `<circle cx="15" cy="15" r="5" fill="#fff"/>`;
  return L.divIcon({
    className: '',
    iconSize: [w, h],
    iconAnchor: [w / 2, h - 1],
    html: `<svg width="${w}" height="${h}" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 2px rgba(15,23,42,.35))">
      <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="${color}" stroke="#fff" stroke-width="2"/>
      ${stop ? '<circle cx="15" cy="15" r="8" fill="#fff"/>' : ''}${label}</svg>`,
  });
}

export function ClientsMap({
  clients,
  activeId,
  onSelect,
  route,
}: {
  clients: MapClient[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  route: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.MarkerClusterGroup | null>(null);
  const pinned = useRef<L.LayerGroup | null>(null); // ruta + seleccionado: nunca se agrupan
  const line = useRef<L.Polyline | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fittedFor = useRef('');
  const prevActive = useRef<string | null>(null);
  const bounds = useRef<L.LatLngBounds | null>(null);
  const userMoved = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { center: [13.75, -88.95], zoom: 8, scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.on('click', () => onSelectRef.current(null));
    // Agrupa los pines cercanos (p. ej. área metropolitana) en burbujas con el número
    layer.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 45,
      iconCreateFunction: (cl) => {
        const n = cl.getChildCount();
        const size = n < 10 ? 36 : 44;
        return L.divIcon({
          className: '',
          iconSize: [size, size],
          html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:#0b1e3f;color:#fff;display:flex;align-items:center;justify-content:center;font:700 13px Inter,Arial,sans-serif;box-shadow:0 0 0 5px rgba(29,111,232,.25),0 2px 4px rgba(15,23,42,.3)">${n}</div>`,
        });
      },
    }).addTo(map);
    pinned.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Si el contenedor cambia de tamaño (carga diferida, rotar el celular), re-encuadrar
    // mientras la persona no haya movido el mapa por su cuenta.
    map.on('dragstart', () => (userMoved.current = true));
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!userMoved.current && bounds.current) map.fitBounds(bounds.current, { padding: [30, 30], maxZoom: 14 });
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Pines (se redibujan al cambiar filtros, selección o ruta)
  useEffect(() => {
    const map = mapRef.current;
    const group = layer.current;
    const fixed = pinned.current;
    if (!map || !group || !fixed) return;
    group.clearLayers();
    fixed.clearLayers();
    for (const c of clients) {
      const stop = route.indexOf(c.id);
      const m = L.marker([c.latitude, c.longitude], {
        icon: pinIcon(PIN_COLOR[c.status], c.id === activeId, stop >= 0 ? stop + 1 : null),
        title: c.name,
        zIndexOffset: c.id === activeId ? 1000 : stop >= 0 ? 500 : 0,
        keyboard: true,
      });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectRef.current(c.id);
      });
      if (stop >= 0 || c.id === activeId) fixed.addLayer(m);
      else group.addLayer(m);
      // Elegido desde la lista de la ruta y fuera de la vista: llevar el mapa hasta él
      if (c.id === activeId && activeId !== prevActive.current && !map.getBounds().pad(-0.1).contains([c.latitude, c.longitude])) {
        map.panTo([c.latitude, c.longitude]);
      }
    }
    prevActive.current = activeId;
    // Encuadrar solo cuando cambia el conjunto de clientes (no al seleccionar)
    const key = clients.map((c) => c.id).join(',');
    if (key !== fittedFor.current && clients.length) {
      fittedFor.current = key;
      const b = L.latLngBounds(clients.map((c) => [c.latitude, c.longitude] as L.LatLngTuple));
      bounds.current = b;
      userMoved.current = false;
      map.invalidateSize();
      map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
    }
  }, [clients, activeId, route]);

  // Línea de la ruta
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    line.current?.remove();
    const pts = route.map((id) => clients.find((c) => c.id === id)).filter(Boolean) as MapClient[];
    if (pts.length >= 2) {
      line.current = L.polyline(
        pts.map((p) => [p.latitude, p.longitude] as L.LatLngTuple),
        { color: '#0b1e3f', weight: 3, opacity: 0.7, dashArray: '6 8' },
      ).addTo(map);
    }
  }, [route, clients]);

  return <div ref={ref} className="z-0 h-full min-h-[420px] w-full" data-testid="clients-map" />;
}

/** Ficha rápida del cliente seleccionado. */
export function ClientMapCard({
  client,
  nextVisit,
  openAmount,
  inRoute,
  routeFull,
  onToggleRoute,
  onClose,
}: {
  client: MapClient;
  nextVisit?: { title: string; scheduled_at: string };
  openAmount?: number;
  inRoute: boolean;
  routeFull: boolean;
  onToggleRoute: () => void;
  onClose: () => void;
}) {
  const link = 'inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline';
  return (
    <div className="space-y-3" data-testid="map-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/clientes/${client.id}`} className="block truncate text-base font-semibold text-navy-900 hover:text-brand-600">
            {client.name}
          </Link>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: PIN_COLOR[client.status] }} />
            {CLIENT_STATUS_LABEL[client.status]}
            {client.industry ? ` · ${client.industry}` : ''}
          </p>
        </div>
        <button aria-label="Cerrar ficha" className="text-slate-400 hover:text-slate-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="space-y-1.5 text-sm">
        <p className="flex items-start gap-2 text-slate-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          {[client.address, client.city, client.department].filter(Boolean).join(', ') || '—'}
        </p>
        {client.phone && (
          <a href={`tel:${client.phone}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600">
            <Phone className="h-4 w-4 text-slate-400" /> {client.phone}
          </a>
        )}
        {nextVisit && (
          <p className="flex items-start gap-2 rounded-lg bg-violet-50 px-2 py-1.5 text-xs text-violet-800">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Próxima visita: <b>{dateTime(nextVisit.scheduled_at)}</b> · {nextVisit.title}
            </span>
          </p>
        )}
        {openAmount ? (
          <p className="rounded-lg bg-brand-50 px-2 py-1.5 text-xs text-brand-700">
            Cotizado en curso: <b>{money(openAmount)}</b>
          </p>
        ) : null}
        {client.needs && <p className="text-xs text-slate-500">Necesidad: {client.needs}</p>}
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link to={`/clientes/${client.id}`} className={link}>
          <ExternalLink className="h-3.5 w-3.5" /> Ver ficha
        </Link>
        <a className={link} href={googleDirectionsUrl(client.latitude, client.longitude)} target="_blank" rel="noreferrer">
          <Navigation className="h-3.5 w-3.5" /> Cómo llegar
        </a>
        <a className={link} href={wazeUrl(client.latitude, client.longitude)} target="_blank" rel="noreferrer">
          <Navigation className="h-3.5 w-3.5" /> Waze
        </a>
      </div>
      <Button
        size="sm"
        variant={inRoute ? 'secondary' : 'primary'}
        className="w-full"
        disabled={!inRoute && routeFull}
        icon={inRoute ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        onClick={onToggleRoute}
      >
        {inRoute ? 'Quitar de la ruta' : routeFull ? `Ruta llena (${MAX_STOPS} paradas)` : 'Agregar a la ruta'}
      </Button>
    </div>
  );
}

/** Lista de paradas de la ruta y botón para abrirla en Google Maps. */
export function RoutePanel({
  stops,
  onRemove,
  onReorder,
  onClear,
  onFocus,
}: {
  stops: MapClient[];
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onClear: () => void;
  onFocus: (id: string) => void;
}) {
  const url = useMemo(() => routeUrl(stops.map((s) => [s.latitude, s.longitude])), [stops]);
  if (!stops.length) {
    return (
      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Route className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        Tocá un pin y "Agregar a la ruta" para armar el recorrido del día (hasta {MAX_STOPS} paradas). Se abre en Google Maps desde donde estés.
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="route-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-navy-900">Ruta de visitas · {stops.length}</p>
        <button className="text-xs text-slate-500 hover:text-red-600" onClick={onClear}>
          Vaciar
        </button>
      </div>
      <ol className="space-y-1">
        {stops.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-bold text-white">{i + 1}</span>
            <button className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-brand-600" onClick={() => onFocus(s.id)}>
              {s.name}
              <span className="text-xs text-slate-400"> · {s.city}</span>
            </button>
            <button aria-label={`Quitar ${s.name} de la ruta`} className="text-slate-400 hover:text-red-600" onClick={() => onRemove(s.id)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 pt-1">
        {stops.length >= 3 && (
          <Button size="sm" variant="secondary" icon={<ArrowDownUp className="h-4 w-4" />} onClick={() => onReorder(orderByProximity(stops).map((s) => s.id))}>
            Ordenar por cercanía
          </Button>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
        >
          <Navigation className="h-4 w-4" /> Abrir ruta en Google Maps
        </a>
      </div>
    </div>
  );
}
