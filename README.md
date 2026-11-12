# Orqevio

**Un espacio de trabajo donde organizas tus proyectos, documentas tu conocimiento y proteges tus credenciales. Todo accesible para ti y tus agentes de IA, con permisos controlados.**

Orqevio reúne cuatro piezas y solo esas cuatro:

| Módulo | Qué incluye |
| --- | --- |
| **Tareas** | Espacios, proyectos, tableros Kanban, columnas, tarjetas, etiquetas, fechas, checklists, archivo y adjuntos. |
| **Documentación** | Páginas jerárquicas con editor por bloques que guarda Markdown, tablas sencillas, imágenes y archivos, y enlaces directos con tareas. |
| **Bóveda** | Credenciales y notas privadas cifradas de extremo a extremo, generador de contraseñas, clave de recuperación y bloqueo automático. |
| **Agentes (MCP)** | Servidor MCP con tokens por espacio y permisos diferenciados para consultar documentación, crear tareas y reorganizar tableros. |

La decisión central: **la bóveda está aislada de los agentes**. Ningún token puede acceder a ella, ni siquiera a su contenido cifrado, y el servidor nunca conoce los secretos.

**Cada copia de Orqevio es de una sola persona.** No hay registro ni correo: la primera vez se reclama con un código de configuración y, a partir de ahí, se entra con una clave de acceso.

---

## Experiencia

- **Relación directa entre tareas y documentos.** Escribe `@` en un documento para enlazar una tarea: el vínculo aparece en ambos lados. También puedes vincular documentos desde la tarjeta.
- **Tus agentes, en directo.** Cuando un agente crea o mueve una tarjeta, la ves aparecer con un halo azul y su nombre, y recibes un aviso. El punto del logotipo se vuelve azul mientras trabajan.
- **Sin pisarse.** Los documentos usan control de versiones optimista: si un agente edita mientras escribes, Orqevio te avisa y eliges qué versión conservar.
- **Teclado primero.** `⌘K`/`Ctrl K` abre la paleta para buscar y saltar a cualquier sitio; `⌘\` oculta la barra lateral; el Kanban se puede reorganizar entero con teclado (espacio para coger, flechas, espacio para soltar), con anuncios para lector de pantalla.
- **Identidad propia.** Papel cálido, tinta y dos señales de color: caqui para ti, ultramar para los agentes. Tipografía editorial (Fraunces) sobre una interfaz sobria (Instrument Sans). Tema claro y oscuro, con los tonos de texto ajustados a contraste WCAG AA.

## Arquitectura

```
apps/web        React 19 + Vite · TanStack Query · React Router · Tailwind CSS 4
                TipTap 3 (Markdown nativo) · dnd-kit · Radix UI · cmdk
apps/server     Hono · Drizzle ORM · SQLite (FTS5) · SDK oficial de MCP
                Node 22 (Docker) o Cloudflare Workers + Durable Objects + R2
