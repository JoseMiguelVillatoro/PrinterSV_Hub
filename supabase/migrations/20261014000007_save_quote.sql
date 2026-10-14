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
