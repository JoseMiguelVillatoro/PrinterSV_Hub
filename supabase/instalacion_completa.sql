-- ================================================================
-- Printer Business Hub — INSTALACIÓN COMPLETA (pegar UNA vez en Supabase → SQL Editor)
-- Equivale a las migraciones de supabase/migrations/ en orden.
-- Solo para una base NUEVA. Si ya instalaste antes, corré solo las migraciones nuevas.
-- ================================================================

-- >>> 20261014000001_base.sql
-- =====================================================================
-- Printer Business Hub — 0001: tipos, perfiles, roles y funciones helper
-- =====================================================================

create type public.app_role as enum ('admin', 'comercial', 'operaciones');

create type public.client_status as enum ('prospecto', 'activo', 'inactivo');
create type public.visit_status  as enum ('programada', 'realizada', 'cancelada');
create type public.task_status   as enum ('pendiente', 'completada', 'cancelada');
create type public.task_priority as enum ('baja', 'media', 'alta');
create type public.item_kind     as enum ('producto', 'servicio');
create type public.adjustment_kind as enum ('cargo', 'deduccion');

create type public.quote_status as enum (
  'borrador', 'pendiente_envio', 'enviada', 'negociacion',
  'aceptada', 'rechazada', 'vencida', 'cancelada'
);

create type public.order_status      as enum ('abierto', 'cerrado', 'cancelado');
create type public.purchase_stage    as enum ('no_aplica', 'pendiente', 'solicitada', 'comprada');
create type public.reception_stage   as enum ('no_aplica', 'pendiente', 'parcial', 'recibida');
create type public.preparation_stage as enum ('pendiente', 'en_proceso', 'lista');
create type public.delivery_stage    as enum ('pendiente', 'programada', 'parcial', 'entregada');
create type public.po_status         as enum ('borrador', 'enviada', 'recibida_parcial', 'recibida', 'cancelada');

-- ---------------------------------------------------------------------
-- Perfiles (1:1 con auth.users) y roles (tabla separada, nunca en el perfil)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (user_id, role)
);

-- Helpers de autorización. SECURITY DEFINER para que las políticas RLS
-- puedan consultar user_roles sin recursión.
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = _role
      and p.is_active
  );
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = any (_roles)
      and p.is_active
  );
$$;

-- Cualquier usuario activo con al menos un rol.
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_any_role(array['admin', 'comercial', 'operaciones']::public.app_role[]);
$$;

-- Costos, márgenes y compras: solo administración y operaciones.
create or replace function public.can_see_costs()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_any_role(array['admin', 'operaciones']::public.app_role[]);
$$;

create or replace function public.can_manage_quotes()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_any_role(array['admin', 'operaciones']::public.app_role[]);
$$;

create or replace function public.my_roles()
returns public.app_role[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(ur.role order by ur.role), '{}')
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active;
$$;

-- ---------------------------------------------------------------------
-- Utilidades genéricas
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Crear perfil al registrar/invitar un usuario en Supabase Auth.
-- No asigna roles: un usuario sin rol no ve ningún dato.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Solo un admin puede activar/desactivar usuarios (aunque el propio usuario
-- pueda editar su nombre).
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active is distinct from old.is_active and not public.has_role('admin') then
    raise exception 'Solo un administrador puede activar o desactivar usuarios';
  end if;
  if new.email is distinct from old.email and not public.has_role('admin') then
    raise exception 'El correo se administra desde la autenticación';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- Nunca dejar el sistema sin un administrador activo.
create or replace function public.tg_user_roles_keep_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and not exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin' and p.is_active and ur.user_id <> old.user_id
  ) then
    raise exception 'Debe existir al menos un administrador activo';
  end if;
  return old;
end;
$$;

create trigger user_roles_keep_admin before delete on public.user_roles
  for each row execute function public.tg_user_roles_keep_admin();

-- >>> 20261014000002_tables.sql
-- =====================================================================
-- Printer Business Hub — 0002: tablas de negocio
-- Todas las tablas de negocio tienen is_demo para distinguir datos de prueba.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración de la empresa (fila única). Datos fiscales y de contacto
-- quedan vacíos a propósito: se completan desde Configuración.
-- ---------------------------------------------------------------------
create table public.company_settings (
  id                   smallint primary key default 1 check (id = 1),
  company_name         text not null default 'Printer Computers & Systems',
  legal_name           text,
  tax_id               text,           -- NIT
  nrc                  text,           -- Registro de contribuyente
  address              text,
  phone                text,
  email                text,
  website              text,
  logo_url             text,
  default_tax_rate     numeric(5,2) not null default 13 check (default_tax_rate between 0 and 100),
  default_currency     text not null default 'USD',
  quote_validity_days  integer not null default 15 check (quote_validity_days > 0),
  default_quote_terms  text,
  quote_footer         text default 'Este documento es una cotización comercial y no constituye una factura fiscal.',
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid()
);
insert into public.company_settings (id) values (1);

-- Numeración única por tipo de documento y año: PR-Q-2026-0001
create table public.document_sequences (
  doc_type      text primary key check (doc_type in ('quote', 'order', 'purchase')),
  prefix        text not null,
  padding       integer not null default 4 check (padding between 3 and 8),
  current_year  integer not null default extract(year from now())::int,
  last_value    integer not null default 0 check (last_value >= 0),
  updated_at    timestamptz not null default now()
);
insert into public.document_sequences (doc_type, prefix) values
  ('quote', 'PR-Q'), ('order', 'PR-P'), ('purchase', 'PR-OC');

-- ---------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------
create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  legal_name   text,
  tax_id       text,
  industry     text,
  status       public.client_status not null default 'prospecto',
  source       text,
  address      text,
  city         text,
  department   text,
  phone        text,
  email        text,
  website      text,
  needs        text,
  notes        text,
  owner_id     uuid references public.profiles (id) on delete set null,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index clients_owner_idx on public.clients (owner_id);
create index clients_status_idx on public.clients (status);

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  full_name   text not null,
  position    text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  notes       text,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index contacts_client_idx on public.contacts (client_id);

create table public.visits (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  contact_id        uuid references public.contacts (id) on delete set null,
  title             text not null,
  objective         text,
  scheduled_at      timestamptz not null,
  duration_minutes  integer not null default 60 check (duration_minutes > 0),
  location          text,
  status            public.visit_status not null default 'programada',
  comments          text,
  agreements        text,
  next_action       text,
  next_action_date  date,
  owner_id          uuid references public.profiles (id) on delete set null,
  completed_at      timestamptz,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid()
);
create index visits_client_idx on public.visits (client_id);
create index visits_scheduled_idx on public.visits (scheduled_at);

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  notes         text,
  is_active     boolean not null default true,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);

-- ---------------------------------------------------------------------
-- Catálogo. El costo vive en otra tabla para poder restringirlo por RLS.
-- ---------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  sku          text not null unique,
  name         text not null,
  description  text,
  kind         public.item_kind not null default 'producto',
  category     text,
  brand        text,
  unit         text not null default 'unidad',
  image_url    text,
  sale_price   numeric(12,2) not null default 0 check (sale_price >= 0),
  taxable      boolean not null default true,
  is_active    boolean not null default true,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);

