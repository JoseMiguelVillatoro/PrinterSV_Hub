-- Paso 3: ejecutar en Supabase → SQL Editor DESPUÉS de crear el usuario
-- jose.villatoro@hotmail.com en Authentication → Users → Add user.

insert into public.profiles (id, email, full_name)
select id, email, 'José Miguel Villatoro'
from auth.users
where email = 'jose.villatoro@hotmail.com'
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select id, r::public.app_role
from public.profiles
cross join (values ('admin'), ('comercial')) as v(r)
where email = 'jose.villatoro@hotmail.com'
on conflict do nothing;

-- Debe mostrar: jose.villatoro@hotmail.com | {admin,comercial}
select p.email, array_agg(ur.role) as roles
from public.profiles p
join public.user_roles ur on ur.user_id = p.id
group by p.email;
