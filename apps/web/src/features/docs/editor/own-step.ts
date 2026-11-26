import type { ChainedCommands, Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'

/** Set on the controls' changes: lists of the same kind they bring together become one (DocumentRules). */
export const JOIN_LISTS = 'joinLists'

export type StepProps = { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }

/**
 * Commands run from the editor's controls, undone as one step of their own: not with what was
 * typed just before or after them, nor with the next change, however quickly they follow.
 */
export function ownChain(editor: Editor, extend: (chain: ChainedCommands) => ChainedCommands, { joinLists = false, focus = true }: StepOptions = {}) {
  const chain = editor.chain()
  const start = (focus ? chain.focus(undefined, { scrollIntoView: false }) : chain).command(({ tr }) => (closeHistory(tr).setMeta(JOIN_LISTS, joinLists), true))
  const extended = extend(start)
  const done = (focus ? extended.scrollIntoView() : extended).run()
  if (done) editor.view.dispatch(closeHistory(editor.state.tr))
  return done
}

/**
 * `focus: false` for a control that keeps the focus while it acts, such as a list with its own
 * search box: the editor gets it back as the control closes.
 */
export type StepOptions = { joinLists?: boolean; focus?: boolean }

/** One change made by hand on the transaction, as its own step (see ownChain). */
export function ownStep(editor: Editor, build: (props: StepProps) => boolean, options?: StepOptions) {
  return ownChain(editor, (chain) => chain.command(build), options)
}

/**
 * Reads what the browser did that the editor hasn't read yet: a click whose cursor it learns of a
 * moment later, when a key pressed right after it, or a redraw, would act where the cursor was
 * before. @tiptap/react does the same on Enter on a phone.
 */
export function readPending(editor: Editor) {
  if (editor.isDestroyed) return
  try {
    ;(editor.view as unknown as { domObserver?: { flush(): void } }).domObserver?.flush()
  } catch {
    // Not on the page yet: there is nothing the browser did to read.
  }
}

/**
 * Where the block at `pos` is after `change`, or null if it went. A change of its kind or its
 * attributes (setNodeMarkup: a code block's language, or its colours drawn again) maps its start as
 * deleted, so a block that kept its content is also found through what is inside it.
 */
export function followBlock(change: { mapping: Mapping; doc: EditorState['doc'] }, pos: number) {
  const moved = change.mapping.mapResult(pos, 1)
  if (!moved.deleted && change.doc.nodeAt(moved.pos)) return moved.pos
  const inner = change.mapping.mapResult(pos + 1, 1)
  if (inner.deleted || inner.pos > change.doc.content.size) return null
  const $inner = change.doc.resolve(inner.pos)
  // Inside the block that is now where it was: past a leaf that went, it would be the leaf's parent.
  return $inner.depth > 0 && $inner.before() === moved.pos ? moved.pos : null
}

/**
 * A change as the editor's `transaction` event tells it, with the steps the document's rules appended
 * to it (see DocumentRules): what positions held before it map through all of them.
 */
export function changeOf({ transaction, appendedTransactions = [] }: { transaction: Transaction; appendedTransactions?: Transaction[] }) {
  const all = [transaction, ...appendedTransactions]
  const mapping = new Mapping()
  for (const tr of all) mapping.appendMapping(tr.mapping)
  return { docChanged: all.some((tr) => tr.docChanged), mapping, doc: all[all.length - 1]!.doc }
}
