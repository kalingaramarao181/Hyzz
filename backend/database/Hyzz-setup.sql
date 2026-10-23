-- NEW EMPTY DATABASE ONLY. Never rerun on a live project.
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

begin;
create function public.admin_provision_user(p_user uuid,p_name text,p_kind text,p_role text default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if p_kind='driver' then perform private.require_permission('users.manage');
 elsif p_kind='employee' then perform private.require_permission('staff.manage');
 else raise exception 'Only driver or employee accounts can be provisioned'; end if;
 if p_user=u or not exists(select 1 from public.users where id=p_user and kind='customer' and created_at>now()-interval '10 minutes') or exists(select 1 from public.bookings where customer_id=p_user) then raise exception 'Only newly created unused accounts can be provisioned'; end if;
 if p_name is null or length(trim(p_name))<2 or length(p_name)>100 then raise exception 'Full name required'; end if;
 perform 1 from public.users where id=p_user for update;
 update public.users set kind=p_kind,full_name=trim(p_name) where id=p_user;
 delete from public.customer_profiles where user_id=p_user;
 if p_kind='driver' then insert into public.driver_profiles(user_id) values(p_user);
 else
 if not exists(select 1 from public.roles where id=p_role) then raise exception 'Valid employee role required'; end if;
 insert into public.employee_profiles values(p_user,u);
 insert into public.user_roles values(p_user,p_role);
 end if;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'account.provision',p_user::text,p_kind||coalesce(' / '||p_role,''));
end $$;
create function public.admin_set_role(p_user uuid,p_role text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin perform private.require_permission('staff.manage');
 if p_user=u then raise exception 'You cannot change your own permissions'; end if;
 if length(trim(p_reason))<5 then raise exception 'A reason is required'; end if;
 if not exists(select 1 from public.users where id=p_user and kind='employee') then raise exception 'Employee account required'; end if;
 if not exists(select 1 from public.roles where id=p_role) then raise exception 'Unknown role'; end if;
 perform 1 from public.users where id=p_user for update;
 delete from public.user_roles where user_id=p_user;
 insert into public.user_roles values(p_user,p_role);
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'employee.role.'||p_role,p_user::text,p_reason);
end $$;
create function public.admin_set_status(p_user uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); target public.users;
begin select * into target from public.users where id=p_user for update;
 if not found then raise exception 'Account not found'; end if;
 if target.kind='employee' then perform private.require_permission('staff.manage'); else perform private.require_permission('users.manage'); end if;
 if p_user=u then raise exception 'You cannot change your own account status'; end if;
 if length(trim(p_reason))<5 or p_status not in ('active','blocked','suspended') then raise exception 'Valid status and reason required'; end if;
 update public.users set status=p_status where id=p_user;
 if p_status<>'active' then update public.driver_profiles set online=false where user_id=p_user; delete from public.driver_locations where driver_id=p_user; end if;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'account.status.'||p_status,p_user::text,p_reason);
end $$;
create function public.register_document(p_driver uuid,p_type text,p_path text,p_expires date) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if p_driver<>u then perform private.require_permission('drivers.review'); end if;
 if not exists(select 1 from public.driver_profiles where user_id=p_driver) then raise exception 'Driver not found'; end if;
 if p_expires<current_date then raise exception 'Document has already expired'; end if;
 if split_part(p_path,'/',1)<>p_driver::text or not exists(select 1 from storage.objects where bucket_id='driver-documents' and name=p_path) then raise exception 'Upload a private document in the driver folder first'; end if;
 insert into public.driver_documents(driver_id,document_type,storage_path,expires_on) values(p_driver,p_type,p_path,p_expires);
 -- New evidence always requires a new verification decision.
 update public.driver_profiles set verification='pending',online=false where user_id=p_driver;
 insert into public.audit_logs(actor_id,action,target_id) values(u,'document.upload',p_driver::text);
end $$;
create function public.admin_review_document(p_document uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); d public.driver_documents;
begin perform private.require_permission('drivers.review');
 select * into d from public.driver_documents where id=p_document for update;
 if not found or p_status not in ('approved','rejected') or length(trim(p_reason))<5 then raise exception 'Valid document, decision and reason required'; end if;
 if p_status='approved' and d.expires_on<current_date then raise exception 'Expired document cannot be approved'; end if;
 update public.driver_documents set status=p_status,rejection_reason=case when p_status='rejected' then p_reason else null end,reviewed_by=u where id=p_document;
 if p_status='rejected' then update public.driver_profiles set verification='pending',online=false where user_id=d.driver_id; end if;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'document.'||p_status,p_document::text,p_reason);
end $$;
create function public.admin_approve_driver(p_driver uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin perform private.require_permission('drivers.review');
 if length(trim(p_reason))<5 then raise exception 'A review reason is required'; end if;
 if not exists(select 1 from public.driver_profiles where user_id=p_driver) then raise exception 'Driver not found'; end if;
 if exists(select 1 from (values('driving_license'),('identity')) required(kind) where not exists(select 1 from public.driver_documents where driver_id=p_driver and document_type=required.kind and status='approved' and expires_on>=current_date)) then raise exception 'Approve valid license and identity documents first'; end if;
 update public.driver_profiles set verification='approved',approved_by=u,approved_at=now() where user_id=p_driver;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'driver.approved',p_driver::text,p_reason);
end $$;
create function public.admin_update_pricing(p_base bigint,p_hourly bigint,p_minimum bigint,p_day bigint,p_commission integer) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('settings.manage');
 if p_base>100000000 or p_hourly>100000000 or p_minimum>100000000 or p_day>100000000 then raise exception 'Pricing amount exceeds limit'; end if;
 insert into public.pricing_rules(base_paise,hourly_paise,minimum_paise,day_paise,commission_bps,created_by) values(p_base,p_hourly,p_minimum,p_day,p_commission,auth.uid());
 insert into public.audit_logs(actor_id,action) values(auth.uid(),'pricing.version.create');
end $$;
create function public.admin_update_settings(p_radius integer,p_expiry integer,p_maintenance boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('settings.manage');
 update public.system_settings set matching_radius_km=p_radius,acceptance_minutes=p_expiry,maintenance=p_maintenance;
 insert into public.audit_logs(actor_id,action) values(auth.uid(),'settings.update');
end $$;
create function public.admin_resolve_ticket(p_ticket uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('support.manage');
 if length(trim(p_note))<5 then raise exception 'A resolution note is required'; end if;
 update public.support_tickets set status=p_status,admin_note=p_note where id=p_ticket;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'support.'||p_status,p_ticket::text,p_note);
 -- A support resolution never rewrites a settled ledger or payment dispute.
end $$;
create function public.admin_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result jsonb:='{}';
begin
 if not exists(select 1 from public.user_roles where user_id=u) then raise exception 'Staff access required'; end if;
 if public.has_permission('users.manage') then result:=result||jsonb_build_object('users',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.users order by created_at desc limit 500)x)); end if;
 if public.has_permission('drivers.review') then result:=result||jsonb_build_object('drivers',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('full_name',u.full_name)),'[]') from public.driver_profiles d join public.users u on u.id=d.user_id),'documents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.driver_documents order by created_at desc limit 500)x)); end if;
 if public.has_permission('staff.manage') then result:=result||jsonb_build_object('employees',(select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('roles',(select jsonb_agg(role_id) from public.user_roles where user_id=u.id))),'[]') from public.users u where kind='employee'),'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.audit_logs order by created_at desc limit 200)x)); end if;
 if public.has_permission('bookings.manage') then result:=result||jsonb_build_object('bookings',(select coalesce(jsonb_agg(to_jsonb(x)-'pickup'),'[]') from(select * from public.bookings order by created_at desc limit 500)x)); end if;
 if public.has_permission('support.manage') then result:=result||jsonb_build_object('tickets',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.support_tickets order by created_at desc limit 500)x),'emergencies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.emergency_events order by created_at desc limit 200)x)); end if;
 if public.has_permission('finance.read') then result:=result||jsonb_build_object('ledger',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.financial_ledger_entries order by created_at desc limit 1000)x),'financial',jsonb_build_object('gross_paise',(select coalesce(sum(final_paise),0) from public.bookings where state='COMPLETED'),'cash_with_drivers_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where entry_type='cash_collected'),'commission_due_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where entry_type='commission_due'),'platform_cash_collected_paise',0)); end if;
 if public.has_permission('reports.read') or public.has_permission('bookings.manage') then result:=result||jsonb_build_object('counts',(select jsonb_object_agg(state,n) from(select state,count(*) n from public.bookings group by state)x)); end if;
 return result;
end $$;
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_provision_user','admin_set_role','admin_set_status','register_document','admin_review_document','admin_approve_driver','admin_update_pricing','admin_update_settings','admin_resolve_ticket','admin_overview') loop
 execute format('revoke all on function %s from public,anon',r.signature);
 execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
commit;

begin;
create function public.driver_wallet() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not exists(select 1 from public.driver_profiles where user_id=u) then raise exception 'Driver account required'; end if;
 return jsonb_build_object('earnings_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where driver_id=u and entry_type='driver_earnings'),'commission_due_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where driver_id=u and entry_type='commission_due'),'cash_collected_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where driver_id=u and entry_type='cash_collected'),'currency','INR','payouts_enabled',false);
end $$;
create function public.admin_assign_driver(p_booking uuid,p_driver uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings;
begin perform private.require_permission('bookings.manage');
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'A manual assignment reason is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text,0));
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.state not in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','NO_DRIVER_AVAILABLE') then raise exception 'Booking cannot be assigned at this stage'; end if;
 if not private.driver_eligible(p_driver) then raise exception 'Approved driver with valid documents required'; end if;
 if exists(select 1 from public.bookings where driver_id=p_driver and id<>p_booking and state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) then raise exception 'Driver has an overlapping assignment'; end if;
 if not exists(select 1 from public.driver_profiles where user_id=p_driver and online) then raise exception 'Driver must be online'; end if;
 if b.scheduled_at>now()+interval '30 minutes' then raise exception 'Assign within 30 minutes of scheduled pickup'; end if;
 update public.bookings set driver_id=p_driver,state='DRIVER_ASSIGNED',assigned_at=now() where id=p_booking;
 insert into public.booking_assignments(booking_id,driver_id,assigned_by) values(p_booking,p_driver,u);
 delete from public.booking_otp_records where booking_id=p_booking;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'booking.manual_assignment',p_booking::text,p_reason);
 insert into public.booking_status_history(booking_id,from_state,to_state,actor_id,detail) values(p_booking,b.state,'DRIVER_ASSIGNED',u,'Manual assignment: '||p_reason);
 if b.driver_id is not null and b.driver_id<>p_driver then insert into public.notification_records(user_id,booking_id,title) values(b.driver_id,p_booking,'Your booking was reassigned by operations.'); end if;
end $$;
create function public.admin_role_permissions(p_role text,p_permissions text[],p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); p text;
begin perform private.require_permission('staff.manage');
 if p_role='super_admin' or exists(select 1 from public.user_roles where user_id=u and role_id=p_role) then raise exception 'Cannot edit Super Admin or your own role permissions'; end if;
 if p_reason is null or length(trim(p_reason))<5 or not exists(select 1 from public.roles where id=p_role) then raise exception 'A valid role and change reason are required'; end if;
 if p_permissions is null or cardinality(p_permissions)>8 then raise exception 'Invalid permissions'; end if;
 perform 1 from public.roles where id=p_role for update;
 delete from public.role_permissions where role_id=p_role;
 foreach p in array p_permissions loop insert into public.role_permissions values(p_role,p); end loop;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'role.permissions.update',p_role,p_reason);
