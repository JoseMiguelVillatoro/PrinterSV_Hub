-- 0014 · Órdenes de compra como documento para el proveedor
--  · OC: IVA (%), condiciones de pago, dirección de entrega, fecha de envío y totales con IVA.
--  · Proveedor: NIT y dirección (salen en el PDF de la OC).
--  · receive_purchase_order(): registra lo recibido por línea y pone el estado solo
--    (Recibida parcial / Recibida). No mueve las etapas del pedido: esas se siguen
--    marcando aparte para que quede quién y cuándo.
-- Se puede ejecutar más de una vez sin problema.

alter table public.suppliers add column if not exists tax_id  text;
alter table public.suppliers add column if not exists address text;

alter table public.purchase_orders add column if not exists tax_rate numeric(5,2) not null default 13
  check (tax_rate >= 0 and tax_rate <= 100);
alter table public.purchase_orders add column if not exists payment_terms    text;
alter table public.purchase_orders add column if not exists delivery_address text;
alter table public.purchase_orders add column if not exists sent_at          timestamptz;
alter table public.purchase_orders add column if not exists tax_total numeric(14,2)
  generated always as (round(total_cost * tax_rate / 100, 2)) stored;
alter table public.purchase_orders add column if not exists grand_total numeric(14,2)
  generated always as (total_cost + round(total_cost * tax_rate / 100, 2)) stored;

-- Recepción por línea (solo quien ve costos: Admin y Cotizaciones/Operaciones)
create or replace function public.receive_purchase_order(p_po_id uuid, p_lines jsonb, p_date date default null)
returns public.purchase_orders
language plpgsql security definer set search_path = ''
as $$
declare
  v_po   public.purchase_orders;
  it     jsonb;
  v_qty  numeric;
  v_all  boolean;
  v_any  boolean;
begin
  if not public.can_see_costs() then
    raise exception 'No autorizado';
  end if;
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Orden de compra no encontrada'; end if;
  if v_po.status in ('cancelada', 'borrador') then
    raise exception 'Primero enviá la orden de compra (está en "%")', v_po.status;
  end if;

  for it in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := (it ->> 'quantity_received')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'Cantidad recibida inválida'; end if;
    update public.purchase_order_items
       set quantity_received = least(v_qty, quantity)
     where id = (it ->> 'id')::uuid and purchase_order_id = p_po_id;
  end loop;

  select bool_and(quantity_received >= quantity), bool_or(quantity_received > 0)
    into v_all, v_any
    from public.purchase_order_items where purchase_order_id = p_po_id;

  update public.purchase_orders
     set status = case when v_all then 'recibida' when v_any then 'recibida_parcial' else 'enviada' end::public.po_status,
         received_at = case when v_all then coalesce(p_date, (now() at time zone 'America/El_Salvador')::date) else null end
   where id = p_po_id
  returning * into v_po;
  return v_po;
end;
$$;
revoke execute on function public.receive_purchase_order(uuid, jsonb, date) from public, anon;
grant  execute on function public.receive_purchase_order(uuid, jsonb, date) to authenticated;

-- Datos Demo: proveedores con NIT/dirección y la OC con condiciones
update public.suppliers set tax_id = coalesce(tax_id, '0614-010101-101-0'), address = coalesce(address, 'Bulevar Ficticio 100, San Salvador')
 where id = 'd3000000-0000-4000-8000-000000000001' and is_demo;
update public.suppliers set tax_id = coalesce(tax_id, '0614-020202-102-0'), address = coalesce(address, 'Calle Ejemplo 55, Antiguo Cuscatlán')
 where id = 'd3000000-0000-4000-8000-000000000002' and is_demo;
update public.purchase_orders set payment_terms = coalesce(payment_terms, 'Crédito 30 días')
 where is_demo;

notify pgrst, 'reload schema';