create table public.product_costs (
  product_id   uuid primary key references public.products (id) on delete cascade,
  unit_cost    numeric(12,2) not null check (unit_cost >= 0),
  supplier_id  uuid references public.suppliers (id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);

create table public.product_price_history (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  sale_price  numeric(12,2) not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid default auth.uid()
);
create index product_price_history_idx on public.product_price_history (product_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Cotizaciones
-- ---------------------------------------------------------------------
create table public.quotes (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  client_id         uuid not null references public.clients (id) on delete restrict,
  contact_id        uuid references public.contacts (id) on delete set null,
  owner_id          uuid references public.profiles (id) on delete set null,
  title             text,
  status            public.quote_status not null default 'borrador',
  requested_at      timestamptz not null default now(),  -- cuándo lo pidió el cliente
  issue_date        date not null default current_date,
  valid_until       date,
  currency          text not null default 'USD',
  tax_rate          numeric(5,2) not null default 13 check (tax_rate between 0 and 100),
  terms             text,
  notes             text,          -- visible en el PDF
  internal_notes    text,          -- nunca en el PDF
  -- Totales: los calcula la base de datos, no el navegador
  subtotal          numeric(14,2) not null default 0,
  discount_total    numeric(14,2) not null default 0,
  charges_total     numeric(14,2) not null default 0,
  deductions_total  numeric(14,2) not null default 0,
  taxable_base      numeric(14,2) not null default 0,
  tax_total         numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  -- Seguimiento
  sent_at           timestamptz,
  accepted_at       timestamptz,
  rejected_at       timestamptz,
  closed_at         timestamptz,
  rejection_reason  text,
  next_action       text,
  next_action_date  date,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  constraint quotes_valid_until_chk check (valid_until is null or valid_until >= issue_date)
);
create index quotes_client_idx on public.quotes (client_id);
create index quotes_status_idx on public.quotes (status);
create index quotes_issue_idx on public.quotes (issue_date);

create table public.quote_items (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null references public.quotes (id) on delete cascade,
  position       integer not null default 0,
  product_id     uuid references public.products (id) on delete set null, -- null = línea personalizada
  kind           public.item_kind not null default 'producto',
  sku            text,
  description    text not null check (length(trim(description)) > 0),
  unit           text not null default 'unidad',
  quantity       numeric(12,3) not null check (quantity > 0),
  unit_price     numeric(12,2) not null check (unit_price >= 0),
  discount_pct   numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  taxable        boolean not null default true,
  line_subtotal  numeric(14,2) not null default 0,
  line_discount  numeric(14,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  created_at     timestamptz not null default now()
);
create index quote_items_quote_idx on public.quote_items (quote_id, position);
create index quote_items_product_idx on public.quote_items (product_id);

-- Costo de cada línea (para margen), restringido.
create table public.quote_item_costs (
  quote_item_id  uuid primary key references public.quote_items (id) on delete cascade,
  unit_cost      numeric(12,2) not null check (unit_cost >= 0)
);

-- Cargos y deducciones claramente separados de las líneas.
create table public.quote_adjustments (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  position    integer not null default 0,
  kind        public.adjustment_kind not null,
  label       text not null check (length(trim(label)) > 0),
  amount      numeric(12,2) not null check (amount >= 0),
  taxable     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index quote_adjustments_quote_idx on public.quote_adjustments (quote_id);

create table public.quote_events (
  id           bigint generated always as identity primary key,
  quote_id     uuid not null references public.quotes (id) on delete cascade,
  event_type   text not null check (event_type in ('creada', 'estado', 'comentario', 'seguimiento', 'pedido')),
  from_status  public.quote_status,
  to_status    public.quote_status,
  comment      text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index quote_events_quote_idx on public.quote_events (quote_id, created_at);

-- ---------------------------------------------------------------------
-- Tareas de seguimiento (pueden colgar de cliente, visita o cotización)
-- ---------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  due_date      date not null,
  status        public.task_status not null default 'pendiente',
  priority      public.task_priority not null default 'media',
  client_id     uuid references public.clients (id) on delete cascade,
  visit_id      uuid references public.visits (id) on delete set null,
  quote_id      uuid references public.quotes (id) on delete set null,
  owner_id      uuid references public.profiles (id) on delete set null,
  completed_at  timestamptz,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
create index tasks_due_idx on public.tasks (status, due_date);
create index tasks_client_idx on public.tasks (client_id);

-- ---------------------------------------------------------------------
-- Pedidos internos: compra, recepción, preparación y entrega son
-- columnas/etapas independientes. Aceptar una cotización no avanza ninguna.
-- ---------------------------------------------------------------------
create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  number                  text not null unique,
  quote_id                uuid not null unique references public.quotes (id) on delete restrict,
  client_id               uuid not null references public.clients (id) on delete restrict,
  owner_id                uuid references public.profiles (id) on delete set null,
  status                  public.order_status not null default 'abierto',
  requires_purchase       boolean not null default true,
  purchase_status         public.purchase_stage not null default 'pendiente',
  reception_status        public.reception_stage not null default 'pendiente',
  preparation_status      public.preparation_stage not null default 'pendiente',
  delivery_status         public.delivery_stage not null default 'pendiente',
  purchased_at            timestamptz,
  received_at             timestamptz,
  prepared_at             timestamptz,
  delivery_scheduled_for  date,
  delivered_at            timestamptz,
  closed_at               timestamptz,
  expected_delivery_date  date,
  delivery_address        text,
  received_by             text,
  notes                   text,
  subtotal                numeric(14,2) not null default 0,
  tax_total               numeric(14,2) not null default 0,
  total                   numeric(14,2) not null default 0,
  is_demo                 boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid default auth.uid()
);
create index orders_status_idx on public.orders (status);

create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  quote_item_id       uuid references public.quote_items (id) on delete set null,
  position            integer not null default 0,
  product_id          uuid references public.products (id) on delete set null,
  kind                public.item_kind not null default 'producto',
  sku                 text,
  description         text not null,
  unit                text not null default 'unidad',
  quantity            numeric(12,3) not null check (quantity > 0),
  unit_price          numeric(12,2) not null,
  line_total          numeric(14,2) not null,
  quantity_received   numeric(12,3) not null default 0 check (quantity_received >= 0),
  quantity_delivered  numeric(12,3) not null default 0 check (quantity_delivered >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  stage       text not null,
  from_value  text,
  to_value    text,
  comment     text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Órdenes de compra a proveedores (con costos → restringidas)
create table public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique,
  order_id     uuid references public.orders (id) on delete set null,
  supplier_id  uuid not null references public.suppliers (id) on delete restrict,
  status       public.po_status not null default 'borrador',
  ordered_at   date,
  expected_at  date,
  received_at  date,
  total_cost   numeric(14,2) not null default 0,
  notes        text,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index purchase_orders_order_idx on public.purchase_orders (order_id);

create table public.purchase_order_items (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders (id) on delete cascade,
  order_item_id      uuid references public.order_items (id) on delete set null,
  description        text not null,
  quantity           numeric(12,3) not null check (quantity > 0),
  unit_cost          numeric(12,2) not null check (unit_cost >= 0),
  quantity_received  numeric(12,3) not null default 0 check (quantity_received >= 0)
);

-- ---------------------------------------------------------------------
-- Trazabilidad y control de seed
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb
);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_time_idx on public.audit_log (changed_at desc);

create table public.seed_runs (
  seed_key    text primary key,
  version     integer not null,
  applied_at  timestamptz not null default now()
);

-- >>> 20261014000003_logic.sql
-- =====================================================================
-- Printer Business Hub — 0003: lógica de negocio en la base de datos
--  * numeración única
--  * cálculo de totales (fuente de verdad)
--  * flujo de estados de cotización y etapas de pedido (solo vía RPC)
--  * historial de precios y auditoría
-- =====================================================================

-- Marca de "operación de confianza" (RPCs y seed). Se activa con
-- set_config(..., true) → vive solo dentro de la transacción actual.
-- PostgREST no expone set_config, así que el cliente no puede activarla.
create or replace function public._trusted()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.trusted_op', true), '') = 'on';
$$;

create or replace function public._begin_trusted()
returns void language sql as $$
  select set_config('app.trusted_op', 'on', true);
$$;
create or replace function public._end_trusted()
returns void language sql as $$
  select set_config('app.trusted_op', '', true);
$$;
revoke execute on function public._begin_trusted() from public;
revoke execute on function public._end_trusted() from public;

-- ---------------------------------------------------------------------
-- Numeración: un UPDATE atómico (bloqueo de fila) → sin duplicados aunque
-- dos personas guarden a la vez. Reinicia el correlativo cada año.
-- ---------------------------------------------------------------------
create or replace function public.next_document_number(_doc_type text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_year int := extract(year from now() at time zone 'America/El_Salvador')::int;
  v_prefix text;
  v_padding int;
  v_value int;
begin
  update public.document_sequences
     set last_value   = case when current_year = v_year then last_value + 1 else 1 end,
         current_year = v_year,
         updated_at   = now()
   where doc_type = _doc_type
  returning prefix, padding, last_value into v_prefix, v_padding, v_value;

  if v_value is null then
    raise exception 'Tipo de documento desconocido: %', _doc_type;
  end if;

  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, v_padding, '0');
end;
$$;
revoke execute on function public.next_document_number(text) from public, anon, authenticated;

create or replace function public.tg_assign_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- El número siempre lo asigna el servidor (se ignora lo que mande el cliente).
    new.number := public.next_document_number(tg_argv[0]);
  elsif new.number is distinct from old.number then
    raise exception 'El número de documento no se puede modificar';
  end if;
  return new;
end;
$$;

create trigger quotes_number before insert or update of number on public.quotes
  for each row execute function public.tg_assign_number('quote');
create trigger orders_number before insert or update of number on public.orders
  for each row execute function public.tg_assign_number('order');
create trigger purchase_orders_number before insert or update of number on public.purchase_orders
  for each row execute function public.tg_assign_number('purchase');

-- ---------------------------------------------------------------------
-- Cálculo de cotizaciones
--   línea:   subtotal = round(cant × precio, 2)
--            descuento = round(subtotal × %desc / 100, 2)
--            total línea = subtotal − descuento
--   cotización:
--            neto       = Σ total línea
--            base IVA   = Σ líneas gravadas + cargos gravados − deducciones gravadas (mín. 0)
--            IVA        = round(base × tasa / 100, 2)
--            total      = neto + cargos − deducciones + IVA
-- La misma fórmula está en src/lib/quoteMath.ts (solo para vista previa).
-- ---------------------------------------------------------------------
create or replace function public.quote_is_editable(_status public.quote_status)
returns boolean language sql immutable as $$
  select _status in ('borrador', 'pendiente_envio', 'enviada', 'negociacion');
$$;

create or replace function public.tg_quote_items_calc()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.quote_status;
begin
  select status into v_status from public.quotes where id = coalesce(new.quote_id, old.quote_id);

  if not public._trusted() and v_status is not null and not public.quote_is_editable(v_status) then
    raise exception 'La cotización está en estado "%" y ya no se puede editar', v_status;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  new.line_subtotal := round(new.quantity * new.unit_price, 2);
  new.line_discount := round(new.line_subtotal * new.discount_pct / 100, 2);
  new.line_total    := new.line_subtotal - new.line_discount;
  return new;
end;
$$;

create trigger quote_items_calc before insert or update or delete on public.quote_items
  for each row execute function public.tg_quote_items_calc();

create or replace function public.tg_quote_adjustments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.quote_status;
begin
  select status into v_status from public.quotes where id = coalesce(new.quote_id, old.quote_id);
  if not public._trusted() and v_status is not null and not public.quote_is_editable(v_status) then
    raise exception 'La cotización está en estado "%" y ya no se puede editar', v_status;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quote_adjustments_guard before insert or update or delete on public.quote_adjustments
  for each row execute function public.tg_quote_adjustments_guard();

-- Recalcula y guarda los totales de una cotización.
create or replace function public.recalc_quote_totals(_quote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tax_rate     numeric;
  v_subtotal     numeric := 0;
  v_discount     numeric := 0;
  v_net          numeric := 0;
  v_taxable_ln   numeric := 0;
  v_charges      numeric := 0;
  v_deductions   numeric := 0;
  v_tax_charges  numeric := 0;
  v_tax_deduct   numeric := 0;
  v_base         numeric := 0;
  v_tax          numeric := 0;
begin
  select tax_rate into v_tax_rate from public.quotes where id = _quote_id;
  if not found then return; end if;

  select coalesce(sum(line_subtotal), 0),
         coalesce(sum(line_discount), 0),
         coalesce(sum(line_total), 0),
         coalesce(sum(line_total) filter (where taxable), 0)
    into v_subtotal, v_discount, v_net, v_taxable_ln
    from public.quote_items where quote_id = _quote_id;

  select coalesce(sum(amount) filter (where kind = 'cargo'), 0),
         coalesce(sum(amount) filter (where kind = 'deduccion'), 0),
         coalesce(sum(amount) filter (where kind = 'cargo' and taxable), 0),
         coalesce(sum(amount) filter (where kind = 'deduccion' and taxable), 0)
    into v_charges, v_deductions, v_tax_charges, v_tax_deduct
    from public.quote_adjustments where quote_id = _quote_id;

  v_base := greatest(v_taxable_ln + v_tax_charges - v_tax_deduct, 0);
  v_tax  := round(v_base * v_tax_rate / 100, 2);

  perform set_config('app.recalc', 'on', true);
  update public.quotes
     set subtotal         = v_subtotal,
         discount_total   = v_discount,
         charges_total    = v_charges,
         deductions_total = v_deductions,
         taxable_base     = v_base,
         tax_total        = v_tax,
         total            = v_net + v_charges - v_deductions + v_tax
   where id = _quote_id;
  perform set_config('app.recalc', '', true);
end;
$$;
revoke execute on function public.recalc_quote_totals(uuid) from public, anon;

create or replace function public.tg_recalc_parent_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_quote_totals(old.quote_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    perform public.recalc_quote_totals(new.quote_id);
  end if;
  return null;
end;
$$;

create trigger quote_items_recalc after insert or update or delete on public.quote_items
  for each row execute function public.tg_recalc_parent_quote();
create trigger quote_adjustments_recalc after insert or update or delete on public.quote_adjustments
  for each row execute function public.tg_recalc_parent_quote();

-- Guardas de la tabla quotes:
--  * los totales no se pueden escribir desde el cliente
--  * el estado solo cambia vía change_quote_status()
--  * una cotización cerrada no se edita
create or replace function public.tg_quotes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.company_settings;
begin
  if tg_op = 'INSERT' then
    if not public._trusted() then
      new.status := 'borrador';
      new.sent_at := null; new.accepted_at := null; new.rejected_at := null; new.closed_at := null;
    end if;
    new.subtotal := 0; new.discount_total := 0; new.charges_total := 0;
    new.deductions_total := 0; new.taxable_base := 0; new.tax_total := 0; new.total := 0;
    if new.valid_until is null then
      select * into v_settings from public.company_settings where id = 1;
      new.valid_until := new.issue_date + coalesce(v_settings.quote_validity_days, 15);
    end if;
    return new;
  end if;

  -- UPDATE
  if coalesce(current_setting('app.recalc', true), '') <> 'on' then
    new.subtotal := old.subtotal; new.discount_total := old.discount_total;
    new.charges_total := old.charges_total; new.deductions_total := old.deductions_total;
    new.taxable_base := old.taxable_base; new.tax_total := old.tax_total; new.total := old.total;
  end if;

  if not public._trusted() then
    if new.status is distinct from old.status
       or new.sent_at is distinct from old.sent_at
       or new.accepted_at is distinct from old.accepted_at
       or new.rejected_at is distinct from old.rejected_at
       or new.closed_at is distinct from old.closed_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'El estado de la cotización se cambia con change_quote_status()';
    end if;
    if not public.quote_is_editable(old.status)
       and coalesce(current_setting('app.recalc', true), '') <> 'on'
       and (new.client_id, new.contact_id, new.tax_rate, new.issue_date, new.valid_until, new.currency, new.terms, new.notes, new.title)
           is distinct from
           (old.client_id, old.contact_id, old.tax_rate, old.issue_date, old.valid_until, old.currency, old.terms, old.notes, old.title) then
      raise exception 'La cotización está en estado "%" y ya no se puede editar', old.status;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger quotes_guard before insert or update on public.quotes
  for each row execute function public.tg_quotes_guard();

-- Si cambia la tasa de impuesto, recalcular.
create or replace function public.tg_quotes_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tax_rate is distinct from old.tax_rate then
    perform public.recalc_quote_totals(new.id);
  end if;
  return null;
end;
$$;

create trigger quotes_after_update after update of tax_rate on public.quotes
  for each row execute function public.tg_quotes_after_update();

create or replace function public.tg_quotes_created_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.quote_events (quote_id, event_type, to_status, comment, created_by)
  values (new.id, 'creada', new.status, null, coalesce(auth.uid(), new.created_by));
  return null;
end;
$$;

create trigger quotes_created_event after insert on public.quotes
  for each row execute function public.tg_quotes_created_event();

-- ---------------------------------------------------------------------
-- Flujo de estados de cotización
-- ---------------------------------------------------------------------
create or replace function public.quote_transition_allowed(_from public.quote_status, _to public.quote_status)
returns boolean language sql immutable as $$
  select case _from
    when 'borrador'        then _to in ('pendiente_envio', 'enviada', 'cancelada')
    when 'pendiente_envio' then _to in ('borrador', 'enviada', 'cancelada')
    when 'enviada'         then _to in ('negociacion', 'aceptada', 'rechazada', 'vencida', 'cancelada')
    when 'negociacion'     then _to in ('enviada', 'aceptada', 'rechazada', 'vencida', 'cancelada')
    when 'vencida'         then _to in ('negociacion', 'enviada', 'cancelada')
    else false  -- aceptada, rechazada, cancelada son finales
  end;
$$;

create or replace function public.change_quote_status(
  p_quote_id         uuid,
  p_status           public.quote_status,
  p_comment          text default null,
  p_rejection_reason text default null
)
returns public.quotes
language plpgsql security definer set search_path = ''
as $$
declare
  v_quote public.quotes;
  v_prev  public.quote_status;
  v_items int;
begin
  if not public.is_staff() then
    raise exception 'No autorizado';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  v_prev := v_quote.status;

  if v_prev = p_status then
    return v_quote;
  end if;

  if not public.quote_transition_allowed(v_prev, p_status) then
    raise exception 'No se puede pasar de "%" a "%"', v_prev, p_status;
  end if;

  if p_status in ('cancelada', 'borrador', 'pendiente_envio') and not public.can_manage_quotes() then
    raise exception 'Solo Cotizaciones/Operaciones o Administración pueden pasar una cotización a "%"', p_status;
  end if;

  if p_status in ('pendiente_envio', 'enviada', 'aceptada') then
    select count(*) into v_items from public.quote_items where quote_id = p_quote_id;
    if v_items = 0 then
      raise exception 'La cotización no tiene líneas';
    end if;
  end if;

  if p_status = 'rechazada' and coalesce(trim(p_rejection_reason), '') = '' then
    raise exception 'Indicá el motivo del rechazo';
  end if;

  perform public._begin_trusted();

  update public.quotes
     set status           = p_status,
         sent_at          = case when p_status = 'enviada' and sent_at is null then now() else sent_at end,
         accepted_at      = case when p_status = 'aceptada' then now() else accepted_at end,
         rejected_at      = case when p_status = 'rechazada' then now() else rejected_at end,
         rejection_reason = case when p_status = 'rechazada' then trim(p_rejection_reason) else rejection_reason end,
         closed_at        = case when p_status in ('aceptada', 'rechazada', 'cancelada') then now() else null end
   where id = p_quote_id
  returning * into v_quote;

  insert into public.quote_events (quote_id, event_type, from_status, to_status, comment)
  values (p_quote_id, 'estado', v_prev, p_status,
          coalesce(nullif(trim(p_comment), ''),
                   case when p_status = 'rechazada' then trim(p_rejection_reason) end));

  perform public._end_trusted();
  return v_quote;
end;
$$;

-- Seguimiento comercial (cualquier rol): próxima acción + comentario.
create or replace function public.update_quote_followup(
  p_quote_id         uuid,
  p_next_action      text,
  p_next_action_date date,
  p_comment          text default null
)
returns public.quotes
language plpgsql security definer set search_path = ''
as $$
declare
  v_quote public.quotes;
begin
  if not public.is_staff() then
    raise exception 'No autorizado';
  end if;

  update public.quotes
     set next_action = nullif(trim(p_next_action), ''),
         next_action_date = p_next_action_date
   where id = p_quote_id
  returning * into v_quote;

  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  insert into public.quote_events (quote_id, event_type, comment)
  values (p_quote_id, 'seguimiento',
          concat_ws(' · ',
            nullif(trim(p_comment), ''),
            case when p_next_action is not null then 'Próxima acción: ' || p_next_action end,
            case when p_next_action_date is not null then 'para ' || to_char(p_next_action_date, 'DD/MM/YYYY') end));

  return v_quote;
end;
$$;

-- Marca como vencidas las cotizaciones abiertas cuya vigencia pasó.
-- Se ejecuta a demanda (botón) — no hay escrituras ocultas al cargar páginas.
create or replace function public.expire_overdue_quotes()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado';
  end if;
  perform public._begin_trusted();
  for r in
    select id, status from public.quotes
     where status in ('enviada', 'negociacion')
       and valid_until < (now() at time zone 'America/El_Salvador')::date
     for update
  loop
    update public.quotes set status = 'vencida' where id = r.id;
    insert into public.quote_events (quote_id, event_type, from_status, to_status, comment)
    values (r.id, 'estado', r.status, 'vencida', 'Vigencia expirada');
    v_count := v_count + 1;
  end loop;
  perform public._end_trusted();
  return v_count;
end;
$$;

-- Duplicar una cotización (p. ej. para re-cotizar una rechazada o vencida).
create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_src public.quotes;
  v_new uuid;
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado';
  end if;
  select * into v_src from public.quotes where id = p_quote_id;
  if not found then raise exception 'Cotización no encontrada'; end if;

  insert into public.quotes (number, client_id, contact_id, owner_id, title, tax_rate, currency, terms, notes, internal_notes, is_demo)
  values ('', v_src.client_id, v_src.contact_id, coalesce(auth.uid(), v_src.owner_id), v_src.title,
          v_src.tax_rate, v_src.currency, v_src.terms, v_src.notes,
          concat_ws(E'\n', 'Copia de ' || v_src.number, v_src.internal_notes), false)
  returning id into v_new;

  insert into public.quote_items (quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable)
  select v_new, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable
    from public.quote_items where quote_id = p_quote_id order by position;

  insert into public.quote_item_costs (quote_item_id, unit_cost)
  select ni.id, c.unit_cost
    from public.quote_items oi
    join public.quote_item_costs c on c.quote_item_id = oi.id
    join public.quote_items ni on ni.quote_id = v_new and ni.position = oi.position and ni.description = oi.description
   where oi.quote_id = p_quote_id;

  insert into public.quote_adjustments (quote_id, position, kind, label, amount, taxable)
  select v_new, position, kind, label, amount, taxable
    from public.quote_adjustments where quote_id = p_quote_id;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------
-- Conversión cotización aceptada → pedido interno
-- ---------------------------------------------------------------------
create or replace function public.convert_quote_to_order(
  p_quote_id          uuid,
  p_requires_purchase boolean default true,
  p_expected_delivery date default null,
  p_notes             text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_quote public.quotes;
  v_order uuid;
begin
  if not public.can_manage_quotes() then
    raise exception 'Solo Cotizaciones/Operaciones o Administración pueden crear pedidos';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  if v_quote.status <> 'aceptada' then
    raise exception 'Solo una cotización aceptada se puede convertir en pedido (estado actual: %)', v_quote.status;
  end if;
  if exists (select 1 from public.orders where quote_id = p_quote_id) then
    raise exception 'Esta cotización ya tiene un pedido';
  end if;

  perform public._begin_trusted();

  insert into public.orders (
    number, quote_id, client_id, owner_id, requires_purchase,
    purchase_status, reception_status, expected_delivery_date, notes,
    subtotal, tax_total, total, is_demo
  ) values (
    '', v_quote.id, v_quote.client_id, coalesce(auth.uid(), v_quote.owner_id), p_requires_purchase,
    case when p_requires_purchase then 'pendiente' else 'no_aplica' end::public.purchase_stage,
    case when p_requires_purchase then 'pendiente' else 'no_aplica' end::public.reception_stage,
    p_expected_delivery, p_notes,
    v_quote.total - v_quote.tax_total, v_quote.tax_total, v_quote.total, v_quote.is_demo
  ) returning id into v_order;

  insert into public.order_items (order_id, quote_item_id, position, product_id, kind, sku, description, unit, quantity, unit_price, line_total)
  select v_order, id, position, product_id, kind, sku, description, unit, quantity,
         -- precio unitario efectivo (después del descuento de línea)
         round(line_total / quantity, 2), line_total
    from public.quote_items
   where quote_id = p_quote_id
   order by position;

  insert into public.order_events (order_id, stage, to_value, comment)
  values (v_order, 'creado', 'abierto', 'Creado desde ' || v_quote.number);

  insert into public.quote_events (quote_id, event_type, comment)
  values (p_quote_id, 'pedido', 'Convertida en pedido ' || (select number from public.orders where id = v_order));

  perform public._end_trusted();
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Etapas de pedido (independientes). Reglas mínimas de coherencia:
--  * recepción "recibida" requiere compra "comprada" (si aplica compra)
--  * entrega "entregada" requiere preparación "lista"
--  * cerrar requiere entrega "entregada"
-- ---------------------------------------------------------------------
create or replace function public.tg_orders_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and not public._trusted() then
    if (new.status, new.purchase_status, new.reception_status, new.preparation_status, new.delivery_status,
        new.purchased_at, new.received_at, new.prepared_at, new.delivered_at, new.closed_at,
        new.requires_purchase, new.quote_id, new.client_id, new.subtotal, new.tax_total, new.total)
       is distinct from
       (old.status, old.purchase_status, old.reception_status, old.preparation_status, old.delivery_status,
        old.purchased_at, old.received_at, old.prepared_at, old.delivered_at, old.closed_at,
        old.requires_purchase, old.quote_id, old.client_id, old.subtotal, old.tax_total, old.total) then
      raise exception 'Las etapas del pedido se cambian con update_order_stage()';
    end if;
  end if;
  if tg_op = 'INSERT' and not public._trusted() then
    raise exception 'Los pedidos se crean desde una cotización aceptada (convert_quote_to_order)';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_guard before insert or update on public.orders
  for each row execute function public.tg_orders_guard();

create or replace function public.update_order_stage(
  p_order_id uuid,
  p_stage    text,   -- 'compra' | 'recepcion' | 'preparacion' | 'entrega' | 'estado'
  p_value    text,
  p_comment  text default null,
  p_date     date default null,       -- fecha programada de entrega (opcional)
  p_received_by text default null     -- quién recibió la entrega (opcional)
)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_from text;
begin
  if not public.can_manage_quotes() then
    raise exception 'Solo Cotizaciones/Operaciones o Administración pueden actualizar pedidos';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if o.status <> 'abierto' and p_stage <> 'estado' then
    raise exception 'El pedido está %; reabrilo para modificar etapas', o.status;
  end if;

  perform public._begin_trusted();

  case p_stage
  when 'compra' then
    if not o.requires_purchase then raise exception 'Este pedido no requiere compra'; end if;
    v_from := o.purchase_status::text;
    update public.orders set purchase_status = p_value::public.purchase_stage,
           purchased_at = case when p_value = 'comprada' then coalesce(purchased_at, now()) else null end
     where id = p_order_id returning * into o;

  when 'recepcion' then
    if not o.requires_purchase then raise exception 'Este pedido no requiere recepción de proveedor'; end if;
    if p_value in ('parcial', 'recibida') and o.purchase_status <> 'comprada' then
      raise exception 'Primero registrá la compra al proveedor';
    end if;
    v_from := o.reception_status::text;
    update public.orders set reception_status = p_value::public.reception_stage,
           received_at = case when p_value = 'recibida' then coalesce(received_at, now()) else null end
     where id = p_order_id returning * into o;

  when 'preparacion' then
    v_from := o.preparation_status::text;
    update public.orders set preparation_status = p_value::public.preparation_stage,
           prepared_at = case when p_value = 'lista' then coalesce(prepared_at, now()) else null end
     where id = p_order_id returning * into o;

  when 'entrega' then
    if p_value = 'entregada' and o.preparation_status <> 'lista' then
      raise exception 'El pedido debe estar preparado antes de marcarlo como entregado';
    end if;
    v_from := o.delivery_status::text;
    update public.orders set delivery_status = p_value::public.delivery_stage,
           delivery_scheduled_for = case when p_value = 'programada' then coalesce(p_date, delivery_scheduled_for) else delivery_scheduled_for end,
           delivered_at = case when p_value = 'entregada' then coalesce(delivered_at, now()) else null end,
           received_by  = case when p_value = 'entregada' then coalesce(nullif(trim(p_received_by), ''), received_by) else received_by end
     where id = p_order_id returning * into o;

  when 'estado' then
    if p_value = 'cerrado' and o.delivery_status <> 'entregada' then
      raise exception 'Solo se puede cerrar un pedido entregado';
    end if;
    v_from := o.status::text;
    update public.orders set status = p_value::public.order_status,
           closed_at = case when p_value in ('cerrado', 'cancelado') then now() else null end
     where id = p_order_id returning * into o;

  else
    raise exception 'Etapa desconocida: %', p_stage;
  end case;

  insert into public.order_events (order_id, stage, from_value, to_value, comment)
  values (p_order_id, p_stage, v_from, p_value, nullif(trim(p_comment), ''));

  perform public._end_trusted();
  return o;
end;
$$;

-- ---------------------------------------------------------------------
-- Órdenes de compra: total calculado desde sus líneas
-- ---------------------------------------------------------------------
create or replace function public.tg_po_recalc()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders
     set total_cost = (select coalesce(sum(round(quantity * unit_cost, 2)), 0)
                         from public.purchase_order_items where purchase_order_id = v_id)
   where id = v_id;
  return null;
end;
$$;

create trigger purchase_order_items_recalc after insert or update or delete on public.purchase_order_items
  for each row execute function public.tg_po_recalc();

-- ---------------------------------------------------------------------
-- Historial de precio de venta del catálogo
-- ---------------------------------------------------------------------
create or replace function public.tg_product_price_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.sale_price is distinct from old.sale_price then
    insert into public.product_price_history (product_id, sale_price, changed_by)
    values (new.id, new.sale_price, auth.uid());
  end if;
  return null;
end;
$$;

create trigger products_price_history after insert or update of sale_price on public.products
  for each row execute function public.tg_product_price_history();

-- ---------------------------------------------------------------------
-- Auditoría genérica
-- ---------------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id  text;
begin
  -- Durante el recálculo de totales no se audita (ruido).
  if tg_op = 'UPDATE' and coalesce(current_setting('app.recalc', true), '') = 'on' then
    return null;
  end if;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null;
  end if;
  v_id := coalesce(v_new, v_old) ->> coalesce(tg_argv[0], 'id');
  insert into public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values (tg_table_name, v_id, lower(tg_op), auth.uid(), v_old, v_new);
  return null;
end;
$$;

create trigger audit_clients          after insert or update or delete on public.clients          for each row execute function public.tg_audit();
create trigger audit_products         after insert or update or delete on public.products         for each row execute function public.tg_audit();
create trigger audit_product_costs    after insert or update or delete on public.product_costs    for each row execute function public.tg_audit('product_id');
create trigger audit_quotes           after insert or update or delete on public.quotes           for each row execute function public.tg_audit();
create trigger audit_quote_items      after insert or update or delete on public.quote_items      for each row execute function public.tg_audit();
create trigger audit_quote_adjust     after insert or update or delete on public.quote_adjustments for each row execute function public.tg_audit();
create trigger audit_orders           after insert or update or delete on public.orders           for each row execute function public.tg_audit();
create trigger audit_purchase_orders  after insert or update or delete on public.purchase_orders  for each row execute function public.tg_audit();
create trigger audit_user_roles       after insert or update or delete on public.user_roles       for each row execute function public.tg_audit('user_id');
create trigger audit_profiles         after update on public.profiles                            for each row execute function public.tg_audit();
create trigger audit_company_settings after update on public.company_settings                    for each row execute function public.tg_audit();
create trigger audit_sequences        after update of prefix, padding on public.document_sequences for each row execute function public.tg_audit('doc_type');

-- updated_at
create trigger clients_updated_at   before update on public.clients   for each row execute function public.tg_set_updated_at();
create trigger contacts_updated_at  before update on public.contacts  for each row execute function public.tg_set_updated_at();
create trigger visits_updated_at    before update on public.visits    for each row execute function public.tg_set_updated_at();
create trigger tasks_updated_at     before update on public.tasks     for each row execute function public.tg_set_updated_at();
create trigger suppliers_updated_at before update on public.suppliers for each row execute function public.tg_set_updated_at();
create trigger products_updated_at  before update on public.products  for each row execute function public.tg_set_updated_at();
create trigger product_costs_updated_at before update on public.product_costs for each row execute function public.tg_set_updated_at();
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute function public.tg_set_updated_at();
create trigger company_settings_updated_at before update on public.company_settings for each row execute function public.tg_set_updated_at();

-- Completar fecha de cierre de tareas y visitas
create or replace function public.tg_task_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'completada' and (tg_op = 'INSERT' or old.status is distinct from 'completada') then
    new.completed_at := now();
  elsif new.status <> 'completada' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_completed before insert or update of status on public.tasks
  for each row execute function public.tg_task_completed();

create or replace function public.tg_visit_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'realizada' and (tg_op = 'INSERT' or old.status is distinct from 'realizada') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'realizada' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger visits_completed before insert or update of status on public.visits
  for each row execute function public.tg_visit_completed();

-- >>> 20261014000004_rls.sql
-- =====================================================================
-- Printer Business Hub — 0004: Row Level Security
-- Regla general:
--   * anon no ve nada.
--   * Un usuario autenticado SIN rol no ve nada.
--   * Costos, márgenes y compras: solo admin + operaciones.
--   * Configuración, usuarios y auditoría: solo admin.
-- =====================================================================

-- anon fuera de todo
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_roles','company_settings','document_sequences',
    'clients','contacts','visits','tasks','suppliers',
    'products','product_costs','product_price_history',
    'quotes','quote_items','quote_item_costs','quote_adjustments','quote_events',
    'orders','order_items','order_events','purchase_orders','purchase_order_items',
    'audit_log','seed_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------- Perfiles y roles ----------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy user_roles_admin_insert on public.user_roles for insert to authenticated
  with check (public.has_role('admin'));
create policy user_roles_admin_delete on public.user_roles for delete to authenticated
  using (public.has_role('admin'));

-- ---------------- Configuración ----------------
create policy settings_select on public.company_settings for select to authenticated
  using (public.is_staff());
create policy settings_update on public.company_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy sequences_select on public.document_sequences for select to authenticated
  using (public.is_staff());
create policy sequences_update on public.document_sequences for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
-- El admin solo puede cambiar prefijo/relleno, no el correlativo.
revoke update on public.document_sequences from authenticated;
grant update (prefix, padding) on public.document_sequences to authenticated;

-- ---------------- CRM ----------------
create policy clients_select on public.clients for select to authenticated using (public.is_staff());
create policy clients_insert on public.clients for insert to authenticated with check (public.is_staff());
create policy clients_update on public.clients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy clients_delete on public.clients for delete to authenticated using (public.has_role('admin'));

create policy contacts_select on public.contacts for select to authenticated using (public.is_staff());
create policy contacts_insert on public.contacts for insert to authenticated with check (public.is_staff());
create policy contacts_update on public.contacts for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy contacts_delete on public.contacts for delete to authenticated
  using (public.has_role('admin') or created_by = auth.uid());

-- Visitas: las gestiona el equipo comercial (y admin). Operaciones las consulta.
create policy visits_select on public.visits for select to authenticated using (public.is_staff());
create policy visits_insert on public.visits for insert to authenticated
  with check (public.has_any_role(array['admin','comercial']::public.app_role[]));
create policy visits_update on public.visits for update to authenticated
  using (public.has_any_role(array['admin','comercial']::public.app_role[]))
  with check (public.has_any_role(array['admin','comercial']::public.app_role[]));
create policy visits_delete on public.visits for delete to authenticated
  using (public.has_role('admin') or (created_by = auth.uid() and public.has_role('comercial')));

create policy tasks_select on public.tasks for select to authenticated using (public.is_staff());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_staff());
create policy tasks_update on public.tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_role('admin') or created_by = auth.uid());

-- ---------------- Proveedores y catálogo ----------------
create policy suppliers_select on public.suppliers for select to authenticated using (public.is_staff());
create policy suppliers_write on public.suppliers for insert to authenticated with check (public.can_see_costs());
create policy suppliers_update on public.suppliers for update to authenticated using (public.can_see_costs()) with check (public.can_see_costs());
create policy suppliers_delete on public.suppliers for delete to authenticated using (public.has_role('admin'));

create policy products_select on public.products for select to authenticated using (public.is_staff());
create policy products_insert on public.products for insert to authenticated with check (public.can_manage_quotes());
create policy products_update on public.products for update to authenticated using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy products_delete on public.products for delete to authenticated using (public.has_role('admin'));

create policy product_costs_all on public.product_costs for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());

create policy price_history_select on public.product_price_history for select to authenticated using (public.is_staff());

-- ---------------- Cotizaciones ----------------
create policy quotes_select on public.quotes for select to authenticated using (public.is_staff());
create policy quotes_insert on public.quotes for insert to authenticated with check (public.can_manage_quotes());
create policy quotes_update on public.quotes for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy quotes_delete on public.quotes for delete to authenticated
  using (public.has_role('admin') and status = 'borrador');

create policy quote_items_select on public.quote_items for select to authenticated using (public.is_staff());
create policy quote_items_insert on public.quote_items for insert to authenticated with check (public.can_manage_quotes());
create policy quote_items_update on public.quote_items for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy quote_items_delete on public.quote_items for delete to authenticated using (public.can_manage_quotes());

create policy quote_item_costs_all on public.quote_item_costs for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());

create policy quote_adj_select on public.quote_adjustments for select to authenticated using (public.is_staff());
create policy quote_adj_insert on public.quote_adjustments for insert to authenticated with check (public.can_manage_quotes());
create policy quote_adj_update on public.quote_adjustments for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy quote_adj_delete on public.quote_adjustments for delete to authenticated using (public.can_manage_quotes());

-- Eventos: lectura para todos; comentarios manuales de cualquier rol.
-- Los eventos de estado los crean las funciones del servidor.
create policy quote_events_select on public.quote_events for select to authenticated using (public.is_staff());
create policy quote_events_comment on public.quote_events for insert to authenticated
  with check (public.is_staff() and event_type = 'comentario' and created_by = auth.uid()
              and from_status is null and to_status is null);

-- ---------------- Pedidos y compras ----------------
create policy orders_select on public.orders for select to authenticated using (public.is_staff());
-- Inserción solo vía convert_quote_to_order(); el trigger lo garantiza.
create policy orders_update on public.orders for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());

create policy order_items_select on public.order_items for select to authenticated using (public.is_staff());
create policy order_items_update on public.order_items for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());

create policy order_events_select on public.order_events for select to authenticated using (public.is_staff());

create policy po_all on public.purchase_orders for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());
create policy po_items_all on public.purchase_order_items for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());

