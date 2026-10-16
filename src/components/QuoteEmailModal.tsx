import { useMutation } from '@tanstack/react-query';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { Paperclip, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { QUOTE_STATUS_LABEL, money } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Client, CompanySettings, Contact, QuoteView } from '@/lib/types';
import type { jsPDF } from 'jspdf';
import { Button, Checkbox, Field, Input, Modal, Textarea } from './ui';

/** Estados en los que enviar por correo también pasa la cotización a "Enviada". */
export const EMAIL_MARKS_SENT = ['borrador', 'pendiente_envio', 'vencida'] as const;
/** Estados en los que se puede (re)enviar por correo. */
export const EMAIL_ALLOWED = [...EMAIL_MARKS_SENT, 'enviada', 'negociacion'] as const;

export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const splitEmails = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const notEnabled = (fn: string) =>
  `El envío por correo todavía no está activado en Supabase (falta publicar la función "${fn}" o el secreto de Resend). Mientras tanto, descargá el PDF y mandalo por tu cuenta.`;

export async function functionError(error: unknown, fn = 'send-quote-email'): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const ctx = error.context as Response;
    if (ctx.status === 404) {
      const detail = await ctx.clone().json().catch(() => null);
      return detail?.error && !/function/i.test(detail.error) ? detail.error : notEnabled(fn);
    }
    const detail = await ctx.json().catch(() => null);
    return detail?.error ?? error.message;
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) return notEnabled(fn);
  return error instanceof Error ? error.message : String(error);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function QuoteEmailModal({
  open,
  onClose,
  quote,
  client,
  contact,
  settings,
  makePdf,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  quote: QuoteView;
  client: Client;
  contact: Contact | null;
  settings: CompanySettings | undefined;
  makePdf: () => Promise<jsPDF>;
  onSent: () => void;
}) {
  const toast = useToast();
  const { profile, session } = useAuth();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [copyMe, setCopyMe] = useState(true);
  const [saveToClient, setSaveToClient] = useState(true);

  const registered = contact?.email || client.email || '';
  const marksSent = (EMAIL_MARKS_SENT as readonly string[]).includes(quote.status);

  // Se rellena cada vez que se abre (no mientras el usuario escribe).
  useEffect(() => {
    if (!open) return;
    const company = settings?.company_name || 'Printer Computers & Systems';
    const greetName = contact?.full_name?.split(' ')[0] || client.name;
    setTo(registered);
    setCc(contact?.email && client.email && client.email !== contact.email ? client.email : '');
    setSubject(`Cotización ${quote.number}${quote.title ? ` · ${quote.title}` : ''} — ${company}`);
    setMessage(
      `Estimado(a) ${greetName}:\n\n` +
        `Adjunto la cotización ${quote.number}${quote.title ? ` (${quote.title})` : ''} que nos solicitó.` +
        `${quote.valid_until ? ` Los precios son válidos hasta el ${quote.valid_until.split('-').reverse().join('/')}.` : ''}\n\n` +
        `Quedo pendiente de cualquier consulta o ajuste.\n\n` +
        `Saludos cordiales,\n${profile?.full_name ?? ''}\n${company}`,
    );
    setCopyMe(true);
    setSaveToClient(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toList = splitEmails(to);
  const ccList = splitEmails(cc);
  const invalid = [...toList, ...ccList].find((e) => !EMAIL_RE.test(e));
  const canSaveToClient = !registered && toList.length > 0 && !invalid;

  const send = useMutation({
    mutationFn: async () => {
      if (toList.length === 0) throw new Error('Escribí el correo del cliente.');
      if (invalid) throw new Error(`Correo inválido: ${invalid}`);
      if (!subject.trim()) throw new Error('Escribí un asunto.');
      const pdf = await makePdf();
      const pdf_base64 = await blobToBase64(pdf.output('blob'));
      const { data, error } = await supabase.functions.invoke('send-quote-email', {
        body: {
          quote_id: quote.id,
          to: toList,
          cc: ccList,
          copy_me: copyMe,
          subject: subject.trim(),
          message: message.trim(),
          pdf_base64,
          filename: `${quote.number}.pdf`,
        },
      });
      if (error) throw new Error(await functionError(error));
      if (canSaveToClient && saveToClient) {
        await supabase.from('clients').update({ email: toList[0] }).eq('id', client.id);
      }
      return data as { warning: string | null };
    },
    onSuccess: (r) => {
      toast.success(`Cotización enviada a ${toList.join(', ')}`);
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
      title={`Enviar ${quote.number} por correo`}
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
        <Field label="Para" required hint={registered ? 'Correo registrado del cliente. Podés agregar más separados por coma.' : undefined}>
          <Input type="text" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="cliente@empresa.com" autoFocus={!registered} />
        </Field>
        {!registered && (
          <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <p>Este cliente no tiene correo registrado.</p>
            {canSaveToClient && <Checkbox label="Guardar este correo en la ficha del cliente" checked={saveToClient} onChange={(e) => setSaveToClient(e.target.checked)} />}
          </div>
        )}
        <Field label="Copia (CC)">
          <Input type="text" inputMode="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Opcional" />
        </Field>
        {invalid && <p className="text-xs text-red-600">Revisá este correo: {invalid}</p>}
        <Field label="Asunto" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Mensaje">
          <Textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
          <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">{quote.number}.pdf</span>
          <span className="ml-auto whitespace-nowrap text-slate-500">{money(quote.total, quote.currency)}</span>
        </div>
        <Checkbox label={`Enviarme una copia${session?.user.email ? ` (${session.user.email})` : ''}`} checked={copyMe} onChange={(e) => setCopyMe(e.target.checked)} />
        <p className="text-xs text-slate-500">
          Si el cliente responde, la respuesta te llega a vos.
          {marksSent && <> Al enviarla, la cotización pasa de "{QUOTE_STATUS_LABEL[quote.status]}" a "Enviada".</>}
          {!marksSent && ' Queda registrado en el historial como reenvío.'}
        </p>
      </div>
    </Modal>
  );
}
