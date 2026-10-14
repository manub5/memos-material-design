# Revue Material doux — 2026-10-14

## État pour la reprise

Révision examinée : `c69bf0592`, fonctionnalités comparées à `4eb6fb77e`.
Référence : `docs/superpowers/specs/2026-10-09-material-doux-memos-design.md`
et les plans de couleurs, d’ordre manuel et d’interactions associés.

Les anomalies ci-dessous sont identifiées, mais aucun correctif produit n’a été
appliqué. Le cas exact de la liste signalée par l’utilisateur reste à obtenir :
il ne pouvait pas le tester immédiatement. Ne pas attribuer automatiquement son
blocage à la présence d’une puce vide.

Méthode : diagnostic systématique Superpowers, contre-revue indépendante et
Chromium visible avec de vrais événements souris via Playwright. La seconde
phase utilise l’application complète, ses vraies RPC et un backend local jetable
issu de l’image livrée, avec SQLite en tmpfs. Les comptes et notes de test ont été
créés uniquement dans cette instance temporaire. Le serveur distant n’a pas été
redémarré ni modifié pendant la revue. Les conteneurs de diagnostic ont été arrêtés
et supprimés après les essais.

## P1 — La poignée des publications se dérobe au survol

**Reproduit dans l’application complète avec backend réel.** Arriver de
l’extérieur de la carte au centre de sa poignée, laisser le survol être rendu,
puis appuyer et tirer vers une publication plus basse. Dans l’exécution
enregistrée, la poignée se décale de 28 px. Le point précédemment au centre de la
poignée cible désormais le bouton « More ». Aucun appel `MoveMemo` ne part et
l’ordre serveur reste identique.

**Cause :** `web/src/components/MemoView/MemoView.tsx:196–202` ajoute une ligne
flex sans largeur pleine dans un article aligné `items-start`. L’apparition du
bouton de réaction au survol, dans
`web/src/components/MemoView/components/MemoHeader.tsx:83–88`, agrandit cette
ligne et décale la poignée.

**Contre-épreuve :** une largeur de 100 % appliquée uniquement au DOM du banc
maintient la poignée à sa place. Le même déplacement appelle la vraie RPC et le
nouvel ordre est confirmé par une lecture API. Cette injection n’est pas un
correctif produit.

Un autre essai a enregistré une perte de capture avant le dépôt. Sa cause n’est
pas suffisamment établie pour conclure à une deuxième correction certaine des
cartes. Le défaut de survol est, lui, directement mesuré et isolé.

## P1 — Une puce vide désactive toute une liste courte

**Reproduit dans le vrai éditeur inline :**

```markdown
- red
- blue
-
```

Le contenu de test terminait par une puce suivie d’un espace. Il y a zéro poignée,
y compris pour les deux éléments remplis. Supprimer uniquement la dernière puce
vide, par le clavier, rétablit immédiatement deux poignées.

**Cause :** `web/src/components/MemoEditor/Editor/listReorder.ts:40–48` abandonne
l’analyse de toute la liste au premier item sans enfant ou sans texte. Une puce
vide est pourtant un état courant pendant la saisie et un item CommonMark valide.
Les tests excluent même entièrement `-\n- b`
(`web/tests/editor-list-reorder.test.ts:43–51`).

**Correction attendue :** gérer les items structurels vides valides sans désactiver
toute la liste, en conservant les protections contre les opérations destructrices.

## P1 — Annulation du déplacement pendant l’auto-défilement

**Reproduit au navigateur, notamment dans le vrai composant React Editor.** Sur
une liste de 200 items, tirer la poignée du premier vers le bas de l’éditeur
déclenche l’auto-défilement, puis annule le geste avant le relâchement. Le texte
reste inchangé et aucun changement de contenu n’est émis.

Le plugin capture le pointeur sur le bouton de gouttière
(`web/src/components/MemoEditor/Editor/listReorderExtension.ts:113`) et annule
sur sa perte de capture (`:123`, `:240–241`). Un `MutationObserver` confirme que
CodeMirror détache et réinsère le bouton pendant le défilement, puis le navigateur
émet `lostpointercapture`. La reconnexion du même bouton ne préserve pas la capture.

L’arrêt a été observé à 488 px dans le banc d’extension et à 184 px dans le composant
React. Ces valeurs dépendent de la géométrie, pas d’un seuil métier.

**Contre-épreuve :** déléguer la capture au DOM stable de l’éditeur, uniquement
dans le banc temporaire, permet de dépasser 2 000 px et d’appliquer une seule
modification au dépôt.

**Tests manquants :** `web/tests/editor-list-reorder-extension.test.ts:32–48`
simule la géométrie et `:60–61` remplace la capture native par des espions. Les
tests dits virtualisés ne reproduisent pas ce détachement réel.

## P1 — Perte d’un brouillon sur conflit de pagination

`web/src/hooks/useMemoQueries.ts:200–209` appelle `resetQueries` après un
`Aborted` de page suivante. Les pages disparaissent, la liste devient vide
(`web/src/components/PagedMemoList/PagedMemoList.tsx:180`) et les cartes sont
démontées. Les éditions de mémos existants n’utilisent pas le cache de brouillon
(`web/src/components/MemoEditor/index.tsx:115–122`).

Scénario : édition non enregistrée sur un appareil, modification de collection sur
un autre, puis chargement d’une page avec un token périmé. L’édition locale peut
être perdue au démontage de la carte.

**Preuve :** la contre-revue a reproduit la perte d’état sous jsdom avec les vrais
`PagedMemoList` et `useInfiniteMemos`, et une carte témoin portant un état React
local. L’absence de conservation par le vrai MemoEditor est confirmée dans les
sources. Le scénario complet n’a pas été rejoué au navigateur sur deux appareils.

