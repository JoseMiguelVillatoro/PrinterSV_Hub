import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  PackageSearch,
  Plus,
  Send,
  ShoppingCart,
  Timer,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, Checkbox, ErrorBox, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { QUOTE_STATUS_LABEL, addDaysISO, dateTime, money, num, todayISO } from '@/lib/format';
import { ORDER_STAGES, orderStage } from '@/lib/orderStage';
import { supabase, unwrap } from '@/lib/supabase';
import type { DashboardMetrics, OrderView, QuoteStatus } from '@/lib/types';

const STATUS_COLOR: Record<QuoteStatus, string> = {
  borrador: '#94a3b8',
  pendiente_envio: '#8b5cf6',
  enviada: '#1d6fe8',
  negociacion: '#06b6d4',
  aceptada: '#10b981',
  rechazada: '#ef4444',
  vencida: '#f59e0b',
  cancelada: '#cbd5e1',
};

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

type Tint = 'blue' | 'green' | 'violet' | 'emerald' | 'amber' | 'red' | 'indigo';
const TINT: Record<Tint, string> = {
  blue: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-teal-50 text-teal-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  indigo: 'bg-indigo-50 text-indigo-600',
};

function Stat({ icon, tint, label, value, sub, subTone = 'slate', to }: { icon: ReactNode; tint: Tint; label: string; value: ReactNode; sub?: ReactNode; subTone?: 'slate' | 'green' | 'red'; to?: string }) {
  const body = (
    <div className="flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow">
      <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TINT[tint])}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 text-xl font-bold tracking-tight text-navy-900">{value}</p>
        {sub && <p className={clsx('mt-0.5 text-xs', subTone === 'green' ? 'text-emerald-600' : subTone === 'red' ? 'text-red-600' : 'text-slate-500')}>{sub}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

interface Activity {
  key: string;
  at: string;
  icon: ReactNode;
  tint: Tint;
  title: string;
  sub: string;
  to: string;
}

function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: async (): Promise<Activity[]> => {
      const [qe, oe, vi] = await Promise.all([
        unwrap(supabase.from('quote_events').select('id, event_type, to_status, created_at, quote_id, quotes(number, clients(name))').order('created_at', { ascending: false }).limit(8)),
        unwrap(supabase.from('order_events').select('id, stage, to_value, created_at, order_id, orders(number, clients(name))').order('created_at', { ascending: false }).limit(6)),
        unwrap(supabase.from('visits').select('id, title, status, scheduled_at, updated_at, client_id, clients(name)').order('updated_at', { ascending: false }).limit(4)),
      ]);
      type QE = { id: number; event_type: string; to_status: QuoteStatus | null; created_at: string; quote_id: string; quotes: { number: string; clients: { name: string } | null } | null };
      type OE = { id: number; stage: string; to_value: string | null; created_at: string; order_id: string; orders: { number: string; clients: { name: string } | null } | null };
      type VI = { id: string; title: string; status: string; scheduled_at: string; updated_at: string; client_id: string; clients: { name: string } | null };
      const out: Activity[] = [];
      for (const e of qe as unknown as QE[]) {
        const n = e.quotes?.number ?? '';
        const c = e.quotes?.clients?.name ?? '';
        const title =
          e.event_type === 'creada'
            ? `Cotización ${n} creada`
            : e.event_type === 'estado' && e.to_status
              ? `Cotización ${n} · ${QUOTE_STATUS_LABEL[e.to_status].toLowerCase()}`
              : e.event_type === 'pedido'
                ? `Pedido generado desde ${n}`
                : e.event_type === 'seguimiento'
                  ? `Seguimiento en ${n}`
                  : `Comentario en ${n}`;
        const icon =
          e.to_status === 'aceptada' ? <CheckCircle2 className="h-4 w-4" /> : e.to_status === 'rechazada' ? <XCircle className="h-4 w-4" /> : e.event_type === 'estado' ? <Send className="h-4 w-4" /> : <FileText className="h-4 w-4" />;
        const tint: Tint = e.to_status === 'aceptada' ? 'green' : e.to_status === 'rechazada' ? 'red' : e.event_type === 'seguimiento' ? 'amber' : 'blue';
        out.push({ key: `q${e.id}`, at: e.created_at, icon, tint, title, sub: `Cliente: ${c}`, to: `/cotizaciones/${e.quote_id}` });
      }
      for (const e of oe as unknown as OE[]) {
        if (e.stage === 'creado') continue;
        out.push({
          key: `o${e.id}`,
          at: e.created_at,
          icon: <Truck className="h-4 w-4" />,
          tint: 'indigo',
          title: `Pedido ${e.orders?.number ?? ''} · ${e.stage} ${e.to_value ? `→ ${e.to_value.replace('_', ' ')}` : ''}`,
          sub: `Cliente: ${e.orders?.clients?.name ?? ''}`,
          to: `/pedidos/${e.order_id}`,
        });
      }
      for (const v of vi as unknown as VI[]) {
        out.push({
          key: `v${v.id}`,
          at: v.updated_at,
          icon: <CalendarDays className="h-4 w-4" />,
          tint: 'violet',
          title: `Visita ${v.status}: ${v.title}`,
          sub: `Cliente: ${v.clients?.name ?? ''}`,
          to: `/clientes/${v.client_id}`,
        });
      }
      return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
    },
  });
}

