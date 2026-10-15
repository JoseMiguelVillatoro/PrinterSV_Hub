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