end $$;
create function public.set_notification_preference(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_user(); update public.customer_profiles set notification_enabled=p_enabled where user_id=auth.uid(); end $$;
-- Existing notification history is retained. In-app trip status is essential; this
-- preference is reserved for optional outbound notifications when configured.
revoke all on function public.driver_wallet(),public.admin_assign_driver(uuid,uuid,text),public.admin_role_permissions(text,text[],text),public.set_notification_preference(boolean) from public,anon;
grant execute on function public.driver_wallet(),public.admin_assign_driver(uuid,uuid,text),public.admin_role_permissions(text,text[],text),public.set_notification_preference(boolean) to authenticated;
commit;

-- Additive upgrade. Apply after 001, 002 and 003. Never reset existing data.
begin;

alter table public.pricing_rules add column per_km_paise bigint not null default 1800 check(per_km_paise between 1 and 10000000);
alter table public.pricing_rules add column grace_minutes integer not null default 5 check(grace_minutes between 0 and 60);
alter table public.pricing_rules add column tax_bps integer not null default 0 check(tax_bps between 0 and 5000);
alter table public.bookings add column requested_minutes integer;
alter table public.bookings add column estimated_km numeric;
alter table public.bookings add column actual_km numeric;
alter table public.bookings drop constraint bookings_service_type_check;
alter table public.bookings add constraint bookings_service_type_check check(service_type in ('hourly','distance','full_day'));
alter table public.bookings drop constraint bookings_state_check;
alter table public.bookings add constraint bookings_state_check check(state in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS','COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_DRIVER','CANCELLED_BY_ADMIN','NO_DRIVER_AVAILABLE'));
drop index public.one_current_trip_per_driver;
create unique index one_current_trip_per_driver on public.bookings(driver_id) where state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS');
alter table public.fare_breakdowns drop constraint fare_breakdowns_check;
alter table public.fare_breakdowns add constraint fare_breakdowns_check check(total_paise=commission_paise+earnings_paise+coalesce((breakdown->>'tax_paise')::bigint,0));
alter table public.financial_ledger_entries drop constraint financial_ledger_entries_entry_type_check;
alter table public.financial_ledger_entries add constraint financial_ledger_entries_entry_type_check check(entry_type in ('driver_earnings','commission_due','cash_collected','tax_collected'));
create table private.declined_requests(driver_id uuid references public.driver_profiles,booking_id uuid references public.bookings,primary key(driver_id,booking_id));
insert into public.permissions values('finance.manage');
insert into public.role_permissions values('super_admin','finance.manage'),('finance','finance.manage');
create table public.commission_receipts(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.driver_profiles,amount_paise bigint not null check(amount_paise>0),reference text not null unique check(length(reference) between 5 and 100),recorded_by uuid not null references public.users,created_at timestamptz not null default now());
alter table public.commission_receipts enable row level security;
revoke all on public.commission_receipts from anon,authenticated;
grant select on public.commission_receipts to authenticated;
create policy receipt_read on public.commission_receipts for select to authenticated using(private.active_user() and (driver_id=auth.uid() or public.has_permission('finance.read')));
create trigger receipt_immutable before update or delete on public.commission_receipts for each row execute function private.immutable();

create or replace function public.create_booking(p_request_key uuid,p_address text,p_lat double precision,p_lng double precision,p_service text,p_hours integer,p_scheduled_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); q jsonb; b public.bookings; settings public.system_settings;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into b from public.bookings where customer_id=u and request_key=p_request_key;
 if found then return to_jsonb(b)-'pickup'; end if;
 perform private.limit_action('booking',6,3600);
 if not exists(select 1 from public.users where id=u and kind='customer') then raise exception 'Only customers can create bookings'; end if;
 if exists(select 1 from public.bookings where customer_id=u and state in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS')) then raise exception 'Finish or cancel your current booking first'; end if;
 select * into settings from public.system_settings;
 if settings.maintenance then raise exception 'Hyzz is temporarily under maintenance'; end if;
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Enter valid pickup coordinates'; end if;
 if p_scheduled_at is null or p_scheduled_at<now()-interval '5 minutes' or p_scheduled_at>now()+interval '7 days' then raise exception 'Select a pickup within the next 7 days'; end if;
 q:=public.estimate_fare(p_service,p_hours);
 insert into public.bookings(customer_id,request_key,pickup_address,pickup,scheduled_at,hours,service_type,pricing_snapshot,estimate_paise,request_expires_at)
 values(u,p_request_key,trim(p_address),extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_scheduled_at,(q->>'hours')::integer,p_service,q->'pricing',(q->>'total_paise')::bigint,greatest(now(),p_scheduled_at-interval '30 minutes')+make_interval(mins=>settings.acceptance_minutes)) returning * into b;
 return to_jsonb(b)-'pickup';
end $$;
-- New functions use their own names so already installed 1.1 APKs stay compatible.
create function private.service_fare(p jsonb,s text,m integer,km numeric,booked integer default 60) returns jsonb language plpgsql set search_path='' as $$
declare subtotal bigint; tax bigint; commission bigint; units integer:=0; base bigint:=0; service bigint; minimum bigint:=coalesce((p->>'minimum_paise')::bigint,15000); billed integer:=m;
begin
 if s not in ('hourly','distance','full_day') or m not between 0 and 100000 or km is null or km<0 or km>10000 then raise exception 'Invalid fare inputs'; end if;
 if s='distance' then
  base:=(p->>'base_paise')::bigint; service:=round(km*(p->>'per_km_paise')::numeric); subtotal:=greatest(minimum,base+service);
 elsif s='full_day' then
  units:=ceil(greatest(0,m-(p->>'day_hours')::integer*60-10)::numeric/30); service:=(p->>'day_paise')::bigint+units*8000; subtotal:=greatest(minimum,service);
 else
  base:=(p->>'base_paise')::bigint;
  units:=ceil(greatest(0,m-greatest(60,booked)-(p->>'grace_minutes')::integer)::numeric/15);
  billed:=greatest(60,booked)+units*15;
  service:=round((p->>'hourly_paise')::numeric*greatest(60,booked)/60)+units*round((p->>'hourly_paise')::numeric/4);
  subtotal:=greatest(minimum,base+service);
 end if;
 tax:=round(subtotal*(p->>'tax_bps')::numeric/10000); commission:=round(subtotal*(p->>'commission_bps')::numeric/10000);
 return jsonb_build_object('total_paise',subtotal+tax,'subtotal_paise',subtotal,'tax_paise',tax,'commission_paise',commission,'earnings_paise',subtotal-commission,'base_paise',base,'service_paise',service,'minimum_adjustment_paise',greatest(0,subtotal-base-service),'actual_minutes',m,'billed_minutes',billed,'overtime_minutes',units*case when s='full_day' then 30 else 15 end,'actual_km',km,'tax_bps',p->'tax_bps','pricing_id',p->'id');
end $$;
create function public.estimate_service_fare(p_service text,p_minutes integer,p_km double precision default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pricing_rules; q jsonb; m integer;
begin perform private.require_user();
 if p_service is null or p_service not in ('hourly','distance','full_day') or p_minutes is null or p_minutes not between 30 and 1440 or p_km is null or p_km<0 or p_km>10000 or (p_service='distance' and p_km<=0) then raise exception 'Choose a valid service, duration (30-1440 minutes), and distance'; end if;
 select * into strict p from public.pricing_rules where effective_at<=now() order by effective_at desc,created_at desc limit 1;
 m:=case when p_service='full_day' then p.day_hours*60 else p_minutes end;
 q:=private.service_fare(to_jsonb(p),p_service,m,p_km::numeric,m);
 return q||jsonb_build_object('minutes',m,'hours',ceil(m::numeric/60),'pricing',to_jsonb(p)||'{"fare_model":"demo_v2"}'::jsonb,'policy','Cash only. GST is shown separately. Hourly overtime uses 15-minute blocks after the grace period; full-day overtime uses 30-minute blocks after 10 minutes. Distance is entered by the driver and shown on the receipt.');
end $$;
create function public.create_service_booking(p_request_key uuid,p_address text,p_lat double precision,p_lng double precision,p_service text,p_minutes integer,p_scheduled_at timestamptz,p_km double precision default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); q jsonb; b jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select to_jsonb(x)-'pickup' into b from public.bookings x where customer_id=u and request_key=p_request_key;
 if found then return b; end if;
 q:=public.estimate_service_fare(p_service,p_minutes,p_km);
 b:=public.create_booking(p_request_key,p_address,p_lat,p_lng,case when p_service='distance' then 'hourly' else p_service end,(q->>'hours')::integer,p_scheduled_at);
 update public.bookings set service_type=p_service,requested_minutes=(q->>'minutes')::integer,estimated_km=p_km,pricing_snapshot=q->'pricing',estimate_paise=(q->>'total_paise')::bigint where id=(b->>'id')::uuid;
 return public.booking_details((b->>'id')::uuid);
end $$;
create function public.start_trip(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings;
begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.driver_id is distinct from u or b.state<>'OTP_VERIFIED' then raise exception 'Assigned driver and verified pickup code required'; end if;
 if not private.driver_eligible(u) then raise exception 'Driver is no longer eligible'; end if;
 if not exists(select 1 from public.booking_otp_records where booking_id=p_booking and used_at is not null and used_at>now()-interval '15 minutes') then raise exception 'Verification expired. Contact support.'; end if;
 update public.bookings set state='IN_PROGRESS',started_at=now() where id=p_booking;
 update public.driver_profiles set online=false where user_id=u;
 delete from public.driver_locations where driver_id=u;
end $$;
create function public.finish_service_trip(p_booking uuid,p_km double precision default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings; f jsonb; minutes integer;
begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.driver_id is distinct from u then raise exception 'Assigned driver required'; end if;
 if b.state='COMPLETED' then return public.booking_details(p_booking); end if;
 if b.state<>'IN_PROGRESS' then raise exception 'Trip must be in progress'; end if;
 if b.pricing_snapshot->>'fare_model' is distinct from 'demo_v2' then return public.complete_trip(p_booking); end if;
 if b.service_type='distance' and (p_km is null or p_km<=0 or p_km>10000) then raise exception 'Enter the completed trip distance (0-10000 km)'; end if;
 minutes:=greatest(1,ceil(extract(epoch from(now()-b.started_at))/60));
 f:=private.service_fare(b.pricing_snapshot,b.service_type,minutes,coalesce(p_km,0)::numeric,b.requested_minutes);
 update public.bookings set state='COMPLETED',ended_at=now(),actual_km=p_km,final_paise=(f->>'total_paise')::bigint,commission_paise=(f->>'commission_paise')::bigint,earnings_paise=(f->>'earnings_paise')::bigint where id=p_booking;
 insert into public.fare_breakdowns values(p_booking,'INR',(f->>'total_paise')::bigint,(f->>'commission_paise')::bigint,(f->>'earnings_paise')::bigint,(f->>'billed_minutes')::integer,f);
 insert into public.financial_ledger_entries(booking_id,driver_id,entry_type,amount_paise) values(p_booking,u,'driver_earnings',(f->>'earnings_paise')::bigint),(p_booking,u,'commission_due',(f->>'commission_paise')::bigint),(p_booking,u,'tax_collected',(f->>'tax_paise')::bigint);
 update public.driver_profiles set online=false where user_id=u; delete from public.driver_locations where driver_id=u;
 return public.booking_details(p_booking);
end $$;
create function public.decline_request(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if not exists(select 1 from jsonb_array_elements(public.nearby_requests()) x where x->>'id'=p_booking::text) then raise exception 'Request is not available'; end if;
 insert into private.declined_requests values(u,p_booking) on conflict do nothing;
end $$;
create function public.admin_publish_pricing(p_base bigint,p_hourly bigint,p_minimum bigint,p_day bigint,p_commission integer,p_per_km bigint,p_grace integer,p_tax integer,p_day_hours integer default 10) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_permission('settings.manage');
 if p_base is null or p_hourly is null or p_day is null or p_minimum is null or p_per_km is null or least(p_base,p_hourly,p_minimum,p_day,p_per_km)<0 or greatest(p_base,p_hourly,p_minimum,p_day,p_per_km)>100000000 or p_commission not between 0 and 5000 or p_tax not between 0 and 5000 or p_grace not between 0 and 60 or p_day_hours not between 1 and 24 then raise exception 'Invalid pricing: commission/tax 0-50 percent, grace 0-60 min'; end if;
 insert into public.pricing_rules(base_paise,hourly_paise,minimum_paise,day_paise,commission_bps,created_by,per_km_paise,grace_minutes,tax_bps,day_hours) values(p_base,p_hourly,p_minimum,p_day,p_commission,auth.uid(),p_per_km,p_grace,p_tax,p_day_hours);
 insert into public.audit_logs(actor_id,action) values(auth.uid(),'pricing.version.create');
end $$;
create function public.admin_record_commission(p_driver uuid,p_amount bigint,p_reference text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); due bigint; received bigint; existing public.commission_receipts; receipt uuid;
begin
 perform private.require_permission('finance.manage');
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text,1));
 select * into existing from public.commission_receipts where reference=p_reference;
 if found then
  if existing.driver_id=p_driver and existing.amount_paise=p_amount then return existing.id; end if;
  raise exception 'Reference already used for a different receipt';
 end if;
 select coalesce(sum(l.amount_paise),0) into due from public.financial_ledger_entries l join public.bookings b on b.id=l.booking_id where l.driver_id=p_driver and l.entry_type='commission_due' and b.payment_status='settled';
 select coalesce(sum(amount_paise),0) into received from public.commission_receipts where driver_id=p_driver;
 if p_amount is null or p_amount<=0 or p_amount>due-received then raise exception 'Amount must not exceed outstanding commission on settled cash trips'; end if;
 insert into public.commission_receipts(driver_id,amount_paise,reference,recorded_by) values(p_driver,p_amount,trim(p_reference),u) returning id into receipt;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'commission.received',p_driver::text,p_reference);
 return receipt;
end $$;
-- Real positions only, with the pickup-only privacy boundary preserved.
create function public.admin_live_locations() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_permission('bookings.manage');
 return (select coalesce(jsonb_agg(jsonb_build_object('id',l.driver_id,'name',u.full_name,'lat',extensions.st_y(l.point::extensions.geometry),'lng',extensions.st_x(l.point::extensions.geometry),'updated_at',l.updated_at)),'[]') from public.driver_locations l join public.driver_profiles d on d.user_id=l.driver_id join public.users u on u.id=l.driver_id where d.online and u.status='active' and l.updated_at>now()-interval '5 minutes' and not exists(select 1 from public.bookings b where b.driver_id=l.driver_id and b.state in ('OTP_VERIFIED','IN_PROGRESS')));
end $$;
create or replace function public.driver_wallet() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not exists(select 1 from public.driver_profiles where user_id=u) then raise exception 'Driver account required'; end if;
 return jsonb_build_object('earnings_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where driver_id=u and entry_type='driver_earnings'),'commission_due_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where driver_id=u and entry_type='commission_due')-(select coalesce(sum(amount_paise),0) from public.commission_receipts where driver_id=u),'commission_received_paise',(select coalesce(sum(amount_paise),0) from public.commission_receipts where driver_id=u),'cash_collected_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where driver_id=u and entry_type='cash_collected'),'currency','INR','payouts_enabled',false);
end $$;
-- Private server utilities: never expose these via the public HTTP action router.
create table private.api_limits(key text primary key,window_start timestamptz not null,count integer not null);
create function public.api_take_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if length(p_key)>160 or p_limit not between 1 and 10000 or p_seconds not between 1 and 86400 then raise exception 'Invalid limit'; end if;
 insert into private.api_limits values(p_key,now(),1) on conflict(key) do update set count=case when private.api_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else private.api_limits.count+1 end,window_start=case when private.api_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else private.api_limits.window_start end returning count into n;
 if random()<0.01 then delete from private.api_limits where window_start<now()-interval '2 days'; end if;
 return n<=p_limit;
end $$;
create function public.api_email_exists(p_email text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.users where lower(email)=lower(p_email)) $$;
revoke all on function public.api_take_rate_limit(text,integer,integer),public.api_email_exists(text) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.api_take_rate_limit(text,integer,integer),public.api_email_exists(text) to service_role; end if; end $$;
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('estimate_service_fare','create_service_booking','verify_pickup_code','start_trip','finish_service_trip','decline_request','admin_publish_pricing','admin_record_commission','admin_live_locations') loop
 execute format('revoke all on function %s from public,anon',r.signature);
 execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;

create or replace function public.nearby_requests() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result jsonb;
begin
 if not private.driver_eligible(u) then return '[]'; end if;
 -- Expired and scheduled requests are filtered using server time.
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
 select b.id,b.reference,b.pickup_address,b.service_type,b.hours,b.scheduled_at,b.estimate_paise,
 case when b.pricing_snapshot->>'fare_model'='demo_v2' then (private.service_fare(b.pricing_snapshot,b.service_type,b.requested_minutes,coalesce(b.estimated_km,0),b.requested_minutes)->>'earnings_paise')::bigint else b.estimate_paise-round(b.estimate_paise*(b.pricing_snapshot->>'commission_bps')::numeric/10000)::bigint end as estimated_earnings_paise,
 round((extensions.st_distance(b.pickup,l.point)/1000)::numeric,1) as pickup_km
 from public.bookings b join public.driver_locations l on l.driver_id=u join public.driver_profiles d on d.user_id=u cross join public.system_settings s
 where not exists(select 1 from private.declined_requests dr where dr.driver_id=u and dr.booking_id=b.id) and b.state='MATCHING' and b.request_expires_at>now() and b.scheduled_at<=now()+interval '30 minutes' and d.online and l.updated_at>now()-interval '5 minutes'
 and extensions.st_dwithin(b.pickup,l.point,s.matching_radius_km*1000) and not exists(select 1 from public.bookings busy where busy.driver_id=u and busy.state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS'))
 order by extensions.st_distance(b.pickup,l.point) limit 20) x;
 return result;
end $$;

create or replace function public.cancel_booking(p_booking uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); b public.bookings; s text;
begin select * into b from public.bookings where id=p_booking for update;
 if not found or b.state not in ('MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED') then raise exception 'Booking cannot be cancelled at this stage'; end if;
 if length(trim(p_reason))<5 or length(p_reason)>1000 then raise exception 'Please provide a cancellation reason (5–1000 characters)'; end if;
 if b.state='OTP_VERIFIED' and not public.has_permission('bookings.manage') then raise exception 'Contact support to cancel after verification'; end if;
 if u=b.customer_id then s:='CANCELLED_BY_CUSTOMER'; elsif u=b.driver_id and b.state<>'DRIVER_ARRIVED' then s:='CANCELLED_BY_DRIVER'; elsif public.has_permission('bookings.manage') then s:='CANCELLED_BY_ADMIN'; else raise exception 'Cancellation not permitted'; end if;
 update public.bookings set state=s,cancellation_reason=p_reason where id=p_booking;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'booking.cancel',p_booking::text,p_reason);
end $$;

create function public.verify_pickup_code(p_booking uuid,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 update public.bookings set state='OTP_VERIFIED' where id=p_booking;
 update public.driver_profiles set online=false where user_id=u;
 delete from public.driver_locations where driver_id=u;
 return jsonb_build_object('ok',true);
end $$;


create or replace function public.admin_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare current_actor uuid:=private.require_user(); result jsonb:='{}';
begin
 if not exists(select 1 from public.user_roles where user_id=current_actor) then raise exception 'Staff access required'; end if;
 if public.has_permission('users.manage') then result:=result||jsonb_build_object('users',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.users order by created_at desc limit 500)x)); end if;
 if public.has_permission('drivers.review') then result:=result||jsonb_build_object('drivers',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('full_name',u.full_name)),'[]') from public.driver_profiles d join public.users u on u.id=d.user_id),'documents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.driver_documents order by created_at desc limit 500)x)); end if;
 if public.has_permission('staff.manage') then result:=result||jsonb_build_object('employees',(select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('roles',(select jsonb_agg(role_id) from public.user_roles where user_id=u.id))),'[]') from public.users u where kind='employee'),'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.audit_logs order by created_at desc limit 200)x)); end if;
 if public.has_permission('bookings.manage') then result:=result||jsonb_build_object('bookings',(select coalesce(jsonb_agg(to_jsonb(x)-'pickup'),'[]') from(select * from public.bookings order by created_at desc limit 500)x)); end if;
 if public.has_permission('support.manage') then result:=result||jsonb_build_object('tickets',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.support_tickets order by created_at desc limit 500)x),'emergencies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.emergency_events order by created_at desc limit 200)x)); end if;
 if public.has_permission('finance.read') then result:=result||jsonb_build_object('ledger',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.financial_ledger_entries order by created_at desc limit 1000)x),'financial',jsonb_build_object('gross_paise',(select coalesce(sum(final_paise),0) from public.bookings where state='COMPLETED'),'cash_with_drivers_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where entry_type='cash_collected'),'commission_due_paise',(select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where entry_type='commission_due'),'platform_cash_collected_paise',0)); end if;
 if public.has_permission('reports.read') or public.has_permission('bookings.manage') then result:=result||jsonb_build_object('counts',(select jsonb_object_agg(state,n) from(select state,count(*) n from public.bookings group by state)x)); end if;
 return result;
end $$;
alter function public.admin_overview() set schema private;
create function public.admin_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; received bigint;
begin
 result:=private.admin_overview();
 if public.has_permission('finance.read') then
  select coalesce(sum(amount_paise),0) into received from public.commission_receipts;
  result:=jsonb_set(result,'{financial,commission_due_paise}',to_jsonb(coalesce((result#>>'{financial,commission_due_paise}')::bigint,0)-received));
  result:=jsonb_set(result,'{financial,commission_received_paise}',to_jsonb(received));
  result:=jsonb_set(result,'{financial,driver_earnings_paise}',to_jsonb((select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where entry_type='driver_earnings')));
  result:=jsonb_set(result,'{financial,tax_collected_paise}',to_jsonb((select coalesce(sum(amount_paise),0) from public.financial_ledger_entries where entry_type='tax_collected')));
  result:=result||jsonb_build_object('commission_receipts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.commission_receipts order by created_at desc limit 500)x));
 end if;
 return result;
end $$;
revoke all on function public.admin_overview(),public.verify_pickup_code(uuid,text) from public,anon;
grant execute on function public.admin_overview(),public.verify_pickup_code(uuid,text) to authenticated;
-- Route legacy completion calls through the canonical fare for new bookings too.
alter function public.complete_trip(uuid) set schema private;
create function public.complete_trip(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.bookings where id=p_booking and pricing_snapshot->>'fare_model'='demo_v2') then return public.finish_service_trip(p_booking,null); end if;
 return private.complete_trip(p_booking);
end $$;
revoke all on function public.complete_trip(uuid) from public,anon;
grant execute on function public.complete_trip(uuid) to authenticated;

create or replace function public.admin_provision_user(p_user uuid,p_name text,p_kind text,p_role text default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if p_kind='driver' then perform private.require_permission('users.manage');
 elsif p_kind='employee' then perform private.require_permission('staff.manage');
 else raise exception 'Only driver or employee accounts can be provisioned'; end if;
 if p_user=u or not exists(select 1 from public.users where id=p_user and kind='customer' and created_at>now()-interval '10 minutes') or exists(select 1 from public.bookings where customer_id=p_user) then raise exception 'Only newly created unused accounts can be provisioned'; end if;
 if p_name is null or length(trim(p_name))<2 or length(p_name)>100 then raise exception 'Full name required'; end if;
 perform 1 from public.users where id=p_user for update;
 update public.users set kind=p_kind,full_name=trim(p_name) where id=p_user;
 delete from public.customer_profiles where user_id=p_user;
 if p_kind='driver' then insert into public.driver_profiles(user_id) values(p_user);
 else
 if exists(select 1 from public.role_permissions rp where rp.role_id=p_role and not public.has_permission(rp.permission_id)) then raise exception 'Cannot grant permissions you do not hold'; end if;
 if not exists(select 1 from public.roles where id=p_role) then raise exception 'Valid employee role required'; end if;
 insert into public.employee_profiles values(p_user,u);
 insert into public.user_roles values(p_user,p_role);
 end if;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'account.provision',p_user::text,p_kind||coalesce(' / '||p_role,''));
end $$;

create or replace function public.admin_set_role(p_user uuid,p_role text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin perform private.require_permission('staff.manage');
 if exists(select 1 from public.role_permissions rp where rp.role_id=p_role and not public.has_permission(rp.permission_id)) then raise exception 'Cannot grant permissions you do not hold'; end if;
 if p_user=u then raise exception 'You cannot change your own permissions'; end if;
 if length(trim(p_reason))<5 then raise exception 'A reason is required'; end if;
 if not exists(select 1 from public.users where id=p_user and kind='employee') then raise exception 'Employee account required'; end if;
 if not exists(select 1 from public.roles where id=p_role) then raise exception 'Unknown role'; end if;
 perform 1 from public.users where id=p_user for update;
 delete from public.user_roles where user_id=p_user;
 insert into public.user_roles values(p_user,p_role);
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'employee.role.'||p_role,p_user::text,p_reason);
end $$;

create or replace function public.admin_role_permissions(p_role text,p_permissions text[],p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); p text;
begin perform private.require_permission('staff.manage');
 if p_role='super_admin' or exists(select 1 from public.user_roles where user_id=u and role_id=p_role) then raise exception 'Cannot edit Super Admin or your own role permissions'; end if;
 if p_reason is null or length(trim(p_reason))<5 or not exists(select 1 from public.roles where id=p_role) then raise exception 'A valid role and change reason are required'; end if;
 if p_permissions is null or cardinality(p_permissions)>16 then raise exception 'Invalid permissions'; end if;
 if exists(select 1 from unnest(p_permissions) requested(id) where not public.has_permission(requested.id)) then raise exception 'Cannot grant permissions you do not hold'; end if;
 perform 1 from public.roles where id=p_role for update;
 delete from public.role_permissions where role_id=p_role;
 foreach p in array p_permissions loop insert into public.role_permissions values(p_role,p); end loop;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(u,'role.permissions.update',p_role,p_reason);
end $$;
commit;

-- Installs a service-only fixture helper. Does NOT insert demo users by itself.
begin;
create function public.api_seed_demo(p_admin uuid,p_driver uuid,p_customer uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; p public.pricing_rules; f jsonb;
begin
 if p_admin=p_driver or p_driver=p_customer or p_admin=p_customer then raise exception 'Use three separate demo identities'; end if;
 if (select count(*) from auth.users where id in(p_admin,p_driver,p_customer) and raw_app_meta_data->>'hyzz_demo'='true')<>3 then raise exception 'Only dedicated identities tagged hyzz_demo by the Auth admin API may be seeded'; end if;
 perform pg_advisory_xact_lock(918273645);
 if exists(select 1 from public.bookings where id=b) then
  if not exists(select 1 from public.bookings where id=b and driver_id=p_driver and customer_id=p_customer) then raise exception 'Fixture already belongs to different demo accounts'; end if;
  return jsonb_build_object('booking',b,'already_seeded',true);
 end if;
 update public.users set full_name='Demo Admin',kind='employee' where id=p_admin;
 update public.users set full_name='Ravi K. (Demo)',kind='driver',phone='+919100000001' where id=p_driver;
 update public.users set full_name='Anita R. (Demo)',kind='customer',phone='+919000000001' where id=p_customer;
 delete from public.customer_profiles where user_id in(p_admin,p_driver);
 insert into public.employee_profiles(user_id) values(p_admin) on conflict do nothing;
 insert into public.user_roles values(p_admin,'super_admin') on conflict do nothing;
 insert into public.driver_profiles(user_id,verification,approved_by,approved_at) values(p_driver,'approved',p_admin,now()) on conflict(user_id) do nothing;
 insert into public.driver_documents(driver_id,document_type,storage_path,expires_on,status,reviewed_by)
 values(p_driver,'identity',p_driver::text||'/demo-identity.pdf',current_date+365,'approved',p_admin),(p_driver,'driving_license',p_driver::text||'/demo-license.pdf',current_date+365,'approved',p_admin) on conflict(storage_path) do nothing;
 -- Clearly fictional fixtures, not background checks or actual driver credentials.
 insert into public.pricing_rules(base_paise,hourly_paise,minimum_paise,day_paise,day_hours,commission_bps,per_km_paise,grace_minutes,tax_bps,created_by) values(5000,20000,15000,160000,10,1500,1800,5,1800,p_admin) returning * into p;
 f:=private.service_fare(to_jsonb(p),'hourly',80,0,60);
 insert into public.bookings(id,reference,customer_id,driver_id,request_key,pickup_address,pickup,scheduled_at,hours,service_type,state,pricing_snapshot,estimate_paise,final_paise,commission_paise,earnings_paise,payment_status,started_at,ended_at,assigned_at,request_expires_at,driver_cash_confirmed,customer_cash_confirmed,requested_minutes)
 values(b,'HYZ-DEMO-COMPLETED',p_customer,p_driver,gen_random_uuid(),'Railway Station (fictional test trip)',extensions.st_setsrid(extensions.st_makepoint(80.439,16.301),4326)::extensions.geography,now()-interval '1 day',1,'hourly','COMPLETED',to_jsonb(p)||'{"fare_model":"demo_v2"}',29500,(f->>'total_paise')::bigint,(f->>'commission_paise')::bigint,(f->>'earnings_paise')::bigint,'settled',now()-interval '1 day',now()-interval '1 day'+interval '80 minutes',now()-interval '1 day',now()-interval '1 day',true,true,60);
 insert into public.fare_breakdowns values(b,'INR',(f->>'total_paise')::bigint,(f->>'commission_paise')::bigint,(f->>'earnings_paise')::bigint,(f->>'billed_minutes')::integer,f);
 insert into public.financial_ledger_entries(booking_id,driver_id,entry_type,amount_paise) values(b,p_driver,'driver_earnings',(f->>'earnings_paise')::bigint),(b,p_driver,'commission_due',(f->>'commission_paise')::bigint),(b,p_driver,'cash_collected',(f->>'total_paise')::bigint),(b,p_driver,'tax_collected',(f->>'tax_paise')::bigint);
 insert into public.ratings(booking_id,author_id,score,review) values(b,p_customer,5,'Fictional demo review for testing only');
 insert into public.audit_logs(actor_id,action,target_id,reason) values(p_admin,'demo.seed',b::text,'Fictional test-only accounts, documents, completed trip and ledger; no actual money received');
 return jsonb_build_object('booking',b,'already_seeded',false);
end $$;
revoke all on function public.api_seed_demo(uuid,uuid,uuid) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.api_seed_demo(uuid,uuid,uuid) to service_role; end if; end $$;
commit;

-- Additive upgrade after 001-005. Real trip tracking, driver onboarding and optional cars.
begin;
alter table public.driver_profiles add column experience_years integer not null default 0 check(experience_years between 0 and 60);
alter table public.driver_profiles add column languages text[] not null default '{}';
alter table public.driver_documents drop constraint driver_documents_document_type_check;
alter table public.driver_documents add constraint driver_documents_document_type_check check(document_type in ('driving_license','identity','insurance','police_verification','profile_photo'));
create or replace function private.driver_eligible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users u join public.driver_profiles d on d.user_id=u.id where u.id=p_id and u.status='active' and d.verification='approved')
 and not exists(select 1 from (values('driving_license'),('identity'),('insurance'),('police_verification')) required(kind) where not exists(select 1 from public.driver_documents dd where dd.driver_id=p_id and dd.document_type=required.kind and dd.status='approved' and dd.expires_on>=current_date))
$$;
update public.driver_profiles set verification='pending',online=false where not private.driver_eligible(user_id);
create function public.register_driver(p_name text,p_phone text default null,p_experience integer default 0,p_languages text[] default '{}') returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); account public.users;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into account from public.users where id=u for update;
 if account.kind not in ('customer','driver') or exists(select 1 from public.user_roles where user_id=u) then raise exception 'Staff accounts cannot register as drivers'; end if;
 if account.kind='customer' and exists(select 1 from public.bookings where customer_id=u) then raise exception 'Use a separate email for a driver account with existing customer trips'; end if;
 if p_experience is null or p_experience not between 0 and 60 or cardinality(p_languages)>10 then raise exception 'Check experience and languages'; end if;
 perform public.update_my_profile(p_name,p_phone);
 update public.users set kind='driver' where id=u;
 delete from public.customer_profiles where user_id=u;
 insert into public.driver_profiles(user_id,experience_years,languages) values(u,p_experience,p_languages) on conflict(user_id) do update set experience_years=excluded.experience_years,languages=excluded.languages;
 insert into public.audit_logs(actor_id,action,target_id) values(u,'driver.self_registration',u::text);
end $$;
create or replace function public.admin_approve_driver(p_driver uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_permission('drivers.review');
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'A review reason is required'; end if;
 if not exists(select 1 from public.driver_profiles where user_id=p_driver) then raise exception 'Driver not found'; end if;
 if exists(select 1 from (values('driving_license'),('identity'),('insurance'),('police_verification')) required(kind) where not exists(select 1 from public.driver_documents where driver_id=p_driver and document_type=required.kind and status='approved' and expires_on>=current_date)) then raise exception 'Approve valid license, identity, insurance and police verification first'; end if;
 update public.driver_profiles set verification='approved',approved_by=auth.uid(),approved_at=now() where user_id=p_driver;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'driver.approved',p_driver::text,p_reason);
 insert into public.notification_records(user_id,title) values(p_driver,'Your driver documents are approved. You can go online.');
end $$;

create table public.customer_vehicles(id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.users,brand text not null,model text not null,registration text not null,year integer not null check(year between 1980 and 2100),color text not null default '',created_at timestamptz not null default now(),unique(customer_id,registration));
create table public.vehicle_documents(id uuid primary key default gen_random_uuid(),vehicle_id uuid not null references public.customer_vehicles,customer_id uuid not null references public.users,document_type text not null check(document_type in ('registration','insurance','puc','photo')),storage_path text not null unique,expires_on date,status text not null default 'submitted' check(status in ('submitted','approved','rejected')),review_note text,created_at timestamptz not null default now());
create table public.saved_places(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users,label text not null,address text not null,lat double precision not null check(lat between -90 and 90),lng double precision not null check(lng between -180 and 180),created_at timestamptz not null default now(),unique(user_id,label));
alter table public.bookings add column destination_address text;
alter table public.bookings add column destination_lat double precision check(destination_lat between -90 and 90);
alter table public.bookings add column destination_lng double precision check(destination_lng between -180 and 180);
alter table public.bookings add column vehicle_id uuid references public.customer_vehicles;
alter table public.bookings add column driver_preference text not null default 'professional' check(driver_preference in ('professional','premium','lady'));
alter table public.driver_profiles add column service_tags text[] not null default '{professional}';
alter table public.service_areas add column lat double precision check(lat between -90 and 90);
alter table public.service_areas add column lng double precision check(lng between -180 and 180);
alter table public.service_areas add column radius_km integer not null default 20 check(radius_km between 1 and 100);
-- Old areas without coordinates remain informational, not geofences.
create function public.my_vehicles() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin return (select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.vehicle_documents d where d.vehicle_id=v.id))),'[]') from public.customer_vehicles v where customer_id=u);end $$;
create function public.save_vehicle(p_brand text,p_model text,p_registration text,p_year integer,p_color text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); result uuid;
begin
 if not exists(select 1 from public.users where id=u and kind='customer') then raise exception 'Customer account required'; end if;
 if p_brand is null or p_model is null or p_registration is null or length(trim(p_brand)) not between 2 and 80 or length(trim(p_model)) not between 1 and 80 or length(trim(p_registration)) not between 4 and 30 then raise exception 'Enter brand, model and registration'; end if;
 insert into public.customer_vehicles(customer_id,brand,model,registration,year,color) values(u,trim(p_brand),trim(p_model),upper(trim(p_registration)),p_year,p_color) on conflict(customer_id,registration) do update set brand=excluded.brand,model=excluded.model,year=excluded.year,color=excluded.color returning id into result;
 return result;
end $$;
create function public.register_vehicle_document(p_vehicle uuid,p_type text,p_path text,p_expires date default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin
 if not exists(select 1 from public.customer_vehicles where id=p_vehicle and customer_id=u) then raise exception 'Vehicle owner required'; end if;
 if split_part(p_path,'/',1)<>u::text or not exists(select 1 from storage.objects where bucket_id='customer-vehicles' and name=p_path) then raise exception 'Upload a private file first'; end if;
 insert into public.vehicle_documents(vehicle_id,customer_id,document_type,storage_path,expires_on) values(p_vehicle,u,p_type,p_path,p_expires);
end $$;
create function public.save_place(p_label text,p_address text,p_lat double precision,p_lng double precision) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin
 if p_label is null or length(trim(p_label)) not between 1 and 50 or p_address is null or length(p_address) not between 2 and 500 then raise exception 'Enter a label and address'; end if;
 insert into public.saved_places(user_id,label,address,lat,lng) values(u,trim(p_label),p_address,p_lat,p_lng) on conflict(user_id,label) do update set address=excluded.address,lat=excluded.lat,lng=excluded.lng;
end $$;
create function public.my_places() returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=private.require_user();begin return (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.saved_places p where user_id=u);end $$;
create function public.admin_vehicle_document(p_document uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('users.manage');if p_status not in ('approved','rejected') or p_reason is null or length(trim(p_reason))<5 then raise exception 'Decision and reason required';end if;
 update public.vehicle_documents set status=p_status,review_note=p_reason where id=p_document;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'vehicle.document.'||p_status,p_document::text,p_reason);end $$;
create function public.admin_service_zone(p_name text,p_lat double precision,p_lng double precision,p_radius integer,p_enabled boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin perform private.require_permission('settings.manage');if p_name is null or length(trim(p_name)) not between 2 and 100 then raise exception 'Zone name required';end if;
 select id into result from public.service_areas where name=trim(p_name) limit 1;
 if result is null then insert into public.service_areas(name,lat,lng,radius_km,enabled) values(trim(p_name),p_lat,p_lng,p_radius,p_enabled) returning id into result;
 else update public.service_areas set lat=p_lat,lng=p_lng,radius_km=p_radius,enabled=p_enabled where id=result;end if;
 insert into public.audit_logs(actor_id,action,target_id) values(auth.uid(),'service_zone.update',result::text);return result;end $$;
create function public.admin_driver_tags(p_driver uuid,p_tags text[],p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('drivers.review');if p_tags is null or cardinality(p_tags)<1 or cardinality(p_tags)>3 or not p_tags<@array['professional','premium','lady']::text[] or p_reason is null or length(trim(p_reason))<5 then raise exception 'Valid service tags and reason required';end if;
 update public.driver_profiles set service_tags=p_tags where user_id=p_driver;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'driver.service_tags',p_driver::text,p_reason);end $$;

-- Latest point only. No public table, permanent trace, or client-selectable observer.
create table private.trip_locations(booking_id uuid primary key references public.bookings,driver_id uuid not null references public.driver_profiles,lat double precision not null,lng double precision not null,accuracy double precision,heading double precision,speed double precision,recorded_at timestamptz not null,updated_at timestamptz not null default now());
create function public.update_trip_location(p_booking uuid,p_lat double precision,p_lng double precision,p_recorded_at timestamptz,p_accuracy double precision default null,p_heading double precision default null,p_speed double precision default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();b public.bookings;
begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.driver_id is distinct from u or b.state not in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS') then raise exception 'Tracking is not active for this assigned driver';end if;
 if not private.driver_eligible(u) then raise exception 'Driver is no longer eligible for tracking';end if;
 if p_lat is null or p_lng is null or p_recorded_at is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_recorded_at>now()+interval '2 minutes' or p_recorded_at<now()-interval '5 minutes' or (p_accuracy is not null and p_accuracy not between 0 and 10000) or (p_heading is not null and p_heading not between 0 and 360) or (p_speed is not null and p_speed not between 0 and 150) then raise exception 'Invalid or stale location';end if;
 perform private.limit_action('tracking',240,60);
 insert into private.trip_locations values(p_booking,u,p_lat,p_lng,p_accuracy,p_heading,p_speed,p_recorded_at,now()) on conflict(booking_id) do update set lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,heading=excluded.heading,speed=excluded.speed,recorded_at=excluded.recorded_at,updated_at=now() where excluded.recorded_at>private.trip_locations.recorded_at;
end $$;
create function public.trip_tracking(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();b public.bookings;result jsonb;
begin
 select * into b from public.bookings where id=p_booking;
 if not found or not(u=b.customer_id or coalesce(u=b.driver_id,false) or public.has_permission('bookings.manage')) then raise exception 'Booking participant or operations permission required';end if;
 if b.state not in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS') then return null;end if;
 select to_jsonb(l)||jsonb_build_object('stale',l.updated_at<now()-interval '45 seconds') into result from private.trip_locations l where booking_id=p_booking;
 return result;
end $$;
create function private.stop_trip_tracking() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.driver_id is distinct from old.driver_id or new.state not in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS') then delete from private.trip_locations where booking_id=new.id;end if;return new;end $$;
create trigger stop_trip_tracking after update of state,driver_id on public.bookings for each row execute function private.stop_trip_tracking();
create or replace function public.admin_live_locations() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('bookings.manage');return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
 select l.driver_id id,u.full_name name,l.lat,l.lng,l.updated_at,l.booking_id,b.state,l.updated_at<now()-interval '45 seconds' stale from private.trip_locations l join public.users u on u.id=l.driver_id join public.bookings b on b.id=l.booking_id where u.status='active' and b.state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS')
 union all select l.driver_id,u.full_name,extensions.st_y(l.point::extensions.geometry),extensions.st_x(l.point::extensions.geometry),l.updated_at,null,'AVAILABLE',l.updated_at<now()-interval '45 seconds' from public.driver_locations l join public.driver_profiles d on d.user_id=l.driver_id join public.users u on u.id=l.driver_id where d.online and u.status='active' and l.updated_at>now()-interval '5 minutes' and not exists(select 1 from private.trip_locations t where t.driver_id=l.driver_id)
 )x);end $$;
alter function public.booking_details(uuid) set schema private;
create function public.booking_details(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; b public.bookings;
begin base:=private.booking_details(p_booking);select * into b from public.bookings where id=p_booking;
 if not(auth.uid()=b.customer_id or coalesce(auth.uid()=b.driver_id,false) or public.has_permission('bookings.manage')) then return base;end if;
 return base||jsonb_build_object('vehicle',(select to_jsonb(v) from public.customer_vehicles v where id=b.vehicle_id),'driver_phone',(select phone from public.users where id=b.driver_id),'customer_phone',(select phone from public.users where id=b.customer_id),'driver_profile',(select to_jsonb(d)-'approved_by' from public.driver_profiles d where user_id=b.driver_id),'driver_rating',(select round(avg(r.score),1) from public.ratings r join public.bookings rb on rb.id=r.booking_id where rb.driver_id=b.driver_id and r.author_id=rb.customer_id));end $$;

-- Optional vehicle data never blocks booking. Driver service tags are staff-controlled.
alter function public.create_service_booking(uuid,text,double precision,double precision,text,integer,timestamptz,double precision) set schema private;
create function public.create_service_booking(p_request_key uuid,p_address text,p_lat double precision,p_lng double precision,p_service text,p_minutes integer,p_scheduled_at timestamptz,p_km double precision default 0,p_destination text default null,p_dest_lat double precision default null,p_dest_lng double precision default null,p_vehicle uuid default null,p_preference text default 'professional') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if p_preference not in ('professional','premium','lady') then raise exception 'Choose a valid driver type';end if;
 if p_vehicle is not null and not exists(select 1 from public.customer_vehicles where id=p_vehicle and customer_id=u) then raise exception 'Vehicle owner required';end if;
 if exists(select 1 from public.service_areas where enabled and lat is not null and lng is not null) and not exists(select 1 from public.service_areas z where enabled and lat is not null and lng is not null and extensions.st_dwithin(extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,extensions.st_setsrid(extensions.st_makepoint(z.lng,z.lat),4326)::extensions.geography,z.radius_km*1000)) then raise exception 'Pickup is outside the current service zones';end if;
 if exists(select 1 from public.bookings where customer_id=u and request_key=p_request_key) then return public.booking_details((select id from public.bookings where customer_id=u and request_key=p_request_key));end if;
 result:=private.create_service_booking(p_request_key,p_address,p_lat,p_lng,p_service,p_minutes,p_scheduled_at,p_km);
 update public.bookings set destination_address=p_destination,destination_lat=p_dest_lat,destination_lng=p_dest_lng,vehicle_id=p_vehicle,driver_preference=p_preference where id=(result->>'id')::uuid;
 return public.booking_details((result->>'id')::uuid);
end $$;
alter function public.nearby_requests() set schema private;
create function public.nearby_requests() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();tags text[];
begin if (select maintenance from public.system_settings) then return '[]';end if;select service_tags into tags from public.driver_profiles where user_id=u;
 return (select coalesce(jsonb_agg(x.value||jsonb_build_object('destination_address',b.destination_address,'destination_lat',b.destination_lat,'destination_lng',b.destination_lng,'pickup_lat',extensions.st_y(b.pickup::extensions.geometry),'pickup_lng',extensions.st_x(b.pickup::extensions.geometry))),'[]') from jsonb_array_elements(private.nearby_requests())x join public.bookings b on b.id=(x.value->>'id')::uuid where b.driver_preference=any(tags));end $$;
alter function public.set_availability(boolean,double precision,double precision) set schema private;
create function public.set_availability(p_online boolean,p_lat double precision default null,p_lng double precision default null) returns void language plpgsql security definer set search_path='' as $$
begin if p_online and (select maintenance from public.system_settings) then raise exception 'New driver availability is paused for maintenance';end if;perform private.set_availability(p_online,p_lat,p_lng);end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('customer-vehicles','customer-vehicles',false,4194304,array['application/pdf','image/jpeg','image/png']);
create policy vehicle_storage_insert on storage.objects for insert to authenticated with check(bucket_id='customer-vehicles' and private.active_user() and (storage.foldername(name))[1]=auth.uid()::text);
create policy vehicle_storage_read on storage.objects for select to authenticated using(bucket_id='customer-vehicles' and private.active_user() and ((storage.foldername(name))[1]=auth.uid()::text or public.has_permission('users.manage')));
do $$declare t text;begin foreach t in array array['customer_vehicles','vehicle_documents','saved_places'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy own_vehicles on public.customer_vehicles for select to authenticated using(private.active_user() and (customer_id=auth.uid() or public.has_permission('users.manage')));
create policy own_vehicle_docs on public.vehicle_documents for select to authenticated using(private.active_user() and (customer_id=auth.uid() or public.has_permission('users.manage')));
create policy own_places on public.saved_places for select to authenticated using(private.active_user() and user_id=auth.uid());
grant select on public.service_areas to authenticated;
create policy zones_read on public.service_areas for select to authenticated using(private.active_user());
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('register_driver','admin_approve_driver','my_vehicles','save_vehicle','register_vehicle_document','save_place','my_places','admin_vehicle_document','admin_service_zone','admin_driver_tags','update_trip_location','trip_tracking','admin_live_locations','booking_details','create_service_booking','nearby_requests','set_availability') loop execute format('revoke all on function %s from public,anon',r.signature);execute format('grant execute on function %s to authenticated',r.signature);end loop;end $$;
commit;

-- Durable, service-only push outbox. No Firebase/Expo credentials are stored in SQL.
begin;
create table private.push_devices(token text primary key,user_id uuid not null references public.users,audience text not null check(audience in ('driver','customer')),enabled boolean not null default true,updated_at timestamptz not null default now());
create table private.push_outbox(id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notification_records,token text not null references private.push_devices,title text not null,booking_id uuid,state text not null default 'queued' check(state in ('queued','sending','submitted','sent','failed')),attempts integer not null default 0,ticket text,next_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(notification_id,token));
create table private.offer_notices(booking_id uuid references public.bookings,driver_id uuid references public.driver_profiles,primary key(booking_id,driver_id));
create function public.register_push_device(p_token text,p_audience text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin
 if p_token is null or p_token!~'^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(p_token)>250 or not exists(select 1 from public.users where id=u and kind=p_audience and kind in ('driver','customer')) then raise exception 'Valid device token and matching audience required';end if;
 insert into private.push_devices(token,user_id,audience) values(p_token,u,p_audience) on conflict(token) do update set user_id=u,audience=p_audience,enabled=true,updated_at=now();end $$;
create function public.unregister_push_device(p_token text) returns void language plpgsql security definer set search_path='' as $$begin perform private.require_user();update private.push_devices set enabled=false where token=p_token and user_id=auth.uid();end $$;
create function private.queue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.customer_profiles where user_id=new.user_id and not notification_enabled) then
 insert into private.push_outbox(notification_id,token,title,booking_id) select new.id,d.token,new.title,new.booking_id from private.push_devices d join public.users u on u.id=d.user_id where d.user_id=new.user_id and d.enabled and u.status='active' on conflict do nothing;
 end if;return new;
end $$;
create trigger queue_push after insert on public.notification_records for each row execute function private.queue_push();
create function public.api_offer_scan() returns integer language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;
begin
 if (select maintenance from public.system_settings) then return 0;end if;
 for r in select b.id booking,d.user_id driver from public.bookings b cross join public.driver_profiles d join public.driver_locations l on l.driver_id=d.user_id cross join public.system_settings s where b.state='MATCHING' and b.scheduled_at<=now()+interval '30 minutes' and b.request_expires_at>now() and d.online and b.driver_preference=any(d.service_tags) and private.driver_eligible(d.user_id) and l.updated_at>now()-interval '5 minutes' and extensions.st_dwithin(b.pickup,l.point,s.matching_radius_km*1000) and not exists(select 1 from private.declined_requests dr where dr.booking_id=b.id and dr.driver_id=d.user_id) and not exists(select 1 from private.offer_notices o where o.booking_id=b.id and o.driver_id=d.user_id) and not exists(select 1 from public.bookings busy where busy.driver_id=d.user_id and busy.state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS')) limit 200
 loop
  insert into private.offer_notices values(r.booking,r.driver) on conflict do nothing;
  if found then insert into public.notification_records(user_id,booking_id,title) values(r.driver,r.booking,'A new nearby driver request is available.');n:=n+1;end if;
 end loop;return n;
end $$;
create function public.api_push_claim(p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update private.push_outbox o set state='failed',updated_at=now() where state in ('queued','sending') and (attempts>=5 or not exists(select 1 from private.push_devices d join public.users u on u.id=d.user_id where d.token=o.token and d.enabled and u.status='active'));
 with picked as(select id from private.push_outbox where ((state='queued' and next_at<=now()) or (state='sending' and updated_at<now()-interval '2 minutes')) and attempts<5 order by next_at for update skip locked limit least(greatest(p_limit,1),100)),updated as(update private.push_outbox o set state='sending',attempts=attempts+1,updated_at=now() from picked where o.id=picked.id returning o.*)
 select coalesce(jsonb_agg(to_jsonb(u)),'[]') into result from updated u join private.push_devices d on d.token=u.token join public.users a on a.id=d.user_id where d.enabled and a.status='active';return result;end $$;
create function public.api_push_result(p_id uuid,p_ticket text default null,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.push_outbox set state=case when p_ticket is not null then 'submitted' when p_error='DeviceNotRegistered' or attempts>=5 then 'failed' else 'queued' end,ticket=p_ticket,next_at=now()+interval '1 minute'*power(2,least(attempts,5)),updated_at=now() where id=p_id and state='sending';
 if p_error='DeviceNotRegistered' then update private.push_devices set enabled=false where token=(select token from private.push_outbox where id=p_id);end if;
end $$;
create function public.api_push_receipts() returns jsonb language sql security definer set search_path='' as $$select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,ticket from private.push_outbox where state='submitted' and updated_at<now()-interval '15 minutes' order by updated_at limit 100)x$$;
create function public.api_push_receipt(p_id uuid,p_ok boolean,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin update private.push_outbox set state=case when p_ok then 'sent' else 'failed' end,updated_at=now() where id=p_id and state='submitted';if p_error='DeviceNotRegistered' then update private.push_devices set enabled=false where token=(select token from private.push_outbox where id=p_id);end if;end $$;
create function public.admin_push_status() returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_permission('settings.manage');return jsonb_build_object('devices',(select count(*) from private.push_devices where enabled),'jobs',(select coalesce(jsonb_object_agg(state,n),'{}') from(select state,count(*) n from private.push_outbox group by state)x));end $$;
do $$declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('register_push_device','unregister_push_device','admin_push_status') loop execute format('revoke all on function %s from public,anon',r.signature);execute format('grant execute on function %s to authenticated',r.signature);end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('api_offer_scan','api_push_claim','api_push_result','api_push_receipts','api_push_receipt') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',r.signature);end if;end loop;end $$;
commit;

-- Driver storyboard workflow. Apply after migrations 001-007, once.
begin;
create table private.driver_preferences(user_id uuid primary key references public.driver_profiles,notifications boolean not null default true,language text not null default 'en' check(language in ('en','te','hi')),emergency_phone text);
create table private.driver_bank(user_id uuid primary key references public.driver_profiles,ciphertext text not null,payee_name text not null,ifsc text not null,last4 text not null,updated_at timestamptz not null default now());
create table private.driver_credits(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.driver_profiles,amount_paise bigint not null check(amount_paise>0),kind text not null check(kind in ('incentive','adjustment')),reference text not null unique,reason text not null,created_by uuid not null references public.users,created_at timestamptz not null default now());
create trigger driver_credits_immutable before update or delete on private.driver_credits for each row execute function private.immutable();
create table private.payout_requests(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.driver_profiles,request_key uuid not null,amount_paise bigint not null check(amount_paise>0),state text not null default 'pending' check(state in ('pending','approved','rejected','paid')),bank_ciphertext text not null,payee_name text not null,ifsc text not null,last4 text not null,review_note text,external_reference text unique,reviewed_by uuid references public.users,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(driver_id,request_key));
create function private.require_driver() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin if not exists(select 1 from public.users where id=u and kind='driver') then raise exception 'Driver account required';end if;return u;end $$;
create function public.driver_preferences() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_driver();begin return coalesce((select to_jsonb(p)-'user_id' from private.driver_preferences p where user_id=u),'{}')||jsonb_build_object('language',coalesce((select language from private.driver_preferences where user_id=u),'en'),'notifications',coalesce((select notifications from private.driver_preferences where user_id=u),true));end $$;
create function public.save_driver_preferences(p_notifications boolean,p_language text,p_emergency text default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_driver();begin if p_notifications is null or p_language is null or p_language not in ('en','te','hi') or (p_emergency is not null and p_emergency!~'^\+[1-9][0-9]{7,14}$') then raise exception 'Check language and emergency contact';end if;
 insert into private.driver_preferences values(u,p_notifications,p_language,p_emergency) on conflict(user_id) do update set notifications=excluded.notifications,language=excluded.language,emergency_phone=excluded.emergency_phone;
 if not p_notifications then update private.push_devices set enabled=false where user_id=u;end if;end $$;
create or replace function private.queue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.customer_profiles where user_id=new.user_id and not notification_enabled) and not exists(select 1 from private.driver_preferences where user_id=new.user_id and not notifications) then
 insert into private.push_outbox(notification_id,token,title,booking_id) select new.id,d.token,new.title,new.booking_id from private.push_devices d join public.users u on u.id=d.user_id where d.user_id=new.user_id and d.enabled and u.status='active' on conflict do nothing;
 end if;return new;end $$;
create function public.driver_requests() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_driver();return(select coalesce(jsonb_agg(x.value||jsonb_build_object('request_expires_at',b.request_expires_at,'customer_name',split_part(u.full_name,' ',1),'destination_address',b.destination_address,'destination_lat',b.destination_lat,'destination_lng',b.destination_lng)),'[]') from jsonb_array_elements(public.nearby_requests()) x(value) join public.bookings b on b.id=(x.value->>'id')::uuid join public.users u on u.id=b.customer_id);end $$;
create function public.driver_history(p_filter text default 'all',p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_driver();begin if p_filter is null or p_filter not in ('all','completed','cancelled') or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid history filter';end if;
 return(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,reference,pickup_address,destination_address,state,scheduled_at,created_at,ended_at,estimate_paise,final_paise,earnings_paise,payment_status from public.bookings where driver_id=u and (p_filter='all' or p_filter='completed' and state='COMPLETED' or p_filter='cancelled' and (state like 'CANCELLED%' or state='NO_DRIVER_AVAILABLE')) order by created_at desc limit 50 offset p_offset)x);end $$;
create function public.driver_finances() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_driver();credits bigint;reserved bigint;begin
 select coalesce(sum(amount_paise),0) into credits from private.driver_credits where driver_id=u;
 select coalesce(sum(amount_paise),0) into reserved from private.payout_requests where driver_id=u and state<>'rejected';
 return jsonb_build_object('wallet',public.driver_wallet()||jsonb_build_object('available_paise',credits-reserved,'platform_credits_paise',credits,'payouts_enabled',true),'bank',(select jsonb_build_object('payee_name',payee_name,'ifsc',ifsc,'last4',last4,'updated_at',updated_at) from private.driver_bank where user_id=u),'payouts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,amount_paise,state,last4,review_note,external_reference,created_at,updated_at from private.payout_requests where driver_id=u order by created_at desc limit 100)x),'transactions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,entry_type,amount_paise,created_at from public.financial_ledger_entries where driver_id=u union all select id,kind,amount_paise,created_at from private.driver_credits where driver_id=u order by created_at desc limit 100)x));end $$;
create function public.driver_summary(p_period text default 'today') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_driver();start_at timestamp;end_at timestamp;step interval;begin
 if p_period is null or p_period not in ('today','week','month') then raise exception 'Choose today, week or month';end if;
 end_at:=date_trunc('day',now() at time zone 'Asia/Kolkata')+interval '1 day';
 start_at:=case p_period when 'today' then end_at-interval '1 day' when 'week' then end_at-interval '7 days' else date_trunc('month',now() at time zone 'Asia/Kolkata') end;
 step:=case when p_period='today' then interval '1 hour' else interval '1 day' end;
 return jsonb_build_object('trip_earnings_paise',(select coalesce(sum(earnings_paise),0) from public.bookings where driver_id=u and state='COMPLETED' and ended_at>=start_at at time zone 'Asia/Kolkata' and ended_at<end_at at time zone 'Asia/Kolkata'),'incentives_paise',(select coalesce(sum(amount_paise),0) from private.driver_credits where driver_id=u and kind='incentive' and created_at>=start_at at time zone 'Asia/Kolkata' and created_at<end_at at time zone 'Asia/Kolkata'),'trips',(select count(*) from public.bookings where driver_id=u and state='COMPLETED' and ended_at>=start_at at time zone 'Asia/Kolkata' and ended_at<end_at at time zone 'Asia/Kolkata'),'rating',(select round(avg(r.score),1) from public.ratings r join public.bookings b on b.id=r.booking_id where b.driver_id=u and r.author_id=b.customer_id),'rating_count',(select count(*) from public.ratings r join public.bookings b on b.id=r.booking_id where b.driver_id=u and r.author_id=b.customer_id),'bars',(select jsonb_agg(jsonb_build_object('label',case when p_period='today' then to_char(t,'HH24') else to_char(t,'DD Mon') end,'amount_paise',(select coalesce(sum(earnings_paise),0) from public.bookings where driver_id=u and state='COMPLETED' and ended_at>=t at time zone 'Asia/Kolkata' and ended_at<(t+step) at time zone 'Asia/Kolkata')) order by t) from generate_series(start_at,end_at-step,step)t),'recent',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,pickup_address,destination_address,earnings_paise,ended_at,state from public.bookings where driver_id=u and state='COMPLETED' order by ended_at desc limit 5)x));end $$;
create function public.request_driver_payout(p_key uuid,p_amount bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_driver();existing private.payout_requests;bank private.driver_bank;available bigint;result uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 select * into existing from private.payout_requests where driver_id=u and request_key=p_key;if found then if existing.amount_paise<>p_amount then raise exception 'Request key already used for a different amount';end if;return existing.id;end if;
 if p_key is null or p_amount is null or p_amount<=0 then raise exception 'Enter a positive payout amount';end if;
 if (public.driver_wallet()->>'commission_due_paise')::bigint>0 then raise exception 'Settle outstanding platform commission before requesting a payout';end if;
 select * into bank from private.driver_bank where user_id=u;if not found then raise exception 'Save bank details first';end if;
 select (select coalesce(sum(amount_paise),0) from private.driver_credits where driver_id=u)-(select coalesce(sum(amount_paise),0) from private.payout_requests where driver_id=u and state<>'rejected') into available;
 if p_amount>available then raise exception 'Amount exceeds your available platform credit';end if;
 insert into private.payout_requests(driver_id,request_key,amount_paise,bank_ciphertext,payee_name,ifsc,last4) values(u,p_key,p_amount,bank.ciphertext,bank.payee_name,bank.ifsc,bank.last4) returning id into result;
 insert into public.audit_logs(actor_id,action,target_id) values(u,'payout.request',result::text);return result;end $$;
create function public.admin_credit_driver(p_driver uuid,p_amount bigint,p_kind text,p_reference text,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;existing private.driver_credits;begin perform private.require_permission('finance.manage');
 if p_amount is null or p_amount<=0 or p_kind is null or p_kind not in ('incentive','adjustment') or p_reference is null or length(trim(p_reference)) not between 5 and 100 or p_reason is null or length(trim(p_reason))<5 then raise exception 'Positive credit, kind, unique reference and reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text,1));select * into existing from private.driver_credits where reference=p_reference;
 if found then if existing.driver_id<>p_driver or existing.amount_paise<>p_amount or existing.kind<>p_kind then raise exception 'Reference already used for another credit';end if;return existing.id;end if;
 insert into private.driver_credits(driver_id,amount_paise,kind,reference,reason,created_by) values(p_driver,p_amount,p_kind,p_reference,p_reason,auth.uid()) returning id into result;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'driver.credit',result::text,p_reason);return result;end $$;
create function public.admin_driver_payouts() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_permission('finance.read');return(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select p.id,p.driver_id,u.full_name,p.amount_paise,p.state,p.payee_name,p.ifsc,p.last4,p.review_note,p.external_reference,p.created_at from private.payout_requests p join public.users u on u.id=p.driver_id order by p.created_at desc limit 200)x);end $$;
create function public.admin_review_payout(p_payout uuid,p_status text,p_reason text,p_reference text default null) returns void language plpgsql security definer set search_path='' as $$
declare p private.payout_requests;d uuid;begin perform private.require_permission('finance.manage');
 select driver_id into d from private.payout_requests where id=p_payout;perform pg_advisory_xact_lock(hashtextextended(d::text,1));select * into p from private.payout_requests where id=p_payout for update;
 if not found or auth.uid()=p.driver_id then raise exception 'Payout review denied';end if;
 if p_status is null or p_status not in ('approved','rejected','paid') or p_reason is null or length(trim(p_reason))<5 then raise exception 'Decision and review reason required';end if;
 if p.state='paid' and p_status='paid' and p.external_reference=p_reference then return;end if;
 if p.state in ('paid','rejected') or p_status='paid' and p.state<>'approved' or p_status='approved' and p.state<>'pending' then raise exception 'Invalid payout transition';end if;
 if p_status='paid' and (p_reference is null or length(trim(p_reference)) not between 5 and 100) then raise exception 'Actual external bank transfer reference required';end if;
 update private.payout_requests set state=p_status,review_note=p_reason,external_reference=case when p_status='paid' then p_reference else null end,reviewed_by=auth.uid(),updated_at=now() where id=p_payout;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'payout.'||p_status,p_payout::text,p_reason);
 insert into public.notification_records(user_id,title) values(p.driver_id,'Your payout request is '||p_status||'. Check Wallet for details.');end $$;
-- Bank account numbers are encrypted by Node, never stored in public tables or HTTP SQL actions.
create function public.api_store_driver_bank(p_driver uuid,p_ciphertext text,p_name text,p_ifsc text,p_last4 text) returns void language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.users where id=p_driver and kind='driver' and status='active') or length(p_ciphertext) not between 32 and 4000 or p_name is null or length(p_name) not between 2 and 100 or p_ifsc!~'^[A-Z]{4}0[A-Z0-9]{6}$' or p_last4!~'^[0-9]{4}$' then raise exception 'Invalid bank record';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text,1));insert into private.driver_bank values(p_driver,p_ciphertext,p_name,p_ifsc,p_last4,now()) on conflict(user_id) do update set ciphertext=excluded.ciphertext,payee_name=excluded.payee_name,ifsc=excluded.ifsc,last4=excluded.last4,updated_at=now();
 insert into public.audit_logs(actor_id,action,target_id) values(p_driver,'bank.updated',p_driver::text);end $$;
