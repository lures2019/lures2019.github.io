import { base64, deriveKey, randomBytes } from './vault-crypto.js?v=9'

const name = 'treehouse-vault-tab-v1'
const prefix = 'session:'
export const vaultIdleMs = 10 * 60 * 1000
let tab

function sessionStore (db, mode, apply) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('vault', mode)
    const result = apply(transaction.objectStore('vault'))
    transaction.oncomplete = () => resolve(result?.result)
    transaction.onabort = () => reject(transaction.error)
  })
}

function readTab () {
  try {
    const value = history.state?.[name]
    const activity = JSON.parse(sessionStorage.getItem(name))
    return /^[a-f0-9-]{36}$/.test(value?.id) && /^[A-Za-z0-9+/]{43}=$/.test(value?.wrap) &&
      activity?.id === value.id && Number.isFinite(activity.expires) ? { ...value, expires: activity.expires } : undefined
  } catch { return undefined }
}

export function touchVaultSession () {
  if (!tab) return
  tab.expires = Date.now() + vaultIdleMs
  try { sessionStorage.setItem(name, JSON.stringify({ id: tab.id, expires: tab.expires })) }
  catch { /* The active page can keep working. */ }
}

export async function forgetVaultSession (db) {
  const previous = tab || readTab()
  tab = undefined
  try { sessionStorage.removeItem(name) } catch { /* Storage might be disabled. */ }
  if (history.state?.[name]) {
    const state = { ...history.state }
    delete state[name]
    history.replaceState(state, '')
  }
  if (previous) await sessionStore(db, 'readwrite', store => store.delete(prefix + previous.id)).catch(() => {})
}

async function wrappingKey (bytes) {
  return crypto.subtle.importKey('raw', bytes, 'AES-KW', false, ['wrapKey', 'unwrapKey'])
}

export async function rememberVaultSession (db, password, salt) {
  await forgetVaultSession(db)
  const wrapping = randomBytes(32)
  const key = await deriveKey(password, salt, true)
  const wrapped = await crypto.subtle.wrapKey('raw', key, await wrappingKey(wrapping), 'AES-KW')
  const id = crypto.randomUUID()
  await sessionStore(db, 'readwrite', store => {
    const cursor = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'))
    cursor.onsuccess = () => {
      const record = cursor.result
      if (!record) return
      if (record.value.created < Date.now() - 86_400_000) record.delete()
      record.continue()
    }
    return store.put({ wrapped, created: Date.now() }, prefix + id)
  })
  tab = { id, wrap: base64(wrapping), expires: 0 }
  history.replaceState({ ...history.state, [name]: { id, wrap: tab.wrap } }, '')
  touchVaultSession()
}

export async function resumeVaultSession (db) {
  const saved = readTab()
  if (!saved) return null
  if (saved.expires <= Date.now()) {
    await forgetVaultSession(db)
    return null
  }
  try {
    const stored = await sessionStore(db, 'readonly', store => store.get(prefix + saved.id))
    if (!stored?.wrapped) throw new Error('Missing session')
    const bytes = Uint8Array.from(atob(saved.wrap), character => character.charCodeAt(0))
    const key = await crypto.subtle.unwrapKey('raw', stored.wrapped, await wrappingKey(bytes), 'AES-KW',
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    tab = saved
    return key
  } catch {
    await forgetVaultSession(db)
    return null
  }
}
