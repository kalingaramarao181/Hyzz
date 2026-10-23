-- HYZZ: paste this complete file into Supabase SQL Editor, then run 002.
-- No passwords, service keys or SMTP credentials belong in migrations.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.users (
 id uuid primary key references auth.users(id), kind text not null default 'customer' check(kind in ('customer','driver','employee')),
 full_name text not null default '' check(length(full_name)<=100), phone text,
 status text not null default 'active' check(status in ('active','suspended','blocked')),
 created_at timestamptz not null default now()
);
create table public.roles(id text primary key, name text not null);
create table public.permissions(id text primary key);
create table public.role_permissions(role_id text references public.roles, permission_id text references public.permissions, primary key(role_id,permission_id));
create table public.user_roles(user_id uuid references public.users, role_id text references public.roles, primary key(user_id,role_id));
create table public.customer_profiles(user_id uuid primary key references public.users, emergency_phone text, notification_enabled boolean not null default true);
create table public.employee_profiles(user_id uuid primary key references public.users, created_by uuid references public.users);
create table public.driver_profiles(
 user_id uuid primary key references public.users,
 verification text not null default 'pending' check(verification in ('pending','approved','rejected')),
 online boolean not null default false, approved_by uuid references public.users, approved_at timestamptz
);
create table public.driver_documents(
 id uuid primary key default gen_random_uuid(), driver_id uuid not null references public.driver_profiles,
 document_type text not null check(document_type in ('driving_license','identity')),
 storage_path text not null unique, expires_on date not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 rejection_reason text, reviewed_by uuid references public.users, created_at timestamptz not null default now()
);
create table public.driver_locations(
 driver_id uuid primary key references public.driver_profiles,
 point extensions.geography(Point,4326) not null, updated_at timestamptz not null default now()
);
create index driver_locations_geo on public.driver_locations using gist(point);
create table public.service_areas(id uuid primary key default gen_random_uuid(), name text not null, enabled boolean not null default true);
create table public.pricing_rules(
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
 base_paise bigint not null check(base_paise>=0), hourly_paise bigint not null check(hourly_paise>=0),
 minimum_paise bigint not null check(minimum_paise>=0), day_paise bigint not null check(day_paise>=0),
 day_hours integer not null default 8 check(day_hours between 1 and 24), increment_minutes integer not null default 15 check(increment_minutes between 1 and 60),
 commission_bps integer not null check(commission_bps between 0 and 10000),
 effective_at timestamptz not null default now(), created_by uuid references public.users
);
create table public.system_settings(id boolean primary key default true check(id), matching_radius_km integer not null default 10 check(matching_radius_km between 1 and 100), acceptance_minutes integer not null default 15 check(acceptance_minutes between 1 and 60), maintenance boolean not null default false);
insert into public.system_settings(id) values(true);
-- Initial test pricing, explicitly disclosed in both apps. Change in admin before operating.
insert into public.pricing_rules(base_paise,hourly_paise,minimum_paise,day_paise,commission_bps) values(5000,15000,20000,120000,1500);

