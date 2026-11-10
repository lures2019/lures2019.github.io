import { base64, maxPackageSize, randomBytes } from './vault-crypto.js'

const service = document.documentElement.dataset.vaultCloud
const sessionKey = 'treehouse-vault-session'
const loginKey = 'treehouse-vault-login'
let session

export const emptyRevision = '"empty"'
export const cloudConfigured = Boolean(service)
export const cloudConnected = () => Boolean(session)
export const shareIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

function url64 (bytes) {
  return base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function disconnectCloud () {
  session = undefined
  sessionStorage.removeItem(sessionKey)
}

async function request (path, options = {}, authenticated = true) {
  const { method = 'GET', headers, body, timeout = 90_000 } = options
  let response
  try {
    response = await fetch(service + '/api/' + path, {
      method, headers: { ...headers, ...(authenticated && { Authorization: 'Bearer ' + session }) },
      body, cache: 'no-store', credentials: 'omit', redirect: 'error',
      signal: AbortSignal.timeout(timeout)
    })
  } catch {
    throw new Error('无法连接云备份服务，请检查网络。')
  }
  if (response.ok) return response
  if (authenticated && response.status === 401) disconnectCloud()
  const data = method === 'HEAD' ? null : await response.json().catch(() => null)
  const message = response.status === 401 ? 'GitHub 登录已失效，请重新连接。' : '云备份暂时不可用，请稍后重试。'
  throw Object.assign(new Error(data?.error || message), { status: response.status })
}

export async function connectCloud () {
  const { clientId } = await (await request('config', {}, false)).json()
  const state = url64(randomBytes(32))
  const verifier = url64(randomBytes(32))
  const challenge = url64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  sessionStorage.setItem(loginKey, JSON.stringify({ state, verifier, expires: Date.now() + 10 * 60_000 }))
  const query = new URLSearchParams({
    client_id: clientId, state, code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: new URL('./', location.href).href, allow_signup: 'false', login: 'lures2019'
  })
  location.assign('https://github.com/login/oauth/authorize?' + query)
}

export async function resumeCloud () {
  if (!cloudConfigured) return
  session = sessionStorage.getItem(sessionKey)
  const url = new URL(location.href)
  if (!['code', 'state', 'error'].some(key => url.searchParams.has(key))) return
  const { searchParams } = new URL(url)
  for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key)
  history.replaceState(null, '', url.href)
  const login = JSON.parse(sessionStorage.getItem(loginKey) || 'null')
  sessionStorage.removeItem(loginKey)
  if (!login || login.expires < Date.now() || login.state !== searchParams.get('state') || !searchParams.get('code')) {
    throw new Error('GitHub 登录已取消或过期，请重新连接。')
  }
  const response = await request('login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: searchParams.get('code'), verifier: login.verifier })
  }, false)
  session = (await response.json()).session
  sessionStorage.setItem(sessionKey, session)
}

export async function remoteRevision () {
  const response = await request('vault', { method: 'HEAD', timeout: 10_000 })
  return response.headers.get('ETag')
}

async function packageBlob (response) {
  if (Number(response.headers.get('Content-Length')) > maxPackageSize) throw new Error('加密资料包过大。')
  return response.blob()
}

export async function loadCloudArchive () {
  const response = await request('vault')
  if (response.status === 204) throw new Error('私仓里暂无自动备份。')
  return { blob: await packageBlob(response), base: response.headers.get('ETag') }
}

export async function uploadCloudArchive (archive) {
  const response = await request('vault', {
    method: 'PUT', body: archive.blob,
    headers: { 'Content-Type': 'application/octet-stream', 'If-Match': archive.base, 'X-Vault-Revision': archive.id }
  })
  return (await response.json()).revision
}

export async function publishCloudShare (id, blob) {
  const response = await request('shares/' + id, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } })
  return (await response.json()).proof
}

export async function readCloudShare (key) {
  if (!cloudConfigured) throw new Error('云分享暂时不可用。')
  const [id, proof, extra] = key.split('.')
  if (!shareIdPattern.test(id) || !/^[\w-]{43}$/.test(proof || '') || extra !== undefined) {
    throw new Error('请打开有效的分享链接。')
  }
  return packageBlob(await request('shares/' + key, {}, false))
}

export async function listCloudShares () {
  return (await (await request('shares')).json()).shares
}

export async function closeCloudShare (id) {
  await request('shares/' + id, { method: 'DELETE' })
}
