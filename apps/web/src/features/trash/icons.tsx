import type { TrashKind } from '@orqevio/shared'
import { Columns3, FileText, Folder, Link2, ListChecks, Paperclip, SquareCheck, SquareKanban, StickyNote, Tag } from 'lucide-react'

const ICONS = {
  project: Folder,
  board: SquareKanban,
  column: Columns3,
  card: StickyNote,
  page: FileText,
  attachment: Paperclip,
  label: Tag,
  checklist: ListChecks,
  checklist_item: SquareCheck,
  link: Link2,
} satisfies Record<TrashKind, unknown>

/** The icon of each kind of thing in the trash. */
export function TrashIcon({ kind }: { kind: TrashKind }) {
  const Icon = ICONS[kind]
  return <Icon aria-hidden />
}
