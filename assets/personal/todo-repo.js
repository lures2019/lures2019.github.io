import { normalizeTasks } from './todo-model.js'

const api = 'https://api.github.com'
const owner = 'lures2019'
const branch = 'main'
const contents = `/repos/${owner}/treehouse-todo/contents/`
const maxFileSize = 900_000

async function request (path, { token, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10'
  }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(api + path, {
    method, headers, body: body && JSON.stringify(body),
    cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(18_000)
  })
  if (!response.ok) {
    const messages = {
      401: '令牌无效或已过期，请重新连接。',
      403: response.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub 请求暂时达到上限，请稍后刷新。'
        : 'GitHub 拒绝了操作。请检查令牌是否有 treehouse-todo 仓库的 Contents 读写权限。',
      404: 'GitHub 数据文件不可访问，请检查仓库和令牌权限。',
      409: 'GitHub 上已有新改动，请刷新后再操作。',
      422: 'GitHub 未接受本次修改，请刷新列表后检查。'
    }
    throw Object.assign(new Error(messages[response.status] || 'GitHub 暂时无法处理请求。'), { status: response.status })
  }
  return response.json()
}

export async function loadTasks (token) {
  const { sha, data } = await readDocument('tasks.json', token)
  return { sha, tasks: normalizeTasks(data.tasks) }
}

export async function readDocument (name, token) {
  const entry = await request(contents + name + '?ref=' + branch, { token })
  if (entry.encoding !== 'base64' || !entry.sha || entry.size > maxFileSize) {
    throw new Error('GitHub 数据文件格式或大小不符合要求。')
  }
  const bytes = Uint8Array.from(atob(entry.content.replace(/\s/g, '')), character => character.charCodeAt(0))
  const saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (saved.version !== 1) throw new Error('当前网页无法读取此数据文件版本。')
  return { sha: entry.sha, data: saved }
}

export async function verifyOwner (token) {
  if (!/^github_pat_[A-Za-z0-9_]{30,}$/.test(token)) throw new Error('请输入 GitHub Fine-grained 令牌。')
  const account = await request('/user', { token })
  if (account.login?.toLowerCase() !== owner) throw new Error('只有 lures2019 账号可以开启编辑。')
}

export async function connectOwner (token) {
  await verifyOwner(token)
  return loadTasks(token)
}

export async function writeDocument (name, data, sha, token, message) {
  const bytes = new TextEncoder().encode(JSON.stringify(data) + '\n')
  if (bytes.length > maxFileSize) throw new Error('数据文件已达到 900 KB 保存上限。')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  const result = await request(contents + name, {
    token, method: 'PUT',
    body: { message, branch, sha, content: btoa(binary) }
  })
  if (!result.content?.sha) throw new Error('无法确认本次保存，请刷新待办。')
  return result.content.sha
}

export async function writeTasks (tasks, sha, token) {
  const next = await writeDocument('tasks.json', { version: 1, tasks }, sha, token, 'Update Treehouse tasks')
  return { sha: next, tasks }
}
