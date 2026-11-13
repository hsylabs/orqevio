import activity from './locales/en/activity.json'
import agents from './locales/en/agents.json'
import auth from './locales/en/auth.json'
import boards from './locales/en/boards.json'
import common from './locales/en/common.json'
import docs from './locales/en/docs.json'
import errors from './locales/en/errors.json'
import home from './locales/en/home.json'
import oauth from './locales/en/oauth.json'
import projects from './locales/en/projects.json'
import settings from './locales/en/settings.json'
import shell from './locales/en/shell.json'
import vault from './locales/en/vault.json'

/**
 * The English catalogs: always bundled, the fallback for any missing text and
 * the reference that types every key and that each translation is checked against.
 */
export const en = { activity, agents, auth, boards, common, docs, errors, home, oauth, projects, settings, shell, vault }

export type Namespace = keyof typeof en
export const NAMESPACES = Object.keys(en) as Namespace[]
