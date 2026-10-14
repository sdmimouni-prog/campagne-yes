# Base partagée Supabase

Les migrations définissent le stockage du portail. Elles ne créent ni projet Supabase, ni comptes, ni mots de passe et ne sont pas appliquées automatiquement à une base distante.

## État de la production

Le projet [Supabase `jfsxvrfpaxacxbpemlgo`](https://supabase.com/dashboard/project/jfsxvrfpaxacxbpemlgo) est relié au portail [campagne-yes-ten.vercel.app](https://campagne-yes-ten.vercel.app), déployé sur Vercel en mode Supabase. Le premier déploiement opérationnel utilise le commit `8ad996c`.

- La migration `migrations/202610040001_portal.sql` a été appliquée avec succès dans le SQL Editor.
- La migration additive `migrations/202610140001_campaign_reach_frequency.sql` a été appliquée en production le 14 octobre 2026 après la migration initiale. La lecture authentifiée via `portal_list_campaigns` a confirmé les champs `reach` et `frequency` sur les 17 campagnes existantes, sans modification de leurs chiffres.
- La migration `migrations/202610140002_remove_trueviews.sql` a été appliquée le 14 octobre 2026. La lecture authentifiée a confirmé l'absence de TrueViews dans les 17 campagnes et la présence des vues vidéo, du Reach et de la fréquence.
- Les 11 campagnes ont été importées : 4 YouTube, 2 Facebook, 2 Instagram et 3 TikTok. Les UUID et les horodatages `created_at` et `updated_at` d'origine ont été conservés. Toutes les campagnes sont actives, avec les montants et compteurs à zéro, sur la période du 01/10/2026 au 31/12/2026.
- Les inscriptions publiques et les connexions anonymes sont désactivées. La Site URL est `https://campagne-yes-ten.vercel.app`.
- Les trois variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `PORTAL_CLIENT_ID` sont configurées dans l'environnement **Production** de Vercel.
- Les lectures anonymes de `portal_campaigns` et de `portal_list_campaigns` sont refusées : HTTP `401`, code PostgreSQL `42501`.
- Le compte SIPAT est créé dans Auth. Le 14 octobre 2026, à la demande explicite de l'utilisateur et après sa confirmation, son rôle pour `yes-baby` dans `portal_memberships` est passé de `viewer` à `admin`. L'enregistrement a été confirmé dans Supabase. Ce rôle autorise l'ajout, la modification, la suppression restaurable et la restauration des campagnes.
- La connexion avec les identifiants SIPAT existants et l'ouverture du back-office ont été vérifiées le 14 octobre 2026 : 11 campagnes chargées, formulaire d'ajout accessible et boutons « Modifier » et « Supprimer » activés. L'action « Modifier » de la campagne TopView ouvre le formulaire prérempli et le bouton « Enregistrer les modifications ».
- Le back-office déployé au commit `66d8029` présente l'action « Supprimer » comme une suppression restaurable : la campagne est archivée, retirée du dashboard et peut être restaurée, avec son historique conservé.

**Restent à vérifier :** les opérations d'écriture en production. Aucune création, modification, suppression ou restauration de campagne n'a été exécutée pendant la vérification de l'accès administrateur.

Le fichier source `portal-config.js` reste en mode local pour conserver le prototype utilisable. La production utilise la configuration générée par le build Vercel. L'import déjà réalisé ne synchronise pas SQLite et Supabase ; toute nouvelle modification locale reste locale.

## Installation d'un nouvel environnement

Ces étapes décrivent une installation complète. Pour la production ci-dessus, ne pas réappliquer la migration initiale ni réimporter les campagnes. Appliquer uniquement les migrations suivantes encore manquantes, puis poursuivre la validation authentifiée.

1. Créer le projet Supabase destiné au portail.
2. Exécuter `migrations/202610040001_portal.sql`, puis `migrations/202610140001_campaign_reach_frequency.sql`, puis `migrations/202610140002_remove_trueviews.sql` dans le SQL Editor avec le propriétaire de la base, ou avec le mécanisme de migrations Supabase. Chaque script transactionnel s'exécute une fois, dans cet ordre.
3. Dans Authentication, désactiver les inscriptions publiques et les connexions anonymes. Configurer l'URL du site et les URL de retour autorisées avec le domaine du portail.
4. Créer les comptes Richmedia et YES dans Authentication avec un accès e-mail/mot de passe opérationnel. Attribuer à chacun sa ligne dans `portal_memberships` en adaptant `provision-membership.sql.example`. Les UUID doivent venir de vrais comptes Auth. Aucun premier utilisateur ne devient administrateur automatiquement. L'administrateur configure les mots de passe directement dans Supabase ; ne pas les mettre dans ce dépôt ou dans la conversation. Le portail ne traite pas encore les liens d'invitation ou de récupération de mot de passe : ne pas compter sur ces liens pour ouvrir le premier accès.
5. Renseigner la configuration de l'interface avec l'URL du projet, sa clé **publishable** (ou l'ancienne clé **anon**) et l'identifiant client `yes-baby`. Une clé `service_role` ou `secret` ne doit jamais se trouver dans le navigateur ni dans GitHub.
6. Vérifier avec deux comptes distincts : Richmedia peut enregistrer ; YES peut lire les campagnes actives mais ne peut ni modifier, ni lire les archives ou l'historique. Une session sans appartenance au client n'a aucun accès.

Les fichiers SQL, sauvegardes, tests et données SQLite doivent être exclus du répertoire publié par l'hébergeur. Le build du portail doit publier uniquement les ressources de l'interface.

Pour initialiser un nouvel environnement à zéro après la migration du schéma, les scripts `seed-yes-youtube.sql`, `seed-yes-facebook.sql`, `seed-yes-instagram.sql` et `seed-yes-tiktok.sql` contiennent les 11 campagnes demandées le 4 octobre 2026, sur la période du 01/10/2026 au 31/12/2026. Ils sont idempotents : ils ne dupliquent ni ne remettent à zéro les campagnes existantes. Pour transférer des données locales qui ont évolué, exporter leur état actuel et importer ces données plutôt que les zéros initiaux des scripts. L'import vers la production actuelle est déjà terminé. Ces fiches servent au reporting ; leur création ne lance aucune campagne publicitaire.

Pour Vercel, les variables sont `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PORTAL_CLIENT_ID=yes-baby`. La clé se trouve dans les réglages API du projet ; choisir une clé **Publishable**, ou l'ancienne clé **anon**, et jamais une clé privilégiée. Le [README du portail](../README.md) détaille le build et les réglages Vercel. Aucun mot de passe PostgreSQL ni chaîne de connexion à la base n'est requis dans Vercel pour cette version.

Une fois les comptes opérationnels, pour activer Supabase sur l'aperçu local, remplacer les valeurs de `portal-config.js` par `backend: 'supabase'`, l'URL, la clé publique et `clientId: 'yes-baby'`, puis exécuter `npm ci` et `npm run vendor`. Cette activation n'importe pas la base SQLite locale et ne synchronise pas les deux stockages. Cette bascule locale n'a pas été effectuée ; le build Vercel génère déjà sa propre configuration Supabase.

## Mise à jour Reach et fréquence

Sur une base ayant déjà reçu la migration initiale, appliquer seulement `migrations/202610140001_campaign_reach_frequency.sql`. Cette migration ajoute `reach` et la colonne calculée `frequency`, puis adapte la validation et les RPC sans changer les droits d'accès. Elle ne réinitialise pas les chiffres et n'exige aucun nouvel import. Les anciennes campagnes reçoivent un Reach `null` et une fréquence `null`.

`reach` est facultatif, entier et positif ou nul. `frequency` vaut `impressions / reach` si le Reach est strictement positif ; sinon elle reste `null`. Le formulaire recalcule cette fréquence pendant la saisie, et PostgreSQL la calcule indépendamment à l'enregistrement. Une fréquence envoyée par le navigateur ne remplace pas le calcul serveur. Une modification provenant d'un ancien formulaire qui omet `reach` conserve le Reach enregistré ; transmettre explicitement `reach: null` efface la mesure.

Le reporting expose ces mesures par campagne. Sans déduplication des audiences, il n'additionne pas les Reach entre campagnes et ne calcule pas de fréquence globale sur plusieurs campagnes. Ces agrégats restent inconnus.

## Accès et données

La migration `202610140002_remove_trueviews.sql` retire la métrique TrueViews des lectures et écritures du portail. Les anciennes valeurs et les instantanés d'audit restent conservés pour l'historique ; ils ne sont plus utilisés par le formulaire, les tableaux, les fiches ou les exports. Un ancien navigateur qui transmet encore ce champ ne modifie pas sa valeur historique. Les vues vidéo restent disponibles.

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

Champs d'une campagne côté interface : `id`, `revision`, `channel`, `name`, `start`, `end`, `budget`, `spend`, `impressions`, `reach`, `frequency`, `clicks`, `views`, `interactions`, `ctr`, `status`, `source`, `createdAt`, `updatedAt`. Les champs JSON `id`, `revision` à la création, `ctr`, `frequency`, `source`, `client_id`, `createdAt` et `updatedAt` ne permettent pas de contourner les valeurs gérées par le serveur.

La limite de 9 000 milliards maintient les compteurs dans la plage des entiers exacts JavaScript. Seuls les nombres JSON sont acceptés, pas les chaînes numériques ni les booléens. Les montants ont au maximum deux décimales ; les compteurs sont entiers ; les dates ISO sont validées et ordonnées.

## Tests locaux

`python3 supabase/tests/test_database.py` crée un cluster PostgreSQL temporaire isolé, applique le vrai SQL, teste les autorisations et les opérations, puis détruit le cluster. Le test nécessite les outils PostgreSQL `initdb`, `pg_ctl`, `psql` (PostgreSQL 15 ou ultérieur). On peut définir `PORTAL_PG_BIN` pour indiquer leur dossier.

Les comptes Auth et `auth.uid()` sont simulés uniquement dans ce cluster de test ; aucune base existante ou distante n'est utilisée. Ces tests couvrent PostgreSQL et les politiques, pas le serveur Supabase Auth ou les URL de redirection du projet réel.

Documentation : [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [fonctions et droits d'exécution](https://supabase.com/docs/guides/database/functions), [sécurisation de l'API](https://supabase.com/docs/guides/api/securing-your-api).
