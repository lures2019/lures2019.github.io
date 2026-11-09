'use strict'

const storageKey = 'zayden-todo-v1'
const get = id => document.getElementById(id)
const form = get('task-form')
const dateFilter = get('focus-date')
const yearPicker = get('review-year')
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
let editing
let tasks = []
let report

function localDay (date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-')
}

function node (tag, text = '', className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  if (className) element.className = className
  return element
}

function message (text) {
  get('todo-status').textContent = text
}

function read () {
  return JSON.parse(localStorage.getItem(storageKey) || '[]')
}

function save (change, feedback) {
  try {
    const next = change(read())
    localStorage.setItem(storageKey, JSON.stringify(next))
    tasks = next
  } catch {
    message('保存失败，请检查浏览器的存储权限或空间。')
    return false
  }
  render()
  message(feedback)
  return true
}

function setEditor (task) {
  editing = task?.id
  form.elements.title.value = task?.title || ''
  form.elements.note.value = task?.note || ''
  form.elements.date.value = task?.date || dateFilter.value || localDay()
  get('task-form-title').textContent = task ? '编辑待办' : '新建待办'
  get('task-save').textContent = task ? '保存修改' : '添加待办'
  get('task-cancel').hidden = !task
}

function taskRow (task) {
  const row = node('article', '', 'task')
  row.toggleAttribute('data-done', Boolean(task.completedAt))
  const check = node('input')
  check.type = 'checkbox'
  check.checked = Boolean(task.completedAt)
  check.id = 'done-' + task.id
  check.setAttribute('aria-label', '完成 ' + task.title)
  check.addEventListener('change', () => {
    const completedAt = check.checked ? new Date().toISOString() : null
    if (!save(items => items.map(item => item.id === task.id ? { ...item, completedAt } : item),
      completedAt ? '已记录完成时间。' : '已恢复为待完成。')) check.checked = !check.checked
    get(check.id)?.focus()
  })

  const text = node('div')
  text.append(node('h3', task.title))
  if (task.note) text.append(node('p', task.note, 'task-note'))
  const status = task.completedAt ? '完成于 ' + dateTime.format(new Date(task.completedAt)) : '待完成'
  text.append(node('p', task.date + ' · ' + status, 'task-meta'))
  const actions = node('div', '', 'actions')
  const edit = node('button', '编辑', 'secondary compact')
  edit.addEventListener('click', () => {
    setEditor(task)
    form.elements.title.focus()
  })
  const remove = node('button', '删除', 'secondary compact')
  remove.addEventListener('click', () => {
    if (!confirm(`删除「${task.title}」？`)) return
    if (save(items => items.filter(item => item.id !== task.id), '已删除任务。') && editing === task.id) setEditor()
  })
  actions.append(edit, remove)
  row.append(check, text, actions)
  return row
}

