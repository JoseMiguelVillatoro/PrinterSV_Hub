import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, PenLine, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PAYMENT_TERMS, PO_STATUS_TONE, PurchaseOrderDetailModal } from '@/components/PurchaseOrderModals';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useProducts, useSettings, useSuppliers } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { PO_STATUS_LABEL, dateOnly, money, todayISO } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { PoStatus, ProductCost, PurchaseOrder } from '@/lib/types';

type PoRow = PurchaseOrder & { suppliers: { name: string } | null; orders: { number: string } | null };
type Filter = 'abiertas' | 'recibidas' | 'canceladas' | 'todas';
const FILTERS: [Filter, string, PoStatus[] | null][] = [
  ['abiertas', 'Abiertas', ['borrador', 'enviada', 'recibida_parcial']],
  ['recibidas', 'Recibidas', ['recibida']],
  ['canceladas', 'Canceladas', ['cancelada']],
  ['todas', 'Todas', null],
];

/** Todas las órdenes de compra: las de un pedido y las generales (bodega, repuestos, insumos). */
export function PurchasesPage() {
  const qc = useQueryClient();
  const { data: suppliers } = useSuppliers();
  const [filter, setFilter] = useState<Filter>('abiertas');
  const [supplier, setSupplier] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<PoRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['purchase_orders', 'list'],
    queryFn: () =>
      unwrap(supabase.from('purchase_orders').select('*, suppliers(name), orders(number)').order('created_at', { ascending: false })) as Promise<PoRow[]>,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['purchase_orders'] });
    void qc.invalidateQueries({ queryKey: ['purchase_order'] });
    void qc.invalidateQueries({ queryKey: ['order'] });
  };

  const inFilter = (po: PoRow, f: Filter) => {
    const st = FILTERS.find((x) => x[0] === f)![2];
    return !st || st.includes(po.status);
  };
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter(
      (po) =>
        inFilter(po, filter) &&
        (!supplier || po.supplier_id === supplier) &&
        (!s || [po.number, po.suppliers?.name, po.orders?.number, po.notes].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [data, filter, supplier, search]);

  const pending = (data ?? []).filter((po) => po.status === 'enviada' || po.status === 'recibida_parcial');
  const pendingAmount = pending.reduce((a, po) => a + Number(po.grand_total ?? po.total_cost), 0);
  const late = (po: PoRow) => ['enviada', 'recibida_parcial'].includes(po.status) && po.expected_at && po.expected_at < todayISO();

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle={
          data
            ? `Órdenes de compra a proveedores · ${pending.length} por recibir (${money(pendingAmount)})`
            : 'Órdenes de compra a proveedores'
        }
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nueva OC
          </Button>
        }
      />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${filter === k ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-slate-600 ring-slate-200'}`}
          >
            {label} · {(data ?? []).filter((po) => inFilter(po, k)).length}
          </button>
        ))}
      </div>
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Número de OC, proveedor, pedido…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Proveedor" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Todos los proveedores</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No hay órdenes de compra con ese filtro" description='Creá una con "Nueva OC" o desde un pedido que requiere compra.' />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Orden</Th>
                <Th>Proveedor</Th>
                <Th className="hidden md:table-cell">Para</Th>
                <Th>Estado</Th>
                <Th className="hidden lg:table-cell">Fecha</Th>
                <Th className="hidden sm:table-cell">Esperada</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((po) => (
                <tr key={po.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(po)}>
                  <Td>
                    <span className="font-medium text-navy-900">{po.number}</span> <DemoBadge show={po.is_demo} />
                  </Td>
                  <Td>{po.suppliers?.name}</Td>
                  <Td className="hidden md:table-cell">
                    {po.order_id && po.orders ? (
                      <Link to={`/pedidos/${po.order_id}`} onClick={(e) => e.stopPropagation()} className="text-brand-600 hover:underline">
                        Pedido {po.orders.number}
                      </Link>
                    ) : (
                      <span className="text-slate-500">General</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={PO_STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>
                  </Td>
                  <Td className="hidden lg:table-cell">{dateOnly(po.ordered_at ?? po.created_at.slice(0, 10))}</Td>
                  <Td className={`hidden sm:table-cell ${late(po) ? 'font-medium text-red-600' : ''}`}>{dateOnly(po.expected_at)}</Td>
                  <Td className="whitespace-nowrap text-right font-medium">{money(po.grand_total ?? po.total_cost)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <GeneralPurchaseOrderModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          invalidate();
          void unwrap(supabase.from('purchase_orders').select('*, suppliers(name), orders(number)').eq('id', id).single()).then((po) => setOpen(po as PoRow));
        }}
      />
      <PurchaseOrderDetailModal poId={open?.id ?? null} orderNumber={open?.orders?.number} onClose={() => setOpen(null)} onChanged={invalidate} />
    </>
  );
}

interface Line {
  key: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number;
}
const k = () => Math.random().toString(36).slice(2);

/** OC general: sin pedido (para bodega, repuestos, insumos). Líneas del catálogo o libres. */
function GeneralPurchaseOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const { data: suppliers } = useSuppliers();
  const { data: products } = useProducts();
  const { data: settings } = useSettings();
  const costs = useQuery({ queryKey: ['product_costs'], enabled: open, queryFn: () => unwrap(supabase.from('product_costs').select('*')) as Promise<ProductCost[]> });
  const [supplier, setSupplier] = useState('');
  const [expected, setExpected] = useState('');
  const [terms, setTerms] = useState('Contado');
  const [taxRate, setTaxRate] = useState(13);
  const [delivery, setDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!open) return;
    setSupplier('');
    setExpected('');
    setTerms('Contado');
    setTaxRate(Number(settings?.default_tax_rate ?? 13));
    setDelivery(settings?.address ?? '');
    setNotes('');
    setLines([]);
  }, [open, settings]);

  const costOf = useMemo(() => new Map((costs.data ?? []).map((c) => [c.product_id, c])), [costs.data]);
  const catalog = (products ?? []).filter((p) => p.is_active && p.kind === 'producto');
  const fromSupplier = supplier ? catalog.filter((p) => costOf.get(p.id)?.supplier_id === supplier && !lines.some((l) => l.product_id === p.id)) : [];

  const addProduct = (id: string) => {
    const p = catalog.find((x) => x.id === id);
    if (!p) return;
    setLines((ls) => [...ls, { key: k(), product_id: p.id, description: p.name, quantity: 1, unit_cost: Number(costOf.get(p.id)?.unit_cost ?? 0) }]);
    const sup = costOf.get(p.id)?.supplier_id;
    if (sup) setSupplier((s) => s || sup);
  };
  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sub = lines.reduce((a, l) => a + Math.round(l.quantity * l.unit_cost * 100) / 100, 0);
  const iva = Math.round(sub * taxRate) / 100;

  const m = useMutation({
    mutationFn: async () => {
      if (!supplier) throw new Error('Elegí un proveedor.');
      if (!lines.length) throw new Error('Agregá al menos una línea.');
      const bad = lines.find((l) => !l.description.trim() || !(l.quantity > 0) || l.unit_cost < 0);
      if (bad) throw new Error('Revisá las líneas: cada una necesita descripción, cantidad mayor que 0 y costo.');
      const po = (await unwrap(
        supabase
          .from('purchase_orders')
          .insert({
            number: '',
            order_id: null,
            supplier_id: supplier,
            expected_at: expected || null,
            payment_terms: terms.trim() || null,
            tax_rate: taxRate,
            delivery_address: delivery.trim() || null,
            notes: notes.trim() || null,
          })
          .select('id')
          .single(),
      )) as { id: string };
      await unwrap(
        supabase.from('purchase_order_items').insert(
          lines.map((l) => ({ purchase_order_id: po.id, product_id: l.product_id, description: l.description.trim(), quantity: l.quantity, unit_cost: l.unit_cost })),
        ),
      );
      return po.id;
    },
    onSuccess: (id) => {
      toast.success('Orden de compra creada (borrador)');
      onClose();
      onCreated(id);
    },
    onError: toast.error,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Nueva orden de compra general"
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
      <div className="space-y-5">
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Para compras que no son de un pedido: bodega, repuestos, consumibles o insumos. Las compras de un pedido se crean desde el pedido, así quedan ligadas.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required>
            <Select aria-label="Proveedor de la OC" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Seleccionar…</option>
              {suppliers
                ?.filter((s) => s.is_active)
                .map((s) => (
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
            <Input list="po-terms-general" value={terms} onChange={(e) => setTerms(e.target.value)} />
            <datalist id="po-terms-general">
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="IVA (%)" hint="0 si el proveedor no cobra IVA.">
            <Input type="number" min={0} max={100} step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
          </Field>
          <Field label="Dirección de entrega" className="sm:col-span-2">
            <Input value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Agregar producto del catálogo" className="max-w-sm" value="" onChange={(e) => addProduct(e.target.value)}>
              <option value="">+ Agregar del catálogo…</option>
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                  {costOf.get(p.id) ? ` · costo ${money(costOf.get(p.id)!.unit_cost)}` : ''}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              icon={<PenLine className="h-4 w-4" />}
              onClick={() => setLines((ls) => [...ls, { key: k(), product_id: null, description: '', quantity: 1, unit_cost: 0 }])}
            >
              Línea libre
            </Button>
          </div>
          {fromSupplier.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Productos que le comprás a este proveedor:</span>
              {fromSupplier.slice(0, 8).map((p) => (
                <button key={p.id} type="button" onClick={() => addProduct(p.id)} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-100">
                  <PackagePlus className="h-3.5 w-3.5" /> {p.name}
                </button>
              ))}
            </div>
          )}
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">Todavía no hay líneas.</p>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_90px_120px_110px_32px] gap-2 px-1 text-xs font-medium text-slate-500 sm:grid">
                <span>Descripción</span>
                <span className="text-right">Cantidad</span>
                <span className="text-right">Costo unit.</span>
                <span className="text-right">Total</span>
                <span />
              </div>
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[1fr_90px_120px_110px_32px] sm:border-0 sm:p-0">
                  <Input
                    aria-label="Descripción de la línea"
                    className="col-span-2 sm:col-span-1"
                    placeholder="Descripción"
                    value={l.description}
                    onChange={(e) => upd(l.key, { description: e.target.value })}
                  />
                  <Input aria-label="Cantidad" type="number" min={0} step="any" className="text-right" value={l.quantity} onChange={(e) => upd(l.key, { quantity: Number(e.target.value) })} />
                  <Input aria-label="Costo unitario" type="number" min={0} step="0.01" className="text-right" value={l.unit_cost} onChange={(e) => upd(l.key, { unit_cost: Number(e.target.value) })} />
                  <span className="text-right text-sm font-medium">{money(l.quantity * l.unit_cost)}</span>
                  <button type="button" aria-label="Quitar línea" className="justify-self-end text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <p className="pt-1 text-right text-sm">
                Subtotal {money(sub)} · IVA {money(iva)} · <b>Total {money(sub + iva)}</b>
              </p>
            </div>
          )}
        </div>
        <Field label="Notas (salen en el PDF)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
