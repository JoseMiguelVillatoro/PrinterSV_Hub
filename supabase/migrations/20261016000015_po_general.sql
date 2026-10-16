-- 0015 · Órdenes de compra generales (sin pedido) y enlace de línea → producto
--  · purchase_order_items.product_id: a qué producto del catálogo corresponde la línea
--    (opcional; las líneas libres quedan sin producto). Lo usará el inventario al recibir.
--  · Se completa para las OC que ya existen a partir del pedido.
-- Se puede ejecutar más de una vez sin problema.

alter table public.purchase_order_items
  add column if not exists product_id uuid references public.products (id) on delete set null;
create index if not exists purchase_order_items_product_idx on public.purchase_order_items (product_id);

update public.purchase_order_items poi
   set product_id = oi.product_id
  from public.order_items oi
 where poi.order_item_id = oi.id
   and poi.product_id is null
   and oi.product_id is not null;

notify pgrst, 'reload schema';