create table public.bookings(
 id uuid primary key default gen_random_uuid(), reference text not null unique default ('HYZ-'||upper(encode(extensions.gen_random_bytes(6),'hex'))),
 customer_id uuid not null references public.users, driver_id uuid references public.driver_profiles,
 request_key uuid not null, pickup_address text not null check(length(pickup_address) between 5 and 500),
 pickup extensions.geography(Point,4326) not null, scheduled_at timestamptz not null,
 hours integer not null check(hours between 1 and 24), service_type text not null check(service_type in ('hourly','full_day')),
 state text not null default 'MATCHING' check(state in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_DRIVER','CANCELLED_BY_ADMIN','NO_DRIVER_AVAILABLE')),
 pricing_snapshot jsonb not null, estimate_paise bigint not null check(estimate_paise>=0), final_paise bigint check(final_paise>=0),
 commission_paise bigint check(commission_paise>=0), earnings_paise bigint check(earnings_paise>=0),
 payment_status text not null default 'pending' check(payment_status in ('pending','driver_confirmed','settled','disputed')),
 started_at timestamptz, ended_at timestamptz, assigned_at timestamptz, request_expires_at timestamptz not null,
 driver_cash_confirmed boolean not null default false, customer_cash_confirmed boolean not null default false,
 cancellation_reason text, created_at timestamptz not null default now(), unique(customer_id,request_key),
 check(ended_at is null or (started_at is not null and ended_at>=started_at)),
 check(state<>'IN_PROGRESS' or started_at is not null), check(state<>'COMPLETED' or ended_at is not null)
);
create index bookings_customer_date on public.bookings(customer_id,created_at desc);
create index bookings_driver_date on public.bookings(driver_id,scheduled_at);
create index bookings_open on public.bookings(state,request_expires_at);
create unique index one_current_trip_per_driver on public.bookings(driver_id) where state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS');
create table public.booking_assignments(id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings, driver_id uuid not null references public.driver_profiles, created_at timestamptz not null default now(), assigned_by uuid references public.users);
create table public.booking_status_history(id bigint generated always as identity primary key, booking_id uuid not null references public.bookings, from_state text, to_state text not null, actor_id uuid references public.users, detail text, created_at timestamptz not null default now());
create table public.booking_otp_records(booking_id uuid primary key references public.bookings, otp_hash text not null, expires_at timestamptz not null, attempts integer not null default 0, used_at timestamptz, last_issued_at timestamptz not null default now());
create table public.fare_breakdowns(booking_id uuid primary key references public.bookings, currency text not null default 'INR', total_paise bigint not null check(total_paise>=0), commission_paise bigint not null check(commission_paise>=0), earnings_paise bigint not null check(earnings_paise>=0), billed_minutes integer not null, breakdown jsonb not null, check(total_paise=commission_paise+earnings_paise));
create table public.financial_ledger_entries(
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings,
 driver_id uuid not null references public.driver_profiles, entry_type text not null check(entry_type in ('driver_earnings','commission_due','cash_collected')),
 amount_paise bigint not null check(amount_paise>=0), currency text not null default 'INR', created_at timestamptz not null default now(), unique(booking_id,entry_type)
);
create table public.ratings(id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings, author_id uuid not null references public.users, score integer not null check(score between 1 and 5), review text not null default '' check(length(review)<=1000), created_at timestamptz not null default now(), unique(booking_id,author_id));
create table public.support_tickets(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users, booking_id uuid references public.bookings, subject text not null check(length(subject) between 5 and 1000), status text not null default 'open' check(status in ('open','in_review','resolved')), admin_note text, created_at timestamptz not null default now());
create table public.emergency_events(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users, booking_id uuid references public.bookings, message text not null, created_at timestamptz not null default now());
create table public.account_deletion_requests(user_id uuid primary key references public.users, requested_at timestamptz not null default now(), status text not null default 'pending');
create table public.notification_records(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users, booking_id uuid references public.bookings, title text not null, delivery text not null default 'in_app' check(delivery='in_app'), created_at timestamptz not null default now());
create table public.audit_logs(id bigint generated always as identity primary key, actor_id uuid references public.users, action text not null, target_id text, reason text, created_at timestamptz not null default now());
create table private.rate_limits(user_id uuid not null, action text not null, window_start timestamptz not null, count integer not null, primary key(user_id,action));

insert into public.roles values('super_admin','Super Admin'),('operations','Operations Manager'),('verification','Driver Verification Officer'),('support','Customer Support Agent'),('finance','Finance Officer'),('reporting','Reporting Analyst');
insert into public.permissions values('users.manage'),('drivers.review'),('staff.manage'),('bookings.manage'),('finance.read'),('settings.manage'),('support.manage'),('reports.read');
insert into public.role_permissions select 'super_admin',id from public.permissions;
insert into public.role_permissions values('operations','users.manage'),('operations','bookings.manage'),('verification','drivers.review'),('support','support.manage'),('finance','finance.read'),('reporting','reports.read');

create function private.active_user() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.users where id=auth.uid() and status='active') $$;
create function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$ select private.active_user() and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id=ur.role_id where ur.user_id=auth.uid() and rp.permission_id=p_permission) $$;
create function private.require_user() returns uuid language plpgsql security definer set search_path='' as $$ begin if auth.uid() is null or not private.active_user() then raise exception 'Sign in with an active Hyzz account'; end if; return auth.uid(); end $$;
create function private.require_permission(p_permission text) returns void language plpgsql security definer set search_path='' as $$ begin if not public.has_permission(p_permission) then raise exception 'Permission denied: %',p_permission; end if; end $$;
create function private.limit_action(p_action text,p_max integer,p_seconds integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into private.rate_limits values(auth.uid(),p_action,now(),1)
 on conflict(user_id,action) do update set count=case when private.rate_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else private.rate_limits.count+1 end,window_start=case when private.rate_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else private.rate_limits.window_start end returning count into n;
 if n>p_max then raise exception 'Too many requests. Please try again later.'; end if;
end $$;
create function private.driver_eligible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users u join public.driver_profiles d on d.user_id=u.id where u.id=p_id and u.status='active' and d.verification='approved')
 and not exists(select 1 from (values('driving_license'),('identity')) required(kind) where not exists(select 1 from public.driver_documents dd where dd.driver_id=p_id and dd.document_type=required.kind and dd.status='approved' and dd.expires_on>=current_date))
