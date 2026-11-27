export const $ = id => document.getElementById(id)

const shapes = {
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  'camera-off': '<path d="m16 10 5-3v10l-3-2M3 3l18 18M3 8v9a2 2 0 0 0 2 2h10M8 5h6a2 2 0 0 1 2 2v2"/>',
  play: '<path d="m8 5 12 7-12 7z"/>',
  key: '<circle cx="8" cy="9" r="4"/><path d="m11 12 9 9m-2-2 2-2m-5 0 2-2"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  expand: '<path d="M14 4h6v6m0-6-6 6m-4 10H4v-6m0 6 6-6"/>',
  cursor: '<path d="m5 3 15 9-7 1.5L9 20 5 3Z"/>',
  pen: '<path d="m3 17 13-13a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L7 21H3zm10-10 4 4"/>',
  link: '<path d="m9 15 6-6m-5-1 3-3a4 4 0 0 1 6 6l-3 3m-2 2-3 3a4 4 0 0 1-6-6l3-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  eraser: '<path d="m4 12 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3L12 20H8l-4-4a3 3 0 0 1 0-4Zm5-5 9 9m-6 4h9"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m2-6a4 4 0 0 1 4 4v2m-5-16a3 3 0 0 1 0 6"/>',
  chat: '<path d="M4 5h16v12H9l-5 4zM8 9h8m-8 4h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  send: '<path d="m3 4 18 8-18 8 3-8-3-8Zm3 8h15"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6"/>',
  'mic-off': '<path d="M9 6V5a3 3 0 0 1 6 0v6m-6 0v1a3 3 0 0 0 4 3m-8-5v2a7 7 0 0 0 12 5m2-5v-2m-7 9v3m-3 0h6M3 3l18 18"/>',
  leave: '<path d="M10 4H5v16h5m4-12 4 4-4 4m-5-4h10"/>',
  x: '<path d="m6 6 12 12m0-12L6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2"/>'
}

export function icon(name) {
  const node = document.createElement('i')
  setIcon(node, name)
  return node
}

export function setIcon(node, name) {
  node.dataset.i = name
  node.setAttribute('aria-hidden', 'true')
  node.innerHTML = `<svg class="icon" viewBox="0 0 24 24">${shapes[name] ?? ''}</svg>`
}

export function element(tag, className, content) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

export function avatar(node, person) {
  node.dataset.tone = person.tone
  const validImage = typeof person.avatar === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(person.avatar)
  if (validImage) {
    const image = new Image()
    image.alt = ''
    image.src = person.avatar
    node.replaceChildren(image)
  } else {
    node.replaceChildren(person.name?.trim() ? Array.from(person.name.trim())[0].toUpperCase() : icon('user'))
  }
}

export function formatCode(code) {
  return code.match(/.{1,4}/g)?.join('-') ?? ''
}

let toastTimer
export function toast(message) {
  clearTimeout(toastTimer)
  const node = $('toast')
  node.textContent = message
  node.hidden = false
  toastTimer = setTimeout(() => { node.hidden = true }, 3200)
}
