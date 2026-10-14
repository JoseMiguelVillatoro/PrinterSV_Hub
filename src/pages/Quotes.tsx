import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Download, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, DemoBadge, EmptyState, ErrorBox, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { downloadCSV } from '@/lib/csv';
import { QUOTE_STATUSES, QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, dateOnly, money, todayISO } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { QuoteStatus, QuoteView } from '@/lib/types';

export function QuotesPage() {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('estado') ?? '') as QuoteStatus | '';
  const [search, setSearch] = useState('');
  const [onlyLate, setOnlyLate] = useState(params.get('seguimiento') === 'atrasado');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['quotes', 'list'],
    queryFn: () => unwrap(supabase.from('v_quotes').select('*').order('issue_date', { ascending: false }).order('number', { ascending: false })) as Promise<QuoteView[]>,
  });

  const expire = useMutation({
    mutationFn: () => unwrap(supabase.rpc('expire_overdue_quotes')) as Promise<number>,
    onSuccess: (n) => {
      toast.success(n === 0 ? 'No hay cotizaciones vencidas por marcar' : `${n} cotización(es) marcadas como vencidas`);
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: toast.error,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter(
      (q) =>
        (!status || q.status === status) &&
        (!onlyLate || q.is_followup_late || q.is_overdue_validity) &&
        (!from || q.issue_date >= from) &&
        (!to || q.issue_date <= to) &&
        (!s || [q.number, q.client_name, q.title, q.contact_name].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [data, status, onlyLate, from, to, search]);

  const totals = useMemo(() => {
    const m = new Map<QuoteStatus, { n: number; amount: number }>();
    for (const q of data ?? []) {
      const cur = m.get(q.status) ?? { n: 0, amount: 0 };
      m.set(q.status, { n: cur.n + 1, amount: cur.amount + Number(q.total) });
    }
    return m;
  }, [data]);
  const expiredOpen = (data ?? []).filter((q) => q.is_overdue_validity).length;

  function exportCsv() {
    downloadCSV(
      `cotizaciones-${todayISO()}.csv`,
      ['Número', 'Fecha', 'Vigencia', 'Cliente', 'Contacto', 'Título', 'Estado', 'Subtotal', 'IVA', 'Total', 'Responsable', 'Próxima acción', 'Fecha próxima acción', 'Motivo de rechazo', 'Pedido', 'Demo'],
      rows.map((q) => [
        q.number,
        q.issue_date,
        q.valid_until,
        q.client_name,
        q.contact_name,
        q.title,
        QUOTE_STATUS_LABEL[q.status],
        q.subtotal,
        q.tax_total,
        q.total,
        q.owner_name,
        q.next_action,
        q.next_action_date,
        q.rejection_reason,
        q.order_number,
        q.is_demo ? 'sí' : 'no',
      ]),
    );
  }

  function setStatus(s: QuoteStatus | '') {
    const p = new URLSearchParams(params);
    if (s) p.set('estado', s);
    else p.delete('estado');
    setParams(p, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Cotizaciones"
        subtitle="Seguimiento desde borrador hasta aceptación o rechazo"
        actions={
          <>
            {auth.canManageQuotes && expiredOpen > 0 && (
              <Button variant="secondary" icon={<AlarmClock className="h-4 w-4" />} loading={expire.isPending} onClick={() => expire.mutate()}>
                Marcar {expiredOpen} vencida(s)
              </Button>
            )}
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
              CSV
            </Button>
            {auth.canManageQuotes && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/cotizaciones/nueva')}>
                Nueva cotización
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setStatus('')}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${!status ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-slate-600 ring-slate-200'}`}
        >
          Todas · {data?.length ?? 0}
        </button>
        {QUOTE_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${status === s ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-slate-600 ring-slate-200'}`}
          >
            {QUOTE_STATUS_LABEL[s]} · {totals.get(s)?.n ?? 0}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_150px_150px_auto] sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Número, cliente, título…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Desde" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Hasta" />
          <Checkbox label="Requieren seguimiento" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} />
        </div>
        <ErrorBox error={error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No hay cotizaciones con esos filtros" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Número</Th>
                <Th>Cliente</Th>
                <Th className="hidden md:table-cell">Fecha</Th>
                <Th className="hidden 2xl:table-cell">Próxima acción</Th>
                <Th className="hidden xl:table-cell">Responsable</Th>
                <Th>Estado</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((q) => (
                <tr key={q.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/cotizaciones/${q.id}`)}>
                  <Td>
                    <Link to={`/cotizaciones/${q.id}`} className="font-medium text-navy-900 hover:text-brand-600">
                      {q.number}
                    </Link>{' '}
                    <DemoBadge show={q.is_demo} />
                    <p className="max-w-[220px] truncate text-xs text-slate-500">{q.title}</p>
                  </Td>
                  <Td className="min-w-[170px]">
                    {q.client_name}
                    {q.is_followup_late && <p className="text-xs font-medium text-red-600 2xl:hidden">Seguimiento atrasado</p>}
                  </Td>
                  <Td className="hidden md:table-cell">
                    {dateOnly(q.issue_date)}
                    <p className={`text-xs ${q.is_overdue_validity ? 'font-medium text-red-600' : 'text-slate-500'}`}>Vence {dateOnly(q.valid_until)}</p>
                  </Td>
                  <Td className="hidden 2xl:table-cell">
                    {q.next_action ? (
                      <>
                        <p className="max-w-[220px] truncate text-sm">{q.next_action}</p>
                        <p className={`text-xs ${q.is_followup_late ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                          {q.is_followup_late ? 'Atrasada · ' : ''}
                          {dateOnly(q.next_action_date)}
                        </p>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="hidden min-w-[140px] xl:table-cell">{q.owner_name ?? '—'}</Td>
                  <Td>
                    <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                    {q.order_number && <p className="mt-1 text-xs text-slate-500">{q.order_number}</p>}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-medium">{money(q.total, q.currency)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={6} className="text-right text-xs font-medium uppercase text-slate-500">
                  Total filtrado
                </Td>
                <Td className="whitespace-nowrap text-right font-semibold text-navy-900">{money(rows.reduce((a, q) => a + Number(q.total), 0))}</Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