$$;
create function private.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$ begin
 -- Never trust client-supplied metadata for privileged roles.
 insert into public.users(id,phone) values(new.id,new.phone);
 insert into public.customer_profiles(user_id) values(new.id); return new;
end $$;
create trigger on_hyzz_auth_user after insert on auth.users for each row execute function private.on_auth_user();
-- Include existing Auth accounts as customers, without granting any privileges.
insert into public.users(id,phone) select id,phone from auth.users on conflict do nothing;
insert into public.customer_profiles(user_id) select id from public.users where kind='customer' on conflict do nothing;

create function private.immutable() returns trigger language plpgsql as $$ begin raise exception 'Immutable record: use an audited correction workflow'; end $$;
create trigger ledger_immutable before update or delete on public.financial_ledger_entries for each row execute function private.immutable();
create trigger fares_immutable before update or delete on public.fare_breakdowns for each row execute function private.immutable();
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function private.immutable();
create trigger history_immutable before update or delete on public.booking_status_history for each row execute function private.immutable();
create trigger pricing_immutable before update or delete on public.pricing_rules for each row execute function private.immutable();

create function private.booking_history() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if TG_OP='INSERT' or new.state is distinct from old.state then
 insert into public.booking_status_history(booking_id,from_state,to_state,actor_id) values(new.id,case when TG_OP='INSERT' then null else old.state end,new.state,auth.uid());
 insert into public.notification_records(user_id,booking_id,title) values(new.customer_id,new.id,'Booking '||new.reference||': '||replace(new.state,'_',' '));
 if new.driver_id is not null then insert into public.notification_records(user_id,booking_id,title) values(new.driver_id,new.id,'Booking '||new.reference||': '||replace(new.state,'_',' ')); end if;
 end if; return new;
end $$;
create trigger booking_history after insert or update on public.bookings for each row execute function private.booking_history();

