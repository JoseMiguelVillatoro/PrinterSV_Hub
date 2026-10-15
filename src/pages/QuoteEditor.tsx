import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, PackagePlus, PenLine, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, Checkbox, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { useClientOptions, useContacts, useProducts, useProfiles, useSettings } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { QUOTE_EDITABLE, QUOTE_STATUS_LABEL, addDaysISO, money, todayISO } from '@/lib/format';
import { adjustmentAmount, calcLine, calcQuote } from '@/lib/quoteMath';
import { supabase, unwrap } from '@/lib/supabase';
import type { AdjustmentKind, ItemKind, ProductCost, Quote, QuoteAdjustment, QuoteItem } from '@/lib/types';

interface LineDraft {
  key: string;
  id?: string;
  product_id: string | null;
  kind: ItemKind;
  sku: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  taxable: boolean;
  unit_cost: string;
}

interface AdjDraft {
  key: string;
  id?: string;
  kind: AdjustmentKind;
  label: string;
  /** 'pct' = porcentaje del subtotal neto de líneas; 'monto' = valor fijo */
  mode: 'pct' | 'monto';
  percent: number;
  amount: number;
  taxable: boolean;
}

interface Header {
  client_id: string;
  contact_id: string;
  owner_id: string;
  title: string;
  requested_at: string; // date
  issue_date: string;
  valid_until: string;
  tax_rate: number;
  terms: string;
  notes: string;
  internal_notes: string;
  next_action: string;
  next_action_date: string;
  show_images: boolean;
}

const key = () => Math.random().toString(36).slice(2);

