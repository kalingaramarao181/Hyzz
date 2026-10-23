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
