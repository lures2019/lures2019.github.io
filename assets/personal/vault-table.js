export const tableLimits = { rows: 60, columns: 24 }

export function tableGrid (table) {
  const rows = [...table.rows]
  const slots = rows.map(() => [])
  const cells = []
  for (const [y, row] of rows.entries()) {
    let x = 0
    for (const cell of row.cells) {
      while (slots[y][x]) x++
      const sectionRows = rows.slice(y).filter(item => item.parentNode === row.parentNode).length
      const h = Math.min(cell.rowSpan || sectionRows, sectionRows)
      const w = cell.colSpan
      if (x + w > tableLimits.columns || rows.length > tableLimits.rows) throw new Error('此表格超出编辑尺寸。')
      const entry = { cell, x, y, w, h }
      cells.push(entry)
      for (let rowIndex = y; rowIndex < y + h; rowIndex++) {
        for (let col = x; col < x + w; col++) slots[rowIndex][col] = entry
      }
      x += w
    }
  }
  return { table, cells, slots, rows: rows.length, columns: Math.max(0, ...slots.map(row => row.length)) }
}

export function columnWidths (grid, measured = false) {
  const cols = [...grid.table.querySelectorAll(':scope > colgroup > col')]
  if (cols.length === grid.columns) {
    const widths = cols.map(col => parseFloat(col.style.width))
    if (widths.every(width => width > 0)) return widths
  }
  if (!measured) return Array(grid.columns).fill(100 / grid.columns)
  const box = grid.table.getBoundingClientRect()
  if (!box.width) return Array(grid.columns).fill(100 / grid.columns)
  const edges = [0]
  for (const { cell, x, w } of grid.cells) {
    const rect = cell.getBoundingClientRect()
    edges[x] = (rect.left - box.left) / box.width * 100
    edges[x + w] = (rect.right - box.left) / box.width * 100
  }
  edges[0] = 0
  edges[grid.columns] = 100
  for (let left = 0, right = 1; right <= grid.columns; right++) {
    if (!Number.isFinite(edges[right])) continue
    for (let i = left + 1; i < right; i++) edges[i] = edges[left] + (edges[right] - edges[left]) * (i - left) / (right - left)
    left = right
  }
  return edges.slice(1).map((edge, i) => Math.max(.1, edge - edges[i]))
}

export function setColumnWidths (table, widths) {
  const group = document.createElement('colgroup')
  const total = widths.reduce((sum, width) => sum + width, 0)
  for (const width of widths) {
    const col = document.createElement('col')
    col.style.width = (width / total * 100).toFixed(4) + '%'
    group.append(col)
  }
  for (const previous of table.querySelectorAll(':scope > colgroup')) previous.remove()
  const caption = table.caption
  if (caption) caption.after(group)
  else table.prepend(group)
}

function span (cell, name, value) {
  if (value > 1) cell.setAttribute(name, value)
  else cell.removeAttribute(name)
}

function emptyCell (tag) {
  const cell = document.createElement(tag)
  cell.append(document.createElement('br'))
  return cell
}

function rebuild (grid) {
  const rows = Array.from({ length: grid.rows }, () => document.createElement('tr'))
  const filled = rows.map(() => [])
  for (const entry of grid.cells) {
    for (let y = entry.y; y < entry.y + entry.h; y++) {
      for (let x = entry.x; x < entry.x + entry.w; x++) filled[y][x] = true
    }
  }
  const headed = grid.cells.some(entry => entry.y === 0 && entry.cell.localName === 'th')
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.columns; x++) {
      if (!filled[y][x]) grid.cells.push({ cell: emptyCell(y === 0 && headed ? 'th' : 'td'), x, y, w: 1, h: 1 })
    }
  }
  for (const { cell, x, y, w, h } of grid.cells.sort((a, b) => a.y - b.y || a.x - b.x)) {
    span(cell, 'colspan', w)
    span(cell, 'rowspan', h)
    rows[y].append(cell)
  }
  for (const section of [...grid.table.children]) if (section.matches('thead,tbody,tfoot,tr')) section.remove()
  grid.table.createTBody().append(...rows)
}

