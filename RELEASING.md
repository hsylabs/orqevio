# Publicar una versión

Una versión se publica al subir su etiqueta (`v0.2.0`) a `main`. El flujo `.github/workflows/release.yml` comprueba la versión y pasa las pruebas, y después publica:

1. los paquetes npm `orqevio` y `create-orqevio`, con procedencia verificable;
2. la imagen Docker `ghcr.io/hsylabs/orqevio` (amd64 y arm64);
3. la release de GitHub, con las notas de `CHANGELOG.md`. Va al final, para que nunca anuncie algo que aún no se puede instalar.

## Una sola vez, antes de la primera versión

- **Repositorio público.** Lo exigen el botón «Deploy to Cloudflare» y la procedencia de npm.
- **npm:**
  1. Crea la cuenta u organización y reserva `orqevio` y `create-orqevio`.
  2. En cada paquete, configura la publicación de confianza: proveedor GitHub Actions, repositorio `hsylabs/orqevio`, flujo `release.yml` y entorno `release`.
  3. Si npm exige que el paquete exista antes de configurarla, publica la primera versión con un token granular guardado como secreto `NPM_TOKEN`, y bórralo después.
- **Entorno `release`** (Settings → Environments). Añade revisores obligatorios: así cada publicación en npm espera tu aprobación.
- **GHCR.** Tras la primera publicación, marca el paquete `orqevio` como público en GitHub → Packages.

## Cada versión

1. Escribe las novedades en la sección `## [Sin publicar]` de `CHANGELOG.md`.
2. Fija la versión en todos los paquetes, la plantilla y el registro de cambios. Elige el número según el tipo de cambio:
   - `0.x.y` mientras no haya versión estable;
   - el tercer número sube para correcciones, el segundo para novedades y el primero para cambios incompatibles.

   ```bash
   node scripts/release/set-version.mjs 0.2.0
   ```

   ```bash
   pnpm install
   ```
3. Abre un PR hacia `develop` y, cuando esté fusionado, otro de `develop` a `main`.
4. Con el cambio ya en `main`, crea y sube la etiqueta:

   ```bash
   git tag v0.2.0 origin/main
   ```

   ```bash
   git push origin v0.2.0
   ```

Para versiones de prueba, usa por ejemplo `0.2.0-rc.1`. Se publican en npm con la etiqueta `next` y no mueven `latest` en Docker.