function renderReview () {
  const year = yearPicker.value
  const months = Array.from({ length: 12 }, () => ({ scheduled: 0, completed: 0 }))
  let scheduled = 0
  let completed = 0
  let finishedPlans = 0
  const activeDays = new Set()
  for (const task of tasks) {
    const done = task.completedAt && localDay(new Date(task.completedAt))
    if (task.date.startsWith(year + '-')) {
      scheduled++
      months[Number(task.date.slice(5, 7)) - 1].scheduled++
      if (done && done.slice(0, 4) <= year) finishedPlans++
    }
    if (done?.startsWith(year + '-')) {
      completed++
      activeDays.add(done)
      months[Number(done.slice(5, 7)) - 1].completed++
    }
  }
  const rate = scheduled ? Math.round(finishedPlans / scheduled * 100) + '%' : '—'
  const numbers = [['安排任务', scheduled], ['当年完成', completed], ['完成天数', activeDays.size], ['计划完成率', rate]]
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
<p>生成日期 ${localDay()}</p></main></body></html>`], { type: 'text/html;charset=utf-8' })
}

function render () {
  const view = get('view').value
  const period = (dateFilter.value || localDay()).slice(0, { day: 10, month: 7, year: 4 }[view])
  const filter = get('filter').value
  const matches = tasks.filter(task => task.date.startsWith(period))
  const visible = matches.filter(task => filter === 'all' || Boolean(task.completedAt) === (filter === 'done'))
  visible.sort((a, b) => a.date.localeCompare(b.date) || Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)))
  get('task-count').textContent = `${period} · ${matches.length} 项任务 · ${matches.filter(task => task.completedAt).length} 项已完成`
  const list = get('task-list')
  list.replaceChildren()
  if (!visible.length) list.append(node('p', '这个范围内暂无对应的待办。', 'muted'))
  let lastGroup
  for (const task of visible) {
    const group = view === 'year' ? task.date.slice(0, 7) : task.date
    if (view !== 'day' && group !== lastGroup) {
      list.append(node('h3', group, 'task-group'))
      lastGroup = group
    }
    list.append(taskRow(task))
  }

  const today = localDay()
  const current = today.slice(0, 4)
  const closed = today.endsWith('-12-31') ? current : String(Number(current) - 1)
  const oldChoice = yearPicker.value
  const years = new Set([current])
  for (const task of tasks) {
    years.add(task.date.slice(0, 4))
    if (task.completedAt) years.add(localDay(new Date(task.completedAt)).slice(0, 4))
  }
  const descending = [...years].sort().reverse()
  yearPicker.replaceChildren(...descending.map(year => new Option(
    year + (year <= closed ? ' 年 · 年度回顾' : ' 年 · 进行中'), year
  )))
  yearPicker.value = years.has(oldChoice) ? oldChoice : descending.find(year => year <= closed) || current
  renderReview()
}

function download (blob, name) {
  const url = URL.createObjectURL(blob)
  const link = node('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function validDay (value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
}

form.addEventListener('submit', event => {
  event.preventDefault()
  const title = form.elements.title.value.trim()
  const date = form.elements.date.value
  const note = form.elements.note.value.trim()
  if (!title || !validDay(date)) return message('请输入任务名称和有效日期。')
  const id = editing
  if (save(items => {
    if (id && !items.some(item => item.id === id)) throw new Error('Task no longer exists')
    return id ? items.map(item => item.id === id ? { ...item, title, date, note } : item)
      : [...items, { id: crypto.randomUUID(), title, date, note, completedAt: null }]
  }, id ? '已保存修改。' : '已添加任务。')) {
    dateFilter.value = date
    get('filter').value = 'all'
    setEditor()
    render()
    form.elements.title.focus()
  }
})

get('task-cancel').addEventListener('click', () => setEditor())
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
yearPicker.addEventListener('change', renderReview)
get('download-review').addEventListener('click', () => download(report, `todo-review-${yearPicker.value}.html`))
get('export-tasks').addEventListener('click', () => {
  const backup = new Blob([JSON.stringify({ version: 1, tasks }, null, 2)], { type: 'application/json' })
  download(backup, `todo-backup-${localDay()}.json`)
})
const fileInput = get('backup-file')
get('import-tasks').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0]
  fileInput.value = ''
  if (!file) return
  try {
    if (file.size > 5_000_000) throw new Error('Backup too large')
    const backup = JSON.parse(await file.text())
    if (backup.version !== 1 || !Array.isArray(backup.tasks)) throw new Error('Invalid backup')
    const imported = backup.tasks.map(({ id, title, note, date, completedAt }) => {
      if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id) || typeof title !== 'string' ||
          !title.trim() || title.length > 160 || typeof note !== 'string' || note.length > 2000 ||
          !validDay(date) || (completedAt !== null && (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))))) {
        throw new Error('Invalid task')
      }
      return { id, title, note, date, completedAt }
    })
    save(items => [...new Map([...imported, ...items].map(item => [item.id, item])).values()],
      '备份已合并，保留本机已有的同一任务。')
  } catch {
    message('无法读取备份。请选择本页面导出的 JSON 文件。')
  }
})

function refresh () {
  try {
    tasks = read()
    render()
  } catch {
    message('浏览器存储不可用，暂时无法读取待办。')
  }
}
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) refresh()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh()
})
dateFilter.value = localDay()
setEditor()
refresh()
