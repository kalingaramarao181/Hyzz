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
