-- 0016 · Etapas del pedido consecutivas, sin retroceso, y OC conectadas al pedido
--  · Orden obligatorio: Compra → Recepción → Preparación → Entrega → Cierre.
--      - Recepción (parcial/recibida) exige Compra = Comprada.
--      - Preparación "En proceso" exige recepción iniciada (parcial o recibida);
--        "Lista" exige Recepción = Recibida. (Si el pedido no requiere compra, no aplica.)
--      - Entrega "Programada" exige preparación iniciada; "Parcial"/"Entregada" exigen Preparación = Lista.
--  · Las etapas solo avanzan. Retroceder es una CORRECCIÓN: solo Administrador, con motivo,
--    y solo si las etapas siguientes no han empezado (se corrigen de atrás hacia adelante).
--  · Orden de compra ligada a un pedido:
--      - Enviada → Compra del pedido pasa a "Solicitada" (si estaba Pendiente).
--      - Recibida parcial → Compra "Comprada" y Recepción "Parcial".
--      - Todas las OC del pedido recibidas → Compra "Comprada" y Recepción "Recibida".
--    Nunca hace retroceder al pedido. Cada cambio automático queda en la trazabilidad.
-- Se puede ejecutar más de una vez sin problema.

create or replace function public.order_stage_rank(p_stage text, p_value text)
returns int language sql immutable set search_path = '' as $$
  select case p_stage
    when 'compra'      then case p_value when 'no_aplica' then 0 when 'pendiente' then 0 when 'solicitada' then 1 when 'comprada' then 2 end
    when 'recepcion'   then case p_value when 'no_aplica' then 0 when 'pendiente' then 0 when 'parcial' then 1 when 'recibida' then 2 end
    when 'preparacion' then case p_value when 'pendiente' then 0 when 'en_proceso' then 1 when 'lista' then 2 end
    when 'entrega'     then case p_value when 'pendiente' then 0 when 'programada' then 1 when 'parcial' then 2 when 'entregada' then 3 end
  end
$$;

create or replace function public.update_order_stage(
  p_order_id uuid,
  p_stage    text,
  p_value    text,
  p_comment  text default null,
  p_date     date default null,
  p_received_by text default null
)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_from text;
  v_old  int;
  v_new  int;
  v_back boolean := false;
  v_recv_ok boolean;  -- la mercadería ya llegó (o no hace falta comprar)
begin
  if not public.can_manage_quotes() then
    raise exception 'Solo Cotizaciones/Operaciones o Administración pueden actualizar pedidos';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if o.status <> 'abierto' and p_stage <> 'estado' then
    raise exception 'El pedido está %; reabrilo para modificar etapas', o.status;
  end if;

  if p_stage in ('compra', 'recepcion', 'preparacion', 'entrega') then
    v_from := case p_stage when 'compra' then o.purchase_status::text when 'recepcion' then o.reception_status::text
                           when 'preparacion' then o.preparation_status::text else o.delivery_status::text end;
    v_old := public.order_stage_rank(p_stage, v_from);
    v_new := public.order_stage_rank(p_stage, p_value);
    if v_new is null then raise exception 'Valor no válido para la etapa: %', p_value; end if;
    if v_new = v_old and p_value = v_from then
      return o;
    end if;
    v_back := v_new < v_old;

    -- Retroceder = corrección: solo Admin, con motivo y sin etapas posteriores iniciadas
    if v_back then
      if not public.has_role('admin') then
        raise exception 'Las etapas solo avanzan. Para corregir un error, pedile a un Administrador que la retroceda.';
      end if;
      if coalesce(trim(p_comment), '') = '' then
        raise exception 'Para retroceder una etapa escribí el motivo de la corrección';
      end if;
      if (p_stage = 'compra' and (o.reception_status in ('parcial', 'recibida') or o.preparation_status <> 'pendiente' or o.delivery_status <> 'pendiente'))
         or (p_stage = 'recepcion' and (o.preparation_status <> 'pendiente' or o.delivery_status <> 'pendiente'))
         or (p_stage = 'preparacion' and o.delivery_status <> 'pendiente') then
        raise exception 'Primero corregí las etapas siguientes (de la última hacia atrás)';
      end if;
    end if;
  end if;

  v_recv_ok := not o.requires_purchase or o.reception_status = 'recibida';

  perform public._begin_trusted();

  case p_stage
  when 'compra' then
    if not o.requires_purchase then raise exception 'Este pedido no requiere compra'; end if;
    update public.orders set purchase_status = p_value::public.purchase_stage,
           purchased_at = case when p_value = 'comprada' then coalesce(purchased_at, now()) else null end
     where id = p_order_id returning * into o;

  when 'recepcion' then
    if not o.requires_purchase then raise exception 'Este pedido no requiere recepción de proveedor'; end if;
    if p_value in ('parcial', 'recibida') and o.purchase_status <> 'comprada' then
      raise exception 'Primero marcá la compra al proveedor como Comprada';
    end if;
    update public.orders set reception_status = p_value::public.reception_stage,
           received_at = case when p_value = 'recibida' then coalesce(received_at, now()) else null end
     where id = p_order_id returning * into o;

  when 'preparacion' then
    if not v_back then
      if p_value = 'en_proceso' and o.requires_purchase and o.reception_status not in ('parcial', 'recibida') then
        raise exception 'Primero tiene que llegar la mercadería: marcá la Recepción (parcial o recibida)';
      end if;
      if p_value = 'lista' and not v_recv_ok then
        raise exception 'Para marcar el pedido como Listo, la Recepción tiene que estar completa (Recibida)';
      end if;
    end if;
    update public.orders set preparation_status = p_value::public.preparation_stage,
           prepared_at = case when p_value = 'lista' then coalesce(prepared_at, now()) else null end
     where id = p_order_id returning * into o;

  when 'entrega' then
    if not v_back then
      if p_value = 'programada' and o.preparation_status = 'pendiente' then
        raise exception 'Primero iniciá la Preparación del pedido';
      end if;
      if p_value in ('parcial', 'entregada') and o.preparation_status <> 'lista' then
        raise exception 'El pedido debe estar Listo (preparación) antes de entregarlo';
      end if;
    end if;
    update public.orders set delivery_status = p_value::public.delivery_stage,
           delivery_scheduled_for = case when p_value = 'programada' then coalesce(p_date, delivery_scheduled_for) else delivery_scheduled_for end,
           delivered_at = case when p_value = 'entregada' then coalesce(delivered_at, now()) else null end,
           received_by  = case when p_value = 'entregada' then coalesce(nullif(trim(p_received_by), ''), received_by) else received_by end
     where id = p_order_id returning * into o;

  when 'estado' then
    v_from := o.status::text;
    if p_value = 'cerrado' and o.delivery_status <> 'entregada' then
      raise exception 'Solo se puede cerrar un pedido entregado';
    end if;
    update public.orders set status = p_value::public.order_status,
           closed_at = case when p_value in ('cerrado', 'cancelado') then now() else null end
     where id = p_order_id returning * into o;

  else
    raise exception 'Etapa desconocida: %', p_stage;
  end case;

  insert into public.order_events (order_id, stage, from_value, to_value, comment)
  values (p_order_id, p_stage, v_from, p_value,
          nullif(trim(case when v_back then concat('Corrección: ', p_comment) else p_comment end), ''));

  perform public._end_trusted();
  return o;
