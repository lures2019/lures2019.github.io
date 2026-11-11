import { dayparts, directions, money, normalizeEntries, parseAmount, summarize } from './ledger-model.js'
import { addDays, localDay, period, validDay } from './todo-model.js?v=4'
import { readDocument, verifyOwner, writeDocument } from './todo-repo.js?v=4'
import { annualHTML, downloadFile, escapeHTML, metricsHTML, pieChart, showPie } from './report-view.js'

const file = 'ledger.json'
const authKey = 'zayden-todo-auth-v1'
const draftKey = 'treehouse-ledger-draft-v1'
const viewKey = 'treehouse-ledger-view-v1'
const get = id => document.getElementById(id)
const login = get('ledger-login')
const form = get('ledger-form')
const filters = ['ledger-view', 'ledger-date', 'ledger-kind', 'ledger-category', 'ledger-search']
const fields = ['date', 'daypart', 'direction', 'amount', 'title', 'category', 'note']
const date = get('ledger-date')
const yearPicker = get('ledger-year')
const dayOrder = Object.keys(dayparts)
let entries = []
let revision
let owner
let persistent = false
let busy = false
let editing
let rowLimit = 60
let categoryChoice = 'all'

function node (tag, text = '', className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  if (className) element.className = className
  return element
}

function status (text) { get('ledger-status').textContent = text }
function stored (storage, key) {
  try { return JSON.parse(storage.getItem(key)) } catch { return null }
}
function keep (storage, key, value) {
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(value))
  } catch { /* Storage may be disabled. */ }
}
function auth (storage) {
  const value = stored(storage, authKey)
  return typeof value?.value === 'string' && value.until > Date.now() ? value : null
}
function clearAuth () {
  owner = undefined
  persistent = false
  keep(localStorage, authKey, null)
  keep(sessionStorage, authKey, null)
}
function rememberDraft () {
  if (!owner) return
  const draft = { editing, fields: Object.fromEntries(fields.map(key => [key, form.elements[key].value])) }
  keep(sessionStorage, draftKey, draft)
  if (persistent) keep(localStorage, draftKey, draft)
}

function currentPart () {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' }).format())
  return hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 16 ? 'midday' : hour >= 16 && hour < 23 ? 'evening' : 'other'
}

function setForm (entry) {
  editing = entry?.id
  form.elements.date.value = entry?.date || localDay()
  form.elements.daypart.value = entry?.daypart || currentPart()
  form.elements.direction.value = entry?.direction || 'expense'
  form.elements.amount.value = entry ? (entry.cents / 100).toFixed(2) : ''
  for (const key of ['title', 'category', 'note']) form.elements[key].value = entry?.[key] || ''
  get('ledger-form-title').textContent = entry ? '编辑收支' : '新增收支'
  get('ledger-cancel').hidden = !entry
  suggestTitles()
}

function button (label, action) {
  const control = node('button', label, 'secondary compact')
  control.type = 'button'
  control.disabled = busy
  control.onclick = action
  return control
}

function controls () {
  const enabled = Boolean(owner)
  login.hidden = enabled
  login.querySelector('button').disabled = busy
  get('ledger-signout').hidden = !enabled
  get('ledger-signout').disabled = busy
  get('ledger-editor').hidden = !enabled
  get('ledger-actions').hidden = !enabled
  get('ledger-save').disabled = busy || !revision
  get('ledger-refresh').disabled = busy
  for (const control of get('ledger-rows').querySelectorAll('button')) control.disabled = busy || !revision
}

function suggestTitles () {
  const query = form.elements.title.value.trim().toLowerCase()
  const direction = form.elements.direction.value
  const titles = new Map()
  for (let i = entries.length - 1; i >= 0 && titles.size < 25; i--) {
    const entry = entries[i]
    if (entry.direction === direction && entry.title.toLowerCase().includes(query) && !titles.has(entry.title)) {
      titles.set(entry.title, entry.category)
    }
  }
  get('ledger-titles').replaceChildren(...[...titles].map(([title, category]) => new Option(category, title)))
}

function metrics (totals) {
  return [['支出', money(totals.expense)], ['收入', money(totals.income)], ['结余', money(totals.net)], ['记账笔数', totals.count]]
}

