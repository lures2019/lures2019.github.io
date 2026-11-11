import { addDays, completionAt, dueOn, focusFor, focusStats, formatFocus, localDay, normalizeTasks, occurrenceDays, period, repeatLabels, reportYear, validDay } from './todo-model.js?v=5'
import { connectOwner, loadTasks, writeTasks } from './todo-repo.js?v=5'
import { bindTimer } from './todo-timer.js?v=4'
import { dailyQuote, showReward } from './todo-rewards.js?v=6'
import { annualHTML, downloadFile as download, escapeHTML, metricsHTML, pieChart, showPie } from './report-view.js'

const storageKey = 'zayden-todo-v1'
const authKey = 'zayden-todo-auth-v1'
const draftKey = 'zayden-todo-draft-v1'
const weekDraftKey = 'treehouse-week-draft-v1'
const viewKey = 'zayden-todo-view-v1'
const get = id => document.getElementById(id)
const form = get('task-form')
const login = get('owner-connect')
const dateFilter = get('focus-date')
const yearPicker = get('review-year')
const weekForm = get('week-form')
const weekDraft = get('week-draft')
const dateTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' })
const shanghaiTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const planTitles = { day: '当天计划', week: '每周计划', month: '每月计划', year: '年度计划' }
const planPageSize = 50
const lateOn = (task, due, today, time) => due < today || Boolean(due === today && task.deadlineTime && task.deadlineTime < time)
let editing
let tasks = []
let token
let revision
let busy = false
let timer
let persistentLogin = false
let planLimit = planPageSize
let renderedRange

function stored (storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null }
}

function remember (storage, key, value) {
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(value))
  } catch { /* Browsers with storage disabled can still edit in memory. */ }
}

function forgetLogin () {
  token = undefined
  persistentLogin = false
  remember(sessionStorage, authKey, null)
  remember(localStorage, authKey, null)
}

function rememberView () {
  remember(localStorage, viewKey, Object.fromEntries(
    ['focus-date', 'view', 'filter', 'focus-scope', 'review-year'].map(id => [id, get(id).value])
  ))
}

function rememberDraft () {
  if (!token) return
  const draft = { editing, fields: Object.fromEntries(
    ['title', 'note', 'date', 'deadlineTime', 'repeat', 'endDate'].map(name => [name, form.elements[name].value])
  ) }
  remember(sessionStorage, draftKey, draft)
  if (persistentLogin) remember(localStorage, draftKey, draft)
}

