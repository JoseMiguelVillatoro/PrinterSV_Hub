// Edge Function: send-purchase-order
// Envía una orden de compra al proveedor (PDF adjunto) con Resend.
// Mismo diseño de correo que las cotizaciones. La API key de Resend vive solo aquí.
//
// POST { po_id, to: string[], cc?: string[], copy_me?: boolean, subject, message, pdf_base64, filename }
// - Solo quien ve costos (Admin y Cotizaciones/Operaciones) puede enviarla: se valida
//   con SU sesión y las reglas RLS (la OC no se puede leer sin ese permiso).
// - Si la OC está en Borrador pasa a "Enviada" (fecha de pedido = hoy si no tenía).
//
// Usa los mismos secretos que send-quote-email: RESEND_API_KEY y RESEND_FROM.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

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
  const poId = String(body.po_id ?? '');
  const to = cleanList(body.to);
  const cc = cleanList(body.cc);
  const subject = String(body.subject ?? '').trim();
  const message = String(body.message ?? '').trim();
  const pdf = String(body.pdf_base64 ?? '');
  const filename = String(body.filename ?? 'orden-de-compra.pdf').replace(/[^\w.\- ]/g, '_');

  if (!poId) return json(400, { error: 'Falta la orden de compra' });
  if (to.length === 0) return json(400, { error: 'Escribí al menos un correo destinatario' });
  const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
  if (bad) return json(400, { error: `Correo inválido: ${bad}` });
  if (to.length + cc.length > 10) return json(400, { error: 'Máximo 10 destinatarios' });
  if (!subject) return json(400, { error: 'Escribí un asunto' });
  if (!pdf || pdf.length * 0.75 > MAX_PDF_BYTES) return json(400, { error: 'El PDF falta o es demasiado grande' });

  // RLS: solo quien ve costos puede leer la OC
  const { data: po, error: poErr } = await caller
    .from('purchase_orders')
    .select('id, number, status, grand_total, expected_at, ordered_at, sent_at, suppliers(name)')
    .eq('id', poId)
    .maybeSingle();
  if (poErr || !po) return json(404, { error: 'Orden de compra no encontrada o sin permiso' });
  if (po.status === 'cancelada') return json(409, { error: 'Esta orden de compra está cancelada; no se puede enviar.' });

  const { data: settings } = await caller.from('company_settings').select('company_name, phone, email, website, logo_url').maybeSingle();
  const { data: profile } = await caller.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle();
  const company = settings?.company_name || 'Printer Computers & Systems';
  const sender = profile?.full_name || user.email || company;

  // 3) Armar el correo
  const msgHtml = esc(message).replace(/\n/g, '<br>');
  const contactBits = [settings?.phone, settings?.email, settings?.website].filter(Boolean).map((s) => esc(String(s))).join(' · ');
  // Logo: el de Configuración si tiene URL; si no, el de la app (hub.printercomputers.com/logo.png).
  const siteUrl = (Deno.env.get('SITE_URL') ?? req.headers.get('origin') ?? 'https://hub.printercomputers.com').replace(/\/$/, '');
  const logoUrl = settings?.logo_url || `${siteUrl}/logo.png`;
  // "Printer Computers & Systems" → título grande + "& SYSTEMS" pequeño.
  const amp = company.indexOf(' & ');
  const brandMain = amp > 0 ? company.slice(0, amp) : company;
  const brandSub = amp > 0 ? `&amp; ${esc(company.slice(amp + 3).toUpperCase())}` : '';
  // Poppins donde el programa de correo la soporta (Apple Mail, iPhone, algunos Android);
  // en Outlook/Gmail cae en Arial. El bloque mso evita que Outlook use Times New Roman.
  const FONT = "Poppins,Arial,Helvetica,sans-serif";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"><!--<![endif]-->
<!--[if mso]><style>body,table,td,p,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head><body style="margin:0;padding:0;background:#eef2f7;font-family:${FONT};color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:${FONT}">
<tr><td style="padding:22px 28px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:14px;vertical-align:middle"><img src="${esc(logoUrl)}" width="54" height="55" alt="Printer" style="display:block;border:0;height:55px;width:auto"></td>
    <td style="vertical-align:middle;font-family:${FONT}">
      <div style="font-size:22px;line-height:1.15;font-weight:600;color:#0b1e3f">${esc(brandMain)}</div>
      ${brandSub ? `<div style="font-size:11px;letter-spacing:2.5px;font-weight:600;color:#2563eb;margin-top:2px">${brandSub}</div>` : ''}
    </td>
  </tr></table>
</td></tr>
<tr><td height="4" style="height:4px;line-height:4px;font-size:0;background-color:#2563eb;background-image:linear-gradient(90deg,#0b1e3f,#2563eb)">&nbsp;</td></tr>
<tr><td style="padding:26px 28px 8px;font-size:14px;line-height:1.7;color:#1e293b;font-family:${FONT}">${msgHtml}</td></tr>
<tr><td style="padding:16px 28px 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:${FONT}">
<tr><td style="padding:14px 18px 6px;color:#64748b">Orden de compra</td><td style="padding:14px 18px 6px;text-align:right;font-weight:600;color:#0b1e3f">${esc(po.number)}</td></tr>
<tr><td style="padding:6px 18px;color:#64748b">Total (con IVA)</td><td style="padding:6px 18px;text-align:right;font-weight:600;font-size:20px;color:#0b1e3f">${esc(money(po.grand_total, 'USD'))}</td></tr>
${po.expected_at ? `<tr><td style="padding:6px 18px 14px;color:#64748b">Entrega esperada</td><td style="padding:6px 18px 14px;text-align:right;color:#0f172a">${esc(String(po.expected_at).split('-').reverse().join('/'))}</td></tr>` : '<tr><td colspan="2" style="height:8px"></td></tr>'}
</table>
<p style="font-size:12px;color:#64748b;margin:12px 0 0">📎 El detalle completo va en el PDF adjunto. Por favor confirmar la recepción de esta orden.</p>
</td></tr>
<tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;font-family:${FONT}"><span style="color:#0b1e3f;font-weight:500">${esc(sender)}</span> · ${esc(company)}${contactBits ? `<br>${contactBits}` : ''}</td></tr>
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
      text: `${message}\n\nOrden de compra ${po.number} · Total ${money(po.grand_total, 'USD')}\nEl detalle va en el PDF adjunto.\n\n${sender} · ${company}`,
      attachments: [{ filename, content: pdf }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (out as { message?: string }).message ?? `HTTP ${res.status}`;
    return json(502, { error: `Resend rechazó el envío: ${detail}` });
  }

  // 5) Marcar como enviada (con la sesión del usuario → mismas reglas)
  let warning: string | null = null;
  const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10); // El Salvador (UTC-6)
  const { error: upErr } = await caller
    .from('purchase_orders')
    .update({
      status: po.status === 'borrador' ? 'enviada' : po.status,
      ordered_at: po.ordered_at ?? today,
      sent_at: new Date().toISOString(),
    })
    .eq('id', poId);
  if (upErr) warning = `El correo salió, pero no se pudo actualizar la orden: ${upErr.message}`;

  return json(200, { id: (out as { id?: string }).id ?? null, to, cc, warning });
});
