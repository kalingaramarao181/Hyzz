-- Run ONCE after signing in to Hyzz Customer with your own email OTP.
-- Replace only this email. Never place a password here.
do $$
declare owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_EMAIL'; owner_id uuid;
begin
 select id into owner_id from auth.users where lower(email)=lower(owner_email) and email_confirmed_at is not null;
 if owner_id is null then raise exception 'First verify this email with Hyzz Customer'; end if;
 if exists(select 1 from public.user_roles where role_id='super_admin') then raise exception 'A Super Admin already exists. Use its staff management page.'; end if;
 update public.users set kind='employee',full_name='Hyzz Administrator' where id=owner_id;
 delete from public.customer_profiles where user_id=owner_id;
 insert into public.employee_profiles(user_id) values(owner_id);
 insert into public.user_roles(user_id,role_id) values(owner_id,'super_admin');
 insert into public.audit_logs(actor_id,action,target_id,reason) values(owner_id,'bootstrap.super_admin',owner_id::text,'Project owner SQL Editor bootstrap');
end $$;
