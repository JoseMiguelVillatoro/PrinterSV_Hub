import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Eye, FileDown, Mail, PackageCheck, Paperclip, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSettings } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { PO_STATUS_LABEL, dateOnly, dateTime, money, num, todayISO } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { PoStatus, PurchaseOrder, PurchaseOrderItem, Supplier } from '@/lib/types';
import type { jsPDF } from 'jspdf';
import { EMAIL_RE, blobToBase64, functionError, splitEmails } from './QuoteEmailModal';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Modal, Spinner, Textarea } from './ui';

export const PO_STATUS_TONE: Record<PoStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  borrador: 'slate',
  enviada: 'blue',
  recibida_parcial: 'amber',
  recibida: 'green',
  cancelada: 'red',
};

export const PAYMENT_TERMS = ['Contado', 'Contra entrega', 'Crédito 15 días', 'Crédito 30 días', 'Crédito 60 días'];

type PoFull = PurchaseOrder & { suppliers: Supplier | null };

/** Detalle de una orden de compra: PDF, envío al proveedor, recepción por línea y cancelación. */
export function PurchaseOrderDetailModal({
  poId,
  orderNumber,
  onClose,
  onChanged,
}: {
  poId: string | null;
  orderNumber?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { profile } = useAuth();
  const { data: settings } = useSettings();
  const [received, setReceived] = useState<Record<string, string>>({});
  const [pdfBusy, setPdfBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const q = useQuery({
    queryKey: ['purchase_order', poId],
    enabled: Boolean(poId),
    queryFn: async () => {
      const [po, items] = await Promise.all([
        unwrap(supabase.from('purchase_orders').select('*, suppliers(*)').eq('id', poId!).single()),
        unwrap(supabase.from('purchase_order_items').select('*').eq('purchase_order_id', poId!).order('description')),
      ]);
      const author = (po as PoFull).created_by
        ? ((await supabase.from('profiles').select('full_name').eq('id', (po as PoFull).created_by!).maybeSingle()).data?.full_name as string | undefined)
        : undefined;
      return { po: po as PoFull, items: items as PurchaseOrderItem[], author };
    },
  });
  const po = q.data?.po;
  const items = q.data?.items ?? [];

  useEffect(() => {
    if (q.data) setReceived(Object.fromEntries(q.data.items.map((i) => [i.id, String(Number(i.quantity_received))])));
  }, [q.data]);

  const refresh = () => {
    void q.refetch();
    onChanged();
  };

  async function makePdf(): Promise<jsPDF> {
    if (!po || !settings || !po.suppliers) throw new Error('Cargando datos…');
    const { buildPurchaseOrderPdf } = await import('@/lib/pdf');
    return buildPurchaseOrderPdf({ po, items, supplier: po.suppliers, settings, orderNumber, authorName: q.data?.author ?? profile?.full_name });
  }
  async function download() {
    setPdfBusy(true);
    try {
      (await makePdf()).save(`${po!.number}.pdf`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPdfBusy(false);
    }
  }
  async function showPreview() {
    setPdfBusy(true);
    try {
      setPreview(URL.createObjectURL((await makePdf()).output('blob')));
    } catch (e) {
      toast.error(e);
    } finally {
      setPdfBusy(false);
    }
  }

  const setStatus = useMutation({
    mutationFn: async (status: PoStatus) => {
      if (!po) return;
      await unwrap(
        supabase
          .from('purchase_orders')
          .update({ status, ordered_at: status === 'enviada' && !po.ordered_at ? todayISO() : po.ordered_at, sent_at: status === 'enviada' ? po.sent_at ?? new Date().toISOString() : po.sent_at })
          .eq('id', po.id),
      );
      return status;
    },
    onSuccess: (st) => {
      toast.success(st === 'cancelada' ? 'Orden de compra cancelada' : `Marcada como "${PO_STATUS_LABEL[st!]}"`);
      refresh();
    },
    onError: toast.error,
  });

  const receive = useMutation({
    mutationFn: () =>
      unwrap(
        supabase.rpc('receive_purchase_order', {
          p_po_id: po!.id,
          p_lines: items.map((i) => ({ id: i.id, quantity_received: Number(received[i.id] || 0) })),
        }),
      ) as Promise<PurchaseOrder>,
    onSuccess: (r) => {
      toast.success(`Recepción guardada · ${PO_STATUS_LABEL[r.status]}`);
      refresh();
    },
    onError: toast.error,
  });

  const canReceive = po && ['enviada', 'recibida_parcial', 'recibida'].includes(po.status);
  const editable = po && po.status !== 'cancelada';

  return (
    <>
      <Modal
        open={Boolean(poId)}
        onClose={onClose}
        wide
        title={po ? `Orden de compra ${po.number}` : 'Orden de compra'}
        footer={
          po && (
            <>
              {po.status !== 'cancelada' && po.status !== 'recibida' && (
                <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" icon={<Ban className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('cancelada')}>
                  Cancelar OC
                </Button>
              )}
              <Button variant="secondary" icon={<Eye className="h-4 w-4" />} loading={pdfBusy} onClick={() => void showPreview()}>
                Vista previa
              </Button>
              <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} loading={pdfBusy} onClick={() => void download()}>
                PDF
              </Button>
              {editable && (
                <Button icon={<Mail className="h-4 w-4" />} onClick={() => setEmailOpen(true)}>
                  Enviar al proveedor
                </Button>
              )}
            </>
          )
        }
      >
        {q.isLoading || !po ? (
          q.error ? <ErrorBox error={q.error} /> : <Spinner />
        ) : (
          <div className="space-y-5" data-testid="po-detail">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Proveedor</p>
                <p className="font-medium text-navy-900">{po.suppliers?.name}</p>
                <p className="text-xs text-slate-500">{po.suppliers?.email ?? 'Sin correo registrado'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Estado</p>
                <Badge tone={PO_STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>
                {po.sent_at && <p className="mt-1 text-xs text-slate-500">Enviada {dateTime(po.sent_at)}</p>}
              </div>
              <div>
                <p className="text-xs text-slate-500">Condiciones</p>
                <p className="text-sm">{po.payment_terms || '—'}</p>
                <p className="text-xs text-slate-500">Esperada {dateOnly(po.expected_at)}</p>
              </div>
            </div>

            {po.status === 'borrador' && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
                <span>Está en borrador. Enviala al proveedor por correo, o marcala como enviada si la mandaste por tu cuenta.</span>
                <Button size="sm" variant="secondary" icon={<Send className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('enviada')}>
                  Ya la mandé yo
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-3">Descripción</th>
                    <th className="py-2 pr-3 text-right">Cant.</th>
                    <th className="py-2 pr-3 text-right">Costo</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    {canReceive && <th className="w-28 py-2 text-right">Recibido</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 pr-3">{it.description}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">{num(it.quantity, 3)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">{money(it.unit_cost)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-medium">{money(Number(it.quantity) * Number(it.unit_cost))}</td>
                      {canReceive && (
                        <td className="py-1.5 text-right">
                          <Input
                            aria-label={`Recibido de ${it.description}`}
                            type="number"
                            min={0}
                            max={Number(it.quantity)}
                            step="any"
                            className="h-9 text-right"
                            value={received[it.id] ?? '0'}
                            onChange={(e) => setReceived((r) => ({ ...r, [it.id]: e.target.value }))}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              {canReceive ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setReceived(Object.fromEntries(items.map((i) => [i.id, String(Number(i.quantity))])))}
                  >
                    Recibí todo
                  </Button>
                  <Button size="sm" icon={<PackageCheck className="h-4 w-4" />} loading={receive.isPending} onClick={() => receive.mutate()}>
                    Guardar recepción
                  </Button>
                </div>
              ) : (
                <span />
              )}
              <dl className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd>{money(po.total_cost)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">IVA ({num(po.tax_rate, 2)} %)</dt>
                  <dd>{money(po.tax_total)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-navy-900">
                  <dt>Total</dt>
                  <dd>{money(po.grand_total)}</dd>
                </div>
              </dl>
            </div>
            {canReceive && (
              <p className="text-xs text-slate-500">
                Al recibir todo, la OC pasa sola a "Recibida". La etapa "Recepción" del pedido se marca aparte (arriba en el pedido) para que quede quién y cuándo.
              </p>
            )}
            {po.notes && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Notas: {po.notes}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(preview)}
        onClose={() => {
          if (preview) URL.revokeObjectURL(preview);
          setPreview(null);
        }}
        wide
        title={`Vista previa · ${po?.number ?? ''}`}
      >
        {preview && <iframe title="Vista previa de la orden de compra" src={preview} className="h-[70vh] w-full rounded-lg border border-slate-200" />}
      </Modal>

      {po && (
        <PoEmailModal
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          po={po}
          makePdf={makePdf}
          companyName={settings?.company_name}
          onSent={refresh}
        />
      )}
    </>
  );
}

function PoEmailModal({
  open,
  onClose,
  po,
  makePdf,
  companyName,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  po: PoFull;
  makePdf: () => Promise<jsPDF>;
  companyName?: string;
  onSent: () => void;
}) {
  const toast = useToast();
  const { profile, session } = useAuth();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [copyMe, setCopyMe] = useState(true);

  useEffect(() => {
    if (!open) return;
    const company = companyName || 'Printer Computers & Systems';
    setTo(po.suppliers?.email ?? '');
    setCc('');
    setSubject(`Orden de compra ${po.number} — ${company}`);
    setMessage(
      `Buen día${po.suppliers?.contact_name ? ` ${po.suppliers.contact_name}` : ''}:\n\n` +
        `Adjunto la orden de compra ${po.number}.` +
        `${po.expected_at ? ` La necesitamos para el ${po.expected_at.split('-').reverse().join('/')}.` : ''}\n\n` +
        `Por favor confirmar la recepción de esta orden y la fecha de entrega.\n\n` +
        `Saludos cordiales,\n${profile?.full_name ?? ''}\n${company}`,
    );
    setCopyMe(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toList = splitEmails(to);
  const ccList = splitEmails(cc);
  const invalid = [...toList, ...ccList].find((e) => !EMAIL_RE.test(e));

  const send = useMutation({
    mutationFn: async () => {
      if (!toList.length) throw new Error('Escribí el correo del proveedor.');
      if (invalid) throw new Error(`Correo inválido: ${invalid}`);
      const pdf = await makePdf();
      const { data, error } = await supabase.functions.invoke('send-purchase-order', {
        body: {
          po_id: po.id,
          to: toList,
          cc: ccList,
          copy_me: copyMe,
          subject: subject.trim(),
          message: message.trim(),
          pdf_base64: await blobToBase64(pdf.output('blob')),
          filename: `${po.number}.pdf`,
        },
      });
      if (error) throw new Error(await functionError(error, 'send-purchase-order'));
      return data as { warning: string | null };
    },
    onSuccess: (r) => {
      toast.success(`Orden de compra enviada a ${toList.join(', ')}`);
      if (r?.warning) toast.error(r.warning);
      onSent();
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Enviar ${po.number} al proveedor`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!toList.length || Boolean(invalid)} onClick={() => send.mutate()}>
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Para" required hint={po.suppliers?.email ? 'Correo registrado del proveedor.' : undefined}>
          <Input inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ventas@proveedor.com" />
        </Field>
        {!po.suppliers?.email && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Este proveedor no tiene correo registrado. Podés agregarlo en Proveedores.</p>}
        <Field label="Copia (CC)">
          <Input inputMode="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Opcional" />
        </Field>
        {invalid && <p className="text-xs text-red-600">Revisá este correo: {invalid}</p>}
        <Field label="Asunto" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Mensaje">
          <Textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
          <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">{po.number}.pdf</span>
          <span className="ml-auto whitespace-nowrap text-slate-500">{money(po.grand_total)}</span>
        </div>
        <Checkbox label={`Enviarme una copia${session?.user.email ? ` (${session.user.email})` : ''}`} checked={copyMe} onChange={(e) => setCopyMe(e.target.checked)} />
        <p className="text-xs text-slate-500">
          Si el proveedor responde, la respuesta te llega a vos.{po.status === 'borrador' && ' Al enviarla, la orden pasa de "Borrador" a "Enviada".'}
        </p>
      </div>
    </Modal>
  );
}
