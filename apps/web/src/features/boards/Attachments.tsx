import type { AttachmentDTO } from '@orqevio/shared'
import { Download, File as FileIcon, Paperclip, Trash } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Spinner } from '../../components/ui/Spinner'
import { useConfirm } from '../../components/ui/confirm'
import { del, errorMessage } from '../../lib/api'
import { bytes } from '../../lib/format'
import { type UploadTarget, uploadFile } from '../docs/editor/Editor'

export function Attachments({ items, target, onChanged }: { items: AttachmentDTO[]; target: UploadTarget; onChanged: () => void }) {
  const { t } = useTranslation('boards')
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  async function upload(files: File[]) {
    setBusy(true)
    try {
      for (const file of files) await uploadFile(file, target)
      onChanged()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: AttachmentDTO) {
    if (!(await confirm({ title: t('attachments.deleteConfirm', { name: a.filename }), confirmLabel: t('actions.delete'), danger: true }))) return
    try {
      await del(`/attachments/${a.id}`)
      onChanged()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((a) => (
        <div key={a.id} className="group flex items-center gap-2.5 rounded-[10px] border border-line bg-surface p-1.5 pr-2">
          {a.isImage ? (
            <img src={a.url} alt="" className="size-10 shrink-0 rounded-[7px] object-cover ring-1 ring-line" loading="lazy" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-[7px] bg-sunken text-ink-3">
              <FileIcon className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium hover:underline">
              {a.filename}
            </a>
            <span className="text-[11.5px] text-ink-3">{bytes(a.size)}</span>
          </span>
          <a href={a.url} download={a.filename} aria-label={t('attachments.download', { name: a.filename })} className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink">
            <Download className="size-3.5" />
          </a>
          <button type="button" onClick={() => void remove(a)} aria-label={t('attachments.deleteNamed', { name: a.filename })} className="grid size-7 place-items-center rounded-[7px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100">
            <Trash className="size-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-2 self-start rounded-[8px] px-1 py-1 text-[13px] text-ink-3 hover:text-ink">
        {busy ? <Spinner className="size-4" /> : <Paperclip className="size-4" />}
        {busy ? t('attachments.uploading') : t('attachments.attach')}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void upload(files)
        }}
      />
    </div>
  )
}
