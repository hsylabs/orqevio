# Changelog

Every version of Orqevio, newest first. Each version is published at the same time as npm packages (`create-orqevio` and `orqevio`), as a Docker image (`ghcr.io/hsylabs/orqevio`) and as a GitHub release.

To update your copy, see [Updates](README.md#updates) in the README.

## [Unreleased]

### Added
- Daily backups. Once a day, your copy backs itself up, as it is: workspaces, documents, cards, the encrypted vault, agents, the trash, the history and the attachments. It keeps them apart from its data: with Docker and Node in `BACKUP_DIR` (by default `DATA_DIR/backups`), and on Cloudflare in a second R2 bucket, `<name>-backups`, which installing and `npx create-orqevio update` create. It keeps the 7 newest, and the one made before the last restore; attachments are stored once for all of them. A Node and a Cloudflare backup are the same file. `BACKUPS=off` turns them off.
- **Settings → Backups** lists the backups, with what each holds, makes one on the spot with **Back up now**, and restores any of them after you type your access key and the copy's name. Before restoring, your copy backs itself up as it is. Restoring brings everything back as it was that day, and an older backup comes up to date. It ends every session: you stay signed in, and your access key is the one you use now. A backup made by a newer version, or damaged, is refused without touching anything. A copy installed again with the same name, or started with the same backups folder, finds the backups of the one before.
- Uninstalling asks whether the backups go too, in **Settings** and in `npx create-orqevio uninstall`, and keeps them unless you say so. The page shown afterwards says where they are.
- **Settings → Export your data** downloads a ZIP you can read without Orqevio, on Docker and on Cloudflare: each workspace's tasks in JSON, its documents in Markdown, in folders as in the page tree, and the attachments next to what they belong to. Links between documents, tasks and files point at the files in the ZIP. The vault has its own encrypted export, and the history and the trash are left out.
- The archived cards of a board are all within reach: **Archived** loads them 50 at a time, newest first, and says how many there are. Search finds archived cards when you ask: a checkbox in the command palette, and `include_archived` in the MCP `search` tool.
- On a phone, you drag cards with your finger: a long press (a quarter of a second) on a card or a column's handle picks it up, and a swipe still scrolls the board. In a card's sheet, the column menu has **Move up** and **Move down**, to reorder without dragging.

### Changed
- Due dates are the day they name, in every time zone. The REST API takes a day (`YYYY-MM-DD`) or an ISO 8601 date-time, whose day is the one written in it whatever its time and offset, and refuses days that don't exist and years outside 1900–2199. MCP no longer guesses from free text: `"12"` used to be December 2001.
- Each workspace's **Agents** page shows only its own accesses, and links to the other workspaces that have some, with how many. An access past its date says **Expired** with the date, not when it expires. The home checklist's "Connect an agent" counts only accesses of the workspace you're in.
- Behind a reverse proxy, `TRUST_PROXY` takes the number of proxies in front, and the visitor's address is the one the last of them added to `X-Forwarded-For`: never what the visitor sent. Orqevio warns once when it gets `X-Forwarded-For` without `TRUST_PROXY`.
- Claiming, recovering access and uninstalling from the installer each have their own limit of failed attempts. When one is reached, the app says how many minutes to wait, and the API answers with `Retry-After`.
- An `APP_URL` that isn't a valid address stops the start with a message that says which one and why, instead of an unexplained crash. When the first address, which decides on secure cookies and HSTS, isn't `https://` but another one is, Orqevio warns at start.

### Fixed
- Behind a proxy that asks for a password (HTTP basic auth), the app works: the proxy's `Authorization: Basic` header no longer makes every request fail, nor stops the copy from being claimed or the vault from opening. The README shows a configuration for Nginx.
- A board with more than 100 cards, or a document mentioning more than 100 cards, failed to load on Cloudflare.
- The vault in other tabs follows a new master password or a reset at once: they used to take the old password and export with it. A tab left open while the vault was reset can no longer save items with the old key, which no one could open. **Recover** from a tab opened before a reset no longer puts the old vault key back.
- Importing from Bitwarden keeps what has no field of its own in the vault: custom fields, more addresses and older passwords go into the item's notes, and the review says so. Bitwarden CSV's addresses separated by commas are split. A file that isn't UTF-8, a quote left open in a CSV and items over the limits are reported instead of breaking the import, and importing the vault's own export no longer duplicates items with spaces.
- The document editor no longer retries a save forever. It waits longer each time, 1 second up to 30, only when the failure may pass (no connection, a server error), and shows one notice that stays. A document too long to save says how long it is. A page deleted in another session says so at once, keeps what you wrote and offers to restore it.
- Agents can no longer grow a page past 200,000 characters by appending to it (`update_page` with `append`): the copy answers with how much still fits.
- With Docker, `SECURE_COOKIES` from `.env` now reaches the app.
- Tasks:
  - archiving an archived card, or restoring one that isn't, changes nothing: the card keeps its place;
  - an empty edit of a card or a label changes nothing, where the label one used to fail;
  - the activity no longer records an archive or a page link twice, and edits folded into one entry list every field edited;
  - `limit` in the activity and history must be a whole number from 1: `2.5` used to fail and `-1` returned every row.
- Names can't be made only of invisible characters, and line breaks or other control characters in them become spaces.
- A board holds up to 20 columns, also when they're added later; at 20, **Add column** goes away.
- An open card whose column is deleted in another session says it's gone, and shows the card again if the column comes back from the trash.
- Documents and attachments:
  - files dropped together onto a document go in in the order they were dropped;
  - attaching several files to a card, one that fails says so by name and the others still go up;
  - deleting a board, page or project that fails says so.
- AVIF images show like the other images. A file name longer than 180 characters keeps its extension, and names with quotes or brackets download with their name.
- A file whose page or card goes to the trash while it uploads is refused, and nothing of it is kept.
- MCP:
  - `add_checklist_items` adds all the items or, if one isn't valid, none, instead of leaving a checklist half made;
  - a malformed request is answered as invalid params (`-32602`), not as an internal error.
- An OAuth client registration that isn't valid says which field is wrong.
- Unknown addresses under `/.well-known/` answer 404, on Docker and Cloudflare, instead of the web app.
- Vault:
  - on a phone, unlocking shows the list instead of opening the oldest item;
  - search ignores accents;
  - the strength meter no longer rates common words, keyboard runs and sequences such as `Password1234` as good;
  - **Change master password** forgets what was typed when you close it;
  - a full vault (5,000 items) says so in your language.
- Accessibility:
  - buttons that show only their icon on a phone keep their names for screen readers;
  - a dialog opened from a menu gives the focus back to the menu's button, and a form or field opened from a menu takes the focus (**New workspace**, the vault's **New**);
  - a long menu scrolls within the screen: with many workspaces, **New workspace** and **Settings** used to be out of reach.
