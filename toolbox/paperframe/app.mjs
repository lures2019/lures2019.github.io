import { inspectPDF, convertPDF, pdfError, editPDF } from './pdf.mjs';
import { archivePDFs, makeDestination, safeTitle } from './outputs.mjs';
import { pageRanges } from './page-ranges.mjs';
import { runWorker } from './pdf-operations.mjs';

const $ = (id) => document.getElementById(id);
const pdfFiles = new Map();
const imageFiles = new Map();
let files = pdfFiles;
let tool = 'convert';
let currentSource;
let draggedItem;
let inspecting = false;
let batch = null;
let downloadURL;
let downloadName;
let renameItem;
let dragDepth = 0;
const labels = {
  convert: ['论文 PDF','批量转图片','逐页保留原版排版、公式、表格与插图，按论文标题自动归档。','导出设置','适用于本次勾选的全部 PDF','开始转换'],
  merge: ['多份 PDF','合并为一份','拖拽文件行或用上下按钮排序，按列表从上到下合并。','合并设置','至少勾选两份 PDF','合并 PDF'],
  split: ['PDF 文档','按页拆分','在页面预览中拖拽或输入页码，将多个范围分别导出。','拆分范围','每次选择一份 PDF','拆分 PDF'],
  image: ['多张图片','合成 PDF','添加 PNG、JPG 或 WebP，拖拽排序后每张图片生成一页。','页面设置','按列表从上到下排列图片','生成 PDF'],
  watermark: ['为 PDF','添加水印','添加文字或图片水印，调整位置、透明度和旋转角度。','水印设置','应用到所选 PDF 的所有页面','添加水印'],
  delete: ['PDF 文档','删除页面','框选或输入要删除的页码，导出保留的页面。','删除范围','每次选择一份 PDF','删除所选页'],
};
const pageTool = () => tool === 'split' || tool === 'delete';
const sortable = () => tool === 'merge' || tool === 'image';
const ranges = pageRanges({ element: $, change: sync, notice, busy: () => Boolean(batch) });

