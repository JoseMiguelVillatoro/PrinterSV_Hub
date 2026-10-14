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
