-- Initialisation demandée par Richmedia : quatre campagnes YouTube à zéro.
-- Après la migration du schéma, exécuter dans le SQL Editor du projet YES.
-- État initial au 4 octobre 2026 : si les chiffres locaux ont changé,
-- exporter leur état actuel avant de basculer le portail vers Supabase.
-- Ce script conserve les campagnes déjà présentes, sans remise à zéro.
begin;
with initial(id, name, start_date, end_date) as (values
  ('9b13b1e6-4997-4a1a-abe8-8d1be2a8c384', 'Yes - Reach Campaign - 30 sec · InStream désactivable', '2026-10-01', '2026-12-31'),
  ('ac0dee9d-2365-4544-a96c-47a463789d73', 'Yes - Reach Campaign - 15 sec · InStream non désactivable', '2026-10-01', '2026-12-31'),
  ('25c8a61d-e6ad-4e4a-b058-d641ea1e908f', 'Yes - Awareness Campaign - 7 sec · InStream non désactivable', '2026-10-01', '2026-12-31'),
  ('c53e25ff-b81e-4e20-931a-165e153db603', 'Yes - Awareness Campaign - 5 sec · Bumper', '2026-10-01', '2026-12-31')
)
insert into public.portal_campaigns
  (id, client_id, channel, name, start_date, end_date, budget, spend,
   impressions, clicks, views, trueviews, interactions, status)
select initial.id::uuid, 'yes-baby', 'youtube', initial.name,
  initial.start_date::date, initial.end_date::date, 0, 0, 0, 0, 0, 0, 0, 'active'
from initial
where not exists (
  select 1 from public.portal_campaigns existing
  where existing.client_id = 'yes-baby'
    and existing.channel = 'youtube' and existing.name = initial.name
)
on conflict (id) do nothing;
commit;
