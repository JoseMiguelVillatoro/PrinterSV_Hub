import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, ClipboardList, DollarSign, FileText, Gauge, PackageSearch, Timer, Truck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Checkbox, ErrorBox, Input, Kpi, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { QUOTE_STATUS_LABEL, addDaysISO, money, num, todayISO } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { DashboardMetrics, QuoteStatus } from '@/lib/types';

const STATUS_COLOR: Record<QuoteStatus, string> = {
  borrador: '#94a3b8',
  pendiente_envio: '#8b5cf6',
  enviada: '#1d6fe8',
  negociacion: '#f59e0b',
  aceptada: '#10b981',
  rechazada: '#ef4444',
  vencida: '#f87171',
  cancelada: '#cbd5e1',
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function days(v: number | null) {
  return v === null || v === undefined ? '—' : `${num(v, 1)} d`;
}

function AttentionItem({ to, count, label }: { to: string; count: number; label: string }) {
  return (
    <Link to={to} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50">
      <span className="text-sm text-slate-700">{label}</span>
      <span className={`min-w-[2rem] rounded-full px-2 py-0.5 text-center text-sm font-semibold ${count > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
    </Link>
  );
}

export function DashboardPage() {
  const { profile } = useAuth();
  const today = todayISO();
  const [from, setFrom] = useState(addDaysISO(today, -29));
  const [to, setTo] = useState(today);
  const [includeDemo, setIncludeDemo] = useState(true);

  const { data: m, isLoading, error } = useQuery({
    queryKey: ['dashboard', from, to, includeDemo],
    queryFn: () => unwrap(supabase.rpc('dashboard_metrics', { p_from: from, p_to: to, p_include_demo: includeDemo })) as Promise<DashboardMetrics>,
  });

  return (
    <>
      <PageHeader
        title={`Hola${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        subtitle="Indicadores calculados en vivo desde la base de datos"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400">—</span>
            <Input type="date" className="w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            <Checkbox label="Incluir demo" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
          </div>
        }
      />
      <ErrorBox error={error} />
      {isLoading || !m ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Clientes" value={num(m.clients.total)} hint={`${m.clients.prospects} prospectos · ${m.clients.new_in_range} nuevos en el periodo`} icon={<Users className="h-4 w-4" />} />
            <Kpi label="Visitas realizadas" value={num(m.visits.done_in_range)} hint={`${m.visits.upcoming_7d} programadas próximos 7 días`} tone="cyan" icon={<CalendarCheck className="h-4 w-4" />} />
            <Kpi
              label="Monto cotizado"
              value={money(m.quotes.amount_in_range)}
              hint={`${m.quotes.count_in_range} cotizaciones emitidas en el periodo`}
              tone="violet"
              icon={<FileText className="h-4 w-4" />}
            />
            <Kpi
              label="Conversión"
              value={m.quotes.conversion_rate === null ? '—' : `${num(m.quotes.conversion_rate, 1)} %`}
              hint={`${money(m.quotes.accepted_amount_in_range)} aceptado · ${m.quotes.decided_count} decididas`}
              tone="green"
              icon={<Gauge className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Cotizaciones por estado (periodo)" className="lg:col-span-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={m.quotes.by_status.map((s) => ({ ...s, label: QUOTE_STATUS_LABEL[s.status] }))} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v, _n, p) => [`${String(v)} · ${money((p as { payload: { amount: number } }).payload.amount)}`, 'Cotizaciones']} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} shape={(props: unknown) => {
                      const p = props as { x: number; y: number; width: number; height: number; payload: { status: QuoteStatus } };
                      return <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={4} fill={STATUS_COLOR[p.payload.status]} />;
                    }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>
                  Pipeline abierto: <b className="text-navy-900">{money(m.quotes.open_pipeline)}</b>
                </span>
              </div>
            </Card>

            <Card title="Requiere atención">
              <div className="-mx-3 space-y-0.5">
                <AttentionItem to="/agenda" count={m.tasks.overdue} label="Tareas atrasadas" />
                <AttentionItem to="/cotizaciones?seguimiento=atrasado" count={m.quotes.followups_late} label="Seguimientos de cotización atrasados" />
                <AttentionItem to="/cotizaciones?seguimiento=atrasado" count={m.quotes.validity_expired_open} label="Cotizaciones abiertas con vigencia vencida" />
                <AttentionItem to="/pedidos?pendiente=compra" count={m.orders.pending_purchase} label="Pedidos por comprar" />
                <AttentionItem to="/pedidos?pendiente=recepcion" count={m.orders.pending_reception} label="Compras por recibir" />
                <AttentionItem to="/pedidos?pendiente=entrega" count={m.orders.pending_delivery} label="Pedidos pendientes de entrega" />
              </div>
              {m.tasks.due_today > 0 && (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4" /> {m.tasks.due_today} tarea(s) vencen hoy
                </p>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Monto cotizado vs aceptado (6 meses)" className="lg:col-span-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={m.monthly.map((x) => ({ ...x, label: `${MONTHS[Number(x.month.slice(5)) - 1]} ${x.month.slice(2, 4)}` }))}
                    margin={{ left: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${num(v / 1000, 1)}k`} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="quoted" name="Cotizado" fill="#1d6fe8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="accepted" name="Aceptado" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Tiempos promedio">
              <dl className="space-y-4">
                {[
                  ['Solicitud → envío de cotización', m.times.request_to_sent_days, <Timer key="a" className="h-4 w-4" />],
                  ['Envío → aceptación', m.times.sent_to_accepted_days, <DollarSign key="b" className="h-4 w-4" />],
                  ['Aceptación → entrega', m.times.accepted_to_delivered_days, <Truck key="c" className="h-4 w-4" />],
                  ['Solicitud → entrega (ciclo total)', m.times.request_to_delivered_days, <PackageSearch key="d" className="h-4 w-4" />],
                ].map(([label, value, icon]) => (
                  <div key={label as string} className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="rounded-md bg-brand-50 p-1 text-brand-600">{icon}</span>
                      {label}
                    </dt>
                    <dd className="text-lg font-semibold text-navy-900">{days(value as number | null)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
                <div>
                  <p className="text-lg font-semibold text-navy-900">{m.orders.open}</p>
                  <p className="text-xs text-slate-500">Pedidos abiertos</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-navy-900">{m.orders.pending_preparation}</p>
                  <p className="text-xs text-slate-500">En preparación</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-navy-900">{m.orders.delivered_in_range}</p>
                  <p className="text-xs text-slate-500">Entregados (periodo)</p>
                </div>
              </div>
            </Card>
          </div>

          <p className="flex items-center gap-2 text-xs text-slate-400">
            <ClipboardList className="h-3.5 w-3.5" />
            Periodo {from} a {to}. "Monto cotizado" excluye borradores y canceladas. Conversión = aceptadas ÷ (aceptadas + rechazadas + vencidas).
          </p>
        </div>
      )}
    </>
  );
}
