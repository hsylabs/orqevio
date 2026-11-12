# Tu copia de Orqevio

Este repositorio despliega tu propia copia de [Orqevio](https://github.com/hsylabs/orqevio) en tu cuenta de Cloudflare: un Worker con la web, la API y el MCP, un Durable Object con tu base de datos SQLite y un bucket R2 para los adjuntos.

Cada cambio en la rama principal se despliega solo (Workers Builds).

## Primera vez

Abre la dirección de tu Worker (`https://<nombre>.<tu-subdominio>.workers.dev`), escribe el código de configuración que elegiste al crear el repositorio y tu nombre. Orqevio te dará tu clave de acceso: guárdala en tu gestor de contraseñas.

## Actualizaciones

Dependabot abre cada semana un pull request cuando hay una versión nueva de Orqevio (el paquete `create-orqevio`). Al fusionarlo, tu copia se actualiza; tus datos, tu clave y tu bóveda se conservan.

En GitLab no hay Dependabot: cambia tú la versión de `create-orqevio` en `package.json`, o usa Renovate.

## Si pierdes la clave

1. En el panel de Cloudflare, ve a **Workers y Pages → tu Worker → Ajustes → Variables y secretos** y pon un valor nuevo en `SETUP_CODE` (al menos 12 letras o dígitos).
2. Abre tu copia y pulsa **«¿Has perdido la clave?»** con ese código.

Se cierran todas las sesiones; tus datos y tu bóveda no cambian.

## Qué no conviene tocar

`wrangler.jsonc` solo aporta el nombre del Worker y el del bucket: el resto de la configuración viene del paquete instalado, para que las actualizaciones lleguen completas.
