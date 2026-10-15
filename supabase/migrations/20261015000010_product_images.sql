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
