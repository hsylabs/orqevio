# Orqevio

**English** · [Español](README.es.md)

**A workspace where you organize your projects, document what you know and keep your credentials safe. Everything is within reach for you and your AI agents, with permissions you control.**

Orqevio brings together four pieces, and only those four:

| Module | What's included |
| --- | --- |
| **Tasks** | Workspaces, projects, Kanban boards, columns, cards, labels, due dates, checklists, archive and attachments. |
| **Docs** | Nested pages in a block editor that saves Markdown, with simple tables, images, files and direct links to tasks. |
| **Vault** | End-to-end-encrypted credentials and private notes, two-step verification codes (TOTP), import and export, a password generator, a recovery key and auto-lock. |
| **Agents (MCP)** | An MCP server with per-workspace permissions, so agents can look things up in your docs, create tasks and rearrange boards. It connects with OAuth (for example, as a Claude connector) or with a token. |

The key design decision: **the vault is walled off from agents.** No token can reach it, not even its encrypted contents, and the server never knows your secrets.

**Each copy of Orqevio belongs to one person.** There's no sign-up and no email: you claim your copy once with a setup code, and from then on you sign in with an access key.

---

## Highlights

- **Tasks and documents, linked both ways.** Type `@` in a document to link a task, and the link shows up on both sides. You can also link documents from the card.
- **Watch your agents work.** When an agent creates or moves a card, you see it appear with a blue halo and the agent's name, and you get a notification. The dot in the logo turns blue while they work.
- **No stepping on each other's toes.** Documents use optimistic versioning: if an agent edits a page while you're writing, Orqevio lets you know and you choose which version to keep.
- **Keyboard first.** `⌘K`/`Ctrl K` opens the command palette to search and jump anywhere; `⌘\` hides the sidebar; and you can rearrange the whole Kanban board from the keyboard (space to pick up, arrow keys to move, space to drop), with screen reader announcements.
- **A look of its own.** Warm paper, ink and two signal colors: khaki for you, ultramarine for your agents. Editorial type (Fraunces) over a restrained interface (Instrument Sans). Light and dark themes, with text colors tuned to WCAG AA contrast.
- **In your language.** The app and the installer speak English, Spanish, French, Portuguese, Italian, German, Dutch and Japanese. Your copy takes your browser's language when you claim it, and you can change it anytime in **Settings**.

## Architecture

```
apps/web        React 19 + Vite · TanStack Query · React Router · Tailwind CSS 4
                TipTap 3 (native Markdown) · dnd-kit · Radix UI · cmdk
apps/server     Hono · Drizzle ORM · SQLite (FTS5) · official MCP SDK
                Node 22 (Docker) or Cloudflare Workers + Durable Objects + R2
