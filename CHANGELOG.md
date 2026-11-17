# Changelog

Every version of Orqevio, newest first. Each version is published at the same time as npm packages (`create-orqevio` and `orqevio`), as a Docker image (`ghcr.io/hsylabs/orqevio`) and as a GitHub release.

To update your copy, see [Updates](README.md#updates) in the README.

## [Unreleased]

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
- Tokens and OAuth connections have a new permission, `organize` (**Can delete and move**), in their `scopes`. People turn it on or off with `PATCH /api/tokens/:id` and `{ "organize": true }` or `false`; it needs write access to tasks or docs. Through the REST API, tokens can upload, open, move and delete attachments with the permissions of the card or page they're on, and `POST /api/attachments/:id/move` with `cardId` or `pageId` moves one, for people too. `POST /api/cards/:id/move` takes a column of another board of the workspace.
- Without **Can delete and move**, an agent's attempt to delete answers `403` with the code `missing_scope` instead of `session_required`.
- The MCP endpoint accepts requests of up to 8 MB, so an attachment fits.
- When many changes arrive at once, such as an agent creating fifty pages in a second, each open tab now refetches what they touch once, a tenth of a second later, instead of once per change, each cancelling the previous request. With the home screen open, fifty new pages cost a tab 6 to 8 requests instead of 100, of which over 90 were thrown away. Live updates may show up to a tenth of a second later.
- Deleting something through the REST API answers `200` with the id of its trash entry (`{ "trashId": "…" }`) instead of `204`. New endpoints: `GET /api/workspaces/:id/trash`, `POST /api/trash/:id/restore` and `DELETE /api/trash/:id`, for people only. Deleting a workspace or your account, and uninstalling, are still for good.
- New REST endpoints for the history: `GET /api/pages/:id/history` and `GET /api/cards/:id/history` (newest first, 50 at a time, with `?before=<date>&beforeId=<id>` for older ones), and `GET /api/history/:id` for one change with its texts before and after. Agents can read the history of what their token lets them read.
- New REST endpoints to undo, for people only: `POST /api/history/undo` with `{ "ids": [...] }` or `{ "since": "<id>" }` and `conflicts` (`ask`, `skip` or `force`), plus `dryRun` to see what would happen; and `POST /api/history/:id/restore` for a version of a content or a description.

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
