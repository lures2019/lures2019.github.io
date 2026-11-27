import { $, element } from './ui.js'

const COLORS = ['#41288d', '#196e60', '#ca5063', '#21529a', '#ae5b1e', '#181c2f', '#ffffff']
const LABELS = ['紫色', '绿色', '红色', '蓝色', '橙色', '黑色']

export function makeBoard(send) {
  const canvas = $('canvas')
  const ctx = canvas.getContext('2d')
  let color = 0
  let drawing

  function colorChoice(index) {
    color = index
    for (const [i, button] of [...$('palette').children].entries()) button.setAttribute('aria-pressed', String(i === color))
    $('eraser').setAttribute('aria-pressed', String(color === 6))
  }

  function draw({ color, width, points }) {
    const x = p => p[0] * canvas.width / 10000
    const y = p => p[1] * canvas.height / 10000
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.beginPath()
    if (points.length === 1) {
      ctx.arc(x(points[0]), y(points[0]), width / 2, 0, 2 * Math.PI)
      ctx.fill()
      return
    }
    ctx.moveTo(x(points[0]), y(points[0]))
    for (const p of points.slice(1)) ctx.lineTo(x(p), y(p))
    ctx.stroke()
  }

  function reset(strokes = []) {
    drawing = undefined
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (const stroke of strokes) draw(stroke)
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
      .map(value => Math.round(Math.max(0, Math.min(1, value)) * 10000))
  }

  function flush() {
    if (!drawing?.dirty) return
    const { color, width, points } = drawing
    send({ type: 'stroke', stroke: { color, width, points: points.slice() } })
    drawing.points = [points.at(-1)]
    drawing.dirty = false
    drawing.last = performance.now()
  }

  canvas.addEventListener('pointerdown', event => {
    if (drawing || event.button !== 0 || canvas.dataset.full === 'true') return
    canvas.setPointerCapture(event.pointerId)
    const points = [point(event)]
    drawing = {
      id: event.pointerId, color: COLORS[color], width: color === 6 ? 18 : Number($('brush-width').value),
      points, last: performance.now(), dirty: true
    }
    draw(drawing)
  })
  canvas.addEventListener('pointermove', event => {
    if (drawing?.id !== event.pointerId) return
    const next = point(event)
    const previous = drawing.points.at(-1)
    if (Math.hypot(next[0] - previous[0], next[1] - previous[1]) < 13) return
    drawing.points.push(next)
    drawing.dirty = true
    draw({ ...drawing, points: [previous, next] })
    if (drawing.points.length >= 64 || performance.now() - drawing.last > 175) flush()
  })
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
      if (drawing?.id !== event.pointerId) return
      flush()
      drawing = undefined
    })
  }
  LABELS.forEach((label, index) => {
    const button = element('button', 'swatch')
    button.type = 'button'
    button.dataset.color = index
    button.setAttribute('aria-label', label)
    button.addEventListener('click', () => colorChoice(index))
    $('palette').append(button)
  })
  $('eraser').addEventListener('click', () => colorChoice(color === 6 ? 0 : 6))
  $('clear-board').addEventListener('click', () => {
    if (window.confirm('清空所有人的白板内容？')) send({ type: 'clear' })
  })
  $('download-board').addEventListener('click', () => canvas.toBlob(blob => {
    if (!blob) return
    const anchor = document.createElement('a')
    const url = URL.createObjectURL(blob)
    anchor.href = url
    anchor.download = '松间白板.png'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }, 'image/png'))
  colorChoice(0)
  reset()
  return { draw, reset }
}
