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
