-- Richmedia / YES: shared campaign storage and tenant-scoped access.
-- Execute once as the database owner through Supabase migrations or SQL Editor.
-- No users or passwords are created here. Memberships are provisioned separately.
begin;

create schema if not exists portal_private;
revoke all on schema portal_private from public, anon, authenticated;

create table public.portal_clients (
  id text primary key check (length(id) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 160),
  updated_at timestamptz
);

create table public.portal_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null references public.portal_clients(id) on delete cascade,
  role text not null check (role in ('admin', 'viewer')),
  primary key (user_id, client_id)
);

create table public.portal_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.portal_clients(id),
  revision bigint not null default 1 check (revision between 1 and 9000000000000),
  channel text not null check (channel in ('facebook', 'instagram', 'youtube', 'tiktok', 'display')),
  name text not null check (length(btrim(name)) between 1 and 160),
  start_date date not null check (start_date between date '0001-01-01' and date '9999-12-31'),
  end_date date not null check (end_date between start_date and date '9999-12-31'),
  budget numeric not null check (budget between 0 and 9000000000000 and budget = round(budget, 2)),
  spend numeric check (spend between 0 and 9000000000000 and spend = round(spend, 2)),
  impressions bigint not null check (impressions between 0 and 9000000000000),
  clicks bigint not null check (clicks between 0 and 9000000000000),
  views bigint check (views between 0 and 9000000000000),
  trueviews bigint check (trueviews between 0 and 9000000000000),
  interactions bigint check (interactions between 0 and 9000000000000),
  ctr numeric generated always as (
    case when impressions > 0 then round(clicks::numeric / impressions * 100, 6) end
  ) stored,
  status text not null default 'active' check (status in ('active', 'archived')),
  source text not null default 'manual' check (source = 'manual'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index portal_campaigns_client_created on public.portal_campaigns(client_id, created_at desc, id);

create table public.portal_campaign_history (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.portal_campaigns(id),
  client_id text not null references public.portal_clients(id),
  -- Preserve the historical user identifier even if the Auth account is removed.
  actor_id uuid,
  action text not null check (action in ('create', 'update', 'archive')),
  recorded_at timestamptz not null default clock_timestamp(),
  record jsonb not null check (jsonb_typeof(record) = 'object')
);
create index portal_history_campaign on public.portal_campaign_history(campaign_id, id desc);

alter table public.portal_clients enable row level security;
alter table public.portal_memberships enable row level security;
alter table public.portal_campaigns enable row level security;
alter table public.portal_campaign_history enable row level security;

-- Explicitly undo Supabase's default grants; the browser has read access only.
revoke all on public.portal_clients, public.portal_memberships,
  public.portal_campaigns, public.portal_campaign_history from public, anon, authenticated;
revoke all on sequence public.portal_campaign_history_id_seq from public, anon, authenticated;
grant select on public.portal_clients, public.portal_memberships,
  public.portal_campaigns, public.portal_campaign_history to authenticated;

create policy memberships_self_read on public.portal_memberships
  for select to authenticated using (user_id = (select auth.uid()));

create policy clients_member_read on public.portal_clients
  for select to authenticated using (exists (
    select 1 from public.portal_memberships m
    where m.client_id = portal_clients.id and m.user_id = (select auth.uid())
  ));

create policy campaigns_member_read on public.portal_campaigns
  for select to authenticated using (exists (
    select 1 from public.portal_memberships m
    where m.client_id = portal_campaigns.client_id and m.user_id = (select auth.uid())
      and (m.role = 'admin' or portal_campaigns.status = 'active')
  ));

create policy history_admin_read on public.portal_campaign_history
  for select to authenticated using (exists (
    select 1 from public.portal_memberships m
    where m.client_id = portal_campaign_history.client_id
      and m.user_id = (select auth.uid()) and m.role = 'admin'
  ));

-- Exact camelCase contract consumed by the existing dashboard and editor.
create function portal_private.campaign_json(c public.portal_campaigns)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'revision', c.revision, 'channel', c.channel, 'name', c.name,
    'start', to_char(c.start_date, 'YYYY-MM-DD'), 'end', to_char(c.end_date, 'YYYY-MM-DD'),
    'budget', c.budget, 'spend', c.spend, 'impressions', c.impressions,
    'clicks', c.clicks, 'views', c.views, 'trueviews', c.trueviews,
    'interactions', c.interactions, 'ctr', c.ctr, 'status', c.status,
    'source', c.source, 'createdAt', c.created_at, 'updatedAt', c.updated_at
  );
$$;

-- Trigger covers all mutations, including a trusted database-owner import.
-- Browser roles cannot alter campaigns, audit entries, or client timestamps directly.
create function portal_private.audit_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.portal_campaign_history(campaign_id, client_id, actor_id, action, record)
  values (new.id, new.client_id, auth.uid(),
    case when tg_op = 'INSERT' then 'create'
         when new.status = 'archived' and old.status <> 'archived' then 'archive'
         else 'update' end,
    portal_private.campaign_json(new));
  update public.portal_clients set updated_at = clock_timestamp() where id = new.client_id;
  return new;
