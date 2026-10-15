import { useQuery } from '@tanstack/react-query';
import { List, Map as MapIcon, MapPinOff, Plus, Search } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClientFormModal } from '@/components/forms';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { profileName, useProfiles } from '@/hooks/data';
import { CLIENT_STATUS_LABEL } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Client, ClientStatus } from '@/lib/types';
import type { MapClient } from '@/components/ClientsMap';

const ClientsMapView = lazy(() => import('@/components/ClientsMap').then((m) => ({ default: m.ClientsMap })));
const ClientMapCard = lazy(() => import('@/components/ClientsMap').then((m) => ({ default: m.ClientMapCard })));
const RoutePanel = lazy(() => import('@/components/ClientsMap').then((m) => ({ default: m.RoutePanel })));

const PIN: Record<ClientStatus, string> = { prospecto: '#1d6fe8', activo: '#10b981', inactivo: '#94a3b8' };
const MAX_STOPS = 10;
const ROUTE_KEY = 'hub.ruta-visitas';
const loadRoute = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_STOPS) : [];
  } catch {
    return [];
  }
};

const STATUS_TONE: Record<ClientStatus, 'blue' | 'green' | 'slate'> = { prospecto: 'blue', activo: 'green', inactivo: 'slate' };

export function ClientsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('vista') === 'mapa' ? 'mapa' : 'lista';
  const setView = (v: 'lista' | 'mapa') => {
    const p = new URLSearchParams(params);
    if (v === 'mapa') p.set('vista', 'mapa');
    else p.delete('vista');
    setParams(p, { replace: true });
  };
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | ClientStatus>('');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: profiles } = useProfiles();

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => unwrap(supabase.from('clients').select('*').order('name')) as Promise<Client[]>,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (status ? c.status === status : c.status !== 'inactivo') &&
        (!owner || c.owner_id === owner) &&
        (!s || [c.name, c.legal_name, c.email, c.city, c.industry].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [data, search, status, owner]);

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={
          data
            ? `${data.filter((c) => c.status !== 'inactivo').length} activos y prospectos · ${data.filter((c) => c.status === 'inactivo').length} archivados (inactivos)`
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="tablist" aria-label="Vista">
              {(
                [
                  ['lista', 'Lista', <List key="l" className="h-4 w-4" />],
                  ['mapa', 'Mapa', <MapIcon key="m" className="h-4 w-4" />],
                ] as const
              ).map(([k, label, icon]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={view === k}
                  onClick={() => setView(k)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${view === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Nuevo cliente
            </Button>
          </div>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Buscar por nombre, correo, ciudad…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus | '')}>
            <option value="">Activos y prospectos</option>
            {Object.entries(CLIENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {k === 'inactivo' ? 'Inactivos (archivados)' : v}
              </option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Todos los responsables</option>
            {profiles?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={error} />
        {view === 'mapa' && !isLoading ? (
          <ClientsMapSection rows={rows} />
        ) : isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No hay clientes con esos filtros" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Estado</Th>
                <Th className="hidden md:table-cell">Rubro</Th>
                <Th className="hidden md:table-cell">Ubicación</Th>
                <Th className="hidden lg:table-cell">Responsable</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link to={`/clientes/${c.id}`} className="font-medium text-navy-900 hover:text-brand-600">
                        {c.name}
                      </Link>
                      <DemoBadge show={c.is_demo} />
                    </div>
                    <p className="text-xs text-slate-500">{c.email ?? c.phone ?? ''}</p>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</Badge>
                  </Td>
                  <Td className="hidden md:table-cell">{c.industry ?? '—'}</Td>
                  <Td className="hidden md:table-cell">{[c.city, c.department].filter(Boolean).join(', ') || '—'}</Td>
                  <Td className="hidden lg:table-cell">{profileName(profiles, c.owner_id)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ClientFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/clientes/${id}`)} />
    </>
  );
}

function ClientsMapSection({ rows }: { rows: Client[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [route, setRoute] = useState<string[]>(loadRoute);
  const [showMissing, setShowMissing] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(ROUTE_KEY, JSON.stringify(route));
    } catch {
      /* sin almacenamiento: la ruta vive solo en esta pestaña */
    }
  }, [route]);

  // En el celular la ficha queda debajo del mapa: llevarla a la vista al elegir un pin
  useEffect(() => {
    if (!active || window.innerWidth >= 1024) return;
    const t = setTimeout(() => document.querySelector('[data-testid=map-card]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    return () => clearTimeout(t);
  }, [active]);

  const located = useMemo(() => rows.filter((c): c is MapClient => c.latitude != null && c.longitude != null), [rows]);
  const missing = rows.filter((c) => c.latitude == null || c.longitude == null);
  const byStatus = (st: ClientStatus) => located.filter((c) => c.status === st).length;

  // Datos para la ficha rápida: próxima visita y cotizado en curso
  const extra = useQuery({
    queryKey: ['clients', 'map-extra'],
    queryFn: async () => {
      const [visits, quotes] = await Promise.all([
        unwrap(supabase.from('visits').select('client_id, title, scheduled_at').eq('status', 'programada').gte('scheduled_at', new Date().toISOString()).order('scheduled_at')),
        unwrap(supabase.from('v_quotes').select('client_id, total').in('status', ['borrador', 'pendiente_envio', 'enviada', 'negociacion'])),
      ]);
      const next = new Map<string, { title: string; scheduled_at: string }>();
      for (const v of visits as { client_id: string; title: string; scheduled_at: string }[]) if (!next.has(v.client_id)) next.set(v.client_id, v);
      const open = new Map<string, number>();
      for (const q of quotes as { client_id: string; total: number }[]) open.set(q.client_id, (open.get(q.client_id) ?? 0) + Number(q.total));
      return { next, open };
    },
  });

  const all = useMemo(() => new Map(located.map((c) => [c.id, c])), [located]);
  const activeClient = active ? all.get(active) : undefined;
  const stops = route.map((id) => all.get(id)).filter(Boolean) as MapClient[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {(['prospecto', 'activo', 'inactivo'] as ClientStatus[]).map((st) =>
          byStatus(st) ? (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIN[st] }} />
              {CLIENT_STATUS_LABEL[st]} · {byStatus(st)}
            </span>
          ) : null,
        )}
        <span className="text-slate-400">{located.length} en el mapa</span>
        {missing.length > 0 && (
          <button className="inline-flex items-center gap-1 text-amber-700 hover:underline" onClick={() => setShowMissing((v) => !v)}>
            <MapPinOff className="h-3.5 w-3.5" /> {missing.length} sin ubicación
          </button>
        )}
      </div>
      {showMissing && missing.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <p className="mb-1">Estos clientes no salen en el mapa. Abrí la ficha → Editar → "Ubicación en el mapa":</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {missing.map((c) => (
              <Link key={c.id} to={`/clientes/${c.id}`} className="font-medium underline">
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[60vh] min-h-[420px] overflow-hidden rounded-xl border border-slate-200 lg:h-[calc(100vh-300px)]">
          <Suspense fallback={<div className="h-full animate-pulse bg-slate-100" />}>
            <ClientsMapView clients={located} activeId={active} onSelect={setActive} route={route} />
          </Suspense>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <Suspense fallback={null}>
              {activeClient ? (
                <ClientMapCard
                  client={activeClient}
                  nextVisit={extra.data?.next.get(activeClient.id)}
                  openAmount={extra.data?.open.get(activeClient.id)}
                  inRoute={route.includes(activeClient.id)}
                  routeFull={route.length >= MAX_STOPS}
                  onToggleRoute={() =>
                    setRoute((r) => (r.includes(activeClient.id) ? r.filter((x) => x !== activeClient.id) : [...r, activeClient.id].slice(0, MAX_STOPS)))
                  }
                  onClose={() => setActive(null)}
                />
              ) : (
                <p className="text-sm text-slate-500">Tocá un pin para ver el cliente: dirección, teléfono, próxima visita y lo que tiene cotizado.</p>
              )}
            </Suspense>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <Suspense fallback={null}>
              <RoutePanel
                stops={stops}
                onRemove={(id) => setRoute((r) => r.filter((x) => x !== id))}
                onReorder={setRoute}
                onClear={() => setRoute([])}
                onFocus={setActive}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