function rememberWeek () {
  if (!token) return
  const { title, note, date, deadlineTime, done } = weekForm.elements
  const draft = weekDraft.hidden ? null : { title: title.value, note: note.value, date: date.value, deadlineTime: deadlineTime.value, done: done.checked }
  remember(sessionStorage, weekDraftKey, draft)
  if (persistentLogin) remember(localStorage, weekDraftKey, draft)
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

function controls () {
  const owner = Boolean(token)
  get('todo-workspace').hidden = !owner
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
  get('week-add').hidden = !owner
  get('week-add').disabled = busy || !revision
  get('week-actions').hidden = !owner
  if (!owner) weekDraft.hidden = true
  const current = tasks.find(task => task.id === editing)
  const hasHistory = current && (current.completedAt || Object.keys(current.completions).length || current.focusSessions.length)
  form.elements.date.disabled = Boolean(hasHistory)
  form.elements.repeat.disabled = Boolean(hasHistory)
  for (const list of ['week-rows', 'week-draft']) {
    for (const item of get(list).querySelectorAll('input, button')) item.disabled = busy || !owner || !revision
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
      forgetLogin()
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
  form.elements.deadlineTime.value = task?.deadlineTime || ''
  form.elements.repeat.value = task?.repeat || 'none'
  form.elements.endDate.value = task?.endDate || ''
  get('task-form-title').textContent = task ? '编辑待办' : '新建待办'
  get('task-save').textContent = task ? '保存修改' : '添加待办'
  get('task-cancel').hidden = !task
  rememberDraft()
  controls()
}

function completionCheckbox (task, due, completedAt) {
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

  return check
}

function taskActions (task, due) {
  const actions = node('div', '', 'actions')
  const edit = node('button', '编辑', 'secondary compact')
  edit.addEventListener('click', () => {
    setEditor(task)
    form.elements.title.focus()
  })
  const timeTask = node('button', '计时', 'secondary compact')
  timeTask.addEventListener('click', () => timer.prefill(task, due))
  const remove = node('button', task.repeat === 'none' ? '删除' : '删除整组', 'secondary compact')
  remove.addEventListener('click', async () => {
    if (!confirm(`删除「${task.title}」及其完成记录？`)) return
    if (await save(items => items.filter(item => item.id !== task.id), '已删除任务。') && editing === task.id) setEditor()
  })
  actions.append(edit, timeTask, remove)
  return actions
}

function planRow (task, due, completedAt, late) {
  const row = node('tr')
  const name = node('th', task.title)
  name.scope = 'row'
  const study = focusFor(task, due)
  const context = [task.repeat === 'none' ? '' : repeatLabels[task.repeat], study ? '学习 ' + formatFocus(study) : ''].filter(Boolean)
  if (context.length) name.append(node('small', context.join(' · ')))
  const progress = node('td')
  const status = node('label', '', 'inline-check')
  if (token) status.append(completionCheckbox(task, due, completedAt))
  const badge = node('span', completedAt ? '已完成' : late ? '已逾期' : '待完成', 'plan-state')
  badge.dataset.state = completedAt ? 'done' : late ? 'late' : 'open'
  status.append(badge)
  progress.append(status)
  if (completedAt) progress.append(node('small', dateTime.format(new Date(completedAt))))
  const deadline = node('td', due, 'numeric')
  if (task.deadlineTime) deadline.append(node('small', task.deadlineTime))
  row.append(name, deadline, progress, node('td', task.note || '—', 'task-note'))
  if (token) {
    const actions = node('td')
    actions.append(taskActions(task, due))
    row.append(actions)
  }
  return row
}

function renderCheckIn (today) {
  const start = addDays(today, -29)
  const activity = new Set()
  for (const task of tasks) {
    const completed = task.repeat === 'none' ? [task.completedAt] : Object.values(task.completions)
    for (const at of completed) {
      if (!at) continue
      const day = localDay(new Date(at))
      if (day >= start && day <= today) activity.add(day)
    }
    for (const session of task.focusSessions) {
      for (const day of Object.keys(session.days)) {
        if (day >= start && day <= today) activity.add(day)
      }
    }
  }
  const calendar = get('check-in-days')
  const weekday = new Date(start + 'T00:00:00Z').getUTCDay()
  const days = []
  for (let blank = 0; blank < (weekday + 6) % 7; blank++) {
    const spacer = node('span')
    spacer.setAttribute('aria-hidden', 'true')
    days.push(spacer)
  }
  for (let i = 0; i < 30; i++) {
    const day = addDays(start, i)
    const checked = activity.has(day)
    const tile = node('div', '', 'check-in-day')
    tile.dataset.day = day
    tile.toggleAttribute('data-checked', checked)
    tile.setAttribute('role', 'listitem')
    tile.title = day + (checked ? ' 已打卡' : ' 无记录')
    tile.setAttribute('aria-label', tile.title)
    if (day === today) tile.setAttribute('aria-current', 'date')
    const mark = node('span', checked ? '✓' : '×', 'check-in-mark')
    mark.setAttribute('aria-hidden', 'true')
    const date = node('time', i === 0 || day.endsWith('-01') ? day.slice(5).replace('-', '/') : String(Number(day.slice(8))))
    date.dateTime = day
    date.setAttribute('aria-hidden', 'true')
    tile.append(mark, date)
    days.push(tile)
  }
  calendar.replaceChildren(...days)
  get('check-in-range').textContent = start.slice(5).replace('-', '/') + ' – ' + today.slice(5).replace('-', '/')
  get('check-in-total').textContent = activity.size + ' / 30 天'
}

function reviewMetrics (summary, focus) {
  return [['安排任务', summary.scheduled], ['当年完成', summary.completed], ['按时完成计划', summary.onTime], ['计划完成率', summary.rate],
    ['番茄钟次数', focus.sessions], ['学习时长', formatFocus(focus.total)], ['学习天数', focus.active],
    ['日均学习', focus.active ? formatFocus(focus.average) : '—'], ['最长连续学习', focus.streak + ' 天']]
}

function renderReview () {
  const year = yearPicker.value
  if (!year) return
  get('review-preview').innerHTML = metricsHTML(reviewMetrics(reportYear(tasks, year), focusStats(tasks, year + '-01-01', year + '-12-31')))
}

function exportReview () {
  const year = yearPicker.value
  if (!year) return
  const summary = reportYear(tasks, year)
  const focus = focusStats(tasks, year + '-01-01', year + '-12-31')
  const months = summary.months.map(({ scheduled, completed }, index) => {
    const { start, end } = period(`${year}-${String(index + 1).padStart(2, '0')}-01`, 'month')
    const month = focusStats(tasks, start, end)
    const best = month.top[0]
    return `<details><summary>${index + 1} 月 · 完成 ${completed} 项 · 学习 ${formatFocus(month.total)}</summary>
      <p>安排 ${scheduled} 项，学习 ${month.active} 天，记录 ${month.sessions} 次专注。${best ? '投入最多的任务是「' + escapeHTML(best.title) + '」，共 ' + formatFocus(best.duration) + '。' : ''}</p></details>`
  }).join('')
  const top = focus.top.map(({ title, duration }) => [title, duration])
  const sections = [
    ['年度任务进度', pieChart([['按时完成', summary.onTime], ['逾期完成', summary.finishedPlans - summary.onTime], ['未完成', summary.scheduled - summary.finishedPlans]], value => value + ' 项')],
    ['每月学习与任务', months],
    ['学习任务 Top 10', pieChart(top, formatFocus)]
  ]
  const html = annualHTML({ year, title: '年度学习与待办回顾', metrics: reviewMetrics(summary, focus), sections,
    footer: '安排按截止日期统计，完成按实际完成日期统计。日均时长按有专注记录的日期计算。生成于 ' + localDay() })
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `todo-review-${year}.html`)
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
  const rangeKey = view + ':' + start + ':' + filter
  if (rangeKey !== renderedRange) planLimit = planPageSize
  renderedRange = rangeKey
  const now = new Date()
  const today = localDay(now)
  const time = shanghaiTime.format(now)
  const matches = tasks.flatMap(task => Array.from(occurrenceDays(task, start, end),
    due => ({ task, due, completedAt: completionAt(task, due), late: lateOn(task, due, today, time) })))
  const visible = matches.filter(item => filter === 'all' || Boolean(item.completedAt) === (filter === 'done'))
  visible.sort((a, b) => a.due.localeCompare(b.due) || Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)))
  const done = matches.filter(item => item.completedAt).length
  const late = matches.filter(item => !item.completedAt && item.late).length
  get('task-count').textContent = `${label} · ${matches.length} 项任务 · ${done} 项已完成`
  const chart = get('todo-period-chart')
  chart.hidden = !matches.length
  if (!chart.hidden) showPie(chart, [['已完成', done], ['待完成', matches.length - done - late], ['已逾期', late]], value => value + ' 项')
  get('weekly-title').textContent = planTitles[view]
  weekForm.elements.date.min = start
  weekForm.elements.date.max = end
  const rows = get('week-rows')
  rows.replaceChildren(...visible.slice(0, planLimit).map(({ task, due, completedAt, late }) => planRow(task, due, completedAt, late)))
  get('plan-more').hidden = visible.length <= planLimit
  if (!visible.length) {
    const cell = rows.insertRow().insertCell()
    cell.colSpan = token ? 5 : 4
    cell.textContent = '这个范围内暂无对应的待办。'
  }

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
  yearPicker.replaceChildren(...descending.map(year => new Option(year + ' 年', year)))
  yearPicker.value = years.has(oldChoice) ? oldChoice : descending.find(year => year <= closed) || current
  renderReview()
  renderFocus()
  if (token) {
    renderCheckIn(today)
    get('focus-quote-text').textContent = dailyQuote(today)
  }
  controls()
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  const title = form.elements.title.value.trim()
  const date = form.elements.date.value
  const deadlineTime = form.elements.deadlineTime.value
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
    const fields = { title, date, deadlineTime, note, repeat, endDate }
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
get('open-week').onclick = () => {
  dateFilter.value = localDay()
  get('view').value = 'week'
  get('filter').value = 'all'
  rememberView()
  render()
}
get('week-add').onclick = () => {
  if (weekDraft.hidden) {
    weekForm.reset()
    weekForm.elements.date.value = validDay(dateFilter.value) ? dateFilter.value : localDay()
    weekDraft.hidden = false
    rememberWeek()
  }
  weekForm.elements.title.focus()
}
get('week-cancel').onclick = () => { weekDraft.hidden = true; rememberWeek() }
get('plan-more').onclick = () => { planLimit += planPageSize; render() }
weekDraft.addEventListener('input', rememberWeek)
weekForm.onsubmit = async event => {
  event.preventDefault()
  const { title, date, deadlineTime, done, note } = weekForm.elements
  if (!title.value.trim() || !validDay(date.value) || date.value < date.min || date.value > date.max) {
    return message('请填写任务名称和当前日期范围内的截止日期。')
  }
  const task = { id: crypto.randomUUID(), title: title.value.trim(), date: date.value, deadlineTime: deadlineTime.value, note: note.value.trim(),
    completedAt: done.checked ? new Date().toISOString() : null }
  if (await save(items => [...items, task], '计划已保存到 GitHub。')) {
    weekForm.reset()
    weekDraft.hidden = true
    rememberWeek()
    get('filter').value = 'all'
    render()
    get('week-add').focus()
  }
}
dateFilter.addEventListener('change', () => {
  if (!editing && dateFilter.value) form.elements.date.value = dateFilter.value
  render()
})
for (const id of ['view', 'filter']) get(id).addEventListener('change', render)
for (const id of ['focus-date', 'view', 'filter', 'focus-scope', 'review-year']) get(id).addEventListener('change', rememberView)
form.addEventListener('input', rememberDraft)
get('focus-scope').addEventListener('change', renderFocus)
yearPicker.addEventListener('change', renderReview)
get('download-review').addEventListener('click', exportReview)
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
      forgetLogin()
      setEditor()
    }
    revision = undefined
    message(error.message || '暂时无法读取 GitHub 待办，请稍后刷新。')
  } finally {
    busy = false
    render()
  }
}