packages/shared zod schemas, permissions and types shared by the API, MCP and client
```

```
         Browser (session)                  MCP client (OAuth or bearer token)
                 │                                          │
           REST /api/*                                 POST /mcp
                 │                                          │
                 └───────────────► Domain services ◄────────┘
                            (permissions and validation)
                                          │
                                  SQLite (one file) ── in-memory events ──► real-time WebSocket
```

- **One domain layer.** The app's REST API and the MCP tools call exactly the same services. Every operation checks access to the workspace and the specific permission (`tasks:read`, `tasks:write`, `docs:read`, `docs:write`), so the rules are enforced in one place.
- **Markdown as the canonical format.** Documents and descriptions are stored as Markdown (GFM). It's portable, readable and what LLMs understand best. Internal references are ordinary links: `[Title](/card/<id>)` and `[Title](/doc/<id>)`.
- **One copy, one database.** Each copy belongs to one person and keeps everything in SQLite, with synchronous transactions. The same code runs in two places:
  - **Your own server (Docker or Node):** a single file (`DATA_DIR/orqevio.db`) plus the attachments folder.
  - **Cloudflare:** a Worker serves the web app and sends `/api` and `/mcp` to a single Durable Object, which keeps the data in its own SQLite database; attachments go to R2.
- **Streamed attachments.** The browser sends the file as is (not as a form), and the server streams it straight to disk or R2, checking its size and its real type. Memory and CPU use don't grow with the size of the file.
- **Full-text search.** FTS5 indexes over the titles and contents of cards and documents, ignoring case and accents ("cafe" finds "Café"), with title matches ranked first.
- **Real time without extra infrastructure.** Every change goes out to connected browsers over WebSocket (`/api/workspaces/:id/live`). The connection is only accepted with a session and from the app's origins; the browser sends a heartbeat every 25 s and reconnects on its own.
  - **On Node,** every heartbeat checks the session again. If you run Orqevio behind a reverse proxy, the proxy must allow WebSocket (Caddy and Traefik do by default; in Nginx, add the `Upgrade` and `Connection` headers).
  - **On Cloudflare,** connections hibernate: the platform answers the heartbeat without waking the Durable Object, so an idle copy uses no resources. Access is checked when a browser connects, before each change is delivered, and right after you sign out, change your access key or recover access.
- **Stable ordering.** Columns, cards, pages and checklists use fractional indexes (`COLLATE "C"`), so moving an item updates a single row.

## Security model

**Access and sessions**
- No sign-up and no passwords: you claim your copy once with the setup code and sign in with a random 160-bit key. The server stores only the SHA-256 hash of each and compares them in constant time.
- The session lives in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie (with the `__Host-` prefix over HTTPS). The database stores only its SHA-256 hash.
- Cookie-authenticated writes are only accepted from the `APP_URL` origins (CSRF protection). Changing your access key signs out your other sessions, and recovering access signs out all of them.
- Strict headers: a CSP with no inline scripts, `frame-ancestors 'none'`, `nosniff`, HSTS over HTTPS and Permissions-Policy.
- Rate limits on signing in, claiming the copy and recovering access, plus a per-token request limit on MCP.

**Vault (zero knowledge)**

```
master password ──Argon2id (64 MiB, 3 passes, random salt)──► KEK ─┐
recovery key (160 bits) ──HKDF-SHA256──────────────────────► RKEK ─┴─ AES-256-GCM wraps the vault key (256 bits)
vault key ── AES-256-GCM, associated data = user + item id ──► encrypted items
```

- All encryption happens in the browser (WebCrypto, with Argon2id in a Web Worker). The server stores only the key derivation parameters and `v1.<iv>.<ciphertext>` envelopes. Even titles are encrypted.
- The vault key lives only in memory, as a non-extractable `CryptoKey`: it's discarded when you lock the vault, after a period of inactivity (1–60 min) or when you reload the page.
- AES-GCM associated data keeps anyone with access to the database from swapping items between users or entries.
- When you copy a secret, the clipboard is cleared after 30 seconds. The password generator uses unbiased cryptographic randomness.
- Changing your master password only rewraps the vault key: items aren't re-encrypted. The recovery key lets you choose a new master password. Without either of them, your data can't be recovered, by design.
- The `/api/vault/*` routes reject any request with an `Authorization` header before reading any data, and the MCP server has no vault tools.

**Agents**
- Each token belongs to a single workspace and has permissions per area, for tasks and for docs: no access, read, or read and write. It's shown only once, and only its hash is stored.
- Each agent sees only the tools its token allows. Agents **can't delete anything**: they can only archive cards, and you can restore them.
- Every action is logged with its author (a person or an agent) and shows up in the app. You can revoke a token instantly, and make tokens expire after 30, 90 or 365 days.
- Apps connected with OAuth get the permissions you choose on the consent screen. That screen shows where you'll be sent back to and whether the app's identity is published or self-declared. Nothing is ever sent to an address the app hasn't registered.

## Getting started

### With Docker (recommended for production)

```bash
cp .env.example .env
```

Edit `.env`: set `APP_URL` to your public URL (for example, `https://orqevio.your-domain.com`) and, if you like, a `SETUP_CODE` of your own (see [Accessing your copy](#accessing-your-copy)).

```bash
docker compose up -d
```

This runs the published image (`ghcr.io/hsylabs/orqevio`, for amd64 and arm64). To pin a version, add `ORQEVIO_VERSION=1.0.0` to `.env`. Until the first release is out, or if you'd rather build the image yourself from this repository:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The app listens on port 3000 and applies its migrations on startup. Put it behind a reverse proxy with HTTPS (Caddy, Nginx, Traefik) and, if you do, add `TRUST_PROXY=true`. The SQLite database and the attachments are stored in the `orqevio-data` volume.

**Backups.** Copy the volume while the app is stopped, or make a live backup with `sqlite3 /data/orqevio.db ".backup '/data/backup.db'"` and save the `uploads` folder too.

### On Cloudflare (with one command)

Your copy lives in your own Cloudflare account: a Worker with the web app, the API and MCP, a Durable Object with its SQLite database and an R2 bucket for attachments. You need a Cloudflare account (the free plan is enough) and Node 22.12 or later.

**Before your first install, enable R2** in the Cloudflare dashboard, under [R2 → Overview](https://dash.cloudflare.com/?to=/:account/r2/overview). The included usage is free (10 GB of storage a month), although Cloudflare may ask for a payment method. If R2 isn't enabled, the installer stops before deploying and tells you.

```bash
npx create-orqevio
```

The installer:

1. Opens your browser so you can sign in to Cloudflare (Wrangler's official sign-in).
2. Asks you for a name for the copy (`orqevio` by default), which becomes part of its address.
3. Deploys the copy and creates its R2 bucket.
4. Shows you its address (`https://orqevio.<your-subdomain>.workers.dev`) and a randomly generated, single-use **setup code**.

Open the address and enter the code and your name: Orqevio gives you your access key. From then on, the code no longer works.

```bash
npx create-orqevio@latest update
```

Updates your copy to the latest version. Your data, your access key and your vault are kept.

```bash
npx create-orqevio@latest recover
```

If you lose your access key, this generates a new code. Use it in **Lost your key?** on the sign-in screen.

- **Several copies:** add `--name <name>` to any of these commands.
- **Several Cloudflare accounts:** the installer asks which one to use; you can also pass it with `--account <id>` or `CLOUDFLARE_ACCOUNT_ID`.
- **Language:** the installer speaks your terminal's language; pick another with `--lang <code>` (`en`, `es`, `fr`, `pt`, `it`, `de`, `nl` or `ja`).
- **Your settings are kept:** the variables you set in the Cloudflare dashboard (`APP_URL`, `MAX_UPLOAD_MB`) survive updates.
- **Privacy:** the installer turns off Wrangler's anonymous telemetry, unless you turned it on yourself.
- **What it does, exactly:**
  - Wrangler works in a private temporary folder, never in the folder you're in.
  - The setup code is uploaded as a Worker secret, and the folder is deleted when the installer finishes, even if you interrupt it.
- **Before the first release on npm:** the `create-orqevio` and `orqevio` packages aren't published yet. Until they are, run the installer from the repository:

```bash
pnpm install
```

```bash
pnpm build:cloudflare
```

```bash
node packages/create-orqevio/dist/cli.js
```

**With the button (alternative).** If you'd rather keep your copy in a GitHub or GitLab repository of your own:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hsylabs/orqevio/tree/main/templates/cloudflare)

Cloudflare creates a small repository in your GitHub or GitLab account (the `templates/cloudflare` template), asks you for the setup code (`SETUP_CODE`) and deploys the copy. After that:
- **Deployments:** every change to that repository deploys automatically.
- **Updates:** Dependabot proposes new versions of Orqevio in a pull request; when you merge it, your copy updates.
- **If you lose your access key:** change the `SETUP_CODE` secret in the Cloudflare dashboard and use **Lost your key?**.

You end up with the same copy as with the command.

Cloudflare's free plan is enough for personal use (limits as of November 2026):

| Resource | Free plan |
| --- | --- |
| Requests (Worker and Durable Object) | 100,000 a day |
| CPU | 10 ms per request; normal use and MCP stay at 1–5 ms |
| Durable Object duration | 13,000 GB-s a day; while nobody is using the copy, it hibernates and doesn't count |
| Database (Durable Object SQLite) | 1 GB per copy (5 GB in total per account) |
| Attachments (R2) | 10 GB and 1 million writes a month |

**Notes**
- **`SETUP_CODE` is required on Cloudflare.** The Durable Object restarts often, so a code generated in memory wouldn't work. The installer creates one for you; without it, the deployment fails.
- **Your domain.** By default, the app accepts whatever origin it's visited from. If you use a custom domain and want to pin it, set `APP_URL` as a Worker variable.
- **Try it locally without an account:** create `apps/server/.dev.vars` with `SETUP_CODE=...` and run `pnpm --filter @orqevio/server dev:worker`. Your copy runs at `http://localhost:8787`.
- **By hand, without the installer:** from `apps/server`, after `pnpm build`, run `npx wrangler deploy --secrets-file <file>`, with a file outside the repository that contains `SETUP_CODE=...`. Wrangler creates the R2 bucket if it doesn't exist.

### Locally, for development

Requirements: Node 22.12 or later and pnpm 10. You don't need an external database: SQLite comes with the server (`better-sqlite3` compiles on install if there's no prebuilt binary for your system).

```bash
pnpm install
```

```bash
cp .env.example .env
```

In `.env`, use `APP_URL=http://localhost:5173,http://localhost:3000`. Development data is stored in `apps/server/data/`.

```bash
pnpm dev
```

Open `http://localhost:5173`. Vite forwards `/api` and `/mcp` to the server on port 3000.

### Production build without Docker

```bash
pnpm build
```

```bash
pnpm start
```

### Accessing your copy

1. **The first time.** Open your copy's URL and enter the setup code and your name:
   - If you set `SETUP_CODE`, it's that value. Use at least 12 letters or digits.
   - If you didn't, the server generates one on startup and prints it in its log (`docker compose logs app`). It works until the copy is claimed or the server restarts.
   - On Cloudflare, the installer gives it to you.
2. **Your access key.** Orqevio generates a random 160-bit key and shows it **only once**. Save it in your password manager: it's all you need to sign in from any device. When you type it, case and hyphens don't matter.
3. **Changing it.** In **Settings → Access key** you can generate a new one; your other sessions are signed out.

If you lose your access key, whoever manages the copy can generate a new one (on Cloudflare, with `npx create-orqevio@latest recover`):

```bash
docker compose exec app node dist/cli.js reset-access
```

Without Docker:

```bash
node apps/server/dist/cli.js reset-access
```

You can also set a new `SETUP_CODE`, restart the copy and use **Lost your key?** on the sign-in screen. Either way, all sessions are signed out.

`node dist/cli.js status` shows whether the copy has been claimed, and by whom. None of this affects the vault: the server never knows its master password.

## Updates

Every release has a version number and release notes (`CHANGELOG.md` and the GitHub releases), and it's published to npm and as a Docker image at the same time. On startup, each copy applies its migrations. Migrations are always backward compatible and are never changed once published; a test makes sure of it.

| Installation | How to update | What's kept |
| --- | --- | --- |
| Command (Cloudflare) | `npx create-orqevio@latest update` | Data, access key, vault and dashboard variables |
| Button (Cloudflare) | Merge the Dependabot pull request in your repository | The same |
| Docker | `docker compose pull` and `docker compose up -d` | The `orqevio-data` volume |
| From source | `git pull`, `pnpm install`, `pnpm build` and restart | The `DATA_DIR` folder |

**In-app notice.** **Settings → This copy** shows your version and, when a new one comes out, how to update based on how you installed your copy; the user menu flags it with a dot.
- **What it checks:** your copy's server asks `registry.npmjs.org` for the latest published version of `create-orqevio`, at most every 12 hours and only while you're using the app. It stores the answer, so restarting doesn't trigger extra requests.
- **What it sends:** a GET request with none of your data.
- **Turning it off:** set `UPDATE_CHECK=off`. Only the owner sees the notice, never agents.

## Connecting agents over MCP

There are two ways to connect a client: with OAuth, with nothing to copy, or with a token you create in the app.

### With OAuth (Claude on the web, desktop and mobile)

Clients that support MCP's OAuth authorization only need the address `https://your-domain/mcp`. In Claude, add a **custom connector** with that address. When you connect, your copy shows a consent screen where you choose the workspace and the permissions, just like when you create a token. The connection shows up in **Agents**, and you can revoke it whenever you like.

- **Authorization.** It follows the MCP authorization specification (revision 2026-07-28): OAuth 2.1 with `S256` PKCE, protected resource metadata (RFC 9728), authorization server metadata (RFC 8414), resource indicators (RFC 8707) and the `iss` response parameter (RFC 9207).
- **Client registration.** Clients identify themselves with a Client ID Metadata Document, an `https` URL that your copy fetches without following redirects. They can also use Dynamic Client Registration (RFC 7591), which stores nothing: the `client_id` carries the client's redirect URIs, signed.
- **Tokens.** Only public clients are supported. The access token lasts one hour and is only valid for `/mcp`, never for the REST API or the vault. The refresh token is single-use: if someone presents one that was already used, or reuses an authorization code, the connection is revoked. A connection that goes unused for 30 days expires.
- **Requirement.** Claude connectors connect from Anthropic's servers, so your copy must be reachable from the internet over HTTPS. A copy on Cloudflare already is.

### With a token

1. In Orqevio, go to **Agents → Connect an agent**, choose the permissions and when the token expires, and copy it.
2. Paste the configuration the app gives you. Examples:

**Claude Code**

```bash
claude mcp add --transport http orqevio https://your-domain/mcp --header "Authorization: Bearer orq_…"
```

**Cursor** (`~/.cursor/mcp.json`) and **VS Code** (`.vscode/mcp.json`, with `"servers"` and `"type": "http"`)

```json
{ "mcpServers": { "orqevio": { "url": "https://your-domain/mcp", "headers": { "Authorization": "Bearer orq_…" } } } }
```

**Claude Desktop** (through the `mcp-remote` bridge, which needs Node.js)

```json
{
  "mcpServers": {
    "orqevio": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-domain/mcp", "--header", "Authorization:${ORQEVIO_AUTH}"],
      "env": { "ORQEVIO_AUTH": "Bearer orq_…" }
    }
  }
}
```

**Available tools** (each token sees only the ones it allows):

| Permission | Tools |
| --- | --- |
| Any read permission | `list_projects`, `search` |
| Tasks · read | `get_board`, `get_card` |
| Tasks · write | `create_card`, `update_card`, `move_card`, `archive_card`, `create_board`, `create_column`, `update_column`, `create_label`, `add_checklist_items`, `update_checklist_item` |
| Docs · read | `list_pages`, `read_page` |
| Docs · write | `create_page`, `update_page` (replace with `base_version`, or append to the end) |
| Read and write on both areas | `link_card_to_page` |
| Write on either area | `create_project` (people still rename and delete projects) |

The endpoint is stateless MCP Streamable HTTP (`POST /mcp`). The REST API also accepts tokens created in the app, with the same permissions, except for the account, tokens and the vault, which require a browser session. OAuth tokens are only valid for `/mcp`.

## Testing

```bash
pnpm typecheck
```

```bash
pnpm test
```

`pnpm test` runs the unit tests (vault cryptography, the password generator and links) and the server's integration tests against a real SQLite database (signing in with the setup code and the access key, CSRF, isolation between workspaces, per-token permissions, the vault being out of reach for tokens, the MCP tools with the official client, and real time). Each test file creates its own copy in a temporary folder and deletes it when it's done.

End-to-end tests run with Playwright, against the production server running on an **empty** database, with the same `SETUP_CODE` on the server and in the tests (`e2e-setup-code-1234` by default):

```bash
SETUP_CODE=e2e-setup-code-1234 pnpm test:e2e
```

The same suite runs against the Cloudflare runtime locally (`pnpm --filter @orqevio/server dev:worker`, with the same code in `apps/server/.dev.vars`). CI runs it against the bundle the installer deploys:

```bash
E2E_BASE_URL=http://127.0.0.1:8787 SETUP_CODE=e2e-setup-code-1234 pnpm test:e2e
```

CI runs both, and also repeats the suite against the Node server in Firefox and WebKit (Safari's engine), each with a fresh copy. Locally, install the browser and pick it with `E2E_BROWSER`, again against a freshly created copy:

```bash
pnpm --filter @orqevio/web exec playwright install firefox
```

```bash
E2E_BROWSER=firefox SETUP_CODE=e2e-setup-code-1234 pnpm test:e2e
```

The tests first claim the copy through the interface and try the access key. Then they cover changing the key in Settings, the board (including dragging with the mouse and with the keyboard), documents that reference tasks, pasting an image into a document and attaching files to a card, the full vault lifecycle (including recovery), an MCP agent working live on the board, and a client that connects with OAuth through the consent screen. They fail if any error shows up in the browser console.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Public origins, separated by commas. With `https://`, it turns on `Secure` cookies and HSTS. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Address to listen on. |
| `DATA_DIR` | `./data` | Data folder: the SQLite database (`orqevio.db`) and attachments (`uploads/`). |
| `DATABASE_PATH` | `DATA_DIR/orqevio.db` | Path to the SQLite file, if you want to keep it apart from the attachments. |
| `MAX_UPLOAD_MB` | `20` | Maximum size per file. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` (behind a reverse proxy). |
| `SECURE_COOKIES` | based on `APP_URL` | Forces `Secure` cookies. |
| `SETUP_CODE` | generated on startup | Code to claim the copy the first time. Changing it lets you recover access. |
| `UPDATE_CHECK` | `on` | Asks `registry.npmjs.org` for new versions so the app can let you know. `off` turns it off. |

On Cloudflare, only `SETUP_CODE` (a required secret), `APP_URL` (optional; defaults to the origin of each visit), `MAX_UPLOAD_MB` and `UPDATE_CHECK` are used. The rest doesn't apply: the data lives in the Durable Object and in R2.

## Known limitations

- **One user per workspace.** The data model already supports members and roles, but there are no invitations and you can't assign cards to people: the product is designed for you and your agents.
- **No simultaneous co-editing.** There's no CRDT-style real-time collaborative editing; conflicts are detected by version and resolved explicitly.
- **OAuth for public clients only.** Confidential clients (`client_secret_*`, `private_key_jwt`) and the `client_credentials` flow aren't supported; the usual MCP clients, Claude connectors included, are public.
- **One process per copy.** SQLite, attachments on disk and in-memory real time assume a single server instance per copy, which is Orqevio's model (one copy per person).
- **Backups on Cloudflare.** There's no export from the app yet: the data stays in the Durable Object and in the R2 bucket in your account.
- **No migration from PostgreSQL.** Earlier development versions used PostgreSQL; there's no tool to move that data to SQLite.
- **One person per copy.** There's no sign-up or email; if you lose your access key, you recover access from the server (with the CLI or a new `SETUP_CODE`).
- **Personal vault.** It isn't shared between people. It imports browser CSV exports and Bitwarden's formats; it can't read those of other password managers (1Password, KeePass…) unless you convert them to one of these first.
- **External images.** Images in documents that point to other domains load from where they're hosted.
- **Modern browsers, and a secure connection for the vault.** The app is tested in Chromium, Firefox and WebKit (Safari's engine). The vault needs WebCrypto, Web Workers and WebAssembly, and browsers only offer WebCrypto over HTTPS or on `localhost`: if you open your copy over `http://` from another address (for example, its IP on your local network), the vault explains why it can't open, and the rest of the app keeps working.

## Repository layout

```
apps/server/src
  services/   domain logic and permissions (shared by REST and MCP)
  http/       REST routes, session middleware, CSRF and vault isolation
  mcp/        MCP server and HTTP transport
  db/         Drizzle schema and migrations (apps/server/drizzle)
  node/       Node entry point: static files and WebSocket
  worker/     Cloudflare entry point: Worker, Durable Object, R2 and embedded migrations
apps/web/src
  features/   shell, home, projects, boards, docs, vault, agents, settings
  components/ design system (buttons, dialogs, menus, editor…)
  lib/        API client, queries, real time and formatting
packages/shared/src  schemas, permissions, types and link helpers
packages/orqevio     the package deployed to Cloudflare (Worker, web app and base configuration)
packages/create-orqevio  the installer: npx create-orqevio (install, update, recover)
templates/cloudflare the "Deploy to Cloudflare" button template (generated wrangler.jsonc and package.json)
apps/site            the public website, orqevio.com: static pages with no cookies or analytics
```

**The public website.** `pnpm --filter @orqevio/site build` builds `apps/site/dist` with the pages and the same fonts as the app, served from the site itself. `pnpm --filter @orqevio/site preview` serves it locally with Wrangler. It's published to `orqevio.com` with Workers Builds from `main`; the setup is in the "Web pública" section of [RELEASING.md](RELEASING.md) (in Spanish). Its tests check the links, the fonts, the security headers, and that the install guide in every language says the same as this README.

## License

Orqevio is released under the [Functional Source License 1.1, ALv2 Future License](LICENSE.md) (`FSL-1.1-ALv2`). You can use it, change it and host your copy, at work too. The only thing it doesn't allow is offering it as a commercial product or service that competes with Orqevio. Each version becomes Apache 2.0 two years after its release.
