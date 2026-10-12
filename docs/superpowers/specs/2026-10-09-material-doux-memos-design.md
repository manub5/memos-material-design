# Memos — Material doux, responsive et ordre manuel

## Intention et critères de réussite

Faire de Memos une application de notes compacte, chaleureuse et cohérente, inspirée de l'ergonomie de Google Keep sans en reproduire la marque. L'expérience doit être équivalente sur bureau et mobile, en clair, sombre et thème système. Les utilisateurs doivent pouvoir choisir la couleur d'un mémo, réordonner leurs cartes à la souris ou au doigt et déplacer les éléments de listes Markdown, avec conservation et synchronisation des changements.

Cette conception reprend les décisions exprimées : direction « Material doux », refonte de toute l'application, ordre manuel à la place des tris de la timeline, poignée dédiée aux cartes et prise en charge de la souris et du tactile. Le thème « papier » existant reste fonctionnel. Le tri chronologique du contrat public de l'API demeure disponible pour les clients externes ; seule l'interface de tri de la timeline est remplacée.

## Parcours de réalisation retenu

Procéder progressivement : (1) tokens et thèmes, (2) primitives et surfaces partagées, (3) shell, pages et éditeur, (4) données/API et migrations pour couleurs et ordre, (5) interactions cartes et listes. Cette séquence garde chaque changement vérifiable sans introduire Material UI ni refondre inutilement le routage ou l'éditeur.

## Langage visuel et responsive

- Décliner les variables OKLCH, rayons, ombres et contrastes de `web/src/themes/default.css`, `default-dark.css` et `paper.css`. Conserver les noms de tokens sémantiques, le mécanisme `system` de `web/src/utils/theme.ts` et la densité compacte existante ; garantir des zones de préhension tactiles suffisamment grandes malgré les cartes compactes.
- Adapter les composants de `web/src/components/ui/`, les surfaces de `AppSidebar/`, les layouts, `MemoPanel/`, les composants de paramètres et `AuthPageLayout.tsx`. Réutiliser les variantes et primitives Base UI, CVA et Tailwind au lieu de dupliquer les styles dans chaque page.
- Harmoniser les cartes de `MemoView/` et l'éditeur `MemoEditor/` pour que la création et l'édition n'entraînent pas de saut de surface. Les pages calendrier, carte, pièces jointes, inbox, détails et authentification reçoivent les mêmes tokens ; leurs mises en page spécifiques restent intactes.
- Garder les seuils responsive existants, le calcul de largeur de `ColumnGrid`, les safe areas mobiles et les propriétés logiques RTL. Les contrôles de déplacement ne doivent pas intercepter le défilement ordinaire de la page.
- Prévoir une palette limitée de couleurs sémantiques de carte, avec une valeur neutre par défaut ; les variantes de surface et d'encre propres aux thèmes clair, sombre et papier assurent un contraste lisible. Une couleur n'est jamais l'unique signal d'état.

## Modèle et API