create function public.api_reveal_payout_bank(p_payout uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if not exists(select 1 from public.users u join public.user_roles ur on ur.user_id=u.id join public.role_permissions rp on rp.role_id=ur.role_id where u.id=p_actor and u.status='active' and rp.permission_id='finance.manage') then raise exception 'Finance permission required';end if;
 select jsonb_build_object('driver_id',driver_id,'ciphertext',bank_ciphertext) into result from private.payout_requests where id=p_payout;if result is null then raise exception 'Payout not found';end if;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(p_actor,'payout.bank_revealed',p_payout::text,'Finance requested payment destination');return result;end $$;
create table public.trip_messages(id bigint generated always as identity primary key,booking_id uuid not null references public.bookings,author_id uuid not null references public.users,request_key uuid not null,body text not null check(length(trim(body)) between 1 and 1000),created_at timestamptz not null default now(),unique(author_id,request_key));
alter table public.trip_messages enable row level security;
create policy trip_message_read on public.trip_messages for select to authenticated using(private.active_user() and exists(select 1 from public.bookings b where b.id=booking_id and (b.customer_id=auth.uid() or b.driver_id=auth.uid() or public.has_permission('bookings.manage'))));
create function public.trip_chat(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin if not exists(select 1 from public.bookings where id=p_booking and (customer_id=u or driver_id=u or public.has_permission('bookings.manage'))) then raise exception 'Booking participant required';end if;return(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from(select id,author_id,body,created_at from public.trip_messages where booking_id=p_booking order by id desc limit 100)x);end $$;
create function public.send_trip_message(p_booking uuid,p_key uuid,p_body text) returns bigint language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();b public.bookings;result bigint;previous public.trip_messages;target uuid;begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or not(u=b.customer_id or coalesce(u=b.driver_id,false)) then raise exception 'Booking participant required';end if;
 select * into previous from public.trip_messages where author_id=u and request_key=p_key;
 if found then if previous.booking_id<>p_booking or previous.body<>trim(p_body) then raise exception 'Message key already used';end if;return previous.id;end if;
 if b.state not in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS') then raise exception 'Messaging is available only during your assigned trip';end if;
 if p_key is null or p_body is null or length(trim(p_body)) not between 1 and 1000 then raise exception 'Enter a message up to 1000 characters';end if;
 perform private.limit_action('chat',30,60);insert into public.trip_messages(booking_id,author_id,request_key,body) values(p_booking,u,p_key,trim(p_body)) returning id into result;
 target:=case when u=b.customer_id then b.driver_id else b.customer_id end;
 insert into public.notification_records(user_id,booking_id,title) values(target,p_booking,'New message for your Hyzz trip');return result;end $$;
create function public.my_trip_rating(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();begin if not exists(select 1 from public.bookings where id=p_booking and (customer_id=u or driver_id=u)) then raise exception 'Booking participant required';end if;return(select jsonb_build_object('score',score,'review',review) from public.ratings where booking_id=p_booking and author_id=u);end $$;
revoke all on function private.require_driver() from public,anon,authenticated;
revoke all on private.driver_preferences,private.driver_bank,private.driver_credits,private.payout_requests from public,anon,authenticated;
revoke all on public.trip_messages from public,anon,authenticated;grant select on public.trip_messages to authenticated;
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('driver_preferences','save_driver_preferences','driver_requests','driver_history','driver_finances','driver_summary','request_driver_payout','admin_credit_driver','admin_driver_payouts','admin_review_payout','trip_chat','send_trip_message','my_trip_rating') loop execute format('revoke all on function %s from public,anon',r.signature);execute format('grant execute on function %s to authenticated',r.signature);end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('api_store_driver_bank','api_reveal_payout_bank') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',r.signature);end if;end loop;
end $$;
commit;

-- Apply once after 008. Content, customer provisioning, ride access and promotions.
begin;
insert into public.permissions values('content.manage'),('releases.manage') on conflict do nothing;
insert into public.role_permissions values('super_admin','content.manage'),('super_admin','releases.manage') on conflict do nothing;
create table private.site_content(key text primary key check(key~'^[a-z_]{2,40}$'),title text not null check(length(title) between 2 and 150),body text not null check(length(body)<=12000),published boolean not null default false,updated_by uuid references public.users,updated_at timestamptz not null default now());
insert into private.site_content(key,title,body,published) values
 ('welcome','Your car. Your journey. Your Hyzz driver.','Book a driver for your own car. Choose your pickup, review the estimate and follow your assigned trip.',true),
 ('customer_guide','Book in a few simple steps','Sign in with email. Choose pickup and destination. Review the estimate. Request a verified driver. Share your pickup code only when your driver arrives. Confirm cash payment after your trip.',true),
 ('driver_guide','Drive with Hyzz','Create a driver account and submit your documents. After administrator approval, go online to receive requests. Follow the pickup code and trip steps. Track your earnings and support requests in the app.',true),
 ('privacy','Privacy policy','Draft: the operator must review its privacy policy before public launch. Hyzz uses account, booking and document data to provide service. Assigned-trip location is shared with authorized participants and operations.',false),
 ('terms','Service terms','Draft: review service availability, cancellation, insurance and liability terms before public launch.',false),
 ('contact_email','Support email','',true),('contact_phone','Support phone','+917730020465',true),('contact_whatsapp','WhatsApp phone','+917730020465',true);
create table private.contact_enquiries(id uuid primary key default gen_random_uuid(),name text not null,email text not null,phone text,topic text not null,message text not null,status text not null default 'open' check(status in ('open','in_review','resolved')),note text,created_at timestamptz not null default now());
create function public.api_public_content() returns jsonb language sql security definer set search_path='' as $$ select coalesce(jsonb_agg(jsonb_build_object('key',key,'title',title,'body',body,'updated_at',updated_at) order by key),'[]') from private.site_content where published $$;
create function public.admin_content() returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_permission('content.manage');return(select coalesce(jsonb_agg(to_jsonb(c) order by key),'[]') from private.site_content c);end$$;
create function public.admin_save_content(p_key text,p_title text,p_body text,p_published boolean) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_permission('content.manage');
 if p_key is null or p_key!~'^[a-z_]{2,40}$' or p_title is null or length(trim(p_title)) not between 2 and 150 or p_body is null or length(p_body)>12000 or p_published is null then raise exception 'Check content fields';end if;
 if p_key in ('contact_phone','contact_whatsapp') and p_body<>'' and p_body!~'^\+[1-9][0-9]{7,14}$' then raise exception 'Use an international phone number';end if;
 if p_key='contact_email' and p_body<>'' and p_body!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid support email';end if;
 insert into private.site_content values(p_key,trim(p_title),p_body,p_published,auth.uid(),now()) on conflict(key) do update set title=excluded.title,body=excluded.body,published=excluded.published,updated_by=excluded.updated_by,updated_at=now();
 insert into public.audit_logs(actor_id,action,target_id) values(auth.uid(),'content.saved',p_key);end$$;
create function public.api_contact_enquiry(p_name text,p_email text,p_phone text,p_topic text,p_message text) returns uuid language plpgsql security definer set search_path='' as $$declare result uuid;begin
 if p_name is null or length(trim(p_name)) not between 2 and 100 or p_email is null or length(p_email)>254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_message is null or length(trim(p_message)) not between 10 and 2000 or p_topic not in ('customer','driver','business','support') or p_topic is null or (p_phone is not null and p_phone!~'^\+[1-9][0-9]{7,14}$') then raise exception 'Check contact details';end if;
 insert into private.contact_enquiries(name,email,phone,topic,message) values(trim(p_name),lower(p_email),p_phone,p_topic,trim(p_message)) returning id into result;return result;end$$;
create function public.admin_enquiries() returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_permission('support.manage');return(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from(select * from private.contact_enquiries order by created_at desc limit 200)c);end$$;
create function public.admin_review_enquiry(p_id uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$begin perform private.require_permission('support.manage');if p_status is null or p_status not in ('open','in_review','resolved') or p_note is null or length(trim(p_note)) not between 5 and 1000 then raise exception 'Status and review note required';end if;update private.contact_enquiries set status=p_status,note=p_note where id=p_id;if not found then raise exception 'Enquiry not found';end if;insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'enquiry.review',p_id::text,p_note);end$$;
-- A separate operational ride-access switch does not bypass document approval.
alter table public.driver_profiles add column ride_access boolean not null default true;
alter function private.driver_eligible(uuid) rename to driver_eligible_v14;
create function private.driver_eligible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select private.driver_eligible_v14(p_id) and exists(select 1 from public.driver_profiles where user_id=p_id and ride_access)$$;
create function public.admin_driver_access(p_driver uuid,p_enabled boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_permission('drivers.review');if p_enabled is null or p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'Access decision and reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text,0));
 if exists(select 1 from public.bookings where driver_id=p_driver and state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS')) then raise exception 'Finish or reassign the active trip before changing access';end if;
 update public.driver_profiles set ride_access=p_enabled,online=case when p_enabled then online else false end where user_id=p_driver;if not found then raise exception 'Driver not found';end if;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'driver.ride_access',p_driver::text,p_reason);
 insert into public.notification_records(user_id,title) values(p_driver,case when p_enabled then 'Operations enabled your ride access. Document approval is still required.' else 'Operations paused your ride access. Contact support for details.' end);end$$;
alter function public.admin_provision_user(uuid,text,text,text) rename to admin_provision_user_v14;
create function public.admin_provision_user(p_user uuid,p_name text,p_kind text,p_role text default null) returns void language plpgsql security definer set search_path='' as $$begin
 if p_role='super_admin' and not exists(select 1 from public.user_roles where user_id=auth.uid() and role_id='super_admin') then raise exception 'Only Super Admin may provision another Super Admin';end if;
 if p_kind<>'customer' then perform public.admin_provision_user_v14(p_user,p_name,p_kind,p_role);return;end if;
 perform private.require_permission('users.manage');
 if p_role is not null or p_user=auth.uid() or p_name is null or length(trim(p_name)) not between 2 and 100 or not exists(select 1 from public.users where id=p_user and kind='customer' and created_at>now()-interval '10 minutes') or exists(select 1 from public.bookings where customer_id=p_user) then raise exception 'Only newly created unused customer accounts can be provisioned';end if;
 update public.users set full_name=trim(p_name) where id=p_user;insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'account.provision',p_user::text,'customer');end$$;
revoke all on function public.admin_provision_user_v14(uuid,text,text,text) from public,anon,authenticated;
create table private.coupons(code text primary key check(code~'^[A-Z0-9]{3,24}$'),kind text not null check(kind in ('flat','percent')),value integer not null check(value>0),cap_paise bigint not null check(cap_paise>0),minimum_paise bigint not null default 0 check(minimum_paise>=0),starts_at timestamptz not null,ends_at timestamptz not null,max_uses integer not null check(max_uses>0),per_customer integer not null check(per_customer>0),enabled boolean not null default true,created_by uuid references public.users,check(ends_at>starts_at),check(kind<>'percent' or value<=100));
create table private.coupon_uses(booking_id uuid primary key references public.bookings,code text not null references private.coupons,customer_id uuid not null references public.users,created_at timestamptz not null default now());
-- Coupons are funded only from platform commission; driver earnings and tax are preserved.
alter function private.service_fare(jsonb,text,integer,numeric,integer) rename to service_fare_v14;
create function private.service_fare(p jsonb,s text,m integer,km numeric,booked integer default 60) returns jsonb language plpgsql set search_path='' as $$declare f jsonb;discount bigint:=0;c jsonb;begin
 f:=private.service_fare_v14(p,s,m,km,booked);c:=p->'coupon';
 if c is not null then discount:=least((f->>'commission_paise')::bigint,(c->>'cap_paise')::bigint,case when c->>'kind'='flat' then (c->>'value')::bigint else round((f->>'subtotal_paise')::numeric*(c->>'value')::numeric/100)::bigint end);end if;
 return f||jsonb_build_object('discount_paise',discount,'coupon_code',c->>'code','total_paise',(f->>'total_paise')::bigint-discount,'commission_paise',(f->>'commission_paise')::bigint-discount);end$$;
create function public.admin_coupons() returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_permission('finance.manage');return(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('reserved_uses',(select count(*) from private.coupon_uses u join public.bookings b on b.id=u.booking_id where u.code=c.code and b.state not like 'CANCELLED%' and b.state<>'NO_DRIVER_AVAILABLE'))),'[]') from private.coupons c);end$$;
create function public.admin_save_coupon(p_code_text text,p_kind text,p_value integer,p_cap bigint,p_minimum bigint,p_starts timestamptz,p_ends timestamptz,p_max integer,p_per_customer integer,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_permission('finance.manage');
 if p_code_text is null or p_code_text!~'^[A-Z0-9]{3,24}$' or p_kind is null or p_value is null or p_cap is null or p_minimum is null or p_starts is null or p_ends is null or p_max is null or p_per_customer is null or p_enabled is null then raise exception 'Complete all coupon fields';end if;
 insert into private.coupons values(p_code_text,p_kind,p_value,p_cap,p_minimum,p_starts,p_ends,p_max,p_per_customer,p_enabled,auth.uid()) on conflict(code) do update set kind=excluded.kind,value=excluded.value,cap_paise=excluded.cap_paise,minimum_paise=excluded.minimum_paise,starts_at=excluded.starts_at,ends_at=excluded.ends_at,max_uses=excluded.max_uses,per_customer=excluded.per_customer,enabled=excluded.enabled;
 insert into public.audit_logs(actor_id,action,target_id) values(auth.uid(),'coupon.saved',p_code_text);end$$;
alter function public.create_service_booking(uuid,text,double precision,double precision,text,integer,timestamptz,double precision,text,double precision,double precision,uuid,text) rename to create_service_booking_v14;
create function public.create_service_booking(p_request_key uuid,p_address text,p_lat double precision,p_lng double precision,p_service text,p_minutes integer,p_scheduled_at timestamptz,p_km double precision default 0,p_destination text default null,p_dest_lat double precision default null,p_dest_lng double precision default null,p_vehicle uuid default null,p_preference text default 'professional',p_coupon text default null) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;b public.bookings;c private.coupons;f jsonb;begin
 result:=public.create_service_booking_v14(p_request_key,p_address,p_lat,p_lng,p_service,p_minutes,p_scheduled_at,p_km,p_destination,p_dest_lat,p_dest_lng,p_vehicle,p_preference);
 if nullif(trim(p_coupon),'') is null then return result;end if;
 select * into b from public.bookings where id=(result->>'id')::uuid for update;
 if exists(select 1 from private.coupon_uses where booking_id=b.id) then if not exists(select 1 from private.coupon_uses where booking_id=b.id and code=upper(trim(p_coupon))) then raise exception 'Booking already uses another coupon';end if;return result;end if;
 select * into c from private.coupons where code=upper(trim(p_coupon)) for update;
 if not found or not c.enabled or now()<c.starts_at or now()>=c.ends_at or b.estimate_paise<c.minimum_paise or b.state<>'MATCHING' then raise exception 'Coupon is unavailable for this booking';end if;
 if (select count(*) from private.coupon_uses x join public.bookings y on y.id=x.booking_id where x.code=c.code and y.state not like 'CANCELLED%' and y.state<>'NO_DRIVER_AVAILABLE')>=c.max_uses or (select count(*) from private.coupon_uses x join public.bookings y on y.id=x.booking_id where x.code=c.code and x.customer_id=auth.uid() and y.state not like 'CANCELLED%' and y.state<>'NO_DRIVER_AVAILABLE')>=c.per_customer then raise exception 'Coupon usage limit reached';end if;
 update public.bookings set pricing_snapshot=pricing_snapshot||jsonb_build_object('coupon',to_jsonb(c)-'created_by') where id=b.id returning * into b;
 f:=private.service_fare(b.pricing_snapshot,b.service_type,b.requested_minutes,coalesce(b.estimated_km,0),b.requested_minutes);
 update public.bookings set estimate_paise=(f->>'total_paise')::bigint where id=b.id;
 insert into private.coupon_uses values(b.id,c.code,auth.uid(),now());return public.booking_details(b.id);end$$;
revoke all on function public.create_service_booking_v14(uuid,text,double precision,double precision,text,integer,timestamptz,double precision,text,double precision,double precision,uuid,text) from public,anon,authenticated;
create function public.admin_booking_commission(p_booking uuid,p_bps integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$declare b public.bookings;f jsonb;begin
 perform private.require_permission('finance.manage');if p_bps is null or p_bps not between 0 and 10000 or p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'Commission and audit reason required';end if;
 select * into b from public.bookings where id=p_booking for update;if not found or b.state not in ('MATCHING','NO_DRIVER_AVAILABLE') or b.driver_id is not null or b.pricing_snapshot->>'fare_model' is distinct from 'demo_v2' then raise exception 'Change commission only before driver assignment';end if;
 update public.bookings set pricing_snapshot=pricing_snapshot||jsonb_build_object('commission_bps',p_bps) where id=b.id returning * into b;
 f:=private.service_fare(b.pricing_snapshot,b.service_type,b.requested_minutes,coalesce(b.estimated_km,0),b.requested_minutes);update public.bookings set estimate_paise=(f->>'total_paise')::bigint where id=b.id;
 insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'booking.commission',b.id::text,p_reason);end$$;
create function public.admin_assignable_drivers() returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_permission('bookings.manage');return(select coalesce(jsonb_agg(jsonb_build_object('user_id',d.user_id,'full_name',u.full_name)),'[]') from public.driver_profiles d join public.users u on u.id=d.user_id where d.online and private.driver_eligible(d.user_id) and not exists(select 1 from public.bookings b where b.driver_id=d.user_id and b.state in ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS')));end$$;
alter function public.admin_assign_driver(uuid,uuid,text) rename to admin_assign_driver_v14;
revoke all on function public.admin_assign_driver_v14(uuid,uuid,text) from public,anon,authenticated;
create function public.admin_assign_driver(p_booking uuid,p_driver uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$declare b public.bookings;begin
 perform private.require_permission('bookings.manage');perform pg_advisory_xact_lock(hashtextextended(p_driver::text,0));select * into b from public.bookings where id=p_booking;
 perform public.admin_assign_driver_v14(p_booking,p_driver,p_reason);
 if b.driver_id is distinct from p_driver or b.state<>'DRIVER_ASSIGNED' then
 insert into public.notification_records(user_id,booking_id,title) values(p_driver,p_booking,'Operations assigned you a Hyzz trip. Open Bookings for the pickup details.'),(b.customer_id,p_booking,'Operations assigned a driver to your booking. Open your trip for details.');end if;end$$;
revoke all on function public.admin_assign_driver(uuid,uuid,text) from public,anon;grant execute on function public.admin_assign_driver(uuid,uuid,text) to authenticated;
alter function public.admin_overview() rename to admin_overview_v14;
revoke all on function public.admin_overview_v14() from public,anon,authenticated;
create function public.admin_overview() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 result:=public.admin_overview_v14();
 if public.has_permission('users.manage') then result:=result||jsonb_build_object('users',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select u.*,a.email from public.users u join auth.users a on a.id=u.id order by u.created_at desc limit 500)x));end if;
 if public.has_permission('drivers.review') then result:=result||jsonb_build_object('drivers',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('full_name',u.full_name,'phone',u.phone,'email',a.email)),'[]') from public.driver_profiles d join public.users u on u.id=d.user_id join auth.users a on a.id=u.id));end if;
 return result;end$$;
