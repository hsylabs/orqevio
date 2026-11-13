import type { Locale, MeDTO, Theme, UserDTO } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { useConfirm } from '../../components/ui/confirm'
import { applyLocale } from '../../i18n'
import { LanguageSelect } from '../../i18n/LanguageSelect'
import { del, errorMessage, patch, post } from '../../lib/api'
import { keys } from '../../lib/queries'
import { applyTheme } from '../../lib/theme'
import { AccessKeyReveal } from '../auth/AccessKeyReveal'
import { CopyVersion } from './CopyVersion'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { lockVault } from '../vault/session'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-8 last:border-b-0 md:grid-cols-[240px_1fr] md:gap-10">
      <div>
        <h2 className="font-display text-[18px] font-medium">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="max-w-[460px]">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const { t } = useTranslation(['settings', 'common'])
  const { me, workspaceId } = useWorkspace()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const workspace = me.workspaces.find((w) => w.id === workspaceId)
  const [name, setName] = useState(me.user.name)
  const [theme, setTheme] = useState<Theme>(me.user.theme)
  const [workspaceName, setWorkspaceName] = useState(workspace?.name ?? '')
  const [currentKey, setCurrentKey] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key)
    try {
      await fn()
      toast.success(success)
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: t('title') }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 py-10 sm:px-10">
          <h1 className="font-display text-[34px] font-medium tracking-[-0.02em]">{t('title')}</h1>

          <Section title={t('profile.title')} description={t('profile.description')}>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void run('profile', async () => {
                  await patch('/account', { name: name.trim() })
                  await queryClient.invalidateQueries({ queryKey: keys.me })
                }, t('profile.saved'))
              }}
            >
              <Field label={t('profile.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <Button type="submit" variant="primary" className="self-start" loading={busy === 'profile'} disabled={!name.trim() || name.trim() === me.user.name}>
                {t('common:actions.save')}
              </Button>
            </form>
          </Section>

          <Section title={t('appearance.title')} description={t('appearance.description')}>
            <Segmented
              label={t('appearance.theme')}
              value={theme}
              onChange={(value) => {
                setTheme(value)
                applyTheme(value)
                void patch('/account', { theme: value }).then(() => queryClient.invalidateQueries({ queryKey: keys.me }))
              }}
              options={[
                { value: 'system', label: t('appearance.themes.system') },
                { value: 'light', label: t('appearance.themes.light') },
                { value: 'dark', label: t('appearance.themes.dark') },
              ]}
            />
          </Section>

          <Section title={t('language.title')} description={t('language.description')}>
            <LanguageSelect
              onChange={async (locale: Locale) => {
                await applyLocale(locale)
                try {
                  const user = await patch<UserDTO>('/account', { locale })
                  queryClient.setQueryData<MeDTO>(keys.me, (current) => (current ? { ...current, user } : current))
                } catch (error) {
                  toast.error(errorMessage(error))
                }
              }}
            />
          </Section>

          <Section title={t('accessKey.title')} description={t('accessKey.description')}>
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault()
                setBusy('access-key')
                try {
                  const res = await post<{ accessKey: string }>('/account/access-key', { currentAccessKey: currentKey })
                  setCurrentKey('')
                  setNewKey(res.accessKey)
                } catch (error) {
                  toast.error(errorMessage(error))
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Field label={t('accessKey.current')} type="password" autoComplete="current-password" spellCheck={false} className="[&_input]:font-mono" value={currentKey} onChange={(e) => setCurrentKey(e.target.value)} />
              <Button type="submit" variant="primary" className="self-start" loading={busy === 'access-key'} disabled={!currentKey.trim()}>
                {t('accessKey.generate')}
              </Button>
            </form>
          </Section>

          {workspace && (
            <Section title={t('workspace.title')} description={t('workspace.description')}>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  void run('workspace', async () => {
                    await patch(`/workspaces/${workspaceId}`, { name: workspaceName.trim() })
                    await queryClient.invalidateQueries({ queryKey: keys.me })
                  }, t('workspace.saved'))
                }}
              >
                <Field label={t('workspace.name')} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} maxLength={60} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" loading={busy === 'workspace'} disabled={!workspaceName.trim() || workspaceName.trim() === workspace.name}>
                    {t('common:actions.save')}
                  </Button>
                  {workspace.role === 'owner' && me.workspaces.length > 1 && (
                    <Button
                      variant="ghost"
                      className="text-danger hover:bg-danger-soft hover:text-danger"
                      onClick={async () => {
                        const ok = await confirm({ title: t('workspace.deleteTitle', { name: workspace.name }), description: t('workspace.deleteDescription'), confirmLabel: t('workspace.delete'), danger: true })
                        if (!ok) return
                        if (await run('delete-ws', () => del(`/workspaces/${workspaceId}`), t('workspace.deleted'))) {
                          await queryClient.invalidateQueries({ queryKey: keys.me })
                          navigate('/', { replace: true })
                        }
                      }}
                    >
                      {t('workspace.delete')}
                    </Button>
                  )}
                </div>
              </form>
            </Section>
          )}

          <Section title={t('copy.title')} description={t('copy.description')}>
            <CopyVersion />
          </Section>

          <Section title={t('erase.title')} description={t('erase.description')}>
            <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDeleteOpen(true)}>
              {t('erase.action')}
            </Button>
          </Section>
        </div>
      </div>
      {/* The old key no longer works: the dialog only closes once the new one is confirmed as saved. */}
      <Dialog open={newKey !== null} onOpenChange={() => {}} hideClose title={t('accessKey.newTitle')} description={t('accessKey.newDescription')}>
        {newKey && (
          <AccessKeyReveal
            accessKey={newKey}
            confirmLabel={t('accessKey.done')}
            onDone={() => {
              setNewKey(null)
              toast.success(t('accessKey.updated'))
            }}
          />
        )}
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t('erase.title')} description={t('erase.confirmDescription')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault()
            if (await run('delete', () => post('/account/delete', { accessKey: deleteKey }), t('erase.done'))) {
              lockVault()
              queryClient.clear()
              navigate('/setup', { replace: true })
            }
          }}
        >
          <Field label={t('erase.accessKey')} type="password" autoComplete="current-password" spellCheck={false} className="[&_input]:font-mono" value={deleteKey} onChange={(e) => setDeleteKey(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'delete'} disabled={!deleteKey}>
              {t('erase.confirm')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
