# Printer Business Hub

Aplicación web privada para el ciclo comercial de Printer Computers & Systems:
**prospecto → visita → cotización → seguimiento → aceptación → pedido → compra/recepción → entrega → análisis**.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind, supabase-js, React Query, Recharts, jsPDF.
- **Backend:** Supabase (Auth + Postgres). La lógica crítica vive en la base de datos:
  RLS por rol, numeración única, cálculo de totales/IVA, flujo de estados, etapas de pedido y auditoría.

## Puesta en marcha (≈15 min)

### 1. Supabase
1. Creá un proyecto en [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers → Email:** desactivá *Allow new users to sign up* (solo por invitación).
3. **Authentication → URL Configuration:** poné la URL donde vas a publicar (p. ej. `https://hub.printercomputers.com`) como *Site URL*.
4. Aplicá las migraciones (incluyen los datos demo, que se cargan **una sola vez**):
   ```bash
   npx supabase login
   npx supabase link --project-ref <tu-ref>
   npx supabase db push
   ```
   Alternativa sin CLI: pegá en el SQL Editor cada archivo de `supabase/migrations/` en orden.

### 2. Invitaciones (Edge Function) y primer administrador
1. Desplegá la función que permite invitar usuarios desde el Hub:
   ```bash
   npx supabase functions deploy invite-user
   npx supabase secrets set SITE_URL=https://hub.printercomputers.com
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente.
   La service key vive solo en la función; nunca en el navegador.
2. **Authentication → URL Configuration → Redirect URLs:** agregá la URL del Hub (y `http://localhost:8080` para desarrollo).
3. Solo el **primer** administrador se crea a mano: en **Authentication → Users → Invite user** invitá a José Miguel,
   y cuando defina su contraseña ejecutá `supabase/bootstrap_admin.sql` (cambiando el correo).
4. De ahí en adelante José Miguel invita a todos desde **Configuración → Usuarios y roles → Invitar usuario**:
   correo, nombre y roles. El Hub genera un enlace de un solo uso para copiar o mandar por WhatsApp
   (opcionalmente también por correo). Si alguien pierde el enlace u olvida la contraseña, **"Enlace de acceso"** genera uno nuevo.

> El correo integrado de Supabase tiene límites estrictos (y en proyectos nuevos puede entregar solo a miembros del equipo).
> Por eso el enlace siempre se muestra en pantalla. Para enviar correos sin límites, configurá un SMTP propio en
> Authentication → Emails → SMTP Settings.

### 2b. Envío de cotizaciones por correo (Resend, opcional)
La función `send-quote-email` manda la cotización con el PDF adjunto y la pasa a "Enviada" (o registra el reenvío).
1. En [resend.com](https://resend.com): agregá el dominio `printercomputers.com` y copiá sus registros DNS (MX/TXT en `send.` y `resend._domainkey`)
   donde se administra el DNS (hoy, Vercel → Domains). No reemplazan ningún registro existente.
2. Resend → API Keys → crear una con permiso *Sending access*.
3. Supabase → Edge Functions → Secrets: `RESEND_API_KEY` = la clave, `RESEND_FROM` = `Printer Computers <cotizaciones@printercomputers.com>`.
4. Publicar la función: `npx supabase functions deploy send-quote-email`, o en el panel Edge Functions → *Deploy a new function* → *Via Editor*,
   nombre `send-quote-email`, pegar `supabase/functions/send-quote-email/index.ts`.

Sin estos pasos la app sigue funcionando: el botón avisa que el envío no está activado y se puede usar "Ya la mandé yo".
La API key nunca llega al navegador; la función valida la sesión del usuario y lee la cotización con sus permisos (RLS).

### 3. Frontend
```bash
cp .env.example .env      # URL y anon key de Supabase → Project Settings → API
npm install
npm run dev               # http://localhost:8080
```

### 4. Publicar
Cualquier hosting estático sirve (`npm run build` → `dist/`). Incluye `vercel.json` (rewrites SPA) y `robots.txt` con `noindex`.
En Vercel: importá el repo y agregá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, **o** usá la integración Supabase de Vercel con el prefijo `SUPABASE` (crea `SUPABASE_URL` y `SUPABASE_ANON_KEY`, que la app también reconoce). Luego el dominio `hub.printercomputers.com`.
Si preferís Lovable, conectá este repo por GitHub; Lovable puede editar la UI sin tocar la base de datos.

### 5. Datos de la empresa
En **Configuración → Empresa e impuestos** cargá razón social, NIT, NRC, dirección, contacto, logo (URL pública PNG/JPG), IVA por defecto,
vigencia y condiciones. Nada de eso viene inventado: los campos vacíos no salen en el PDF.

## Roles y permisos (aplicados en Postgres/RLS)

| | Admin | Comercial | Cotizaciones/Operaciones |
|---|:-:|:-:|:-:|
| Clientes, contactos, tareas | ✔ | ✔ | ✔ |
| Visitas (crear/editar) | ✔ | ✔ | solo lectura |
| Cotizaciones: crear, editar, precios, PDF | ✔ | ver + PDF | ✔ |
| Cambiar estado (enviada, negociación, aceptada, rechazada) | ✔ | ✔ | ✔ |
| Cancelar / devolver a borrador | ✔ | — | ✔ |
| Seguimiento y comentarios | ✔ | ✔ | ✔ |
| Pedidos, etapas, órdenes de compra | ✔ | ver | ✔ |
| Costos, márgenes, proveedores | ✔ | — | ✔ |
| Usuarios, configuración, numeración, auditoría | ✔ | — | — |

El costo está en tablas separadas (`product_costs`, `quote_item_costs`, `purchase_orders`), así que un rol comercial
no lo recibe ni siquiera consultando la API directamente.

## Reglas de negocio que garantiza la base de datos

- **Números únicos** `PR-Q-2026-0001`, `PR-P-…`, `PR-OC-…`: los asigna un trigger con bloqueo de fila; se reinician cada año; no se pueden editar.
- **Totales:** se recalculan en el servidor al cambiar líneas, cargos/deducciones o la tasa de IVA; lo que mande el navegador se ignora.
  `src/lib/quoteMath.ts` replica la fórmula solo para la vista previa (probada contra los mismos casos).
- **Estados de cotización** solo vía `change_quote_status()` con transiciones válidas; rechazo exige motivo; aceptada/rechazada/cancelada quedan bloqueadas.
- **Aceptar no crea ni avanza el pedido.** `convert_quote_to_order()` crea el pedido conservando el vínculo con la cotización (1 a 1).
- **Compra, recepción, preparación y entrega** son etapas independientes vía `update_order_stage()`, con trazabilidad (quién/cuándo/comentario).
  No se puede recibir sin comprar, entregar sin preparar, ni cerrar sin entregar.
- **Auditoría** de cambios en clientes, productos, costos, cotizaciones, pedidos, roles y configuración.
- **Envío:** "Enviada" se registra al mandarla por correo desde el Hub (Resend) o, si se envió por fuera (PDF por correo/WhatsApp), con "Ya la mandé yo".

## Datos demo
5 clientes, 8 productos/servicios, 6 cotizaciones en 5 estados, 3 visitas, 3 tareas, 2 pedidos en etapas distintas,
2 proveedores y 1 OC. Todo con `is_demo = true` (insignia **Demo** en la UI y filtro en el dashboard).
Se insertan desde la migración `…_demo_seed.sql` mediante `apply_demo_seed()`, protegida por `seed_runs` + IDs fijos:
re-ejecutarla no duplica nada, y la app nunca la llama. No se borran automáticamente; cuando ya no se necesiten, un admin los elimina en **Configuración → Datos de demostración** (`purge_demo_data()`), que no toca registros reales.

## Pruebas
```bash
npm test                  # cálculo de cotizaciones (Vitest)
PGHOST=... PGUSER=postgres npm run test:db   # migraciones + RLS + flujo en un Postgres local
```
`supabase/tests/db_tests.sql` verifica: seed idempotente, totales, numeración bajo 50 inserciones, RLS por rol
(anon, sin rol, comercial, operaciones, admin), transiciones, bloqueo tras aceptar, conversión única a pedido y etapas separadas.

## Estructura
```
supabase/migrations/   esquema, lógica, RLS, reportes, seed demo, save_quote, borrado de demo
supabase/functions/    invite-user (invitaciones, solo admin) · send-quote-email (cotización por correo con Resend)
supabase/tests/        pruebas SQL
src/lib/               cliente Supabase, auth/roles, cálculo, PDF, CSV, formatos
src/components/        layout, UI y formularios
src/pages/             Dashboard, Clientes, Agenda, Cotizaciones, Pedidos, Productos, Proveedores, Reportes, Configuración
```

## Pendiente / siguientes pasos
- Subida de logo e imágenes de producto a Supabase Storage (hoy se usa URL).
- Programar `expire_overdue_quotes()` con pg_cron (hoy es un botón en Cotizaciones).
