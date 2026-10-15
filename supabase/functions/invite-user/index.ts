// Edge Function: invite-user
// Permite que un Administrador invite usuarios (o genere un nuevo enlace de acceso)
// sin entrar al panel de Supabase. La service_role key solo existe aquí, en el
// servidor; nunca llega al navegador.
//
// POST { email, full_name?, roles?: ('admin'|'comercial'|'operaciones')[], send_email?: boolean }
//   - Usuario nuevo  → crea la invitación, asigna roles y devuelve el enlace.
//   - Usuario existe → asigna roles (si vienen) y devuelve un enlace para
//                      (re)definir contraseña.
// El enlace siempre se devuelve para compartirlo por WhatsApp o copiarlo.
// Si send_email = true, además se envía por correo:
//   - con Resend (secretos RESEND_API_KEY y RESEND_FROM), correo propio con el logo; o
//   - si no hay Resend, con el correo de Supabase (limitado).

import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'comercial', 'operaciones'] as const;
type Role = (typeof ROLES)[number];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', comercial: 'Comercial', operaciones: 'Cotizaciones/Operaciones' };

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Correo de acceso con el mismo diseño que el de cotizaciones (logo + Poppins con respaldo Arial). */
function accessEmailHtml(o: { company: string; logoUrl: string; name: string; inviter: string; isNew: boolean; roles: string[]; link: string }) {
  const FONT = 'Poppins,Arial,Helvetica,sans-serif';
  const amp = o.company.indexOf(' & ');
  const main = amp > 0 ? o.company.slice(0, amp) : o.company;
  const sub = amp > 0 ? `&amp; ${esc(o.company.slice(amp + 3).toUpperCase())}` : '';
  const hello = o.name ? `Hola ${esc(o.name.split(' ')[0])}:` : 'Hola:';
  const body = o.isNew
    ? `${esc(o.inviter)} te dio acceso a <b>Printer Business Hub</b>, el sistema interno de clientes, cotizaciones y pedidos de ${esc(o.company)}.` +
      (o.roles.length ? `<br><br>Tu rol: <b>${o.roles.map(esc).join(', ')}</b>.` : '') +
      '<br><br>Para entrar, primero creá tu contraseña con este botón:'
    : 'Recibimos una solicitud para definir una nueva contraseña de tu acceso a <b>Printer Business Hub</b>. Usá este botón:';
  const cta = o.isNew ? 'Crear mi contraseña' : 'Definir nueva contraseña';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"><!--<![endif]-->
<!--[if mso]><style>body,table,td,p,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head><body style="margin:0;padding:0;background:#eef2f7;font-family:${FONT};color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:${FONT}">
<tr><td style="padding:22px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="padding-right:14px;vertical-align:middle"><img src="${esc(o.logoUrl)}" width="54" height="55" alt="Printer" style="display:block;border:0;height:55px;width:auto"></td>
  <td style="vertical-align:middle;font-family:${FONT}"><div style="font-size:22px;line-height:1.15;font-weight:600;color:#0b1e3f">${esc(main)}</div>
  ${sub ? `<div style="font-size:11px;letter-spacing:2.5px;font-weight:600;color:#2563eb;margin-top:2px">${sub}</div>` : ''}</td>
</tr></table></td></tr>
<tr><td height="4" style="height:4px;line-height:4px;font-size:0;background-color:#2563eb;background-image:linear-gradient(90deg,#0b1e3f,#2563eb)">&nbsp;</td></tr>
<tr><td style="padding:26px 28px 6px;font-size:14px;line-height:1.7;color:#1e293b;font-family:${FONT}">${hello}<br><br>${body}</td></tr>
<tr><td align="left" style="padding:18px 28px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#1d6fe8">
    <a href="${esc(o.link)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${cta}</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:14px 28px 26px;font-size:12px;line-height:1.6;color:#64748b;font-family:${FONT}">
  El enlace es personal, de un solo uso y vence en poco tiempo. Si ya venció, pedile uno nuevo al administrador.<br>
  Si el botón no funciona, copiá esta dirección en el navegador:<br><a href="${esc(o.link)}" style="color:#1d6fe8;word-break:break-all">${esc(o.link)}</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;font-family:${FONT}">
  ${esc(o.company)} · Uso interno. Si no esperabas este correo, podés ignorarlo.
</td></tr>
</table></td></tr></table></body></html>`;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Sesión requerida' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'Función mal configurada' });

  // 1) ¿Quién llama? Se valida con SU token y las mismas reglas de la BD.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json(401, { error: 'Sesión inválida' });
  const { data: isAdmin, error: roleErr } = await caller.rpc('has_role', { _role: 'admin' });
  if (roleErr || isAdmin !== true) return json(403, { error: 'Solo un administrador puede invitar usuarios' });

  // 2) Validar datos
  let body: { email?: string; full_name?: string; roles?: string[]; send_email?: boolean };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'JSON inválido' });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const fullName = (body.full_name ?? '').trim();
  const roles = [...new Set(body.roles ?? [])] as Role[];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Correo inválido' });
  if (roles.some((r) => !ROLES.includes(r))) return json(400, { error: 'Rol desconocido' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const redirectTo = Deno.env.get('SITE_URL') ?? req.headers.get('origin') ?? undefined;

  // 3) ¿Ya existe?
  const { data: existing } = await admin.from('profiles').select('id, full_name').eq('email', email).maybeSingle();

  let userId: string;
  let link: string | null = null;
  let emailSent = false;
  let emailError: string | null = null;
  let emailVia: 'resend' | 'supabase' | null = null;
  const isNew = !existing;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const useResend = Boolean(body.send_email && resendKey);

  if (isNew) {
    if (roles.length === 0) return json(400, { error: 'Elegí al menos un rol para el nuevo usuario' });
    if (body.send_email && !useResend) {
      // Sin Resend: correo de invitación de Supabase (limitado)
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
      if (error) {
        emailError = error.message;
      } else {
        emailSent = true;
        emailVia = 'supabase';
        userId = data.user.id;
      }
    }
    // Enlace para compartir (crea el usuario si todavía no existe)
    const { data, error } = emailSent
      ? await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
      : await admin.auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name: fullName }, redirectTo } });
    if (error) return json(400, { error: `No se pudo crear la invitación: ${error.message}` });
    userId = data.user.id;
    link = data.properties?.action_link ?? null;
  } else {
    userId = existing.id;
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    if (error) return json(400, { error: `No se pudo generar el enlace: ${error.message}` });
    link = data.properties?.action_link ?? null;
    if (body.send_email && !useResend) {
      const { error: mailErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (mailErr) emailError = mailErr.message;
      else {
        emailSent = true;
        emailVia = 'supabase';
      }
    }
  }

  // Con Resend: correo propio con el mismo enlace que se muestra en pantalla
  if (useResend && link) {
    const { data: settings } = await admin.from('company_settings').select('company_name, logo_url').eq('id', 1).maybeSingle();
    const { data: inviter } = await admin.from('profiles').select('full_name').eq('id', userData.user.id).maybeSingle();
    const company = settings?.company_name || 'Printer Computers & Systems';
    const siteUrl = (Deno.env.get('SITE_URL') ?? req.headers.get('origin') ?? 'https://hub.printercomputers.com').replace(/\/$/, '');
    const name = fullName || existing?.full_name || '';
    const html = accessEmailHtml({
      company,
      logoUrl: settings?.logo_url || `${siteUrl}/logo.png`,
      name,
      inviter: inviter?.full_name || userData.user.email || company,
      isNew,
      roles: roles.map((r) => ROLE_LABEL[r]),
      link,
    });
    const res = await fetch(`${Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') ?? 'Printer Computers <onboarding@resend.dev>',
        to: [email],
        reply_to: userData.user.email ?? undefined,
        subject: isNew ? 'Tu acceso a Printer Business Hub' : 'Definí tu nueva contraseña · Printer Business Hub',
        html,
        text: `${name ? `Hola ${name.split(' ')[0]}:` : 'Hola:'}\n\n${isNew ? 'Te dieron acceso a Printer Business Hub. Creá tu contraseña aquí:' : 'Definí tu nueva contraseña de Printer Business Hub aquí:'}\n${link}\n\nEl enlace es personal, de un solo uso y vence en poco tiempo.\n\n${company}`,
      }),
    });
    if (res.ok) {
      emailSent = true;
      emailVia = 'resend';
    } else {
      const out = await res.json().catch(() => ({}));
      emailError = `Resend: ${(out as { message?: string }).message ?? `HTTP ${res.status}`}`;
    }
  }

  // 4) Perfil y roles (el trigger handle_new_user ya creó el perfil)
  if (fullName && (!existing || !existing.full_name)) {
    await admin.from('profiles').update({ full_name: fullName }).eq('id', userId!);
  }
  if (roles.length) {
    const { error } = await admin
      .from('user_roles')
      .upsert(roles.map((role) => ({ user_id: userId!, role, created_by: userData.user.id })), { onConflict: 'user_id,role', ignoreDuplicates: true });
    if (error) return json(500, { error: `Usuario creado, pero falló la asignación de roles: ${error.message}` });
  }

  return json(200, { user_id: userId!, is_new: isNew, link, email_sent: emailSent, email_via: emailVia, email_error: emailError });
});
