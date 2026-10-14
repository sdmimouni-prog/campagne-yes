# Richmedia — portail client YES

Interface en français, identité Richmedia (noir et violet) et espace YES Baby Comfort.

## Supabase et Vercel

Le portail de production est déployé sur [campagne-yes-ten.vercel.app](https://campagne-yes-ten.vercel.app), en mode Supabase. Le premier déploiement opérationnel utilise le commit `8ad996c`. Supabase stocke les campagnes et gère la connexion ; Vercel sert l'interface statique construite depuis GitHub. Aucune base supplémentaire n'est nécessaire chez Vercel. La page de gestion conserve son lien séparé, réservé aux comptes ayant le rôle `admin`.

**État vérifié de la production :** le projet Supabase `jfsxvrfpaxacxbpemlgo` est configuré, la migration SQL a été appliquée et les 11 campagnes locales ont été importées avec leurs identifiants et leurs dates de création et de modification d'origine. Toutes sont actives, avec les montants et compteurs à zéro. Les trois variables Vercel sont définies pour l'environnement **Production**. Les inscriptions publiques et les connexions anonymes sont désactivées ; la Site URL Supabase correspond au domaine de production. Les lectures anonymes de la table des campagnes et de la RPC de liste ont été refusées avec HTTP `401` et le code PostgreSQL `42501`.

La [migration additive `202610140001`](supabase/migrations/202610140001_campaign_reach_frequency.sql) a été appliquée en production le 14 octobre 2026 après la migration initiale. L'API authentifiée expose bien `reach` et `frequency` sur les 17 campagnes présentes lors de la vérification. Elle conserve les campagnes existantes, dont le Reach reste inconnu jusqu'à sa saisie.

Le compte SIPAT est créé dans Auth. Le 14 octobre 2026, à la demande explicite de l'utilisateur et après sa confirmation, son rôle pour `yes-baby` dans `portal_memberships` a été changé de `viewer` à `admin`. L'enregistrement a été confirmé dans Supabase. Ce rôle autorise l'ajout, la modification, la suppression restaurable et la restauration des campagnes. Le back-office déployé au commit `66d8029` présente l'action « Supprimer » comme une suppression restaurable.

La connexion avec les identifiants SIPAT existants ouvre désormais le back-office : les 11 campagnes, le formulaire d'ajout et les actions « Modifier » et « Supprimer » sont accessibles. L'ouverture du formulaire prérempli de la campagne TopView a été vérifiée. Aucune campagne n'a été modifiée pendant ce contrôle ; les opérations d'écriture restent à vérifier en production. Voir le [guide Supabase](supabase/README.md).

Le fichier source `portal-config.js` conserve volontairement le mode local pour que le prototype reste utilisable. Le site Vercel utilise sa propre configuration générée au build. Les données locales et celles de Supabase sont désormais deux copies indépendantes : aucune synchronisation automatique n'est active. Le build de production active obligatoirement Supabase et refuse de continuer si la configuration manque. Il ne publie jamais un accès local sans authentification.

### Nouvelle installation

Les étapes suivantes servent à installer un autre environnement ; elles ne sont pas à répéter sur la production déjà configurée.

1. Créer le projet, appliquer les migrations SQL dans l'ordre indiqué dans le [guide Supabase](supabase/README.md), importer les campagnes souhaitées, puis créer les comptes et leurs rôles.
2. Installer les dépendances avec `npm ci` (Node.js 22 ou supérieur).
3. Importer le dépôt `sdmimouni-prog/campagne-yes` dans Vercel. Le portail est à la racine du dépôt : conserver **Root Directory** sur `.`. Framework : **Other** ; commande de build : `npm run build` ; dossier publié : `dist`. Le fichier `vercel.json` définit déjà les deux derniers réglages.
4. Dans les variables Vercel, renseigner `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `PORTAL_CLIENT_ID=yes-baby`. Utiliser les valeurs du projet voulu pour l'environnement de production ; un environnement de test devrait avoir son propre projet et ses propres comptes.
5. Déployer, puis tester avec un compte administrateur Richmedia et un compte lecteur YES. Toute modification des variables nécessite un nouveau build.

Ces trois paramètres sont publics et sont intégrés au JavaScript du navigateur. **Ne jamais fournir de clé `secret` ou `service_role`.** Les droits reposent sur Supabase Auth et les politiques SQL, pas sur le secret de l'URL de gestion. Le SDK Supabase est installé avec npm et inclus dans le build ; aucun CDN n'est nécessaire.

Le dossier publié contient uniquement l'interface et ses ressources : aucun SQL, fichier SQLite, test, source Python ou fichier `.env`. Les fichiers sources et les migrations peuvent être versionnés dans GitHub ; les données et identifiants privés en sont exclus.

## Démarrage local

Depuis ce dossier, avec Python 3.10 ou supérieur, le mode local existant fonctionne sans Supabase :

```sh
python3 server.py --port 8768
```

- Connexion : http://127.0.0.1:8768/
- Dashboard : http://127.0.0.1:8768/dashboard.html#overview
- Gestion : http://127.0.0.1:8768/gestion-campagnes.html

La gestion est accessible par son lien direct, sans entrée dans le menu client. Le serveur de gestion remplace le serveur statique : `python -m http.server` ne permet pas de sauvegarder les campagnes.

## Saisie des campagnes

Canaux : Facebook, Instagram, YouTube, TikTok et Display. Le formulaire comprend le nom, la période des résultats, le budget (MAD), les impressions, le Reach, la fréquence calculée, les clics, le CTR calculé, les vues vidéo et les interactions. Les dépenses réelles sont facultatives et distinctes du budget.

Une campagne contient les **totaux cumulés sur la période indiquée**. Une modification remplace les anciens totaux, sans les additionner. Le CTR vaut `clics / impressions × 100` ; il est indéterminé en base quand les impressions sont nulles. Pour une campagne initialisée explicitement à zéro clic et zéro impression, l'interface affiche `0,00 %` et exporte `0` par convention de présentation. Un champ inconnu ou un calcul impossible reste « — ». Une donnée facultative vide reste inconnue, contrairement à un zéro réellement saisi. Les agrégats incomplets restent inconnus.

Le **Reach** est une saisie facultative du nombre entier de personnes uniques touchées sur la période. La **fréquence** est calculée automatiquement : `impressions / Reach`, en affichages par personne. Elle reste « — » si le Reach est vide ou égal à zéro ; elle ne se saisit pas séparément. Les valeurs sont disponibles par campagne dans les tableaux, détails et CSV. Les audiences uniques peuvent se chevaucher : le Reach et la fréquence ne sont ni additionnés ni moyennés entre campagnes. Un agrégat comprenant plusieurs campagnes les laisse inconnus ; sélectionner une seule campagne permet de consulter ses propres valeurs.

La liste permet de modifier, supprimer et restaurer. « Supprimer » archive la campagne sans effacer son historique ; elle est alors exclue du dashboard et peut être restaurée. Les mises à jour utilisent une version de chaque fiche : deux fenêtres ne peuvent pas écraser silencieusement leurs modifications. Le dashboard se rafraîchit à son ouverture, au retour sur l’onglet et lors d’une sauvegarde depuis un autre onglet de la même origine.

En mode Supabase, les données sont partagées entre les appareils, avec un historique horodaté de chaque modification et de son auteur. Le rôle `admin` permet de créer, modifier, supprimer et restaurer ; le rôle `viewer` donne un accès en lecture aux campagnes actives. Le compte SIPAT possède désormais le rôle `admin`. Les contrôles s'appliquent aussi aux appels directs à l'API.

En mode local uniquement, le serveur conserve les données dans `.data/campaigns.sqlite3`, avec un historique des changements. La base reste après redémarrage. Ce dossier est exclu de Git et inaccessible depuis HTTP. Pour sauvegarder les données, arrêter le serveur et copier la base, puis redémarrer. L'import initial vers Supabase a été réalisé ; les changements ultérieurs dans SQLite ne sont pas transférés automatiquement et doivent faire l'objet d'un import vérifié si nécessaire.

Les 11 campagnes créées le 4 octobre 2026 sont présentes dans Supabase et dans l'aperçu local, sur la période du plan média du 1er octobre au 31 décembre 2026 :

- YouTube : Reach 30 s InStream désactivable, Reach 15 s InStream non désactivable, Awareness 7 s InStream non désactivable et Awareness 5 s Bumper.
- Facebook : « Yes - Facebook - Reel » et « Yes - Facebook - Story ».
- Instagram : « Yes - Instagram - Reel » et « Yes - Instagram - Story ».
- TikTok : « Yes - TikTok - In-Feed classique », « Yes - TikTok - Spark Ads » et « Yes - TikTok - TopView ».

L'import de production a conservé les UUID et les horodatages `created_at` et `updated_at` d'origine. Les scripts d'initialisation [YouTube](supabase/seed-yes-youtube.sql), [Facebook](supabase/seed-yes-facebook.sql), [Instagram](supabase/seed-yes-instagram.sql) et [TikTok](supabase/seed-yes-tiktok.sql) restent disponibles pour une nouvelle installation à zéro. Ils sont idempotents : ils ne dupliquent ni ne remettent à zéro les campagnes existantes. Pour migrer des chiffres qui ont évolué, exporter l'état actuel et importer ces données plutôt que les zéros initiaux. Ces fiches servent au reporting ; leur création ne lance aucune campagne publicitaire.

## Dashboard et sources

- Facebook et Instagram sont réunis dans Meta ; leurs campagnes restent distinctes dans le tableau et le filtre.
- Les tableaux Meta, YouTube et TikTok précèdent les indicateurs et graphiques.
- Display devient actif dès qu’une campagne y est créée. Influence, SMS, WhatsApp et Emailing restent vides.
- Toutes les données demandées sont disponibles dans les tableaux, fiches et export CSV. Les cellules CSV vides signifient « non renseigné » ; la source et la période cumulée sont indiquées. Les noms sont protégés contre l’interprétation de formules lors de l’export.
- En mode manuel, le filtre initial est « Toutes les périodes ». Un mois ne comprend que les campagnes dont la période entière appartient à ce mois. Les périodes qui chevauchent un mois sont exclues avec un message explicite : aucun prorata n’est fabriqué.
- Des totaux cumulés ne permettent pas de reconstruire une courbe quotidienne ou des répartitions par ville, sexe et âge. Ces graphiques restent sans données, sauf une courbe lorsqu’on dispose uniquement de résultats sur une journée par fiche. L’intégration des plateformes publicitaires reste à réaliser.

En mode local, avant la première saisie, le dashboard conserve sa démonstration, clairement identifiée : résultats fictifs et budgets Meta 40 000, YouTube 53 000, TikTok 45 000 MAD HT issus du plan média fourni. **La première sauvegarde remplace entièrement ce jeu de démonstration.** Il ne revient pas si toutes les campagnes sont archivées. En mode Supabase, une base vide affiche une liste vide dès le départ. Une erreur API affiche un problème de chargement ou conserve les derniers résultats avec un avertissement ; elle ne substitue jamais des chiffres simulés. Une perte d'accès efface les résultats affichés.

## Accès

En mode Supabase, la connexion utilise l'e-mail et le mot de passe du compte Auth, puis vérifie son appartenance à YES et son rôle. Le dashboard demande une session valide ; la gestion demande le rôle `admin`. Aucune inscription publique n'est proposée. Un compte sans appartenance au client reste bloqué. La connexion redirige directement vers le dashboard, ou vers la page de gestion si l'utilisateur administrateur venait de son lien direct.

« Se souvenir de moi » conserve la session dans ce navigateur ; sans cette option, elle dure le temps de l'onglet. La déconnexion efface la session sur les autres onglets ouverts. Les mots de passe ne sont jamais conservés par le code du portail. Les liens d'aide contactent `contact@richmedia.ma` ; l'activation par invitation et la réinitialisation du mot de passe ne disposent pas encore d'un parcours dans le portail.

Le mode local reste un prototype sans comptes ni contrôle d'accès utilisateur ; le serveur écoute uniquement `127.0.0.1`. Il n'est pas utilisable comme backend d'un site public.

Les identifiants tapés sur le prototype de connexion ne sont pas envoyés ni stockés. Après validation des champs e-mail et mot de passe, « Se connecter » ouvre directement le dashboard, sans fenêtre intermédiaire ; cette navigation ne crée pas de session authentifiée. La page d’authentification conserve son format sans défilement aux tailles vérifiées. Les logos fournis sont conservés ; la capture YES est cadrée en CSS.

## Vérifications

```sh
python3 -m unittest test_server.py
npm test
python3 supabase/tests/test_database.py
```

Tests API locale : création, remplacement, conflit de version, sauvegarde persistante, archivage/restauration, validation, CTR, distinction zéro/inconnu, contrôle des requêtes locales et protection du stockage. Tests reporting : regroupement Meta, filtres cumulatifs, périodes, métriques manquantes, archives, absence de courbes/profils inventés, erreurs de source. Tests service : session, rôles, RPC, erreurs, déconnexion, stockage et contrat du SDK réel avec transport simulé. Tests build : configuration obligatoire et refus des clés privilégiées. Tests PostgreSQL : RLS, isolation des clients, validations, historique et conflits, dans une base temporaire isolée (outils PostgreSQL requis).

Pour préparer le SDK sur le serveur local après configuration de Supabase : `npm run vendor`. Pour compiler l'aperçu local : `npm run build:local` (interdit pour un déploiement Vercel). Pour tester le build de production sur l'ordinateur, utiliser les variables de `.env.example` avec `node --env-file=.env scripts/build.mjs` ; le script ne charge pas `.env` implicitement.

Sur la production, le déploiement, l'import des 11 campagnes, la configuration de la Site URL et le refus des lectures anonymes ont été vérifiés. Les pages dashboard et gestion redirigent bien vers la connexion en l'absence de session. Le 14 octobre 2026, la connexion du compte SIPAT au back-office avec son rôle `admin` a été vérifiée : 11 campagnes chargées, formulaire d'ajout accessible et boutons « Modifier » et « Supprimer » activés. « Modifier » sur la campagne TopView ouvre les valeurs préremplies et le bouton « Enregistrer les modifications ». Aucune création, modification, suppression ou restauration de campagne n'a été exécutée pendant cette vérification ; les écritures en production restent à tester. Les tests locaux ne remplacent pas ces contrôles sur le projet Supabase réel.

Les essais de navigateur utilisent une copie du serveur sur le port 8769 et une base de test hors projet, sans ajouter de fausses campagnes dans la base utilisateur. Le téléchargement CSV doit encore être vérifié dans le navigateur de production : le navigateur intégré permet de préparer le fichier mais n’a pas confirmé sa sauvegarde sur disque.
