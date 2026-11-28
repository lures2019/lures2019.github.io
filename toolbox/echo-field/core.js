export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char])
export const normalized = value => String(value ?? '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim()
export const clock = value => !Number.isFinite(value) || value < 0 ? '0:00' : Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0')
export const safeLink = value => {
  try { const url = new URL(value); return url.protocol === 'https:' ? escape(url.href) : '' } catch { return '' }
}
export function localDay(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((v, i) => String(v).padStart(i ? 2 : 4, '0')).join('-')
}
export function dayOffset(offset, now = new Date()) {
  const date = new Date(now)
  date.setDate(date.getDate() + offset)
  return localDay(date)
}
const stamp = value => value.replace(',', '.').split(':').reduce((sum, n) => sum * 60 + Number(n), 0)
export function parseTimed(input, lang) {
  const lines = input.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
  const cues = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})/)
    if (!match) continue
    const start = stamp(match[1])
    const end = stamp(match[2])
    if (end <= start) continue
    const text = []
    while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].includes(' --> ')) {
      const next = lines[++i].replace(/<[^>]*>/g, '').trim()
      if (next) text.push(next.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, value => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&nbsp;':' ','&#39;':"'"})[value]))
    }
    const en = lang === 'zh' ? '' : text.filter(line => lang === 'en' || /[a-z]/i.test(line) && !/[\u3400-\u9fff]/.test(line)).join(' ')
    const zh = lang === 'en' ? '' : text.filter(line => lang === 'zh' || /[\u3400-\u9fff]/.test(line)).join(' ')
    if (en || zh) cues.push({start, end, en, zh})
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}
export function pairTimed(en, zh) {
  if (!en.length || !zh.length) return en.length ? en : zh
  let first = 0
  return en.map(cue => {
    while (first < zh.length && zh[first].end <= cue.start) first++
    const matched = []
    for (let i = first; i < zh.length && zh[i].start < cue.end; i++) {
      if (Math.min(cue.end, zh[i].end) - Math.max(cue.start, zh[i].start) >= .05) matched.push(zh[i].zh)
    }
    return {...cue, zh: matched.join(' ') || cue.zh}
  })
}
export function wordScore(expected, spoken) {
  const a = normalized(expected).split(' ').filter(Boolean)
  const b = normalized(spoken).split(' ').filter(Boolean)
  if (!a.length) return 0
  let row = Array.from({length:b.length + 1}, (_, i) => i)
  a.forEach((word, i) => {
    const next = [i + 1]
    b.forEach((answer, j) => { next[j + 1] = Math.min(row[j + 1] + 1, next[j] + 1, row[j] + Number(word !== answer)) })
    row = next
  })
  return Math.max(0, Math.round(100 * (1 - row[b.length] / a.length)))
}
