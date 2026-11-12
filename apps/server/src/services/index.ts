import { Access } from './access'
import { AccountService } from './accounts'
import { ActivityService } from './activity'
import { AttachmentService } from './attachments'
import { BoardService } from './boards'
import { CardService } from './cards'
import type { Deps } from './deps'
import { PageService } from './pages'
import { SearchService } from './search'
import { TokenService } from './tokens'
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
  const cards = new CardService(deps, access, activity)
  const workspaces = new WorkspaceService(deps, access, activity, cards)
  return {
    access,
    activity,
    cards,
    workspaces,
    boards: new BoardService(deps, access, activity, cards),
    pages: new PageService(deps, access, activity),
    search: new SearchService(deps, access),
    attachments: new AttachmentService(deps, access, activity),
    tokens: new TokenService(deps, access),
    vault: new VaultService(deps, access),
    accounts: new AccountService(deps, access, workspaces),
    updates: new UpdateService(deps, access),
  }
}

export type Services = ReturnType<typeof createServices>
