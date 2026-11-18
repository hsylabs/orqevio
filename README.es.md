# Orqevio

[English](README.md) · **Español**

**Un espacio de trabajo donde organizas tus proyectos, documentas tu conocimiento y proteges tus credenciales. Todo accesible para ti y tus agentes de IA, con permisos controlados.**

Orqevio reúne cuatro piezas y solo esas cuatro:

| Módulo | Qué incluye |
| --- | --- |
| **Tareas** | Espacios, proyectos, tableros Kanban, columnas, tarjetas, etiquetas, fechas, checklists, archivo y adjuntos. |
| **Documentación** | Páginas jerárquicas con editor por bloques que guarda Markdown, tablas sencillas, imágenes y archivos, y enlaces directos con tareas. |
| **Bóveda** | Credenciales y notas privadas cifradas de extremo a extremo, códigos de verificación en dos pasos (TOTP), importación y exportación, generador de contraseñas, clave de recuperación y bloqueo automático. |
| **Agentes (MCP)** | Servidor MCP con permisos diferenciados por espacio, para que los agentes hagan casi todo lo que haces tú con tareas y documentos: consultar, escribir, reorganizar, adjuntar archivos y poner orden. Se conecta con OAuth (por ejemplo, como conector de Claude) o con un token. |

La decisión central: **la bóveda está aislada de los agentes**. Ningún token puede acceder a ella, ni siquiera a su contenido cifrado, y el servidor nunca conoce los secretos.

Y **nada de lo que hace un agente es definitivo.** Cualquier cambio se puede deshacer durante 30 días, y lo que borra un agente va a la papelera, que solo tú puedes vaciar. Ningún agente puede borrar nada para siempre, borrar un espacio o tu cuenta, ni tocar los tokens, los ajustes o la bóveda.

**Cada copia de Orqevio es de una sola persona.** No hay registro ni correo: la primera vez se reclama con un código de configuración y, a partir de ahí, se entra con una clave de acceso.

---

## Experiencia