export function cellsInRange (grid, start, end) {
  const a = grid.cells.find(entry => entry.cell === start)
  const b = grid.cells.find(entry => entry.cell === end)
  if (!a || !b) throw new Error('请在同一个表格中选择单元格。')
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  const entries = grid.cells.filter(cell => cell.x < right && cell.x + cell.w > x && cell.y < bottom && cell.y + cell.h > y)
  if (entries.some(cell => cell.x < x || cell.y < y || cell.x + cell.w > right || cell.y + cell.h > bottom)) {
    throw new Error('选择范围穿过已有合并单元格，请选中整个合并区域。')
  }
  return { x, y, w: right - x, h: bottom - y, entries }
}

export function mergeCells (grid, start, end) {
  const { x, y, w, h, entries } = cellsInRange(grid, start, end)
  if (entries.length < 2) throw new Error('请先选中两个或更多单元格。')
  const first = entries.find(entry => entry.x === x && entry.y === y)
  if (!first) throw new Error('请先补齐表格中的空缺。')
  for (const entry of entries) {
    if (entry === first || !entry.cell.textContent.trim() && !entry.cell.querySelector('[data-inline-media],[data-math],table,pre')) continue
    const block = document.createElement('div')
    block.append(...entry.cell.childNodes)
    first.cell.append(block)
  }
  first.w = w
  first.h = h
  grid.cells = grid.cells.filter(entry => entry === first || !entries.includes(entry))
  rebuild(grid)
  return first.cell
}

export function changeTable (grid, cell, action) {
  const entry = grid.cells.find(item => item.cell === cell)
  if (!entry) return
  const column = action.includes('Column')
  const [start, size, count] = column ? ['x', 'w', 'columns'] : ['y', 'h', 'rows']
  const add = action.startsWith('insert')
  const at = entry[start] + (action.endsWith('After') ? entry[size] : 0)
  if (add && grid[count] >= tableLimits[count]) throw new Error('表格已达到行列上限。')
  if (!add && grid[count] === 1) { grid.table.remove(); return }
  const widths = column ? columnWidths(grid) : null
  if (add) {
    for (const item of grid.cells) {
      if (item[start] >= at) item[start]++
      else if (item[start] + item[size] > at) item[size]++
    }
    grid[count]++
    if (widths) widths.splice(at, 0, 100 / grid.columns)
  } else {
    grid.cells = grid.cells.filter(item => {
      if (item[start] > at) item[start]--
      else if (item[start] + item[size] > at) item[size]--
      return item[size] > 0
    })
    grid[count]--
    if (widths) widths.splice(at, 1)
  }
  rebuild(grid)
  if (widths) setColumnWidths(grid.table, widths)
  return grid.slots.length && tableGrid(grid.table).slots[Math.min(entry.y, grid.rows - 1)]?.[Math.min(entry.x, grid.columns - 1)]?.cell
}

export function splitCell (grid, cell, rows, columns) {
  const entry = grid.cells.find(item => item.cell === cell)
  if (!entry || rows === 1 && columns === 1) return cell
  const widths = columnWidths(grid)
  const extra = (span, divisions) => (divisions - span % divisions) % divisions
  const extraRows = extra(entry.h, rows)
  const extraColumns = extra(entry.w, columns)
  if (grid.rows + extraRows > tableLimits.rows || grid.columns + extraColumns > tableLimits.columns) throw new Error('拆分后将超过表格行列上限。')
  const expand = (start, size, count, amount) => {
    const edge = entry[start] + entry[size]
    for (const item of grid.cells) {
      if (item[start] >= edge) item[start] += amount
      else if (item[start] + item[size] >= edge) item[size] += amount
    }
    grid[count] += amount
  }
  if (extraColumns) {
    const last = entry.x + entry.w - 1
    const portion = widths[last] / (extraColumns + 1)
    widths.splice(last, 1, ...Array(extraColumns + 1).fill(portion))
    expand('x', 'w', 'columns', extraColumns)
  }
  if (extraRows) expand('y', 'h', 'rows', extraRows)
  grid.cells = grid.cells.filter(item => item !== entry)
  const w = entry.w / columns
  const h = entry.h / rows
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      grid.cells.push({ x: entry.x + col * w, y: entry.y + row * h, w, h, cell: row || col ? emptyCell(cell.localName) : cell })
    }
  }
  rebuild(grid)
  if (extraColumns) setColumnWidths(grid.table, widths)
  return cell
}