-- ---------------- Auditoría y seed ----------------
create policy audit_select on public.audit_log for select to authenticated using (public.has_role('admin'));
create policy seed_runs_select on public.seed_runs for select to authenticated using (public.has_role('admin'));

-- Las tablas append-only no se editan desde el cliente.
revoke update, delete on public.audit_log, public.quote_events, public.order_events, public.product_price_history from authenticated;
revoke insert on public.audit_log, public.order_events, public.product_price_history, public.seed_runs from authenticated;

-- Funciones internas: nunca invocables desde la API.
revoke execute on function public._begin_trusted(), public._end_trusted(),
  public.next_document_number(text), public.recalc_quote_totals(uuid)
  from public, anon, authenticated;

-- >>> 20261014000005_reports.sql
-- =====================================================================
-- Printer Business Hub — 0005: vistas y métricas (todas con RLS del invocador)
-- =====================================================================

-- Historial de precios cotizados: producto/servicio × cliente × fecha × cotización
create view public.v_price_history with (security_invoker = true) as
select
  qi.id              as quote_item_id,
  qi.product_id,
  coalesce(p.sku, qi.sku) as sku,
  coalesce(p.name, qi.description) as product_name,
  qi.description,
  qi.kind,
  qi.product_id is null as is_custom,
  q.id               as quote_id,
  q.number           as quote_number,
  q.status           as quote_status,
  q.issue_date,
  c.id               as client_id,
  c.name             as client_name,
  qi.quantity,
  qi.unit_price,
  qi.discount_pct,
  round(qi.line_total / qi.quantity, 2) as effective_unit_price,
  q.currency,
  q.is_demo
