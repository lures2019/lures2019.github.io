import { completionAt, dueOn, focusFor, focusStats, formatFocus, localDay, normalizeTasks, occurrenceDays, period, repeatLabels, reportYear, validDay } from './todo-model.js'
import { connectOwner, loadTasks, writeTasks } from './todo-repo.js'
import { bindTimer } from './todo-timer.js'

const storageKey = 'zayden-todo-v1'
const get = id => document.getElementById(id)
const form = get('task-form')
const login = get('owner-connect')
const dateFilter = get('focus-date')
const yearPicker = get('review-year')
const dateTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' })
let editing
let tasks = []
let report
let token
let revision
let busy = false
let timer

function node (tag, text = '', className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  if (className) element.className = className
  return element
}

function message (text) {
  get('todo-status').textContent = text
}

function controls () {
  const owner = Boolean(token)
  get('todo-layout').toggleAttribute('data-guest', !owner)
  get('todo-editor').hidden = !owner
  get('focus-timer').hidden = !owner
  get('owner-connected').hidden = !owner
  login.hidden = owner
  get('todo-connect').disabled = busy
  get('todo-disconnect').disabled = busy
  get('todo-refresh').disabled = busy
  get('task-save').disabled = busy || !revision
  get('import-tasks').disabled = busy || !revision
  get('import-local').disabled = busy || !revision
  get('repeat-end').hidden = form.elements.repeat.value === 'none'
  const current = tasks.find(task => task.id === editing)
  const hasHistory = current && (current.completedAt || Object.keys(current.completions).length || current.focusSessions.length)
  form.elements.date.disabled = Boolean(hasHistory)
  form.elements.repeat.disabled = Boolean(hasHistory)
  for (const item of get('task-list').querySelectorAll('input, button')) {
    item.disabled = busy || !owner || !revision
  }
  timer?.render()
}

function useSnapshot (snapshot) {
  revision = snapshot.sha
  tasks = snapshot.tasks
}

async function save (change, feedback) {
  if (!token || !revision || busy) return false
  let next
  const editorToken = token
  busy = true
  controls()
  message('正在保存到 GitHub…')
  try {
    next = normalizeTasks(change(tasks))
    if (JSON.stringify(next) !== JSON.stringify(tasks)) {
      useSnapshot(await writeTasks(next, revision, editorToken))
    }
    message(feedback)
    return true
  } catch (error) {
    if (error.status === 401) {
      token = undefined
      setEditor()
    } else if (next && [undefined, 409, 422].includes(error.status)) {
      try {
        useSnapshot(await loadTasks(editorToken))
        if (JSON.stringify(tasks) === JSON.stringify(next)) {
          message(feedback)
          return true
        }
      } catch {
        revision = undefined
      }
    }
    message(error.message || '无法保存，请刷新列表后再试。')
    return false
  } finally {
    busy = false
    render()
  }
}

function setEditor (task) {
  editing = task?.id
  form.elements.title.value = task?.title || ''
  form.elements.note.value = task?.note || ''
  form.elements.date.value = task?.date || dateFilter.value || localDay()
  form.elements.repeat.value = task?.repeat || 'none'
  form.elements.endDate.value = task?.endDate || ''
  get('task-form-title').textContent = task ? '编辑待办' : '新建待办'
  get('task-save').textContent = task ? '保存修改' : '添加待办'
  get('task-cancel').hidden = !task
  controls()
}

