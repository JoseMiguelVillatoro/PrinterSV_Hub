-- =====================================================================
-- Printer Business Hub — 0006: datos de demostración (carga ÚNICA)
--
--  * Guardado por seed_runs('demo') + advisory lock → idempotente.
--  * IDs fijos + ON CONFLICT DO NOTHING → aunque se ejecute de nuevo, no duplica.
--  * Todo marcado is_demo = true. Nunca se borra automáticamente.
--  * Datos ficticios: dominios ejemplo.com / ejemplo.sv y teléfonos 2200-00xx.
--  * La app NUNCA llama esta función: solo esta migración (que corre una vez).
-- =====================================================================

create or replace function public.apply_demo_seed()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  d date := (now() at time zone 'America/El_Salvador')::date;
  -- clientes
  c1 uuid := 'd1000000-0000-4000-8000-000000000001';
  c2 uuid := 'd1000000-0000-4000-8000-000000000002';
  c3 uuid := 'd1000000-0000-4000-8000-000000000003';
  c4 uuid := 'd1000000-0000-4000-8000-000000000004';
  c5 uuid := 'd1000000-0000-4000-8000-000000000005';
  -- contactos
  k1 uuid := 'd2000000-0000-4000-8000-000000000001';
  k2 uuid := 'd2000000-0000-4000-8000-000000000002';
  k3 uuid := 'd2000000-0000-4000-8000-000000000003';
  k4 uuid := 'd2000000-0000-4000-8000-000000000004';
  k5 uuid := 'd2000000-0000-4000-8000-000000000005';
  -- proveedores
  s1 uuid := 'd3000000-0000-4000-8000-000000000001';
  s2 uuid := 'd3000000-0000-4000-8000-000000000002';
  -- productos / servicios
  p1 uuid := 'd4000000-0000-4000-8000-000000000001';
  p2 uuid := 'd4000000-0000-4000-8000-000000000002';
  p3 uuid := 'd4000000-0000-4000-8000-000000000003';
  p4 uuid := 'd4000000-0000-4000-8000-000000000004';
  p5 uuid := 'd4000000-0000-4000-8000-000000000005';
  p6 uuid := 'd4000000-0000-4000-8000-000000000006';
  p7 uuid := 'd4000000-0000-4000-8000-000000000007';
  p8 uuid := 'd4000000-0000-4000-8000-000000000008';
  -- cotizaciones
  q1 uuid := 'd5000000-0000-4000-8000-000000000001';
  q2 uuid := 'd5000000-0000-4000-8000-000000000002';
  q3 uuid := 'd5000000-0000-4000-8000-000000000003';
  q4 uuid := 'd5000000-0000-4000-8000-000000000004';
  q5 uuid := 'd5000000-0000-4000-8000-000000000005';
  q6 uuid := 'd5000000-0000-4000-8000-000000000006';
  -- pedidos
  o1 uuid := 'd6000000-0000-4000-8000-000000000001';
  o2 uuid := 'd6000000-0000-4000-8000-000000000002';
  po1 uuid := 'd7000000-0000-4000-8000-000000000001';
