-- Initialisation demandée par Richmedia : Instagram Reel et Story à zéro.
-- Après la migration du schéma, exécuter dans le SQL Editor du projet YES.
-- Si les chiffres locaux ont changé, exporter leur état actuel avant la bascule.
-- Ce script conserve les campagnes déjà présentes, sans remise à zéro.
begin;
with initial(id, name, start_date, end_date) as (values
  ('08d2ece3-e229-4094-8f7d-44c28e77b20e', 'Yes - Instagram - Reel', '2026-10-01', '2026-12-31'),
  ('3e1ed15e-c35e-42ee-befe-17210102b1b7', 'Yes - Instagram - Story', '2026-10-01', '2026-12-31')
)
insert into public.portal_campaigns
  (id, client_id, channel, name, start_date, end_date, budget, spend,
   impressions, clicks, views, trueviews, interactions, status)
select initial.id::uuid, 'yes-baby', 'instagram', initial.name,
  initial.start_date::date, initial.end_date::date, 0, 0, 0, 0, 0, 0, 0, 'active'
from initial
where not exists (
  select 1 from public.portal_campaigns existing
  where existing.client_id = 'yes-baby'
    and existing.channel = 'instagram' and existing.name = initial.name
)
on conflict (id) do nothing;
commit;