function part(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function rowButton(icon, label, handler) {
  const button = part('button', 'button plain icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', `./assets/icons.svg#${icon}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  button.append(svg);
  button.addEventListener('click', handler);
  return button;
}

function sizeLabel(bytes) {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function createRow(item) {
  const row = part('li', 'file-row');
  const check = part('input');
  check.type = 'checkbox';
  check.setAttribute('aria-label', `勾选 ${item.file.name}`);
  check.addEventListener('change', () => {
    if (pageTool()) currentSource = item;
    else item.selected = check.checked;
    sync();
  });
  const info = part('div', 'file-info');
  const title = part('strong');
  const description = part('small');
  info.append(title, description);
  const status = part('span', 'file-status');
  const edit = rowButton('edit', '修改输出文件夹', () => {
    renameItem = item;
    $('folder-title').value = item.title;
    $('rename-dialog').showModal();
    $('folder-title').select();
  });
  const remove = rowButton('close', '移除文件', () => {
    item.controller.abort();
    (item.isImage ? imageFiles : pdfFiles).delete(item.key);
    row.remove();
    sync();
  });
  const actions = part('div', 'row-actions');
  const move = (direction) => {
    const order = [...files.values()];
    const index = order.indexOf(item);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    applyOrder(order);
  };
  const up = rowButton('up', '上移文件', () => move(-1));
  const down = rowButton('down', '下移文件', () => move(1));
  actions.append(edit, up, down, remove);
  row.append(check, info, status, actions);
  row.addEventListener('dragstart', (event) => {
    if (!sortable() || batch) { event.preventDefault(); return; }
    draggedItem = item;
    event.dataTransfer.setData('text/plain', 'Paperframe 文件排序');
    event.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragover', (event) => {
    if (!draggedItem || draggedItem === item) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('reorder-target');
  });
  row.addEventListener('dragleave', (event) => { if (!row.contains(event.relatedTarget)) row.classList.remove('reorder-target'); });
  row.addEventListener('dragend', () => { draggedItem = null; row.classList.remove('reorder-target'); });
  row.addEventListener('drop', (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    event.stopPropagation();
    const order = [...files.values()];
    if (draggedItem !== item) {
      const target = order.indexOf(item);
      order.splice(order.indexOf(draggedItem), 1);
      order.splice(target, 0, draggedItem);
      applyOrder(order);
    }
    draggedItem = null;
    row.classList.remove('reorder-target');
  });
  $('file-list').append(row);
  return { row, check, title, description, status, edit, remove, up, down };
}

function applyOrder(order) {
  files.clear();
  for (const item of order) { files.set(item.key, item); $('file-list').append(item.row.row); }
  sync();
}

function updateRow(item, index = [...files.values()].indexOf(item)) {
  const { row, title, description, check, status, edit, remove, up, down } = item.row;
  title.textContent = tool === 'convert' ? safeTitle(item.title) : item.file.name;
  title.title = title.textContent;
  description.textContent = `${item.pages && !item.isImage ? `${item.pages} 页 · ` : ''}${sizeLabel(item.file.size)}${tool === 'convert' ? ` · ${item.file.name}` : ''}`;
  description.title = description.textContent;
  check.type = pageTool() ? 'radio' : 'checkbox';
  check.name = pageTool() ? 'pdf-source' : '';
  check.checked = pageTool() ? item === currentSource : item.selected;
  check.disabled = Boolean(batch) || !item.pages;
  status.textContent = item.status;
  status.dataset.state = item.state;
  edit.disabled = Boolean(batch) || !item.pages;
  edit.hidden = tool !== 'convert';
  up.hidden = down.hidden = !sortable();
  up.disabled = Boolean(batch) || index === 0;
  down.disabled = Boolean(batch) || index === files.size - 1;
  remove.disabled = Boolean(batch);
  row.draggable = sortable() && !batch;
}

function sync() {
  const ready = [...files.values()].filter((item) => item.pages);
  if (pageTool() && !ready.includes(currentSource)) currentSource = ready.find((item) => item.selected) ?? ready[0];
  const selected = ready.filter((item) => pageTool() ? item === currentSource : item.selected);
  ranges.show(pageTool() ? currentSource : undefined, tool);
  const all = $('check-all');
  all.checked = ready.length > 0 && ready.length === selected.length;
  all.indeterminate = selected.length > 0 && ready.length !== selected.length;
  all.disabled = Boolean(batch) || !ready.length;
  $('selection').textContent = files.size
    ? (tool === 'image' ? `已选 ${selected.length} / ${files.size} 张图片` : `已选 ${selected.length} / ${files.size} 份 · ${selected.reduce((sum, item) => sum + item.pages, 0)} 页`)
    : (tool === 'image' ? '添加图片后可选择并调整顺序' : '添加 PDF 后，勾选需要处理的文件');
  $('drop-zone').hidden = Boolean(files.size);
  $('file-panel').hidden = !files.size;
  $('add').hidden = !files.size;
  $('add').disabled = Boolean(batch);
  $('options').disabled = Boolean(batch);
  $('start').disabled = Boolean(batch) || selected.length < (tool === 'merge' ? 2 : 1) || (pageTool() && !ranges.groups().length);
  $('cancel').hidden = !batch;
  $('cancel').disabled = Boolean(batch?.signal.aborted);
  document.querySelectorAll('[data-tool][aria-pressed]').forEach((button) => { button.disabled = Boolean(batch); });
  [...files.values()].forEach(updateRow);
}

function notice(message) {
  $('file-notice').textContent = message;
  $('file-notice').hidden = !message;
}

function addFiles(newFiles) {
  if (batch) return;
  let skipped = 0;
  let duplicates = 0;
  const isImage = tool === 'image';
  for (const file of newFiles) {
    if (isImage ? !/\.(?:png|jpe?g|webp)$/iu.test(file.name) && !/^image\/(?:png|jpeg|webp)$/u.test(file.type)
      : !/\.pdf$/iu.test(file.name) && file.type !== 'application/pdf') { skipped++; continue; }
    const key = JSON.stringify([file.name, file.size, file.lastModified]);
    if (files.has(key)) { duplicates++; continue; }
    const item = { key, file, title: file.name.replace(/\.pdf$/iu, ''), pages: 0, selected: false,
      state: 'pending', status: '等待读取', controller: new AbortController() };
    if (isImage) Object.assign(item, { isImage, pages: 1, selected: true, state: 'ready', status: '就绪' });
    item.row = createRow(item);
    files.set(key, item);
  }
  notice([skipped && `已跳过 ${skipped} 个不支持的文件`, duplicates && `已跳过 ${duplicates} 个重复文件`].filter(Boolean).join('，'));
  sync();
  void inspectNext();
}

async function inspectNext() {
  if (inspecting || batch) return;
  inspecting = true;
  try {
    while (!batch) {
      const item = [...pdfFiles.values()].find((entry) => entry.state === 'pending');
      if (!item) break;
      item.state = 'working';
      item.status = '正在读取';
      updateRow(item);
      try {
        const info = await inspectPDF(item.file, item.controller.signal);
        Object.assign(item, info);
        item.selected = true;
        item.state = 'ready';
        item.status = '就绪';
      } catch (error) {
        item.state = 'error';
        item.status = pdfError(error);
      }
      sync();
    }
  } finally {
    inspecting = false;
  }
}

function clearDownload() {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = undefined;
  $('download').hidden = true;
}

function setDownload(blob, name) {
  downloadURL = URL.createObjectURL(blob);
  downloadName = name;
  $('download-label').textContent = name.endsWith('.zip') ? '下载 ZIP' : '下载 PDF';
  $('download').hidden = false;
}

async function convertStart() {
  if (batch || !$('dpi').reportValidity()) return;
  const selected = [...files.values()].filter((item) => item.selected && item.pages);
  if (!selected.length) return;
  const options = { dpi: $('dpi').valueAsNumber, format: $('format').value, color: $('color-mode').value };
  const folderMode = $('destination').value === 'folder';
  batch = new AbortController();
  const { signal } = batch;
  const total = selected.reduce((sum, item) => sum + item.pages, 0);
  let processed = 0;
  let successful = 0;
  let exportedPages = 0;
  let failed = 0;

  sync();
  try {
    let folder;
    if (folderMode) {
      try {
        folder = await window.showDirectoryPicker({ id: 'paperframe-exports', mode: 'readwrite' });
      } catch (error) {
        if (error.name !== 'AbortError') notice('无法选择文件夹，请改用「打包下载 ZIP」。');
        return;
      }
    }
    signal.throwIfAborted();
    notice('');
    clearDownload();
    $('operation').hidden = false;
    $('progress-title').textContent = '正在转换';
    $('progress-detail').textContent = '正在准备导出…';
    $('progress').max = total;
    $('progress').value = 0;

    const destination = await makeDestination(folder);
    for (const item of selected) {
      if (signal.aborted) break;
      let output;
      let phase = 'render';
      item.state = 'working';
      item.status = '正在转换';
      updateRow(item);
      try {
        output = await destination.begin(item.title);
        const pageCount = await convertPDF(item.file, options, signal, async (page) => {
          phase = 'write';
          await output.write(page);
          phase = 'render';
          $('progress').value = processed + page.number;
          $('progress-detail').textContent = `${safeTitle(item.title)} · 第 ${page.number} / ${page.total} 页`;
        });
        signal.throwIfAborted();
        phase = 'commit';
        await output.commit();
        exportedPages += pageCount;
        successful++;
        item.state = 'done';
        item.status = `已完成 · ${pageCount} 页`;
      } catch (error) {
        await output?.discard();
        if (signal.aborted && phase === 'render') {
          item.state = 'ready';
          item.status = '已取消';
        } else {
          failed++;
          item.state = 'error';
          item.status = output && phase === 'render' ? pdfError(error) : '保存失败';
        }
        if (phase === 'commit' && !folderMode) throw error;
      } finally {
        processed += item.pages;
        if (!signal.aborted) $('progress').value = processed;
        updateRow(item);
      }
    }
    const archive = await destination.finish();
    if (archive && successful) setDownload(archive, '论文页面.zip');
    $('progress-title').textContent = signal.aborted ? '转换已取消' : successful ? '转换完成' : '没有可导出的页面';
    $('progress-detail').textContent = `已完成 ${successful} 份 PDF，共 ${exportedPages} 张 · ${options.dpi} DPI${failed ? ` · ${failed} 份失败` : ''}`;
  } catch {
    if ($('operation').hidden) return;
    $('progress-title').textContent = '导出未完成';
    $('progress-detail').textContent = '无法完成保存，可减少勾选数量后重试。';
  } finally {
    batch = null;
    sync();
    void inspectNext();
  }
}

function settingsFor(toolName) {
  const [title, accent, description, settings, settingsDescription, action] = labels[toolName];
  $('title').replaceChildren(`${title} `, part('span', '', accent));
  $('hero-description').textContent = description;
  $('settings-title').textContent = settings;
  $('settings-description').textContent = settingsDescription;
  $('start-label').textContent = action;
  $('workspace').dataset.tool = toolName;
  $('convert-options').hidden = toolName !== 'convert';
  $('name-options').hidden = !sortable();
  $('image-options').hidden = toolName !== 'image';
  $('page-options').hidden = !pageTool();
  $('watermark-options').hidden = toolName !== 'watermark';
  $('check-label').hidden = pageTool();
  $('single-label').hidden = !pageTool();
  $('add-range-label').textContent = toolName === 'split' ? '添加拆分组' : '添加删除范围';
  $('file-column').textContent = toolName === 'convert' ? '论文 / 输出文件夹' : sortable() ? '文件名 / 拖拽排序' : '文件名';
  const imageMode = toolName === 'image';
  $('file-input').accept = imageMode ? '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp' : '.pdf,application/pdf';
  $('drop-title').textContent = imageMode ? '拖放图片到这里' : '拖放 PDF 到这里';
  $('drop-description').textContent = imageMode ? '支持 PNG、JPG、WebP' : '支持同时添加多份 PDF';
  $('add-label').textContent = imageMode ? '添加图片' : '添加 PDF';
  $('select-label').textContent = imageMode ? '选择图片' : '选择 PDF';
  document.querySelectorAll('#tool-nav button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === toolName)));
}

function switchTool(next) {
  if (batch || next === tool) return;
  tool = next;
  files = tool === 'image' ? imageFiles : pdfFiles;
  $('file-list').replaceChildren(...[...files.values()].map((item) => item.row.row));
  $('operation').hidden = true;
  $('pdf-name').value = '';
  clearDownload();
  notice('');
  settingsFor(tool);
  sync();
}

function nameForPDF(fallback) {
  const text = $('pdf-name').value.trim().replace(/\.pdf$/iu, '');
  return `${safeTitle(text || fallback)}.pdf`;
}

async function checkedEdit(selected, changes, expected, signal) {
  const { output, pages } = await editPDF(selected, changes, signal);
  if (pages !== expected) throw new Error('输出页数与所选页面不符，请检查源文件');
  return output;
}

async function editStart() {
  const selected = [...files.values()].filter((item) => item.pages && (pageTool() ? item === currentSource : item.selected));
  const first = selected[0];
  if (!first || batch) return;
  const watermark = tool === 'watermark';
  const groupList = ranges.groups();
  const options = watermark ? {
    file: $('watermark-type').value === 'image' ? $('watermark-image').files[0] : undefined,
    text: $('watermark-type').value === 'text' ? $('watermark-text').value.trim() : '',
    color: $('watermark-color').value,
    angle: $('watermark-angle').valueAsNumber,
    opacity: $('watermark-opacity').valueAsNumber,
    position: $('watermark-position').value,
  } : null;
  if (watermark && !options.file && !options.text) { notice('请先输入水印文字或选择水印图片。'); return; }
  if (watermark && (!$('watermark-angle').reportValidity() || !$('watermark-opacity').reportValidity())) return;
  if (pageTool() && !groupList.length) return;

  const total = selected.reduce((sum, item) => sum + item.pages, 0);
  let detail = '';
  let result;
  let outputName;
  batch = new AbortController();
  const { signal } = batch;
  clearDownload();
  notice('');
  $('operation').hidden = false;
  $('progress-title').textContent = '正在处理';
  $('progress').max = tool === 'split' ? groupList.length : total;
  $('progress').value = 0;
  $('progress-detail').textContent = '正在读取文件…';
  const advance = (value) => { $('progress').value = value; $('progress-detail').textContent = `已处理 ${value} / ${$('progress').max}`; };
  sync();
  try {
    if (tool === 'merge') {
      if (selected.length < 2) return;
      result = await checkedEdit(selected, {}, total, signal);
      outputName = nameForPDF('合并文档');
      detail = `${selected.length} 份 PDF 已合并 · ${total} 页`;
    } else if (tool === 'split') {
      const entries = [];
      for (const [index,[from,to]] of groupList.entries()) {
        const output = await checkedEdit(selected, { includePages: [[from - 1, to - 1]] }, to - from + 1, signal);
        entries.push({ name: `${safeTitle(first.title)}_第${from}${to === from ? '' : `-${to}`}页`, output });
        advance(index + 1);
      }
      result = entries.length === 1 ? entries[0].output : await archivePDFs(entries);
      outputName = entries.length === 1 ? `${safeTitle(entries[0].name)}.pdf` : '拆分文档.zip';
      detail = `已导出 ${entries.length} 份 PDF`;
    } else if (tool === 'delete') {
      const removed = groupList.reduce((sum,[from,to]) => sum + to - from + 1, 0);
      const excludePages = groupList.map(([from,to]) => [from - 1,to - 1]);
      result = await checkedEdit(selected, { excludePages }, total - removed, signal);
      outputName = `${safeTitle(first.title)}_删除页面.pdf`;
      detail = `已删除 ${removed} 页 · 保留 ${total - removed} 页`;
    } else if (tool === 'image') {
      result = await runWorker('image', { files: selected.map((item) => item.file), paperSize: $('paper-size').value }, signal, advance);
      outputName = nameForPDF('图片合辑');
      detail = `已生成 ${selected.length} 页 PDF`;
    } else if (watermark) {
      const entries = [];
      let processed = 0;
      for (const item of selected) {
        const output = await runWorker('watermark', { files: [item.file], settings: options }, signal, (value) => advance(processed + value));
        entries.push({ name: `${item.title}_水印`, output });
        processed += item.pages;
      }
      result = entries.length === 1 ? entries[0].output : await archivePDFs(entries);
      outputName = entries.length === 1 ? `${safeTitle(entries[0].name)}.pdf` : '水印文档.zip';
      detail = `已为 ${entries.length} 份 PDF 添加水印 · ${total} 页`;
    }
    signal.throwIfAborted();
    setDownload(result, outputName);
    $('progress-title').textContent = '处理完成';
    $('progress-detail').textContent = detail;
    $('progress').value = $('progress').max;
  } catch (error) {
    $('progress-title').textContent = signal.aborted ? '处理已取消' : '处理失败';
    $('progress-detail').textContent = signal.aborted ? '可以调整文件后重新处理。' : error?.message || '无法处理所选文件';
  } finally {
    batch = null;
    sync();
    void inspectNext();
  }
}

const destination = $('destination');
destination.querySelector('[value=folder]').disabled = typeof window.showDirectoryPicker !== 'function' || window.top !== window.self;
destination.addEventListener('change', () => {
  $('destination-note').textContent = destination.value === 'folder'
    ? '开始转换时选择保存位置，论文子文件夹会自动创建。'
    : '解压后，每篇论文的页面各存于独立子文件夹。';
});
$('select').addEventListener('click', () => $('file-input').click());
$('add').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
$('check-all').addEventListener('change', (event) => {
  for (const item of files.values()) if (item.pages) item.selected = event.target.checked;
  sync();
});
$('start').addEventListener('click', () => void (tool === 'convert' ? convertStart() : editStart()));
$('cancel').addEventListener('click', () => {
  batch?.abort();
  $('cancel').disabled = true;
});
$('download').addEventListener('click', () => {
  if (!downloadURL) return;
  const anchor = document.createElement('a');
  anchor.href = downloadURL;
  anchor.download = downloadName;
  anchor.click();
});
$('help').addEventListener('click', () => $('help-dialog').showModal());
$('rename-cancel').addEventListener('click', () => $('rename-dialog').close());
$('rename-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (renameItem) { renameItem.title = safeTitle($('folder-title').value); updateRow(renameItem); }
  $('rename-dialog').close();
});
$('rename-dialog').addEventListener('close', () => { renameItem = null; });
$('tool-nav').addEventListener('click', (event) => {
  const name = event.target.closest('button')?.dataset.tool;
  if (name && name !== tool && !batch) {
    history.pushState(null, '', `#${name}`);
    switchTool(name);
  }
});
function route() {
  const name = location.hash.slice(1);
  switchTool(Object.hasOwn(labels, name) ? name : 'convert');
}
window.addEventListener('hashchange', route);
document.querySelector('.wordmark').addEventListener('click', (event) => {
  event.preventDefault();
  if (!batch) location.hash = 'convert';
});
route();
$('watermark-type').addEventListener('change', () => {
  const image = $('watermark-type').value === 'image';
  $('watermark-text-field').hidden = $('watermark-color-field').hidden = image;
  $('watermark-image-field').hidden = !image;
});

const card = document.querySelector('.files-card');
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
card.addEventListener('dragenter', (event) => {
  if (!batch && event.dataTransfer.types.includes('Files')) { dragDepth++; card.classList.add('dragging'); }
});
card.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) card.classList.remove('dragging');
});
card.addEventListener('drop', (event) => {
  dragDepth = 0;
  card.classList.remove('dragging');
  addFiles(event.dataTransfer.files);
});
