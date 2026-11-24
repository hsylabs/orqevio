# Changelog

Every version of Orqevio, newest first. Each version is published at the same time as npm packages (`create-orqevio` and `orqevio`), as a Docker image (`ghcr.io/hsylabs/orqevio`) and as a GitHub release.

To update your copy, see [Updates](README.md#updates) in the README.

## [Unreleased]

### Added
- **Editing tables in documents, as in Notion.** A table could only be created; changing it meant editing its Markdown by hand. Now:
  - With the cursor in a table, a bar above it inserts rows and columns and aligns the column. Its menu moves or deletes rows and columns, or the whole table. On a phone it appears with a tap.
  - With a mouse, a handle on the row and the column under the pointer opens their menu. A «+» below and to the right adds a row or a column at the end.
  - From the keyboard, Alt+F10 goes to the bar, the arrows move along it and Escape goes back to the text.
  - What they make is still a Markdown table, as agents and GitHub read it. The header row stays first, and deleting it makes the next row the header. Cells are never merged. Each change is undone on its own.
- **A handle on each block of a document, as in Notion.** ⋮⋮ appears left of the block under the pointer, list items included; on a phone, left of the block with the cursor.
  - Dragged, it moves the block.
  - Clicked, or with Ctrl+/ (⌘/), it opens the block's menu: turn it into text, a heading, a list, a quote or code, as the «/» menu does; duplicate it; move it up or down; or delete it.
  - Ctrl+Shift+↑/↓ (⌘⇧↑/↓) moves the block with the cursor.
  - Each action is undone on its own. Front matter stays at the top, and a list item moves within its list. Comments have no handles.
- **Code blocks with their language, colours and a copy button, as in Notion.** For scripts, commands and prompts:
  - A bar along the top of each code block shows its language. Clicked, it opens the list of languages, with a search box; a language the list doesn't know, such as `mermaid`, can be used as it is written. From the keyboard, the block's menu (Ctrl+/) has **Language…** and **Copy code**.
  - The code is coloured in its language, with the theme's tones in light and dark mode and on paper. A block without a language, such as a prompt, keeps no colours. The colours load apart from the editor, so a page opens as fast as before.
  - The copy button copies the code as it is. Comments and printed pages show the language and the colours too, and comments have the copy button.
  - What is saved is still a Markdown fence, as agents and GitHub read it: ` ```python `. Changing the language keeps the rest of the fence's line (` ```ts title="a.ts" `), and `ts` stays `ts`. Each change is undone on its own.
- **Callouts in documents, as in Notion: GitHub's alerts.** A quote that starts with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` on a line of its own shows as a tinted box with its icon and its type's name, in the editor, in comments and on paper.
  - The type's name is a button: its menu changes the type or takes the callout away and leaves what it held. From the keyboard, the block's menu (Ctrl+/) has **Callout type**.
  - The «/» menu has **Callout**, and **Turn into** makes text, a heading or a quote into one, and back.
  - What is saved is still the quote GitHub reads as an alert, as it was written: a marker in small letters or a blank line after it stays. An Obsidian callout with a title, or a marker escaped on purpose, stays a quote. An alert copied from a page of GitHub is pasted as a callout.
- **Toggles in documents, as in Notion: HTML's `<details>`.** A `<details>` with its `<summary>`, as GitHub shows it, is a title with an arrow that shows or hides what is under it, in the editor and in comments; on paper it is open. Both ways of writing it are read: the summary right under `<details>`, or after a blank line as in GitHub's own guide.
  - The title is one line of plain text: what is typed or pasted in it stays text, never formatting. Enter in it goes into what it holds, or to a new line after it when it is closed; Ctrl+Enter (⌘↵) shows or hides it; Backspace at its start makes it text again. Backspace right after a closed toggle selects it, rather than hiding the line in it.
  - The «/» menu has **Toggle**, and **Turn into** makes a line of plain text into one, and back.
  - What is saved is still the `<details>` as it was written, `open` included; its summary is written anew only when its text changes. Opening or closing a toggle is not a change to the page, and a page brought up to date from another tab or an agent keeps the toggles as the reader left them. A `<details>` written all on one block, without a summary, or closed inside other HTML stays as it was.

