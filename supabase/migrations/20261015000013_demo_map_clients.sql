-- 0013 · Más clientes Demo repartidos por El Salvador (para ver el mapa de clientes)
--  · 15 clientes ficticios con ubicación, estados variados y algunas visitas programadas.
--  · Solo se agregan si los datos Demo originales siguen cargados (si ya se borraron, no hace nada).
--  · Idempotente: queda registrado en seed_runs('demo_map') y usa IDs fijos.
-- Se puede ejecutar más de una vez sin problema.

do $$
begin
  perform pg_advisory_xact_lock(hashtext('seed_demo_map'));
  if exists (select 1 from public.seed_runs where seed_key = 'demo_map') then
    raise notice 'skipped: demo_map ya aplicado';
    return;
  end if;
  if not exists (select 1 from public.clients where id = 'd1000000-0000-4000-8000-000000000001' and is_demo) then
    raise notice 'skipped: los datos Demo no están cargados';
    return;
  end if;

  insert into public.clients (id, name, legal_name, industry, status, source, address, city, department, phone, email, needs, latitude, longitude, is_demo)
  values
    ('d1000000-0000-4000-8000-000000000006', 'Distribuidora Occidente (Demo)',   'Distribuidora Occidente, S.A. de C.V.', 'Distribución', 'activo',    'Referido',        'Calle Ficticia 12',            'Santa Ana',          'Santa Ana',    '2200-0006', 'compras@doccidente.ejemplo.sv',  'Renovación de 15 PCs en bodega y ventas.',        13.9946, -89.5590, true),
    ('d1000000-0000-4000-8000-000000000007', 'Colegio Monte Verde (Demo)',       null,                                    'Educación',    'prospecto', 'Web',             'Av. Ejemplo 8',                'Sonsonate',          'Sonsonate',    '2200-0007', 'direccion@monteverde.ejemplo.sv', 'Laboratorio de cómputo para 30 alumnos.',        13.7189, -89.7240, true),
    ('d1000000-0000-4000-8000-000000000008', 'Agroservicio El Surco (Demo)',     null,                                    'Agrícola',     'prospecto', 'Visita en frío',  'Km 1 Carretera Ficticia',      'Ahuachapán',         'Ahuachapán',   '2200-0008', 'info@elsurco.ejemplo.sv',        'Impresora multifuncional y UPS.',                13.9214, -89.8449, true),
    ('d1000000-0000-4000-8000-000000000009', 'Hotel Brisa Marina (Demo)',        'Brisa Marina, S.A. de C.V.',            'Turismo',      'activo',    'Feria comercial', 'Playa Ficticia, Lote 4',       'La Libertad',        'La Libertad',  '2200-0009', 'admin@brisamarina.ejemplo.sv',   'Cableado de red para 20 habitaciones.',          13.4893, -89.3220, true),
    ('d1000000-0000-4000-8000-000000000010', 'Clínica Dental Sonrisa (Demo)',    null,                                    'Salud',        'activo',    'Referido',        'Colonia Ejemplo, Casa 3',      'Nuevo Cuscatlán',    'La Libertad',  '2200-0010', 'citas@sonrisa.ejemplo.sv',       'Mantenimiento trimestral de equipos.',           13.6490, -89.2652, true),
    ('d1000000-0000-4000-8000-000000000011', 'Panadería La Espiga (Demo)',       null,                                    'Alimentos',    'prospecto', 'Redes sociales',  'Calle Demo 45',                'Mejicanos',          'San Salvador', '2200-0011', 'pedidos@laespiga.ejemplo.sv',    'Punto de venta y computadora para caja.',        13.7405, -89.2130, true),
    ('d1000000-0000-4000-8000-000000000012', 'Taller Mecánico Rueda Libre (Demo)', null,                                  'Automotriz',   'prospecto', 'Visita en frío',  'Boulevard Ficticio 9',         'Apopa',              'San Salvador', '2200-0012', 'taller@ruedalibre.ejemplo.sv',   'Laptop y software de inventario.',               13.8070, -89.1790, true),
    ('d1000000-0000-4000-8000-000000000013', 'Imprenta Rápida Ilopango (Demo)',  null,                                    'Servicios',    'activo',    'Referido',        'Av. Prueba 77',                'Ilopango',           'San Salvador', '2200-0013', 'ventas@imprentarapida.ejemplo.sv', 'Tóner y repuestos cada mes.',                  13.7015, -89.1095, true),
    ('d1000000-0000-4000-8000-000000000014', 'Cooperativa Los Pinos (Demo)',     'Cooperativa Los Pinos de R.L.',         'Finanzas',     'prospecto', 'Web',             'Calle Ejemplo 2',              'Cojutepeque',        'Cuscatlán',    '2200-0014', 'gerencia@lospinos.ejemplo.sv',   'Cámaras y respaldo de energía.',                 13.7168, -88.9335, true),
    ('d1000000-0000-4000-8000-000000000015', 'Alcaldía Ficticia de Zacatecoluca (Demo)', null,                            'Gobierno',     'prospecto', 'Licitación',      'Plaza Demo',                   'Zacatecoluca',       'La Paz',       '2200-0015', 'compras@alcaldia.ejemplo.sv',    'Licitación de 40 computadoras.',                 13.5005, -88.8670, true),
    ('d1000000-0000-4000-8000-000000000016', 'Ferretería El Volcán (Demo)',      null,                                    'Construcción', 'activo',    'Referido',        'Barrio Ficticio, Calle 5',     'San Vicente',        'San Vicente',  '2200-0016', 'ventas@elvolcan.ejemplo.sv',     'Sistema de facturación en 2 cajas.',             13.6410, -88.7845, true),
    ('d1000000-0000-4000-8000-000000000017', 'Instituto Técnico Oriente (Demo)', null,                                    'Educación',    'activo',    'Feria comercial', 'Final Av. Ejemplo',            'Usulután',           'Usulután',     '2200-0017', 'admin@itoriente.ejemplo.sv',     'Proyectores y laptops para docentes.',           13.3500, -88.4505, true),
    ('d1000000-0000-4000-8000-000000000018', 'Mariscos del Golfo (Demo)',        null,                                    'Alimentos',    'inactivo',  'Visita en frío',  'Muelle Ficticio 1',            'La Unión',           'La Unión',     '2200-0018', 'info@mariscosgolfo.ejemplo.sv',  'Sin necesidad por ahora.',                       13.3370, -87.8440, true),
    ('d1000000-0000-4000-8000-000000000019', 'Café Las Nubes (Demo)',            null,                                    'Agrícola',     'prospecto', 'Redes sociales',  'Cantón Ejemplo',               'Chalatenango',       'Chalatenango', '2200-0019', 'contacto@lasnubes.ejemplo.sv',   'Computadora y red para oficina de beneficio.',   14.0330, -88.9330, true),
    ('d1000000-0000-4000-8000-000000000020', 'Bufete Jurídico Escalón (Demo)',   null,                                    'Servicios legales', 'activo', 'Referido',      'Paseo Ficticio 1020',          'San Salvador',       'San Salvador', '2200-0020', 'oficina@bufete.ejemplo.sv',      'Renovación de 6 laptops y un servidor.',         13.7052, -89.2405, true)
  on conflict (id) do nothing;

  insert into public.visits (id, client_id, title, objective, scheduled_at, duration_minutes, location, status, is_demo)
  values
    ('d6000000-0000-4000-8000-000000000101', 'd1000000-0000-4000-8000-000000000007', 'Presentación de laboratorio', 'Levantar requerimientos del laboratorio', date_trunc('day', now()) + interval '1 day 9 hours',  60, 'Sonsonate',    'programada', true),
    ('d6000000-0000-4000-8000-000000000102', 'd1000000-0000-4000-8000-000000000015', 'Reunión de licitación',       'Conocer bases de la licitación',          date_trunc('day', now()) + interval '2 days 10 hours', 90, 'Zacatecoluca', 'programada', true),
    ('d6000000-0000-4000-8000-000000000103', 'd1000000-0000-4000-8000-000000000011', 'Demo de punto de venta',      'Mostrar equipo de caja',                  date_trunc('day', now()) + interval '3 days 15 hours', 45, 'Mejicanos',    'programada', true),
    ('d6000000-0000-4000-8000-000000000104', 'd1000000-0000-4000-8000-000000000014', 'Visita técnica',              'Revisar instalación eléctrica para UPS',   date_trunc('day', now()) + interval '4 days 11 hours', 60, 'Cojutepeque',  'programada', true)
  on conflict (id) do nothing;

  insert into public.seed_runs (seed_key, version) values ('demo_map', 1);
end $$;