revoke all on function public.admin_overview() from public,anon;grant execute on function public.admin_overview() to authenticated;
create function public.admin_update_person(p_user uuid,p_name text,p_phone text,p_reason text) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_permission('users.manage');if exists(select 1 from public.users where id=p_user and kind='employee') then perform private.require_permission('staff.manage');end if;
 if p_name is null or length(trim(p_name)) not between 2 and 100 or p_reason is null or length(trim(p_reason)) not between 5 and 1000 or (p_phone is not null and p_phone!~'^\+[1-9][0-9]{7,14}$') then raise exception 'Name, international phone and audit reason required';end if;
 update public.users set full_name=trim(p_name),phone=p_phone where id=p_user;if not found then raise exception 'Account not found';end if;insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'account.details',p_user::text,p_reason);end$$;
revoke all on function public.admin_update_person(uuid,text,text,text) from public,anon;grant execute on function public.admin_update_person(uuid,text,text,text) to authenticated;
revoke all on function public.admin_assignable_drivers() from public,anon;grant execute on function public.admin_assignable_drivers() to authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_content','admin_save_content','admin_enquiries','admin_review_enquiry','admin_driver_access','admin_provision_user','admin_coupons','admin_save_coupon','create_service_booking','admin_booking_commission') loop execute format('revoke all on function %s from public,anon',r.signature);execute format('grant execute on function %s to authenticated',r.signature);end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('api_public_content','api_contact_enquiry') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',r.signature);end if;end loop;
end$$;
revoke all on function private.driver_eligible(uuid),private.driver_eligible_v14(uuid),private.service_fare(jsonb,text,integer,numeric,integer),private.service_fare_v14(jsonb,text,integer,numeric,integer) from public,anon,authenticated;
commit;