### Fixed
- **Two tables in a row in a document.** Each time the page was opened and saved, more blank lines appeared between them, and then an empty paragraph. They now stay as they were.
- **GitHub alerts in documents.** An alert such as `> [!NOTE]`, written by an agent or brought from GitHub, stays an alert when the page is edited. It was saved as `> \[!NOTE\]`, and GitHub then showed a plain quote. This covers the five GitHub alerts and Obsidian callouts. A marker escaped on purpose, to show how an alert is written, stays escaped, also when its quote is copied and pasted.

## [1.4.1] - 2026-11-23

### Fixed
- **Japanese, Chinese and Korean typing.** The Enter that accepts a conversion of the input method, or the Escape that drops it, belongs to the conversion. It no longer saves or creates what you are typing, leaves the field, or closes the open card, a dialog, a menu or the search. This was most likely in Safari, in:
  - the titles of cards and pages;
  - new cards and columns, and column names;
  - checklist items;
  - the link field of the editor;
  - the comment box.

  Enter and Escape typed on their own work as before.
- **A connection that breaks off in the middle of an answer** now says «There's no connection to the server», as when nothing arrives at all, instead of «Something went wrong».
- **A column's menu:** **Rename** and **Add a card** open their field ready to type in. The focus went back to the menu's button, so what you typed went nowhere until you clicked the field.
- **Deleting a comment** from its menu leaves the focus on **Undo**, as meant, also when the copy answers at once. It sometimes went back to the menu's button instead.

## [1.4.0] - 2026-11-21

### Added
- **Comments on cards.** You and your agents talk on a card in Markdown, up to 20,000 characters each, in a **Comments** section above **Activity**; the board shows how many comments each card has.
  - Send with the button or with Ctrl/⌘+Enter. What you were writing waits until you reload or close the tab, even if you close the card.
  - Each author edits only their own comments. You can also delete anyone's, to the trash; an agent deletes only its own.
  - Comments go to the trash and come back with their card, are in the card's history and can be undone, also with everything an agent did. Search finds a card by its comments, and the export and the backups keep them.
- **MCP:** `add_comment`, `update_comment` and `list_comments`, and with **Can delete and move**, `delete_comment`. An agent changes and deletes only the comments written with its own access: with a new one, even for the same app, it can't change the old ones. `get_card` shows the latest ten.
- **A color of its own for a project**, besides the nine of the palette: **Custom color** opens the browser's color picker. It is drawn lighter or darker for each theme, so it stands out as the palette's colors do. The API and the MCP `create_project` take `#rrggbb` too; labels keep to the palette.
- **Download a page as Markdown**, from its menu. A page that is only text comes as a `.md` file; one with files, as a ZIP with them next to it. If it has subpages, you choose whether they go too, in folders. Links to what doesn't go with it point at your copy. What you just wrote, title included, is saved first.
- **Print a page or save it as PDF:** its title and its text alone, dark on white whatever the theme, with the ticks of done tasks and the address of each link, without cutting tables, code or pictures across pages. Ctrl/⌘+P prints it the same way.

### Changed
- **Japanese titles** break between phrases in Safari and Firefox too, never in the middle of a word: the titles of cards and pages, the names of projects and boards, the greeting on Home, and the title of a printed page and of a vault item. Safari and Firefox download a small file that tells Japanese phrases apart (BudouX, 15.5 KB) when the app is in Japanese. Chromium, which already did this for headings, now does it for card and page titles and board names too. Nothing changes in other languages.
- **The sidebar** closes when the window gets narrower than 900 px, and comes back as it was when it widens.
- **Agents:** side by side, the MCP tools and the activity each fit in the window and scroll in their own box. Stacked, on a phone or a narrow window, the tools wait folded under the activity, behind **Show all 39 tools**.

### Fixed
- **Undo** on a notice could not be clicked while a card was open, for instance after deleting a checklist item.
- **Which backups are kept.** The Deploy to Cloudflare template, the uninstall prompt and the description in **Settings → Backups** spoke only of the last 7 backups; the description did so over a line that said otherwise. The template and the prompt now say the last 7 daily ones, the last 7 made by you and the one made before the last restore; in **Settings → Backups**, only the line under the description says it.

## [1.3.0] - 2026-11-20

### Added
- **Trash, several at once.** Pick several things in the trash, with their box, their row or Shift for a range, and restore them together, each with where it goes in sight. Or delete them for good together, after seeing how much goes with them. Up to 100 at a time.
- **MCP:** `create_checklist` makes an empty checklist, which `add_checklist_items` fills later. An agent copying boards from another tool can now copy empty checklists too.

