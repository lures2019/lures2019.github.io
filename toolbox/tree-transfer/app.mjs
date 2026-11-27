import {Pair, invite} from './transfer.mjs?v=2';
import {peerOptions} from './config.mjs';
import {listDownloads, openDownloadFolder, stageDownload, supportsLocalDownloads} from './downloads.mjs';

const $ = id => document.getElementById(id);
const dialog = $('notice');
const downloads = new Set();
let pair, directory, lastPaint = 0, promptTask;

function bytes(size) {
  if (!size) return '0 B';
  const units = ['B','KiB','MiB','GiB','TiB','PiB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return (size / 1024 ** index).toFixed(index ? 1 : 0) + ' ' + units[index];
}

function time(seconds) {
  if (!Number.isFinite(seconds)) return '计算中';
  const sec = Math.ceil(seconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor(sec / 60) % 60;
  return [hours && hours + ' 小时', minutes && minutes + ' 分钟', sec % 60 + ' 秒'].filter(Boolean).join(' ');
}

function prompt(title, text, files, action) {
  if (dialog.open) closePrompt(false);
  const task = {};
  promptTask = task;
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  $('notice-files').hidden = !files;
  $('notice-files').replaceChildren(...(files || []).map(file => {
    const li = document.createElement('li');
    li.textContent = file.name + ' · ' + bytes(file.size);
    return li;
  }));
  $('decline').hidden = !files && !action;
  $('decline').textContent = files ? '拒绝' : '取消';
  $('accept').textContent = action || (files ? '接收文件' : '知道了');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    task.resolve = resolve;
    if (files || action) $('decline').focus();
  });
}
dialog.addEventListener('submit', event => {
  event.preventDefault();
  closePrompt(event.submitter?.value === 'yes');
});
dialog.addEventListener('cancel', event => { event.preventDefault(); closePrompt(false); });
function closePrompt(accepted) {
  if (dialog.open) dialog.close();
  promptTask?.resolve?.(accepted);
  promptTask = null;
}
function error(message) {
  closePrompt(false);
  void prompt('传输提示', message);
}

function storageError(err) {
  if (err?.name === 'QuotaExceededError') {
    return '浏览器暂存空间或磁盘空间不足。可移除已下载的暂存文件，或选择有足够空间的保存目录后重试。';
  }
  return err?.message || '浏览器存储出现异常，请重试。';
}

function showStorage() {
  $('storage').textContent = directory ? '保存到：' + directory.name :
    supportsLocalDownloads() ? '文件校验通过后可下载。' + (window.showDirectoryPicker ? '也可选择保存目录，直接写入磁盘。' : '') :
      '此浏览器无法暂存下载，请选择保存目录，或更换新版浏览器。';
}
$('folder').hidden = !window.showDirectoryPicker;
showStorage();

function safeName(name) {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(safe) ? '_' + safe : safe || '收到的文件';
}

async function diskWriter(folder, file) {
  const name = safeName(file.name);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 10000; i++) {
    const suffix = i ? ' (' + i + ')' : '';
    const filename = !i ? name : stem.slice(0, Math.max(1, 230 - ext.length - suffix.length)) + suffix + ext;
    try { await folder.getFileHandle(filename); continue; }
    catch (err) { if (err.name === 'TypeMismatchError') continue; if (err.name !== 'NotFoundError') throw err; }
    const handle = await folder.getFileHandle(filename, {create:true});
    let writer;
    try { writer = await handle.createWritable({mode:'exclusive'}); }
    catch (err) { await folder.removeEntry(filename).catch(() => {}); throw err; }
    let state = 'open';
    return {
      write: chunk => writer.write(chunk),
      commit: async () => {
        state = 'committing';
        try { await writer.close(); state = 'saved'; }
        catch (err) { state = 'open'; throw err; }
      },
      abort: async () => {
        if (state !== 'open') return;
        state = 'aborted';
        await writer.abort().catch(() => {});
        await folder.removeEntry(filename).catch(() => {});
      },
    };
  }
  throw new Error('保存目录包含过多同名文件。');
}

function presentDownload(item) {
  if (downloads.has(item.id)) return;
  const download = item.file.slice(0,item.file.size,'application/octet-stream');
  const url = URL.createObjectURL(download);
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName(item.name);
  link.textContent = '下载 ' + item.name + ' · ' + bytes(item.file.size);
  const dismiss = document.createElement('button');
  dismiss.className = 'quiet';
  dismiss.textContent = '移除暂存';
  dismiss.addEventListener('click', async () => {
    const approved = await prompt('移除暂存文件？','如果已开始下载，请先确认浏览器下载列表里的文件已下载完成。',null,'移除');
    if (!approved) return;
    try {
      await item.remove();
      URL.revokeObjectURL(url);
      downloads.delete(item.id);
      li.remove();
      $('downloads').hidden = !downloads.size;
    } catch (err) { error(storageError(err)); }
  });
  li.append(link, ' ', dismiss);
  $('downloads').append(li);
  $('downloads').hidden = false;
  downloads.add(item.id);
}

if (supportsLocalDownloads()) void listDownloads().then(items => items.forEach(presentDownload)).catch(() => {});

