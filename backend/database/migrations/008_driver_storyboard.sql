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
