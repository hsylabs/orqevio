import type { Theme } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { useConfirm } from '../../components/ui/confirm'
import { del, errorMessage, patch, post } from '../../lib/api'
import { keys } from '../../lib/queries'
import { applyTheme } from '../../lib/theme'
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
  const { me, workspaceId } = useWorkspace()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const workspace = me.workspaces.find((w) => w.id === workspaceId)
  const [name, setName] = useState(me.user.name)
  const [theme, setTheme] = useState<Theme>(me.user.theme)
  const [workspaceName, setWorkspaceName] = useState(workspace?.name ?? '')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
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
      <PageHeader crumbs={[{ label: 'Ajustes' }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 py-10 sm:px-10">
          <h1 className="font-display text-[34px] font-medium tracking-[-0.02em]">Ajustes</h1>

          <Section title="Perfil" description="Tu nombre aparece en la actividad del espacio.">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void run('profile', async () => {
                  await patch('/account', { name: name.trim() })
                  await queryClient.invalidateQueries({ queryKey: keys.me })
                }, 'Perfil actualizado')
              }}
            >
              <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <Field label="Correo electrónico" value={me.user.email} disabled readOnly />
              <Button type="submit" variant="primary" className="self-start" loading={busy === 'profile'} disabled={!name.trim() || name.trim() === me.user.name}>
                Guardar
              </Button>
            </form>
          </Section>

          <Section title="Apariencia" description="Se sincroniza con tu cuenta.">
            <Segmented
              label="Tema"
              value={theme}
              onChange={(value) => {
                setTheme(value)
                applyTheme(value)
                void patch('/account', { theme: value }).then(() => queryClient.invalidateQueries({ queryKey: keys.me }))
              }}
              options={[
                { value: 'system', label: 'Sistema' },
                { value: 'light', label: 'Claro' },
                { value: 'dark', label: 'Oscuro' },
              ]}
            />
          </Section>

          <Section title="Contraseña de acceso" description="Al cambiarla se cerrarán tus otras sesiones. No afecta a la contraseña maestra de la bóveda.">
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault()
                if (await run('password', () => post('/account/password', { currentPassword: current, newPassword: next }), 'Contraseña actualizada')) {
                  setCurrent('')
                  setNext('')
                }
              }}
            >
              <Field label="Contraseña actual" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <Field label="Nueva contraseña" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="Mínimo 10 caracteres." />
              <Button type="submit" variant="primary" className="self-start" loading={busy === 'password'} disabled={!current || next.length < 10}>
                Cambiar contraseña
              </Button>
            </form>
          </Section>

          {workspace && (
            <Section title="Espacio" description="Los tokens de agente y los proyectos pertenecen a un espacio concreto.">
              <form
                className="flex flex-col gap-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  void run('workspace', async () => {
                    await patch(`/workspaces/${workspaceId}`, { name: workspaceName.trim() })
                    await queryClient.invalidateQueries({ queryKey: keys.me })
                  }, 'Espacio actualizado')
                }}
              >
                <Field label="Nombre del espacio" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} maxLength={60} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" loading={busy === 'workspace'} disabled={!workspaceName.trim() || workspaceName.trim() === workspace.name}>
                    Guardar
                  </Button>
                  {workspace.role === 'owner' && me.workspaces.length > 1 && (
                    <Button
                      variant="ghost"
                      className="text-danger hover:bg-danger-soft hover:text-danger"
                      onClick={async () => {
                        const ok = await confirm({ title: `¿Eliminar el espacio «${workspace.name}»?`, description: 'Se eliminarán sus proyectos, tableros, documentos, adjuntos y tokens. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar espacio', danger: true })
                        if (!ok) return
                        if (await run('delete-ws', () => del(`/workspaces/${workspaceId}`), 'Espacio eliminado')) {
                          await queryClient.invalidateQueries({ queryKey: keys.me })
                          navigate('/', { replace: true })
                        }
                      }}
                    >
                      Eliminar espacio
                    </Button>
                  )}
                </div>
              </form>
            </Section>
          )}

          <Section title="Eliminar cuenta" description="Borra tu cuenta, tus espacios, tu bóveda y tus tokens de forma permanente.">
            <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDeleteOpen(true)}>
              Eliminar mi cuenta
            </Button>
          </Section>
        </div>
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Eliminar tu cuenta" description="Esta acción es irreversible. Escribe tu contraseña de acceso para confirmar.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault()
            if (await run('delete', () => post('/account/delete', { password: deletePassword }), 'Cuenta eliminada')) {
              lockVault()
              queryClient.clear()
              navigate('/register', { replace: true })
            }
          }}
        >
          <Field label="Contraseña" type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'delete'} disabled={!deletePassword}>
              Eliminar definitivamente
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