const ui = {
  status(label, live = false) {
    $('status').textContent = label;
    $('status').classList.toggle('live', live);
    this.ready(live);
    if (live) $('pair-note').textContent = '双方都可以发送。密钥在本次页面会话中有效。';
  },
  ready(value) {
    $('pick').disabled = !value;
    $('drop-hint').textContent = value ? '支持批量发送，保留文件原始内容' : pair?.authenticated ? '正在处理文件' : '配对成功后即可发送';
  },
  error,
  ended(err) {
    pair = null;
    showPair(false);
    $('transfer').hidden = true;
    error(storageError(err));
  },
  async consent(files) {
    const current = pair;
    const folder = directory;
    let downloadFolder;
    if (!folder) {
      try { downloadFolder = await openDownloadFolder(); }
      catch (err) { if (pair === current) error(storageError(err)); return null; }
    }
    if (!current || pair !== current) return null;
    const approved = await prompt('接收文件？', folder ? '文件将保存到「' + folder.name + '」。' : '文件校验通过后，请点击文件名下载。', files);
    if (!approved) return null;
    return folder ? file => diskWriter(folder,file) : file => stageDownload(downloadFolder,file,presentDownload);
  },
  progress(action,file,count,start) {
    const now = performance.now();
    if (count !== 0 && count !== file.size && now - lastPaint < 130) return;
    lastPaint = now;
    const percent = file.size ? Math.min(100,Math.floor(100 * count / file.size)) : 0;
    const speed = count / Math.max(0.15,(now - start) / 1000);
    $('transfer').hidden = false;
    $('progress-name').textContent = action + ' · ' + file.name;
    $('progress').value = percent;
    $('percent').textContent = percent + '%';
    $('stats').textContent = file.size ? bytes(count) + ' / ' + bytes(file.size) + ' · ' + bytes(speed) + '/s · 剩余 ' + time((file.size - count) / speed) : '';
  },
  complete(action,count) {
    $('transfer').hidden = false;
    $('progress-name').textContent = action;
    $('progress').value = count ? 100 : 0;
    $('percent').textContent = count ? '100%' : '';
    $('stats').textContent = count ? count + ' 个文件已通过 SHA‑256 校验' : '';
  },
};

function showPair(active, code = '') {
  $('pair-actions').hidden = active;
  $('waiting').hidden = !active;
  $('own-code').value = code;
  for (const id of ['turn-url','turn-user','turn-pass']) $(id).disabled = active;
  $('pair-note').textContent = active ? '只将密钥分享给你要配对的人。等待期间请保持页面打开。' : '';
  ui.status(active ? '正在连接' : '未连接');
}

async function connect(code,host) {
  if (pair) return;
  if (!window.isSecureContext || !window.RTCPeerConnection || !window.Peer || !window.hashwasm) {
    error('当前浏览器无法启动传输，请在 HTTPS 下使用较新的浏览器。');
    return;
  }
  const iceServers = [...peerOptions.config.iceServers];
  const relay = $('turn-url').value.trim();
  if (relay) {
    if (!/^turns?:[^\s/@#]+$/i.test(relay) || !$('turn-user').value.trim() || !$('turn-pass').value) {
      error('请填写有效的 TURN 地址、用户名和凭据，或留空以使用自动直连。');
      return;
    }
    iceServers.push({urls:relay, username:$('turn-user').value.trim(), credential:$('turn-pass').value});
  }
  const next = new Pair(ui, {...peerOptions, config:{...peerOptions.config, iceServers}});
  pair = next;
  showPair(true,code);
  try { await next.start(code,host); }
  catch (err) { next.fail(err); }
}
$('create').onclick = () => void connect(invite(),true);
$('join-form').onsubmit = event => {
  event.preventDefault();
  void connect($('join-code').value.trim(),false);
};
$('disconnect').onclick = () => {
  pair?.stop();
  pair = null;
  closePrompt(false);
  showPair(false);
  $('transfer').hidden = true;
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('own-code').value); $('pair-note').textContent = '密钥已复制。'; }
  catch { $('own-code').select(); }
};
$('folder').onclick = async () => {
  try { directory = await window.showDirectoryPicker({mode:'readwrite'}); showStorage(); }
  catch (err) { if (err.name !== 'AbortError') error('无法选择保存目录：' + err.message); }
};
$('pick').onclick = () => $('files').click();
$('files').onchange = () => {
  const files = [...$('files').files];
  $('files').value = '';
  void pair?.sendFiles(files);
};
for (const type of ['dragover','drop']) document.addEventListener(type, event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
});
$('pick').addEventListener('dragover', event => {
  if (!$('pick').disabled) { event.preventDefault(); $('pick').classList.add('drag'); }
});
$('pick').addEventListener('dragleave', () => $('pick').classList.remove('drag'));
$('pick').addEventListener('drop', event => {
  event.preventDefault();
  $('pick').classList.remove('drag');
  void pair?.sendFiles([...event.dataTransfer.files]);
});
window.addEventListener('pagehide', () => {
  pair?.stop();
  pair = null;
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  closePrompt(false);
  showPair(false);
  $('transfer').hidden = true;
});
