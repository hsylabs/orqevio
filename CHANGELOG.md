# Registro de cambios

Todas las versiones de Orqevio, de la más reciente a la más antigua. Cada versión se publica a la vez como paquetes npm (`create-orqevio` y `orqevio`), como imagen Docker (`ghcr.io/hsylabs/orqevio`) y como release en GitHub.

Para actualizar tu copia, consulta «Actualizaciones» en el README.

## [Sin publicar]

Primera versión.

### Tareas, documentos y agentes
- Espacios, proyectos y tableros Kanban con etiquetas, fechas, checklists, archivo y adjuntos.
- Documentos jerárquicos en Markdown con editor por bloques, tablas, imágenes y enlaces directos a tareas.
- Búsqueda de texto completo sin distinguir mayúsculas ni acentos.
- Servidor MCP con tokens por espacio y permisos diferenciados; la bóveda queda fuera del alcance de los agentes.
- Conexión por OAuth para clientes MCP como los conectores de Claude: basta con la dirección `/mcp`, tu copia pide permiso en una pantalla de consentimiento y el acceso se revoca desde «Agentes».
- Cambios en directo por WebSocket, también los de los agentes.

### Bóveda
- Credenciales y notas cifradas de extremo a extremo, con generador de contraseñas, clave de recuperación y bloqueo automático.
- Códigos de verificación en dos pasos (TOTP): pega la clave secreta o el enlace `otpauth://` y la bóveda muestra el código con su cuenta atrás. Se calculan en el navegador.
- Importar desde el CSV de Chrome, Edge, Firefox y Safari, y desde el CSV o el JSON sin cifrar de Bitwarden, sin duplicar lo que ya tienes.
- Exportar una copia cifrada con tu contraseña maestra o, tras confirmar un aviso, sin cifrar (JSON de Bitwarden). Todo se procesa en el navegador.

### Tu copia
- Sin registro ni correo: la copia se reclama con un código de configuración y se entra con una clave de acceso de 160 bits.
- Instalación en tu cuenta de Cloudflare con `npx create-orqevio`, o con el botón «Deploy to Cloudflare». Si la cuenta aún no tiene R2 activado, el instalador lo explica antes de desplegar.
- Instalación en tu servidor con Docker; los datos viven en un único archivo SQLite.
- En inglés, español, francés, portugués, italiano, alemán, neerlandés y japonés. La copia toma el idioma del navegador al reclamarla y se cambia en Ajustes; los tableros nuevos reciben sus columnas en ese idioma.
- Probada en Chromium, Firefox y WebKit (el motor de Safari). Si la abres por `http://` desde otra dirección, la bóveda explica que necesita HTTPS y el resto de la app sigue funcionando.
