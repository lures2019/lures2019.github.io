const colors = ['#17775f', '#edb764', '#6378ce', '#d97285', '#368cab', '#805ab1', '#9f6f48', '#7e8d54']
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char])

export function pieChart (entries, format = String) {
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  if (!total) return '<p class="report-empty">此范围暂无统计数据。</p>'
  let start = 0
  const point = angle => [100 + 77 * Math.sin(angle), 100 - 77 * Math.cos(angle)].join(' ')
  const arcs = []
  const legend = []
  for (const [index, [label, value]] of entries.entries()) {
    const color = colors[index % colors.length]
    const detail = `${label} · ${format(value)} · ${(value / total * 100).toFixed(1)}%`
    const title = escapeHTML(detail)
    if (value > 0) {
      const span = value / total * Math.PI * 2
      const attributes = `tabindex="0" role="img" aria-label="${title}" data-slice="${index}" data-detail="${title}" stroke="${color}"`
      arcs.push(value === total ? `<circle cx="100" cy="100" r="77" ${attributes}><title>${title}</title></circle>`
        : `<path d="M ${point(start)} A 77 77 0 ${span > Math.PI ? 1 : 0} 1 ${point(start + span)}" ${attributes}><title>${title}</title></path>`)
      start += span
    }
    legend.push(`<li><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${color}"/></svg><span>${escapeHTML(label)}</span><b>${escapeHTML(format(value))}</b></li>`)
  }
  return `<figure class="data-pie"><div class="pie-plot"><svg viewBox="0 0 200 200" aria-label="占比分布" fill="none" stroke-width="30">${arcs.join('')}</svg>
  <div class="pie-center" aria-hidden="true"><span>合计</span><strong>${escapeHTML(format(total))}</strong></div></div>
  <div class="pie-breakdown"><ul>${legend.join('')}</ul><p class="pie-detail" aria-live="polite">将鼠标移到图上或用 Tab 选择扇区查看占比。</p></div></figure>`
}

export function showPie (target, entries, format) {
  target.innerHTML = pieChart(entries, format)
  const output = target.querySelector('.pie-detail')
  for (const slice of target.querySelectorAll('[data-slice]')) {
    slice.onpointerenter = slice.onfocus = slice.onclick = () => {
      output.textContent = slice.dataset.detail
      target.querySelectorAll('[data-slice]').forEach(item => item.classList.toggle('is-active', item === slice))
    }
  }
}

export function metricsHTML (metrics) {
  return metrics.map(([label, value]) => `<p class="metric">${escapeHTML(label)}<strong>${escapeHTML(value)}</strong></p>`).join('')
}

export function downloadFile (blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function annualHTML ({ year, title, metrics, sections, footer }) {
  const nav = sections.map(([heading], index) => `<a href="#section-${index}">${escapeHTML(heading)}</a>`).join('')
  const content = sections.map(([heading, body], index) => `<section id="section-${index}"><h2>${escapeHTML(heading)}</h2>${body}</section>`).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHTML(year)} ${escapeHTML(title)}</title>
<style>
:root{color-scheme:dark;--ink:#eef6ff;--quiet:#a9bccf;--line:#34465f;--panel:#13243b}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;color:var(--ink);background:#091422;font:1rem/1.6 system-ui,sans-serif}
main{width:min(1050px,calc(100% - 28px));margin:clamp(14px,4vw,50px) auto}
header{background:radial-gradient(ellipse at 88% 0%,#44609d 0%,transparent 62%),radial-gradient(ellipse at 0% 100%,#236252 0%,transparent 65%),#122843;border:1px solid #49607c;border-radius:24px;padding:clamp(22px,5vw,64px)}
.year{margin:0;color:#bce9da;font:650 clamp(3rem,11vw,8.5rem)/.94 system-ui;letter-spacing:-.08em}
h1{font-size:clamp(1.55rem,4vw,3rem);margin:.45em 0 .8em}h2{margin-top:0}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:10px}
.metric{margin:0;padding:10px 13px;border:1px solid #7a96b354;border-radius:13px;background:#101c327d;color:#c7d6e8;font-size:.9rem}
.metric strong{display:block;margin-top:3px;color:#fff;font-size:clamp(1.05rem,2.2vw,1.6rem);overflow-wrap:anywhere}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}nav a{border:1px solid var(--line);border-radius:999px;padding:6px 12px;color:#bce9da;text-decoration:none}nav a:hover{background:var(--panel)}
section{padding:clamp(16px,3vw,32px);background:var(--panel);border:1px solid var(--line);border-radius:16px;margin-bottom:14px}
details{border-bottom:1px solid var(--line)}summary{cursor:pointer;padding:10px 2px;color:#d1e9f6}summary:hover{color:#8ae4bc}
table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:6px 5px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{color:#b4c7da}
meter{display:block;width:min(100%,130px);height:12px}
.data-pie{display:grid;grid-template-columns:minmax(120px,220px) minmax(0,1fr);align-items:center;gap:20px;margin:0}
.pie-plot{position:relative;width:min(100%,220px);margin:auto}.pie-plot>svg{display:block;width:100%;overflow:visible}
.pie-plot [data-slice]{cursor:pointer}.pie-plot [data-slice]:is(:hover,:focus,.is-active){stroke-width:38;outline:none}
.pie-center{position:absolute;inset:30%;display:grid;place-content:center;text-align:center;pointer-events:none;font-size:.8rem}
.pie-center strong{font-size:1rem}.pie-breakdown ul{list-style:none;margin:0;padding:0}.pie-breakdown li{display:grid;grid-template-columns:12px 1fr auto;gap:8px;padding:4px 0}
.pie-breakdown svg{width:12px;margin-top:.35em}.pie-detail,.report-empty,footer{color:var(--quiet);font-size:.9rem}footer{margin:20px 5px}
@media(max-width:520px){.data-pie{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><main><header><p class="year">${escapeHTML(year)}</p><h1>${escapeHTML(title)}</h1><div class="metrics">${metricsHTML(metrics)}</div></header>
<nav aria-label="回顾章节">${nav}</nav>${content}<footer>${escapeHTML(footer)}</footer></main>
<script>
function highlight(event) {
  const slice = event.target.closest('[data-slice]')
  if (!slice) return
  const chart = slice.closest('figure')
  chart.querySelector('.pie-detail').textContent = slice.dataset.detail
  chart.querySelectorAll('[data-slice]').forEach(item => item.classList.toggle('is-active', item === slice))
}
for (const event of ['pointerover', 'focusin', 'click']) document.addEventListener(event, highlight)
</script></body></html>`
}
