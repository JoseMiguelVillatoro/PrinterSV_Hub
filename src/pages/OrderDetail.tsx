import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, ChevronRight, PackageCheck, Plus, ShoppingCart, Truck, Wrench } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, DemoBadge, ErrorBox, Field, Input, Modal, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { PAYMENT_TERMS, PO_STATUS_TONE, PurchaseOrderDetailModal } from '@/components/PurchaseOrderModals';
import { profileName, useProfiles, useSettings, useSuppliers } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import {
  DELIVERY_LABEL,
  ORDER_STATUS_LABEL,
  PO_STATUS_LABEL,
  PREPARATION_LABEL,
  PURCHASE_LABEL,
  RECEPTION_LABEL,
  dateOnly,
  dateTime,
  money,
  num,
  stageTone,
} from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { OrderEvent, OrderItem, OrderView, ProductCost, PurchaseOrder, PurchaseOrderItem } from '@/lib/types';

type Stage = 'compra' | 'recepcion' | 'preparacion' | 'entrega' | 'estado';

const STAGE_TITLE: Record<string, string> = {
  creado: 'Pedido creado',
  compra: 'Compra',
  recepcion: 'Recepción',
  preparacion: 'Preparación',
  entrega: 'Entrega',
  estado: 'Estado del pedido',
};

const LABELS: Record<string, Record<string, string>> = {
  compra: PURCHASE_LABEL,
  recepcion: RECEPTION_LABEL,
  preparacion: PREPARATION_LABEL,
  entrega: DELIVERY_LABEL,
  estado: ORDER_STATUS_LABEL,
};