from public.quote_items qi
join public.quotes q  on q.id = qi.quote_id
join public.clients c on c.id = q.client_id
left join public.products p on p.id = qi.product_id;

-- Listado de cotizaciones con datos de cliente y vencimiento efectivo
create view public.v_quotes with (security_invoker = true) as
select
  q.*,
  c.name       as client_name,
  ct.full_name as contact_name,
  pr.full_name as owner_name,
  (q.status in ('enviada', 'negociacion') and q.valid_until < (now() at time zone 'America/El_Salvador')::date) as is_overdue_validity,
  (q.next_action_date is not null and q.next_action_date < (now() at time zone 'America/El_Salvador')::date
     and q.status in ('borrador', 'pendiente_envio', 'enviada', 'negociacion', 'vencida')) as is_followup_late,
  o.id         as order_id,
  o.number     as order_number
from public.quotes q
join public.clients c on c.id = q.client_id
left join public.contacts ct on ct.id = q.contact_id
left join public.profiles pr on pr.id = q.owner_id
left join public.orders o on o.quote_id = q.id;

create view public.v_orders with (security_invoker = true) as
select
  o.*,
  c.name   as client_name,
  q.number as quote_number,
  q.requested_at,
  q.accepted_at,
  pr.full_name as owner_name
from public.orders o
join public.clients c on c.id = o.client_id
join public.quotes q on q.id = o.quote_id
left join public.profiles pr on pr.id = o.owner_id;

-- Margen por cotización (solo filas con costo; quote_item_costs está restringida
-- por RLS, así que un rol comercial verá costo nulo).
create view public.v_quote_margins with (security_invoker = true) as
select
  q.id as quote_id,
  q.number,
  q.status,
  q.issue_date,
  c.name as client_name,
  sum(qi.line_total) as revenue,
  sum(round(qi.quantity * qc.unit_cost, 2)) as cost,
  sum(qi.line_total) - sum(round(qi.quantity * qc.unit_cost, 2)) as margin,
  case when sum(qi.line_total) > 0
       then round((sum(qi.line_total) - sum(round(qi.quantity * qc.unit_cost, 2))) / sum(qi.line_total) * 100, 1)
  end as margin_pct,
  count(qi.id) filter (where qc.unit_cost is null) as lines_without_cost,
  q.is_demo
from public.quotes q
join public.clients c on c.id = q.client_id
join public.quote_items qi on qi.quote_id = q.id
left join public.quote_item_costs qc on qc.quote_item_id = qi.id
where public.can_see_costs()
group by q.id, c.name;

-- ---------------------------------------------------------------------
-- Métricas del dashboard, calculadas sobre registros reales.
-- Rango de fechas en hora de El Salvador.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_metrics(
  p_from date default null,
  p_to   date default null,
  p_include_demo boolean default true
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/El_Salvador')::date;
  v_from  date := coalesce(p_from, v_today - 29);
  v_to    date := coalesce(p_to, v_today);
  v       jsonb;
begin
  if not public.is_staff() then
    raise exception 'No autorizado';
  end if;

  with
  qs as (
    select * from public.quotes
     where (p_include_demo or not is_demo)
  ),
  q_range as (
    select * from qs where issue_date between v_from and v_to
  ),
  decided as (
    select * from q_range where status in ('aceptada', 'rechazada', 'vencida')
  ),
  ords as (
    select o.*, q.requested_at, q.sent_at as q_sent_at, q.accepted_at as q_accepted_at
      from public.orders o join public.quotes q on q.id = o.quote_id
     where (p_include_demo or not o.is_demo)
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'clients', jsonb_build_object(
      'total',      (select count(*) from public.clients where (p_include_demo or not is_demo)),
      'prospects',  (select count(*) from public.clients where status = 'prospecto' and (p_include_demo or not is_demo)),
      'active',     (select count(*) from public.clients where status = 'activo' and (p_include_demo or not is_demo)),
      'new_in_range', (select count(*) from public.clients
                        where (created_at at time zone 'America/El_Salvador')::date between v_from and v_to
                          and (p_include_demo or not is_demo))
    ),
    'visits', jsonb_build_object(
      'done_in_range', (select count(*) from public.visits
                         where status = 'realizada' and (p_include_demo or not is_demo)
                           and (scheduled_at at time zone 'America/El_Salvador')::date between v_from and v_to),
      'upcoming_7d',   (select count(*) from public.visits
                         where status = 'programada' and (p_include_demo or not is_demo)
                           and (scheduled_at at time zone 'America/El_Salvador')::date between v_today and v_today + 7)
    ),
    'quotes', jsonb_build_object(
      'count_in_range',  (select count(*) from q_range where status not in ('borrador', 'cancelada')),
      'amount_in_range', (select coalesce(sum(total), 0) from q_range where status not in ('borrador', 'cancelada')),
      'accepted_amount_in_range', (select coalesce(sum(total), 0) from q_range where status = 'aceptada'),
      'open_pipeline',   (select coalesce(sum(total), 0) from qs where status in ('pendiente_envio', 'enviada', 'negociacion')),
      'by_status', (
        select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n, 'amount', s.amount) order by s.ord), '[]'::jsonb)
          from (
            select e.status, e.ord, count(q.id) as n, coalesce(sum(q.total), 0) as amount
              from unnest(enum_range(null::public.quote_status)) with ordinality as e(status, ord)
              left join q_range q on q.status = e.status
             group by e.status, e.ord
          ) s
      ),
      'conversion_rate', (
        select case when count(*) = 0 then null
                    else round(count(*) filter (where status = 'aceptada')::numeric / count(*) * 100, 1) end
          from decided
      ),
      'decided_count', (select count(*) from decided),
      'followups_late', (
        select count(*) from qs
         where next_action_date < v_today
           and status in ('borrador', 'pendiente_envio', 'enviada', 'negociacion', 'vencida')
      ),
      'validity_expired_open', (
        select count(*) from qs where status in ('enviada', 'negociacion') and valid_until < v_today
      )
    ),
    'tasks', jsonb_build_object(
      'overdue',   (select count(*) from public.tasks where status = 'pendiente' and due_date < v_today and (p_include_demo or not is_demo)),
      'due_today', (select count(*) from public.tasks where status = 'pendiente' and due_date = v_today and (p_include_demo or not is_demo))
    ),
    'orders', jsonb_build_object(
      'open',                (select count(*) from ords where status = 'abierto'),
      'created_in_range',    (select count(*) from ords where status <> 'cancelado'
                               and (created_at at time zone 'America/El_Salvador')::date between v_from and v_to),
      'amount_in_range',     (select coalesce(sum(total), 0) from ords where status <> 'cancelado'
                               and (created_at at time zone 'America/El_Salvador')::date between v_from and v_to),
      'pending_purchase',    (select count(*) from ords where status = 'abierto' and requires_purchase and purchase_status in ('pendiente', 'solicitada')),
      'pending_reception',   (select count(*) from ords where status = 'abierto' and requires_purchase and purchase_status = 'comprada' and reception_status <> 'recibida'),
      'pending_preparation', (select count(*) from ords where status = 'abierto' and preparation_status <> 'lista'),
      'pending_delivery',    (select count(*) from ords where status = 'abierto' and delivery_status <> 'entregada'),
      'delivered_in_range',  (select count(*) from ords where delivered_at is not null
                               and (delivered_at at time zone 'America/El_Salvador')::date between v_from and v_to)
    ),
    -- Tiempos promedio en días (con decimales). Null si no hay datos.
    'times', jsonb_build_object(
      'request_to_sent_days', (
        select round(avg(extract(epoch from (sent_at - requested_at)) / 86400)::numeric, 1)
          from qs where sent_at is not null and sent_at >= requested_at
      ),
      'sent_to_accepted_days', (
        select round(avg(extract(epoch from (accepted_at - sent_at)) / 86400)::numeric, 1)
          from qs where accepted_at is not null and sent_at is not null and accepted_at >= sent_at
      ),
      'accepted_to_delivered_days', (
        select round(avg(extract(epoch from (delivered_at - q_accepted_at)) / 86400)::numeric, 1)
          from ords where delivered_at is not null and q_accepted_at is not null
      ),
      'request_to_delivered_days', (
        select round(avg(extract(epoch from (delivered_at - requested_at)) / 86400)::numeric, 1)
          from ords where delivered_at is not null
      )
    ),
    -- Monto cotizado por mes (últimos 6 meses, incluido el actual)
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'quoted', m.quoted, 'accepted', m.accepted) order by m.month), '[]'::jsonb)
        from (
          select gs.month,
                 coalesce(sum(q.total) filter (where q.status not in ('borrador', 'cancelada')), 0) as quoted,
                 coalesce(sum(q.total) filter (where q.status = 'aceptada'), 0) as accepted
            from generate_series(date_trunc('month', v_today) - interval '5 months', date_trunc('month', v_today), interval '1 month') as gs(month)
            left join qs q on date_trunc('month', q.issue_date) = gs.month
           group by gs.month
        ) m
    )
  ) into v;

  return v;