function taskRow (task, due, completedAt) {
  const row = node('article', '', 'task')
  row.toggleAttribute('data-done', Boolean(completedAt))
  const check = node('input')
  check.type = 'checkbox'
  check.checked = Boolean(completedAt)
  check.id = 'done-' + task.id + '-' + due
  check.setAttribute('aria-label', '完成 ' + task.title + ' ' + due)
  check.addEventListener('change', async () => {
    const at = check.checked ? new Date().toISOString() : null
    await save(items => items.map(item => {
      if (item.id !== task.id) return item
      if (item.repeat === 'none') return { ...item, completedAt: at }
      const completions = { ...item.completions }
      if (at) completions[due] = at
      else delete completions[due]
      return { ...item, completions }
    }), at ? '完成时间已保存到 GitHub。' : '已恢复为待完成。')
    get(check.id)?.focus()
  })

  const text = node('div')
  text.append(node('h3', task.title))
  if (task.note) text.append(node('p', task.note, 'task-note'))
  const status = completedAt ? '完成于 ' + dateTime.format(new Date(completedAt)) : '待完成'
  const cadence = task.repeat === 'none' ? '' : ' · ' + repeatLabels[task.repeat]
  const study = focusFor(task, due)
  text.append(node('p', due + cadence + ' · ' + status + (study ? ' · 学习 ' + formatFocus(study) : ''), 'task-meta'))
  row.append(check, text)
  if (!token) return row
  const actions = node('div', '', 'actions')
  const edit = node('button', '编辑', 'secondary compact')
  edit.addEventListener('click', () => {
    setEditor(task)
    form.elements.title.focus()
  })
  const timeTask = node('button', '计时', 'secondary compact')
  timeTask.addEventListener('click', () => timer.prefill(task, due))
  const remove = node('button', '删除', 'secondary compact')
  remove.addEventListener('click', async () => {
    if (!confirm(`删除「${task.title}」及其完成记录？`)) return
    if (await save(items => items.filter(item => item.id !== task.id), '已删除任务。') && editing === task.id) setEditor()
  })
  actions.append(edit, timeTask, remove)
  row.append(actions)
  return row
}

function renderReview () {
  const year = yearPicker.value
  const { months, scheduled, completed, activeDays, rate } = reportYear(tasks, year)
  const focus = focusStats(tasks, year + '-01-01', year + '-12-31')
  const numbers = [['安排任务', scheduled], ['当年完成', completed], ['完成天数', activeDays],
    ['计划完成率', rate], ['当年学习时长', formatFocus(focus.total)]]
  get('review-preview').replaceChildren(...numbers.map(([label, value]) => {
    const metric = node('p', label, 'metric')
    metric.append(node('strong', String(value)))
    return metric
  }))

  const max = Math.max(1, ...months.map(month => Math.max(month.scheduled, month.completed)))
  const rows = months.map(({ scheduled, completed }, month) => `
    <tr><th scope="row">${month + 1} 月</th>
    <td>${scheduled} <meter aria-label="安排任务" min="0" max="${max}" value="${scheduled}"></meter></td>
    <td>${completed} <meter aria-label="完成任务" min="0" max="${max}" value="${completed}"></meter></td></tr>`
  ).join('')
  const metrics = numbers.map(([label, value]) => `<p><strong>${value}</strong>${label}</p>`).join('')
  report = new Blob([`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${year} 年度待办回顾</title><style>
body{margin:0;background:#eef2e9;color:#203728;font:1rem/1.6 system-ui,sans-serif}
main{width:min(720px,calc(100% - 32px));margin:28px auto}
header,section{padding:24px;background:#fff;border-radius:16px;margin-bottom:16px}
header{background:#245b44;color:#fff}h1,p{margin:0 0 10px}
.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{display:block;font-size:1.8rem}
table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:7px;border-bottom:1px solid #d8e2d5}
meter{display:block;width:min(100%,120px);height:9px;accent-color:#245b44}
</style></head><body><main><header><p>每日待办 · 年度回顾</p><h1>${year} 年的任务足迹</h1>
<div class="metrics">${metrics}</div></header><section><h2>每月记录</h2>
<table><thead><tr><th scope="col">月份</th><th scope="col">安排</th><th scope="col">完成</th></tr></thead>
<tbody>${rows}</tbody></table></section>
<p>安排按任务日期统计，完成按实际完成时间统计。计划完成率是当年安排的任务中，在当年结束前已完成的比例。</p>
<p>学习天数 ${focus.active} 天 · 日均学习 ${formatFocus(focus.average)}，按实际有计时记录的日期计算。</p>
<p>生成日期 ${localDay()}</p></main></body></html>`], { type: 'text/html;charset=utf-8' })
}