interface DonutItem {
  key: string;
  label: string;
  color: string;
  count: number;
  amount: number;
  to: string;
}

/** Dona con leyenda; al pasar el cursor, el centro muestra ese estado (sin tooltip que lo tape). */
function StatusDonut({ items, empty, testId }: { items: DonutItem[]; empty: string; testId: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <p className="py-8 text-center text-sm text-slate-500">{empty}</p>;
  const h = hover !== null ? items[hover] : null;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row" data-testid={testId}>
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="count"
              nameKey="label"
              innerRadius="64%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
              onMouseEnter={(_, idx) => setHover(idx)}
              onMouseLeave={() => setHover(null)}
            >
              {items.map((d, idx) => (
                <Cell key={d.key} fill={d.color} opacity={hover === null || hover === idx ? 1 : 0.35} className="cursor-pointer outline-none" />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-bold text-navy-900">{h ? h.count : total}</span>
          <span className="max-w-[88px] text-xs leading-tight text-slate-500">{h ? h.label : 'Total'}</span>
          {h && <span className="mt-0.5 text-[11px] font-medium text-slate-600">{money(h.amount)}</span>}
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {items.map((d, idx) => (
          <li key={d.key} onMouseEnter={() => setHover(idx)} onMouseLeave={() => setHover(null)}>
            <Link to={d.to} className="flex items-center justify-between gap-3 rounded px-1 hover:bg-slate-50">
              <span className="flex items-center gap-2 text-slate-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                {d.label}
              </span>
              <span className="font-semibold text-navy-900">{d.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `Hace ${d} día${d === 1 ? '' : 's'}` : dateTime(iso).slice(0, 10);
}

export function DashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const today = todayISO();
  const [from, setFrom] = useState(addDaysISO(today, -29));
  const [to, setTo] = useState(today);
  const [includeDemo, setIncludeDemo] = useState(true);

  const { data: m, isLoading, error } = useQuery({
    queryKey: ['dashboard', from, to, includeDemo],
    queryFn: () => unwrap(supabase.rpc('dashboard_metrics', { p_from: from, p_to: to, p_include_demo: includeDemo })) as Promise<DashboardMetrics>,
  });
  const activity = useRecentActivity();
  // Pedidos: estado actual (no depende del rango de fechas)
  const orders = useQuery({
    queryKey: ['dashboard', 'orders-stage'],
    queryFn: () =>
      unwrap(
        supabase.from('v_orders').select('id, status, requires_purchase, purchase_status, reception_status, preparation_status, delivery_status, total, is_demo'),
      ) as Promise<OrderView[]>,
  });

  const s = useMemo(() => {
    const by = (st: QuoteStatus[]) => (m?.quotes.by_status ?? []).filter((x) => st.includes(x.status)).reduce((a, x) => ({ n: a.n + Number(x.count), amount: a.amount + Number(x.amount) }), { n: 0, amount: 0 });
    return {
      all: by(['pendiente_envio', 'enviada', 'negociacion', 'aceptada', 'rechazada', 'vencida', 'borrador']),
      pending: by(['pendiente_envio', 'enviada', 'negociacion']),
      accepted: by(['aceptada']),
      lost: by(['rechazada', 'vencida']),
    };
  }, [m]);
  const quoteDonut: DonutItem[] = (m?.quotes.by_status ?? [])
    .filter((x) => Number(x.count) > 0 && x.status !== 'cancelada')
    .map((x) => ({ key: x.status, label: QUOTE_STATUS_LABEL[x.status], color: STATUS_COLOR[x.status], count: Number(x.count), amount: Number(x.amount), to: `/cotizaciones?estado=${x.status}` }));
  const orderDonut: DonutItem[] = useMemo(() => {
    const rows = (orders.data ?? []).filter((o) => includeDemo || !o.is_demo);
    return ORDER_STAGES.map((st) => {
      const inStage = rows.filter((o) => orderStage(o) === st.key);
      return { key: st.key, label: st.label, color: st.color, count: inStage.length, amount: inStage.reduce((a, o) => a + Number(o.total), 0), to: `/pedidos?etapa=${st.key}` };
    }).filter((x) => x.count > 0);
  }, [orders.data, includeDemo]);
  const firstName = auth.profile?.full_name?.split(' ').slice(0, 2).join(' ');

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Hola{firstName ? `, ${firstName}` : ''} 👋</h1>
          <p className="mt-1 text-sm text-slate-500">Aquí tenés un resumen de la gestión comercial de Printer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-full items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 shadow-sm sm:w-auto">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <input type="date" aria-label="Desde" className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm focus:outline-none" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-300">–</span>
            <input type="date" aria-label="Hasta" className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm focus:outline-none" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Checkbox label="Incluir demo" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
          </div>
          {auth.canManageQuotes && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/cotizaciones/nueva')} className="sm:hidden">
              Nueva cotización
            </Button>
          )}
        </div>
      </div>

      <ErrorBox error={error} />
      {isLoading || !m ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
            <Stat to="/clientes" icon={<Users className="h-5 w-5" />} tint="blue" label="Clientes" value={num(m.clients.total)} sub={`+${m.clients.new_in_range} en el periodo · ${m.clients.prospects} prospectos`} subTone={m.clients.new_in_range > 0 ? 'green' : 'slate'} />
            <Stat to="/agenda" icon={<CalendarCheck className="h-5 w-5" />} tint="green" label="Visitas" value={num(m.visits.done_in_range)} sub={`${m.visits.upcoming_7d} próximas 7 días`} />
            <Stat to="/cotizaciones" icon={<FileText className="h-5 w-5" />} tint="indigo" label="Cotizaciones" value={money(m.quotes.amount_in_range)} sub={`${m.quotes.count_in_range} emitidas en el periodo`} />
            <Stat to="/cotizaciones?estado=aceptada" icon={<CheckCircle2 className="h-5 w-5" />} tint="emerald" label="Aceptadas" value={num(s.accepted.n)} sub={m.quotes.conversion_rate === null ? 'Sin decisiones aún' : `${num(m.quotes.conversion_rate, 1)} % conversión`} subTone="green" />
            <Stat icon={<Clock className="h-5 w-5" />} tint="amber" label="Pendientes" value={num(s.pending.n)} sub={money(s.pending.amount)} to="/cotizaciones?estado=enviada" />
            <Stat icon={<XCircle className="h-5 w-5" />} tint="red" label="Rechazadas / vencidas" value={num(s.lost.n)} sub={money(s.lost.amount)} to="/reportes" />
            <Stat to="/pedidos" icon={<ShoppingCart className="h-5 w-5" />} tint="violet" label="Pedidos" value={num(m.orders.created_in_range)} sub={money(m.orders.amount_in_range)} subTone="green" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr_1.15fr] [&>*]:min-w-0">
            <Card title="Valor cotizado vs. aceptado">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={m.monthly.map((x) => ({ ...x, label: MONTHS[Number(x.month.slice(5)) - 1] }))} margin={{ left: 0, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => `$${v >= 1000 ? `${num(v / 1000, 1)}k` : v}`} />
                    <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: '#f1f5f9' }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} />
                    <Bar dataKey="quoted" name="Valor cotizado" fill="#1d6fe8" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="accepted" name="Aceptado (ventas)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Por estado">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Cotizaciones · en el periodo</p>
              <StatusDonut items={quoteDonut} empty="Sin cotizaciones en el periodo." testId="donut-cotizaciones" />
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pedidos · estado actual</p>
                {orders.isLoading ? <Spinner /> : <StatusDonut items={orderDonut} empty="Todavía no hay pedidos." testId="donut-pedidos" />}
              </div>
            </Card>

            <Card title="Actividad reciente">
              {activity.isLoading ? (
                <Spinner />
              ) : !activity.data?.length ? (
                <p className="py-16 text-center text-sm text-slate-500">Todavía no hay actividad.</p>
              ) : (
                <ul className="-my-1 divide-y divide-slate-100">
                  {activity.data.map((a) => (
                    <li key={a.key}>
                      <Link to={a.to} className="flex items-start gap-3 py-2.5 hover:opacity-80">
                        <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT[a.tint])}>{a.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{a.title}</span>
                          <span className="block truncate text-xs text-slate-500">{a.sub}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">{ago(a.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title="Requiere atención">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['/agenda', m.tasks.overdue, 'Tareas atrasadas', <ClipboardList key="1" className="h-4 w-4" />],
                  ['/cotizaciones?seguimiento=atrasado', m.quotes.followups_late, 'Seguimientos atrasados', <Clock key="2" className="h-4 w-4" />],
                  ['/cotizaciones?seguimiento=atrasado', m.quotes.validity_expired_open, 'Vigencias vencidas abiertas', <AlertTriangle key="3" className="h-4 w-4" />],
                  ['/pedidos?pendiente=compra', m.orders.pending_purchase, 'Pedidos por comprar', <ShoppingCart key="4" className="h-4 w-4" />],
                  ['/pedidos?pendiente=recepcion', m.orders.pending_reception, 'Compras por recibir', <PackageSearch key="5" className="h-4 w-4" />],
                  ['/pedidos?pendiente=entrega', m.orders.pending_delivery, 'Pendientes de entrega', <Truck key="6" className="h-4 w-4" />],
                ].map(([to, count, label, icon]) => (
                  <Link key={label as string} to={to as string} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:border-slate-200 hover:bg-slate-50">
                    <span className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="text-slate-400">{icon}</span>
                      {label}
                    </span>
                    <span className={clsx('min-w-[1.75rem] rounded-full px-2 py-0.5 text-center text-sm font-semibold', Number(count) > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500')}>{count as number}</span>
                  </Link>
                ))}
              </div>
              {m.tasks.due_today > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{m.tasks.due_today} tarea(s) vencen hoy</p>}
            </Card>

            <Card title="Tiempos promedio de atención">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Solicitud → envío', m.times.request_to_sent_days, <Timer key="a" className="h-4 w-4" />],
                  ['Envío → aceptación', m.times.sent_to_accepted_days, <DollarSign key="b" className="h-4 w-4" />],
                  ['Aceptación → entrega', m.times.accepted_to_delivered_days, <Truck key="c" className="h-4 w-4" />],
                  ['Ciclo completo', m.times.request_to_delivered_days, <PackageSearch key="d" className="h-4 w-4" />],
                ].map(([label, value, icon]) => (
                  <div key={label as string} className="rounded-lg bg-slate-50 p-3">
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="text-brand-500">{icon}</span>
                      {label}
                    </p>
                    <p className="mt-1 text-xl font-bold text-navy-900">{value === null ? '—' : `${num(value as number, 1)} días`}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Periodo {from} a {to}. Conversión = aceptadas ÷ (aceptadas + rechazadas + vencidas). Montos con IVA.
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