-- Tables are read-only to client roles; mutations go through permission-checked RPCs.
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename in ('users','roles','permissions','role_permissions','user_roles','customer_profiles','employee_profiles','driver_profiles','driver_documents','driver_locations','service_areas','pricing_rules','system_settings','bookings','booking_assignments','booking_status_history','booking_otp_records','fare_breakdowns','financial_ledger_entries','ratings','support_tickets','emergency_events','account_deletion_requests','notification_records','audit_logs') loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy self_users on public.users for select to authenticated using(private.active_user() and (id=auth.uid() or public.has_permission('users.manage')));
create policy self_customer on public.customer_profiles for select to authenticated using(private.active_user() and user_id=auth.uid());
create policy self_driver on public.driver_profiles for select to authenticated using(private.active_user() and (user_id=auth.uid() or public.has_permission('drivers.review') or public.has_permission('users.manage')));
create policy own_documents on public.driver_documents for select to authenticated using(private.active_user() and (driver_id=auth.uid() or public.has_permission('drivers.review')));
create policy booking_participants on public.bookings for select to authenticated using(private.active_user() and (customer_id=auth.uid() or driver_id=auth.uid() or public.has_permission('bookings.manage') or public.has_permission('finance.read')));
create policy own_notifications on public.notification_records for select to authenticated using(private.active_user() and user_id=auth.uid());
create policy own_support on public.support_tickets for select to authenticated using(private.active_user() and (user_id=auth.uid() or public.has_permission('support.manage')));
create policy own_emergencies on public.emergency_events for select to authenticated using(private.active_user() and (user_id=auth.uid() or public.has_permission('support.manage')));
create policy own_delete on public.account_deletion_requests for select to authenticated using(private.active_user() and (user_id=auth.uid() or public.has_permission('users.manage')));
create policy own_roles on public.user_roles for select to authenticated using(private.active_user() and (user_id=auth.uid() or public.has_permission('staff.manage')));
create policy roles_read on public.roles for select to authenticated using(private.active_user());
create policy permissions_read on public.permissions for select to authenticated using(private.active_user());
create policy role_permissions_read on public.role_permissions for select to authenticated using(private.active_user());
create policy price_read on public.pricing_rules for select to authenticated using(private.active_user());
create policy settings_read on public.system_settings for select to authenticated using(private.active_user());
create policy own_fares on public.fare_breakdowns for select to authenticated using(exists(select 1 from public.bookings b where b.id=booking_id));
create policy own_history on public.booking_status_history for select to authenticated using(exists(select 1 from public.bookings b where b.id=booking_id));
create policy own_assignments on public.booking_assignments for select to authenticated using(exists(select 1 from public.bookings b where b.id=booking_id));
create policy own_ratings on public.ratings for select to authenticated using(private.active_user() and (author_id=auth.uid() or exists(select 1 from public.bookings b where b.id=booking_id)));
create policy own_ledger on public.financial_ledger_entries for select to authenticated using(private.active_user() and (driver_id=auth.uid() or public.has_permission('finance.read')));
create policy admin_audit on public.audit_logs for select to authenticated using(public.has_permission('staff.manage'));
-- No SELECT policy for raw OTP hashes, employee profiles or driver locations.
-- Only purpose-limited functions below expose locations/nearby requests.

create function public.my_profile() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result jsonb;
begin
 select to_jsonb(p)||jsonb_build_object('permissions',coalesce((select jsonb_agg(distinct rp.permission_id) from public.user_roles ur join public.role_permissions rp on rp.role_id=ur.role_id where ur.user_id=u),'[]'::jsonb),'driver',(select to_jsonb(d) from public.driver_profiles d where user_id=u)) into result from public.users p where id=u;
 return result;
end $$;
create function public.update_my_profile(p_name text,p_phone text default null) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_user(); if length(trim(p_name))<2 or length(p_name)>100 then raise exception 'Enter your full name'; end if;
 if p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Use international phone format, such as +919876543210'; end if;
 update public.users set full_name=trim(p_name),phone=p_phone where id=auth.uid();
