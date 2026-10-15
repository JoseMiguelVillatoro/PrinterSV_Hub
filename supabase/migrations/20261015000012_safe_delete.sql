-- 0012 · Eliminar registros sin perder historial
--  · delete_check(kind, id): dice si se puede eliminar y qué se borra con él (para mostrarlo antes).
--  · delete_record(kind, id): elimina solo si es seguro. Solo Administrador.
--    - cliente:     solo si no tiene cotizaciones ni pedidos (se van sus contactos, visitas y tareas).
--    - producto:    solo si nunca se usó en una cotización ni en un pedido.
--    - proveedor:   solo si no tiene órdenes de compra.
--    - cotización:  solo en Borrador (las demás se cancelan, no se borran).
--  Lo que tiene historial se archiva: cliente Inactivo, producto/proveedor desactivado,
--  cotización o pedido Cancelado. La auditoría registra cada eliminación.
-- Se puede ejecutar más de una vez sin problema.

create or replace function public.delete_check(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  n_quotes int; n_orders int; n_lines int; n_po int; n_contacts int; n_visits int; n_tasks int;
  v_status public.quote_status;
begin
  if not public.has_role('admin') then
    return jsonb_build_object('ok', false, 'reason', 'Solo un administrador puede eliminar registros.');
  end if;

  case p_kind
  when 'client' then
    if not exists (select 1 from public.clients where id = p_id) then
      return jsonb_build_object('ok', false, 'reason', 'El cliente no existe.');
    end if;
    select count(*) into n_quotes from public.quotes where client_id = p_id;
    select count(*) into n_orders from public.orders where client_id = p_id;
    if n_quotes + n_orders > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('Tiene %s cotización(es) y %s pedido(s). Para no perder ese historial no se puede eliminar: marcalo como Inactivo y queda archivado.', n_quotes, n_orders));
    end if;
    select count(*) into n_contacts from public.contacts where client_id = p_id;
    select count(*) into n_visits   from public.visits   where client_id = p_id;
    select count(*) into n_tasks    from public.tasks    where client_id = p_id;
    return jsonb_build_object('ok', true, 'detail',
      format('También se eliminan %s contacto(s), %s visita(s) y %s tarea(s) de este cliente.', n_contacts, n_visits, n_tasks));

  when 'product' then
    if not exists (select 1 from public.products where id = p_id) then
      return jsonb_build_object('ok', false, 'reason', 'El producto no existe.');
    end if;
    select count(distinct quote_id) into n_lines from public.quote_items where product_id = p_id;
    select count(distinct order_id) into n_orders from public.order_items where product_id = p_id;
    if n_lines + n_orders > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('Se usó en %s cotización(es) y %s pedido(s). Para no perder ese historial no se puede eliminar: desactivalo (deja de salir para cotizar).', n_lines, n_orders));
    end if;
    return jsonb_build_object('ok', true, 'detail', 'También se elimina su costo y su historial de precios.');

  when 'supplier' then
    if not exists (select 1 from public.suppliers where id = p_id) then
      return jsonb_build_object('ok', false, 'reason', 'El proveedor no existe.');
    end if;
    select count(*) into n_po from public.purchase_orders where supplier_id = p_id;
    if n_po > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('Tiene %s orden(es) de compra. Para no perder ese historial no se puede eliminar: desactivalo.', n_po));
    end if;
    return jsonb_build_object('ok', true, 'detail', 'Los productos que lo tenían como proveedor habitual quedan sin proveedor.');

  when 'quote' then
    select status into v_status from public.quotes where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'La cotización no existe.');
    end if;
    if v_status <> 'borrador' then
      return jsonb_build_object('ok', false, 'reason',
        'Solo se eliminan cotizaciones en Borrador. Las que ya se enviaron se cancelan (Cambiar estado → Cancelada) para conservar el historial.');
    end if;
    return jsonb_build_object('ok', true, 'detail', 'Se eliminan sus líneas, cargos e historial. Su número no se vuelve a usar.');

  else
    return jsonb_build_object('ok', false, 'reason', 'Tipo de registro desconocido.');
  end case;
end;
$$;

create or replace function public.delete_record(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_check jsonb := public.delete_check(p_kind, p_id);
begin
  if not coalesce((v_check ->> 'ok')::boolean, false) then
    raise exception '%', v_check ->> 'reason';
  end if;
  case p_kind
    when 'client'   then delete from public.clients   where id = p_id;
    when 'product'  then delete from public.products  where id = p_id;
    when 'supplier' then delete from public.suppliers where id = p_id;
    when 'quote'    then delete from public.quotes    where id = p_id and status = 'borrador';
  end case;
end;
$$;

revoke execute on function public.delete_check(text, uuid)  from public, anon;
revoke execute on function public.delete_record(text, uuid) from public, anon;
grant  execute on function public.delete_check(text, uuid)  to authenticated;
grant  execute on function public.delete_record(text, uuid) to authenticated;

notify pgrst, 'reload schema';
