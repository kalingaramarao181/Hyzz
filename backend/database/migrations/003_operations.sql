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