end;
$$;

-- ---------------------------------------------------------------------
-- OC → pedido (solo avanza; nunca hace retroceder al pedido)
-- ---------------------------------------------------------------------
create or replace function public.sync_order_from_purchase_orders(p_order_id uuid, p_po_number text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  n_open int; n_recv int; n_part int;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or o.status <> 'abierto' or not o.requires_purchase then return; end if;

  select count(*) filter (where status <> 'cancelada'),
         count(*) filter (where status = 'recibida'),
         count(*) filter (where status = 'recibida_parcial')
    into n_open, n_recv, n_part
    from public.purchase_orders where order_id = p_order_id;
  if n_open = 0 then return; end if;

  -- Compra: alguna OC enviada → Solicitada; algo recibido → Comprada
  if (n_recv > 0 or n_part > 0) and o.purchase_status <> 'comprada' then
    perform public.update_order_stage(p_order_id, 'compra', 'comprada', format('Automático: mercadería recibida (%s)', p_po_number));
  elsif o.purchase_status = 'pendiente' and exists (
          select 1 from public.purchase_orders where order_id = p_order_id and status in ('enviada', 'recibida_parcial', 'recibida')) then
    perform public.update_order_stage(p_order_id, 'compra', 'solicitada', format('Automático: %s enviada al proveedor', p_po_number));
  end if;

  select * into o from public.orders where id = p_order_id;
  -- Recepción: todas las OC (no canceladas) recibidas → Recibida; alguna parcial → Parcial
  if n_recv = n_open and o.reception_status <> 'recibida' then
    perform public.update_order_stage(p_order_id, 'recepcion', 'recibida', format('Automático: %s recibida completa', p_po_number));
  elsif (n_recv > 0 or n_part > 0) and o.reception_status = 'pendiente' then
    perform public.update_order_stage(p_order_id, 'recepcion', 'parcial', format('Automático: %s recibida parcialmente', p_po_number));
  end if;
end;
$$;
revoke execute on function public.sync_order_from_purchase_orders(uuid, text) from public, anon, authenticated;

create or replace function public.tg_po_sync_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_id is not null and new.status is distinct from old.status
     and new.status in ('enviada', 'recibida_parcial', 'recibida')
     and public.can_manage_quotes() then
    perform public.sync_order_from_purchase_orders(new.order_id, new.number);
  end if;
  return null;
end;
$$;

drop trigger if exists purchase_orders_sync_order on public.purchase_orders;
create trigger purchase_orders_sync_order after update of status on public.purchase_orders
  for each row execute function public.tg_po_sync_order();

notify pgrst, 'reload schema';
