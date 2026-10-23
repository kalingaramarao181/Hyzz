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