function renderFocus () {
  const date = validDay(dateFilter.value) ? dateFilter.value : localDay()
  const range = period(date, get('view').value)
  const filtered = get('focus-scope').value === 'period'
  const stats = filtered ? focusStats(tasks, range.start, range.end) : focusStats(tasks)
  const cards = [
    ['总学习时长', formatFocus(stats.total)],
    ['日均时长', stats.active ? formatFocus(stats.average) : '—'],
    ['实际学习天数', stats.active + ' 天']
  ]
  get('focus-metrics').replaceChildren(...cards.map(([label, value]) => {
    const metric = node('p', label, 'metric')
    metric.append(node('strong', value))
    return metric
  }))
  const ranking = get('focus-ranking')
  ranking.replaceChildren()
  for (const { title, duration } of stats.top) {
    const row = node('li')
    const label = node('div', '', 'focus-rank-label')
    label.append(node('strong', title), node('span', formatFocus(duration)))
    const bar = node('meter')
    bar.max = stats.top[0].duration
    bar.value = duration
    bar.setAttribute('aria-label', title + '，学习 ' + formatFocus(duration))
    row.append(label, bar)
    ranking.append(row)
  }
  if (!stats.top.length) ranking.append(node('li', '此范围内还没有学习时长记录。', 'muted'))
}

function render () {
  const view = get('view').value
  const day = validDay(dateFilter.value) ? dateFilter.value : localDay()
  const { start, end, label } = period(day, view)
  const filter = get('filter').value
  const matches = tasks.flatMap(task => Array.from(occurrenceDays(task, start, end),
    due => ({ task, due, completedAt: completionAt(task, due) })))
  const visible = matches.filter(item => filter === 'all' || Boolean(item.completedAt) === (filter === 'done'))
  visible.sort((a, b) => a.due.localeCompare(b.due) || Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)))
  get('task-count').textContent = `${label} · ${matches.length} 项任务 · ${matches.filter(item => item.completedAt).length} 项已完成`
  const list = get('task-list')
  list.replaceChildren()
  if (!visible.length) list.append(node('p', '这个范围内暂无对应的待办。', 'muted'))
  let lastGroup
  for (const { task, due, completedAt } of visible) {
    const group = view === 'year' ? due.slice(0, 7) : due
    if (view !== 'day' && group !== lastGroup) {
      list.append(node('h3', group, 'task-group'))
      lastGroup = group
    }
    list.append(taskRow(task, due, completedAt))
  }

  const today = localDay()
  const current = today.slice(0, 4)
  const closed = today.endsWith('-12-31') ? current : String(Number(current) - 1)
  const oldChoice = yearPicker.value
  const years = new Set([current])
  for (const task of tasks) {
    years.add(task.date.slice(0, 4))
    if (task.repeat !== 'none') {
      const last = task.endDate ? Math.min(Number(task.endDate.slice(0, 4)), Number(current)) : Number(current)
      for (let year = Number(task.date.slice(0, 4)); year <= last; year++) years.add(String(year))
    }
    for (const at of task.repeat === 'none' ? [task.completedAt] : Object.values(task.completions)) {
      if (at) years.add(localDay(new Date(at)).slice(0, 4))
    }
    for (const session of task.focusSessions) {
      for (const day of Object.keys(session.days)) years.add(day.slice(0, 4))
    }
  }
  const descending = [...years].sort().reverse()
  yearPicker.replaceChildren(...descending.map(year => new Option(
    year + (year <= closed ? ' 年 · 年度回顾' : ' 年 · 进行中'), year
  )))
  yearPicker.value = years.has(oldChoice) ? oldChoice : descending.find(year => year <= closed) || current
  renderReview()
  renderFocus()
  controls()
}

function download (blob, name) {
  const url = URL.createObjectURL(blob)
  const link = node('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  const title = form.elements.title.value.trim()
  const date = form.elements.date.value
  const note = form.elements.note.value.trim()
  const repeat = form.elements.repeat.value
  const endDate = repeat === 'none' ? null : form.elements.endDate.value || null
  if (!title || !validDay(date)) return message('请输入任务名称和有效日期。')
  if (endDate && (!validDay(endDate) || endDate < date)) return message('重复截止日期不能早于安排日期。')
  const id = editing
  const previous = tasks.find(task => task.id === id)
  if (endDate && previous && [...Object.keys(previous.completions), ...previous.focusSessions.map(session => session.day)]
    .some(day => day > endDate)) return message('截止日期不能早于已有的完成或计时记录。')
  if (await save(items => {
    if (id && !items.some(item => item.id === id)) throw new Error('该任务已被删除，请重新选择。')
    const fields = { title, date, note, repeat, endDate }
    return id ? items.map(item => item.id === id ? { ...item, ...fields } : item)
      : [...items, { id: crypto.randomUUID(), ...fields, completedAt: null, completions: {} }]
  }, id ? '修改已保存到 GitHub。' : '新待办已保存到 GitHub。')) {
    dateFilter.value = date
    get('filter').value = 'all'
    setEditor()
    render()
    form.elements.title.focus()
  }
})

