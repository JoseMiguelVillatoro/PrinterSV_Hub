// Edge Function: send-quote-email
// Envía una cotización por correo (con el PDF adjunto) usando Resend y la
// registra en el historial. La API key de Resend vive solo aquí, como secreto
// de Supabase; nunca llega al navegador.
//
// POST {
//   quote_id: string,
//   to: string[], cc?: string[], copy_me?: boolean,
//   subject: string, message: string,
//   pdf_base64: string, filename: string
// }
// - Quien llama debe poder ver la cotización (se valida con SU sesión y las
//   mismas reglas RLS de la base de datos).
// - Si la cotización está en Borrador / Pendiente de envío / Vencida, pasa a
//   "Enviada" con el RPC normal (mismas reglas que el botón Cambiar estado).
// - Si ya estaba enviada o en negociación, queda un comentario "Reenviada…".
//
// Secretos (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   re_xxxxxxxx
//   RESEND_FROM      Printer Computers <cotizaciones@printercomputers.com>

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MARKS_SENT = ['borrador', 'pendiente_envio', 'vencida'];
const CAN_RESEND = ['enviada', 'negociacion'];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(n) || 0);
  } catch {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Sesión requerida' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM') ?? 'Printer Computers <onboarding@resend.dev>';
  const resendApi = Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com';
  if (!url || !anonKey) return json(500, { error: 'Función mal configurada' });
  if (!resendKey) return json(503, { error: 'El envío por correo aún no está activado: falta el secreto RESEND_API_KEY en Supabase.' });

  // 1) ¿Quién llama? Todo se consulta con SU sesión → aplica RLS.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json(401, { error: 'Sesión inválida' });
  const user = userData.user;

  // 2) Validar datos
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'JSON inválido' });
  }
  const quoteId = String(body.quote_id ?? '');
  const to = cleanList(body.to);
  const cc = cleanList(body.cc);
  const subject = String(body.subject ?? '').trim();
  const message = String(body.message ?? '').trim();
  const pdf = String(body.pdf_base64 ?? '');
  const filename = String(body.filename ?? 'cotizacion.pdf').replace(/[^\w.\- ]/g, '_');

  if (!quoteId) return json(400, { error: 'Falta la cotización' });
  if (to.length === 0) return json(400, { error: 'Escribí al menos un correo destinatario' });
  const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
  if (bad) return json(400, { error: `Correo inválido: ${bad}` });
  if (to.length + cc.length > 10) return json(400, { error: 'Máximo 10 destinatarios' });
  if (!subject) return json(400, { error: 'Escribí un asunto' });
  if (!pdf || pdf.length * 0.75 > MAX_PDF_BYTES) return json(400, { error: 'El PDF falta o es demasiado grande' });

  const { data: quote, error: qErr } = await caller
    .from('v_quotes')
    .select('id, number, status, total, currency, valid_until, client_name')
    .eq('id', quoteId)
    .maybeSingle();
  if (qErr || !quote) return json(404, { error: 'Cotización no encontrada o sin permiso' });
  if (![...MARKS_SENT, ...CAN_RESEND].includes(quote.status)) {
    return json(409, { error: 'Esta cotización ya está cerrada; no se puede enviar.' });
  }

  const { data: settings } = await caller.from('company_settings').select('company_name, phone, email, website').maybeSingle();
  const { data: profile } = await caller.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle();
  const company = settings?.company_name || 'Printer Computers & Systems';
  const sender = profile?.full_name || user.email || company;

  // 3) Armar el correo
  const msgHtml = esc(message).replace(/\n/g, '<br>');
  const contactBits = [settings?.phone, settings?.email, settings?.website].filter(Boolean).map((s) => esc(String(s))).join(' · ');
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b1e3f;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:bold">${esc(company)}</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6">${msgHtml}</td></tr>
<tr><td style="padding:0 24px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">
<tr><td style="padding:12px 16px;color:#64748b">Cotización</td><td style="padding:12px 16px;text-align:right;font-weight:bold">${esc(quote.number)}</td></tr>
<tr><td style="padding:0 16px 12px;color:#64748b">Total</td><td style="padding:0 16px 12px;text-align:right;font-weight:bold">${esc(money(quote.total, quote.currency))}</td></tr>
${quote.valid_until ? `<tr><td style="padding:0 16px 12px;color:#64748b">Válida hasta</td><td style="padding:0 16px 12px;text-align:right">${esc(String(quote.valid_until).split('-').reverse().join('/'))}</td></tr>` : ''}
</table>
<p style="font-size:12px;color:#64748b;margin:12px 0 0">El detalle completo va en el PDF adjunto.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">${esc(sender)} · ${esc(company)}${contactBits ? `<br>${contactBits}` : ''}</td></tr>
</table></td></tr></table></body></html>`;

  const bcc = body.copy_me && user.email && !to.includes(user.email) && !cc.includes(user.email) ? [user.email] : [];

  // 4) Enviar con Resend
  const res = await fetch(`${resendApi}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      reply_to: user.email ?? undefined,
      subject,
      html,
      text: `${message}\n\nCotización ${quote.number} · Total ${money(quote.total, quote.currency)}\nEl detalle va en el PDF adjunto.\n\n${sender} · ${company}`,
      attachments: [{ filename, content: pdf }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (out as { message?: string }).message ?? `HTTP ${res.status}`;
    return json(502, { error: `Resend rechazó el envío: ${detail}` });
  }

  // 5) Registrar en el historial (con la sesión del usuario → mismas reglas)
  const recipients = [...to, ...cc].join(', ');
  let warning: string | null = null;
  if (MARKS_SENT.includes(quote.status)) {
    const { error } = await caller.rpc('change_quote_status', {
      p_quote_id: quoteId,
      p_status: 'enviada',
      p_comment: `Enviada por correo a ${recipients}`,
      p_rejection_reason: null,
    });
    if (error) warning = `El correo salió, pero no se pudo cambiar el estado: ${error.message}`;
  } else {
    const { error } = await caller
      .from('quote_events')
      .insert({ quote_id: quoteId, event_type: 'comentario', comment: `Reenviada por correo a ${recipients}`, created_by: user.id });
    if (error) warning = `El correo salió, pero no quedó en el historial: ${error.message}`;
  }

  return json(200, { id: (out as { id?: string }).id ?? null, to, cc, warning });
});
