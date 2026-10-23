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