-- Apply once after 009. APK bytes upload directly to private Storage, not Vercel.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('app-releases','app-releases',false,52428800,array['application/vnd.android.package-archive','application/octet-stream']) on conflict(id) do nothing;
create table private.app_releases(id uuid primary key default gen_random_uuid(),audience text not null check(audience in ('customer','driver')),version text not null check(version~'^[0-9]+\.[0-9]+\.[0-9]+$'),version_code integer not null check(version_code>0),notes text not null check(length(notes) between 5 and 2000),state text not null default 'draft' check(state in ('draft','published','retired')),storage_path text unique not null,sha256 text check(sha256~'^[a-f0-9]{64}$'),bytes bigint check(bytes between 1024 and 52428800),created_by uuid not null references public.users,published_by uuid references public.users,published_at timestamptz,unique(audience,version_code));
create table private.release_fanout(release_id uuid primary key references private.app_releases,cursor_id uuid,completed boolean not null default false,notified integer not null default 0);
alter table public.notification_records add column release_id uuid references private.app_releases;
create unique index notification_release_once on public.notification_records(user_id,release_id) where release_id is not null;
alter table private.push_outbox add column release_id uuid;
create function public.admin_app_releases() returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_permission('releases.manage');return(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('notified',coalesce(f.notified,0),'announcement_complete',coalesce(f.completed,false)) order by r.version_code desc),'[]') from private.app_releases r left join private.release_fanout f on f.release_id=r.id);end$$;
create function public.admin_release_draft(p_audience text,p_version text,p_version_code integer,p_notes text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.app_releases;id uuid:=gen_random_uuid();begin
 perform private.require_permission('releases.manage');
 if p_audience is null or p_audience not in ('customer','driver') or p_version is null or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+$' or p_version_code is null or p_version_code<=0 or p_notes is null or length(trim(p_notes)) not between 5 and 2000 then raise exception 'Audience, version, increasing Android code and release notes required';end if;
 if exists(select 1 from private.app_releases where audience=p_audience and state='published' and version_code>=p_version_code) then raise exception 'Version code must exceed the currently published app';end if;
 select * into r from private.app_releases where audience=p_audience and version_code=p_version_code;
 if found then if r.state<>'draft' or r.version<>p_version or r.notes<>p_notes then raise exception 'Version code is already used';end if;return to_jsonb(r);end if;
 insert into private.app_releases(id,audience,version,version_code,notes,storage_path,created_by) values(id,p_audience,p_version,p_version_code,p_notes,p_audience||'/'||id::text||'.apk',auth.uid()) returning * into r;
 insert into public.audit_logs(actor_id,action,target_id) values(auth.uid(),'release.draft',id::text);return to_jsonb(r);end$$;
create function public.api_release_record(p_id uuid,p_actor uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_actor is not null and not exists(select 1 from public.users u join public.user_roles ur on ur.user_id=u.id join public.role_permissions rp on rp.role_id=ur.role_id where u.id=p_actor and u.status='active' and rp.permission_id='releases.manage') then raise exception 'Release permission required';end if;
 return(select to_jsonb(r) from private.app_releases r where id=p_id and (p_actor is not null or state='published'));end$$;
create function public.api_publish_release(p_id uuid,p_actor uuid,p_hash text,p_bytes bigint) returns void language plpgsql security definer set search_path='' as $$declare r private.app_releases;begin
 if p_actor is null or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 1024 and 52428800 then raise exception 'Verified actor and APK digest/size required';end if;
 perform public.api_release_record(p_id,p_actor);select * into r from private.app_releases where id=p_id for update;if not found then raise exception 'Release not found';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.audience,884));
 if r.state='published' and r.sha256=p_hash and r.bytes=p_bytes then return;end if;
 if r.state<>'draft' or exists(select 1 from private.app_releases where audience=r.audience and state='published' and version_code>=r.version_code) then raise exception 'Release cannot be published';end if;
 update private.app_releases set state='published',sha256=p_hash,bytes=p_bytes,published_by=p_actor,published_at=now() where id=p_id;
 insert into private.release_fanout(release_id) values(p_id);
 insert into public.audit_logs(actor_id,action,target_id,reason) values(p_actor,'release.published',p_id::text,'Server SHA256 and embedded config checked. Administrator confirms native signature/package verification before upload.');end$$;
