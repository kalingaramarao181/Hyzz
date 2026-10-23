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