function categories () {
  return [...new Set(entries.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function render () {
  const choice = get('ledger-category')
  const labels = categories()
  choice.replaceChildren(new Option('全部分类', ''), ...labels.map(label => new Option(label, label)))
  choice.value = labels.includes(categoryChoice) ? categoryChoice : ''
  get('ledger-categories').replaceChildren(...labels.map(label => new Option(label, label)))
  suggestTitles()
  if (!validDay(date.value)) date.value = localDay()
  const { start, end, label } = period(date.value, get('ledger-view').value)
  const search = get('ledger-search').value.trim().toLowerCase()
  const direction = get('ledger-kind').value
  const selected = entries.filter(item => item.date >= start && item.date <= end &&
    (!choice.value || item.category === choice.value) && (direction === 'all' || item.direction === direction) &&
    (!search || [item.title, item.note, item.category].some(text => text.toLowerCase().includes(search))))
    .sort((a, b) => b.date.localeCompare(a.date) || dayOrder.indexOf(a.daypart) - dayOrder.indexOf(b.daypart))
  const totals = summarize(selected)
  get('ledger-metrics').innerHTML = metricsHTML(metrics(totals))
  get('ledger-parts').innerHTML = metricsHTML(Object.entries(dayparts).map(([key, label]) => [label + '支出', money(totals.parts[key])]))
  showPie(get('ledger-expense-chart'), totals.expenses, money)
  showPie(get('ledger-income-chart'), totals.incomes, money)
  get('ledger-range').textContent = `${label} · ${totals.days} 天有记录 · ${selected.length} 笔`
  const rows = get('ledger-rows')
  rows.replaceChildren()
  for (const item of selected.slice(0, rowLimit)) {
    const row = rows.insertRow()
    const amount = node('td', (item.direction === 'expense' ? '−' : '+') + money(item.cents), 'ledger-amount')
    amount.dataset.direction = item.direction
    row.append(node('td', item.date + ' · ' + dayparts[item.daypart]), node('th', item.title),
      node('td', item.category), amount, node('td', item.note || '—'))
    row.querySelector('th').scope = 'row'
    if (owner) {
      const tools = node('div', '', 'actions')
      tools.append(button('编辑', () => {
        setForm(item)
        rememberDraft()
        form.elements.amount.focus()
      }), button('删除', () => {
        if (confirm(`删除「${item.title}」这笔公开收支？`)) void save(items => items.filter(entry => entry.id !== item.id), '该笔收支已删除。')
      }))
      row.insertCell().append(tools)
    }
  }
  if (!selected.length) {
    const cell = rows.insertRow().insertCell()
    cell.colSpan = owner ? 6 : 5
    cell.textContent = '这个范围暂无匹配的收支。'
  }
  get('ledger-more').hidden = selected.length <= rowLimit
  const oldYear = yearPicker.value
  const years = [...new Set([localDay().slice(0, 4), ...entries.map(entry => entry.date.slice(0, 4))])].sort().reverse()
  yearPicker.replaceChildren(...years.map(year => new Option(year + ' 年', year)))
  if (years.includes(oldYear)) yearPicker.value = oldYear
  controls()
}

async function load (token = owner) {
  const { data, sha } = await readDocument(file, token)
  entries = normalizeEntries(data.entries)
  revision = sha
}

async function refresh () {
  if (busy) return
  busy = true
  controls()
  status('正在读取 GitHub 账本…')
  try {
    await load()
    status(owner ? '站主编辑已连接，保存会同步到 GitHub。' : '')
  } catch (error) {
    revision = undefined
    if (error.status === 401) clearAuth()
    status(error.message)
  } finally {
    busy = false
    render()
  }
}

async function save (update, message) {
  if (busy || !owner || !revision) return false
  busy = true
  controls()
  let next
  status('正在保存到 GitHub…')
  try {
    next = normalizeEntries(update(entries))
    revision = await writeDocument(file, { version: 1, entries: next }, revision, owner, 'Update Treehouse ledger')
    entries = next
    status(message)
    return true
  } catch (error) {
    if (error.status === 401) clearAuth()
    else if (next && [undefined, 409, 422].includes(error.status)) {
      try {
        await load()
        if (JSON.stringify(entries) === JSON.stringify(next)) { status(message); return true }
      } catch { revision = undefined }
    }
    status(error.message || '无法保存，请稍后再试。')
    return false
  } finally {
    busy = false
    render()
  }
}

async function signIn (value, remember, restored = false) {
  if (busy || !window.isSecureContext) return
  busy = true
  controls()
  status('正在验证 GitHub 账号…')
  try {
    await verifyOwner(value)
    await load(value)
    owner = value
    persistent = remember
    if (!restored) {
      const login = { value, until: Date.now() + 90 * 86400_000 }
      keep(sessionStorage, authKey, login)
      keep(localStorage, authKey, remember ? login : null)
    }
    const draft = stored(sessionStorage, draftKey) || (remember && stored(localStorage, draftKey))
    setForm(entries.find(entry => entry.id === draft?.editing))
    if (draft?.fields && (!draft.editing || draft.editing === editing)) {
      for (const key of fields) if (typeof draft.fields[key] === 'string') form.elements[key].value = draft.fields[key]
    }
    status('站主编辑已连接，保存会同步到 GitHub。')
  } catch (error) {
    if (error.status === 401) clearAuth()
    status(error.message)
  } finally {
    busy = false
    render()
  }
}

function shift (step) {
  const { start, end } = period(date.value, get('ledger-view').value)
  const next = step < 0 ? addDays(start, -1) : addDays(end, 1)
  if (validDay(next)) { date.value = next; changeView() }
}

function changeView () {
  categoryChoice = get('ledger-category').value
  rowLimit = 60
  keep(localStorage, viewKey, Object.fromEntries(filters.map(id => [id, get(id).value])))
  render()
}

function exportYear () {
  const year = yearPicker.value
  const rows = entries.filter(entry => entry.date.startsWith(year + '-'))
  const totals = summarize(rows)
  const months = Array.from({ length: 12 }, (_, i) => {
    const prefix = year + '-' + String(i + 1).padStart(2, '0')
    const month = summarize(rows.filter(entry => entry.date.startsWith(prefix)))
    const largest = month.expenses[0]
    return `<details><summary>${i + 1} 月 · 支出 ${money(month.expense)} · 结余 ${money(month.net)}</summary>
      <p>收入 ${money(month.income)}，共 ${month.count} 笔记录。${largest ? '最大支出类别为「' + escapeHTML(largest[0]) + '」，共 ' + money(largest[1]) + '。' : ''}</p></details>`
  })
  const html = annualHTML({ year, title: '树屋收支年度回顾',
    metrics: [...metrics(totals), ['有记录的天数', totals.days], ['日均支出', totals.days ? money(Math.round(totals.expense / totals.days)) : '—']],
    sections: [['支出分布', pieChart(totals.expenses, money)], ['收入分布', pieChart(totals.incomes, money)],
      ['各时段支出', pieChart(Object.entries(dayparts).map(([key, name]) => [name, totals.parts[key]]), money)],
      ['每月收支与结余', months.join('')]],
    footer: '币种为人民币。日均支出按当年有记账记录的日期计算。生成于 ' + localDay() })
  downloadFile(new Blob([html], { type: 'text/html;charset=utf-8' }), `ledger-review-${year}.html`)
}

login.onsubmit = event => {
  event.preventDefault()
  const value = login.elements.token.value.trim()
  const remember = login.elements.remember.checked
  login.reset()
  void signIn(value, remember)
}
get('ledger-signout').onclick = () => {
  clearAuth()
  keep(sessionStorage, draftKey, null)
  keep(localStorage, draftKey, null)
  setForm()
  render()
  status('已退出编辑。')
}
form.elements.title.oninput = suggestTitles
form.elements.title.onchange = () => {
  if (!form.elements.category.value) {
    const match = entries.findLast(item => item.title === form.elements.title.value.trim() && item.direction === form.elements.direction.value)
    if (match) form.elements.category.value = match.category
  }
  rememberDraft()
}
form.elements.direction.onchange = suggestTitles
form.oninput = rememberDraft
get('ledger-cancel').onclick = () => { setForm(); rememberDraft() }
form.onsubmit = async event => {
  event.preventDefault()
  const values = Object.fromEntries(fields.map(key => [key, form.elements[key].value.trim()]))
  const { amount, ...item } = values
  const id = editing || crypto.randomUUID()
  const entry = { ...item, id, cents: parseAmount(amount) }
  if (await save(items => {
    if (!editing) return [...items, entry]
    if (!items.some(item => item.id === id)) throw new Error('这笔收支已在另一设备删除。')
    return items.map(item => item.id === id ? entry : item)
  }, '该笔收支已保存到 GitHub。')) {
    date.value = entry.date
    get('ledger-kind').value = 'all'
    get('ledger-category').value = ''
    get('ledger-search').value = ''
    setForm()
    form.elements.date.value = entry.date
    form.elements.daypart.value = entry.daypart
    rememberDraft()
    changeView()
    form.elements.amount.focus()
  }
}
for (const id of filters) get(id).addEventListener(id === 'ledger-search' ? 'input' : 'change', changeView)
get('ledger-previous').onclick = () => shift(-1)
get('ledger-next').onclick = () => shift(1)
get('ledger-today').onclick = () => { date.value = localDay(); get('ledger-view').value = 'day'; changeView() }
get('ledger-refresh').onclick = refresh
get('ledger-more').onclick = () => { rowLimit += 60; render() }
get('ledger-report').onclick = exportYear

const view = stored(localStorage, viewKey) || {}
for (const id of filters) if (typeof view[id] === 'string') get(id).value = view[id]
for (const [id, fallback] of [['ledger-view', 'day'], ['ledger-kind', 'all']]) if (!get(id).value) get(id).value = fallback
categoryChoice = view['ledger-category'] || ''
render()
const remembered = auth(localStorage)
const saved = auth(sessionStorage) || remembered
if (saved) await signIn(saved.value, saved.value === remembered?.value, true)
if (!owner) await refresh()