end;
$$;

grant select on public.v_price_history, public.v_quotes, public.v_orders, public.v_quote_margins to authenticated;
revoke all on public.v_price_history, public.v_quotes, public.v_orders, public.v_quote_margins from anon;

-- >>> 20261014000006_demo_seed.sql
-- =====================================================================
-- Printer Business Hub — 0006: datos de demostración (carga ÚNICA)
--
--  * Guardado por seed_runs('demo') + advisory lock → idempotente.
--  * IDs fijos + ON CONFLICT DO NOTHING → aunque se ejecute de nuevo, no duplica.
--  * Todo marcado is_demo = true. Nunca se borra automáticamente.
--  * Datos ficticios: dominios ejemplo.com / ejemplo.sv y teléfonos 2200-00xx.
--  * La app NUNCA llama esta función: solo esta migración (que corre una vez).
-- =====================================================================

create or replace function public.apply_demo_seed()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  d date := (now() at time zone 'America/El_Salvador')::date;
  -- clientes
  c1 uuid := 'd1000000-0000-4000-8000-000000000001';
  c2 uuid := 'd1000000-0000-4000-8000-000000000002';
  c3 uuid := 'd1000000-0000-4000-8000-000000000003';
  c4 uuid := 'd1000000-0000-4000-8000-000000000004';
  c5 uuid := 'd1000000-0000-4000-8000-000000000005';
  -- contactos
  k1 uuid := 'd2000000-0000-4000-8000-000000000001';
  k2 uuid := 'd2000000-0000-4000-8000-000000000002';
  k3 uuid := 'd2000000-0000-4000-8000-000000000003';
  k4 uuid := 'd2000000-0000-4000-8000-000000000004';
  k5 uuid := 'd2000000-0000-4000-8000-000000000005';
  -- proveedores
  s1 uuid := 'd3000000-0000-4000-8000-000000000001';
  s2 uuid := 'd3000000-0000-4000-8000-000000000002';
  -- productos / servicios
  p1 uuid := 'd4000000-0000-4000-8000-000000000001';
  p2 uuid := 'd4000000-0000-4000-8000-000000000002';
  p3 uuid := 'd4000000-0000-4000-8000-000000000003';
  p4 uuid := 'd4000000-0000-4000-8000-000000000004';
  p5 uuid := 'd4000000-0000-4000-8000-000000000005';
  p6 uuid := 'd4000000-0000-4000-8000-000000000006';
  p7 uuid := 'd4000000-0000-4000-8000-000000000007';
  p8 uuid := 'd4000000-0000-4000-8000-000000000008';
  -- cotizaciones
  q1 uuid := 'd5000000-0000-4000-8000-000000000001';
  q2 uuid := 'd5000000-0000-4000-8000-000000000002';
  q3 uuid := 'd5000000-0000-4000-8000-000000000003';
  q4 uuid := 'd5000000-0000-4000-8000-000000000004';
  q5 uuid := 'd5000000-0000-4000-8000-000000000005';
  q6 uuid := 'd5000000-0000-4000-8000-000000000006';
  -- pedidos
  o1 uuid := 'd6000000-0000-4000-8000-000000000001';
  o2 uuid := 'd6000000-0000-4000-8000-000000000002';
  po1 uuid := 'd7000000-0000-4000-8000-000000000001';
begin
  perform pg_advisory_xact_lock(hashtext('printer_hub_demo_seed'));
  if exists (select 1 from public.seed_runs where seed_key = 'demo') then
    return 'skipped: demo seed already applied';
  end if;

  perform public._begin_trusted();

  -- ---------------- Clientes ----------------
  insert into public.clients (id, name, legal_name, industry, status, source, address, city, department, phone, email, needs, is_demo, created_at) values
    (c1, 'Comercial Altavista (Demo)', 'Comercial Altavista, S.A. de C.V.', 'Comercio', 'activo', 'Referido',
         'Calle Ficticia 101', 'San Salvador', 'San Salvador', '2200-0001', 'compras@altavista.ejemplo.sv',
         'Renovación de equipos de cómputo del área administrativa.', true, now() - interval '60 days'),
    (c2, 'Colegio Las Brisas (Demo)', 'Asociación Educativa Las Brisas', 'Educación', 'activo', 'Visita en frío',
         'Av. de Prueba 22', 'Santa Tecla', 'La Libertad', '2200-0002', 'administracion@lasbrisas.ejemplo.sv',
         'Laboratorio de computación y mantenimiento de impresoras.', true, now() - interval '45 days'),
    (c3, 'Clínica Santa Elena (Demo)', 'Servicios Médicos Santa Elena, S.A. de C.V.', 'Salud', 'prospecto', 'Sitio web',
         'Boulevard Demo 3', 'Antiguo Cuscatlán', 'La Libertad', '2200-0003', 'it@santaelena.ejemplo.sv',
         'Cableado estructurado y respaldo eléctrico para recepción.', true, now() - interval '20 days'),
    (c4, 'Ferretería El Progreso (Demo)', 'Ferretería El Progreso', 'Ferretería', 'activo', 'Cliente recurrente',
         'Km 0 Carretera de Ejemplo', 'San Miguel', 'San Miguel', '2200-0004', 'gerencia@elprogreso.ejemplo.sv',
         'Punto de venta e impresión de facturas.', true, now() - interval '90 days'),
    (c5, 'Logística Cuscatlán (Demo)', 'Logística Cuscatlán, S.A. de C.V.', 'Logística', 'prospecto', 'Feria comercial',
         'Zona Franca Ficticia, Bodega 5', 'Soyapango', 'San Salvador', '2200-0005', 'operaciones@logcuscatlan.ejemplo.sv',
         'Monitores y UPS para centro de despacho.', true, now() - interval '7 days')
  on conflict (id) do nothing;

  insert into public.contacts (id, client_id, full_name, position, email, phone, is_primary, is_demo) values
    (k1, c1, 'Ana Demo Martínez',   'Jefa de Compras',        'ana.demo@altavista.ejemplo.sv',      '7000-0001', true, true),
    (k2, c2, 'Luis Demo Hernández', 'Administrador',          'luis.demo@lasbrisas.ejemplo.sv',     '7000-0002', true, true),
    (k3, c3, 'Carla Demo Rivas',    'Coordinadora de TI',     'carla.demo@santaelena.ejemplo.sv',   '7000-0003', true, true),
    (k4, c4, 'Mario Demo López',    'Gerente General',        'mario.demo@elprogreso.ejemplo.sv',   '7000-0004', true, true),
    (k5, c5, 'Sofía Demo Castro',   'Gerente de Operaciones', 'sofia.demo@logcuscatlan.ejemplo.sv', '7000-0005', true, true)
  on conflict (id) do nothing;

  -- ---------------- Proveedores ----------------
  insert into public.suppliers (id, name, contact_name, email, phone, notes, is_demo) values
    (s1, 'Mayorista Tecnológico Demo', 'Equipo de ventas', 'ventas@mayorista.ejemplo.com', '2200-0090', 'Proveedor ficticio de equipos.', true),
    (s2, 'Suministros de Oficina Demo', 'Atención a clientes', 'pedidos@suministros.ejemplo.com', '2200-0091', 'Proveedor ficticio de consumibles.', true)
  on conflict (id) do nothing;

  -- ---------------- Catálogo ----------------
  insert into public.products (id, sku, name, description, kind, category, brand, unit, sale_price, taxable, is_demo) values
    (p1, 'DEMO-LAP-001', 'Laptop empresarial 14"',        'Core i5, 16 GB RAM, SSD 512 GB, Windows 11 Pro', 'producto', 'Computadoras', 'MarcaDemo', 'unidad', 789.00, true, true),
    (p2, 'DEMO-DSK-001', 'Desktop de oficina',            'Core i3, 8 GB RAM, SSD 256 GB',                  'producto', 'Computadoras', 'MarcaDemo', 'unidad', 545.00, true, true),
    (p3, 'DEMO-MON-024', 'Monitor 24" Full HD',           'Panel IPS, HDMI/DisplayPort',                    'producto', 'Monitores',    'MarcaDemo', 'unidad', 139.00, true, true),
    (p4, 'DEMO-IMP-MF1', 'Multifuncional láser',          'Imprime, copia y escanea, dúplex, red',          'producto', 'Impresoras',   'MarcaDemo', 'unidad', 329.00, true, true),
    (p5, 'DEMO-TON-001', 'Tóner para multifuncional',     'Rendimiento estándar',                           'producto', 'Consumibles',  'MarcaDemo', 'unidad',  78.50, true, true),
    (p6, 'DEMO-UPS-1K',  'UPS 1000 VA',                   'Respaldo para estación de trabajo',              'producto', 'Energía',      'MarcaDemo', 'unidad', 119.00, true, true),
    (p7, 'DEMO-SRV-MP',  'Mantenimiento preventivo',      'Limpieza y diagnóstico por equipo',              'servicio', 'Servicios',    null,        'equipo',  25.00, true, true),
    (p8, 'DEMO-SRV-CAB', 'Punto de cableado estructurado','Cat 6 certificado, incluye faceplate y patch cord','servicio','Servicios',   null,        'punto',   45.00, true, true)
  on conflict (id) do nothing;

  insert into public.product_costs (product_id, unit_cost, supplier_id) values
    (p1, 640.00, s1), (p2, 430.00, s1), (p3, 102.00, s1), (p4, 255.00, s1),
    (p5, 52.00, s2),  (p6, 86.00, s1),  (p7, 8.00, null), (p8, 22.00, null)
  on conflict (product_id) do nothing;

  -- ---------------- Visitas ----------------
  insert into public.visits (id, client_id, contact_id, title, objective, scheduled_at, location, status, comments, agreements, next_action, next_action_date, is_demo) values
    ('d8000000-0000-4000-8000-000000000001', c2, k2, 'Diagnóstico del laboratorio',
       'Levantar inventario de equipos e impresoras.', (d - 12)::timestamp + time '09:30', 'Instalaciones del cliente', 'realizada',
       'Laboratorio con 20 equipos; 3 impresoras con fallas.', 'Enviar cotización de mantenimiento y tóner.', 'Enviar cotización', d - 10, true),
    ('d8000000-0000-4000-8000-000000000002', c3, k3, 'Revisión de cableado en recepción',
       'Definir puntos de red y respaldo eléctrico.', (d - 5)::timestamp + time '14:00', 'Clínica', 'realizada',
       'Se requieren 12 puntos de red y 4 UPS.', 'Cotizar cableado + UPS con instalación.', 'Negociar descuento', d + 2, true),
    ('d8000000-0000-4000-8000-000000000003', c5, k5, 'Presentación de soluciones',
       'Presentar portafolio de monitores y respaldo.', (d + 3)::timestamp + time '10:00', 'Oficinas del cliente', 'programada',
       null, null, null, null, true)
  on conflict (id) do nothing;

  -- ---------------- Cotizaciones ----------------
  insert into public.quotes (id, number, client_id, contact_id, title, status, requested_at, issue_date, valid_until, tax_rate,
                             terms, notes, sent_at, accepted_at, rejected_at, closed_at, rejection_reason, next_action, next_action_date, is_demo) values
    (q1, '', c1, k1, 'Renovación de laptops – área administrativa', 'borrador',
         now() - interval '2 days', d - 1, d + 14, 13, 'Precios en USD. Entrega 5 días hábiles después de la orden de compra.', null,
         null, null, null, null, null, 'Confirmar cantidades con compras', d + 1, true),
    (q2, '', c2, k2, 'Mantenimiento y consumibles – laboratorio', 'enviada',
         (d - 11)::timestamp + time '08:00', d - 10, d + 5, 13, 'Precios en USD. Forma de pago: crédito 30 días.', null,
         (d - 10)::timestamp + time '16:00', null, null, null, null, 'Llamar para confirmar recepción', d - 2, true),
    (q3, '', c3, k3, 'Cableado estructurado y UPS – recepción', 'negociacion',
         (d - 5)::timestamp + time '15:00', d - 4, d + 11, 13, 'Incluye instalación y certificación de puntos.', 'Instalación en horario no hábil.',
         (d - 3)::timestamp + time '10:00', null, null, null, null, 'Responder solicitud de descuento', d + 2, true),
    (q4, '', c4, k4, 'Equipos punto de venta', 'aceptada',
         (d - 25)::timestamp + time '09:00', d - 24, d - 9, 13, 'Precios en USD. Garantía según fabricante.', null,
         (d - 23)::timestamp + time '11:00', (d - 18)::timestamp + time '15:30', null, (d - 18)::timestamp + time '15:30', null, null, null, true),
    (q5, '', c1, k1, 'Multifuncionales para sucursales', 'aceptada',
         (d - 9)::timestamp + time '10:00', d - 8, d + 7, 13, 'Precios en USD.', null,
         (d - 8)::timestamp + time '17:00', (d - 3)::timestamp + time '12:00', null, (d - 3)::timestamp + time '12:00', null, null, null, true),
    (q6, '', c5, k5, 'Monitores para centro de despacho', 'rechazada',
         (d - 15)::timestamp + time '13:00', d - 14, d + 1, 13, 'Precios en USD.', null,
         (d - 14)::timestamp + time '18:00', null, (d - 6)::timestamp + time '09:00', (d - 6)::timestamp + time '09:00',
         'El cliente pospuso la compra para el próximo trimestre.', null, null, true)
  on conflict (id) do nothing;

  insert into public.quote_items (id, quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable) values
    -- Q1: 5 laptops con 5 % de descuento
    ('d9000000-0000-4000-8000-000000000101', q1, 1, p1, 'producto', 'DEMO-LAP-001', 'Laptop empresarial 14" – Core i5, 16 GB, SSD 512 GB', 'unidad', 5, 789.00, 5, true),
    ('d9000000-0000-4000-8000-000000000102', q1, 2, null, 'servicio', null, 'Configuración inicial y migración de datos (línea personalizada)', 'equipo', 5, 20.00, 0, true),
    -- Q2: mantenimiento + tóner
    ('d9000000-0000-4000-8000-000000000201', q2, 1, p7, 'servicio', 'DEMO-SRV-MP', 'Mantenimiento preventivo', 'equipo', 20, 25.00, 10, true),
    ('d9000000-0000-4000-8000-000000000202', q2, 2, p5, 'producto', 'DEMO-TON-001', 'Tóner para multifuncional', 'unidad', 6, 78.50, 0, true),
    -- Q3: cableado + UPS
    ('d9000000-0000-4000-8000-000000000301', q3, 1, p8, 'servicio', 'DEMO-SRV-CAB', 'Punto de cableado estructurado Cat 6', 'punto', 12, 45.00, 0, true),
    ('d9000000-0000-4000-8000-000000000302', q3, 2, p6, 'producto', 'DEMO-UPS-1K', 'UPS 1000 VA', 'unidad', 4, 119.00, 0, true),
    -- Q4: punto de venta
    ('d9000000-0000-4000-8000-000000000401', q4, 1, p2, 'producto', 'DEMO-DSK-001', 'Desktop de oficina', 'unidad', 2, 545.00, 0, true),
    ('d9000000-0000-4000-8000-000000000402', q4, 2, p3, 'producto', 'DEMO-MON-024', 'Monitor 24" Full HD', 'unidad', 2, 139.00, 0, true),
    ('d9000000-0000-4000-8000-000000000403', q4, 3, p6, 'producto', 'DEMO-UPS-1K', 'UPS 1000 VA', 'unidad', 2, 119.00, 0, true),
    -- Q5: multifuncionales
    ('d9000000-0000-4000-8000-000000000501', q5, 1, p4, 'producto', 'DEMO-IMP-MF1', 'Multifuncional láser', 'unidad', 3, 329.00, 3, true),
    ('d9000000-0000-4000-8000-000000000502', q5, 2, p5, 'producto', 'DEMO-TON-001', 'Tóner para multifuncional', 'unidad', 3, 78.50, 0, true),
    -- Q6: monitores
    ('d9000000-0000-4000-8000-000000000601', q6, 1, p3, 'producto', 'DEMO-MON-024', 'Monitor 24" Full HD', 'unidad', 10, 139.00, 8, true)
  on conflict (id) do nothing;

  -- Costos por línea (para márgenes) tomados del costo de catálogo
  insert into public.quote_item_costs (quote_item_id, unit_cost)
  select qi.id, pc.unit_cost
    from public.quote_items qi join public.product_costs pc on pc.product_id = qi.product_id
   where qi.quote_id in (q1, q2, q3, q4, q5, q6)
  on conflict (quote_item_id) do nothing;
  insert into public.quote_item_costs (quote_item_id, unit_cost)
  values ('d9000000-0000-4000-8000-000000000102', 6.00)
  on conflict (quote_item_id) do nothing;

  -- Cargo de instalación (gravado) y deducción por pronto pago (no gravada) en Q3
  insert into public.quote_adjustments (id, quote_id, position, kind, label, amount, taxable) values
    ('da000000-0000-4000-8000-000000000301', q3, 1, 'cargo', 'Instalación fuera de horario', 60.00, true),
    ('da000000-0000-4000-8000-000000000302', q3, 2, 'deduccion', 'Descuento comercial negociado', 40.00, false)
  on conflict (id) do nothing;

  -- Historial de estados para que la línea de tiempo tenga sentido
  insert into public.quote_events (quote_id, event_type, from_status, to_status, comment, created_at)
  select x.qid, 'estado', x.f::public.quote_status, x.t::public.quote_status, x.cmt, x.at
    from (values
      (q2, 'borrador', 'enviada',     'Enviada por correo (demo)',                (d - 10)::timestamp + time '16:00'),
      (q3, 'borrador', 'enviada',     null,                                       (d - 3)::timestamp + time '10:00'),
      (q3, 'enviada',  'negociacion', 'El cliente solicita mejorar precio',       (d - 1)::timestamp + time '11:00'),
      (q4, 'borrador', 'enviada',     null,                                       (d - 23)::timestamp + time '11:00'),
      (q4, 'enviada',  'aceptada',    'Orden de compra del cliente recibida',     (d - 18)::timestamp + time '15:30'),
      (q5, 'borrador', 'enviada',     null,                                       (d - 8)::timestamp + time '17:00'),
      (q5, 'enviada',  'aceptada',    'Aprobada por gerencia del cliente',        (d - 3)::timestamp + time '12:00'),
      (q6, 'borrador', 'enviada',     null,                                       (d - 14)::timestamp + time '18:00'),
      (q6, 'enviada',  'rechazada',   'El cliente pospuso la compra',             (d - 6)::timestamp + time '09:00')
    ) as x(qid, f, t, cmt, at)
   where not exists (select 1 from public.quote_events e where e.quote_id = x.qid and e.event_type = 'estado');

  -- ---------------- Tareas ----------------
  insert into public.tasks (id, title, description, due_date, status, priority, client_id, quote_id, visit_id, is_demo) values
    ('db000000-0000-4000-8000-000000000001', 'Llamar al Colegio Las Brisas', 'Confirmar que recibieron la cotización de mantenimiento.', d - 2, 'pendiente', 'alta', c2, q2, 'd8000000-0000-4000-8000-000000000001', true),
    ('db000000-0000-4000-8000-000000000002', 'Responder solicitud de descuento', 'Revisar margen antes de ofrecer descuento adicional.', d + 2, 'pendiente', 'media', c3, q3, 'd8000000-0000-4000-8000-000000000002', true),
    ('db000000-0000-4000-8000-000000000003', 'Preparar demo de monitores', 'Llevar muestra a la presentación.', d + 3, 'pendiente', 'baja', c5, null, 'd8000000-0000-4000-8000-000000000003', true)
  on conflict (id) do nothing;

  -- ---------------- Pedidos ----------------
  -- Pedido 1 (de Q4): comprado y recibido, en preparación, entrega pendiente
  insert into public.orders (id, number, quote_id, client_id, requires_purchase,
                             purchase_status, reception_status, preparation_status, delivery_status,
                             purchased_at, received_at, expected_delivery_date, notes, subtotal, tax_total, total, is_demo, created_at)
  select o1, '', q.id, q.client_id, true,
         'comprada', 'recibida', 'en_proceso', 'pendiente',
         (d - 16)::timestamp + time '10:00', (d - 6)::timestamp + time '14:00', d + 2,
         'Instalar en caja principal.', q.total - q.tax_total, q.tax_total, q.total, true, (d - 18)::timestamp + time '16:00'
    from public.quotes q where q.id = q4
  on conflict (id) do nothing;

  -- Pedido 2 (de Q5): recién creado, compra pendiente
  insert into public.orders (id, number, quote_id, client_id, requires_purchase,
                             expected_delivery_date, subtotal, tax_total, total, is_demo, created_at)
  select o2, '', q.id, q.client_id, true, d + 10, q.total - q.tax_total, q.tax_total, q.total, true, (d - 3)::timestamp + time '13:00'
    from public.quotes q where q.id = q5
  on conflict (id) do nothing;

  insert into public.order_items (order_id, quote_item_id, position, product_id, kind, sku, description, unit, quantity, unit_price, line_total, quantity_received)
  select o.id, qi.id, qi.position, qi.product_id, qi.kind, qi.sku, qi.description, qi.unit, qi.quantity,
         round(qi.line_total / qi.quantity, 2), qi.line_total,
         case when o.id = o1 then qi.quantity else 0 end
    from public.orders o
    join public.quote_items qi on qi.quote_id = o.quote_id
   where o.id in (o1, o2)
     and not exists (select 1 from public.order_items oi where oi.order_id = o.id);

  insert into public.order_events (order_id, stage, from_value, to_value, comment, created_at)
  select x.oid, x.stage, x.f, x.t, x.cmt, x.at
    from (values
      (o1, 'creado',      null,         'abierto',    'Creado desde cotización aceptada', (d - 18)::timestamp + time '16:00'),
      (o1, 'compra',      'pendiente',  'comprada',   'OC enviada al proveedor',          (d - 16)::timestamp + time '10:00'),
      (o1, 'recepcion',   'pendiente',  'recibida',   'Mercadería completa',              (d - 6)::timestamp + time '14:00'),
      (o1, 'preparacion', 'pendiente',  'en_proceso', 'Instalando software',              (d - 5)::timestamp + time '09:00'),
      (o2, 'creado',      null,         'abierto',    'Creado desde cotización aceptada', (d - 3)::timestamp + time '13:00')
    ) as x(oid, stage, f, t, cmt, at)
   where not exists (select 1 from public.order_events e where e.order_id = x.oid);

  insert into public.purchase_orders (id, number, order_id, supplier_id, status, ordered_at, expected_at, received_at, notes, is_demo)
  values (po1, '', o1, s1, 'recibida', d - 16, d - 8, d - 6, 'OC ficticia de demostración.', true)
  on conflict (id) do nothing;

  insert into public.purchase_order_items (purchase_order_id, order_item_id, description, quantity, unit_cost, quantity_received)
  select po1, oi.id, oi.description, oi.quantity, pc.unit_cost, oi.quantity
    from public.order_items oi
    join public.product_costs pc on pc.product_id = oi.product_id
   where oi.order_id = o1
     and not exists (select 1 from public.purchase_order_items x where x.purchase_order_id = po1);

  insert into public.seed_runs (seed_key, version) values ('demo', 1);
  perform public._end_trusted();
  return 'applied: demo seed v1';
