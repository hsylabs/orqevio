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
apps/server     Node 22 · Hono · Drizzle ORM · SQLite (FTS5) · SDK oficial de MCP
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
- **Una copia, un archivo.** Cada copia es de una persona y guarda todo en SQLite: un único archivo (`DATA_DIR/orqevio.db`) más la carpeta de adjuntos. Las transacciones son síncronas, el mismo modelo que tendrá la versión para Cloudflare.
- **Búsqueda de texto completo.** Índices FTS5 sobre títulos y contenido de tarjetas y documentos, sin distinguir mayúsculas ni acentos («cancion» encuentra «Canción»), con el título por delante.
- **Tiempo real sin infraestructura extra.** Cada cambio se reparte en memoria a los navegadores conectados por WebSocket (`/api/workspaces/:id/live`). La conexión solo se acepta con sesión y desde los orígenes de `APP_URL`; el navegador envía un latido cada 25 s, que también vuelve a comprobar la sesión, y se reconecta solo. Si pones Orqevio detrás de un proxy inverso, este debe permitir WebSocket (Caddy y Traefik lo hacen por defecto; en Nginx añade las cabeceras `Upgrade` y `Connection`).
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
2. **Tu clave de acceso.** Orqevio genera una clave aleatoria de 160 bits y la muestra **una sola vez**. Guárdala en tu gestor de contraseñas: es lo único que necesitas para entrar desde cualquier dispositivo. Al escribirla dan igual las mayúsculas y los guiones.
3. **Cambiarla.** En **Ajustes → Clave de acceso** puedes generar una nueva; se cierran tus demás sesiones.

Si pierdes la clave, quien administra la copia puede generar otra:

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

Primero reclaman la copia desde la interfaz y prueban la clave de acceso. Después cubren el cambio de clave en Ajustes, el tablero (incluido arrastrar con ratón y con teclado), documentos con referencias a tareas, el ciclo completo de la bóveda (con recuperación) y un agente MCP trabajando en directo sobre el tablero. Fallan si aparece cualquier error en la consola del navegador.

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

## Limitaciones conocidas

- **Uso individual por espacio.** El modelo de datos ya contempla miembros y roles, pero no hay invitaciones ni asignación de tarjetas a personas: el producto está pensado para ti y tus agentes.
- **Sin coedición simultánea.** No hay edición colaborativa en tiempo real tipo CRDT; los conflictos se detectan por versión y se resuelven explícitamente.
- **Autenticación MCP por token Bearer.** No se implementa el flujo OAuth 2.1 de MCP, así que los clientes que solo admiten OAuth (por ejemplo, los conectores personalizados de la web de Claude) no pueden conectarse directamente; Claude Code, Cursor, VS Code y Claude Desktop (con `mcp-remote`) sí.
- **Un solo proceso por copia.** SQLite, los adjuntos en disco y el tiempo real en memoria asumen una única instancia del servidor por copia, que es el modelo de Orqevio (una copia por persona).
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
apps/web/src
  features/   shell, home, projects, boards, docs, vault, agents, settings
  components/ sistema de diseño (botones, diálogos, menús, editor…)
  lib/        cliente de API, consultas, tiempo real y formato
packages/shared/src  esquemas, permisos, tipos y utilidades de enlaces
```