### Changed
- **The trash is a tree.** What was deleted waits inside what held it, even when that was deleted later, and the trash shows on top what can go back to its place, one line each. **Restore** brings back everything under it, unless you untick some of it. When there is something to decide first, it asks before doing anything:
  - its place is in the trash too, or gone: **Recreate its place** brings back those containers, and only them, or **Somewhere else** lets you choose;
  - a name is already taken where it goes: it proposes «X (restored)», which you can change, or keeps the same name;
  - something it was related to is in the trash too, such as a label, a document or a card: it comes back with it, or the relation waits and comes back when that does.

  Nothing goes back anywhere else without asking. Before 1.3.0, a card or a page whose place was gone went to the first project, board or column of the workspace. **Undo** on a deletion, from the notice or the history, brings back exactly what it removed, to its place, or says why it can't. **Delete for good** takes away everything under it, history and files included, and says how much first. What is already in the trash shows as a tree as it is. Something whose place was lost for good before 1.3.0 offers **Somewhere else**, and in three cases also **Recreate its place** with a new container of the same name: a board or a page without its project, a page without its parent, and a card without its column.
- **Undoing everything an agent did** goes back in batches of up to 500 changes, the newest first, each shown before it is undone, and never leaves out the change you chose. A newer change by the same agent no longer counts as a conflict. What the agent changed in projects, boards, columns and labels has no history: it is listed as not undone, with a link to it in the trash when it is there. A batch with only conflicts can be left, to go on with the older ones.
- **Backups:**
  - The 7 newest daily backups are kept whatever the ones you make by hand, which are kept apart: the 7 newest of them. The one made before the last restore is kept too, so a copy may now keep up to 15 backups.
  - Restoring checks every attachment as it puts it back, and changes nothing until they are all right. One that is gone, cut short or changed is named, and you choose to restore without it or to keep the copy as it is.
  - A backups folder the app can't use (not its own, read-only or full) is said in the log and in **Settings → Backups**.
  - With Docker and Node, restoring from the command line refuses while the app is running.
- **Agents:**
  - **Agents** lists all 35 MCP tools, with what each group needs. The activity scrolls in its own box and loads earlier activity on request: 40 at a time, 10 on a phone.
  - A token asked for with only «organize» is refused: it could read and write nothing, only see project names. The OAuth consent already refused it.
  - `upload_attachment` refuses content that isn't base64, such as a `data:` URL or text never encoded, instead of storing a damaged file.
  - `create_card` and `update_card` take descriptions of up to 200,000 characters, as the app does. They took 50,000.
- **Project page:** **Documents** is as wide as **Boards**, and **Recently edited** has its own section below.
- **The Node server** (Docker and Node) keeps idle connections open for 65 seconds. A proxy that keeps its own longer, such as Nginx with `keepalive`, no longer gets an occasional `502`.

### Fixed
- **Restoring** never leaves a board with more than 20 columns: past 20, it offers another place. Editing a card or a label with the values it already has no longer counts as a change.
- **Export:**
  - A ZIP past 4 GiB or 65,535 files came out damaged. It is now a ZIP64, which 7-Zip, unzip and bsdtar open, and the server's memory stays flat.
  - Links inside indented code are kept as written.
  - A card's document linked by hand and mentioned too is listed once in `tasks.json`.
  - File names can't clash on macOS or hide invisible characters.
  - With the session ended, **Download a ZIP** asks you to sign in again.
- **Vault:**
  - Importing into a vault that fills up stops and says how many items didn't go in, and the review says how many fit (up to 5,000). Bitwarden folders are kept in the notes, items that asked for the master password again are told, and the summary counts only what was imported.
  - The strength meter no longer rates keyboard rows, look-alike letters or years as good, such as `P@ssw0rd2024!` or `1q2w3e4r5t6y`.
  - Searching without accents also matches ß, œ, æ, ø, ł and similar letters.
  - **Reset the vault** forgets the access key once closed.
  - If another tab set up the vault while this one was doing it, this one says so, instead of showing a recovery key that opens nothing.
