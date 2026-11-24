import type { ChainedCommands, Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export type StepProps = { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }

/**
 * Commands run from the editor's controls, undone as one step of their own: not with what was
 * typed just before or after them, nor with the next change, however quickly they follow.
 */
export function ownChain(editor: Editor, extend: (chain: ChainedCommands) => ChainedCommands) {
  const start = editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => (closeHistory(tr), true))
  const done = extend(start).scrollIntoView().run()
  if (done) editor.view.dispatch(closeHistory(editor.state.tr))
  return done
}

/** One change made by hand on the transaction, as its own step (see ownChain). */
export function ownStep(editor: Editor, build: (props: StepProps) => boolean) {
  return ownChain(editor, (chain) => chain.command(build))
}
