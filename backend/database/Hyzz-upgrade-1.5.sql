-- Existing 001-008 installations only. Apply 009 and 010 once, in order.
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
