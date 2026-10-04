-- Initialisation demandée par Richmedia : TikTok In-Feed classique, Spark Ads et TopView à zéro.
-- Après la migration du schéma, exécuter dans le SQL Editor du projet YES.
-- Si les chiffres locaux ont changé, exporter leur état actuel avant la bascule.
-- Ce script conserve les campagnes déjà présentes, sans remise à zéro.
begin;
with initial(id, name, start_date, end_date) as (values
  ('512cbf20-1295-40b2-b1fe-6681d151458e', 'Yes - TikTok - In-Feed classique', '2026-10-01', '2026-12-31'),
  ('b746467b-7e95-4f20-955f-d726d38307fa', 'Yes - TikTok - Spark Ads', '2026-10-01', '2026-12-31'),
  ('36968172-6cdb-40a3-a7ab-55d3163504a6', 'Yes - TikTok - TopView', '2026-10-01', '2026-12-31')
)
insert into public.portal_campaigns
  (id, client_id, channel, name, start_date, end_date, budget, spend,
   impressions, clicks, views, trueviews, interactions, status)
select initial.id::uuid, 'yes-baby', 'tiktok', initial.name,
  initial.start_date::date, initial.end_date::date, 0, 0, 0, 0, 0, 0, 0, 'active'
from initial
where not exists (
  select 1 from public.portal_campaigns existing
  where existing.client_id = 'yes-baby'
    and existing.channel = 'tiktok' and existing.name = initial.name
)
on conflict (id) do nothing;
commit;