begin
  perform pg_advisory_xact_lock(hashtext('printer_hub_demo_seed'));
  if exists (select 1 from public.seed_runs where seed_key = 'demo') then
    return 'skipped: demo seed already applied';
  end if;

  perform public._begin_trusted();

  -- ---------------- Clientes ----------------
  insert into public.clients (id, name, legal_name, industry, status, source, address, city, department, phone, email, needs, is_demo, created_at) values
    (c1, 'Comercial Altavista (Demo)', 'Comercial Altavista, S.A. de C.V.', 'Comercio', 'activo', 'Referido',
         'Calle Ficticia 101', 'San Salvador', 'San Salvador', '2200-0001', 'compras@altavista.ejemplo.sv',
         'Renovación de equipos de cómputo del área administrativa.', true, now() - interval '60 days'),
    (c2, 'Colegio Las Brisas (Demo)', 'Asociación Educativa Las Brisas', 'Educación', 'activo', 'Visita en frío',
         'Av. de Prueba 22', 'Santa Tecla', 'La Libertad', '2200-0002', 'administracion@lasbrisas.ejemplo.sv',
         'Laboratorio de computación y mantenimiento de impresoras.', true, now() - interval '45 days'),
    (c3, 'Clínica Santa Elena (Demo)', 'Servicios Médicos Santa Elena, S.A. de C.V.', 'Salud', 'prospecto', 'Sitio web',
         'Boulevard Demo 3', 'Antiguo Cuscatlán', 'La Libertad', '2200-0003', 'it@santaelena.ejemplo.sv',
         'Cableado estructurado y respaldo eléctrico para recepción.', true, now() - interval '20 days'),
    (c4, 'Ferretería El Progreso (Demo)', 'Ferretería El Progreso', 'Ferretería', 'activo', 'Cliente recurrente',
         'Km 0 Carretera de Ejemplo', 'San Miguel', 'San Miguel', '2200-0004', 'gerencia@elprogreso.ejemplo.sv',
         'Punto de venta e impresión de facturas.', true, now() - interval '90 days'),
    (c5, 'Logística Cuscatlán (Demo)', 'Logística Cuscatlán, S.A. de C.V.', 'Logística', 'prospecto', 'Feria comercial',
         'Zona Franca Ficticia, Bodega 5', 'Soyapango', 'San Salvador', '2200-0005', 'operaciones@logcuscatlan.ejemplo.sv',
         'Monitores y UPS para centro de despacho.', true, now() - interval '7 days')
  on conflict (id) do nothing;

  insert into public.contacts (id, client_id, full_name, position, email, phone, is_primary, is_demo) values
    (k1, c1, 'Ana Demo Martínez',   'Jefa de Compras',        'ana.demo@altavista.ejemplo.sv',      '7000-0001', true, true),
    (k2, c2, 'Luis Demo Hernández', 'Administrador',          'luis.demo@lasbrisas.ejemplo.sv',     '7000-0002', true, true),
    (k3, c3, 'Carla Demo Rivas',    'Coordinadora de TI',     'carla.demo@santaelena.ejemplo.sv',   '7000-0003', true, true),
    (k4, c4, 'Mario Demo López',    'Gerente General',        'mario.demo@elprogreso.ejemplo.sv',   '7000-0004', true, true),
    (k5, c5, 'Sofía Demo Castro',   'Gerente de Operaciones', 'sofia.demo@logcuscatlan.ejemplo.sv', '7000-0005', true, true)
  on conflict (id) do nothing;

  -- ---------------- Proveedores ----------------
  insert into public.suppliers (id, name, contact_name, email, phone, notes, is_demo) values
    (s1, 'Mayorista Tecnológico Demo', 'Equipo de ventas', 'ventas@mayorista.ejemplo.com', '2200-0090', 'Proveedor ficticio de equipos.', true),
    (s2, 'Suministros de Oficina Demo', 'Atención a clientes', 'pedidos@suministros.ejemplo.com', '2200-0091', 'Proveedor ficticio de consumibles.', true)
  on conflict (id) do nothing;

  -- ---------------- Catálogo ----------------
  insert into public.products (id, sku, name, description, kind, category, brand, unit, sale_price, taxable, is_demo) values
    (p1, 'DEMO-LAP-001', 'Laptop empresarial 14"',        'Core i5, 16 GB RAM, SSD 512 GB, Windows 11 Pro', 'producto', 'Computadoras', 'MarcaDemo', 'unidad', 789.00, true, true),
    (p2, 'DEMO-DSK-001', 'Desktop de oficina',            'Core i3, 8 GB RAM, SSD 256 GB',                  'producto', 'Computadoras', 'MarcaDemo', 'unidad', 545.00, true, true),
    (p3, 'DEMO-MON-024', 'Monitor 24" Full HD',           'Panel IPS, HDMI/DisplayPort',                    'producto', 'Monitores',    'MarcaDemo', 'unidad', 139.00, true, true),
    (p4, 'DEMO-IMP-MF1', 'Multifuncional láser',          'Imprime, copia y escanea, dúplex, red',          'producto', 'Impresoras',   'MarcaDemo', 'unidad', 329.00, true, true),
    (p5, 'DEMO-TON-001', 'Tóner para multifuncional',     'Rendimiento estándar',                           'producto', 'Consumibles',  'MarcaDemo', 'unidad',  78.50, true, true),
    (p6, 'DEMO-UPS-1K',  'UPS 1000 VA',                   'Respaldo para estación de trabajo',              'producto', 'Energía',      'MarcaDemo', 'unidad', 119.00, true, true),
    (p7, 'DEMO-SRV-MP',  'Mantenimiento preventivo',      'Limpieza y diagnóstico por equipo',              'servicio', 'Servicios',    null,        'equipo',  25.00, true, true),
    (p8, 'DEMO-SRV-CAB', 'Punto de cableado estructurado','Cat 6 certificado, incluye faceplate y patch cord','servicio','Servicios',   null,        'punto',   45.00, true, true)
  on conflict (id) do nothing;

  insert into public.product_costs (product_id, unit_cost, supplier_id) values
    (p1, 640.00, s1), (p2, 430.00, s1), (p3, 102.00, s1), (p4, 255.00, s1),
    (p5, 52.00, s2),  (p6, 86.00, s1),  (p7, 8.00, null), (p8, 22.00, null)
  on conflict (product_id) do nothing;

  -- ---------------- Visitas ----------------
  insert into public.visits (id, client_id, contact_id, title, objective, scheduled_at, location, status, comments, agreements, next_action, next_action_date, is_demo) values
    ('d8000000-0000-4000-8000-000000000001', c2, k2, 'Diagnóstico del laboratorio',
       'Levantar inventario de equipos e impresoras.', (d - 12)::timestamp + time '09:30', 'Instalaciones del cliente', 'realizada',
       'Laboratorio con 20 equipos; 3 impresoras con fallas.', 'Enviar cotización de mantenimiento y tóner.', 'Enviar cotización', d - 10, true),
    ('d8000000-0000-4000-8000-000000000002', c3, k3, 'Revisión de cableado en recepción',
       'Definir puntos de red y respaldo eléctrico.', (d - 5)::timestamp + time '14:00', 'Clínica', 'realizada',
       'Se requieren 12 puntos de red y 4 UPS.', 'Cotizar cableado + UPS con instalación.', 'Negociar descuento', d + 2, true),
    ('d8000000-0000-4000-8000-000000000003', c5, k5, 'Presentación de soluciones',
       'Presentar portafolio de monitores y respaldo.', (d + 3)::timestamp + time '10:00', 'Oficinas del cliente', 'programada',
       null, null, null, null, true)
  on conflict (id) do nothing;

  -- ---------------- Cotizaciones ----------------
  insert into public.quotes (id, number, client_id, contact_id, title, status, requested_at, issue_date, valid_until, tax_rate,
                             terms, notes, sent_at, accepted_at, rejected_at, closed_at, rejection_reason, next_action, next_action_date, is_demo) values
    (q1, '', c1, k1, 'Renovación de laptops – área administrativa', 'borrador',
         now() - interval '2 days', d - 1, d + 14, 13, 'Precios en USD. Entrega 5 días hábiles después de la orden de compra.', null,
         null, null, null, null, null, 'Confirmar cantidades con compras', d + 1, true),
    (q2, '', c2, k2, 'Mantenimiento y consumibles – laboratorio', 'enviada',
         (d - 11)::timestamp + time '08:00', d - 10, d + 5, 13, 'Precios en USD. Forma de pago: crédito 30 días.', null,
         (d - 10)::timestamp + time '16:00', null, null, null, null, 'Llamar para confirmar recepción', d - 2, true),
    (q3, '', c3, k3, 'Cableado estructurado y UPS – recepción', 'negociacion',
         (d - 5)::timestamp + time '15:00', d - 4, d + 11, 13, 'Incluye instalación y certificación de puntos.', 'Instalación en horario no hábil.',
         (d - 3)::timestamp + time '10:00', null, null, null, null, 'Responder solicitud de descuento', d + 2, true),
    (q4, '', c4, k4, 'Equipos punto de venta', 'aceptada',
         (d - 25)::timestamp + time '09:00', d - 24, d - 9, 13, 'Precios en USD. Garantía según fabricante.', null,
         (d - 23)::timestamp + time '11:00', (d - 18)::timestamp + time '15:30', null, (d - 18)::timestamp + time '15:30', null, null, null, true),
    (q5, '', c1, k1, 'Multifuncionales para sucursales', 'aceptada',
         (d - 9)::timestamp + time '10:00', d - 8, d + 7, 13, 'Precios en USD.', null,
         (d - 8)::timestamp + time '17:00', (d - 3)::timestamp + time '12:00', null, (d - 3)::timestamp + time '12:00', null, null, null, true),
    (q6, '', c5, k5, 'Monitores para centro de despacho', 'rechazada',
         (d - 15)::timestamp + time '13:00', d - 14, d + 1, 13, 'Precios en USD.', null,
         (d - 14)::timestamp + time '18:00', null, (d - 6)::timestamp + time '09:00', (d - 6)::timestamp + time '09:00',
         'El cliente pospuso la compra para el próximo trimestre.', null, null, true)
  on conflict (id) do nothing;

  insert into public.quote_items (id, quote_id, position, product_id, kind, sku, description, unit, quantity, unit_price, discount_pct, taxable) values
    -- Q1: 5 laptops con 5 % de descuento
    ('d9000000-0000-4000-8000-000000000101', q1, 1, p1, 'producto', 'DEMO-LAP-001', 'Laptop empresarial 14" – Core i5, 16 GB, SSD 512 GB', 'unidad', 5, 789.00, 5, true),
    ('d9000000-0000-4000-8000-000000000102', q1, 2, null, 'servicio', null, 'Configuración inicial y migración de datos (línea personalizada)', 'equipo', 5, 20.00, 0, true),
    -- Q2: mantenimiento + tóner
    ('d9000000-0000-4000-8000-000000000201', q2, 1, p7, 'servicio', 'DEMO-SRV-MP', 'Mantenimiento preventivo', 'equipo', 20, 25.00, 10, true),
    ('d9000000-0000-4000-8000-000000000202', q2, 2, p5, 'producto', 'DEMO-TON-001', 'Tóner para multifuncional', 'unidad', 6, 78.50, 0, true),
    -- Q3: cableado + UPS
    ('d9000000-0000-4000-8000-000000000301', q3, 1, p8, 'servicio', 'DEMO-SRV-CAB', 'Punto de cableado estructurado Cat 6', 'punto', 12, 45.00, 0, true),
    ('d9000000-0000-4000-8000-000000000302', q3, 2, p6, 'producto', 'DEMO-UPS-1K', 'UPS 1000 VA', 'unidad', 4, 119.00, 0, true),
    -- Q4: punto de venta
    ('d9000000-0000-4000-8000-000000000401', q4, 1, p2, 'producto', 'DEMO-DSK-001', 'Desktop de oficina', 'unidad', 2, 545.00, 0, true),
    ('d9000000-0000-4000-8000-000000000402', q4, 2, p3, 'producto', 'DEMO-MON-024', 'Monitor 24" Full HD', 'unidad', 2, 139.00, 0, true),
    ('d9000000-0000-4000-8000-000000000403', q4, 3, p6, 'producto', 'DEMO-UPS-1K', 'UPS 1000 VA', 'unidad', 2, 119.00, 0, true),
    -- Q5: multifuncionales
    ('d9000000-0000-4000-8000-000000000501', q5, 1, p4, 'producto', 'DEMO-IMP-MF1', 'Multifuncional láser', 'unidad', 3, 329.00, 3, true),
    ('d9000000-0000-4000-8000-000000000502', q5, 2, p5, 'producto', 'DEMO-TON-001', 'Tóner para multifuncional', 'unidad', 3, 78.50, 0, true),
    -- Q6: monitores
    ('d9000000-0000-4000-8000-000000000601', q6, 1, p3, 'producto', 'DEMO-MON-024', 'Monitor 24" Full HD', 'unidad', 10, 139.00, 8, true)
  on conflict (id) do nothing;

  -- Costos por línea (para márgenes) tomados del costo de catálogo
  insert into public.quote_item_costs (quote_item_id, unit_cost)
  select qi.id, pc.unit_cost
    from public.quote_items qi join public.product_costs pc on pc.product_id = qi.product_id
   where qi.quote_id in (q1, q2, q3, q4, q5, q6)
  on conflict (quote_item_id) do nothing;
  insert into public.quote_item_costs (quote_item_id, unit_cost)
  values ('d9000000-0000-4000-8000-000000000102', 6.00)
  on conflict (quote_item_id) do nothing;

  -- Cargo de instalación (gravado) y deducción por pronto pago (no gravada) en Q3
  insert into public.quote_adjustments (id, quote_id, position, kind, label, amount, taxable) values
    ('da000000-0000-4000-8000-000000000301', q3, 1, 'cargo', 'Instalación fuera de horario', 60.00, true),
    ('da000000-0000-4000-8000-000000000302', q3, 2, 'deduccion', 'Descuento comercial negociado', 40.00, false)
  on conflict (id) do nothing;

  -- Historial de estados para que la línea de tiempo tenga sentido
  insert into public.quote_events (quote_id, event_type, from_status, to_status, comment, created_at)
  select x.qid, 'estado', x.f::public.quote_status, x.t::public.quote_status, x.cmt, x.at
    from (values
      (q2, 'borrador', 'enviada',     'Enviada por correo (demo)',                (d - 10)::timestamp + time '16:00'),
      (q3, 'borrador', 'enviada',     null,                                       (d - 3)::timestamp + time '10:00'),
      (q3, 'enviada',  'negociacion', 'El cliente solicita mejorar precio',       (d - 1)::timestamp + time '11:00'),
      (q4, 'borrador', 'enviada',     null,                                       (d - 23)::timestamp + time '11:00'),
      (q4, 'enviada',  'aceptada',    'Orden de compra del cliente recibida',     (d - 18)::timestamp + time '15:30'),
      (q5, 'borrador', 'enviada',     null,                                       (d - 8)::timestamp + time '17:00'),
      (q5, 'enviada',  'aceptada',    'Aprobada por gerencia del cliente',        (d - 3)::timestamp + time '12:00'),
      (q6, 'borrador', 'enviada',     null,                                       (d - 14)::timestamp + time '18:00'),
      (q6, 'enviada',  'rechazada',   'El cliente pospuso la compra',             (d - 6)::timestamp + time '09:00')
    ) as x(qid, f, t, cmt, at)
   where not exists (select 1 from public.quote_events e where e.quote_id = x.qid and e.event_type = 'estado');

  -- ---------------- Tareas ----------------
  insert into public.tasks (id, title, description, due_date, status, priority, client_id, quote_id, visit_id, is_demo) values
    ('db000000-0000-4000-8000-000000000001', 'Llamar al Colegio Las Brisas', 'Confirmar que recibieron la cotización de mantenimiento.', d - 2, 'pendiente', 'alta', c2, q2, 'd8000000-0000-4000-8000-000000000001', true),
    ('db000000-0000-4000-8000-000000000002', 'Responder solicitud de descuento', 'Revisar margen antes de ofrecer descuento adicional.', d + 2, 'pendiente', 'media', c3, q3, 'd8000000-0000-4000-8000-000000000002', true),
    ('db000000-0000-4000-8000-000000000003', 'Preparar demo de monitores', 'Llevar muestra a la presentación.', d + 3, 'pendiente', 'baja', c5, null, 'd8000000-0000-4000-8000-000000000003', true)
  on conflict (id) do nothing;

  -- ---------------- Pedidos ----------------
  -- Pedido 1 (de Q4): comprado y recibido, en preparación, entrega pendiente
  insert into public.orders (id, number, quote_id, client_id, requires_purchase,
                             purchase_status, reception_status, preparation_status, delivery_status,
                             purchased_at, received_at, expected_delivery_date, notes, subtotal, tax_total, total, is_demo, created_at)
  select o1, '', q.id, q.client_id, true,
         'comprada', 'recibida', 'en_proceso', 'pendiente',
         (d - 16)::timestamp + time '10:00', (d - 6)::timestamp + time '14:00', d + 2,
         'Instalar en caja principal.', q.total - q.tax_total, q.tax_total, q.total, true, (d - 18)::timestamp + time '16:00'
    from public.quotes q where q.id = q4
  on conflict (id) do nothing;

  -- Pedido 2 (de Q5): recién creado, compra pendiente
  insert into public.orders (id, number, quote_id, client_id, requires_purchase,
                             expected_delivery_date, subtotal, tax_total, total, is_demo, created_at)
  select o2, '', q.id, q.client_id, true, d + 10, q.total - q.tax_total, q.tax_total, q.total, true, (d - 3)::timestamp + time '13:00'
    from public.quotes q where q.id = q5
  on conflict (id) do nothing;

  insert into public.order_items (order_id, quote_item_id, position, product_id, kind, sku, description, unit, quantity, unit_price, line_total, quantity_received)
  select o.id, qi.id, qi.position, qi.product_id, qi.kind, qi.sku, qi.description, qi.unit, qi.quantity,
         round(qi.line_total / qi.quantity, 2), qi.line_total,
         case when o.id = o1 then qi.quantity else 0 end
    from public.orders o
    join public.quote_items qi on qi.quote_id = o.quote_id
   where o.id in (o1, o2)
     and not exists (select 1 from public.order_items oi where oi.order_id = o.id);

  insert into public.order_events (order_id, stage, from_value, to_value, comment, created_at)
  select x.oid, x.stage, x.f, x.t, x.cmt, x.at
    from (values
      (o1, 'creado',      null,         'abierto',    'Creado desde cotización aceptada', (d - 18)::timestamp + time '16:00'),
      (o1, 'compra',      'pendiente',  'comprada',   'OC enviada al proveedor',          (d - 16)::timestamp + time '10:00'),
      (o1, 'recepcion',   'pendiente',  'recibida',   'Mercadería completa',              (d - 6)::timestamp + time '14:00'),
      (o1, 'preparacion', 'pendiente',  'en_proceso', 'Instalando software',              (d - 5)::timestamp + time '09:00'),
      (o2, 'creado',      null,         'abierto',    'Creado desde cotización aceptada', (d - 3)::timestamp + time '13:00')
    ) as x(oid, stage, f, t, cmt, at)
   where not exists (select 1 from public.order_events e where e.order_id = x.oid);

  insert into public.purchase_orders (id, number, order_id, supplier_id, status, ordered_at, expected_at, received_at, notes, is_demo)
  values (po1, '', o1, s1, 'recibida', d - 16, d - 8, d - 6, 'OC ficticia de demostración.', true)
  on conflict (id) do nothing;

  insert into public.purchase_order_items (purchase_order_id, order_item_id, description, quantity, unit_cost, quantity_received)
  select po1, oi.id, oi.description, oi.quantity, pc.unit_cost, oi.quantity
    from public.order_items oi
    join public.product_costs pc on pc.product_id = oi.product_id
   where oi.order_id = o1
     and not exists (select 1 from public.purchase_order_items x where x.purchase_order_id = po1);

  insert into public.seed_runs (seed_key, version) values ('demo', 1);
  perform public._end_trusted();
  return 'applied: demo seed v1';
end;
$$;

revoke execute on function public.apply_demo_seed() from public, anon, authenticated;

-- Única ejecución: las migraciones de Supabase corren una sola vez por base de datos.
select public.apply_demo_seed();
