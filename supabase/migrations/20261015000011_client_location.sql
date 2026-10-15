-- 0011 · Ubicación del cliente en el mapa
--  · clients.latitude / clients.longitude (opcionales; ambos o ninguno).
--  · Ubicación aproximada para los clientes Demo (centro de su municipio).
-- Se puede ejecutar más de una vez sin problema.

alter table public.clients add column if not exists latitude  double precision;
alter table public.clients add column if not exists longitude double precision;

alter table public.clients drop constraint if exists clients_location_check;
alter table public.clients add constraint clients_location_check check (
  (latitude is null and longitude is null)
  or (latitude between -90 and 90 and longitude between -180 and 180)
);

update public.clients c
   set latitude = v.lat, longitude = v.lng
  from (values
    ('d1000000-0000-4000-8000-000000000001', 13.6989, -89.1914),  -- San Salvador
    ('d1000000-0000-4000-8000-000000000002', 13.6769, -89.2797),  -- Santa Tecla
    ('d1000000-0000-4000-8000-000000000003', 13.6730, -89.2400),  -- Antiguo Cuscatlán
    ('d1000000-0000-4000-8000-000000000004', 13.4833, -88.1833),  -- San Miguel
    ('d1000000-0000-4000-8000-000000000005', 13.7100, -89.1400)   -- Soyapango
  ) as v(id, lat, lng)
 where c.id = v.id::uuid
   and c.is_demo
   and c.latitude is null;

notify pgrst, 'reload schema';
