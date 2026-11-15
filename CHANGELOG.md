# Changelog

Every version of Orqevio, newest first. Each version is published at the same time as npm packages (`create-orqevio` and `orqevio`), as a Docker image (`ghcr.io/hsylabs/orqevio`) and as a GitHub release.

To update your copy, see [Updates](README.md#updates) in the README.

## [Unreleased]

### Fixed
- Agents can no longer delete labels, checklists, checklist items or the link between a card and a page through the REST API: as promised, agents can't delete anything. Creating, renaming and deleting labels, and removing links, now show in the activity.
- Deleting a column now says how many cards go with it, including the ones a filter hides and the archived ones. It used to say "The column is empty." when a filter hid its cards or all of them were archived, and then deleted them.
- With a card open, a change to its description made elsewhere, by an agent or in another tab, now shows up in the card. If you were typing at the same time, the card asks which version to keep, as pages do, instead of overwriting the other one. Card descriptions now have a version: `get_card` returns it, and `update_card` and the REST API accept it (`base_version`, `baseVersion`) to refuse an edit made from an older one.
- The subpages and attachments at the bottom of a page can be clicked again: the editor above them took the clicks, so only the keyboard and the sidebar reached them.
- On Cloudflare, pages with ten or more levels of subpages can be deleted, and so can the project, the workspace or the account that holds them, and the copy can be uninstalled. Deleting them failed with an internal error and left everything in place: the database there allows only a few levels of cascading deletes, so pages are now deleted deepest first.
- Editing a page or a card description no longer deletes or changes the Markdown the editor can't show. Headings of levels 4 to 6, images in a line of text and linked images such as badges are kept and shown, and HTML is kept as written and shown as its source. Text that looks like Markdown (`\# not a heading`, `1\. not a list`) stays text, and `&`, `<`, `>` and `&nbsp;` are written back as they were instead of as entities. An image whose name has brackets stays an image.
- The vault clears a copied password, note or code from the clipboard after 30 seconds only if nothing else was copied since, so it no longer wipes what you copied later. Where the browser doesn't let a page clear the clipboard (in another tab, or in Firefox and Safari without a click), Orqevio reminds you when you come back and clears it with one click; it used to fail silently. The messages no longer promise more than that.
- Signing in again in a tab whose session ended elsewhere opens the app at once. It used to stay loading, bouncing between the app and the sign-in screen and opening hundreds of connections to the server until the page was reloaded. A tab also stops trying to connect for live updates to a workspace it can't open, or once the server has refused it.
- A copy refuses to be claimed or recovered while its `SETUP_CODE` has fewer than 12 letters A–Z or digits, and says why. Only those characters count, so a code written in another alphabet, or in symbols, came down to nothing and accepted any symbol as the code: anyone could claim the copy, or take it over through recovery. The README and the Cloudflare template now say which characters count.

## [1.0.1] - 2026-11-15

### Fixed
- On Cloudflare, a new setup code (`recover`) and the one-time authorization to uninstall now reach your copy within seconds, instead of up to five minutes. The installer deploys them with Cloudflare's immediate update for Durable Objects, and updates of your copy apply at once too.
- The recovery form is there as soon as you open **Lost your key?**. If the new setup code hasn't reached your copy yet, it tells you so, instead of making you wait for the form to appear.
- Uninstalling in one step waits up to six minutes for your copy to receive its authorization, and says it's waiting, instead of giving up after 90 seconds.

## [1.0.0] - 2026-11-14

First release.

### Tasks, documents and agents
- Workspaces, projects and Kanban boards with labels, due dates, checklists, archive and attachments.
- Nested Markdown documents with a block editor, tables, images and direct links to tasks.
- Full-text search that ignores case and accents.
- An MCP server with per-workspace tokens and separate permissions; the vault stays out of agents' reach.
- OAuth connections for MCP clients such as Claude connectors: all you need is the `/mcp` address, your copy asks for your permission on a consent screen, and you can revoke access from **Agents**.
- Live updates over WebSocket, including changes made by agents.
- Agents that can write can start a project in an empty workspace (`create_project`); renaming and deleting stay in the app.
- Reconnecting an application such as Claude replaces its earlier access to the workspace, instead of adding another one; **Agents** flags accesses that haven't been used for a week.

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
- The sign-in screen gives the recovery steps for how your copy was installed, and the form appears as soon as the new code is in place.
- Uninstall from **Settings**: everything is deleted, attachments included, and the copy then shows how to remove what's left. On Cloudflare, `npx create-orqevio uninstall` does it all in one step: if your copy still holds attachments, it asks for the copy's address and has it delete them first, authorized from your Cloudflare account.
- In English, Spanish, French, Portuguese, Italian, German, Dutch and Japanese. Your copy takes your browser's language when you claim it, and you can change it in Settings; new boards get their columns in that language. The installer speaks your terminal's language, or the one you pick with `--lang`.
- Tested in Chromium, Firefox and WebKit (Safari's engine). If you open your copy over `http://` from another address, the vault explains that it needs HTTPS, and the rest of the app keeps working.