packages/shared Esquemas zod, permisos y tipos compartidos por API, MCP y cliente
```

```
          Navegador (sesión)                       Cliente MCP (token Bearer)
                 │                                          │
           REST /api/*                                 POST /mcp
                 │                                          │
                 └──────────────► Servicios de dominio ◄────┘
                                 (permisos y validación)
                                          │
                        SQLite (un archivo) ── eventos en memoria ──► WebSocket en tiempo real
```

- **Una sola capa de dominio.** La API REST de la aplicación y las herramientas MCP llaman exactamente a los mismos servicios. Cada operación comprueba el acceso al espacio y el permiso concreto (`tasks:read`, `tasks:write`, `docs:read`, `docs:write`), así que las reglas se aplican una única vez.
- **Markdown como formato canónico.** Documentos y descripciones se guardan en Markdown (GFM). Es portable, legible y lo que mejor entienden los LLM. Las referencias internas son enlaces normales: `[Título](/card/<id>)` y `[Título](/doc/<id>)`.
- **Una copia, una base de datos.** Cada copia es de una persona y guarda todo en SQLite, con transacciones síncronas. El mismo código corre en dos sitios:
  - **Servidor propio (Docker o Node):** un único archivo (`DATA_DIR/orqevio.db`) más la carpeta de adjuntos.
  - **Cloudflare:** un Worker sirve la web y envía `/api` y `/mcp` a un único Durable Object, que guarda los datos en su propio SQLite; los adjuntos van a R2.
- **Adjuntos en streaming.** El navegador envía el archivo tal cual (no como formulario) y el servidor lo pasa directamente al disco o a R2, comprobando su tamaño y su tipo real. La memoria y la CPU no dependen del tamaño del archivo.
- **Búsqueda de texto completo.** Índices FTS5 sobre títulos y contenido de tarjetas y documentos, sin distinguir mayúsculas ni acentos («cancion» encuentra «Canción»), con el título por delante.
- **Tiempo real sin infraestructura extra.** Cada cambio se reparte a los navegadores conectados por WebSocket (`/api/workspaces/:id/live`). La conexión solo se acepta con sesión y desde los orígenes de la app; el navegador envía un latido cada 25 s y se reconecta solo.
  - **En Node,** cada latido vuelve a comprobar la sesión. Si pones Orqevio detrás de un proxy inverso, este debe permitir WebSocket (Caddy y Traefik lo hacen por defecto; en Nginx añade las cabeceras `Upgrade` y `Connection`).
  - **En Cloudflare,** las conexiones hibernan: el latido lo contesta la plataforma sin despertar al Durable Object, así que una copia inactiva no consume. El acceso se comprueba al conectar, antes de entregar cada cambio y justo después de cerrar sesión, cambiar la clave o recuperar el acceso.
- **Orden estable.** Columnas, tarjetas, páginas y checklists usan índices fraccionarios (`COLLATE "C"`), de modo que mover un elemento actualiza una sola fila.

## Modelo de seguridad

**Acceso y sesiones**
- Sin registro ni contraseñas: la copia se reclama una vez con el código de configuración y se entra con una clave aleatoria de 160 bits. El servidor solo guarda la huella SHA-256 de ambos y los compara en tiempo constante.
- Sesión en cookie `HttpOnly`, `SameSite=Lax` y `Secure` (prefijo `__Host-` con HTTPS). En la base de datos solo se guarda su hash SHA-256.
- Las escrituras con cookie solo se aceptan desde los orígenes de `APP_URL` (protección CSRF). Cambiar la clave de acceso cierra las demás sesiones, y recuperar el acceso las cierra todas.
- Cabeceras estrictas: CSP sin scripts en línea, `frame-ancestors 'none'`, `nosniff`, HSTS con HTTPS y Permissions-Policy.
- Límite de intentos al entrar, al reclamar la copia y al recuperar el acceso, y límite de peticiones por token en MCP.

**Bóveda (conocimiento cero)**

```
contraseña maestra ──Argon2id (64 MiB, 3 pasadas, sal aleatoria)──► KEK ─┐
clave de recuperación (160 bits) ──HKDF-SHA256──────────────────► RKEK ─┴─ AES-256-GCM envuelve la clave de la bóveda (256 bits)
clave de la bóveda ── AES-256-GCM, datos asociados = usuario + id del elemento ──► elementos cifrados
```

- Todo el cifrado ocurre en el navegador (WebCrypto; Argon2id en un Web Worker). El servidor solo almacena parámetros de derivación y sobres `v1.<iv>.<cifrado>`. Incluso los títulos van cifrados.
- La clave de la bóveda vive solo en memoria como `CryptoKey` no exportable: se descarta al bloquear, por inactividad (1–60 min) o al recargar.
- Los datos asociados de AES-GCM impiden que alguien con acceso a la base de datos intercambie elementos entre usuarios o entradas.
- Al copiar, el portapapeles se vacía a los 30 segundos. El generador usa aleatoriedad criptográfica sin sesgo.
- Cambiar la contraseña maestra solo vuelve a envolver la clave: los elementos no se recifran. La clave de recuperación permite elegir una nueva contraseña maestra. Sin ninguna de las dos, los datos son irrecuperables por diseño.
- Las rutas `/api/vault/*` rechazan cualquier petición con cabecera `Authorization` antes de leer datos, y el servidor MCP no expone ninguna herramienta de bóveda.

**Agentes**
- Cada token pertenece a un único espacio y tiene permisos por área: tareas y documentos (sin acceso, lectura, o lectura y escritura). Se muestra una sola vez y se guarda su hash.
- Cada agente solo ve las herramientas que permite su token. Los agentes **no pueden borrar**: solo archivar tarjetas, que puedes restaurar.
- Toda acción queda registrada con su autor (persona o agente) y es visible en la app. Los tokens se pueden revocar al instante y caducar a los 30, 90 o 365 días.

## Puesta en marcha

### Con Docker (recomendado para producción)

```bash
cp .env.example .env
```

Edita `.env`: define `APP_URL` con la URL pública (por ejemplo `https://orqevio.tu-dominio.com`) y un `SETUP_CODE` propio (opcional; ver «Acceso a tu copia»).

```bash
docker compose up -d --build
```

La app queda en el puerto 3000 y aplica las migraciones al arrancar. Ponla detrás de un proxy inverso con HTTPS (Caddy, Nginx, Traefik) y, en ese caso, añade `TRUST_PROXY=true`. La base de datos SQLite y los adjuntos se guardan en el volumen `orqevio-data`.

**Copias de seguridad.** Basta con copiar el volumen con la app parada, o hacer una copia en caliente con `sqlite3 /data/orqevio.db ".backup '/data/copia.db'"` y guardar también la carpeta `uploads`.

### En Cloudflare (con un comando)

Tu copia vive en tu propia cuenta de Cloudflare: un Worker con la web, la API y el MCP, un Durable Object con su base de datos SQLite y un bucket R2 para los adjuntos. Necesitas una cuenta de Cloudflare (el plan gratuito basta) y Node 22.12 o superior.

```bash
npx create-orqevio
```

El instalador:

1. Abre el navegador para que inicies sesión en Cloudflare (inicio de sesión oficial de Wrangler).
2. Te pide un nombre para la copia (por defecto, `orqevio`), que forma parte de su dirección.
3. Despliega la copia y crea su bucket R2.
4. Te muestra su dirección (`https://orqevio.<tu-subdominio>.workers.dev`) y un **código de configuración** de un solo uso, generado al azar.

Abre la dirección, escribe el código y tu nombre: Orqevio te dará tu clave de acceso. Desde ese momento el código ya no sirve.

```bash
npx create-orqevio@latest update
```

Actualiza tu copia a la última versión. Tus datos, tu clave y tu bóveda se conservan.

```bash
npx create-orqevio@latest recover
```

Si pierdes la clave, genera un código nuevo. Úsalo en **«¿Has perdido la clave?»**, en la pantalla de acceso.

- **Varias copias:** añade `--name <nombre>` a cualquiera de las órdenes.
- **Varias cuentas de Cloudflare:** el instalador te pregunta cuál usar; también puedes indicarla con `--account <id>` o `CLOUDFLARE_ACCOUNT_ID`.
- **Tus ajustes se conservan:** las variables que pongas en el panel de Cloudflare (`APP_URL`, `MAX_UPLOAD_MB`) sobreviven a las actualizaciones.
- **Privacidad:** el instalador desactiva la telemetría anónima de Wrangler, salvo que tú la hayas activado.
- **Lo que hace exactamente:**
  - Wrangler trabaja en una carpeta temporal privada, nunca en la carpeta en la que estás.
  - El código de configuración se sube como secreto del Worker y la carpeta se borra al terminar, también si interrumpes el proceso.
- **Antes de la primera versión publicada en npm:** los paquetes `create-orqevio` y `orqevio` aún no están publicados. Mientras tanto, ejecuta el instalador desde el repositorio:

```bash
pnpm install
```

```bash
pnpm build:cloudflare
```

```bash
node packages/create-orqevio/dist/cli.js
```

**Con el botón (alternativa).** Si prefieres tener tu copia en un repositorio propio de GitHub o GitLab:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hsylabs/orqevio/tree/main/templates/cloudflare)

Cloudflare crea en tu cuenta de GitHub o GitLab un repositorio pequeño (la plantilla `templates/cloudflare`), te pide el código de configuración (`SETUP_CODE`) y despliega la copia. Después:
- **Despliegues:** cada cambio en ese repositorio se despliega solo.
- **Actualizaciones:** Dependabot propone las versiones nuevas de Orqevio en un pull request; al fusionarlo, la copia se actualiza.
- **Si pierdes la clave:** cambia el secreto `SETUP_CODE` en el panel de Cloudflare y usa **«¿Has perdido la clave?»**.

El resultado es la misma copia que con el comando. El botón funcionará cuando este repositorio sea público y los paquetes estén publicados en npm.

El plan gratuito de Cloudflare basta para uso personal (límites a noviembre de 2026):

| Recurso | Plan gratuito |
| --- | --- |
| Peticiones (Worker y Durable Object) | 100 000 al día |
| CPU | 10 ms por petición; el uso normal y el MCP se quedan en 1–5 ms |
| Duración del Durable Object | 13 000 GB-s al día; mientras nadie usa la copia, hiberna y no cuenta |
| Base de datos (SQLite del Durable Object) | 1 GB por copia (5 GB en total por cuenta) |
| Adjuntos (R2) | 10 GB y 1 millón de escrituras al mes |

**Notas**
- **`SETUP_CODE` es obligatorio en Cloudflare.** El Durable Object se reinicia a menudo, así que un código generado en memoria no serviría. El instalador lo crea por ti; sin él, el despliegue falla.
- **Tu dominio.** Por defecto, la app acepta el origen con el que se la visita. Si usas un dominio propio y quieres fijarlo, define `APP_URL` como variable del Worker.
- **Probarlo en local sin cuenta:** crea `apps/server/.dev.vars` con `SETUP_CODE=...` y ejecuta `pnpm --filter @orqevio/server dev:worker`. La copia queda en `http://localhost:8787`.
- **A mano, sin el instalador:** desde `apps/server`, tras `pnpm build`, ejecuta `npx wrangler deploy --secrets-file <archivo>`, con un archivo fuera del repositorio que contenga `SETUP_CODE=...`. Wrangler crea el bucket R2 si no existe.

### En local para desarrollo

Requisitos: Node 22.12 o superior y pnpm 10. No hace falta ninguna base de datos externa: SQLite viene con el servidor (`better-sqlite3` se compila al instalar si no hay binario para tu sistema).

```bash
pnpm install
```

```bash
cp .env.example .env
```

En `.env`, usa `APP_URL=http://localhost:5173,http://localhost:3000`. Los datos de desarrollo se guardan en `apps/server/data/`.

```bash
pnpm dev
```

Abre `http://localhost:5173`. Vite redirige `/api` y `/mcp` al servidor en el puerto 3000.

### Build de producción sin Docker

```bash
pnpm build
```

```bash
pnpm start
```

### Acceso a tu copia

1. **Primera vez.** Abre la URL de la copia e introduce el código de configuración y tu nombre:
   - Si definiste `SETUP_CODE`, es ese valor. Usa al menos 12 letras o dígitos.
   - Si no, el servidor genera uno al arrancar y lo muestra en su registro (`docker compose logs app`). Sirve hasta que la copia se reclama o el servidor se reinicia.
   - En Cloudflare, te lo da el instalador.
2. **Tu clave de acceso.** Orqevio genera una clave aleatoria de 160 bits y la muestra **una sola vez**. Guárdala en tu gestor de contraseñas: es lo único que necesitas para entrar desde cualquier dispositivo. Al escribirla dan igual las mayúsculas y los guiones.
3. **Cambiarla.** En **Ajustes → Clave de acceso** puedes generar una nueva; se cierran tus demás sesiones.

Si pierdes la clave, quien administra la copia puede generar otra (en Cloudflare, con `npx create-orqevio@latest recover`):

```bash
docker compose exec app node dist/cli.js reset-access
```

Sin Docker:

```bash
node apps/server/dist/cli.js reset-access
```

También puedes definir un `SETUP_CODE` nuevo, reiniciar la copia y usar **«¿Has perdido la clave?»** en la pantalla de acceso. En ambos casos se cierran todas las sesiones.

`node dist/cli.js status` muestra si la copia está reclamada y por quién. Nada de esto afecta a la bóveda: su contraseña maestra nunca la conoce el servidor.

## Conectar agentes por MCP

1. En Orqevio, ve a **Agentes → Conectar un agente**, elige permisos y caducidad, y copia el token.
2. Pega la configuración que te ofrece la propia app. Ejemplos:

**Claude Code**

```bash
claude mcp add --transport http orqevio https://tu-dominio/mcp --header "Authorization: Bearer orq_…"
```

**Cursor** (`~/.cursor/mcp.json`) y **VS Code** (`.vscode/mcp.json`, con `"servers"` y `"type": "http"`)

```json
{ "mcpServers": { "orqevio": { "url": "https://tu-dominio/mcp", "headers": { "Authorization": "Bearer orq_…" } } } }
```

**Claude Desktop** (puente `mcp-remote`, requiere Node.js)

```json
{
  "mcpServers": {
    "orqevio": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tu-dominio/mcp", "--header", "Authorization:${ORQEVIO_AUTH}"],
      "env": { "ORQEVIO_AUTH": "Bearer orq_…" }
    }
  }
}
```

**Herramientas disponibles** (cada token ve solo las que permite):

| Permiso | Herramientas |
| --- | --- |
| Cualquier lectura | `list_projects`, `search` |
| Tareas · lectura | `get_board`, `get_card` |
| Tareas · escritura | `create_card`, `update_card`, `move_card`, `archive_card`, `create_board`, `create_column`, `update_column`, `create_label`, `add_checklist_items`, `update_checklist_item` |
| Documentos · lectura | `list_pages`, `read_page` |
| Documentos · escritura | `create_page`, `update_page` (reemplazar con `base_version`, o añadir al final) |
| Escritura + lectura de ambas áreas | `link_card_to_page` |

El endpoint es MCP Streamable HTTP sin estado (`POST /mcp`). La misma API REST también acepta los tokens con los mismos permisos, salvo cuenta, tokens y bóveda, que exigen sesión en el navegador.

## Pruebas

```bash
pnpm typecheck
```

```bash
pnpm test
```

`pnpm test` ejecuta las pruebas unitarias (criptografía de la bóveda, generador y enlaces) y las de integración del servidor contra SQLite real (acceso con código de configuración y clave, CSRF, aislamiento entre espacios, permisos por token, bóveda inaccesible con tokens, herramientas MCP con el cliente oficial y tiempo real). Cada archivo de pruebas crea su propia copia en una carpeta temporal y la borra al terminar.

Pruebas de extremo a extremo con Playwright, con el servidor de producción en marcha sobre una base de datos **vacía** y el mismo `SETUP_CODE` en el servidor y en las pruebas (por defecto `e2e-setup-code-1234`):

```bash
SETUP_CODE=e2e-setup-code-1234 pnpm test:e2e
```

La misma batería se pasa contra el runtime de Cloudflare en local (`pnpm --filter @orqevio/server dev:worker`, con el mismo código en `apps/server/.dev.vars`). La CI la pasa contra el paquete que despliega el instalador:

```bash
E2E_BASE_URL=http://127.0.0.1:8787 SETUP_CODE=e2e-setup-code-1234 pnpm test:e2e
```

La CI ejecuta las dos.

Primero reclaman la copia desde la interfaz y prueban la clave de acceso. Después cubren el cambio de clave en Ajustes, el tablero (incluido arrastrar con ratón y con teclado), documentos con referencias a tareas, pegar una imagen en un documento y adjuntar archivos a una tarjeta, el ciclo completo de la bóveda (con recuperación) y un agente MCP trabajando en directo sobre el tablero. Fallan si aparece cualquier error en la consola del navegador.

## Configuración

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Orígenes públicos separados por comas. Con `https://` activa cookies `Secure` y HSTS. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Dirección de escucha. |
| `DATA_DIR` | `./data` | Carpeta de datos: base SQLite (`orqevio.db`) y adjuntos (`uploads/`). |
| `DATABASE_PATH` | `DATA_DIR/orqevio.db` | Ruta del archivo SQLite, si quieres separarlo de los adjuntos. |
| `MAX_UPLOAD_MB` | `20` | Tamaño máximo por archivo. |
| `TRUST_PROXY` | `false` | Confiar en `X-Forwarded-For` (detrás de un proxy inverso). |
| `SECURE_COOKIES` | según `APP_URL` | Fuerza cookies `Secure`. |
| `SETUP_CODE` | generado al arrancar | Código para reclamar la copia la primera vez. Si lo cambias, permite recuperar el acceso. |

En Cloudflare solo se usan `SETUP_CODE` (secreto obligatorio), `APP_URL` (opcional; por defecto, el origen de cada visita) y `MAX_UPLOAD_MB`. El resto no aplica: los datos viven en el Durable Object y en R2.

## Limitaciones conocidas

- **Uso individual por espacio.** El modelo de datos ya contempla miembros y roles, pero no hay invitaciones ni asignación de tarjetas a personas: el producto está pensado para ti y tus agentes.
- **Sin coedición simultánea.** No hay edición colaborativa en tiempo real tipo CRDT; los conflictos se detectan por versión y se resuelven explícitamente.
- **Autenticación MCP por token Bearer.** No se implementa el flujo OAuth 2.1 de MCP, así que los clientes que solo admiten OAuth (por ejemplo, los conectores personalizados de la web de Claude) no pueden conectarse directamente; Claude Code, Cursor, VS Code y Claude Desktop (con `mcp-remote`) sí.
- **Un solo proceso por copia.** SQLite, los adjuntos en disco y el tiempo real en memoria asumen una única instancia del servidor por copia, que es el modelo de Orqevio (una copia por persona).
- **Copias de seguridad en Cloudflare.** Aún no hay exportación desde la app: los datos quedan en el Durable Object y en el bucket R2 de tu cuenta.
- **Sin migración desde PostgreSQL.** Las versiones de desarrollo anteriores usaban PostgreSQL; no hay herramienta para pasar esos datos a SQLite.
- **Una persona por copia.** No hay registro ni correo; si se pierde la clave de acceso, se recupera desde el servidor (CLI o un `SETUP_CODE` nuevo).
- **Bóveda personal.** No se comparte entre personas y no incluye importación/exportación ni códigos TOTP.
- **Imágenes externas.** Las imágenes de documentos que apuntan a otros dominios se cargan desde su origen.
- **Navegadores modernos.** Se requiere WebCrypto, Web Workers y WebAssembly (versiones actuales de Chrome, Edge, Firefox y Safari).

## Estructura del repositorio

```
apps/server/src
  services/   lógica de dominio y permisos (compartida por REST y MCP)
  http/       rutas REST, middleware de sesión, CSRF y aislamiento de la bóveda
  mcp/        servidor MCP y transporte HTTP
  db/         esquema Drizzle y migraciones (apps/server/drizzle)
  node/       arranque en Node: archivos estáticos y WebSocket
  worker/     arranque en Cloudflare: Worker, Durable Object, R2 y migraciones incrustadas
apps/web/src
  features/   shell, home, projects, boards, docs, vault, agents, settings
  components/ sistema de diseño (botones, diálogos, menús, editor…)
  lib/        cliente de API, consultas, tiempo real y formato
packages/shared/src  esquemas, permisos, tipos y utilidades de enlaces
packages/orqevio     paquete desplegable en Cloudflare (Worker, web y configuración base)
packages/create-orqevio  instalador: npx create-orqevio (instalar, actualizar, recuperar)
templates/cloudflare plantilla del botón «Deploy to Cloudflare» (wrangler.jsonc y package.json generados)
```