async function signIn (value, persistent, restore = false) {
  if (!window.isSecureContext) return message('请从 HTTPS 页面连接 GitHub。')
  busy = true
  controls()
  message('正在验证 GitHub 账号…')
  try {
    useSnapshot(await connectOwner(value))
    token = value
    persistentLogin = persistent
    if (!restore) {
      const auth = { value, until: Date.now() + 90 * 86400_000 }
      remember(sessionStorage, authKey, auth)
      remember(localStorage, authKey, persistent ? auth : null)
    }
    const draft = stored(sessionStorage, draftKey) || (persistent && stored(localStorage, draftKey))
    if (draft?.fields && (!draft.editing || tasks.some(task => task.id === draft.editing))) {
      setEditor(tasks.find(task => task.id === draft.editing))
      for (const name of ['title', 'note', 'date', 'deadlineTime', 'repeat', 'endDate']) {
        if (typeof draft.fields[name] === 'string') form.elements[name].value = draft.fields[name]
      }
      rememberDraft()
    }
    const week = stored(sessionStorage, weekDraftKey) || (persistent && stored(localStorage, weekDraftKey))
    if (week && validDay(week.date)) {
      for (const name of ['title', 'note', 'date', 'deadlineTime']) if (typeof week[name] === 'string') weekForm.elements[name].value = week[name]
      weekForm.elements.done.checked = week.done === true
      weekDraft.hidden = false
    }
    message('已开启编辑，保存后会自动同步到 GitHub。')
  } catch (error) {
    if (error.status === 401) forgetLogin()
    message(error.message || '连接 GitHub 失败。')
  } finally {
    busy = false
    render()
    if (token) form.elements.title.focus()
  }
}

