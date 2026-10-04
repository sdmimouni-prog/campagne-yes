-- Initialisation demandée par Richmedia : Facebook Reel et Story à zéro.
-- Après la migration du schéma, exécuter dans le SQL Editor du projet YES.
-- Si les chiffres locaux ont changé, exporter leur état actuel avant la bascule.
-- Ce script conserve les campagnes déjà présentes, sans remise à zéro.
begin;
with initial(id, name, start_date, end_date) as (values
  ('6c022d35-fbee-4815-8f9e-b003fa235483', 'Yes - Facebook - Reel', '2026-10-01', '2026-12-31'),
  ('01cc38ab-0fde-4f02-9527-86ec7e8331a4', 'Yes - Facebook - Story', '2026-10-01', '2026-12-31')
)
insert into public.portal_campaigns
  (id, client_id, channel, name, start_date, end_date, budget, spend,
   impressions, clicks, views, trueviews, interactions, status)
select initial.id::uuid, 'yes-baby', 'facebook', initial.name,
  initial.start_date::date, initial.end_date::date, 0, 0, 0, 0, 0, 0, 0, 'active'
from initial
where not exists (
  select 1 from public.portal_campaigns existing
  where existing.client_id = 'yes-baby'
    and existing.channel = 'facebook' and existing.name = initial.name
)
on conflict (id) do nothing;
commit;