end;
$$;

revoke execute on function public.apply_demo_seed() from public, anon, authenticated;

-- Única ejecución: las migraciones de Supabase corren una sola vez por base de datos.
select public.apply_demo_seed();

-- >>> 20261014000007_save_quote.sql
-- =====================================================================
-- Printer Business Hub — 0007: guardado atómico de cotizaciones
-- Un solo request guarda encabezado + líneas + cargos/deducciones (+ costos
-- si el usuario tiene permiso). SECURITY INVOKER: aplica RLS y triggers
-- normales, así que los permisos y los cálculos siguen en la base de datos.
-- =====================================================================

create or replace function public.save_quote(p jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_status  public.quote_status;
  it        jsonb;
  v_item    uuid;
  v_adj     uuid;
  i         int := 0;
  keep_items uuid[] := '{}';
  keep_adj   uuid[] := '{}';
  v_costs   boolean := public.can_see_costs();
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado para crear o editar cotizaciones';
  end if;
  if nullif(p ->> 'client_id', '') is null then
    raise exception 'Elegí un cliente';
  end if;

  if v_id is null then
    insert into public.quotes (
      number, client_id, contact_id, owner_id, title, requested_at, issue_date, valid_until,
      currency, tax_rate, terms, notes, internal_notes, next_action, next_action_date
    ) values (
      '',
      (p ->> 'client_id')::uuid,
      nullif(p ->> 'contact_id', '')::uuid,
      coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()),
      nullif(trim(p ->> 'title'), ''),
      coalesce(nullif(p ->> 'requested_at', '')::timestamptz, now()),
      coalesce(nullif(p ->> 'issue_date', '')::date, (now() at time zone 'America/El_Salvador')::date),
      nullif(p ->> 'valid_until', '')::date,
      coalesce(nullif(p ->> 'currency', ''), 'USD'),
      coalesce(nullif(p ->> 'tax_rate', '')::numeric, (select default_tax_rate from public.company_settings where id = 1)),
      nullif(trim(p ->> 'terms'), ''),
      nullif(trim(p ->> 'notes'), ''),
      nullif(trim(p ->> 'internal_notes'), ''),
      nullif(trim(p ->> 'next_action'), ''),
      nullif(p ->> 'next_action_date', '')::date
    ) returning id into v_id;
  else
    select status into v_status from public.quotes where id = v_id for update;
    if not found then
      raise exception 'Cotización no encontrada';
    end if;
    if not public.quote_is_editable(v_status) then
      raise exception 'La cotización está en estado "%" y ya no se puede editar', v_status;
    end if;
    update public.quotes set
      client_id        = (p ->> 'client_id')::uuid,
      contact_id       = nullif(p ->> 'contact_id', '')::uuid,
      owner_id         = nullif(p ->> 'owner_id', '')::uuid,
      title            = nullif(trim(p ->> 'title'), ''),
      requested_at     = coalesce(nullif(p ->> 'requested_at', '')::timestamptz, requested_at),
      issue_date       = coalesce(nullif(p ->> 'issue_date', '')::date, issue_date),
      valid_until      = nullif(p ->> 'valid_until', '')::date,
      currency         = coalesce(nullif(p ->> 'currency', ''), currency),
      tax_rate         = coalesce(nullif(p ->> 'tax_rate', '')::numeric, tax_rate),
      terms            = nullif(trim(p ->> 'terms'), ''),
      notes            = nullif(trim(p ->> 'notes'), ''),
      internal_notes   = nullif(trim(p ->> 'internal_notes'), ''),
      next_action      = nullif(trim(p ->> 'next_action'), ''),
      next_action_date = nullif(p ->> 'next_action_date', '')::date
    where id = v_id;
  end if;

  -- Líneas
  for it in select value from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    v_item := nullif(it ->> 'id', '')::uuid;
    if v_item is not null and exists (select 1 from public.quote_items where id = v_item and quote_id = v_id) then
      update public.quote_items set
        position     = i,
        product_id   = nullif(it ->> 'product_id', '')::uuid,
        kind         = coalesce(nullif(it ->> 'kind', ''), 'producto')::public.item_kind,
        sku          = nullif(trim(it ->> 'sku'), ''),
        description  = trim(it ->> 'description'),
        unit         = coalesce(nullif(trim(it ->> 'unit'), ''), 'unidad'),
        quantity     = (it ->> 'quantity')::numeric,
        unit_price   = (it ->> 'unit_price')::numeric,
        discount_pct = coalesce(nullif(it ->> 'discount_pct', '')::numeric, 0),
        taxable      = coalesce((it ->> 'taxable')::boolean, true)
      where id = v_item;
    else
      insert into public.quote_items (quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable)
      values (
        v_id, i,
        nullif(it ->> 'product_id', '')::uuid,
        coalesce(nullif(it ->> 'kind', ''), 'producto')::public.item_kind,
        nullif(trim(it ->> 'sku'), ''),
        trim(it ->> 'description'),
        coalesce(nullif(trim(it ->> 'unit'), ''), 'unidad'),
        (it ->> 'quantity')::numeric,
        (it ->> 'unit_price')::numeric,
        coalesce(nullif(it ->> 'discount_pct', '')::numeric, 0),
        coalesce((it ->> 'taxable')::boolean, true)
      ) returning id into v_item;
    end if;
    keep_items := keep_items || v_item;

    if v_costs then
      if nullif(it ->> 'unit_cost', '') is null then
        delete from public.quote_item_costs where quote_item_id = v_item;
      else
        insert into public.quote_item_costs (quote_item_id, unit_cost)
        values (v_item, (it ->> 'unit_cost')::numeric)
        on conflict (quote_item_id) do update set unit_cost = excluded.unit_cost;
      end if;
    end if;
  end loop;

  delete from public.quote_items where quote_id = v_id and id <> all (keep_items);

  -- Cargos y deducciones
  i := 0;
  for it in select value from jsonb_array_elements(coalesce(p -> 'adjustments', '[]'::jsonb)) loop
    i := i + 1;
    v_adj := nullif(it ->> 'id', '')::uuid;
    if v_adj is not null and exists (select 1 from public.quote_adjustments where id = v_adj and quote_id = v_id) then
      update public.quote_adjustments set
        position = i,
        kind     = (it ->> 'kind')::public.adjustment_kind,
        label    = trim(it ->> 'label'),
        amount   = (it ->> 'amount')::numeric,
        taxable  = coalesce((it ->> 'taxable')::boolean, false)
      where id = v_adj;
    else
      insert into public.quote_adjustments (quote_id, position, kind, label, amount, taxable)
      values (v_id, i, (it ->> 'kind')::public.adjustment_kind, trim(it ->> 'label'),
              (it ->> 'amount')::numeric, coalesce((it ->> 'taxable')::boolean, false))
      returning id into v_adj;
    end if;
    keep_adj := keep_adj || v_adj;
  end loop;

  delete from public.quote_adjustments where quote_id = v_id and id <> all (keep_adj);

  return v_id;