- The default workspace name is never cut in the middle of an emoji.
- Errors about the data, permissions or a change made meanwhile are shown in your language instead of the server's English. The strength meter, the two-step codes' seconds and the editor's to-do checkboxes, for screen readers, speak your language too.
- Japanese headings break between phrases, not in the middle of a word.

## [1.1.1] - 2026-11-17

### Added
- Backups with Docker and Node, with a command that works: `node dist/cli.js backup <file>` copies the database while the app runs, whole, checked and in one file, and `node dist/cli.js restore <file>`, with the app stopped, checks a backup and puts it in place of the database, keeping the one it replaces next to it as `orqevio.db.before-restore`. The README and the install guide show the whole procedure, attachments included. They used to tell Docker users to back up with `sqlite3`, which the image doesn't have.

### Fixed
- A token or OAuth connection without access to docs no longer sees the titles of the pages a card links to, in the card's activity and history, nor which page a file moved from or to. One without access to tasks no longer sees card titles in a page's history.
- An OAuth access token refreshed with fewer permissions than its connection has only those, as OAuth asks (RFC 6749, section 6). It used to get all of them. The refresh token keeps them all, so the next refresh can ask for all of them again.
- Signing in from a link whose `next` leads out of the app opens the home screen. It used to open an error screen.
- The MCP server tells clients the version of the copy. It used to say 1.0.0.
- Undoing many changes at once now says beforehand what it will do in a few rare cases. It used to ask about the wrong thing, or not ask and then skip part of the undo:
  - what is under a page counts as the newer changes undone with it leave it: a page that a newer undone move takes out of it, or that a newer undone change takes away, no longer counts, and one moved under it does;
  - what a newer undone change brings back from the trash to another place, because its own is gone (a page to the top of its project, a card to the first column), is checked from there, its labels included.

## [1.1.0] - 2026-11-17

