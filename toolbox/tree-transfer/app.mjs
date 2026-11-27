import {Pair, invite} from './transfer.mjs';
import {peerOptions} from './config.mjs';

const $ = id => document.getElementById(id);
const dialog = $('notice');
const MAX_BUFFER = 128 * 1024 * 1024;
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

function prompt(title, text, files) {
  if (dialog.open) dialog.close();
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
  $('decline').hidden = !files;
  $('accept').textContent = files ? '接收文件' : '知道了';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    task.resolve = resolve;
    if (files) $('decline').focus();
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

function showStorage() {
  $('storage').textContent = directory ? '保存到：' + directory.name :
    '浏览器下载模式，每批最多 128 MiB。' + (window.showDirectoryPicker ? '选择保存目录可直接写入大文件。' : '使用桌面版 Chrome 或 Edge 可选择保存目录。');
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

function downloadWriter(file) {
  let parts = [];
  return {
    write: chunk => parts.push(chunk),
    commit() {
      const url = URL.createObjectURL(new Blob(parts, {type:'application/octet-stream'}));
      parts = [];
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = url;
      link.download = safeName(file.name);
      link.textContent = '保存 ' + file.name;
      link.addEventListener('click', () => {
        link.textContent = '再次保存 ' + file.name;
      });
      const dismiss = document.createElement('button');
      dismiss.className = 'quiet';
      dismiss.textContent = '清除';
      dismiss.addEventListener('click', () => {
        URL.revokeObjectURL(url);
        li.remove();
        $('downloads').hidden = !$('downloads').childElementCount;
      });
      li.append(link, ' ', dismiss);
      $('downloads').append(li);
      $('downloads').hidden = false;
    },
    async abort() { parts = []; },
  };
}

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
  ended(message) {
    pair = null;
    showPair(false);
    $('transfer').hidden = true;
    error(message);
  },
  async consent(files) {
    const folder = directory;
    if (!folder && (files.reduce((sum,file) => sum + file.size,0) > MAX_BUFFER || $('downloads').childElementCount)) {
      error('当前下载模式每批限 128 MiB，且只保留一批待保存文件。请清除已保存文件，或选择保存目录后请对方重新发送。');
      return null;
    }
    const approved = await prompt('接收文件？', folder ? '文件将保存到「' + folder.name + '」。' : '传输完成后，请点击文件名保存。', files);
    if (!approved) return null;
    return folder ? file => diskWriter(folder,file) : downloadWriter;
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
