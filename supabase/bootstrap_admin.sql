-- Ejecutar UNA vez en Supabase → SQL Editor, después de invitar a José
-- (Authentication → Users → Invite user). Cambiá el correo.
-- Los demás roles se asignan desde la app: Configuración → Usuarios y roles.

insert into public.user_roles (user_id, role)
select id, r.role::public.app_role
from public.profiles
cross join (values ('admin'), ('comercial')) as r(role)
where email = 'jose@CAMBIAR.com'
on conflict do nothing;

select p.email, array_agg(ur.role) as roles
from public.profiles p join public.user_roles ur on ur.user_id = p.id
group by p.email;
