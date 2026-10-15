import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, Copy, Download, Eye, FileDown, Mail, MessageSquarePlus, Pencil, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TaskFormModal } from '@/components/forms';
import { EMAIL_ALLOWED, QuoteEmailModal } from '@/components/QuoteEmailModal';
import { Badge, Button, Card, Checkbox, DemoBadge, ErrorBox, Field, Input, Modal, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { profileName, useProfiles, useSettings } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import {
  QUOTE_EDITABLE,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  QUOTE_TRANSITIONS,
  addDaysISO,
  dateOnly,
  dateTime,
  money,
  num,
  todayISO,
} from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Client, Contact, QuoteAdjustment, QuoteEvent, QuoteItem, QuoteStatus, QuoteView, Task } from '@/lib/types';

const COMERCIAL_FORBIDDEN: QuoteStatus[] = ['cancelada', 'borrador', 'pendiente_envio'];

export function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();
  const { data: settings } = useSettings();
  const [statusModal, setStatusModal] = useState(false);
  const [followModal, setFollowModal] = useState(false);
  const [commentModal, setCommentModal] = useState(false);
  const [orderModal, setOrderModal] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [emailModal, setEmailModal] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['quote', id],
    queryFn: async () => {
      const quote = (await unwrap(supabase.from('v_quotes').select('*').eq('id', id!).single())) as QuoteView;
      const [items, adjustments, events, client, contact, tasks, margin] = await Promise.all([
        unwrap(supabase.from('quote_items').select('*').eq('quote_id', id!).order('position')),
        unwrap(supabase.from('quote_adjustments').select('*').eq('quote_id', id!).order('position')),
        unwrap(supabase.from('quote_events').select('*').eq('quote_id', id!).order('created_at', { ascending: false })),
        unwrap(supabase.from('clients').select('*').eq('id', quote.client_id).single()),
        quote.contact_id ? unwrap(supabase.from('contacts').select('*').eq('id', quote.contact_id).single()) : Promise.resolve(null),
        unwrap(supabase.from('tasks').select('*').eq('quote_id', id!).order('due_date')),
        auth.canSeeCosts ? unwrap(supabase.from('v_quote_margins').select('*').eq('quote_id', id!).maybeSingle()) : Promise.resolve(null),
      ]);
      return {
        quote,
        items: items as QuoteItem[],
        adjustments: adjustments as QuoteAdjustment[],
        events: events as QuoteEvent[],
        client: client as Client,
        contact: contact as Contact | null,
        tasks: tasks as Task[],
        margin: margin as { cost: number | null; margin: number | null; margin_pct: number | null; lines_without_cost: number } | null,
      };
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['quote'] });
    void qc.invalidateQueries({ queryKey: ['quotes'] });
    void qc.invalidateQueries({ queryKey: ['client'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const duplicate = useMutation({
    mutationFn: () => unwrap(supabase.rpc('duplicate_quote', { p_quote_id: id })) as Promise<string>,
    onSuccess: (newId) => {
      toast.success('Cotización duplicada como borrador');
      invalidate();
      navigate(`/cotizaciones/${newId}/editar`);
    },
    onError: toast.error,
  });

  const [pdfLoading, setPdfLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  async function makePdf() {
    if (!data || !settings) throw new Error('Cargando datos…');
    const { buildQuotePdf } = await import('@/lib/pdf');
    return buildQuotePdf({ ...data, settings, ownerName: data.quote.owner_name });
  }
  async function downloadPdf() {
    setPdfLoading(true);
    try {
      (await makePdf()).save(`${data!.quote.number}.pdf`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPdfLoading(false);
    }
  }
  async function previewPdf() {
    setPdfLoading(true);
    try {
      const blob = (await makePdf()).output('blob');
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(e);
    } finally {
      setPdfLoading(false);
    }
  }
  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? 'No encontrada'} />;
  const { quote: q, items, adjustments, events, client, contact, tasks, margin } = data;
  const editable = QUOTE_EDITABLE.includes(q.status) && auth.canManageQuotes;
  const transitions = QUOTE_TRANSITIONS[q.status].filter((s) => auth.canManageQuotes || !COMERCIAL_FORBIDDEN.includes(s));

  return (
    <>
      <button onClick={() => navigate('/cotizaciones')} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Cotizaciones
      </button>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-navy-900">{q.number}</h1>
            <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
            {q.is_overdue_validity && <Badge tone="red">Vigencia expirada</Badge>}
            {q.is_followup_late && <Badge tone="red">Seguimiento atrasado</Badge>}
            <DemoBadge show={q.is_demo} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <Link className="text-brand-600 hover:underline" to={`/clientes/${q.client_id}`}>
              {q.client_name}
            </Link>
            {q.title && ` · ${q.title}`} · Responsable: {q.owner_name ?? '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Eye className="h-4 w-4" />} loading={pdfLoading} onClick={previewPdf}>
            Vista previa
          </Button>
          <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} loading={pdfLoading} onClick={downloadPdf}>
            PDF
          </Button>
          {(EMAIL_ALLOWED as readonly string[]).includes(q.status) && (
            <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => setEmailModal(true)}>
              Enviar por correo
            </Button>
          )}
          {editable && (
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/cotizaciones/${q.id}/editar`)}>
              Editar
            </Button>
          )}
          {auth.canManageQuotes && (
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
              Duplicar
            </Button>
          )}
          {transitions.length > 0 && (
            <Button icon={<RefreshCcw className="h-4 w-4" />} onClick={() => setStatusModal(true)}>
              Cambiar estado
            </Button>
          )}
          {q.status === 'aceptada' && !q.order_id && auth.canManageQuotes && (
            <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setOrderModal(true)}>
              Convertir en pedido
            </Button>
          )}
          {q.order_id && (
            <Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => navigate(`/pedidos/${q.order_id}`)}>
              Ver pedido {q.order_number}
            </Button>
          )}
        </div>
      </div>

      {q.status === 'enviada' && !q.sent_at && <ErrorBox error="Marcada como enviada sin fecha." />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Detalle">
            <Table>
              <thead>
                <tr>
                  <Th>Descripción</Th>
                  <Th className="text-right">Cant.</Th>
                  <Th className="hidden text-right sm:table-cell">Precio</Th>
                  <Th className="hidden text-right sm:table-cell">Desc.</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id}>
                    <Td>
                      <p className="whitespace-pre-line text-slate-800">{it.description}</p>
                      <p className="text-xs text-slate-500">
                        {it.sku ?? (it.product_id ? '' : 'Línea personalizada')}
                        {!it.taxable && ' · Exento'}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {num(it.quantity, 3)} {it.unit}
                    </Td>
                    <Td className="hidden whitespace-nowrap text-right sm:table-cell">{money(it.unit_price, q.currency)}</Td>
                    <Td className="hidden text-right sm:table-cell">{Number(it.discount_pct) > 0 ? `${num(it.discount_pct, 2)} %` : '—'}</Td>
                    <Td className="whitespace-nowrap text-right font-medium">{money(it.line_total, q.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="ml-auto mt-4 max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd>{money(q.subtotal, q.currency)}</dd>
              </div>
              {Number(q.discount_total) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Descuentos por línea</dt>
                  <dd>− {money(q.discount_total, q.currency)}</dd>
                </div>
              )}
              {adjustments.map((a) => (
                <div key={a.id} className="flex justify-between gap-3">
                  <dt className="text-slate-500">
                    {a.label}
                    {a.percent ? ` (${num(a.percent, 2)} %)` : ''}
                    {!a.taxable && <span className="text-xs"> (no gravado)</span>}
                  </dt>
                  <dd className="whitespace-nowrap">
                    {a.kind === 'cargo' ? '+' : '−'} {money(a.amount, q.currency)}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt className="text-slate-500">Base imponible</dt>
                <dd>{money(q.taxable_base, q.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">IVA ({num(q.tax_rate, 2)} %)</dt>
                <dd>{money(q.tax_total, q.currency)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-navy-900">
                <dt>Total</dt>
                <dd>{money(q.total, q.currency)}</dd>
              </div>
            </dl>
          </Card>

          {(q.notes || q.terms || q.internal_notes) && (
            <Card title="Condiciones y notas">
              <div className="space-y-3 text-sm">
                {q.notes && (
                  <p>
                    <span className="font-medium">Notas: </span>
                    {q.notes}
                  </p>
                )}
                {q.terms && (
                  <p className="whitespace-pre-line">
                    <span className="font-medium">Condiciones: </span>
                    {q.terms}
                  </p>
                )}
                {q.internal_notes && (
                  <p className="rounded bg-slate-50 p-2 text-slate-600">
                    <span className="font-medium">Interno: </span>
                    {q.internal_notes}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card
            title="Historial"
            actions={
              <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setCommentModal(true)}>
                Comentario
              </Button>
            }
          >
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                  <p className="text-sm text-slate-800">
                    {e.event_type === 'estado' && e.to_status ? (
                      <>
                        {e.from_status ? `${QUOTE_STATUS_LABEL[e.from_status]} → ` : ''}
                        <b>{QUOTE_STATUS_LABEL[e.to_status]}</b>
                      </>
                    ) : e.event_type === 'creada' ? (
                      <b>Cotización creada</b>
                    ) : e.event_type === 'pedido' ? (
                      <b>Pedido creado</b>
                    ) : e.event_type === 'seguimiento' ? (
                      <b>Seguimiento</b>
                    ) : (
                      <b>Comentario</b>
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

        <div className="space-y-6">
          <Card title="Seguimiento" actions={<Button size="sm" variant="ghost" onClick={() => setFollowModal(true)}>Actualizar</Button>}>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Próxima acción</dt>
                <dd className={q.is_followup_late ? 'font-medium text-red-600' : ''}>
                  {q.next_action ?? '—'} {q.next_action_date && `· ${dateOnly(q.next_action_date)}`}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-slate-500">Solicitada</dt>
                  <dd>{dateOnly(q.requested_at.slice(0, 10))}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Emitida</dt>
                  <dd>{dateOnly(q.issue_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Enviada</dt>
                  <dd>{q.sent_at ? dateTime(q.sent_at) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Vigencia</dt>
                  <dd className={q.is_overdue_validity ? 'text-red-600' : ''}>{dateOnly(q.valid_until)}</dd>
                </div>
                {q.accepted_at && (
                  <div>
                    <dt className="text-xs text-slate-500">Aceptada</dt>
                    <dd>{dateTime(q.accepted_at)}</dd>
                  </div>
                )}
              </div>
              {q.rejection_reason && (
                <div className="rounded-lg bg-red-50 p-3">
                  <dt className="text-xs font-medium text-red-700">Motivo de rechazo</dt>
                  <dd className="text-red-800">{q.rejection_reason}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-slate-500">Cliente / contacto</dt>
                <dd>
                  {client.name}
                  {contact && <span className="block text-slate-500">{[contact.full_name, contact.email, contact.phone].filter(Boolean).join(' · ')}</span>}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Tareas" actions={<Button size="sm" variant="ghost" onClick={() => setTaskModal(true)}>Nueva</Button>}>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-500">Sin tareas ligadas.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {tasks.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className={t.status !== 'pendiente' ? 'text-slate-400 line-through' : ''}>{t.title}</span>
                    <Badge tone={t.status === 'pendiente' && t.due_date < todayISO() ? 'red' : 'slate'}>{dateOnly(t.due_date)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {margin && (
            <Card title="Rentabilidad (restringido)">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Venta neta (líneas)</dt>
                  <dd>{money(Number(q.subtotal) - Number(q.discount_total))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Costo</dt>
                  <dd>{money(margin.cost)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>Margen</dt>
                  <dd className={Number(margin.margin_pct) < 10 ? 'text-red-600' : 'text-emerald-700'}>
                    {money(margin.margin)} ({num(margin.margin_pct, 1)} %)
                  </dd>
                </div>
                {margin.lines_without_cost > 0 && <p className="text-xs text-amber-700">{margin.lines_without_cost} línea(s) sin costo registrado.</p>}
              </dl>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(previewUrl)}
        onClose={closePreview}
        wide
        title={`Vista previa · ${q.number}`}
        footer={
          <Button icon={<FileDown className="h-4 w-4" />} onClick={() => void downloadPdf()}>
            Descargar
          </Button>
        }
      >
        {previewUrl && <iframe title="Vista previa del PDF" src={previewUrl} className="h-[70vh] w-full rounded-lg border border-slate-200" />}
      </Modal>
      <StatusModal
        open={statusModal}
        onClose={() => setStatusModal(false)}
        quote={q}
        options={transitions}
        onDone={invalidate}
        onEmail={() => {
          setStatusModal(false);
          setEmailModal(true);
        }}
      />
      <QuoteEmailModal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        quote={q}
        client={client}
        contact={contact}
        settings={settings}
        makePdf={makePdf}
        onSent={invalidate}
      />
      <FollowupModal open={followModal} onClose={() => setFollowModal(false)} quote={q} onDone={invalidate} />
      <CommentModal open={commentModal} onClose={() => setCommentModal(false)} quoteId={q.id} onDone={invalidate} />
      <ConvertModal open={orderModal} onClose={() => setOrderModal(false)} quote={q} onDone={(orderId) => { invalidate(); navigate(`/pedidos/${orderId}`); }} />
      <TaskFormModal open={taskModal} onClose={() => setTaskModal(false)} defaultClientId={q.client_id} defaultQuoteId={q.id} />
    </>
  );
}

function StatusModal({
  open,
  onClose,
  quote,
  options,
  onDone,
  onEmail,
}: {
  open: boolean;
  onClose: () => void;
  quote: QuoteView;
  options: QuoteStatus[];
  onDone: () => void;
  onEmail: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [sendMode, setSendMode] = useState<'correo' | 'manual'>('correo');
  const viaEmail = status === 'enviada' && sendMode === 'correo';
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        supabase.rpc('change_quote_status', {
          p_quote_id: quote.id,
          p_status: status,
          p_comment: comment || null,
          p_rejection_reason: status === 'rechazada' ? reason : null,
        }),
      ),
    onSuccess: () => {
      toast.success(`Estado actualizado a "${QUOTE_STATUS_LABEL[status as QuoteStatus]}"`);
      onDone();
      setStatus('');
      setComment('');
      setReason('');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cambiar estado"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {viaEmail ? (
            <Button icon={<Mail className="h-4 w-4" />} onClick={() => { setStatus(''); onEmail(); }}>
              Redactar correo
            </Button>
          ) : (
            <Button disabled={!status || (status === 'rechazada' && !reason.trim())} loading={m.isPending} onClick={() => m.mutate()}>
              Confirmar
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Estado actual: <b>{QUOTE_STATUS_LABEL[quote.status]}</b>
        </p>
        <Field label="Nuevo estado">
          <Select value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus)}>
            <option value="">Seleccionar…</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {QUOTE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        {status === 'enviada' && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-slate-600">¿Cómo la enviás?</legend>
            <SendOption
              checked={sendMode === 'correo'}
              onSelect={() => setSendMode('correo')}
              icon={<Mail className="h-4 w-4" />}
              title="Por correo desde el Hub"
              text="Se envía al correo registrado del cliente con el PDF adjunto."
            />
            <SendOption
              checked={sendMode === 'manual'}
              onSelect={() => setSendMode('manual')}
              icon={<Download className="h-4 w-4" />}
              title="Ya la mandé yo"
              text="Descargaste el PDF y lo mandaste por tu correo o WhatsApp. Solo se registra como enviada."
            />
          </fieldset>
        )}
        {status === 'aceptada' && (
          <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
            Aceptar no crea ni avanza el pedido automáticamente. Después podés convertirla en pedido interno.
          </p>
        )}
        {status === 'rechazada' && (
          <Field label="Motivo del rechazo" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Precio, tiempo de entrega, eligió a otro proveedor…" />
          </Field>
        )}
        {!viaEmail && (
          <Field label="Comentario (opcional)">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function SendOption({ checked, onSelect, icon, title, text }: { checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
        checked ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <input type="radio" name="send-mode" className="mt-1 h-4 w-4 text-brand-500 focus:ring-brand-500" checked={checked} onChange={onSelect} />
      <span className={checked ? 'text-brand-600' : 'text-slate-400'}>{icon}</span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </label>
  );
}

function FollowupModal({ open, onClose, quote, onDone }: { open: boolean; onClose: () => void; quote: QuoteView; onDone: () => void }) {
  const toast = useToast();
  const [action, setAction] = useState(quote.next_action ?? '');
  const [date, setDate] = useState(quote.next_action_date ?? addDaysISO(todayISO(), 2));
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () =>
      unwrap(supabase.rpc('update_quote_followup', { p_quote_id: quote.id, p_next_action: action, p_next_action_date: date || null, p_comment: comment || null })),
    onSuccess: () => {
      toast.success('Seguimiento actualizado');
      onDone();
      setComment('');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Actualizar seguimiento"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Próxima acción">
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Llamar, enviar ajuste, reunión…" />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="¿Qué pasó? (queda en el historial)">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CommentModal({ open, onClose, quoteId, onDone }: { open: boolean; onClose: () => void; quoteId: string; onDone: () => void }) {
  const toast = useToast();
  const { session } = useAuth();
  const [text, setText] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      if (!text.trim()) throw new Error('Escribí un comentario.');
      await unwrap(supabase.from('quote_events').insert({ quote_id: quoteId, event_type: 'comentario', comment: text.trim(), created_by: session?.user.id }));
    },
    onSuccess: () => {
      toast.success('Comentario agregado');
      setText('');
      onDone();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar comentario"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Agregar
          </Button>
        </>
      }
    >
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
    </Modal>
  );
}

function ConvertModal({ open, onClose, quote, onDone }: { open: boolean; onClose: () => void; quote: QuoteView; onDone: (orderId: string) => void }) {
  const toast = useToast();
  const [requiresPurchase, setRequiresPurchase] = useState(true);
  const [expected, setExpected] = useState(addDaysISO(todayISO(), 7));
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        supabase.rpc('convert_quote_to_order', {
          p_quote_id: quote.id,
          p_requires_purchase: requiresPurchase,
          p_expected_delivery: expected || null,
          p_notes: notes || null,
        }),
      ) as Promise<string>,
    onSuccess: (orderId) => {
      toast.success('Pedido interno creado');
      onClose();
      onDone(orderId);
    },
    onError: toast.error,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Convertir ${quote.number} en pedido`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Crear pedido
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Se crea un pedido con las mismas líneas y totales ({money(quote.total, quote.currency)}). La cotización original se conserva sin cambios.
          Compra, recepción, preparación y entrega quedan pendientes y se actualizan por separado.
        </p>
        <Checkbox
          label="Requiere compra a proveedor"
          checked={requiresPurchase}
          onChange={(e) => setRequiresPurchase(e.target.checked)}
        />
        {!requiresPurchase && <p className="text-xs text-slate-500">Compra y recepción quedarán como "No aplica" (p. ej., servicios o stock propio).</p>}
        <Field label="Entrega estimada">
          <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Notas del pedido">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
