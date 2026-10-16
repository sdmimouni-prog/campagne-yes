-- Add Facebook/Instagram video view metrics to campaign reporting.
begin;

alter table public.portal_campaigns
  add column video_views_3s bigint check (video_views_3s between 0 and 9000000000000),
  add column thruplays_15s bigint check (thruplays_15s between 0 and 9000000000000),
  add column average_video_watch_time_seconds numeric(15,2) check (average_video_watch_time_seconds between 0 and 9000000000000);
comment on column public.portal_campaigns.video_views_3s is 'Optional number of 3-second video views.';
comment on column public.portal_campaigns.thruplays_15s is 'Optional number of 15-second ThruPlays.';
comment on column public.portal_campaigns.average_video_watch_time_seconds is 'Optional average video watch time in seconds.';

create or replace function portal_private.campaign_json(c public.portal_campaigns)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'revision', c.revision, 'channel', c.channel, 'name', c.name,
    'start', to_char(c.start_date, 'YYYY-MM-DD'), 'end', to_char(c.end_date, 'YYYY-MM-DD'),
    'budget', c.budget, 'spend', c.spend, 'impressions', c.impressions,
    'reach', c.reach, 'frequency', c.frequency, 'audience', c.audience,
    'clicks', c.clicks, 'views', c.views,
    'videoViews3s', c.video_views_3s, 'thruPlays15s', c.thruplays_15s,
    'averageVideoWatchTimeSeconds', c.average_video_watch_time_seconds,
    'interactions', c.interactions, 'ctr', c.ctr, 'status', c.status,
    'source', c.source, 'createdAt', c.created_at, 'updatedAt', c.updated_at
  );
$$;

create or replace function portal_private.validate_campaign(p_payload jsonb)
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
  checked_audience jsonb;
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
  foreach field in array array['budget','spend','impressions','reach','clicks','views','videoViews3s','thruPlays15s','averageVideoWatchTimeSeconds','interactions'] loop
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
    elsif field in ('budget','spend','averageVideoWatchTimeSeconds') and number_value <> round(number_value, 2) then
      errors := errors || jsonb_build_object(field, case when field = 'averageVideoWatchTimeSeconds' then 'La valeur accepte deux décimales au maximum.' else 'Le montant accepte deux décimales au maximum.' end);
    elsif field not in ('budget','spend','averageVideoWatchTimeSeconds') and number_value <> trunc(number_value) then
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
  checked_audience := portal_private.validate_audience(p_payload->'audience',
    (values_json->>'impressions')::bigint, (values_json->>'clicks')::bigint, (values_json->>'reach')::bigint);
  if checked_audience ? 'error' then return checked_audience; end if;
  values_json := values_json || jsonb_build_object('audience', checked_audience->'values');
  return jsonb_build_object('values', values_json);
end;
$$;

create or replace function public.portal_save_campaign(
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
      -- Older open editors omit new fields. Preserve those values, then validate the
      -- merged record so a lower total cannot contradict its retained breakdown.
      if not (p_payload ? 'reach') then
        v := v || jsonb_build_object('reach', current_record.reach);
      end if;
      if not (p_payload ? 'audience') then
        v := v || jsonb_build_object('audience', current_record.audience);
      end if;
      if not (p_payload ? 'videoViews3s') then
        v := v || jsonb_build_object('videoViews3s', current_record.video_views_3s);
      end if;
      if not (p_payload ? 'thruPlays15s') then
        v := v || jsonb_build_object('thruPlays15s', current_record.thruplays_15s);
      end if;
      if not (p_payload ? 'averageVideoWatchTimeSeconds') then
        v := v || jsonb_build_object('averageVideoWatchTimeSeconds', current_record.average_video_watch_time_seconds);
      end if;
      checked := portal_private.validate_audience(v->'audience',
        (v->>'impressions')::bigint, (v->>'clicks')::bigint, (v->>'reach')::bigint);
      if checked ? 'error' then return checked; end if;
      v := v || jsonb_build_object('audience', checked->'values');
      update public.portal_campaigns set
        channel = v->>'channel', name = v->>'name',
        start_date = (v->>'start')::date, end_date = (v->>'end')::date,
        budget = (v->>'budget')::numeric, spend = (v->>'spend')::numeric,
        impressions = (v->>'impressions')::bigint,
        reach = (v->>'reach')::bigint, audience = v->'audience',
        clicks = (v->>'clicks')::bigint,
        views = (v->>'views')::bigint,
        video_views_3s = (v->>'videoViews3s')::bigint,
        thruplays_15s = (v->>'thruPlays15s')::bigint,
        average_video_watch_time_seconds = (v->>'averageVideoWatchTimeSeconds')::numeric,
        interactions = (v->>'interactions')::bigint, status = v->>'status',
        revision = revision + 1, updated_at = clock_timestamp()
        where id = p_id returning * into saved;
    end if;
  else
    insert into public.portal_campaigns(client_id, channel, name, start_date, end_date,
      budget, spend, impressions, reach, clicks, views, video_views_3s, thruplays_15s, average_video_watch_time_seconds, interactions, audience, status)
    values (p_client_id, v->>'channel', v->>'name', (v->>'start')::date, (v->>'end')::date,
      (v->>'budget')::numeric, (v->>'spend')::numeric, (v->>'impressions')::bigint,
      (v->>'reach')::bigint, (v->>'clicks')::bigint, (v->>'views')::bigint,
      (v->>'videoViews3s')::bigint, (v->>'thruPlays15s')::bigint, (v->>'averageVideoWatchTimeSeconds')::numeric, (v->>'interactions')::bigint, v->'audience', v->>'status') returning * into saved;
  end if;
  select c.updated_at into updated from public.portal_clients c where c.id = p_client_id;
  return jsonb_build_object('campaign', portal_private.campaign_json(saved), 'mode', 'manual', 'updatedAt', updated);
end;
$$;

-- Keep browser permissions identical to the original migration.
revoke all on function portal_private.validate_audience(jsonb, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function portal_private.campaign_json(public.portal_campaigns) from public, anon, authenticated;
revoke all on function portal_private.validate_campaign(jsonb) from public, anon, authenticated;
revoke all on function public.portal_save_campaign(text, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.portal_save_campaign(text, jsonb, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
