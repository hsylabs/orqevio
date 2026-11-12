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
- Cambios en directo por WebSocket, también los de los agentes.

### Bóveda
- Credenciales y notas cifradas de extremo a extremo, con generador de contraseñas, clave de recuperación y bloqueo automático.
- Códigos de verificación en dos pasos (TOTP): pega la clave secreta o el enlace `otpauth://` y la bóveda muestra el código con su cuenta atrás. Se calculan en el navegador.

### Tu copia
- Sin registro ni correo: la copia se reclama con un código de configuración y se entra con una clave de acceso de 160 bits.
- Instalación en tu cuenta de Cloudflare con `npx create-orqevio`, o con el botón «Deploy to Cloudflare».
- Instalación en tu servidor con Docker; los datos viven en un único archivo SQLite.