end $$;
create function public.estimate_fare(p_service text,p_hours integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pricing_rules; total bigint; h integer;
begin perform private.require_user(); if p_service is null or p_hours is null or p_service not in ('hourly','full_day') or p_hours not between 1 and 24 then raise exception 'Invalid service or duration'; end if;
 select * into strict p from public.pricing_rules where effective_at<=now() order by effective_at desc,created_at desc limit 1;
 h:=case when p_service='full_day' then p.day_hours else p_hours end;
 total:=greatest(p.minimum_paise,case when p_service='full_day' then p.day_paise else p.base_paise+p.hourly_paise*h end);
 return jsonb_build_object('total_paise',total,'hours',h,'pricing',to_jsonb(p),'currency','INR','payment_method','cash','policy','No customer commission. Booked duration is the minimum charge; extra time is rounded up to the billing increment. No tolls, parking or taxes added.');
end $$;
create function public.create_booking(p_request_key uuid,p_address text,p_lat double precision,p_lng double precision,p_service text,p_hours integer,p_scheduled_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); q jsonb; b public.bookings; settings public.system_settings;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into b from public.bookings where customer_id=u and request_key=p_request_key;
 if found then return to_jsonb(b)-'pickup'; end if;
 perform private.limit_action('booking',6,3600);
 if not exists(select 1 from public.users where id=u and kind='customer') then raise exception 'Only customers can create bookings'; end if;
 if exists(select 1 from public.bookings where customer_id=u and state in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) then raise exception 'Finish or cancel your current booking first'; end if;
 select * into settings from public.system_settings;
 if settings.maintenance then raise exception 'Hyzz is temporarily under maintenance'; end if;
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Enter valid pickup coordinates'; end if;
 if p_scheduled_at is null or p_scheduled_at<now()-interval '5 minutes' or p_scheduled_at>now()+interval '7 days' then raise exception 'Select a pickup within the next 7 days'; end if;
 q:=public.estimate_fare(p_service,p_hours);
 insert into public.bookings(customer_id,request_key,pickup_address,pickup,scheduled_at,hours,service_type,pricing_snapshot,estimate_paise,request_expires_at)
 values(u,p_request_key,trim(p_address),extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_scheduled_at,(q->>'hours')::integer,p_service,q->'pricing',(q->>'total_paise')::bigint,greatest(now(),p_scheduled_at-interval '30 minutes')+make_interval(mins=>settings.acceptance_minutes)) returning * into b;
 return to_jsonb(b)-'pickup';
end $$;
create function public.set_availability(p_online boolean,p_lat double precision default null,p_lng double precision default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if not exists(select 1 from public.driver_profiles where user_id=u) then raise exception 'Driver account required'; end if;
 if p_online and not private.driver_eligible(u) then raise exception 'Approved account and valid approved identity and driving license are required'; end if;
 if p_online then
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Location is needed to receive nearby requests'; end if;
 insert into public.driver_locations values(u,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,now()) on conflict(driver_id) do update set point=excluded.point,updated_at=now();
 end if;
 update public.driver_profiles set online=p_online where user_id=u;
 if not p_online then delete from public.driver_locations where driver_id=u; end if;
end $$;
create function public.nearby_requests() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result jsonb;
begin
 if not private.driver_eligible(u) then return '[]'; end if;
 -- Expired and scheduled requests are filtered using server time.
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
 select b.id,b.reference,b.pickup_address,b.service_type,b.hours,b.scheduled_at,b.estimate_paise,
 b.estimate_paise-round(b.estimate_paise*(b.pricing_snapshot->>'commission_bps')::numeric/10000)::bigint as estimated_earnings_paise,
 round((extensions.st_distance(b.pickup,l.point)/1000)::numeric,1) as pickup_km
 from public.bookings b join public.driver_locations l on l.driver_id=u join public.driver_profiles d on d.user_id=u cross join public.system_settings s
 where b.state='MATCHING' and b.request_expires_at>now() and b.scheduled_at<=now()+interval '30 minutes' and d.online and l.updated_at>now()-interval '5 minutes'
 and extensions.st_dwithin(b.pickup,l.point,s.matching_radius_km*1000) and not exists(select 1 from public.bookings busy where busy.driver_id=u and busy.state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))
 order by extensions.st_distance(b.pickup,l.point) limit 20) x;
 return result;
