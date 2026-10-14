import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useClientOptions, useProducts } from '@/hooks/data';
import { useAuth } from '@/lib/auth';
import { downloadCSV } from '@/lib/csv';
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, addDaysISO, dateOnly, money, num, todayISO } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { QuoteStatus, QuoteView } from '@/lib/types';

type Tab = 'precios' | 'equipo' | 'rechazos' | 'margenes';

interface PriceRow {
  quote_item_id: string;
  product_id: string | null;
  sku: string | null;
  product_name: string;
  is_custom: boolean;
  quote_id: string;
  quote_number: string;
  quote_status: QuoteStatus;
  issue_date: string;
  client_id: string;
  client_name: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  effective_unit_price: number;
}

interface MarginRow {
  quote_id: string;
  number: string;
  status: QuoteStatus;
  issue_date: string;
  client_name: string;
  revenue: number;
  cost: number | null;
  margin: number | null;
  margin_pct: number | null;
  lines_without_cost: number;
}

export function ReportsPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('precios');
  const [from, setFrom] = useState(addDaysISO(todayISO(), -180));
  const [to, setTo] = useState(todayISO());
  const tabs: [Tab, string][] = [
    ['precios', 'Historial de precios'],
    ['equipo', 'Por responsable'],
    ['rechazos', 'Rechazos'],
    ...(auth.canSeeCosts ? ([['margenes', 'Márgenes']] as [Tab, string][]) : []),
  ];
  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Filtrables y exportables a CSV"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-400">—</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
      />
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map(([k, v]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx('shrink-0 rounded-lg px-4 py-2 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
          >
            {v}
          </button>
        ))}
      </div>
      {tab === 'precios' && <PriceHistory from={from} to={to} />}
      {tab === 'equipo' && <ByOwner from={from} to={to} />}
      {tab === 'rechazos' && <Rejections from={from} to={to} />}
      {tab === 'margenes' && auth.canSeeCosts && <Margins from={from} to={to} />}
    </>
  );
}

