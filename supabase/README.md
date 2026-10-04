# Base partagée Supabase

Cette migration définit le stockage du portail. Elle ne crée ni projet Supabase, ni comptes, ni mots de passe et n'est pas appliquée automatiquement à une base distante.

## État de la production

Le projet [Supabase `jfsxvrfpaxacxbpemlgo`](https://supabase.com/dashboard/project/jfsxvrfpaxacxbpemlgo) est relié au portail [campagne-yes-ten.vercel.app](https://campagne-yes-ten.vercel.app), déployé sur Vercel en mode Supabase. Le premier déploiement opérationnel utilise le commit `8ad996c`.

- La migration `migrations/202610040001_portal.sql` a été appliquée avec succès dans le SQL Editor.
- Les 11 campagnes ont été importées : 4 YouTube, 2 Facebook, 2 Instagram et 3 TikTok. Les UUID et les horodatages `created_at` et `updated_at` d'origine ont été conservés. Toutes les campagnes sont actives, avec les montants et compteurs à zéro, sur la période du 01/10/2026 au 31/12/2026.
- Les inscriptions publiques et les connexions anonymes sont désactivées. La Site URL est `https://campagne-yes-ten.vercel.app`.
- Les trois variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `PORTAL_CLIENT_ID` sont configurées dans l'environnement **Production** de Vercel.
- Les lectures anonymes de `portal_campaigns` et de `portal_list_campaigns` sont refusées : HTTP `401`, code PostgreSQL `42501`.
- Le compte client SIPAT est créé dans Auth. Son appartenance à `yes-baby` est enregistrée dans `portal_memberships` avec le rôle `viewer`, donnant accès en lecture aux campagnes actives.
- Sa connexion en production, la redirection vers le dashboard et la lecture des 11 campagnes ont été vérifiées dans le navigateur. Les montants et compteurs affichés sont à zéro.
- La page de gestion refuse l'accès à ce lecteur et masque le formulaire et le tableau. Les écritures via l'API n'ont pas été testées sur la production.

**Restent à réaliser :** créer le compte Auth administrateur Richmedia et lui attribuer le rôle `admin` dans `portal_memberships`, puis vérifier son parcours et les droits d'écriture. Le refus des écritures pour le compte SIPAT reste également à vérifier en production.

Le fichier source `portal-config.js` reste en mode local pour conserver le prototype utilisable jusqu'à la création des comptes. La production utilise la configuration générée par le build Vercel. L'import déjà réalisé ne synchronise pas SQLite et Supabase ; toute nouvelle modification locale reste locale.

## Installation d'un nouvel environnement

Ces étapes décrivent une installation complète. Pour la production ci-dessus, poursuivre uniquement les étapes concernant les comptes, leurs rôles et la validation authentifiée ; ne pas réappliquer la migration ni réimporter les campagnes initiales.

1. Créer le projet Supabase destiné au portail.
2. Exécuter `migrations/202610040001_portal.sql` dans le SQL Editor avec le propriétaire de la base, ou avec le mécanisme de migrations Supabase. Ce script transactionnel s'exécute une fois.
3. Dans Authentication, désactiver les inscriptions publiques et les connexions anonymes. Configurer l'URL du site et les URL de retour autorisées avec le domaine du portail.
4. Créer les comptes Richmedia et YES dans Authentication avec un accès e-mail/mot de passe opérationnel. Attribuer à chacun sa ligne dans `portal_memberships` en adaptant `provision-membership.sql.example`. Les UUID doivent venir de vrais comptes Auth. Aucun premier utilisateur ne devient administrateur automatiquement. L'administrateur configure les mots de passe directement dans Supabase ; ne pas les mettre dans ce dépôt ou dans la conversation. Le portail ne traite pas encore les liens d'invitation ou de récupération de mot de passe : ne pas compter sur ces liens pour ouvrir le premier accès.
5. Renseigner la configuration de l'interface avec l'URL du projet, sa clé **publishable** (ou l'ancienne clé **anon**) et l'identifiant client `yes-baby`. Une clé `service_role` ou `secret` ne doit jamais se trouver dans le navigateur ni dans GitHub.
6. Vérifier avec deux comptes distincts : Richmedia peut enregistrer ; YES peut lire les campagnes actives mais ne peut ni modifier, ni lire les archives ou l'historique. Une session sans appartenance au client n'a aucun accès.

Les fichiers SQL, sauvegardes, tests et données SQLite doivent être exclus du répertoire publié par l'hébergeur. Le build du portail doit publier uniquement les ressources de l'interface.

Pour initialiser un nouvel environnement à zéro après la migration du schéma, les scripts `seed-yes-youtube.sql`, `seed-yes-facebook.sql`, `seed-yes-instagram.sql` et `seed-yes-tiktok.sql` contiennent les 11 campagnes demandées le 4 octobre 2026, sur la période du 01/10/2026 au 31/12/2026. Ils sont idempotents : ils ne dupliquent ni ne remettent à zéro les campagnes existantes. Pour transférer des données locales qui ont évolué, exporter leur état actuel et importer ces données plutôt que les zéros initiaux des scripts. L'import vers la production actuelle est déjà terminé. Ces fiches servent au reporting ; leur création ne lance aucune campagne publicitaire.

Pour Vercel, les variables sont `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PORTAL_CLIENT_ID=yes-baby`. La clé se trouve dans les réglages API du projet ; choisir une clé **Publishable**, ou l'ancienne clé **anon**, et jamais une clé privilégiée. Le [README du portail](../README.md) détaille le build et les réglages Vercel. Aucun mot de passe PostgreSQL ni chaîne de connexion à la base n'est requis dans Vercel pour cette version.

Une fois les comptes opérationnels, pour activer Supabase sur l'aperçu local, remplacer les valeurs de `portal-config.js` par `backend: 'supabase'`, l'URL, la clé publique et `clientId: 'yes-baby'`, puis exécuter `npm ci` et `npm run vendor`. Cette activation n'importe pas la base SQLite locale et ne synchronise pas les deux stockages. Cette bascule locale n'a pas été effectuée ; le build Vercel génère déjà sa propre configuration Supabase.

## Accès et données

| Table | Lecture par l'interface | Écriture par l'interface |
|---|---|---|
| `portal_clients` | Membres du client | Aucune |
| `portal_memberships` | Ses propres appartenances | Aucune |
| `portal_campaigns` | Membres, avec archives réservées aux administrateurs | RPC administrateur uniquement |
| `portal_campaign_history` | Administrateurs du client | Aucune |

Les quatre tables ont la protection RLS activée. Aucun accès n'est accordé à `anon`. Les fonctions publiques vérifient elles-mêmes l'identité et l'appartenance au client, car elles s'exécutent avec les droits de leur propriétaire. Les fonctions auxiliaires sont dans `portal_private`, dont l'usage est révoqué aux rôles du navigateur. `user_metadata` n'accorde aucun droit.

La liste ne revient jamais à des chiffres de démonstration : une base Supabase vide retourne `mode: "manual"` et une liste vide. Les totaux restent ceux saisis pour leur période ; cette migration ne fabrique ni séries quotidiennes ni profils d'audience.

`budget` est distinct des dépenses `spend`. Les compteurs facultatifs et les dépenses inconnues restent `null`. Le CTR est recalculé dans PostgreSQL. Chaque mise à jour remplace les totaux, vérifie la révision et écrit une copie horodatée dans l'historique dans la même transaction. Une version périmée retourne un conflit 409 et l'enregistrement courant ; aucun chiffre n'est additionné silencieusement.

## Contrat RPC

- `portal_list_campaigns(p_client_id text)` : `{mode, campaigns, updatedAt}`.
- `portal_save_campaign(p_client_id text, p_payload jsonb, p_id uuid = null, p_archive boolean = false)` : `{mode, campaign, updatedAt}`. Sans ID, crée une campagne ; avec ID, remplace la campagne et exige `p_payload.revision`. Avec `p_archive: true`, seul l'ID et la révision sont requis.
- Erreur métier : `{error, status, fields?, current?}` ; l'interface doit traiter cette enveloppe même si le transport RPC retourne HTTP 200.
- Refus d'accès : erreur PostgreSQL `42501`, à traiter comme un accès interdit.

Champs d'une campagne côté interface : `id`, `revision`, `channel`, `name`, `start`, `end`, `budget`, `spend`, `impressions`, `clicks`, `views`, `trueviews`, `interactions`, `ctr`, `status`, `source`, `createdAt`, `updatedAt`. Les champs JSON `id`, `revision` à la création, `ctr`, `source`, `client_id`, `createdAt` et `updatedAt` ne permettent pas de contourner les valeurs gérées par le serveur.

La limite de 9 000 milliards maintient les compteurs dans la plage des entiers exacts JavaScript. Seuls les nombres JSON sont acceptés, pas les chaînes numériques ni les booléens. Les montants ont au maximum deux décimales ; les compteurs sont entiers ; les dates ISO sont validées et ordonnées.

## Tests locaux

`python3 supabase/tests/test_database.py` crée un cluster PostgreSQL temporaire isolé, applique le vrai SQL, teste les autorisations et les opérations, puis détruit le cluster. Le test nécessite les outils PostgreSQL `initdb`, `pg_ctl`, `psql` (PostgreSQL 15 ou ultérieur). On peut définir `PORTAL_PG_BIN` pour indiquer leur dossier.

Les comptes Auth et `auth.uid()` sont simulés uniquement dans ce cluster de test ; aucune base existante ou distante n'est utilisée. Ces tests couvrent PostgreSQL et les politiques, pas le serveur Supabase Auth ou les URL de redirection du projet réel.

Documentation : [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [fonctions et droits d'exécution](https://supabase.com/docs/guides/database/functions), [sécurisation de l'API](https://supabase.com/docs/guides/api/securing-your-api).