end $$;
create function public.accept_booking(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.state<>'MATCHING' then raise exception 'This request is no longer available'; end if;
 if b.request_expires_at<=now() then raise exception 'Request has expired'; end if;
 if not private.driver_eligible(u) then raise exception 'Driver is not eligible'; end if;
 if not exists(select 1 from jsonb_array_elements(public.nearby_requests()) x where x->>'id'=p_booking::text) then raise exception 'Request is outside your availability or matching radius'; end if;
 update public.bookings set driver_id=u,state='DRIVER_ASSIGNED',assigned_at=now() where id=p_booking;
 insert into public.booking_assignments(booking_id,driver_id,assigned_by) values(p_booking,u,u);
end $$;
create function public.update_pickup_location(p_booking uuid,p_lat double precision,p_lng double precision) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location'; end if;
 if not exists(select 1 from public.bookings where id=p_booking and driver_id=u and state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED')) then raise exception 'Pickup sharing is only available before the trip starts'; end if;
 insert into public.driver_locations values(u,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,now()) on conflict(driver_id) do update set point=excluded.point,updated_at=now();
end $$;
create function public.pickup_driver_location(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result jsonb;
begin
 select jsonb_build_object('lat',extensions.st_y(l.point::extensions.geometry),'lng',extensions.st_x(l.point::extensions.geometry),'updated_at',l.updated_at) into result
 from public.bookings b join public.driver_locations l on l.driver_id=b.driver_id where b.id=p_booking and b.customer_id=u and b.state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED') and l.updated_at>now()-interval '2 minutes';
 return result;
end $$;
create function public.booking_details(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings; result jsonb;
begin
 select * into b from public.bookings where id=p_booking;
 if not found or not(u=b.customer_id or coalesce(u=b.driver_id,false) or public.has_permission('bookings.manage') or public.has_permission('finance.read')) then raise exception 'Booking not available'; end if;
 result:=(to_jsonb(b)-'pickup')||jsonb_build_object('pickup_lat',extensions.st_y(b.pickup::extensions.geometry),'pickup_lng',extensions.st_x(b.pickup::extensions.geometry),'customer_name',(select full_name from public.users where id=b.customer_id),'driver_name',(select full_name from public.users where id=b.driver_id),'fare',(select to_jsonb(f) from public.fare_breakdowns f where booking_id=b.id),'history',(select coalesce(jsonb_agg(to_jsonb(h) order by created_at),'[]') from public.booking_status_history h where booking_id=b.id));
 return result;
end $$;
create function public.issue_trip_otp(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); code text; previous public.booking_otp_records; bytes bytea;
begin
 perform 1 from public.bookings where id=p_booking and customer_id=u and state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED') for update;
 if not found then raise exception 'OTP is available after a driver accepts, before trip start'; end if;
 select * into previous from public.booking_otp_records where booking_id=p_booking;
 if previous.last_issued_at>now()-interval '60 seconds' then raise exception 'Wait 60 seconds before requesting another code'; end if;
 perform private.limit_action('trip_otp',10,3600);
 bytes:=extensions.gen_random_bytes(4);
 code:=lpad(((get_byte(bytes,0)::bigint*16777216+get_byte(bytes,1)*65536+get_byte(bytes,2)*256+get_byte(bytes,3))%1000000)::text,6,'0');
 insert into public.booking_otp_records(booking_id,otp_hash,expires_at) values(p_booking,extensions.crypt(code,extensions.gen_salt('bf')),now()+interval '10 minutes') on conflict(booking_id) do update set otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,used_at=null,last_issued_at=now();
 return jsonb_build_object('code',code,'expires_in_seconds',600);
end $$;
create function public.verify_trip_otp(p_booking uuid,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); o public.booking_otp_records; b public.bookings;
begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.driver_id is distinct from u or b.state<>'DRIVER_ARRIVED' then raise exception 'Only the assigned driver at pickup can start this trip'; end if;
 if not private.driver_eligible(u) then raise exception 'Driver is no longer eligible'; end if;
 select * into o from public.booking_otp_records where booking_id=p_booking for update;
 if not found or o.used_at is not null or o.expires_at<now() or o.attempts>=5 then return jsonb_build_object('ok',false,'message','Code expired, used or locked. Ask the customer to generate a new code.'); end if;
 update public.booking_otp_records set attempts=attempts+1 where booking_id=p_booking;
 -- Return a failed result instead of raising: attempted guesses must stay committed.
 if p_code is null or p_code!~'^[0-9]{6}$' or extensions.crypt(p_code,o.otp_hash)<>o.otp_hash then return jsonb_build_object('ok',false,'message','Incorrect code. Maximum five attempts.'); end if;
 update public.booking_otp_records set used_at=now() where booking_id=p_booking;
 insert into public.booking_status_history(booking_id,from_state,to_state,actor_id,detail) values(p_booking,'DRIVER_ARRIVED','OTP_VERIFIED',u,'OTP verified; trip start committed in the same transaction');
 update public.bookings set state='IN_PROGRESS',started_at=now() where id=p_booking;
 update public.driver_profiles set online=false where user_id=u;
 delete from public.driver_locations where driver_id=u;
 return jsonb_build_object('ok',true);
end $$;
create function public.advance_booking(p_booking uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings;
begin select * into b from public.bookings where id=p_booking for update;
 if not found or b.driver_id is distinct from u then raise exception 'Assigned driver required'; end if;
 if not private.driver_eligible(u) then raise exception 'Driver is no longer eligible'; end if;
 if p_action='en_route' and b.state='DRIVER_ASSIGNED' then update public.bookings set state='DRIVER_EN_ROUTE' where id=p_booking;
 elsif p_action='arrive' and b.state='DRIVER_EN_ROUTE' then update public.bookings set state='DRIVER_ARRIVED' where id=p_booking;
 else raise exception 'Invalid booking transition'; end if;
end $$;
create function public.complete_trip(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings; p jsonb; minutes integer; bill_minutes integer; total bigint; commission bigint;
begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.driver_id is distinct from u then raise exception 'Assigned driver required'; end if;
 if b.state='COMPLETED' then return public.booking_details(p_booking); end if;
 if b.state<>'IN_PROGRESS' then raise exception 'Only an active trip can be completed'; end if;
 p:=b.pricing_snapshot;
 minutes:=greatest(1,ceil(extract(epoch from(now()-b.started_at))/60)::integer);
 bill_minutes:=greatest(b.hours*60,ceil(minutes::numeric/(p->>'increment_minutes')::integer)::integer*(p->>'increment_minutes')::integer);
 if b.service_type='full_day' then total:=greatest((p->>'minimum_paise')::bigint,(p->>'day_paise')::bigint+ceil(greatest(0,bill_minutes-b.hours*60)*(p->>'hourly_paise')::numeric/60)::bigint);
 else total:=greatest((p->>'minimum_paise')::bigint,(p->>'base_paise')::bigint+ceil(bill_minutes*(p->>'hourly_paise')::numeric/60)::bigint); end if;
 commission:=round(total*(p->>'commission_bps')::numeric/10000)::bigint;
 update public.bookings set state='COMPLETED',ended_at=now(),final_paise=total,commission_paise=commission,earnings_paise=total-commission where id=p_booking;
 insert into public.fare_breakdowns values(p_booking,'INR',total,commission,total-commission,bill_minutes,jsonb_build_object('booked_minutes',b.hours*60,'actual_minutes',minutes,'base_paise',case when b.service_type='full_day' then 0 else (p->>'base_paise')::bigint end,'service_paise',total-case when b.service_type='full_day' then 0 else (p->>'base_paise')::bigint end,'overtime_minutes',greatest(0,bill_minutes-b.hours*60),'commission_bps',(p->>'commission_bps')::integer,'tax_paise',0,'expenses_paise',0,'customer_commission_paise',0));
 insert into public.financial_ledger_entries(booking_id,driver_id,entry_type,amount_paise) values(p_booking,u,'driver_earnings',total-commission),(p_booking,u,'commission_due',commission);
 update public.driver_profiles set online=false where user_id=u;
 delete from public.driver_locations where driver_id=u;
 return public.booking_details(p_booking);
end $$;
create function public.confirm_cash(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings;
begin select * into b from public.bookings where id=p_booking for update;
 if not found or b.state<>'COMPLETED' or not(u=b.customer_id or u=b.driver_id) then raise exception 'Completed booking participant required'; end if;
 if b.payment_status='disputed' then raise exception 'Payment is disputed. Contact support.'; end if;
 if u=b.driver_id then update public.bookings set driver_cash_confirmed=true where id=p_booking; else update public.bookings set customer_cash_confirmed=true where id=p_booking; end if;
 select * into b from public.bookings where id=p_booking;
 if b.driver_cash_confirmed and b.customer_cash_confirmed then
 update public.bookings set payment_status='settled' where id=p_booking;
 insert into public.financial_ledger_entries(booking_id,driver_id,entry_type,amount_paise) values(p_booking,b.driver_id,'cash_collected',b.final_paise) on conflict(booking_id,entry_type) do nothing;
 elsif b.driver_cash_confirmed then update public.bookings set payment_status='driver_confirmed' where id=p_booking; end if;
end $$;
create function public.cancel_booking(p_booking uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings; s text;
begin select * into b from public.bookings where id=p_booking for update;
 if not found or b.state not in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED') then raise exception 'Booking cannot be cancelled at this stage'; end if;
 if length(trim(p_reason))<5 or length(p_reason)>1000 then raise exception 'Please provide a cancellation reason (5–1000 characters)'; end if;
 if u=b.customer_id then s:='CANCELLED_BY_CUSTOMER'; elsif u=b.driver_id and b.state<>'DRIVER_ARRIVED' then s:='CANCELLED_BY_DRIVER'; elsif public.has_permission('bookings.manage') then s:='CANCELLED_BY_ADMIN'; else raise exception 'Cancellation not permitted'; end if;
 update public.bookings set state=s,cancellation_reason=p_reason where id=p_booking;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'booking.cancel',p_booking::text,p_reason);
end $$;
create function public.expire_requests() returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin perform private.require_user(); update public.bookings set state='NO_DRIVER_AVAILABLE' where state='MATCHING' and request_expires_at<=now(); get diagnostics n=row_count; return n; end $$;
create function public.submit_rating(p_booking uuid,p_score integer,p_review text default '') returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not exists(select 1 from public.bookings where id=p_booking and state='COMPLETED' and (customer_id=u or driver_id=u)) then raise exception 'Rate only your completed trips'; end if;
 insert into public.ratings(booking_id,author_id,score,review) values(p_booking,u,p_score,p_review);
end $$;
create function public.submit_support(p_subject text,p_booking uuid default null,p_dispute boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result uuid;
begin perform private.limit_action('support',10,3600);
 if p_booking is not null and not exists(select 1 from public.bookings where id=p_booking and (customer_id=u or driver_id=u)) then raise exception 'Booking access denied'; end if;
 if p_dispute and p_booking is null then raise exception 'A booking is required for a payment dispute'; end if;
 insert into public.support_tickets(user_id,booking_id,subject) values(u,p_booking,p_subject) returning id into result;
 if p_dispute then update public.bookings set payment_status='disputed' where id=p_booking and state='COMPLETED'; end if;
 return result;
end $$;
create function public.report_emergency(p_booking uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result uuid;
begin perform private.limit_action('emergency',5,3600);
 if p_booking is not null and not exists(select 1 from public.bookings where id=p_booking and (customer_id=u or driver_id=u)) then raise exception 'Booking access denied'; end if;
 insert into public.emergency_events(user_id,booking_id,message) values(u,p_booking,'User requested urgent assistance. No emergency service dispatch integration is configured.') returning id into result; return result;
end $$;
create function public.request_account_deletion() returns void language plpgsql security definer set search_path='' as $$ begin perform private.require_user(); insert into public.account_deletion_requests(user_id) values(auth.uid()) on conflict do nothing; end $$;

-- Private documents: never public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('driver-documents','driver-documents',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;
create policy hyzz_document_upload on storage.objects for insert to authenticated with check(bucket_id='driver-documents' and private.active_user() and ((storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.driver_profiles where user_id=auth.uid()) or public.has_permission('drivers.review')));
create policy hyzz_document_read on storage.objects for select to authenticated using(bucket_id='driver-documents' and private.active_user() and ((storage.foldername(name))[1]=auth.uid()::text or public.has_permission('drivers.review')));
-- Do not allow overwriting/deleting approved evidence through the client.

-- Realtime is an optimization; apps also reconcile with server snapshots.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.bookings,public.notification_records,public.support_tickets;
 end if;
end $$;
-- Lock down functions, including the default PUBLIC execute privilege.
revoke all on all functions in schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
-- Policy helpers are harmless boolean checks bound to auth.uid().
grant execute on function private.active_user() to authenticated;
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('has_permission','my_profile','update_my_profile','estimate_fare','create_booking','set_availability','nearby_requests','accept_booking','update_pickup_location','pickup_driver_location','booking_details','issue_trip_otp','verify_trip_otp','advance_booking','complete_trip','confirm_cash','cancel_booking','expire_requests','submit_rating','submit_support','report_emergency','request_account_deletion') loop
 execute format('revoke all on function %s from public,anon',r.signature);
 execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
commit;