function StageCard({
  icon,
  title,
  value,
  label,
  date,
  disabled,
  options,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  label: string;
  date?: string | null;
  disabled?: boolean;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  const done = ['comprada', 'recibida', 'lista', 'entregada', 'no_aplica'].includes(value);
  return (
    <div className={clsx('rounded-xl border p-4', done ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white')}>
      <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <span className={clsx('rounded-lg p-1.5', done ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-50 text-brand-600')}>{done ? <Check className="h-4 w-4" /> : icon}</span>
        {title}
      </div>
      <div className="mt-3">
        <Badge tone={stageTone(value)}>{label}</Badge>
        {date && <p className="mt-1 text-xs text-slate-500">{dateTime(date)}</p>}
      </div>
      {!disabled && (
        <Select className="mt-3 h-9" value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">Actualizar…</option>
          {options
            .filter(([k]) => k !== value)
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();
  const [pending, setPending] = useState<{ stage: Stage; value: string } | null>(null);
  const [poModal, setPoModal] = useState(false);
  const [openPo, setOpenPo] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const [order, items, events, pos] = await Promise.all([
        unwrap(supabase.from('v_orders').select('*').eq('id', id!).single()),
        unwrap(supabase.from('order_items').select('*').eq('order_id', id!).order('position')),
        unwrap(supabase.from('order_events').select('*').eq('order_id', id!).order('created_at', { ascending: false })),
        auth.canSeeCosts ? unwrap(supabase.from('purchase_orders').select('*, suppliers(name)').eq('order_id', id!).order('created_at')) : Promise.resolve([]),
      ]);
      return { order: order as OrderView, items: items as OrderItem[], events: events as OrderEvent[], pos: pos as PurchaseOrder[] };
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['order'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['client'] });
  };

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? 'Pedido no encontrado'} />;
  const { order: o, items, events, pos } = data;
  const locked = !auth.canManageQuotes || o.status !== 'abierto';
  const opts = (m: Record<string, string>, exclude: string[] = []) => Object.entries(m).filter(([k]) => !exclude.includes(k));

  return (
    <>
      <button onClick={() => navigate('/pedidos')} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Pedidos
      </button>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-navy-900">{o.number}</h1>
            <Badge tone={stageTone(o.status)}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            <DemoBadge show={o.is_demo} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <Link to={`/clientes/${o.client_id}`} className="text-brand-600 hover:underline">
              {o.client_name}
            </Link>{' '}
            · Desde{' '}
            <Link to={`/cotizaciones/${o.quote_id}`} className="text-brand-600 hover:underline">
              {o.quote_number}
            </Link>{' '}
            · {money(o.total)}
          </p>
        </div>
        {auth.canManageQuotes && (
          <div className="flex gap-2">
            {o.status === 'abierto' && o.delivery_status === 'entregada' && (
              <Button onClick={() => setPending({ stage: 'estado', value: 'cerrado' })}>Cerrar pedido</Button>
            )}
            {o.status === 'abierto' && (
              <Button variant="secondary" onClick={() => setPending({ stage: 'estado', value: 'cancelado' })}>
                Cancelar
              </Button>
            )}
            {o.status !== 'abierto' && (
              <Button variant="secondary" onClick={() => setPending({ stage: 'estado', value: 'abierto' })}>
                Reabrir
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StageCard
          icon={<ShoppingCart className="h-4 w-4" />}
          title="1. Compra a proveedor"
          value={o.purchase_status}
          label={PURCHASE_LABEL[o.purchase_status]}
          date={o.purchased_at}
          disabled={locked || !o.requires_purchase}
          options={opts(PURCHASE_LABEL, ['no_aplica'])}
          onChange={(v) => setPending({ stage: 'compra', value: v })}
        />
        <StageCard
          icon={<PackageCheck className="h-4 w-4" />}
          title="2. Recepción"
          value={o.reception_status}
          label={RECEPTION_LABEL[o.reception_status]}
          date={o.received_at}
          disabled={locked || !o.requires_purchase}
          options={opts(RECEPTION_LABEL, ['no_aplica'])}
          onChange={(v) => setPending({ stage: 'recepcion', value: v })}
        />
        <StageCard
          icon={<Wrench className="h-4 w-4" />}
          title="3. Preparación"
          value={o.preparation_status}
          label={PREPARATION_LABEL[o.preparation_status]}
          date={o.prepared_at}
          disabled={locked}
          options={opts(PREPARATION_LABEL)}
          onChange={(v) => setPending({ stage: 'preparacion', value: v })}
        />
        <StageCard
          icon={<Truck className="h-4 w-4" />}
          title="4. Entrega"
          value={o.delivery_status}
          label={`${DELIVERY_LABEL[o.delivery_status]}${o.delivery_status === 'programada' && o.delivery_scheduled_for ? ` · ${dateOnly(o.delivery_scheduled_for)}` : ''}`}
          date={o.delivered_at}
          disabled={locked}
          options={opts(DELIVERY_LABEL)}
          onChange={(v) => setPending({ stage: 'entrega', value: v })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Líneas del pedido">
            <Table>
              <thead>
                <tr>
                  <Th>Descripción</Th>
                  <Th className="text-right">Cant.</Th>
                  <Th className="hidden text-right sm:table-cell">Precio</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id}>
                    <Td>
                      <p>{it.description}</p>
                      {it.sku && <p className="text-xs text-slate-500">{it.sku}</p>}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {num(it.quantity, 3)} {it.unit}
                    </Td>
                    <Td className="hidden text-right sm:table-cell">{money(it.unit_price)}</Td>
                    <Td className="text-right font-medium">{money(it.line_total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Monto sin IVA (incl. cargos)</dt>
                <dd>{money(o.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">IVA</dt>
                <dd>{money(o.tax_total)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-navy-900">
                <dt>Total</dt>
                <dd>{money(o.total)}</dd>
              </div>
            </dl>
          </Card>

          {auth.canSeeCosts && o.requires_purchase && (
            <Card
              title="Órdenes de compra a proveedores"
              actions={
                o.status === 'abierto' && (
                  <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setPoModal(true)}>
                    Nueva OC
                  </Button>
                )
              }
            >
              {pos.length === 0 ? (
                <p className="text-sm text-slate-500">Sin órdenes de compra registradas.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pos.map((po) => (
                    <li key={po.id}>
                      <button
                        type="button"
                        onClick={() => setOpenPo(po.id)}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {po.number} · {po.suppliers?.name}
                            <Badge tone={PO_STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>
                          </p>
                          <p className="text-xs text-slate-500">
                            Total {money(po.grand_total ?? po.total_cost)} · Pedida {dateOnly(po.ordered_at)} · Esperada {dateOnly(po.expected_at)}
                            {po.received_at && ` · Recibida ${dateOnly(po.received_at)}`}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Abrí una OC para descargar el PDF, enviarla al proveedor o registrar lo recibido. Las etapas de arriba (compra / recepción del pedido) se actualizan aparte para que quede registrado quién y cuándo.
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Datos de entrega">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Entrega estimada</dt>
                <dd>{dateOnly(o.expected_delivery_date)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Recibido por</dt>
                <dd>{o.received_by ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Requiere compra</dt>
                <dd>{o.requires_purchase ? 'Sí' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Notas</dt>
                <dd>{o.notes ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Responsable</dt>
                <dd>{o.owner_name ?? '—'}</dd>
              </div>
            </dl>
            {auth.canManageQuotes && <OrderInfoEditor order={o} onDone={invalidate} />}
          </Card>

          <Card title="Trazabilidad">
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent-500 ring-4 ring-white" />
                  <p className="text-sm">
                    <b>{STAGE_TITLE[e.stage] ?? e.stage}</b>
                    {e.to_value && e.stage !== 'creado' && (
                      <>
                        : {e.from_value ? `${LABELS[e.stage]?.[e.from_value] ?? e.from_value} → ` : ''}
                        {LABELS[e.stage]?.[e.to_value] ?? e.to_value}
                      </>
                    )}
                  </p>
                  {e.comment && <p className="text-sm text-slate-600">{e.comment}</p>}
                  <p className="text-xs text-slate-400">
                    {dateTime(e.created_at)} · {profileName(profiles, e.created_by)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <StageModal pending={pending} order={o} onClose={() => setPending(null)} onDone={invalidate} />
      {auth.canSeeCosts && (
        <PurchaseOrderModal
          open={poModal}
          onClose={() => setPoModal(false)}
          orderId={o.id}
          items={items}
          onDone={(id) => {
            invalidate();
            setOpenPo(id);
          }}
        />
      )}
      {auth.canSeeCosts && <PurchaseOrderDetailModal poId={openPo} orderNumber={o.number} onClose={() => setOpenPo(null)} onChanged={invalidate} />}
    </>
  );
}

function StageModal({ pending, order, onClose, onDone }: { pending: { stage: Stage; value: string } | null; order: OrderView; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [date, setDate] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  useEffect(() => {
    setComment('');
    setDate(order.delivery_scheduled_for ?? order.expected_delivery_date ?? '');
    setReceivedBy('');
  }, [pending, order]);
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        supabase.rpc('update_order_stage', {
          p_order_id: order.id,
          p_stage: pending!.stage,
          p_value: pending!.value,
          p_comment: comment || null,
          p_date: date || null,
          p_received_by: receivedBy || null,
        }),
      ),
    onSuccess: () => {
      toast.success('Pedido actualizado');
      onDone();
      onClose();
    },
    onError: toast.error,
  });
  if (!pending) return null;
  const label = LABELS[pending.stage]?.[pending.value] ?? pending.value;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${STAGE_TITLE[pending.stage]}: ${label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pending.stage === 'entrega' && pending.value === 'programada' && (
          <Field label="Fecha programada">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {pending.stage === 'entrega' && pending.value === 'entregada' && (
          <Field label="Recibido por (nombre de quien recibe)">
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
          </Field>
        )}
        <Field label="Comentario (queda en la trazabilidad)">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function OrderInfoEditor({ order, onDone }: { order: OrderView; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ expected_delivery_date: '', delivery_address: '', notes: '' });
  useEffect(() => {
    setForm({ expected_delivery_date: order.expected_delivery_date ?? '', delivery_address: order.delivery_address ?? '', notes: order.notes ?? '' });
  }, [order, open]);
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        supabase
          .from('orders')
          .update({ expected_delivery_date: form.expected_delivery_date || null, delivery_address: form.delivery_address || null, notes: form.notes || null })
          .eq('id', order.id),
      ),
    onSuccess: () => {
      toast.success('Datos actualizados');
      onDone();
      setOpen(false);
    },
    onError: toast.error,
  });
  return (
    <>
      <Button size="sm" variant="ghost" className="mt-3" onClick={() => setOpen(true)}>
        Editar datos de entrega
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Datos de entrega"
        footer={
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Guardar
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Entrega estimada">
            <Input type="date" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} />
          </Field>
          <Field label="Dirección de entrega">
            <Input value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} />
          </Field>
          <Field label="Notas">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

function PurchaseOrderModal({ open, onClose, orderId, items, onDone }: { open: boolean; onClose: () => void; orderId: string; items: OrderItem[]; onDone: (poId: string) => void }) {
  const toast = useToast();
  const { data: suppliers } = useSuppliers();
  const costs = useQuery({ queryKey: ['product_costs'], queryFn: () => unwrap(supabase.from('product_costs').select('*')) as Promise<ProductCost[]> });
  const [supplier, setSupplier] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const { data: settings } = useSettings();
  const [terms, setTerms] = useState('Contado');
  const [taxRate, setTaxRate] = useState(13);
  const [delivery, setDelivery] = useState('');
  useEffect(() => {
    if (!open) return;
    setTaxRate(Number(settings?.default_tax_rate ?? 13));
    setDelivery(settings?.address ?? '');
  }, [open, settings]);
  const [lines, setLines] = useState<(Pick<PurchaseOrderItem, 'description' | 'quantity' | 'unit_cost'> & { order_item_id: string; include: boolean })[]>([]);

  useEffect(() => {
    if (!open) return;
    const productOf = new Map<string, string | null>();
    void supabase
      .from('order_items')
      .select('id, product_id')
      .eq('order_id', orderId)
      .then(({ data }) => {
        for (const r of data ?? []) productOf.set(r.id as string, r.product_id as string | null);
        const cm = new Map((costs.data ?? []).map((c) => [c.product_id, c]));
        setLines(
          items.map((it) => {
            const pid = productOf.get(it.id);
            const c = pid ? cm.get(pid) : undefined;
            if (c?.supplier_id) setSupplier((s) => s || c.supplier_id!);
            return { order_item_id: it.id, description: it.description, quantity: Number(it.quantity), unit_cost: c ? Number(c.unit_cost) : 0, include: true };
          }),
        );
      });
  }, [open, items, orderId, costs.data]);

  const m = useMutation({
    mutationFn: async () => {
      if (!supplier) throw new Error('Elegí un proveedor.');
      const chosen = lines.filter((l) => l.include);
      if (!chosen.length) throw new Error('Incluí al menos una línea.');
      const po = (await unwrap(
        supabase
          .from('purchase_orders')
          .insert({
            number: '',
            order_id: orderId,
            supplier_id: supplier,
            expected_at: expected || null,
            notes: notes || null,
            payment_terms: terms.trim() || null,
            tax_rate: taxRate,
            delivery_address: delivery.trim() || null,
          })
          .select('id')
          .single(),
      )) as { id: string };
      await unwrap(
        supabase.from('purchase_order_items').insert(
          chosen.map((l) => ({ purchase_order_id: po.id, order_item_id: l.order_item_id, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost })),
        ),
      );
      return po.id;
    },
    onSuccess: (id) => {
      toast.success('Orden de compra creada (borrador)');
      onClose();
      onDone(id);
    },
    onError: toast.error,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Nueva orden de compra"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Crear OC
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required>
            <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Seleccionar…</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha esperada">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Condiciones de pago">
            <Input list="po-terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
            <datalist id="po-terms">
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="IVA (%)" hint="Poné 0 si el proveedor no cobra IVA.">
            <Input type="number" min={0} max={100} step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
          </Field>
          <Field label="Dirección de entrega" className="sm:col-span-2">
            <Input value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="Dirección de Printer o del cliente" />
          </Field>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.order_item_id} className="grid items-center gap-2 sm:grid-cols-[auto_1fr_90px_110px]">
              <input type="checkbox" checked={l.include} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} />
              <span className="text-sm">{l.description}</span>
              <Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <Input type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: Number(e.target.value) } : x)))} />
            </div>
          ))}
          {(() => {
            const sub = lines.filter((l) => l.include).reduce((a, l) => a + Math.round(l.quantity * l.unit_cost * 100) / 100, 0);
            const iva = Math.round(sub * taxRate) / 100;
            return (
              <p className="text-right text-sm">
                Subtotal {money(sub)} · IVA {money(iva)} · <b>Total {money(sub + iva)}</b>
              </p>
            );
          })()}
        </div>
        <Field label="Notas">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
