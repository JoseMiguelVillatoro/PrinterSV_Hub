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