create function public.admin_retire_release(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$begin perform private.require_permission('releases.manage');if p_reason is null or length(trim(p_reason))<5 then raise exception 'Reason required';end if;update private.app_releases set state='retired' where id=p_id;if not found then raise exception 'Release not found';end if;update private.release_fanout set completed=true where release_id=p_id;insert into public.audit_logs(actor_id,action,target_id,reason) values(auth.uid(),'release.retired',p_id::text,p_reason);end$$;
create function public.api_latest_release(p_audience text) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('id',id,'audience',audience,'version',version,'version_code',version_code,'notes',notes,'sha256',sha256,'bytes',bytes,'published_at',published_at) from private.app_releases where audience=p_audience and state='published' order by version_code desc limit 1$$;
create function public.api_release_notifications() returns integer language plpgsql security definer set search_path='' as $$declare job private.release_fanout;r private.app_releases;u record;last_id uuid;added integer:=0;begin
 select * into job from private.release_fanout where not completed order by release_id for update skip locked limit 1;if not found then return 0;end if;
 select * into r from private.app_releases where id=job.release_id;
 if r.state<>'published' then update private.release_fanout set completed=true where release_id=job.release_id;return 0;end if;
 for u in select id from public.users where kind=r.audience and status='active' and (job.cursor_id is null or id>job.cursor_id) order by id limit 200 loop
  insert into public.notification_records(user_id,title,release_id) values(u.id,'Hyzz '||r.audience||' '||r.version||' is available. Open the app to download the update.',r.id) on conflict do nothing;
  last_id:=u.id;added:=added+1;
 end loop;
 update private.release_fanout set cursor_id=coalesce(last_id,cursor_id),completed=added<200,notified=notified+added where release_id=job.release_id;return added;end$$;
create or replace function private.queue_push() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.customer_profiles where user_id=new.user_id and not notification_enabled) and not exists(select 1 from private.driver_preferences where user_id=new.user_id and not notifications) then
 insert into private.push_outbox(notification_id,token,title,booking_id,release_id) select new.id,d.token,new.title,new.booking_id,new.release_id from private.push_devices d join public.users u on u.id=d.user_id where d.user_id=new.user_id and d.enabled and u.status='active' on conflict do nothing;end if;return new;end$$;
revoke all on private.app_releases,private.release_fanout from public,anon,authenticated;
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_app_releases','admin_release_draft','admin_retire_release') loop execute format('revoke all on function %s from public,anon',r.signature);execute format('grant execute on function %s to authenticated',r.signature);end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('api_release_record','api_publish_release','api_latest_release','api_release_notifications') loop execute format('revoke all on function %s from public,anon,authenticated',r.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',r.signature);end if;end loop;
end$$;
commit;
