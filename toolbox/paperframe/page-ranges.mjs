import { previewPDF } from './pdf.mjs';

export function pageRanges({ element, change, notice, busy }) {
  const grid = element('page-grid');
  const from = element('page-from');
  const to = element('page-to');
  const saved = new Map();
  const groupSize = 24;
  let source;
  let mode;
  let offset = 0;
  let groups = [];
  let drag;
  let preview;

  function show(sourceItem, tool) {
    if (sourceItem === source && tool === mode) return;
    source = sourceItem;
    mode = tool;
    offset = 0;
    groups = source ? (saved.get(`${mode}:${source.key}`) ?? []) : [];
    from.value = to.value = 1;
    from.max = to.max = source?.pages ?? 1;
    render();
  }

  function drawSelection() {
    const low = Math.min(from.valueAsNumber, to.valueAsNumber);
    const high = Math.max(from.valueAsNumber, to.valueAsNumber);
    for (const tile of grid.children) {
      const page = Number(tile.dataset.page);
      tile.setAttribute('aria-pressed', String(page >= low && page <= high));
      tile.classList.toggle('grouped', groups.some(([start,end]) => page >= start && page <= end));
    }
  }

  function listGroups() {
    element('ranges').replaceChildren(...groups.map(([start,end], index) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${mode === 'split' ? `分组 ${index + 1} · ` : ''}${start === end ? `第 ${start} 页` : `第 ${start}–${end} 页`}`;
      const remove = document.createElement('button');
      remove.className = 'button plain icon-button';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `移除第 ${index + 1} 个范围`);
      remove.addEventListener('click', () => {
        groups.splice(index,1);
        listGroups();
        drawSelection();
        change();
      });
      item.append(label, remove);
      return item;
    }));
    const count = groups.reduce((total,[start,end]) => total + end - start + 1, 0);
    element('page-summary').textContent = !source ? '先选择一份 PDF。' : mode === 'split'
      ? (groups.length ? `${groups.length} 组 · 导出 ${count} 页，未选页将略过。` : '每个分组生成一份 PDF。')
      : (groups.length ? `将删除 ${count} 页，保留 ${source.pages - count} 页。` : '添加要删除的页码，导出保留页面。');
  }

  function render() {
    preview?.abort();
    preview = new AbortController();
    grid.replaceChildren();
    element('page-editor').hidden = !source;
    element('add-range').disabled = !source;
    from.disabled = to.disabled = !source;
    listGroups();
    if (!source) return;
    const end = Math.min(source.pages, offset + groupSize);
    element('preview-range').textContent = `${offset + 1}–${end} / ${source.pages} 页`;
    element('previous-pages').disabled = offset === 0;
    element('next-pages').disabled = end === source.pages;
    const tiles = new Map();
    for (let page = offset + 1; page <= end; page++) {
      const tile = document.createElement('button');
      tile.className = 'page-tile';
      tile.type = 'button';
      tile.dataset.page = page;
      tile.textContent = `第 ${page} 页`;
      tile.addEventListener('click', (event) => {
        if (busy() || drag) return;
        if (!event.shiftKey) from.value = page;
        to.value = page;
        drawSelection();
      });
      tiles.set(page,tile);
      grid.append(tile);
    }
    drawSelection();
    void previewPDF(source.file, preview.signal, tiles).catch(() => {});
  }

  function dragTo(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const tile = document.elementFromPoint(event.clientX, event.clientY)?.closest('.page-tile');
    if (!tile || !grid.contains(tile)) return;
    const page = Number(tile.dataset.page);
    from.value = Math.min(drag.start, page);
    to.value = Math.max(drag.start, page);
    drawSelection();
  }

  grid.addEventListener('pointerdown', (event) => {
    const tile = event.target.closest('.page-tile');
    if (!tile || event.button !== 0 || event.pointerType === 'touch' || event.shiftKey || busy()) return;
    event.preventDefault();
    tile.focus();
    drag = { pointer: event.pointerId, start: Number(tile.dataset.page) };
    grid.setPointerCapture(event.pointerId);
    dragTo(event);
  });
  grid.addEventListener('pointermove', dragTo);
  grid.addEventListener('pointerup', (event) => { dragTo(event); drag = null; });
  grid.addEventListener('lostpointercapture', () => { drag = null; });
  from.addEventListener('input', drawSelection);
  to.addEventListener('input', drawSelection);
  element('previous-pages').addEventListener('click', () => { if (!busy()) { offset -= groupSize; render(); } });
  element('next-pages').addEventListener('click', () => { if (!busy()) { offset += groupSize; render(); } });
  element('add-range').addEventListener('click', () => {
    if (!source || !from.reportValidity() || !to.reportValidity()) return;
    const start = Math.min(from.valueAsNumber, to.valueAsNumber);
    const end = Math.max(from.valueAsNumber, to.valueAsNumber);
    if (groups.some(([a,b]) => a <= end && b >= start)) {
      notice('该范围与已添加的页面重叠。');
      return;
    }
    if (mode === 'delete' && groups.reduce((count,[a,b]) => count + b - a + 1, end - start + 1) >= source.pages) {
      notice('删除后至少要保留一页。');
      return;
    }
    groups.push([start,end]);
    saved.set(`${mode}:${source.key}`, groups);
    listGroups();
    drawSelection();
    notice('');
    change();
  });
  return { show, groups: () => groups.map((range) => [...range]) };
}