end;
$$;

revoke execute on function public.save_quote(jsonb) from public, anon;
grant execute on function public.save_quote(jsonb) to authenticated;

-- >>> 20261014000008_purge_demo.sql
-- =====================================================================
-- Printer Business Hub — 0008: borrar datos demo (manual, solo admin)
-- Nunca se ejecuta automáticamente. Solo borra filas is_demo = true y lo
-- que cuelga de ellas. Si un registro real quedó ligado a un dato demo
-- (p. ej. una cotización real para un cliente demo), se detiene y avisa.
-- =====================================================================

create or replace function public.purge_demo_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.has_role('admin') and auth.uid() is not null then
    raise exception 'Solo un administrador puede borrar los datos demo';
  end if;

  if exists (select 1 from public.quotes q join public.clients c on c.id = q.client_id where c.is_demo and not q.is_demo) then
    raise exception 'Hay cotizaciones reales asociadas a clientes demo. Reasignalas antes de borrar los datos demo.';
  end if;

  perform public._begin_trusted();

  with
    po  as (delete from public.purchase_orders where is_demo returning 1),
    o   as (delete from public.orders where is_demo returning 1)
  select jsonb_build_object('purchase_orders', (select count(*) from po), 'orders', (select count(*) from o)) into v;

  with
    t  as (delete from public.tasks where is_demo returning 1),
    vi as (delete from public.visits where is_demo returning 1)
  select v || jsonb_build_object('tasks', (select count(*) from t), 'visits', (select count(*) from vi)) into v;

  with q as (delete from public.quotes where is_demo returning 1)
  select v || jsonb_build_object('quotes', (select count(*) from q)) into v;

  with
    ct as (delete from public.contacts where is_demo returning 1),
    c  as (delete from public.clients where is_demo returning 1)
  select v || jsonb_build_object('contacts', (select count(*) from ct), 'clients', (select count(*) from c)) into v;

  with
    p as (delete from public.products where is_demo returning 1),
    s as (delete from public.suppliers where is_demo returning 1)
  select v || jsonb_build_object('products', (select count(*) from p), 'suppliers', (select count(*) from s)) into v;

  perform public._end_trusted();
  return v;
end;
$$;

revoke execute on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

-- >>> 20261015000009_adjustment_percent.sql
-- =====================================================================
-- Printer Business Hub — 0009: cargos y deducciones por porcentaje
--
-- Cada cargo/deducción puede ser un monto fijo (percent = null) o un
-- porcentaje del subtotal neto de las líneas (después de descuentos por
-- línea). Si es porcentaje, la base de datos calcula el monto al recalcular
-- la cotización, así que se actualiza solo cuando cambian las líneas.
-- Seguro de ejecutar más de una vez.
-- =====================================================================

alter table public.quote_adjustments
  add column if not exists percent numeric(5,2);

do $$ begin
  alter table public.quote_adjustments
    add constraint quote_adjustments_percent_chk check (percent is null or (percent > 0 and percent <= 100));
exception when duplicate_object then null;
end $$;