- **Relación directa entre tareas y documentos.** Escribe `@` en un documento para enlazar una tarea: el vínculo aparece en ambos lados. También puedes vincular documentos desde la tarjeta.
- **Tus agentes, en directo.** Cuando un agente crea o mueve una tarjeta, la ves aparecer con un halo azul y su nombre, y recibes un aviso. El punto del logotipo se vuelve azul mientras trabajan.
- **Sin pisarse.** Los documentos y las descripciones de las tarjetas usan control de versiones optimista: si un agente edita una página o una tarjeta mientras escribes, Orqevio te avisa y eliges qué versión conservar.
- **Nada se pierde por error.** Lo que borras espera 30 días en la papelera con todo lo que contenía: una página con sus subpáginas y archivos, una columna con sus tarjetas. Deshazlo al momento desde el aviso o restáuralo más tarde con un clic.
- **Cada cambio tiene su historial y se puede deshacer.** Cada página y cada tarjeta guardan 30 días de cambios, de personas y de agentes: quién cambió qué y cuándo y, en los textos, qué cambió línea a línea, como un diff. Deshaz un cambio, vuelve a una versión anterior o deshaz todo lo que hizo un agente desde un momento dado; si alguien cambió lo mismo después, Orqevio pregunta antes.
- **Tus datos, a salvo y tuyos.** Tu copia hace una copia de seguridad de sí misma cada día, aparte de sus datos, y restauras cualquiera de las 7 últimas desde **Ajustes**. **Exportar tus datos** te da todo en un ZIP que puedes leer sin Orqevio: tareas en JSON, documentos en Markdown y los adjuntos.
- **Teclado primero.** `⌘K`/`Ctrl K` abre la paleta para buscar y saltar a cualquier sitio; `⌘\` oculta la barra lateral; el Kanban se puede reorganizar entero con teclado (espacio para coger, flechas, espacio para soltar), con anuncios para lector de pantalla.
- **Identidad propia.** Papel cálido, tinta y dos señales de color: caqui para ti, ultramar para los agentes. Tipografía editorial (Fraunces) sobre una interfaz sobria (Instrument Sans). Tema claro y oscuro, con los tonos de texto ajustados a contraste WCAG AA.
- **En tu idioma.** La app y el instalador hablan inglés, español, francés, portugués, italiano, alemán, neerlandés y japonés. Tu copia toma el idioma del navegador al reclamarla y puedes cambiarlo cuando quieras en **Ajustes**.

## Deshacer y recuperar

Todo lo que cambian las personas y los agentes se puede recuperar durante 30 días.

**Papelera.** Al borrar un proyecto, un tablero, una columna, una tarjeta, una página, un archivo, una etiqueta, una checklist o uno de sus elementos, o el enlace entre una tarjeta y una página, va a la **Papelera**, en la barra lateral, con todo lo que contenía. Justo después de borrar, **Deshacer** en el aviso lo trae de vuelta. En la **Papelera** ves qué es cada cosa, dónde estaba, quién la borró y cuándo se borrará para siempre, con **Restaurar** y **Borrar para siempre**. Restaurar lo deja todo como estaba; si su sitio ya no existe, la app dice dónde ha ido. Pasados 30 días, la papelera se vacía sola.

**Historial.** **Historial**, en el menú de una tarjeta o una página, muestra sus cambios de los últimos 30 días: qué cambió, quién lo cambió (una persona, o qué agente) y cuándo. En el contenido de una página o la descripción de una tarjeta, **Ver qué cambió** muestra las líneas añadidas y quitadas.

**Deshacer.** En el historial:
- **Deshacer** devuelve lo que cambió un cambio, sin tocar lo que cambió después. Lo que añadió va a la papelera, y lo que borró vuelve.
- **Deshacer todo lo que hizo Claude desde aquí**, en el cambio de un agente, deshace todo lo que hizo ese agente desde ese cambio, en tarjetas y páginas, después de decir qué abarca.
- **Restaurar esta versión** deja el contenido de una página o la descripción de una tarjeta como estaba.

Si alguien cambió lo mismo después del cambio que deshaces, Orqevio dice quién y pregunta antes. Deshacer es un cambio más, así que también se puede deshacer. Solo las personas deshacen.

**Copias de seguridad.** Más allá de 30 días, o si algo sale mal, las copias diarias devuelven la copia entera a como estaba un día concreto: en **Ajustes → Copias de seguridad**, elige una y restáurala tras escribir tu clave de acceso. Antes de restaurar, la copia hace una copia de seguridad de cómo está. Mira [Con Docker](#con-docker-recomendado-para-producción) y [En Cloudflare](#en-cloudflare-con-un-comando) para saber dónde se guardan.

**Qué pueden borrar y mover los agentes.** Cada token y cada conexión OAuth tiene el permiso **Puede borrar y mover**. Con él, un agente puede borrar lo que puede escribir, siempre a la papelera, y mover tarjetas a otro tablero y archivos a otra tarjeta o página. Los tokens y conexiones nuevos lo tienen salvo que lo desmarques; los creados antes de la 1.1.0 no, hasta que lo actives en **Agentes**, donde cada uno tiene su casilla. Sin él, un agente puede archivar tarjetas y mover tarjetas dentro de su tablero y páginas dentro de su proyecto.

## Arquitectura

```
apps/web        React 19 + Vite · TanStack Query · React Router · Tailwind CSS 4
                TipTap 3 (Markdown nativo) · dnd-kit · Radix UI · cmdk
apps/server     Hono · Drizzle ORM · SQLite (FTS5) · SDK oficial de MCP
                Node 22 (Docker) o Cloudflare Workers + Durable Objects + R2
