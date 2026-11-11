function nodePath (page, node) {
  const path = []
  while (node !== page) {
    const parent = node.parentNode
    if (!parent) return null
    path.unshift([...parent.childNodes].indexOf(node))
    node = parent
  }
  return path
}

function positions (page, range) {
  if (!range || !page.contains(range.commonAncestorContainer)) return null
  return [range.startContainer, range.endContainer].map((node, index) => ({
    path: nodePath(page, node), offset: index ? range.endOffset : range.startOffset
  }))
}

export function historyState (page, range, font, files) {
  const clone = page.cloneNode(true)
  for (const chip of clone.querySelectorAll('[data-inline-media]')) {
    chip.textContent = chip.dataset.alt || chip.textContent
    chip.removeAttribute('contenteditable')
    chip.classList.remove('vault-inline-image', 'vault-media-selected')
    if (!chip.className) chip.removeAttribute('class')
  }
  for (const chip of clone.querySelectorAll('[data-math]')) chip.textContent = chip.dataset.math
  for (const pre of clone.querySelectorAll('[data-rendered-code]')) {
    pre.removeAttribute('data-rendered-code')
    const code = pre.querySelector('code')
    if (code) code.textContent = code.textContent
  }
  for (const cell of clone.querySelectorAll('[data-vault-table-selected]')) cell.removeAttribute('data-vault-table-selected')
  return { html: clone.innerHTML, positions: positions(page, range), font, files: files.slice() }
}

export function setHistorySelection (page, positions) {
  const selection = window.getSelection()
  page.focus()
  const range = document.createRange()
  range.selectNodeContents(page)
  range.collapse(false)
  if (positions) {
    const resolve = ({ path, offset }) => {
      let node = page
      for (const index of path) {
        if (!node.childNodes[index]) break
        node = node.childNodes[index]
      }
      return [node, Math.min(offset, node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length)]
    }
    range.setStart(...resolve(positions[0]))
    range.setEnd(...resolve(positions[1]))
  }
  selection.removeAllRanges()
  selection.addRange(range)
  return range.cloneRange()
}

export function sameHistoryState (a, b) {
  return a.html === b.html && a.font === b.font && a.files.length === b.files.length &&
    a.files.every((file, index) => file === b.files[index])
}