function PriceHistory({ from, to }: { from: string; to: string }) {
  const { data: products } = useProducts();
  const { data: clients } = useClientOptions();
  const [product, setProduct] = useState('');
  const [client, setClient] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['report', 'prices', from, to, product, client],
    queryFn: () => {
      let q = supabase.from('v_price_history').select('*').gte('issue_date', from).lte('issue_date', to).order('issue_date', { ascending: false }).limit(1000);
      if (product === '__custom') q = q.is('product_id', null);
      else if (product) q = q.eq('product_id', product);
      if (client) q = q.eq('client_id', client);
      return unwrap(q) as Promise<PriceRow[]>;
    },
  });
  return (
    <Card
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          disabled={!data?.length}
          onClick={() =>
            downloadCSV(
              `historial-precios-${from}-${to}.csv`,
              ['Fecha', 'Cotización', 'Estado', 'Cliente', 'SKU', 'Producto/servicio', 'Personalizada', 'Cantidad', 'Precio unit.', 'Desc. %', 'Precio efectivo'],
              (data ?? []).map((r) => [r.issue_date, r.quote_number, QUOTE_STATUS_LABEL[r.quote_status], r.client_name, r.sku, r.product_name, r.is_custom ? 'sí' : 'no', r.quantity, r.unit_price, r.discount_pct, r.effective_unit_price]),
            )
          }
        >
          CSV
        </Button>
      }
      title="Precios cotizados por producto, cliente y fecha"
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">Todos los productos/servicios</option>
          <option value="__custom">Solo líneas personalizadas</option>
          {products?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </Select>
        <Select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState title="Sin datos en el periodo" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Producto / servicio</Th>
              <Th className="hidden md:table-cell">Cliente</Th>
              <Th className="hidden sm:table-cell">Cotización</Th>
              <Th className="text-right">Cant.</Th>
              <Th className="text-right">Precio efectivo</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((r) => (
              <tr key={r.quote_item_id}>
                <Td className="whitespace-nowrap">{dateOnly(r.issue_date)}</Td>
                <Td>
                  {r.product_name}
                  <p className="text-xs text-slate-500">{r.is_custom ? 'Personalizada' : r.sku}</p>
                </Td>
                <Td className="hidden md:table-cell">{r.client_name}</Td>
                <Td className="hidden sm:table-cell">
                  <Link to={`/cotizaciones/${r.quote_id}`} className="text-brand-600 hover:underline">
                    {r.quote_number}
                  </Link>{' '}
                  <Badge tone={QUOTE_STATUS_TONE[r.quote_status]}>{QUOTE_STATUS_LABEL[r.quote_status]}</Badge>
                </Td>
                <Td className="text-right">{num(r.quantity, 3)}</Td>
                <Td className="whitespace-nowrap text-right font-medium">
                  {money(r.effective_unit_price)}
                  {Number(r.discount_pct) > 0 && <p className="text-xs font-normal text-slate-500">lista {money(r.unit_price)} − {num(r.discount_pct, 2)} %</p>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function useQuotesInRange(from: string, to: string) {
  return useQuery({
    queryKey: ['report', 'quotes', from, to],
    queryFn: () => unwrap(supabase.from('v_quotes').select('*').gte('issue_date', from).lte('issue_date', to)) as Promise<QuoteView[]>,
  });
}

function ByOwner({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuotesInRange(from, to);
  const rows = useMemo(() => {
    const m = new Map<string, { owner: string; count: number; quoted: number; accepted: number; acceptedN: number; decided: number }>();
    for (const q of data ?? []) {
      if (['borrador', 'cancelada'].includes(q.status)) continue;
      const k = q.owner_name ?? 'Sin asignar';
      const r = m.get(k) ?? { owner: k, count: 0, quoted: 0, accepted: 0, acceptedN: 0, decided: 0 };
      r.count++;
      r.quoted += Number(q.total);
      if (q.status === 'aceptada') {
        r.accepted += Number(q.total);
        r.acceptedN++;
      }
      if (['aceptada', 'rechazada', 'vencida'].includes(q.status)) r.decided++;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.quoted - a.quoted);
  }, [data]);
  return (
    <Card
      title="Cotizaciones por responsable (excluye borradores y canceladas)"
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          disabled={!rows.length}
          onClick={() =>
            downloadCSV(
              `por-responsable-${from}-${to}.csv`,
              ['Responsable', 'Cotizaciones', 'Monto cotizado', 'Aceptadas', 'Monto aceptado', 'Conversión %'],
              rows.map((r) => [r.owner, r.count, r.quoted.toFixed(2), r.acceptedN, r.accepted.toFixed(2), r.decided ? ((r.acceptedN / r.decided) * 100).toFixed(1) : '']),
            )
          }
        >
          CSV
        </Button>
      }
    >
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState title="Sin datos en el periodo" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Responsable</Th>
              <Th className="text-right">Cotizaciones</Th>
              <Th className="text-right">Cotizado</Th>
              <Th className="text-right">Aceptado</Th>
              <Th className="text-right">Conversión</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.owner}>
                <Td className="font-medium">{r.owner}</Td>
                <Td className="text-right">{r.count}</Td>
                <Td className="text-right">{money(r.quoted)}</Td>
                <Td className="text-right">{money(r.accepted)}</Td>
                <Td className="text-right">{r.decided ? `${num((r.acceptedN / r.decided) * 100, 1)} %` : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Rejections({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuotesInRange(from, to);
  const rows = (data ?? []).filter((q) => q.status === 'rechazada' || q.status === 'vencida');
  return (
    <Card
      title="Cotizaciones rechazadas y vencidas"
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          disabled={!rows.length}
          onClick={() =>
            downloadCSV(
              `rechazos-${from}-${to}.csv`,
              ['Cotización', 'Fecha', 'Cliente', 'Estado', 'Total', 'Motivo'],
              rows.map((q) => [q.number, q.issue_date, q.client_name, QUOTE_STATUS_LABEL[q.status], q.total, q.rejection_reason]),
            )
          }
        >
          CSV
        </Button>
      }
    >
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState title="Sin rechazos en el periodo" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Link to={`/cotizaciones/${q.id}`} className="text-sm font-medium text-navy-900 hover:text-brand-600">
                  {q.number} · {q.client_name}
                </Link>
                <p className="text-sm text-slate-600">{q.rejection_reason ?? (q.status === 'vencida' ? 'Venció sin respuesta' : 'Sin motivo registrado')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">{money(q.total)}</span>
                <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Margins({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['report', 'margins', from, to],
    queryFn: () => unwrap(supabase.from('v_quote_margins').select('*').gte('issue_date', from).lte('issue_date', to).order('issue_date', { ascending: false })) as Promise<MarginRow[]>,
  });
  const acc = (data ?? []).filter((r) => r.status === 'aceptada');
  const accRevenue = acc.reduce((a, r) => a + Number(r.revenue), 0);
  const accMargin = acc.reduce((a, r) => a + Number(r.margin ?? 0), 0);
  return (
    <Card
      title="Rentabilidad por cotización (restringido)"
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          disabled={!data?.length}
          onClick={() =>
            downloadCSV(
              `margenes-${from}-${to}.csv`,
              ['Cotización', 'Fecha', 'Cliente', 'Estado', 'Venta neta', 'Costo', 'Margen', 'Margen %', 'Líneas sin costo'],
              (data ?? []).map((r) => [r.number, r.issue_date, r.client_name, QUOTE_STATUS_LABEL[r.status], r.revenue, r.cost, r.margin, r.margin_pct, r.lines_without_cost]),
            )
          }
        >
          CSV
        </Button>
      }
    >
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Aceptadas en el periodo: venta neta {money(accRevenue)} · margen {money(accMargin)} ({accRevenue ? num((accMargin / accRevenue) * 100, 1) : '—'} %)
      </p>
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState title="Sin datos" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cotización</Th>
              <Th className="hidden sm:table-cell">Cliente</Th>
              <Th className="text-right">Venta neta</Th>
              <Th className="text-right">Costo</Th>
              <Th className="text-right">Margen</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((r) => (
              <tr key={r.quote_id}>
                <Td>
                  <Link to={`/cotizaciones/${r.quote_id}`} className="text-brand-600 hover:underline">
                    {r.number}
                  </Link>{' '}
                  <Badge tone={QUOTE_STATUS_TONE[r.status]}>{QUOTE_STATUS_LABEL[r.status]}</Badge>
                  {r.lines_without_cost > 0 && <p className="text-xs text-amber-700">{r.lines_without_cost} línea(s) sin costo</p>}
                </Td>
                <Td className="hidden sm:table-cell">{r.client_name}</Td>
                <Td className="text-right">{money(r.revenue)}</Td>
                <Td className="text-right">{money(r.cost)}</Td>
                <Td className={`text-right font-medium ${Number(r.margin_pct) < 10 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {money(r.margin)} <span className="text-xs">({num(r.margin_pct, 1)} %)</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
