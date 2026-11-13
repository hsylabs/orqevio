# Publicar una versión

Una versión se publica al subir su etiqueta (`v0.2.0`) a `main`. El flujo `.github/workflows/release.yml` comprueba la versión y pasa las pruebas, y después publica:

1. la imagen Docker `ghcr.io/hsylabs/orqevio` (amd64 y arm64);
2. los paquetes npm `orqevio` y, por último, `create-orqevio`, con procedencia verificable;
3. la release de GitHub, con las notas de `CHANGELOG.md`.

**El orden importa:** cada copia descubre las versiones nuevas por la etiqueta `latest` de `create-orqevio`. Como se publica después de la imagen y de `orqevio`, el aviso de la app nunca ofrece algo que aún no se puede instalar.

## Una sola vez, antes de la primera versión

En este orden; cada paso depende del anterior (comprobado el 13-11-2026):

1. **Repositorio público, justo antes de publicar.** Lo exigen la procedencia de npm, que solo se firma desde repositorios públicos, y la aprobación obligatoria del entorno `release`, que en los planes Free, Pro y Team solo funciona en repositorios públicos. También el botón «Deploy to Cloudflare» y la guía de Docker de la web, que descarga archivos del repositorio.
2. **Entorno `release`** (Settings → Environments → New environment). En «Required reviewers», añade a quien aprueba las publicaciones: cada publicación en npm esperará su aprobación.
3. **npm.** Una cuenta (u organización) con verificación en dos pasos. Los nombres `orqevio` y `create-orqevio` estaban libres el 13-11-2026.
4. **Token temporal para la primera publicación.** npm solo deja configurar la publicación de confianza en un paquete que ya existe.
   - Créalo en npmjs.com → Access Tokens → Generate New Token, como token granular: permiso de lectura y escritura para publicar, todos los paquetes, «Bypass 2FA» activado y caducidad de pocos días.
   - Guárdalo como secreto `NPM_TOKEN` **del entorno `release`**, no del repositorio.
   - npm retirará en enero de 2027 la publicación directa con estos tokens. Si la primera versión llega después, revisa este paso.
5. **Primera versión**, como en «Cada versión». Conviene que sea de prueba (por ejemplo `1.0.0-rc.1`): valida todo el circuito antes de la definitiva.
6. **Publicación de confianza, justo antes de la siguiente versión.** En npmjs.com, en los ajustes de cada paquete → Trusted Publisher → GitHub Actions:
   - organización `hsylabs`, repositorio `orqevio`, flujo `release.yml` y entorno `release`;
   - en «Allowed actions», marca **npm publish**: las configuraciones creadas desde septiembre de 2026 solo permiten `npm stage publish` por defecto;
   - una configuración nueva caduca si no se usa en 2 días, así que créala cuando vayas a publicar.
7. **Retira el token** en cuanto una versión salga con la publicación de confianza: borra el secreto `NPM_TOKEN` y revoca el token en npmjs.com.
8. **GHCR.** Tras la primera publicación, si el paquete `orqevio` aparece privado en GitHub → Packages, hazlo público (Package settings → Change visibility).

## Web pública (orqevio.com)

`apps/site` se publica con Workers Builds, como las demás webs de HSY Labs, **después** de hacer público el repositorio: enlaza a GitHub y su guía de Docker descarga archivos de él.

1. En Workers & Pages → Create application → Import a repository, elige `hsylabs/orqevio` con esta configuración:

   | Opción | Valor |
   | --- | --- |
   | Project name | `orqevio-site`, el `name` de `apps/site/wrangler.jsonc` |
   | Root directory | `apps/site` |
   | Build command | `pnpm install --frozen-lockfile --filter @orqevio/site && pnpm build` |
   | Deploy command | `npx wrangler deploy` |
   | Preview command | `npx wrangler preview` |
   | Variable de compilación | `SKIP_DEPENDENCY_INSTALL` = `1`: la instalación filtrada no compila el resto del monorepo |

2. En Settings → Build → Branch control, elige **`main`** como rama de producción.
3. El dominio `orqevio.com` lo asocia el propio despliegue (`routes` en `wrangler.jsonc`), sin URL de producción en `workers.dev`. Las ramas obtienen previews en `workers.dev`.
4. En la zona `orqevio.com`:
   - para `www`, un registro `AAAA` `100::` con proxy y una regla de redirección 301 a la raíz;
   - en SSL/TLS, «Always Use HTTPS» y TLS 1.2 como mínimo.

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

Para versiones de prueba, usa por ejemplo `0.2.0-rc.1`:
- Se publican en npm con la etiqueta `next` y no mueven `latest` en Docker. Para instalarlas, usa `npx create-orqevio@next`.
- `set-version` no mueve las notas: la versión de prueba publica las de «Sin publicar», que se quedan ahí para que la definitiva las recoja completas.