- **Cloudflare:** an `APP_URL` that isn't a full address is said, with what to do, instead of a `500` everywhere or every write refused.
- **Pages and attachments:**
  - The sidebar and the path show every level of a deep page tree. They stopped at 13 and 32 levels. The middle of a long path folds into a menu.
  - The editor counts emoji as the server does, so a page full of them saves.
  - A long file name is cut between characters, never inside an emoji.
  - A file that fails among several dropped on a page is named.
  - A link to a card or a page deleted for good says it no longer exists.
  - **/Image** takes AVIF.
- **Names:** a name made only of marks, such as an emoji variation selector, is refused like an invisible one. Label names and page titles are cleaned like other names. A label without a name is told as such in the history and the activity. Tiles and initials of names that start with an emoji show the emoji.
- **Agents:**
  - **You also have accesses in other workspaces** and the Home step **Connect an agent** count only accesses that still work.
  - The **View its activity** filter stays in its workspace.
  - JSON that isn't a JSON-RPC request gets `-32600`.
  - An OAuth registration with a too-long address says so.
- **Backups:**
  - A file uploaded during a restore waits and goes into the backup made before restoring, instead of being lost or told the copy was uninstalled.
  - A failed restore no longer takes the place of the backup made before the last one.
  - What an interrupted backup left half-written is cleaned up.
  - Backup errors show in the app's language.
- **Signing in** with a `next` path that starts with `//` goes home instead of to an error.
- **Accessibility and languages:**
  - Dialogs, sheets and the palette give the focus back to what opened them. A card's sheet keeps Tab inside it. Below 900 px the closed sidebar is skipped.
  - The board has headings, and its cards are list items again, each telling its labels, due date and checklist.
  - The sidebar button says whether it is open, the current workspace is marked, and the history reads the lines added and removed.
  - Amber and lime labels have enough contrast in light mode (4.9:1).
  - On a phone, the palette's search takes the whole line.
  - Numbers are written as each language writes them (5,000 or 5.000), and times use the language's short form. French uses its narrow spaces before : ; ! ? ». The notices region is named in the language shown.
- **Building from source:** the Cloudflare package, `dev:worker` and `check:worker` always use Orqevio's own `wrangler.jsonc`, not a `wrangler.json` left in a folder above.

## [1.2.1] - 2026-11-19

### Changed
- `MAX_UPLOAD_MB` takes a number of megabytes greater than 0, such as `20` or `2.5`. With Docker and Node, a copy given anything else, such as `20MB`, doesn't start, and says how to write it. It used to start with no limit on uploads, while the app refused every file. On Cloudflare, the copy keeps the default of 20 MB and says so once in the Worker's log. **Before updating, check this setting if you changed it.**

### Fixed
- Restoring a backup no longer gives back access to agents revoked since it was made. That includes the accesses cut off by recovering your access key because someone else may have it, and OAuth connections ended since. A backup from another copy, as when moving to a new server, still comes back with its agents. Restoring no longer takes the vault's key version back either, so a tab left open can't save items that no one could open.
- On Cloudflare:
  - a page mentioning more than 20 cards couldn't be saved: the editor kept retrying, and agents got an internal error;
  - creating a board with 17 to 20 columns at once failed;
  - a card with more than 100 checklists didn't open.
- Vault:
  - An item saved in one tab or device is no longer undone by another that still had an older copy, for example when starring it there. A deleted item no longer comes back the same way. The other tabs of the browser show the change at once. A tab or device that missed it says the item changed, keeps what you typed and shows the item as it is now.
  - Signing out locks the vault in every tab of the browser at once, and they show the sign-in screen. When a session ends another way (it expires, you sign out from elsewhere, a backup is restored), the vault locks at the first request refused, and the app says your session ended. Signing in again always asks for the master password: the vault key used to stay in memory.
- Documents:
  - Ctrl+Z after a change that came from an agent or another session no longer undoes it. It undoes only what you wrote since.
  - An open page shows at once a new title or icon given by an agent, and the subpages added or moved in another session.
  - A conflict with another tab or device of your own says **Another session**, instead of your name.
  - These stay as written when a page is saved: a code block holding a line of ```` ``` ````, YAML front matter, tasks under a numbered step, links to addresses with spaces, and footnotes. Some of them used to change on every save.
- Attachment names no longer hide what a file is. The characters that change the direction of text, which can make a name ending in `exe` show as one ending in `png`, are taken out of names when a file is uploaded. Names stored before 1.2.1 are shown and downloaded without them.

## [1.2.0] - 2026-11-18

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
