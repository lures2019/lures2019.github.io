import {escape as e, normalized, clock, wordTokens} from './core.js?v=1.3.0'

const colors = new Set(['gold','sage'])

export function highlightedVocabulary(rows, marks) {
  const words = new Map()
  for (const {index,cue} of rows) {
    const painted = marks[index] || {}
    for (const token of wordTokens(cue.en)) {
      if (!token.word || !colors.has(painted[token.start])) continue
      const key = normalized(token.text)
      if (!words.has(key)) words.set(key,{term:token.text,color:painted[token.start],cue})
    }
  }
  return [...words.values()]
}

function renderedEnglish(cue, painted) {
  return wordTokens(cue.en).map(token => {
    const color = painted[token.start]
    return token.word && colors.has(color) ? '<mark class="print-word-'+color+'">'+e(token.text)+'</mark>' : e(token.text)
  }).join('')
}

export function transcriptHtml({item, rows, marks, words, language, timestamps}) {
  const title = item.zh || item.title
  const label = {both:'中英对照',en:'英文原文',zh:'中文译文'}[language]
  const byline = [item.zh ? item.title : '',item.source,item.date].filter(Boolean).join(' · ')
  const printed = rows.map(({index,cue}) => {
    const english = language !== 'zh' && cue.en ? renderedEnglish(cue,marks[index] || {}) : ''
    const translation = language !== 'en' ? cue.zh || '暂无中文字幕' : ''
    return '<article class="transcript-print-cue'+(timestamps?' with-time':'')+'">' +
      (timestamps ? '<time>'+clock(cue.start)+'</time>' : '') +
      '<div>' + (english ? '<p class="transcript-print-en" lang="en">'+english+'</p>' : '') +
      (translation ? '<p class="transcript-print-zh'+(!cue.zh?' missing':'')+'">'+e(translation)+'</p>' : '') + '</div></article>'
  }).join('')
  const vocabulary = words.length ? '<section class="transcript-print-vocab"><h2>高亮词汇</h2>' +
    '<table class="print-table"><thead><tr><th style="width:19%">词汇</th><th style="width:27%">中文释义</th><th>听力原句</th></tr></thead><tbody>' +
    words.map(word => '<tr><td lang="en"><mark class="print-word-'+word.color+'">'+e(word.term)+'</mark></td>' +
      '<td>'+e(word.meaning || '—')+'</td><td><p class="transcript-word-example" lang="en">'+e(word.cue.en)+'</p>' +
      (language !== 'en' && word.cue.zh ? '<p class="transcript-example-zh">'+e(word.cue.zh)+'</p>' : '') + '</td></tr>').join('') +
    '</tbody></table></section>' : ''
  return '<header class="print-header transcript-print-head"><p>回声岛 · 听力原文</p><h1>'+e(title)+'</h1>' +
    (byline ? '<p class="transcript-print-byline">'+e(byline)+'</p>' : '') +
    '<p>'+label+' · '+rows.length+' 句'+(words.length?' · '+words.length+' 个高亮词':'')+'</p></header>'+
    '<section class="transcript-print-lines" aria-label="听力原文">'+printed+'</section>'+vocabulary
}

export function transcriptText({item, rows, marks, words, language, timestamps}) {
  const title = item.zh || item.title
  const text = [title,[item.zh ? item.title : '',item.source,item.date].filter(Boolean).join(' · '),'']
  for (const {index,cue} of rows) {
    const prefix = timestamps ? '['+clock(cue.start)+'] ' : ''
    const painted = marks[index] || {}
    const english = language === 'zh' ? '' : wordTokens(cue.en).map(token => token.word && colors.has(painted[token.start]) ? '['+token.text+']' : token.text).join('')
    if (english) text.push(prefix+english)
    if (language !== 'en') text.push((english ? '' : prefix)+(cue.zh || '暂无中文字幕'))
    text.push('')
  }
  if (words.length) {
    text.push('高亮词汇','')
    for (const word of words) {
      text.push(word.term+(word.meaning?'  '+word.meaning:''),word.cue.en)
      if (language !== 'en' && word.cue.zh) text.push(word.cue.zh)
      text.push('')
    }
  }
  return text.join('\r\n')
}