end;
$$;
create trigger portal_campaign_audit after insert or update on public.portal_campaigns
  for each row execute function portal_private.audit_campaign();

-- Validation is performed before casts, matching the local server's number/null rules.
create function portal_private.validate_campaign(p_payload jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  errors jsonb := '{}'::jsonb;
  values_json jsonb := '{}'::jsonb;
  field text;
  value_json jsonb;
  text_value text;
  number_value numeric;
  date_value date;
  dates jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('error', 'Un objet JSON est requis.', 'status', 400);
  end if;
  if octet_length(p_payload::text) > 65536 then
    return jsonb_build_object('error', 'La requête est trop volumineuse.', 'status', 413);
  end if;
  if jsonb_typeof(p_payload->'channel') is distinct from 'string'
     or (p_payload->>'channel') not in ('facebook','instagram','youtube','tiktok','display') then
    errors := errors || jsonb_build_object('channel', 'Choisissez un canal valide.');
  end if;
  values_json := values_json || jsonb_build_object('channel', p_payload->>'channel');
  text_value := regexp_replace(p_payload->>'name', '^\s+|\s+$', '', 'g');
  if jsonb_typeof(p_payload->'name') is distinct from 'string'
     or text_value is null or length(text_value) not between 1 and 160 then
    errors := errors || jsonb_build_object('name', 'Le nom doit contenir entre 1 et 160 caractères.');
  end if;
  values_json := values_json || jsonb_build_object('name', text_value);
  foreach field in array array['start', 'end'] loop
    begin
      text_value := p_payload->>field;
      if jsonb_typeof(p_payload->field) is distinct from 'string'
         or text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'invalid date';
      end if;
      date_value := text_value::date;
      if date_value < date '0001-01-01' or date_value > date '9999-12-31'
         or to_char(date_value, 'YYYY-MM-DD') <> text_value then
        raise exception 'invalid date';
      end if;
      dates := dates || jsonb_build_object(field, text_value);
    exception when others then
      errors := errors || jsonb_build_object(field, 'Renseignez une date valide au format AAAA-MM-JJ.');
    end;
  end loop;
  if (dates->>'start') > (dates->>'end') then
    errors := errors || jsonb_build_object('end', 'La fin doit être égale ou postérieure au début.');
  end if;
  values_json := values_json || dates;
  foreach field in array array['budget','spend','impressions','clicks','views','trueviews','interactions'] loop
    value_json := p_payload->field;
    if (value_json is null or value_json = 'null'::jsonb)
       and field not in ('budget','impressions','clicks') then
      values_json := values_json || jsonb_build_object(field, null);
      continue;
    end if;
    if jsonb_typeof(value_json) is distinct from 'number' then
      errors := errors || jsonb_build_object(field, 'Saisissez un nombre positif ou nul, inférieur ou égal à 9 000 milliards.');
      continue;
    end if;
    number_value := (value_json::text)::numeric;
    if number_value < 0 or number_value > 9000000000000 then
      errors := errors || jsonb_build_object(field, 'Saisissez un nombre positif ou nul, inférieur ou égal à 9 000 milliards.');
    elsif field in ('budget','spend') and number_value <> round(number_value, 2) then
      errors := errors || jsonb_build_object(field, 'Le montant accepte deux décimales au maximum.');
    elsif field not in ('budget','spend') and number_value <> trunc(number_value) then
      errors := errors || jsonb_build_object(field, 'Saisissez un nombre entier positif ou nul.');
    else
      values_json := values_json || jsonb_build_object(field, number_value);
    end if;
  end loop;
  text_value := case when p_payload ? 'status' then p_payload->>'status' else 'active' end;
  if text_value is null or text_value not in ('active', 'archived') then
    errors := errors || jsonb_build_object('status', 'Statut invalide.');
  end if;
  values_json := values_json || jsonb_build_object('status', text_value);
  if errors <> '{}'::jsonb then
    return jsonb_build_object('error', 'Vérifiez les champs du formulaire.', 'status', 422, 'fields', errors);
  end if;
  return jsonb_build_object('values', values_json);
end;
$$;

create function public.portal_list_campaigns(p_client_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  member_role text;
  campaigns jsonb;
  updated timestamptz;
begin
  select m.role into member_role from public.portal_memberships m
    where m.client_id = p_client_id and m.user_id = auth.uid();
  if member_role is null then
    raise exception 'Accès à cet espace non autorisé.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(portal_private.campaign_json(c) order by c.created_at desc, c.id), '[]'::jsonb)
    into campaigns from public.portal_campaigns c
    where c.client_id = p_client_id and (member_role = 'admin' or c.status = 'active');
  select c.updated_at into updated from public.portal_clients c where c.id = p_client_id;
  return jsonb_build_object('mode', 'manual', 'campaigns', campaigns, 'updatedAt', updated);
end;
$$;

create function public.portal_save_campaign(
  p_client_id text,
  p_payload jsonb,
  p_id uuid default null,
  p_archive boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member_role text;
  checked jsonb;
  v jsonb;
  requested_revision numeric;
  current_record public.portal_campaigns;
  saved public.portal_campaigns;
  updated timestamptz;
begin
  select m.role into member_role from public.portal_memberships m
    where m.client_id = p_client_id and m.user_id = auth.uid();
  if member_role is distinct from 'admin' then
    raise exception 'La modification est réservée à Richmedia.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('error', 'Un objet JSON est requis.', 'status', 400);
  end if;
  if octet_length(p_payload::text) > 65536 then
    return jsonb_build_object('error', 'La requête est trop volumineuse.', 'status', 413);
  end if;
  if p_archive is null or (p_archive and p_id is null) then
    return jsonb_build_object('error', 'Campagne à archiver requise.', 'status', 422);
  end if;
  if not p_archive then
    checked := portal_private.validate_campaign(p_payload);
    if checked ? 'error' then return checked; end if;
    v := checked->'values';
  end if;
  if p_id is not null then
    if jsonb_typeof(p_payload->'revision') is distinct from 'number' then
      return jsonb_build_object('error', 'La version de la campagne est requise.', 'status', 422,
                               'fields', jsonb_build_object('revision', 'Version invalide.'));
    end if;
    requested_revision := (p_payload->>'revision')::numeric;
    if requested_revision < 1 or requested_revision >= 9000000000000
       or requested_revision <> trunc(requested_revision) then
      return jsonb_build_object('error', 'La version de la campagne est requise.', 'status', 422,
                               'fields', jsonb_build_object('revision', 'Version invalide.'));
    end if;
    select c.* into current_record from public.portal_campaigns c
      where c.id = p_id and c.client_id = p_client_id for update;
    if not found then
      return jsonb_build_object('error', 'Campagne introuvable.', 'status', 404);
    end if;
    if current_record.revision <> requested_revision then
      return jsonb_build_object('error', 'Cette campagne a été modifiée. Rechargez sa dernière version.',
                               'status', 409, 'current', portal_private.campaign_json(current_record));
    end if;
    if p_archive then
      update public.portal_campaigns set status = 'archived', revision = revision + 1,
        updated_at = clock_timestamp() where id = p_id returning * into saved;
    else
      update public.portal_campaigns set
        channel = v->>'channel', name = v->>'name',
        start_date = (v->>'start')::date, end_date = (v->>'end')::date,
        budget = (v->>'budget')::numeric, spend = (v->>'spend')::numeric,
        impressions = (v->>'impressions')::bigint, clicks = (v->>'clicks')::bigint,
        views = (v->>'views')::bigint, trueviews = (v->>'trueviews')::bigint,
        interactions = (v->>'interactions')::bigint, status = v->>'status',
        revision = revision + 1, updated_at = clock_timestamp()
        where id = p_id returning * into saved;
    end if;
  else
    insert into public.portal_campaigns(client_id, channel, name, start_date, end_date,
      budget, spend, impressions, clicks, views, trueviews, interactions, status)
    values (p_client_id, v->>'channel', v->>'name', (v->>'start')::date, (v->>'end')::date,
      (v->>'budget')::numeric, (v->>'spend')::numeric, (v->>'impressions')::bigint,
      (v->>'clicks')::bigint, (v->>'views')::bigint, (v->>'trueviews')::bigint,
      (v->>'interactions')::bigint, v->>'status') returning * into saved;
  end if;
  select c.updated_at into updated from public.portal_clients c where c.id = p_client_id;
  return jsonb_build_object('campaign', portal_private.campaign_json(saved), 'mode', 'manual', 'updatedAt', updated);
end;
$$;

-- Public is a PostgreSQL pseudo-role encompassing everyone, not just anon.
revoke all on function portal_private.campaign_json(public.portal_campaigns) from public, anon, authenticated;
revoke all on function portal_private.audit_campaign() from public, anon, authenticated;
revoke all on function portal_private.validate_campaign(jsonb) from public, anon, authenticated;
revoke all on function public.portal_list_campaigns(text) from public, anon, authenticated;
revoke all on function public.portal_save_campaign(text, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.portal_list_campaigns(text) to authenticated;
grant execute on function public.portal_save_campaign(text, jsonb, uuid, boolean) to authenticated;

insert into public.portal_clients(id, name) values ('yes-baby', 'YES Baby Comfort');

comment on table public.portal_memberships is 'Managed by database administrators only; never trust editable auth user metadata for roles.';
comment on table public.portal_campaign_history is 'Append-only for portal roles. Each successful campaign change stores actor, full snapshot, and timestamp atomically.';
comment on function public.portal_save_campaign(text, jsonb, uuid, boolean) is 'Only authenticated client admins; optimistic revision locking. Business errors use a status/error JSON envelope.';
notify pgrst, 'reload schema';
commit;