Les tests existants protègent un refetch échouant avec `Unavailable`, pas le reset
sur `Aborted` avec un éditeur ouvert.

## P1 — Écrasement possible entre deux éditions du même contenu

Le service relit le mémo actuel puis le compare au brouillon ancien
(`web/src/components/MemoEditor/services/memoService.ts:21–35,100–112`). Si le
contenu diffère, il remplace le contenu serveur par celui du brouillon.
`UpdateMemoRequest` ne porte aucune précondition de version
(`proto/api/memo_service.proto:405–414`).

Scénario : téléphone et PC ouvrent la même liste ; le téléphone ajoute une tâche
et enregistre ; le PC réordonne son ancienne copie et enregistre. La tâche récente
peut être effacée sans conflit signalé. SSE ne fusionne pas les brouillons ouverts.

**Preuve :** constat source sur un comportement préexistant réutilisé par la
fonctionnalité de listes, sans reproduction concurrente au navigateur.

## P2 — Une carte invisible bloque certaines destinations

`store/memo_order.go:65–85` utilise tous les mémos actifs du propriétaire. La liste
visible filtre les mémos Space par appartenance active
(`store/db/sqlite/memo_access.go:26–27`). Les ancres doivent pourtant être
adjacentes dans la collection complète (`store/memo_order.go:101–114`).

Ordre stocké `A, X, B, C`, avec X devenu illisible : l’interface affiche `A, B, C`.
Déplacer C entre A et B provoque un conflit puisque X est toujours entre ces ancres
côté serveur. Recharger ne résout pas ce conflit.

**Preuve :** chemin source et fixture SQLite réduite par la contre-revue ; la RPC
Go n’a pas été exécutée pour ce scénario.

## P2 — Positions orphelines après suppression sous SQLite

La migration compte sur `ON DELETE CASCADE`
(`store/migration/sqlite/26.10/00__memo_colors_and_order.sql:3–7`), mais le pilote
désactive les clés étrangères (`store/db/sqlite/sqlite.go:61`). La suppression
n’efface pas explicitement les rangs (`store/db/sqlite/user_delete.go:360–367`).

**Preuve :** source et fixture SQLite réduite. La position subsiste après
suppression ; l’impact établi est l’accumulation et la prise en compte de rangs
orphelins lors de futures créations, pas une perte de cartes démontrée.

## Périmètre et écart secondaire

Le document de conception, ligne 39, prévoit le déplacement des listes dans
CodeMirror. Le rendu de lecture
`web/src/components/MemoContent/markdown/List.tsx` n’expose aucun déplacement.
Si l’attente porte sur la carte affichée, il faut clarifier cet écart avec le
document, sans prétendre que ce parcours serait déjà implémenté.

La réorganisation complète au clavier est explicitement exclue du périmètre de
la conception ; elle n’est pas comptée comme anomalie de conformité.

La palette est annoncée propriétaire uniquement dans le plan, mais `canManageMemo`
inclut les administrateurs : la palette est visible sur des mémos tiers pour un
administrateur. L’API autorise déjà ces modifications administratives. C’est un
écart de périmètre UI, pas un contournement des permissions établi.

## Vérifications, contrôles positifs et limites

- Lors de la revue, 41 tests Vitest de structure et d’extension de liste passent.
- La contre-revue rapporte 58 tests frontend ciblés supplémentaires passants.
- Chromium visible : déplacements simples de puces, tâches, listes numérotées,
  frères imbriqués et parents avec enfants fonctionnels dans le banc.
- Application complète : « More → Edit », déplacement du premier item après le
  troisième, puis « Update » réussissent sur une liste remplie ; une lecture API
  confirme le contenu enregistré. Ce cas positif ne résout pas le cas exact de
  l’utilisateur.
- Les essais de diagnostic reproduisent les défauts de survol, d’item vide et
  d’auto-défilement. Les contre-épreuves valident des pistes de correction, pas
  des correctifs livrés.
- Aucune erreur JavaScript dans les dernières exécutions enregistrées.
- Le cas à 390 px utilise une souris et un banc d’éditeur : ce n’est pas une
  validation complète sur téléphone physique.
- Aucun nouveau test Go, aucune exécution MySQL/PostgreSQL, aucun essai
  Firefox/Safari pendant cette revue.
- Le sous-lancement des tests par pilote dans `store/test/main_test.go` ne
  retransmet pas `-race` et `-run`. L’ancienne commande globale ne prouve donc
  pas à elle seule leur application aux trois pilotes.

## Reprise recommandée

1. Ajouter les régressions navigateur pour la poignée qui se déplace au survol,
   les listes contenant un item vide et la capture native pendant le défilement.
2. Stabiliser l’en-tête des cartes et la capture des items, puis gérer les items
   vides sans affaiblir la validation structurelle du Markdown.
3. Protéger les brouillons lors de la récupération de pagination.
4. Traiter séparément les conflits d’édition et les incohérences de stockage.
5. Vérifier l’exemple exact de l’utilisateur dès qu’il peut le fournir, puis
   valider l’interface et la sauvegarde avant toute nouvelle image livrée.

## Artefacts temporaires de la session

Les fichiers suivants étaient présents dans `/tmp/user/1000/opencode/` lors de
la revue. Ils ne sont pas versionnés et leur conservation n’est pas garantie :

- `playwright-test-memos-list-review.js`, `memos-list-review-results.json` ;
- `playwright-test-memos-full-app.js`, `memos-full-app-results.json` ;
- `memos-review.config.mjs`, `memos-review.html`, `memos-review-entry.js` ;
- captures `list-review-*.png` et `full-app-*.png`.

Les scripts nécessitent leurs conteneurs locaux de diagnostic et leur proxy.
Les comptes et données de test ont été détruits avec le stockage temporaire.