export function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: clients } = useClientOptions();
  const { data: profiles } = useProfiles();
  const { data: products } = useProducts(true);
  const costs = useQuery({
    queryKey: ['product_costs'],
    enabled: auth.canSeeCosts,
    queryFn: () => unwrap(supabase.from('product_costs').select('*')) as Promise<ProductCost[]>,
  });

  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [adjs, setAdjs] = useState<AdjDraft[]>([]);
  const [pick, setPick] = useState('');
  const { data: contacts } = useContacts(header?.client_id);

  const existing = useQuery({
    queryKey: ['quote', id, 'edit'],
    enabled: Boolean(id),
    queryFn: async () => {
      const [quote, items, adjustments, itemCosts] = await Promise.all([
        unwrap(supabase.from('quotes').select('*').eq('id', id!).single()),
        unwrap(supabase.from('quote_items').select('*').eq('quote_id', id!).order('position')),
        unwrap(supabase.from('quote_adjustments').select('*').eq('quote_id', id!).order('position')),
        auth.canSeeCosts
          ? unwrap(supabase.from('quote_item_costs').select('quote_item_id, unit_cost, quote_items!inner(quote_id)').eq('quote_items.quote_id', id!))
          : Promise.resolve([]),
      ]);
      return {
        quote: quote as Quote,
        items: items as QuoteItem[],
        adjustments: adjustments as QuoteAdjustment[],
        costs: new Map((itemCosts as { quote_item_id: string; unit_cost: number }[]).map((c) => [c.quote_item_id, c.unit_cost])),
      };
    },
  });

  // Inicializar formulario
  useEffect(() => {
    if (header) return;
    if (id) {
      if (!existing.data) return;
      const { quote, items, adjustments, costs: ic } = existing.data;
      setHeader({
        client_id: quote.client_id,
        contact_id: quote.contact_id ?? '',
        owner_id: quote.owner_id ?? '',
        title: quote.title ?? '',
        requested_at: quote.requested_at.slice(0, 10),
        issue_date: quote.issue_date,
        valid_until: quote.valid_until ?? '',
        tax_rate: Number(quote.tax_rate),
        terms: quote.terms ?? '',
        notes: quote.notes ?? '',
        internal_notes: quote.internal_notes ?? '',
        next_action: quote.next_action ?? '',
        next_action_date: quote.next_action_date ?? '',
        show_images: quote.show_images ?? true,
      });
      setLines(
        items.map((i) => ({
          key: key(),
          id: i.id,
          product_id: i.product_id,
          kind: i.kind,
          sku: i.sku ?? '',
          description: i.description,
          unit: i.unit,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          discount_pct: Number(i.discount_pct),
          taxable: i.taxable,
          unit_cost: ic.has(i.id) ? String(ic.get(i.id)) : '',
        })),
      );
      setAdjs(
        adjustments.map((a) => ({
          key: key(),
          id: a.id,
          kind: a.kind,
          label: a.label,
          mode: a.percent !== null && a.percent !== undefined ? 'pct' : 'monto',
          percent: Number(a.percent ?? 0),
          amount: Number(a.amount),
          taxable: a.taxable,
        })),
      );
    } else if (settings) {
      const today = todayISO();
      setHeader({
        client_id: params.get('cliente') ?? '',
        contact_id: '',
        owner_id: auth.session?.user.id ?? '',
        title: '',
        requested_at: today,
        issue_date: today,
        valid_until: addDaysISO(today, settings.quote_validity_days),
        tax_rate: Number(settings.default_tax_rate),
        terms: settings.default_quote_terms ?? '',
        notes: '',
        internal_notes: '',
        next_action: '',
        next_action_date: '',
        show_images: true,
      });
    }
  }, [id, existing.data, settings, header, params, auth.session]);

  const productImg = useMemo(() => new Map((products ?? []).filter((p) => p.image_url).map((p) => [p.id, p.image_url as string])), [products]);
  const costMap = useMemo(() => new Map((costs.data ?? []).map((c) => [c.product_id, c.unit_cost])), [costs.data]);
  const adjInputs = useMemo(() => adjs.map((a) => ({ kind: a.kind, taxable: a.taxable, amount: a.amount, percent: a.mode === 'pct' ? a.percent : null })), [adjs]);
  const totals = useMemo(() => calcQuote(lines, adjInputs, header?.tax_rate ?? 0), [lines, adjInputs, header?.tax_rate]);
  const marginInfo = useMemo(() => {
    if (!auth.canSeeCosts) return null;
    let cost = 0;
    let missing = 0;
    for (const l of lines) {
      if (l.unit_cost === '') missing++;
      else cost += Number(l.unit_cost) * l.quantity;
    }
    const margin = totals.net - cost;
    return { cost, margin, pct: totals.net > 0 ? (margin / totals.net) * 100 : 0, missing };
  }, [lines, totals.net, auth.canSeeCosts]);

  function addProduct(productId: string) {
    const p = products?.find((x) => x.id === productId);
    if (!p) return;
    setLines((ls) => [
      ...ls,
      {
        key: key(),
        product_id: p.id,
        kind: p.kind,
        sku: p.sku,
        description: p.description ? `${p.name} – ${p.description}` : p.name,
        unit: p.unit,
        quantity: 1,
        unit_price: Number(p.sale_price),
        discount_pct: 0,
        taxable: p.taxable,
        unit_cost: costMap.has(p.id) ? String(costMap.get(p.id)) : '',
      },
    ]);
    setPick('');
  }

  function addCustom() {
    setLines((ls) => [
      ...ls,
      { key: key(), product_id: null, kind: 'producto', sku: '', description: '', unit: 'unidad', quantity: 1, unit_price: 0, discount_pct: 0, taxable: true, unit_cost: '' },
    ]);
  }

  const updLine = (k: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const move = (idx: number, dir: -1 | 1) =>
    setLines((ls) => {
      const j = idx + dir;
      if (j < 0 || j >= ls.length) return ls;
      const copy = [...ls];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

  const save = useMutation({
    mutationFn: async () => {
      if (!header) return '';
      if (!header.client_id) throw new Error('Elegí un cliente.');
      if (lines.length === 0) throw new Error('Agregá al menos una línea.');
      for (const [i, l] of lines.entries()) {
        if (!l.description.trim()) throw new Error(`La línea ${i + 1} no tiene descripción.`);
        if (!(l.quantity > 0)) throw new Error(`La línea ${i + 1} debe tener cantidad mayor a 0.`);
        if (l.unit_price < 0) throw new Error(`La línea ${i + 1} tiene precio negativo.`);
      }
      for (const a of adjs) {
        if (!a.label.trim()) throw new Error('Cada cargo o deducción necesita una descripción.');
        if (a.mode === 'pct' && !(a.percent > 0 && a.percent <= 100)) throw new Error(`"${a.label}": el porcentaje debe estar entre 0.01 y 100.`);
        if (a.mode === 'monto' && a.amount < 0) throw new Error(`"${a.label}": el monto no puede ser negativo.`);
      }
      if (header.valid_until && header.valid_until < header.issue_date) throw new Error('La vigencia no puede ser anterior a la fecha de emisión.');

      const payload = {
        id: id ?? null,
        ...header,
        requested_at: header.requested_at ? `${header.requested_at}T12:00:00-06:00` : null,
        items: lines.map(({ key: _k, ...l }) => ({ ...l, unit_cost: auth.canSeeCosts ? l.unit_cost : '' })),
        adjustments: adjs.map(({ key: _k, mode, percent, ...a }) => ({ ...a, percent: mode === 'pct' ? percent : null })),
      };
      return (await unwrap(supabase.rpc('save_quote', { p: payload }))) as string;
    },
    onSuccess: (quoteId) => {
      toast.success(id ? 'Cotización actualizada' : 'Cotización creada');
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['quote'] });
      void qc.invalidateQueries({ queryKey: ['client'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/cotizaciones/${quoteId}`);
    },
    onError: toast.error,
  });

  if (existing.error) return <ErrorBox error={existing.error} />;
  if (!header) return <Spinner />;
  if (existing.data && !QUOTE_EDITABLE.includes(existing.data.quote.status)) {
    return (
      <ErrorBox
        error={`La cotización ${existing.data.quote.number} está "${QUOTE_STATUS_LABEL[existing.data.quote.status]}" y ya no se puede editar. Podés duplicarla desde su detalle.`}
      />
    );
  }
  const set = <K extends keyof Header>(k: K, v: Header[K]) => setHeader((h) => (h ? { ...h, [k]: v } : h));

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>
      <PageHeader
        title={id ? `Editar ${existing.data?.quote.number}` : 'Nueva cotización'}
        subtitle="El número, los totales y el IVA los calcula y guarda la base de datos."
        actions={
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar cotización
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card title="Datos generales">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Cliente" required className="lg:col-span-2">
                <Select value={header.client_id} onChange={(e) => setHeader({ ...header, client_id: e.target.value, contact_id: '' })}>
                  <option value="">Seleccionar…</option>
                  {clients?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Contacto">
                <Select value={header.contact_id} onChange={(e) => set('contact_id', e.target.value)} disabled={!header.client_id}>
                  <option value="">—</option>
                  {contacts?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Título / referencia" className="sm:col-span-2 lg:col-span-3">
                <Input value={header.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej.: Renovación de equipos – área contable" />
              </Field>
              <Field label="Solicitada por el cliente" hint="Para medir tiempo de respuesta">
                <Input type="date" value={header.requested_at} onChange={(e) => set('requested_at', e.target.value)} />
              </Field>
              <Field label="Fecha de emisión">
                <Input type="date" value={header.issue_date} onChange={(e) => set('issue_date', e.target.value)} />
              </Field>
              <Field label="Válida hasta">
                <Input type="date" value={header.valid_until} onChange={(e) => set('valid_until', e.target.value)} />
              </Field>
              <Field label="Responsable">
                <Select value={header.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
                  <option value="">—</option>
                  {profiles?.filter((p) => p.is_active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="IVA (%)" hint="Configurable por cotización">
                <Input type="number" min={0} max={100} step="0.01" value={header.tax_rate} onChange={(e) => set('tax_rate', Number(e.target.value))} />
              </Field>
            </div>
          </Card>

          <Card
            title="Líneas"
            actions={
              <Button size="sm" variant="secondary" icon={<PenLine className="h-4 w-4" />} onClick={addCustom}>
                Línea personalizada
              </Button>
            }
          >
            <div className="mb-4 flex gap-2">
              <PackagePlus className="mt-2.5 h-5 w-5 shrink-0 text-slate-400" />
              <Select value={pick} onChange={(e) => addProduct(e.target.value)}>
                <option value="">Agregar desde el catálogo…</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name} · {money(p.sale_price)}
                  </option>
                ))}
              </Select>
            </div>

            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                Agregá productos del catálogo o una línea personalizada (no se guarda en el catálogo).
              </p>
            ) : (
              <>
              {/* Escritorio: tabla editable */}
              <div className="-mx-5 hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="w-8 py-2 pl-5">#</th>
                      <th className="w-12 py-2">Img.</th>
                      <th className="py-2 pr-2">Descripción</th>
                      <th className="w-20 py-2 pr-2">Cant.</th>
                      <th className="w-28 py-2 pr-2">Precio unit.</th>
                      <th className="w-20 py-2 pr-2">Desc. %</th>
                      {auth.canSeeCosts && <th className="w-24 py-2 pr-2">Costo</th>}
                      <th className="w-12 py-2 text-center">IVA</th>
                      <th className="w-28 py-2 pr-2 text-right">Subtotal</th>
                      <th className="w-20 py-2 pr-5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, idx) => {
                      const r = calcLine(l);
                      const img = l.product_id ? productImg.get(l.product_id) : null;
                      return (
                        <tr key={l.key} className="align-top">
                          <td className="py-3 pl-5 text-slate-500">{idx + 1}</td>
                          <td className="py-2">
                            {img ? (
                              <img src={img} alt="" className="h-9 w-9 rounded-md object-cover ring-1 ring-slate-200" />
                            ) : (
                              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-[9px] font-semibold text-slate-400">
                                {l.product_id ? (l.kind === 'servicio' ? 'SRV' : 'PRD') : <PenLine className="h-3.5 w-3.5" />}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            <Textarea rows={2} aria-label="Descripción" value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} className="min-w-[180px]" />
                            <label className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                              Unidad
                              <input aria-label="Unidad" value={l.unit} onChange={(e) => updLine(l.key, { unit: e.target.value })} className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-600" />
                            </label>
                            {l.product_id ? (
                              <p className="mt-1 text-[11px] text-slate-400">Catálogo · {l.sku}</p>
                            ) : (
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                                <select aria-label="Tipo" value={l.kind} onChange={(e) => updLine(l.key, { kind: e.target.value as ItemKind })} className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-600">
                                  <option value="producto">Producto</option>
                                  <option value="servicio">Servicio</option>
                                </select>
                                Personalizada · no se guarda en el catálogo
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2"><Input className="min-w-[64px] px-2 text-right" aria-label="Cantidad" type="number" min={0} step="any" value={l.quantity} onChange={(e) => updLine(l.key, { quantity: Number(e.target.value) })} /></td>
                          <td className="py-2 pr-2"><Input className="min-w-[88px] px-2 text-right" aria-label="Precio unit." type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => updLine(l.key, { unit_price: Number(e.target.value) })} /></td>
                          <td className="py-2 pr-2"><Input className="min-w-[60px] px-2 text-right" aria-label="Desc. %" type="number" min={0} max={100} step="0.01" value={l.discount_pct} onChange={(e) => updLine(l.key, { discount_pct: Number(e.target.value) })} /></td>
                          {auth.canSeeCosts && (
                            <td className="py-2 pr-2"><Input aria-label="Costo unit." type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => updLine(l.key, { unit_cost: e.target.value })} className="min-w-[84px] bg-amber-50/60 px-2 text-right" /></td>
                          )}
                          <td className="py-4 text-center">
                            <input type="checkbox" aria-label="Gravado con IVA" className="h-4 w-4 rounded border-slate-300 text-brand-500" checked={l.taxable} onChange={(e) => updLine(l.key, { taxable: e.target.checked })} />
                          </td>
                          <td className="whitespace-nowrap py-3 pr-2 text-right">
                            <span className="font-semibold text-navy-900">{money(r.line_total)}</span>
                            {r.line_discount > 0 && <span className="block text-[11px] text-slate-400">− {money(r.line_discount)}</span>}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-5 text-right">
                            <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => move(idx, -1)} aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
                            <button className="rounded p-1 text-red-400 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Móvil: tarjetas */}
              <div className="space-y-3 md:hidden">
                {lines.map((l, idx) => {
                  const r = calcLine(l);
                  return (
                    <div key={l.key} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-500">
                          #{idx + 1} · {l.product_id ? `Catálogo${l.sku ? ` · ${l.sku}` : ''}` : 'Personalizada'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => move(idx, -1)} aria-label="Subir">
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => move(idx, 1)} aria-label="Bajar">
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button className="rounded p-1 text-red-400 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Eliminar">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-6">
                        <Field label="Descripción" className="sm:col-span-6">
                          <Textarea rows={2} value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} />
                        </Field>
                        {!l.product_id && (
                          <>
                            <Field label="Tipo">
                              <Select value={l.kind} onChange={(e) => updLine(l.key, { kind: e.target.value as ItemKind })}>
                                <option value="producto">Producto</option>
                                <option value="servicio">Servicio</option>
                              </Select>
                            </Field>
                            <Field label="SKU (opc.)">
                              <Input value={l.sku} onChange={(e) => updLine(l.key, { sku: e.target.value })} />
                            </Field>
                          </>
                        )}
                        <Field label="Cantidad">
                          <Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => updLine(l.key, { quantity: Number(e.target.value) })} />
                        </Field>
                        <Field label="Unidad">
                          <Input value={l.unit} onChange={(e) => updLine(l.key, { unit: e.target.value })} />
                        </Field>
                        <Field label="Precio unit.">
                          <Input type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => updLine(l.key, { unit_price: Number(e.target.value) })} />
                        </Field>
                        <Field label="Desc. %">
                          <Input type="number" min={0} max={100} step="0.01" value={l.discount_pct} onChange={(e) => updLine(l.key, { discount_pct: Number(e.target.value) })} />
                        </Field>
                        {auth.canSeeCosts && (
                          <Field label="Costo unit." hint="Restringido">
                            <Input type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => updLine(l.key, { unit_cost: e.target.value })} className="bg-amber-50/60" />
                          </Field>
                        )}
                        <div className="flex items-end justify-between gap-3 sm:col-span-6">
                          <Checkbox label="Gravado con IVA" checked={l.taxable} onChange={(e) => updLine(l.key, { taxable: e.target.checked })} />
                          <p className="text-right text-sm">
                            {r.line_discount > 0 && <span className="mr-2 text-xs text-slate-500">− {money(r.line_discount)}</span>}
                            <span className="font-semibold text-navy-900">{money(r.line_total)}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
            <button onClick={addCustom} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
              <Plus className="h-4 w-4" /> Agregar línea personalizada
            </button>
          </Card>

          <Card
            title="Cargos y deducciones"
            actions={
              <>
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdjs((a) => [...a, { key: key(), kind: 'cargo', label: '', mode: 'monto', percent: 0, amount: 0, taxable: true }])}>
                  Cargo
                </Button>
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdjs((a) => [...a, { key: key(), kind: 'deduccion', label: '', mode: 'pct', percent: 5, amount: 0, taxable: true }])}>
                  Deducción
                </Button>
              </>
            }
          >
            {adjs.length === 0 ? (
              <p className="text-sm text-slate-500">Descuentos (por ejemplo 5 %), envío, instalación, anticipos… aparecen por separado en el PDF.</p>
            ) : (
              <div className="space-y-3">
                {adjs.map((a) => {
                  const upd = (patch: Partial<AdjDraft>) => setAdjs((xs) => xs.map((x) => (x.key === a.key ? { ...x, ...patch } : x)));
                  const value = adjustmentAmount({ kind: a.kind, taxable: a.taxable, amount: a.amount, percent: a.mode === 'pct' ? a.percent : null }, totals.net);
                  return (
                    <div key={a.key} className="grid items-center gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[160px_1fr_76px_100px_auto_96px_auto] sm:border-0 sm:p-0">
                      <Select aria-label="Tipo" value={a.kind} onChange={(e) => upd({ kind: e.target.value as AdjustmentKind })}>
                        <option value="deduccion">Deducción (−)</option>
                        <option value="cargo">Cargo (+)</option>
                      </Select>
                      <Input aria-label="Descripción del ajuste" placeholder={a.kind === 'deduccion' ? 'Ej.: Descuento por volumen' : 'Ej.: Envío'} value={a.label} onChange={(e) => upd({ label: e.target.value })} />
                      <Select aria-label="Forma" value={a.mode} onChange={(e) => upd({ mode: e.target.value as AdjDraft['mode'] })}>
                        <option value="pct">%</option>
                        <option value="monto">$</option>
                      </Select>
                      {a.mode === 'pct' ? (
                        <Input aria-label="Porcentaje" type="number" min={0} max={100} step="0.01" value={a.percent} onChange={(e) => upd({ percent: Number(e.target.value) })} className="text-right" />
                      ) : (
                        <Input aria-label="Monto" type="number" min={0} step="0.01" value={a.amount} onChange={(e) => upd({ amount: Number(e.target.value) })} className="text-right" />
                      )}
                      <Checkbox label="Afecta IVA" checked={a.taxable} onChange={(e) => upd({ taxable: e.target.checked })} />
                      <span className="whitespace-nowrap text-right text-sm font-medium text-navy-900">
                        {a.kind === 'deduccion' ? '− ' : '+ '}
                        {money(value)}
                      </span>
                      <button className="justify-self-end rounded p-1 text-red-400 hover:bg-red-50" onClick={() => setAdjs((xs) => xs.filter((x) => x.key !== a.key))} aria-label="Eliminar ajuste">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
                <p className="text-xs text-slate-500">
                  El porcentaje se calcula sobre el subtotal de las líneas (después de sus descuentos) y se actualiza solo si cambian. Marcá "Afecta IVA" para que el descuento también reduzca el IVA.
                </p>
              </div>
            )}
          </Card>

          <Card title="Condiciones y notas">
            <div className="grid gap-4">
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <Checkbox
                  label="Incluir fotos de los productos en el PDF"
                  checked={header.show_images}
                  onChange={(e) => set('show_images', e.target.checked)}
                />
                <p className="ml-6 mt-0.5 text-xs text-slate-500">Las líneas del catálogo con foto la muestran en miniatura. Las líneas personalizadas salen sin foto.</p>
              </div>
              <Field label="Notas para el cliente (aparecen en el PDF)">
                <Textarea value={header.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
              <Field label="Condiciones comerciales (aparecen en el PDF)">
                <Textarea rows={4} value={header.terms} onChange={(e) => set('terms', e.target.value)} />
              </Field>
              <Field label="Notas internas (nunca salen en el PDF)">
                <Textarea value={header.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Próxima acción">
                  <Input value={header.next_action} onChange={(e) => set('next_action', e.target.value)} />
                </Field>
                <Field label="Fecha próxima acción">
                  <Input type="date" value={header.next_action_date} onChange={(e) => set('next_action_date', e.target.value)} />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card title="Resumen">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd>{money(totals.subtotal)}</dd>
              </div>
              {totals.discount_total > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Descuentos</dt>
                  <dd>− {money(totals.discount_total)}</dd>
                </div>
              )}
              {totals.charges_total > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Cargos</dt>
                  <dd>+ {money(totals.charges_total)}</dd>
                </div>
              )}
              {totals.deductions_total > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Deducciones</dt>
                  <dd>− {money(totals.deductions_total)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Base imponible</dt>
                <dd>{money(totals.taxable_base)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">IVA ({header.tax_rate} %)</dt>
                <dd>{money(totals.tax_total)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-3 text-base font-semibold text-navy-900">
                <dt>Total</dt>
                <dd>{money(totals.total)}</dd>
              </div>
            </dl>
            {marginInfo && (
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Margen estimado (restringido)</p>
                <p className="mt-1">
                  Costo {money(marginInfo.cost)} · Margen {money(marginInfo.margin)} ({marginInfo.pct.toFixed(1)} %)
                </p>
                {marginInfo.missing > 0 && <p className="mt-1 text-amber-700">{marginInfo.missing} línea(s) sin costo</p>}
              </div>
            )}
            <Button className="mt-4 w-full" loading={save.isPending} onClick={() => save.mutate()}>
              Guardar cotización
            </Button>
          </Card>
        </aside>
      </div>
    </>
  );
}
