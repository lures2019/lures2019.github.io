import { idPattern, validDay } from './todo-model.js?v=4'

export const dayparts = { morning: '早上', midday: '中午', evening: '晚上', other: '其他' }
export const directions = { expense: '支出', income: '收入' }
const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })
export const money = cents => formatter.format(cents / 100)
const maxCents = 99_999_999_999

export function parseAmount (value) {
  const match = /^([0-9]{1,9})(?:\.([0-9]{1,2}))?$/.exec(value.trim())
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : 0
}

export function normalizeEntries (values) {
  if (!Array.isArray(values)) throw new Error('记账文件格式无效。')
  const ids = new Set()
  return values.map(entry => {
    const { id, date, daypart, direction, cents, title, category, note } = entry || {}
    if (typeof id !== 'string' || !idPattern.test(id) || ids.has(id) || !validDay(date) ||
      !Object.hasOwn(dayparts, daypart) || !Object.hasOwn(directions, direction) ||
      !Number.isSafeInteger(cents) || cents < 1 || cents > maxCents ||
      typeof title !== 'string' || !title.trim() || title.length > 100 ||
      typeof category !== 'string' || !category.trim() || category.length > 60 ||
      typeof note !== 'string' || note.length > 240) throw new Error('记账条目的日期、分类或金额无效。')
    ids.add(id)
    return { id, date, daypart, direction, cents, title: title.trim(), category: category.trim(), note: note.trim() }
  })
}

export function summarize (entries) {
  let income = 0
  let expense = 0
  const dates = new Set()
  const groups = { income: new Map(), expense: new Map() }
  const parts = Object.fromEntries(Object.keys(dayparts).map(key => [key, 0]))
  for (const entry of entries) {
    dates.add(entry.date)
    if (entry.direction === 'income') income += entry.cents
    else { expense += entry.cents; parts[entry.daypart] += entry.cents }
    const categories = groups[entry.direction]
    categories.set(entry.category, (categories.get(entry.category) || 0) + entry.cents)
  }
  const sorted = map => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
  return { income, expense, net: income - expense, days: dates.size, parts,
    incomes: sorted(groups.income), expenses: sorted(groups.expense), count: entries.length }
}
