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