- Étendre `proto/api/memo_service.proto` avec une valeur de palette facultative sur `Memo`. Valider côté serveur une palette fermée plutôt qu'accepter du CSS libre ; absence de valeur = carte neutre. Autoriser la création et la modification via `update_mask`. Générer les sorties Go, OpenAPI et TypeScript avec `buf generate`, sans modification manuelle des fichiers générés.
- Stocker l'ordre manuel par propriétaire et par mémo, indépendamment de la visibilité et du Space, afin qu'un mémo partagé conserve une place personnelle dans la timeline de chaque utilisateur. Un propriétaire ne peut réordonner que sa propre collection de mémos ; les vues publiques, filtrées ou partagées par d'autres conservent un tri stable existant et n'exposent pas de poignée de déplacement. Les mémos nouvellement créés se placent au début ; archivage et restauration conservent une place déterministe, et une suppression retire sa position.
- Fournir une opération dédiée de déplacement atomique plutôt que modifier en masse les dates ou détourner `pinned`. Le serveur vérifie l'identité de l'appelant, les identifiants voisins et le périmètre de la collection avant d'écrire ; une requête répétée aboutit au même ordre. Les déplacements concurrents aboutissent à un ordre total déterministe ; en cas de conflit, le client recharge la liste et affiche une erreur récupérable.
- Les anciennes valeurs de `order_by` restent acceptées par l'API pour préserver les intégrations et les pages non concernées. La timeline du propriétaire demande l'ordre manuel ; ses préférences locales de tri obsolètes sont ignorées sans migration destructive du `localStorage`. L'épinglage reste un attribut fonctionnel et visuel, sans remplacer l'ordre manuel.
- Ajouter les migrations et les `LATEST.sql` pour SQLite, MySQL et PostgreSQL. Conserver le comportement des mémos historiques (couleur neutre, ordre initial déterministe basé sur la date et l'identifiant). Vérifier pagination et filtres pour éviter les doublons ou disparitions après un déplacement.
- Conserver la couleur dans les réponses de détail, partage et export quand le format correspondant transporte déjà les métadonnées du mémo ; ne jamais injecter de chaîne CSS non validée dans une page ou une image exportée.

## Interactions des cartes

- Une poignée identifiable sur la carte active le déplacement à la souris et au tactile ; les clics sur l'édition, les liens, les actions et la sélection de texte gardent leur comportement.
- Dans la timeline du propriétaire, montrer un emplacement cible pendant le déplacement, déplacer visuellement la carte sans remonter le composant, puis enregistrer l'ordre via la nouvelle opération API. L'interface rétablit l'ordre serveur si l'enregistrement échoue et permet de réessayer.
- La grille multi-colonnes de `ColumnGrid/` positionne actuellement ses éléments par translation et utilise `ResizeObserver`. L'interaction doit gérer les mesures pendant le déplacement, l'auto-défilement, la colonne unique, le RTL et les changements de taille sans piéger l'éditeur plein écran. Les mémos encore absents d'une page chargée ne doivent pas devenir des cibles implicites ; l'ordre global reste cohérent avec la pagination.
- Les contrôles restent compréhensibles pour les technologies d'assistance (nom, état, indication de position), même si la réorganisation complète au clavier n'est pas incluse dans ce périmètre.

## Déplacement des listes et tâches Markdown

- Ajouter une action de déplacement sur les éléments de listes à puces, numérotées et tâches dans l'éditeur CodeMirror existant. Une entrée parent emmène avec elle ses sous-entrées ; aucune ligne située dans un bloc de code, une citation ou un paragraphe ordinaire ne devient déplaçable.
- Calculer les plages à partir de la structure Markdown, modifier uniquement le texte du mémo et réutiliser la sauvegarde de contenu déjà existante. Respecter indentation, marqueurs de cases, espaces, fins de ligne et historique d'annulation ; une liste ambiguë ou mal formée ne produit pas de déplacement destructeur.
- La sauvegarde du contenu fournit la synchronisation inter-appareils ; éviter de multiplier les requêtes pendant un mouvement. Préserver le comportement actuel des listes à cases cochables dans le rendu Markdown.

## Vérification et risques

- Tests ciblés frontend : thèmes et surfaces, affichage responsive/RTL, déplacement souris/tactile, échec et reprise, sauvegarde de liste imbriquée, absence de déplacement accidentel lors du défilement.
- Tests backend/store : droits du propriétaire, validation de couleur, création et migration historiques, concurrence, idempotence, pagination stable, parité SQLite/MySQL/PostgreSQL.
- Vérifications du dépôt : `cd web && pnpm lint && pnpm test && pnpm build`, `cd proto && buf generate && buf lint`, ainsi que les tests Go adaptés aux couches touchées. Effectuer une vérification visuelle desktop/mobile des thèmes clair, sombre et papier.
- Risques principaux : conflit entre translations de la grille et geste de déplacement, pagination d'un ordre modifiable, déclenchement involontaire au tactile, et corruption de listes imbriquées. La conception privilégie donc une poignée, une mutation serveur atomique, un rechargement en cas d'échec et une manipulation Markdown structurée.