login.addEventListener('submit', event => {
  event.preventDefault()
  if (busy || token) return
  const value = login.elements.token.value.trim()
  const persistent = login.elements.remember.checked
  login.reset()
  signIn(value, persistent)
})

function disconnect () {
  forgetLogin()
  remember(sessionStorage, draftKey, null)
  remember(localStorage, draftKey, null)
  remember(sessionStorage, weekDraftKey, null)
  remember(localStorage, weekDraftKey, null)
  login.reset()
  setEditor()
  render()
}
get('todo-refresh').addEventListener('click', refresh)
get('todo-disconnect').addEventListener('click', () => {
  disconnect()
  message('已退出编辑。')
})
window.addEventListener('pagehide', () => { rememberView(); rememberDraft() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render()
})
timer = bindTimer({
  canSave: () => Boolean(token && revision && !busy),
  canCelebrate: () => Boolean(token),
  notify: message,
  celebrate: showReward,
  save: ({ id, taskId, title, day, days }) => save(items => {
    if (items.some(item => item.focusSessions.some(session => session.id === id))) return items
    const session = { id, day, days }
    const target = items.find(item => item.id === taskId && dueOn(item, day))
    if (target) return items.map(item => item === target ? { ...item, focusSessions: [...item.focusSessions, session] } : item)
    return [...items, { id, title, date: day, note: '', focusSessions: [session] }]
  }, '学习时长已保存到 GitHub。')
})
const savedView = stored(localStorage, viewKey) || {}
dateFilter.value = validDay(savedView['focus-date']) ? savedView['focus-date'] : localDay()
for (const id of ['view', 'filter', 'focus-scope']) {
  if ([...get(id).options].some(option => option.value === savedView[id])) get(id).value = savedView[id]
}
setEditor()
function validLogin (storage) {
  const login = stored(storage, authKey)
  if (typeof login?.value === 'string' && login.until > Date.now()) return login
  remember(storage, authKey, null)
  if (storage === localStorage) {
    remember(storage, draftKey, null)
    remember(storage, weekDraftKey, null)
  }
}
const persistentAuth = validLogin(localStorage)
const savedLogin = validLogin(sessionStorage) || persistentAuth
if (savedLogin) {
  await signIn(savedLogin.value, savedLogin.value === persistentAuth?.value, true)
  if (!token) await refresh()
} else await refresh()
if ([...yearPicker.options].some(option => option.value === savedView['review-year'])) {
  yearPicker.value = savedView['review-year']
  renderReview()
}
