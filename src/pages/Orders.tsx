import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { downloadCSV } from '@/lib/csv';
import {
  DELIVERY_LABEL,
  ORDER_STATUS_LABEL,
  PREPARATION_LABEL,
  PURCHASE_LABEL,
  RECEPTION_LABEL,
  dateOnly,
  money,
  stageTone,
  todayISO,
} from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { OrderView } from '@/lib/types';

type Filter = '' | 'compra' | 'recepcion' | 'preparacion' | 'entrega' | 'cerrados';

export function OrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('pendiente') ?? '') as Filter;
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', 'list'],
    queryFn: () => unwrap(supabase.from('v_orders').select('*').order('created_at', { ascending: false })) as Promise<OrderView[]>,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter((o) => {
      const open = o.status === 'abierto';
      const okFilter =
        filter === ''
          ? open
          : filter === 'cerrados'
            ? !open
            : filter === 'compra'
              ? open && o.requires_purchase && ['pendiente', 'solicitada'].includes(o.purchase_status)
              : filter === 'recepcion'
                ? open && o.requires_purchase && o.purchase_status === 'comprada' && o.reception_status !== 'recibida'
                : filter === 'preparacion'
                  ? open && o.preparation_status !== 'lista'
                  : open && o.delivery_status !== 'entregada';
      return okFilter && (!s || [o.number, o.client_name, o.quote_number].some((v) => v?.toLowerCase().includes(s)));
    });
  }, [data, filter, search]);

  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f) p.set('pendiente', f);
    else p.delete('pendiente');
    setParams(p, { replace: true });
  };

  const late = (o: OrderView) => o.status === 'abierto' && o.delivery_status !== 'entregada' && o.expected_delivery_date && o.expected_delivery_date < todayISO();

  return (
    <>
      <PageHeader
        title="Pedidos, compras y entregas"
        subtitle="Cada etapa se controla por separado"
        actions={
          <Button
            variant="secondary"
            icon={<Download className="h-4 w-4" />}
            disabled={!rows.length}
            onClick={() =>
              downloadCSV(
                `pedidos-${todayISO()}.csv`,
                ['Pedido', 'Cotización', 'Cliente', 'Estado', 'Compra', 'Recepción', 'Preparación', 'Entrega', 'Entrega estimada', 'Entregado', 'Total', 'Demo'],
                rows.map((o) => [
                  o.number,
                  o.quote_number,
                  o.client_name,
                  ORDER_STATUS_LABEL[o.status],
                  PURCHASE_LABEL[o.purchase_status],
                  RECEPTION_LABEL[o.reception_status],
                  PREPARATION_LABEL[o.preparation_status],
                  DELIVERY_LABEL[o.delivery_status],
                  o.expected_delivery_date,
                  o.delivered_at?.slice(0, 10),
                  o.total,
                  o.is_demo ? 'sí' : 'no',
                ]),
              )
            }
          >
            CSV
          </Button>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Pedido, cliente, cotización…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="">Abiertos</option>
            <option value="compra">Pendientes de compra</option>
            <option value="recepcion">Pendientes de recepción</option>
            <option value="preparacion">Pendientes de preparación</option>
            <option value="entrega">Pendientes de entrega</option>
            <option value="cerrados">Cerrados / cancelados</option>
          </Select>
        </div>
        <ErrorBox error={error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No hay pedidos con ese filtro" description="Los pedidos se crean desde una cotización aceptada." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th className="hidden md:table-cell">Cliente</Th>
                <Th>Compra</Th>
                <Th className="hidden sm:table-cell">Recepción</Th>
                <Th className="hidden sm:table-cell">Preparación</Th>
                <Th>Entrega</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/pedidos/${o.id}`)}>
                  <Td>
                    <Link to={`/pedidos/${o.id}`} className="font-medium text-navy-900 hover:text-brand-600">
                      {o.number}
                    </Link>{' '}
                    <DemoBadge show={o.is_demo} />
                    <p className="text-xs text-slate-500">
                      {o.quote_number}
                      <span className="md:hidden"> · {o.client_name}</span>
                    </p>
                  </Td>
                  <Td className="hidden md:table-cell">{o.client_name}</Td>
                  <Td>
                    <Badge tone={stageTone(o.purchase_status)}>{PURCHASE_LABEL[o.purchase_status]}</Badge>
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <Badge tone={stageTone(o.reception_status)}>{RECEPTION_LABEL[o.reception_status]}</Badge>
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <Badge tone={stageTone(o.preparation_status)}>{PREPARATION_LABEL[o.preparation_status]}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={late(o) ? 'red' : stageTone(o.delivery_status)}>{DELIVERY_LABEL[o.delivery_status]}</Badge>
                    {o.expected_delivery_date && o.delivery_status !== 'entregada' && (
                      <p className={`mt-1 text-xs ${late(o) ? 'font-medium text-red-600' : 'text-slate-500'}`}>Est. {dateOnly(o.expected_delivery_date)}</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-medium">{money(o.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