### Added
- A trash. Deleting a project, a board, a column, a card, a page, an attachment, a label, a checklist, a checklist item or the link between a card and a page no longer deletes it for good: it goes to the trash with everything it held (a page with its subpages and files, a column with its cards) and stays there for 30 days. **Trash**, in the sidebar, shows what each item is, where it was, who deleted it and when it goes for good, with **Restore** and **Delete for good**. Right after deleting, **Undo** in the notice brings it back at once.
- Restoring puts everything back as it was, with the same ids, links and files. If its place no longer exists, a card goes to the first column, a column or board to the first board or project, and a page to the top of its project; the app says where. What can only live in its place (a checklist item, a label, a file) asks to restore that first when it's in the trash too.
- The trash empties itself hourly of what has been there for 30 days, and only then are the files of its attachments deleted. Only people see the trash, restore from it and empty it.
- A history for every page and card: **History**, in its menu, lists 30 days of changes with who made them (a person, or which agent) and when. It covers titles, icons, contents and descriptions, due dates, labels, moves between columns and in the page tree, archiving, checklists and their items, links to pages, attachments, and going to the trash and back. For contents and descriptions, **See what changed** shows the lines added and removed, like a diff. The history follows changes made elsewhere as they happen.
- Edits of the same text by the same person within ten minutes are one change, as the editor saves while you type; each write by an agent is a change of its own. What one person or agent changes in one stretch of work is grouped, ready for undoing in one go in a coming version.
- The history empties itself hourly of changes older than 30 days. Deleting something for good from the trash also deletes its history.
- Undo from the history. **Undo** on a change puts back what it changed, as `git revert` does, without touching what changed after it: a title, a text, a due date, labels, a move, a checklist item, a link or a file. What was added goes to the trash, and what was deleted comes back from it. On an agent's change, **Undo everything Claude did from here** takes back all it did from that change on, across cards and pages, newest first, after saying what that covers. **Restore this version** puts a page's content or a card's description back as it was. Undoing is a change of its own in the history, so it can be undone too.
- If someone changed the same thing after the change you undo, Orqevio says who and asks first: undo it anyway, or cancel; when undoing many changes, also skip those. It also says what can't be undone any more and why, such as a card whose old column was deleted. Only people undo.
- Agents can delete and move, with a new permission, **Can delete and move**. What they delete goes to the trash, where only people see it and bring it back: projects, boards, columns, cards, pages, attachments, labels, checklists and their items, and links between a card and a page. They can also move cards to another board of the workspace and files between cards and pages. Every change shows in the history, and you can undo it. Agents still can't empty the trash, delete anything for good, delete a workspace or the account, or touch the tokens, the settings or the vault.
- New tokens and OAuth connections can delete and move unless you untick **Can delete and move** when creating them or on the consent screen. Those made before keep working as they did, without it, until you turn it on: in **Agents**, each one has the switch.
- New MCP tools for agents with that permission: `delete_card`, `delete_board`, `delete_column`, `delete_label`, `delete_checklist`, `delete_checklist_item`, `delete_page`, `delete_project`, `delete_attachment` and `unlink_card_from_page`, marked as destructive so clients such as Claude can ask you first, and `move_attachment`. `move_card` also takes a column of another board: the card loses the labels of the old one, and undoing the move puts them back.
- New MCP tools with write access: `move_page`, within its project; `upload_attachment`, with the file as text or base64, up to 5 MB; and, with read access, `read_attachment`, which returns text files (up to 1 MB) as text and images as images. `update_page` changes the page's icon too, and `get_card` and `read_page` list the attachments.
- The history of a card and of a page says when a file moves from one to the other, and undoing it moves it back. Moving a card to another board says which labels it lost.

### Changed
- Deleting something through the REST API answers `200` with the id of its trash entry (`{ "trashId": "…" }`) instead of `204`. New endpoints: `GET /api/workspaces/:id/trash`, `POST /api/trash/:id/restore` and `DELETE /api/trash/:id`, for people only. Deleting a workspace or your account, and uninstalling, are still for good.
- New REST endpoints for the history: `GET /api/pages/:id/history` and `GET /api/cards/:id/history` (newest first, 50 at a time, with `?before=<date>&beforeId=<id>` for older ones), and `GET /api/history/:id` for one change with its texts before and after. Agents can read the history of what their token lets them read.
- New REST endpoints to undo, for people only: `POST /api/history/undo` with `{ "ids": [...] }` or `{ "since": "<id>" }` and `conflicts` (`ask`, `skip` or `force`), plus `dryRun` to see what would happen; and `POST /api/history/:id/restore` for a version of a content or a description.
- Tokens and OAuth connections have a new permission, `organize` (**Can delete and move**), in their `scopes`. People turn it on or off with `PATCH /api/tokens/:id` and `{ "organize": true }` or `false`; it needs write access to tasks or docs. Through the REST API, tokens can upload, open, move and delete attachments with the permissions of the card or page they're on, and `POST /api/attachments/:id/move` with `cardId` or `pageId` moves one, for people too. `POST /api/cards/:id/move` takes a column of another board of the workspace.
- Without **Can delete and move**, an agent's attempt to delete answers `403` with the code `missing_scope` instead of `session_required`.
- The MCP endpoint accepts requests of up to 8 MB, so an attachment fits.
- When many changes arrive at once, such as an agent creating fifty pages in a second, each open tab now refetches what they touch once, a tenth of a second later, instead of once per change, each cancelling the previous request. With the home screen open, fifty new pages cost a tab 6 to 8 requests instead of 100, of which over 90 were thrown away. Live updates may show up to a tenth of a second later.
- The README explains the trash, the history, undoing and what agents may delete and move, in **Undo and recover**.

### Fixed
- Opening a page or a card whose text ends with a list or a table, and clicking in it or in its menus, no longer saves it as if you had edited it. The empty line the editor keeps at the end was taken for a change.

## [1.0.2] - 2026-11-16

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
- With Docker, an uninstalled copy whose container was still running could be claimed again, and then used, through an address with encoded characters (`/%61pi/auth/claim`). The uninstalled mark is now checked on the path as it is routed, and claiming, signing in and recovering refuse by themselves. After uninstalling, the server log and `cli.js status` say the copy was uninstalled instead of inviting to claim it.

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
