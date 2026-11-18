import { Access } from './access'
import { AccountService } from './accounts'
import { ActivityService } from './activity'
import { AttachmentService } from './attachments'
import { BackupService } from './backups'
import { BoardService } from './boards'
import { CardService } from './cards'
import type { Deps } from './deps'
import { HistoryService } from './history'
import { OAuthService } from './oauth'
import { PageService } from './pages'
import { SearchService } from './search'
import { TokenService } from './tokens'
import { TrashService } from './trash'
import { UndoService } from './undo'
import { UpdateService } from './updates'
import { VaultService } from './vault'
import { WorkspaceService } from './workspaces'

/**
 * The single domain layer. The REST API (used by the web app) and the MCP
 * server call exactly the same methods, so permissions are enforced once.
 */
export function createServices(deps: Deps) {
  const access = new Access(deps)
  const activity = new ActivityService(deps)
  const history = new HistoryService(deps, access)
  const trash = new TrashService(deps, access, activity, history)
  const cards = new CardService(deps, access, activity, trash, history)
  const workspaces = new WorkspaceService(deps, access, activity, cards, trash)
  const tokens = new TokenService(deps, access)
  const attachments = new AttachmentService(deps, access, activity, trash, history)
  const pages = new PageService(deps, access, activity, trash, history)
  const oauth = new OAuthService(deps, access, tokens)
  const accounts = new AccountService(deps, access, workspaces, attachments)
  return {
    access,
    activity,
    history,
    trash,
    cards,
    workspaces,
    boards: new BoardService(deps, access, activity, cards, trash),
    pages,
    undo: new UndoService(deps, access, { cards, pages, attachments, trash }),
    search: new SearchService(deps, access),
    attachments,
    tokens,
    oauth,
    vault: new VaultService(deps, access),
    accounts,
    backups: new BackupService(deps, access, accounts, attachments, oauth),
    updates: new UpdateService(deps, access),
  }
}

export type Services = ReturnType<typeof createServices>
