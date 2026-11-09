export const repeatLabels = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年'
}

export const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const maxFocusMs = 86_400_000
const dayLength = 86_400_000
const shanghai = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
})
const timestamp = day => Date.parse(day + 'T00:00:00Z')

export function localDay (date = new Date()) {
  const parts = Object.fromEntries(shanghai.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function validDay (value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9998-12-31') return false
  const date = timestamp(value)
  return Number.isFinite(date) && new Date(date).toISOString().startsWith(value)
}

export function addDays (day, count) {
  return new Date(timestamp(day) + count * dayLength).toISOString().slice(0, 10)
}

export function period (day, view) {
  if (view === 'week') {
    const weekday = new Date(timestamp(day)).getUTCDay()
    const start = addDays(day, -((weekday + 6) % 7))
    const end = addDays(start, 6)
    return { start, end, label: start + ' 至 ' + end }
  }
  if (view === 'month') {
    const label = day.slice(0, 7)
    const [year, month] = label.split('-').map(Number)
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return { start: label + '-01', end: label + '-' + last, label }
  }
  if (view === 'year') {
    const label = day.slice(0, 4)
    return { start: label + '-01-01', end: label + '-12-31', label }
  }
  return { start: day, end: day, label: day }
}

export function dueOn (task, day) {
  if (day < task.date || (task.endDate && day > task.endDate)) return false
  if (task.repeat === 'none') return day === task.date
  if (task.repeat === 'daily') return true
  if (task.repeat === 'weekly') return (timestamp(day) - timestamp(task.date)) % (7 * dayLength) === 0

  const [year, month, date] = day.split('-').map(Number)
  if (task.repeat === 'yearly' && month !== Number(task.date.slice(5, 7))) return false
  const target = Math.min(Number(task.date.slice(8)), new Date(Date.UTC(year, month, 0)).getUTCDate())
  return date === target
}

export function * occurrenceDays (task, start, end) {
  if (task.repeat === 'none') {
    if (task.date >= start && task.date <= end) yield task.date
    return
  }
  const first = task.date > start ? task.date : start
  const last = task.endDate && task.endDate < end ? task.endDate : end
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (dueOn(task, day)) yield day
  }
}

export function completionAt (task, day) {
  return task.repeat === 'none' ? task.completedAt : task.completions[day] || null
}

export function studyDays (segments) {
  const days = {}
  for (const [start, end] of segments) {
    let cursor = start
    while (cursor < end) {
      const day = localDay(new Date(cursor))
      const midnight = Date.parse(addDays(day, 1) + 'T00:00:00+08:00')
      const stop = Math.min(end, midnight)
      days[day] = (days[day] || 0) + stop - cursor
      cursor = stop
    }
  }
  return days
}

export function formatFocus (ms) {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  if (hours) return hours + ' 小时' + (minutes ? ' ' + minutes + ' 分钟' : '')
  return minutes ? minutes + ' 分钟' : seconds + ' 秒'
}

export function focusFor (task, day) {
  return task.focusSessions.filter(session => session.day === day)
    .reduce((total, session) => total + Object.values(session.days).reduce((sum, ms) => sum + ms, 0), 0)
}

export function focusStats (tasks, start = '1900-01-01', end = '9998-12-31') {
  let total = 0
  const active = new Set()
  const ranking = new Map()
  for (const task of tasks) {
    let duration = 0
    for (const session of task.focusSessions) {
      for (const [day, ms] of Object.entries(session.days)) {
        if (day < start || day > end) continue
        active.add(day)
        duration += ms
      }
    }
    if (duration) {
      total += duration
      ranking.set(task.title, (ranking.get(task.title) || 0) + duration)
    }
  }
  const top = [...ranking].map(([title, duration]) => ({ title, duration }))
    .sort((a, b) => b.duration - a.duration || a.title.localeCompare(b.title, 'zh-CN')).slice(0, 10)
  return { total, active: active.size, average: active.size ? total / active.size : 0, top }
}

function validTime (value) {
  if (typeof value !== 'string') return false
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value
}

export function normalizeTasks (data) {
  if (!Array.isArray(data)) throw new Error('待办文件格式不正确。')
  const ids = new Set()
  const sessionIds = new Set()
  return data.map(task => {
    if (!task || typeof task !== 'object') throw new Error('待办记录格式不正确。')
    const { id, title, note, date, completedAt = null, repeat = 'none', endDate = null, completions = {}, focusSessions = [] } = task
    if (typeof id !== 'string' || !idPattern.test(id) || ids.has(id) ||
        typeof title !== 'string' || !title.trim() || title.length > 160 ||
        typeof note !== 'string' || note.length > 2000 || !validDay(date) ||
        typeof repeat !== 'string' || !Object.hasOwn(repeatLabels, repeat) ||
        (endDate !== null && (!validDay(endDate) || endDate < date || repeat === 'none')) ||
        (completedAt !== null && (!validTime(completedAt) || repeat !== 'none')) ||
        !completions || typeof completions !== 'object' || Array.isArray(completions) || !Array.isArray(focusSessions)) {
      throw new Error('待办记录格式不正确。')
    }
    const schedule = { date, repeat, endDate }
    const done = Object.entries(completions)
    if ((repeat === 'none' && done.length) ||
        done.some(([day, at]) => !validDay(day) || !dueOn(schedule, day) || !validTime(at))) {
      throw new Error('重复任务的完成日期或时间不正确。')
    }
    const focus = focusSessions.map(session => {
      if (!session || typeof session.id !== 'string' || !idPattern.test(session.id) || sessionIds.has(session.id) ||
          !validDay(session.day) || !dueOn(schedule, session.day) || !session.days ||
          typeof session.days !== 'object' || Array.isArray(session.days)) {
        throw new Error('番茄钟时长记录格式不正确。')
      }
      const days = Object.entries(session.days)
      const duration = days.reduce((sum, [, ms]) => sum + ms, 0)
      if (days.some(([day, ms]) => !validDay(day) || !Number.isSafeInteger(ms) || ms < 1) ||
          duration < 1000 || duration > maxFocusMs) {
        throw new Error('番茄钟时长记录格式不正确。')
      }
      sessionIds.add(session.id)
      return { id: session.id, day: session.day, days: Object.fromEntries(days) }
    })
    ids.add(id)
    return { id, title, note, date, repeat, endDate, completedAt, completions: Object.fromEntries(done), focusSessions: focus }
  })
}

export function reportYear (tasks, year) {
  const months = Array.from({ length: 12 }, () => ({ scheduled: 0, completed: 0 }))
  const { start, end } = period(year + '-01-01', 'year')
  let scheduled = 0
  let completed = 0
  let finishedPlans = 0
  const activeDays = new Set()
  for (const task of tasks) {
    for (const day of occurrenceDays(task, start, end)) {
      scheduled++
      months[Number(day.slice(5, 7)) - 1].scheduled++
      const done = completionAt(task, day)
      if (done && localDay(new Date(done)) <= end) finishedPlans++
    }
    for (const at of task.repeat === 'none' ? [task.completedAt] : Object.values(task.completions)) {
      if (!at) continue
      const day = localDay(new Date(at))
      if (day < start || day > end) continue
      completed++
      activeDays.add(day)
      months[Number(day.slice(5, 7)) - 1].completed++
    }
  }
  return { months, scheduled, completed, activeDays: activeDays.size,
    rate: scheduled ? Math.round(finishedPlans / scheduled * 100) + '%' : '—' }
}
