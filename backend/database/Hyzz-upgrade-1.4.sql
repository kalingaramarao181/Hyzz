-- Only for databases with 001-005 applied and 006-008 NOT applied. Run once.
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