-- Recalcular: primero los montos de los ajustes en %, luego los totales.
create or replace function public.recalc_quote_totals(_quote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tax_rate     numeric;
  v_subtotal     numeric := 0;
  v_discount     numeric := 0;
  v_net          numeric := 0;
  v_taxable_ln   numeric := 0;
  v_charges      numeric := 0;
  v_deductions   numeric := 0;
  v_tax_charges  numeric := 0;
  v_tax_deduct   numeric := 0;
  v_base         numeric := 0;
  v_tax          numeric := 0;
begin
  select tax_rate into v_tax_rate from public.quotes where id = _quote_id;
  if not found then return; end if;

  select coalesce(sum(line_subtotal), 0),
         coalesce(sum(line_discount), 0),
         coalesce(sum(line_total), 0),
         coalesce(sum(line_total) filter (where taxable), 0)
    into v_subtotal, v_discount, v_net, v_taxable_ln
    from public.quote_items where quote_id = _quote_id;

  perform set_config('app.recalc', 'on', true);

  update public.quote_adjustments
     set amount = round(v_net * percent / 100, 2)
   where quote_id = _quote_id
     and percent is not null
     and amount is distinct from round(v_net * percent / 100, 2);

  select coalesce(sum(amount) filter (where kind = 'cargo'), 0),
         coalesce(sum(amount) filter (where kind = 'deduccion'), 0),
         coalesce(sum(amount) filter (where kind = 'cargo' and taxable), 0),
         coalesce(sum(amount) filter (where kind = 'deduccion' and taxable), 0)
    into v_charges, v_deductions, v_tax_charges, v_tax_deduct
    from public.quote_adjustments where quote_id = _quote_id;

  v_base := greatest(v_taxable_ln + v_tax_charges - v_tax_deduct, 0);
  v_tax  := round(v_base * v_tax_rate / 100, 2);

  update public.quotes
     set subtotal         = v_subtotal,
         discount_total   = v_discount,
         charges_total    = v_charges,
         deductions_total = v_deductions,
         taxable_base     = v_base,
         tax_total        = v_tax,
         total            = v_net + v_charges - v_deductions + v_tax
   where id = _quote_id;
  perform set_config('app.recalc', '', true);
end;
$$;
revoke execute on function public.recalc_quote_totals(uuid) from public, anon, authenticated;

-- Los cambios hechos por el propio recálculo no vuelven a disparar recálculo.
create or replace function public.tg_recalc_parent_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.recalc', true), '') = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_quote_totals(old.quote_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    perform public.recalc_quote_totals(new.quote_id);
  end if;
  return null;
end;
$$;

create or replace function public.tg_quote_adjustments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.quote_status;
begin
  if coalesce(current_setting('app.recalc', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  select status into v_status from public.quotes where id = coalesce(new.quote_id, old.quote_id);
  if not public._trusted() and v_status is not null and not public.quote_is_editable(v_status) then
    raise exception 'La cotización está en estado "%" y ya no se puede editar', v_status;
  end if;
  return coalesce(new, old);
end;
$$;

-- Guardado atómico: ahora acepta "percent" en cada cargo/deducción.
create or replace function public.save_quote(p jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_status  public.quote_status;
  it        jsonb;
  v_item    uuid;
  v_adj     uuid;
  i         int := 0;
  keep_items uuid[] := '{}';
  keep_adj   uuid[] := '{}';
  v_costs   boolean := public.can_see_costs();
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado para crear o editar cotizaciones';
  end if;
  if nullif(p ->> 'client_id', '') is null then
    raise exception 'Elegí un cliente';
  end if;

  if v_id is null then
    insert into public.quotes (
      number, client_id, contact_id, owner_id, title, requested_at, issue_date, valid_until,
      currency, tax_rate, terms, notes, internal_notes, next_action, next_action_date
    ) values (
      '',
      (p ->> 'client_id')::uuid,
      nullif(p ->> 'contact_id', '')::uuid,
      coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()),
      nullif(trim(p ->> 'title'), ''),
      coalesce(nullif(p ->> 'requested_at', '')::timestamptz, now()),
      coalesce(nullif(p ->> 'issue_date', '')::date, (now() at time zone 'America/El_Salvador')::date),
      nullif(p ->> 'valid_until', '')::date,
      coalesce(nullif(p ->> 'currency', ''), 'USD'),
      coalesce(nullif(p ->> 'tax_rate', '')::numeric, (select default_tax_rate from public.company_settings where id = 1)),
      nullif(trim(p ->> 'terms'), ''),
      nullif(trim(p ->> 'notes'), ''),
      nullif(trim(p ->> 'internal_notes'), ''),
      nullif(trim(p ->> 'next_action'), ''),
      nullif(p ->> 'next_action_date', '')::date
    ) returning id into v_id;
  else
    select status into v_status from public.quotes where id = v_id for update;
    if not found then
      raise exception 'Cotización no encontrada';
    end if;
    if not public.quote_is_editable(v_status) then
      raise exception 'La cotización está en estado "%" y ya no se puede editar', v_status;
    end if;
    update public.quotes set
      client_id        = (p ->> 'client_id')::uuid,
      contact_id       = nullif(p ->> 'contact_id', '')::uuid,
      owner_id         = nullif(p ->> 'owner_id', '')::uuid,
      title            = nullif(trim(p ->> 'title'), ''),
      requested_at     = coalesce(nullif(p ->> 'requested_at', '')::timestamptz, requested_at),
      issue_date       = coalesce(nullif(p ->> 'issue_date', '')::date, issue_date),
      valid_until      = nullif(p ->> 'valid_until', '')::date,
      currency         = coalesce(nullif(p ->> 'currency', ''), currency),
      tax_rate         = coalesce(nullif(p ->> 'tax_rate', '')::numeric, tax_rate),
      terms            = nullif(trim(p ->> 'terms'), ''),
      notes            = nullif(trim(p ->> 'notes'), ''),
      internal_notes   = nullif(trim(p ->> 'internal_notes'), ''),
      next_action      = nullif(trim(p ->> 'next_action'), ''),
      next_action_date = nullif(p ->> 'next_action_date', '')::date
    where id = v_id;
  end if;

  -- Líneas
  for it in select value from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    v_item := nullif(it ->> 'id', '')::uuid;
    if v_item is not null and exists (select 1 from public.quote_items where id = v_item and quote_id = v_id) then
      update public.quote_items set
        position     = i,
        product_id   = nullif(it ->> 'product_id', '')::uuid,
        kind         = coalesce(nullif(it ->> 'kind', ''), 'producto')::public.item_kind,
        sku          = nullif(trim(it ->> 'sku'), ''),
        description  = trim(it ->> 'description'),
        unit         = coalesce(nullif(trim(it ->> 'unit'), ''), 'unidad'),
        quantity     = (it ->> 'quantity')::numeric,
        unit_price   = (it ->> 'unit_price')::numeric,
        discount_pct = coalesce(nullif(it ->> 'discount_pct', '')::numeric, 0),
        taxable      = coalesce((it ->> 'taxable')::boolean, true)
      where id = v_item;
    else
      insert into public.quote_items (quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable)
      values (
        v_id, i,
        nullif(it ->> 'product_id', '')::uuid,
        coalesce(nullif(it ->> 'kind', ''), 'producto')::public.item_kind,
        nullif(trim(it ->> 'sku'), ''),
        trim(it ->> 'description'),
        coalesce(nullif(trim(it ->> 'unit'), ''), 'unidad'),
        (it ->> 'quantity')::numeric,
        (it ->> 'unit_price')::numeric,
        coalesce(nullif(it ->> 'discount_pct', '')::numeric, 0),
        coalesce((it ->> 'taxable')::boolean, true)
      ) returning id into v_item;
    end if;
    keep_items := keep_items || v_item;

    if v_costs then
      if nullif(it ->> 'unit_cost', '') is null then
        delete from public.quote_item_costs where quote_item_id = v_item;
      else
        insert into public.quote_item_costs (quote_item_id, unit_cost)
        values (v_item, (it ->> 'unit_cost')::numeric)
        on conflict (quote_item_id) do update set unit_cost = excluded.unit_cost;
      end if;
    end if;
  end loop;

  delete from public.quote_items where quote_id = v_id and id <> all (keep_items);

  -- Cargos y deducciones
  i := 0;
  for it in select value from jsonb_array_elements(coalesce(p -> 'adjustments', '[]'::jsonb)) loop
    i := i + 1;
    v_adj := nullif(it ->> 'id', '')::uuid;
    if v_adj is not null and exists (select 1 from public.quote_adjustments where id = v_adj and quote_id = v_id) then
      update public.quote_adjustments set
        position = i,
        kind     = (it ->> 'kind')::public.adjustment_kind,
        label    = trim(it ->> 'label'),
        percent  = nullif(it ->> 'percent', '')::numeric,
        amount   = coalesce(nullif(it ->> 'amount', '')::numeric, 0),
        taxable  = coalesce((it ->> 'taxable')::boolean, false)
      where id = v_adj;
    else
      insert into public.quote_adjustments (quote_id, position, kind, label, percent, amount, taxable)
      values (v_id, i, (it ->> 'kind')::public.adjustment_kind, trim(it ->> 'label'),
              nullif(it ->> 'percent', '')::numeric,
              coalesce(nullif(it ->> 'amount', '')::numeric, 0),
              coalesce((it ->> 'taxable')::boolean, false))
      returning id into v_adj;
    end if;
    keep_adj := keep_adj || v_adj;
  end loop;

  delete from public.quote_adjustments where quote_id = v_id and id <> all (keep_adj);

  return v_id;
end;
$$;

revoke execute on function public.save_quote(jsonb) from public, anon;
grant execute on function public.save_quote(jsonb) to authenticated;

-- Duplicar: copiar también el porcentaje
create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_src public.quotes;
  v_new uuid;
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado';
  end if;
  select * into v_src from public.quotes where id = p_quote_id;
  if not found then raise exception 'Cotización no encontrada'; end if;

  insert into public.quotes (number, client_id, contact_id, owner_id, title, tax_rate, currency, terms, notes, internal_notes, is_demo)
  values ('', v_src.client_id, v_src.contact_id, coalesce(auth.uid(), v_src.owner_id), v_src.title,
          v_src.tax_rate, v_src.currency, v_src.terms, v_src.notes,
          concat_ws(E'\n', 'Copia de ' || v_src.number, v_src.internal_notes), false)
  returning id into v_new;

  insert into public.quote_items (quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable)
  select v_new, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable
    from public.quote_items where quote_id = p_quote_id order by position;

  insert into public.quote_item_costs (quote_item_id, unit_cost)
  select ni.id, c.unit_cost
    from public.quote_items oi
    join public.quote_item_costs c on c.quote_item_id = oi.id
    join public.quote_items ni on ni.quote_id = v_new and ni.position = oi.position and ni.description = oi.description
   where oi.quote_id = p_quote_id;

  insert into public.quote_adjustments (quote_id, position, kind, label, percent, amount, taxable)
  select v_new, position, kind, label, percent, amount, taxable
    from public.quote_adjustments where quote_id = p_quote_id;

  return v_new;
end;
$$;

notify pgrst, 'reload schema';

-- >>> 20261015000010_product_images.sql
-- 0010 · Fotos de productos
--  · Espacio "product-images" en Supabase Storage: cualquiera con el enlace puede VER la foto
--    (se necesita para el PDF y las miniaturas), pero solo Admin / Cotizaciones-Operaciones
--    pueden subir, cambiar o borrar. Los nombres de archivo son aleatorios.
--  · quotes.show_images: "Incluir fotos en el PDF" (por defecto sí).
--  · Fotos para los productos Demo.
-- Se puede ejecutar más de una vez sin problema.

alter table public.quotes add column if not exists show_images boolean not null default true;

-- La vista v_quotes usa q.*: se recrea para que incluya la columna nueva.
drop view if exists public.v_quotes;
create view public.v_quotes with (security_invoker = true) as
select
  q.*,
  c.name       as client_name,
  ct.full_name as contact_name,
  pr.full_name as owner_name,
  (q.status in ('enviada', 'negociacion') and q.valid_until < (now() at time zone 'America/El_Salvador')::date) as is_overdue_validity,
  (q.next_action_date is not null and q.next_action_date < (now() at time zone 'America/El_Salvador')::date
     and q.status in ('borrador', 'pendiente_envio', 'enviada', 'negociacion', 'vencida')) as is_followup_late,
  o.id         as order_id,
  o.number     as order_number
from public.quotes q
join public.clients c on c.id = q.client_id
left join public.contacts ct on ct.id = q.contact_id
left join public.profiles pr on pr.id = q.owner_id
left join public.orders o on o.quote_id = q.id;
grant select on public.v_quotes to authenticated;
revoke all on public.v_quotes from anon;

-- Storage (solo existe en Supabase; en un Postgres sin Storage se omite)
do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin Supabase Storage: se omite el espacio de fotos';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "product_images_insert" on storage.objects;
  drop policy if exists "product_images_update" on storage.objects;
  drop policy if exists "product_images_delete" on storage.objects;

  create policy "product_images_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'product-images' and public.can_manage_quotes());
  create policy "product_images_update" on storage.objects for update to authenticated
    using (bucket_id = 'product-images' and public.can_manage_quotes())
    with check (bucket_id = 'product-images' and public.can_manage_quotes());
  create policy "product_images_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'product-images' and public.can_manage_quotes());
end
$do$;

-- Fotos de los productos Demo (archivos incluidos en la app, carpeta /demo).
-- Solo si el producto demo existe y no tiene ya otra foto.
update public.products p
   set image_url = v.url
  from (values
  ('d4000000-0000-4000-8000-000000000001', '/demo/laptop.jpg'),
  ('d4000000-0000-4000-8000-000000000002', '/demo/desktop.jpg'),
  ('d4000000-0000-4000-8000-000000000003', '/demo/monitor.jpg'),
  ('d4000000-0000-4000-8000-000000000004', '/demo/multifuncional.jpg'),
  ('d4000000-0000-4000-8000-000000000005', '/demo/toner.jpg'),
  ('d4000000-0000-4000-8000-000000000006', '/demo/ups.jpg'),
  ('d4000000-0000-4000-8000-000000000007', '/demo/mantenimiento.jpg'),
  ('d4000000-0000-4000-8000-000000000008', '/demo/cableado.jpg')
  ) as v(id, url)
 where p.id = v.id::uuid
   and p.is_demo
   and (p.image_url is null or p.image_url like '/demo/%');

-- Guardar cotización: ahora también "Incluir fotos en el PDF"
create or replace function public.save_quote(p jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_status  public.quote_status;
  it        jsonb;
  v_item    uuid;
  v_adj     uuid;
  i         int := 0;
  keep_items uuid[] := '{}';
  keep_adj   uuid[] := '{}';
  v_costs   boolean := public.can_see_costs();
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado para crear o editar cotizaciones';
  end if;
  if nullif(p ->> 'client_id', '') is null then
    raise exception 'Elegí un cliente';
  end if;

  if v_id is null then
    insert into public.quotes (
      number, client_id, contact_id, owner_id, title, requested_at, issue_date, valid_until,
      currency, tax_rate, terms, notes, internal_notes, next_action, next_action_date, show_images
    ) values (
      '',
      (p ->> 'client_id')::uuid,
      nullif(p ->> 'contact_id', '')::uuid,
      coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()),
      nullif(trim(p ->> 'title'), ''),
      coalesce(nullif(p ->> 'requested_at', '')::timestamptz, now()),
      coalesce(nullif(p ->> 'issue_date', '')::date, (now() at time zone 'America/El_Salvador')::date),
      nullif(p ->> 'valid_until', '')::date,
      coalesce(nullif(p ->> 'currency', ''), 'USD'),
      coalesce(nullif(p ->> 'tax_rate', '')::numeric, (select default_tax_rate from public.company_settings where id = 1)),
      nullif(trim(p ->> 'terms'), ''),
      nullif(trim(p ->> 'notes'), ''),
      nullif(trim(p ->> 'internal_notes'), ''),
      nullif(trim(p ->> 'next_action'), ''),
      nullif(p ->> 'next_action_date', '')::date,
      coalesce(nullif(p ->> 'show_images', '')::boolean, true)
    ) returning id into v_id;
  else
    select status into v_status from public.quotes where id = v_id for update;
    if not found then
      raise exception 'Cotización no encontrada';
    end if;
    if not public.quote_is_editable(v_status) then
      raise exception 'La cotización está en estado "%" y ya no se puede editar', v_status;
    end if;
    update public.quotes set
      client_id        = (p ->> 'client_id')::uuid,
      contact_id       = nullif(p ->> 'contact_id', '')::uuid,
      owner_id         = nullif(p ->> 'owner_id', '')::uuid,
      title            = nullif(trim(p ->> 'title'), ''),
      requested_at     = coalesce(nullif(p ->> 'requested_at', '')::timestamptz, requested_at),
      issue_date       = coalesce(nullif(p ->> 'issue_date', '')::date, issue_date),
      valid_until      = nullif(p ->> 'valid_until', '')::date,
      currency         = coalesce(nullif(p ->> 'currency', ''), currency),
      tax_rate         = coalesce(nullif(p ->> 'tax_rate', '')::numeric, tax_rate),
      terms            = nullif(trim(p ->> 'terms'), ''),
      notes            = nullif(trim(p ->> 'notes'), ''),
      internal_notes   = nullif(trim(p ->> 'internal_notes'), ''),
      next_action      = nullif(trim(p ->> 'next_action'), ''),
      next_action_date = nullif(p ->> 'next_action_date', '')::date,
      show_images      = coalesce(nullif(p ->> 'show_images', '')::boolean, show_images)
    where id = v_id;
  end if;

  -- Líneas
  for it in select value from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    v_item := nullif(it ->> 'id', '')::uuid;
    if v_item is not null and exists (select 1 from public.quote_items where id = v_item and quote_id = v_id) then
      update public.quote_items set
        position     = i,
        product_id   = nullif(it ->> 'product_id', '')::uuid,
        kind         = coalesce(nullif(it ->> 'kind', ''), 'producto')::public.item_kind,
        sku          = nullif(trim(it ->> 'sku'), ''),
        description  = trim(it ->> 'description'),
        unit         = coalesce(nullif(trim(it ->> 'unit'), ''), 'unidad'),
        quantity     = (it ->> 'quantity')::numeric,
        unit_price   = (it ->> 'unit_price')::numeric,
        discount_pct = coalesce(nullif(it ->> 'discount_pct', '')::numeric, 0),
        taxable      = coalesce((it ->> 'taxable')::boolean, true)
      where id = v_item;
    else
      insert into public.quote_items (quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable)
      values (
        v_id, i,
        nullif(it ->> 'product_id', '')::uuid,
        coalesce(nullif(it ->> 'kind', ''), 'producto')::public.item_kind,
        nullif(trim(it ->> 'sku'), ''),
        trim(it ->> 'description'),
        coalesce(nullif(trim(it ->> 'unit'), ''), 'unidad'),
        (it ->> 'quantity')::numeric,
        (it ->> 'unit_price')::numeric,
        coalesce(nullif(it ->> 'discount_pct', '')::numeric, 0),
        coalesce((it ->> 'taxable')::boolean, true)
      ) returning id into v_item;
    end if;
    keep_items := keep_items || v_item;

    if v_costs then
      if nullif(it ->> 'unit_cost', '') is null then
        delete from public.quote_item_costs where quote_item_id = v_item;
      else
        insert into public.quote_item_costs (quote_item_id, unit_cost)
        values (v_item, (it ->> 'unit_cost')::numeric)
        on conflict (quote_item_id) do update set unit_cost = excluded.unit_cost;
      end if;
    end if;
  end loop;

  delete from public.quote_items where quote_id = v_id and id <> all (keep_items);

  -- Cargos y deducciones
  i := 0;
  for it in select value from jsonb_array_elements(coalesce(p -> 'adjustments', '[]'::jsonb)) loop
    i := i + 1;
    v_adj := nullif(it ->> 'id', '')::uuid;
    if v_adj is not null and exists (select 1 from public.quote_adjustments where id = v_adj and quote_id = v_id) then
      update public.quote_adjustments set
        position = i,
        kind     = (it ->> 'kind')::public.adjustment_kind,
        label    = trim(it ->> 'label'),
        percent  = nullif(it ->> 'percent', '')::numeric,
        amount   = coalesce(nullif(it ->> 'amount', '')::numeric, 0),
        taxable  = coalesce((it ->> 'taxable')::boolean, false)
      where id = v_adj;
    else
      insert into public.quote_adjustments (quote_id, position, kind, label, percent, amount, taxable)
      values (v_id, i, (it ->> 'kind')::public.adjustment_kind, trim(it ->> 'label'),
              nullif(it ->> 'percent', '')::numeric,
              coalesce(nullif(it ->> 'amount', '')::numeric, 0),
              coalesce((it ->> 'taxable')::boolean, false))
      returning id into v_adj;
    end if;
    keep_adj := keep_adj || v_adj;
  end loop;

  delete from public.quote_adjustments where quote_id = v_id and id <> all (keep_adj);

  return v_id;
end;
$$;

revoke execute on function public.save_quote(jsonb) from public, anon;
grant execute on function public.save_quote(jsonb) to authenticated;

-- Duplicar: conserva "Incluir fotos en el PDF"
create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_src public.quotes;
  v_new uuid;
begin
  if not public.can_manage_quotes() then
    raise exception 'No autorizado';
  end if;
  select * into v_src from public.quotes where id = p_quote_id;
  if not found then raise exception 'Cotización no encontrada'; end if;

  insert into public.quotes (number, client_id, contact_id, owner_id, title, tax_rate, currency, terms, notes, internal_notes, show_images, is_demo)
  values ('', v_src.client_id, v_src.contact_id, coalesce(auth.uid(), v_src.owner_id), v_src.title,
          v_src.tax_rate, v_src.currency, v_src.terms, v_src.notes,
          concat_ws(E'\n', 'Copia de ' || v_src.number, v_src.internal_notes), v_src.show_images, false)
  returning id into v_new;

  insert into public.quote_items (quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable)
  select v_new, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable
    from public.quote_items where quote_id = p_quote_id order by position;

  insert into public.quote_item_costs (quote_item_id, unit_cost)
  select ni.id, c.unit_cost
    from public.quote_items oi
    join public.quote_item_costs c on c.quote_item_id = oi.id
    join public.quote_items ni on ni.quote_id = v_new and ni.position = oi.position and ni.description = oi.description
   where oi.quote_id = p_quote_id;

  insert into public.quote_adjustments (quote_id, position, kind, label, percent, amount, taxable)
  select v_new, position, kind, label, percent, amount, taxable
    from public.quote_adjustments where quote_id = p_quote_id;

  return v_new;
end;
$$;

notify pgrst, 'reload schema';

