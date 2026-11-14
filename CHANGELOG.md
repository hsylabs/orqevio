# Changelog

Every version of Orqevio, newest first. Each version is published at the same time as npm packages (`create-orqevio` and `orqevio`), as a Docker image (`ghcr.io/hsylabs/orqevio`) and as a GitHub release.

To update your copy, see [Updates](README.md#updates) in the README.

## [Unreleased]

First release.

### Tasks, documents and agents
- Workspaces, projects and Kanban boards with labels, due dates, checklists, archive and attachments.
- Nested Markdown documents with a block editor, tables, images and direct links to tasks.
- Full-text search that ignores case and accents.
- An MCP server with per-workspace tokens and separate permissions; the vault stays out of agents' reach.
- OAuth connections for MCP clients such as Claude connectors: all you need is the `/mcp` address, your copy asks for your permission on a consent screen, and you can revoke access from **Agents**.
- Live updates over WebSocket, including changes made by agents.
- Agents that can write can start a project in an empty workspace (`create_project`); renaming and deleting stay in the app.

### Vault
- End-to-end-encrypted credentials and notes, with a password generator, a recovery key and auto-lock.
- Two-step verification codes (TOTP): paste the secret key or the `otpauth://` link, and the vault shows the code with its countdown. Codes are generated in the browser.
- Import from the CSV exports of Chrome, Edge, Firefox and Safari, and from Bitwarden's CSV or unencrypted JSON, without duplicating what you already have.
- Export a copy encrypted with your master password or, after you confirm a warning, unencrypted (Bitwarden JSON). Everything is processed in the browser.

### Your copy
- No sign-up and no email: you claim your copy with a setup code and sign in with a 160-bit access key.
- Install it on your Cloudflare account with `npx create-orqevio`, or with the "Deploy to Cloudflare" button. If the account doesn't have R2 enabled yet, the installer tells you before deploying.
- Install it on your own server with Docker; your data lives in a single SQLite file.
- On Windows, the installer opens the Cloudflare sign-in itself, so antivirus programs that block the PowerShell command Wrangler uses don't get in the way.
- Recovering access asks why: if someone else may have your key, every agent is disconnected as well; if you only lost it, the screen lists the agents still connected so you can revoke any you don't recognize. With Docker, `reset-access --revoke-agents` does the same.
- Uninstall from **Settings**: everything is deleted, attachments included, and the copy then shows how to remove what's left. `npx create-orqevio uninstall` removes the Worker and its bucket from your Cloudflare account.
- In English, Spanish, French, Portuguese, Italian, German, Dutch and Japanese. Your copy takes your browser's language when you claim it, and you can change it in Settings; new boards get their columns in that language. The installer speaks your terminal's language, or the one you pick with `--lang`.
- Tested in Chromium, Firefox and WebKit (Safari's engine). If you open your copy over `http://` from another address, the vault explains that it needs HTTPS, and the rest of the app keeps working.
