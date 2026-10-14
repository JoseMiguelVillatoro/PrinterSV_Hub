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
// Si send_email = true, además se envía por correo (requiere SMTP en Supabase).

import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'comercial', 'operaciones'] as const;
type Role = (typeof ROLES)[number];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  const isNew = !existing;

  if (isNew) {
    if (roles.length === 0) return json(400, { error: 'Elegí al menos un rol para el nuevo usuario' });
    if (body.send_email) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
      if (error) {
        emailError = error.message;
      } else {
        emailSent = true;
        userId = data.user.id;
      }
    }
    // Enlace para compartir (también crea el usuario si el correo no se envió)
    const { data, error } = await admin.auth.admin.generateLink({
      type: emailSent ? 'recovery' : 'invite',
      email,
      options: { data: { full_name: fullName }, redirectTo },
    });
    if (error) return json(400, { error: `No se pudo crear la invitación: ${error.message}` });
    userId = data.user.id;
    link = data.properties?.action_link ?? null;
  } else {
    userId = existing.id;
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    if (error) return json(400, { error: `No se pudo generar el enlace: ${error.message}` });
    link = data.properties?.action_link ?? null;
    if (body.send_email) {
      const { error: mailErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (mailErr) emailError = mailErr.message;
      else emailSent = true;
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

  return json(200, { user_id: userId!, is_new: isNew, link, email_sent: emailSent, email_error: emailError });
});
