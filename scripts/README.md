# Déployer Memos Material doux avec Docker

Cette procédure construit l’interface personnalisée et le backend du dépôt. Le
fichier `compose.yaml` utilise l’image officielle de Memos ; il ne lance pas cette
version personnalisée.

## 1. Compiler l’interface

Depuis la racine du dépôt, avec Docker disponible :

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$PWD:/workspace" \
  --workdir /workspace/web \
  node:24-slim \
  sh -c 'npx --yes pnpm@11.0.1 install --frozen-lockfile && npx --yes pnpm@11.0.1 release'
```

L’interface compilée est placée dans `server/frontend/dist/`. Cette commande
s’adresse à un hôte Linux ou macOS avec un shell compatible Bash. Elle évite
d’installer Node et pnpm sur l’hôte et conserve le propriétaire des fichiers.

## 2. Construire l’image

Depuis la racine du dépôt :

```bash
docker build --platform linux/amd64 \
  -f scripts/Dockerfile \
  --build-arg VERSION="$(bash scripts/release_version.sh development-version)" \
  --build-arg COMMIT="$(git rev-parse HEAD)" \
  -t memos-material:local \
  .
```

Docker compile le backend Go et y embarque l’interface. L’image obtenue cible un
serveur Intel/AMD 64 bits. Pour un serveur ARM 64 bits, remplacer `linux/amd64` par
`linux/arm64` ; la construction croisée peut nécessiter l’émulation configurée
dans Docker.

## 3. Transférer l’image

Sur la machine de construction :

```bash
mkdir -p build
docker save --output build/memos-material-amd64.tar memos-material:local
```

Transférer l’archive sur le serveur, puis l’importer depuis son répertoire :

```bash
docker load --input memos-material-amd64.tar
```

Le serveur n’a pas besoin de Node, pnpm ou Go. Les bundles et archives de
construction sont ignorés par Git.

## 4. Lancer le serveur

```bash
docker run -d \
  --name memos-material \
  --restart unless-stopped \
  --publish 5230:5230 \
  --mount type=volume,source=memos-material-data,target=/var/opt/memos \
  memos-material:local
```

Ouvrir `http://ADRESSE_DU_SERVEUR:5230` depuis le PC ou le smartphone sur un réseau
qui permet cet accès. Le port est publié sur les interfaces réseau de l’hôte.
Pour un accès Internet et une installation navigateur dans un contexte sécurisé,
placer le service derrière un reverse proxy HTTPS. Ce proxy doit transmettre les
requêtes API et laisser les réponses SSE circuler sans mise en tampon.

Les données SQLite et les fichiers locaux sont conservés dans le volume
`memos-material-data`. Sauvegarder ce volume avant une mise à jour ; une nouvelle
version peut appliquer des migrations au démarrage. Ne pas utiliser un volume de
production pour un essai de démarrage.

## Vérifier et redémarrer

```bash
docker logs memos-material
docker restart memos-material
```

Le redémarrage conserve les données et ne nécessite aucune compilation. La
commande de création du conteneur n’est pas idempotente : la répéter avec le même
nom échoue si le conteneur existe déjà. Une nouvelle construction avec le tag
`memos-material:local` remplace ce tag, mais ne met pas à jour un conteneur déjà
lancé. Pour changer de version, sauvegarder les données puis recréer le conteneur
avec la nouvelle image en réutilisant le volume.
