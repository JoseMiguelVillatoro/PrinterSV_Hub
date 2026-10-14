import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Checkbox, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useProducts, useSuppliers } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { dateTime, money } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { ItemKind, Product, ProductCost } from '@/lib/types';

type Draft = Omit<Product, 'id' | 'is_demo'> & { unit_cost: string; supplier_id: string };

const empty: Draft = {
  sku: '',
  name: '',
  description: '',
  kind: 'producto',
  category: '',
  brand: '',
  unit: 'unidad',
  image_url: '',
  sale_price: 0,
  taxable: true,
  is_active: true,
  unit_cost: '',
  supplier_id: '',
};

function ProductModal({ open, onClose, product, cost }: { open: boolean; onClose: () => void; product: Product | null; cost?: ProductCost }) {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: suppliers } = useSuppliers();
  const [form, setForm] = useState<Draft>(empty);

  useEffect(() => {
    if (!open) return;
    if (product) {
      const { id: _i, is_demo: _d, ...rest } = product;
      setForm({ ...empty, ...rest, unit_cost: cost ? String(cost.unit_cost) : '', supplier_id: cost?.supplier_id ?? '' });
    } else setForm(empty);
  }, [open, product, cost]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.sku.trim() || !form.name.trim()) throw new Error('SKU y nombre son obligatorios.');
      const { unit_cost, supplier_id, ...p } = form;
      const payload = {
        ...p,
        sku: p.sku.trim().toUpperCase(),
        description: p.description || null,
        category: p.category || null,
        brand: p.brand || null,
        image_url: p.image_url || null,
        sale_price: Number(p.sale_price),
      };
      let id = product?.id;
      if (product) await unwrap(supabase.from('products').update(payload).eq('id', product.id));
      else id = ((await unwrap(supabase.from('products').insert(payload).select('id').single())) as { id: string }).id;

      if (auth.canSeeCosts && id) {
        if (unit_cost.trim() === '') {
          if (cost) await unwrap(supabase.from('product_costs').delete().eq('product_id', id));
        } else {
          await unwrap(
            supabase
              .from('product_costs')
              .upsert({ product_id: id, unit_cost: Number(unit_cost), supplier_id: supplier_id || null }, { onConflict: 'product_id' }),
          );
        }
      }
    },
    onSuccess: () => {
      toast.success('Producto guardado');
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['product_costs'] });
      onClose();
    },
    onError: toast.error,
  });

  const margin = form.unit_cost !== '' && Number(form.sale_price) > 0 ? ((Number(form.sale_price) - Number(form.unit_cost)) / Number(form.sale_price)) * 100 : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={product ? 'Editar producto/servicio' : 'Nuevo producto/servicio'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" required>
          <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </Field>
        <Field label="Tipo">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ItemKind })}>
            <option value="producto">Producto</option>
            <option value="servicio">Servicio</option>
          </Select>
        </Field>
        <Field label="Nombre" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Categoría">
          <Input value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </Field>
        <Field label="Marca">
          <Input value={form.brand ?? ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </Field>
        <Field label="Unidad">
          <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Field label="Precio de venta (USD, sin IVA)" required>
          <Input type="number" min={0} step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) })} />
        </Field>
        <Field label="URL de imagen (opcional)" className="sm:col-span-2">
          <Input value={form.image_url ?? ''} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…" />
        </Field>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <Checkbox label="Gravado con IVA" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} />
          <Checkbox label="Activo (disponible para cotizar)" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        </div>
        {auth.canSeeCosts && (
          <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4 sm:col-span-2 sm:grid-cols-2">
            <p className="text-xs font-medium text-amber-800 sm:col-span-2">Información restringida (solo Administración y Operaciones)</p>
            <Field label="Costo unitario" hint={margin !== null ? `Margen: ${margin.toFixed(1)} %` : undefined}>
              <Input type="number" min={0} step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            </Field>
            <Field label="Proveedor habitual">
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">—</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PriceHistoryModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['price_history', product?.id],
    enabled: Boolean(product),
    queryFn: async () => {
      const [catalog, quoted] = await Promise.all([
        unwrap(supabase.from('product_price_history').select('*').eq('product_id', product!.id).order('changed_at', { ascending: false })),
        unwrap(supabase.from('v_price_history').select('*').eq('product_id', product!.id).order('issue_date', { ascending: false }).limit(50)),
      ]);
      return {
        catalog: catalog as { id: number; sale_price: number; changed_at: string }[],
        quoted: quoted as { quote_item_id: string; quote_number: string; client_name: string; issue_date: string; effective_unit_price: number; quantity: number; quote_status: string }[],
      };
    },
  });
  return (
    <Modal open={Boolean(product)} onClose={onClose} wide title={`Historial de precios · ${product?.name ?? ''}`}>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Precio de catálogo</p>
            <ul className="space-y-1 text-sm">
              {data.catalog.map((h) => (
                <li key={h.id} className="flex justify-between">
                  <span className="text-slate-500">{dateTime(h.changed_at)}</span>
                  <span className="font-medium">{money(h.sale_price)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Precio cotizado por cliente</p>
            {data.quoted.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no se ha cotizado.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.quoted.map((h) => (
                  <li key={h.quote_item_id} className="flex justify-between gap-2">
                    <span>
                      <span className="font-medium">{h.client_name}</span>
                      <span className="block text-xs text-slate-500">
                        {h.quote_number} · {h.issue_date} · {h.quantity} u.
                      </span>
                    </span>
                    <span className="font-medium">{money(h.effective_unit_price)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ProductsPage() {
  const auth = useAuth();
  const { data, isLoading, error } = useProducts();
  const costs = useQuery({
    queryKey: ['product_costs'],
    enabled: auth.canSeeCosts,
    queryFn: () => unwrap(supabase.from('product_costs').select('*')) as Promise<ProductCost[]>,
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [history, setHistory] = useState<Product | null>(null);

  const costMap = useMemo(() => new Map((costs.data ?? []).map((c) => [c.product_id, c])), [costs.data]);
  const categories = useMemo(() => [...new Set((data ?? []).map((p) => p.category).filter(Boolean))] as string[], [data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter(
      (p) =>
        (showInactive || p.is_active) &&
        (!category || p.category === category) &&
        (!s || [p.sku, p.name, p.brand, p.description].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [data, search, category, showInactive]);

  return (
    <>
      <PageHeader
        title="Productos y servicios"
        subtitle="Catálogo para cotizar. También podés agregar líneas personalizadas en cada cotización."
        actions={
          auth.canManageQuotes && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ open: true, product: null })}>
              Nuevo
            </Button>
          )
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Buscar SKU, nombre, marca…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Checkbox label="Ver inactivos" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        </div>
        <ErrorBox error={error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin productos" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Producto / servicio</Th>
                <Th className="hidden md:table-cell">Categoría</Th>
                <Th className="text-right">Precio</Th>
                {auth.canSeeCosts && <Th className="hidden text-right sm:table-cell">Costo</Th>}
                {auth.canSeeCosts && <Th className="hidden text-right sm:table-cell">Margen</Th>}
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const c = costMap.get(p.id);
                const m = c && p.sale_price > 0 ? ((p.sale_price - c.unit_cost) / p.sale_price) * 100 : null;
                return (
                  <tr key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                    <Td>
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-400">
                            {p.kind === 'servicio' ? 'SRV' : 'PRD'}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-navy-900">
                            {p.name} <DemoBadge show={p.is_demo} />
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.sku} · {p.brand ?? (p.kind === 'servicio' ? 'Servicio' : '—')} · {p.unit}
                            {!p.taxable && ' · Exento'}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{p.category ? <Badge>{p.category}</Badge> : '—'}</Td>
                    <Td className="text-right font-medium">{money(p.sale_price)}</Td>
                    {auth.canSeeCosts && <Td className="hidden text-right sm:table-cell">{c ? money(c.unit_cost) : '—'}</Td>}
                    {auth.canSeeCosts && (
                      <Td className="hidden text-right sm:table-cell">
                        {m !== null ? <span className={m < 10 ? 'text-red-600' : 'text-emerald-700'}>{m.toFixed(1)} %</span> : '—'}
                      </Td>
                    )}
                    <Td className="whitespace-nowrap text-right">
                      <button className="mr-3 text-slate-400 hover:text-slate-600" title="Historial de precios" onClick={() => setHistory(p)}>
                        <History className="inline h-4 w-4" />
                      </button>
                      {auth.canManageQuotes && (
                        <button className="text-sm text-brand-600 hover:underline" onClick={() => setEditing({ open: true, product: p })}>
                          Editar
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <ProductModal open={editing.open} product={editing.product} cost={editing.product ? costMap.get(editing.product.id) : undefined} onClose={() => setEditing({ open: false, product: null })} />
      <PriceHistoryModal product={history} onClose={() => setHistory(null)} />
    </>
  );
}