packages/shared Esquemas zod, permisos y tipos compartidos por API, MCP y cliente
```

```
          Navegador (sesión)                Cliente MCP (OAuth o token Bearer)
                 │                                          │
           REST /api/*                                 POST /mcp
                 │                                          │
                 └──────────────► Servicios de dominio ◄────┘
                                 (permisos y validación)
                                          │
                        SQLite (un archivo) ── eventos en memoria ──► WebSocket en tiempo real
```

- **Una sola capa de dominio.** La API REST de la aplicación y las herramientas MCP llaman exactamente a los mismos servicios. Cada operación comprueba el acceso al espacio y el permiso concreto (`tasks:read`, `tasks:write`, `docs:read`, `docs:write`), así que las reglas se aplican una única vez.
- **Markdown como formato canónico.** Documentos y descripciones se guardan en Markdown (GFM). Es portable, legible y lo que mejor entienden los LLM. Las referencias internas son enlaces normales: `[Título](/card/<id>)` y `[Título](/doc/<id>)`. Lo que el editor no sabe mostrar, como el HTML, se queda en el documento tal y como se escribió: el editor muestra su código, y editar el resto de la página no lo cambia.
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
- Al copiar una contraseña, una nota o un código, el portapapeles se vacía a los 30 segundos, salvo que hayas copiado otra cosa después. Los navegadores solo lo permiten con la pestaña delante (Firefox y Safari, solo justo después de un clic): si no, al volver Orqevio te ofrece vaciarlo con un clic. El generador usa aleatoriedad criptográfica sin sesgo.
- Cambiar la contraseña maestra solo vuelve a envolver la clave: los elementos no se recifran. La clave de recuperación permite elegir una nueva contraseña maestra. Sin ninguna de las dos, los datos son irrecuperables por diseño.
- Las rutas `/api/vault/*` rechazan cualquier petición con cabecera `Authorization` antes de leer datos, y el servidor MCP no expone ninguna herramienta de bóveda.

**Agentes**
- Cada token pertenece a un único espacio y tiene permisos por área: tareas y documentos (sin acceso, lectura, o lectura y escritura). Se muestra una sola vez y se guarda su hash.
- Cada agente solo ve las herramientas que permite su token. Con **Puede borrar y mover**, que activas o quitas en cada token y conexión, un agente borra lo que puede escribir y mueve tarjetas a otro tablero y archivos a otra tarjeta o página. Lo que borra va a la **papelera**, que solo las personas ven, restauran o vacían, y cualquier cambio suyo se puede deshacer desde el historial.
- Ningún agente puede vaciar la papelera, borrar nada para siempre, borrar un espacio o la cuenta, ni tocar los tokens, los ajustes o la bóveda.
- Toda acción queda registrada con su autor (persona o agente) y es visible en la app. Los tokens se pueden revocar al instante y caducar a los 30, 90 o 365 días.
- Las aplicaciones conectadas con OAuth reciben los permisos que eliges en la pantalla de consentimiento. Esa pantalla indica a qué dirección volverás y si la identidad de la aplicación está publicada o es autodeclarada. Nunca se envía nada a una dirección que la aplicación no haya registrado.

## Puesta en marcha

### Con Docker (recomendado para producción)

```bash
cp .env.example .env
```

Edita `.env`: define `APP_URL` con la URL pública (por ejemplo `https://orqevio.tu-dominio.com`) y un `SETUP_CODE` propio (opcional; ver [Acceso a tu copia](#acceso-a-tu-copia)).

```bash
docker compose up -d
```

Usa la imagen publicada (`ghcr.io/hsylabs/orqevio`, para amd64 y arm64). Para fijar una versión, añade `ORQEVIO_VERSION=1.0.0` a `.env`. Hasta la primera versión publicada, o si prefieres construirla tú desde este repositorio:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

La app queda en el puerto 3000 y aplica las migraciones al arrancar. Ponla detrás de un proxy inverso con HTTPS (Caddy, Nginx, Traefik) y, en ese caso, añade `TRUST_PROXY=true` (o el número de proxies que hay delante, como `2` para una CDN más Nginx). El proxy también puede pedir una contraseña (autenticación básica HTTP). Los agentes envían su propia cabecera `Authorization: Bearer`, con un token que Orqevio comprueba por su cuenta: si conectas alguno, deja pasar sin la contraseña las peticiones que lleven uno, y también `/mcp`, `/oauth/` y `/.well-known/`, a los que los clientes OAuth llegan antes de tener token. Deja pasar también el tiempo real (`/api/workspaces/…/live`): Safari no envía la contraseña al abrirlo, y Orqevio comprueba la sesión por su cuenta. [`apps/web/e2e/proxy/nginx.conf`](apps/web/e2e/proxy/nginx.conf) hace todo esto con Nginx. La base de datos SQLite y los adjuntos se guardan en el volumen `orqevio-data`.

**Copias de seguridad.** Tu copia hace una copia de seguridad de sí misma cada día: la base de datos y los adjuntos, tal cual, en la carpeta `backups` del volumen (`/data/backups`). Conserva las 7 últimas. **Ajustes → Copias de seguridad** las muestra, hace una en el momento con **Hacer una copia ahora** y restaura cualquiera de ellas tras escribir tu clave de acceso. Antes de restaurar, hace una copia de cómo está todo, para que puedas volver. Para tenerlas también fuera del servidor, sácalas de vez en cuando o pon en `BACKUP_DIR` una carpeta que montes desde otro disco:

```bash
docker compose cp app:/data/backups ./orqevio-backups
```

En un servidor nuevo se recuperan igual: pon la carpeta en el volumen de la copia nueva (o móntala como `BACKUP_DIR`), reclama la copia y restáurala desde **Ajustes → Copias de seguridad**. `BACKUPS=off` las desactiva.

**Exportación.** **Ajustes → Exportar tus datos** descarga un ZIP que puedes leer sin Orqevio: las tareas de cada espacio en JSON, sus documentos en Markdown y los adjuntos, con los enlaces entre ellos apuntando a los archivos. La bóveda tiene su propia exportación cifrada.

**Copias a mano.** Con la app en marcha, haz una copia en caliente de la base de datos y sácala del contenedor junto con los adjuntos, que están en la carpeta `uploads`:

```bash
docker compose exec app node dist/cli.js backup /data/backup.db
docker compose cp app:/data/backup.db ./orqevio-copia.db
docker compose cp app:/data/uploads ./orqevio-adjuntos
```

Para restaurarla, para la app, vuelve a meter las dos cosas y deja que Orqevio coloque la base de datos. Guarda la que sustituye como `orqevio.db.before-restore` y devuelve los archivos al usuario de la app:

```bash
docker compose stop app
docker compose cp ./orqevio-copia.db app:/data/restore.db
docker compose cp ./orqevio-adjuntos/. app:/data/uploads
docker compose run --rm --user root app node dist/cli.js restore /data/restore.db
docker compose start app
```

En un servidor nuevo, ejecuta antes una vez `docker compose up -d`, para que existan el contenedor y su volumen. También puedes copiar el volumen `orqevio-data` entero con la app parada. Sin Docker, `pnpm cli backup <archivo>` hace la misma copia y, con el servidor parado, `pnpm cli restore <archivo>` la devuelve a su sitio; los adjuntos están en la carpeta `uploads` de `DATA_DIR`.

### En Cloudflare (con un comando)

Tu copia vive en tu propia cuenta de Cloudflare: un Worker con la web, la API y el MCP, un Durable Object con su base de datos SQLite y un bucket R2 para los adjuntos. Necesitas una cuenta de Cloudflare (el plan gratuito basta) y Node 22.12 o superior.

**Antes de la primera instalación, activa R2** en el panel de Cloudflare, en [R2 → Overview](https://dash.cloudflare.com/?to=/:account/r2/overview). El uso incluido es gratis (10 GB de almacenamiento al mes), aunque Cloudflare puede pedirte un método de pago. Si no lo has activado, el instalador se detiene antes de desplegar y te lo indica.

```bash
npx create-orqevio
```

El instalador:

1. Abre el navegador para que inicies sesión en Cloudflare (inicio de sesión oficial de Wrangler). Si no se abre, abre el enlace que muestra el instalador. En Windows, el instalador lo abre él mismo con el Explorador: algunos antivirus (Norton, por ejemplo) bloquean la orden de PowerShell codificada con la que Wrangler abre el navegador. Si aun así no se completa, inicia sesión aparte con `npx wrangler login --browser=false` y vuelve a ejecutar el instalador.
2. Te pide un nombre para la copia (por defecto, `orqevio`), que forma parte de su dirección.
3. Despliega la copia y crea sus dos buckets R2: uno para los adjuntos y otro para las copias de seguridad (`<nombre>-backups`).
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

```bash
npx create-orqevio@latest uninstall
```

Borra tu copia y todo lo que contiene, en un solo paso, después de que escribas su nombre: consulta [Desinstalar](#desinstalar).

- **Varias copias:** añade `--name <nombre>` a cualquiera de las órdenes.
- **Varias cuentas de Cloudflare:** el instalador te pregunta cuál usar; también puedes indicarla con `--account <id>` o `CLOUDFLARE_ACCOUNT_ID`.
- **Idioma:** el instalador habla el idioma de tu terminal; elige otro con `--lang <código>` (`en`, `es`, `fr`, `pt`, `it`, `de`, `nl` o `ja`).
- **Copias de seguridad:** tu copia hace una copia de seguridad de sí misma cada día en su bucket de copias, y conserva las 7 últimas. **Ajustes → Copias de seguridad** las muestra, hace una en el momento y restaura cualquiera de ellas; **Ajustes → Exportar tus datos** descarga todo en un ZIP legible. Las copias instaladas antes de la 1.2.0 reciben el bucket con su siguiente actualización y hacen su primera copia antes de una hora. Una copia que vuelvas a instalar con el mismo nombre encuentra las copias de seguridad de la anterior, si las conservaste al desinstalar, y puede restaurarlas desde **Ajustes → Copias de seguridad**.
- **Tus ajustes se conservan:** las variables que pongas en el panel de Cloudflare (`APP_URL`, `MAX_UPLOAD_MB`) sobreviven a las actualizaciones.
- **Privacidad:** el instalador desactiva la telemetría anónima de Wrangler, salvo que tú la hayas activado.
- **Lo que hace exactamente:**
  - Wrangler trabaja en una carpeta temporal privada, nunca en la carpeta en la que estás.
  - El código de configuración se sube como secreto del Worker y la carpeta se borra al terminar, también si interrumpes el proceso.
- **Desde el repositorio:** para probar cambios que aún no están publicados en npm, ejecuta el instalador desde el código del repositorio:

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

El resultado es la misma copia que con el comando.

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
   - Si definiste `SETUP_CODE`, es ese valor. Usa al menos 12 letras de la A a la Z o dígitos: los demás caracteres (tildes, otros alfabetos, símbolos) no cuentan, y con menos la copia no se deja reclamar ni recuperar.
   - Si no, el servidor genera uno al arrancar y lo muestra en su registro (`docker compose logs app`). Sirve hasta que la copia se reclama o el servidor se reinicia.
   - En Cloudflare, te lo da el instalador.
2. **Tu clave de acceso.** Orqevio genera una clave aleatoria de 160 bits y la muestra **una sola vez**. Guárdala en tu gestor de contraseñas: es lo único que necesitas para entrar desde cualquier dispositivo. Al escribirla dan igual las mayúsculas y los guiones.
3. **Cambiarla.** En **Ajustes → Clave de acceso** puedes generar una nueva; se cierran tus demás sesiones.

Si pierdes la clave, quien administra la copia puede generar otra (en Cloudflare, con `npx create-orqevio@latest recover`):

```bash
docker compose exec app node dist/cli.js reset-access
```

Sin Docker, desde la carpeta del repositorio (usa la misma carpeta de datos y el mismo `.env` que `pnpm start` y `pnpm dev`):

```bash
pnpm cli reset-access
```

También puedes definir un `SETUP_CODE` nuevo, reiniciar la copia y usar **«¿Has perdido la clave?»** en la pantalla de acceso. En ambos casos se cierran todas las sesiones.

**Tus agentes.** Al recuperar el acceso, Orqevio pregunta por qué. Con **«He perdido la clave»**, tus agentes (tokens y conectores OAuth como Claude) conservan el acceso, y la pantalla los muestra para que revoques el que no reconozcas. Con **«Puede que alguien la tenga»**, se desconectan todos, también los códigos de autorización aún sin canjear: quien tuvo la clave pudo conectar uno suyo. Con la CLI, añade `--revoke-agents` a `reset-access` para lo mismo.

`status` (`docker compose exec app node dist/cli.js status`, o `pnpm cli status` sin Docker) muestra si la copia está reclamada y por quién. Nada de esto afecta a la bóveda: su contraseña maestra nunca la conoce el servidor.

## Actualizaciones

Cada versión tiene número y notas (`CHANGELOG.md`, en inglés, y las releases de GitHub), y se publica a la vez en npm y como imagen Docker. Al arrancar, cada copia aplica sus migraciones. Las migraciones siempre son compatibles hacia atrás y nunca se modifican una vez publicadas; un test lo vigila.

| Instalación | Cómo actualizar | Qué se conserva |
| --- | --- | --- |
| Comando (Cloudflare) | `npx create-orqevio@latest update` | Datos, clave, bóveda y variables del panel |
| Botón (Cloudflare) | Fusiona el pull request de Dependabot en tu repositorio | Lo mismo |
| Docker | `docker compose pull` y `docker compose up -d` | El volumen `orqevio-data` |
| Desde el código | `git pull`, `pnpm install`, `pnpm build` y reinicia | La carpeta `DATA_DIR` |

**Aviso en la app.** En **Ajustes → Esta copia** ves tu versión y, cuando sale una nueva, cómo actualizar según cómo instalaste la copia; el menú de usuario lo marca con un punto.
- **Qué consulta:** el servidor de tu copia pregunta a `registry.npmjs.org` cuál es la última versión publicada de `create-orqevio`, como mucho cada 12 horas y solo mientras usas la app. Guarda la respuesta, así que reiniciar no provoca consultas de más.
- **Qué envía:** es una petición GET sin ningún dato tuyo.
- **Desactivarlo:** con `UPDATE_CHECK=off`. Solo lo ve el propietario, nunca los agentes.

## Desinstalar

**Ajustes → Desinstalar Orqevio** lo borra todo para siempre: espacios, documentos, adjuntos, la bóveda, los agentes y las sesiones. Lo confirmas con tu clave de acceso y escribiendo el nombre de la copia. Desde ese momento, la copia solo muestra cómo quitar lo que queda, que depende de cómo la instalaste:

| Instalación | Qué queda y cómo quitarlo |
| --- | --- |
| Comando (Cloudflare) | El Worker y su bucket de R2: `npx create-orqevio@latest uninstall` (con `--name <nombre>` si no se llama `orqevio`) |
| Botón (Cloudflare) | El Worker y su bucket de R2, que borras en el panel; después, el repositorio que creó el botón y, si nada más lo usa, su token de compilación |
| Docker | Los contenedores y el volumen `orqevio-data`: `docker compose down -v`; después, la carpeta donde la instalaste |
| Desde el código | La carpeta `DATA_DIR`, con el servidor parado |

**En un solo paso, para las copias instaladas con el comando.** `npx create-orqevio@latest uninstall` hace los dos pasos desde tu ordenador, sin pasar por la app:
- Te pide que escribas el nombre de la copia.
- Borra el bucket y, después, el Worker con todos sus datos.
- Cloudflare solo borra buckets vacíos. Si el tuyo aún guarda adjuntos, el instalador te pide la dirección de tu copia y le pide que borre antes sus datos, como hace el botón. La autoriza desde tu cuenta de Cloudflare con un token de un solo uso (un secreto del Worker que caduca en 15 minutos): no necesita tu clave de acceso, y una copia de otra cuenta, aunque se llame igual, no se puede borrar por error.
- Si lo prefieres, deja la respuesta en blanco: no se borra nada y te explica las otras formas de vaciar el bucket (desde la app o con **Empty Bucket** en el panel).

## Conectar agentes por MCP

Hay dos formas de conectar un cliente: con OAuth, sin copiar nada, o con un token que creas en la app.

### Con OAuth (Claude en la web, el escritorio y el móvil)

Los clientes que admiten la autorización OAuth de MCP solo necesitan la dirección `https://tu-dominio/mcp`. En Claude, añade un **conector personalizado** con esa dirección. Al conectar, tu copia muestra una pantalla de consentimiento donde eliges el espacio y los permisos, igual que al crear un token. El acceso aparece en **Agentes** y puedes revocarlo cuando quieras.

- **Autorización.** Sigue la especificación de autorización de MCP (revisión 2026-07-28): OAuth 2.1 con PKCE `S256`, metadatos del recurso protegido (RFC 9728) y del servidor de autorización (RFC 8414), indicadores de recurso (RFC 8707) y parámetro `iss` en la respuesta (RFC 9207).
- **Registro de clientes.** Los clientes se identifican con un Client ID Metadata Document, una URL `https` que tu copia lee sin seguir redirecciones. También pueden registrarse con Dynamic Client Registration (RFC 7591), que no guarda nada: el `client_id` lleva firmadas sus direcciones de vuelta.
- **Tokens.** Solo se admiten clientes públicos. El token de acceso dura una hora y solo vale para `/mcp`, nunca para la API REST ni para la bóveda. El de refresco es de un solo uso: si alguien presenta uno ya usado, o un código de autorización por segunda vez, el acceso se revoca. Un acceso que no se usa en 30 días caduca.
- **Requisito.** Los conectores de Claude se conectan desde los servidores de Anthropic, así que tu copia debe ser accesible desde Internet por HTTPS. Una copia en Cloudflare ya lo es.

### Con un token

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
| Cualquier lectura | `list_projects`, `search`, `read_attachment` (texto como texto, imágenes como imágenes) |
| Tareas · lectura | `get_board`, `get_card` |
| Tareas · escritura | `create_card`, `update_card` (con `base_version` si cambia la descripción), `move_card`, `archive_card`, `create_board`, `create_column`, `update_column`, `create_label`, `add_checklist_items`, `update_checklist_item` |
| Documentos · lectura | `list_pages`, `read_page` |
| Documentos · escritura | `create_page`, `update_page` (título, icono y contenido: reemplazar con `base_version`, o añadir al final), `move_page` (dentro de su proyecto) |
| Escritura + lectura de ambas áreas | `link_card_to_page` |
| Escritura en cualquiera de las dos áreas | `create_project` (renombrar proyectos sigue en la app), `upload_attachment` (texto o base64, hasta 5 MB) |
| **Puede borrar y mover**, con escritura en tareas | `delete_card`, `delete_board`, `delete_column`, `delete_label`, `delete_checklist`, `delete_checklist_item`, y `move_card` a otro tablero (la tarjeta pierde las etiquetas del tablero anterior) |
| **Puede borrar y mover**, con escritura en documentos | `delete_page` |
| **Puede borrar y mover**, con escritura en cualquiera de las dos | `delete_attachment`, `move_attachment`; `unlink_card_from_page` con lectura de ambas áreas; `delete_project` con escritura en ambas |

Las herramientas que borran van marcadas como destructivas, para que clientes como Claude puedan preguntarte antes. Los tokens y conexiones creados antes de la 1.1.0 no tienen **Puede borrar y mover** hasta que lo actives en **Agentes**.

El endpoint es MCP Streamable HTTP sin estado (`POST /mcp`). La misma API REST también acepta los tokens creados en la app, con los mismos permisos. La papelera, deshacer desde el historial, la actividad, la cuenta, los tokens y la bóveda exigen sesión en el navegador. Los tokens de OAuth solo valen para `/mcp`.

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

La CI ejecuta las dos y, además, repite la batería contra el servidor de Node en Firefox y en WebKit (el motor de Safari), cada uno con una copia limpia. En local, instala el navegador y elígelo con `E2E_BROWSER`, también contra una copia recién creada:

```bash
pnpm --filter @orqevio/web exec playwright install firefox
```

```bash
E2E_BROWSER=firefox SETUP_CODE=e2e-setup-code-1234 pnpm test:e2e
```

Primero reclaman la copia desde la interfaz y prueban la clave de acceso. Después cubren el cambio de clave en Ajustes, el tablero (incluido arrastrar con ratón y con teclado), documentos con referencias a tareas, pegar una imagen en un documento y adjuntar archivos a una tarjeta, el ciclo completo de la bóveda (con recuperación), un agente MCP trabajando en directo sobre el tablero, un agente que reorganiza un proyecto y la persona que luego lo deshace, y un cliente que se conecta con OAuth tras la pantalla de consentimiento. Fallan si aparece cualquier error en la consola del navegador.

## Configuración

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Orígenes públicos, direcciones completas separadas por comas. Decide la primera: con `https://` activa cookies `Secure` y HSTS. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Dirección de escucha. Con Docker Compose, `PORT` es el puerto de tu máquina, y el contenedor siempre escucha en el 3000. |
| `DATA_DIR` | `./data` | Carpeta de datos: base SQLite (`orqevio.db`) y adjuntos (`uploads/`). En Docker es el volumen `orqevio-data`. |
| `DATABASE_PATH` | `DATA_DIR/orqevio.db` | Ruta del archivo SQLite, si quieres separarlo de los adjuntos (solo desde el código fuente). |
| `MAX_UPLOAD_MB` | `20` | Tamaño máximo por archivo. |
| `BACKUP_DIR` | `DATA_DIR/backups` | Dónde van las copias de seguridad diarias. Pon una carpeta de otro disco para guardarlas aparte de los datos. |
| `BACKUPS` | `on` | `off` desactiva las copias de seguridad diarias. |
| `TRUST_PROXY` | `false` | Detrás de un proxy inverso, `true`, o el número de proxies que hay delante. La dirección del visitante para los límites de intentos fallidos pasa a ser la que el proxy añade al final de `X-Forwarded-For`, nunca lo que envió el visitante. |
| `SECURE_COOKIES` | según `APP_URL` | Fuerza cookies `Secure`. |
| `SETUP_CODE` | generado al arrancar | Código para reclamar la copia la primera vez. Si lo cambias, permite recuperar el acceso. |
| `UPDATE_CHECK` | `on` | Comprueba en `registry.npmjs.org` si hay versiones nuevas para avisarte. `off` lo desactiva. |

En Cloudflare solo se usan `SETUP_CODE` (secreto obligatorio), `APP_URL` (opcional; por defecto, el origen de cada visita), `MAX_UPLOAD_MB` y `UPDATE_CHECK`. El resto no aplica: los datos viven en el Durable Object y en R2.

## Limitaciones conocidas

- **Uso individual por espacio.** El modelo de datos ya contempla miembros y roles, pero no hay invitaciones ni asignación de tarjetas a personas: el producto está pensado para ti y tus agentes.
- **Sin coedición simultánea.** No hay edición colaborativa en tiempo real tipo CRDT; los conflictos se detectan por versión y se resuelven explícitamente.
- **OAuth solo para clientes públicos.** No se admiten clientes confidenciales (`client_secret_*`, `private_key_jwt`) ni el flujo `client_credentials`; los clientes MCP habituales, incluidos los conectores de Claude, son públicos.
- **Un solo proceso por copia.** SQLite, los adjuntos en disco y el tiempo real en memoria asumen una única instancia del servidor por copia, que es el modelo de Orqevio (una copia por persona).
- **Sin migración desde PostgreSQL.** Las versiones de desarrollo anteriores usaban PostgreSQL; no hay herramienta para pasar esos datos a SQLite.
- **Una persona por copia.** No hay registro ni correo; si se pierde la clave de acceso, se recupera desde el servidor (CLI o un `SETUP_CODE` nuevo).
- **Bóveda personal.** No se comparte entre personas. Importa los CSV de los navegadores y los formatos de Bitwarden; no lee los de otros gestores (1Password, KeePass…), salvo que los conviertas antes a uno de esos.
- **Imágenes externas.** Las imágenes de documentos que apuntan a otros dominios se cargan desde su origen.
- **Navegadores modernos y conexión segura para la bóveda.** La app se prueba en Chromium, Firefox y WebKit (el motor de Safari). La bóveda necesita WebCrypto, Web Workers y WebAssembly, y los navegadores solo ofrecen WebCrypto por HTTPS o en `localhost`: si abres tu copia por `http://` desde otra dirección (por ejemplo, la IP de tu red local), la bóveda lo explica y el resto de la app sigue funcionando.

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
packages/create-orqevio  instalador: npx create-orqevio (instalar, actualizar, recuperar, desinstalar)
templates/cloudflare plantilla del botón «Deploy to Cloudflare» (wrangler.jsonc y package.json generados)
apps/site            la web pública orqevio.com: páginas estáticas sin cookies ni analítica
```

**La web pública.** `pnpm --filter @orqevio/site build` genera `apps/site/dist` con las páginas y las mismas fuentes que la app, servidas desde el propio sitio. `pnpm --filter @orqevio/site preview` la sirve en local con Wrangler. Se publica en `orqevio.com` con Workers Builds desde `main`; la configuración está en «Web pública» de [RELEASING.md](RELEASING.md). Sus pruebas comprueban los enlaces, las fuentes, las cabeceras de seguridad y que la guía de instalación de cada idioma diga lo mismo que el README en inglés.

## Sin garantía

Orqevio se ofrece tal cual, sin garantías de ningún tipo, como dice su [licencia](LICENSE.md). Tú alojas y administras tu copia, así que sus datos quedan a tu cargo:

- **Guarda tus copias también en otro sitio.** Tu copia hace una copia de seguridad cada día, pero en el mismo servidor o la misma cuenta: sácalas de vez en cuando, o descarga un ZIP desde **Ajustes → Exportar tus datos** (ver [Con Docker](#con-docker-recomendado-para-producción) y [En Cloudflare](#en-cloudflare-con-un-comando)).
- **Exporta tu bóveda** de vez en cuando, cifrada con tu contraseña maestra.
- **Guarda bien tu clave de acceso y la clave de recuperación de tu bóveda.** Nadie puede abrir tu bóveda sin su contraseña maestra o su clave de recuperación, ni siquiera nosotros.

## Licencia

Orqevio se publica con la [Functional Source License 1.1, con licencia futura Apache 2.0](LICENSE.md) (`FSL-1.1-ALv2`). Puedes usarlo, modificarlo y alojar tu copia, también en tu empresa. Lo único que no permite es ofrecerlo como un producto o servicio comercial que compita con Orqevio. Cada versión pasa a la licencia Apache 2.0 a los dos años de publicarse.