get('task-cancel').addEventListener('click', () => setEditor())
form.elements.repeat.addEventListener('change', controls)
get('today').addEventListener('click', () => {
  dateFilter.value = localDay()
  get('view').value = 'day'
  if (!editing) form.elements.date.value = dateFilter.value
  render()
})
dateFilter.addEventListener('change', () => {
  if (!editing && dateFilter.value) form.elements.date.value = dateFilter.value
  render()
})
for (const id of ['view', 'filter']) get(id).addEventListener('change', render)
get('focus-scope').addEventListener('change', renderFocus)
yearPicker.addEventListener('change', renderReview)
get('download-review').addEventListener('click', () => download(report, `todo-review-${yearPicker.value}.html`))
get('export-tasks').addEventListener('click', () => {
  const backup = new Blob([JSON.stringify({ version: 1, tasks }, null, 2)], { type: 'application/json' })
  download(backup, `todo-backup-${localDay()}.json`)
})
const fileInput = get('backup-file')
get('import-tasks').addEventListener('click', () => fileInput.click())
async function importTasks (data) {
  const imported = normalizeTasks(data)
  if (!imported.length) return message('没有可以导入的待办。')
  if (!confirm(`把 ${imported.length} 项待办合并到公开仓库？标题、日期和备注将公开。`)) return
  await save(items => [...new Map([...imported, ...items].map(item => [item.id, item])).values()],
    '已合并到 GitHub，同编号记录保留线上版本。')
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0]
  fileInput.value = ''
  if (!file || !token || busy) return
  try {
    if (file.size > 5_000_000) throw new Error('Backup too large')
    const backup = JSON.parse(await file.text())
    if (backup.version !== 1) throw new Error('Invalid backup')
    await importTasks(backup.tasks)
  } catch {
    message('无法读取备份。请选择本页面导出的 JSON 文件。')
  }
})

get('import-local').addEventListener('click', async () => {
  if (!token || busy) return
  try {
    await importTasks(JSON.parse(localStorage.getItem(storageKey) || '[]'))
  } catch {
    message('无法读取旧版浏览器待办。')
  }
})

async function refresh () {
  if (busy) return
  busy = true
  controls()
  message('正在读取 GitHub 待办…')
  try {
    useSnapshot(await loadTasks(token))
    message(token ? '已刷新 GitHub 待办。' : '访客可以查看待办和年度回顾。')
  } catch (error) {
    if (error.status === 401) {
      token = undefined
      setEditor()
    }
    revision = undefined
    message(error.message || '暂时无法读取 GitHub 待办，请稍后刷新。')
  } finally {
    busy = false
    render()
  }
}

login.addEventListener('submit', async event => {
  event.preventDefault()
  if (busy || token) return
  const value = login.elements.token.value.trim()
  login.reset()
  if (!window.isSecureContext) return message('请从 HTTPS 页面连接 GitHub。')
  busy = true
  controls()
  message('正在验证 GitHub 账号…')
  try {
    useSnapshot(await connectOwner(value))
    token = value
    message('已开启编辑，保存后会自动同步到 GitHub。')
  } catch (error) {
    message(error.message || '连接 GitHub 失败。')
  } finally {
    busy = false
    render()
    if (token) form.elements.title.focus()
  }
})

function disconnect () {
  token = undefined
  login.reset()
  setEditor()
  render()
}
get('todo-refresh').addEventListener('click', refresh)
get('todo-disconnect').addEventListener('click', () => {
  disconnect()
  message('已退出编辑。')
})
window.addEventListener('pagehide', disconnect)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render()
})
timer = bindTimer({
  canSave: () => Boolean(token && revision && !busy),
  notify: message,
  save: ({ id, taskId, title, day, days }) => save(items => {
    if (items.some(item => item.focusSessions.some(session => session.id === id))) return items
    const session = { id, day, days }
    const target = items.find(item => item.id === taskId && dueOn(item, day))
    if (target) return items.map(item => item === target ? { ...item, focusSessions: [...item.focusSessions, session] } : item)
    return [...items, { id, title, date: day, note: '', focusSessions: [session] }]
  }, '学习时长已保存到 GitHub。')
})
dateFilter.value = localDay()
setEditor()
refresh()
