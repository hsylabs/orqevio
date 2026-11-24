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
export function ownChain(editor: Editor, extend: (chain: ChainedCommands) => ChainedCommands, { joinLists = false } = {}) {
  const start = editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => (closeHistory(tr).setMeta(JOIN_LISTS, joinLists), true))
  const done = extend(start).scrollIntoView().run()
  if (done) editor.view.dispatch(closeHistory(editor.state.tr))
  return done
}

/** One change made by hand on the transaction, as its own step (see ownChain). */
export function ownStep(editor: Editor, build: (props: StepProps) => boolean, options?: { joinLists?: boolean }) {
  return ownChain(editor, (chain) => chain.command(build), options)
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
