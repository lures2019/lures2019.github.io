const byteLimit = 128 * 1024 * 1024;
const fileLimit = 16;
const chunkSize = 16 * 1024;
const idleMessage = '每批最多 16 个文件，合计 128 MiB。';
const $ = id => document.getElementById(id);
const cleanName = name => name.replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_').slice(0, 180).trim() || '文件';
const sizeOf = files => files.reduce((total, file) => total + file.size, 0);
const describe = files => files.length === 1 ? cleanName(files[0].name) : `${files.length} 个文件`;

export function fileChannel(channel, abort, clipboard) {
  const batch = channel.label === 'files-v2';
  let outgoing, incoming, received;
  let readingClipboard = false;
  const progress = $('file-progress');
  const pasteArea = $('file-paste-area');
  const copyButton = $('file-copy');
  const clipboardButton = $('send-clipboard');
  const status = message => { $('file-status').textContent = message; };
  const send = message => channel.send(JSON.stringify(message));
  const available = () => !abort.aborted && channel.readyState === 'open';

  function updateSendControls() {
    const busy = !!(outgoing || incoming || readingClipboard);
    $('send-file').disabled = clipboardButton.disabled = busy;
  }

  function resetDownload() {
    if (received) received.urls.forEach(url => URL.revokeObjectURL(url));
    received = undefined;
    $('file-downloads').replaceChildren();
    copyButton.hidden = true;
  }

  function offer(files) {
    if (!files.length || !available()) return;
    if (outgoing || incoming) return status('请等当前文件传输结束。');
    if (files.length > (batch ? fileLimit : 1)) {
      return status(batch ? '每批最多发送 16 个文件。' : '对方使用旧版远桌，请每次选择一个文件。');
    }
    const size = sizeOf(files);
    if (size > byteLimit) return status('这批文件合计超过 128 MiB。');
    outgoing = {files, size, accepted:false};
    const entries = files.map(file => ({name:cleanName(file.name), size:file.size}));
    status(`等待对方接收 ${describe(files)}`);
    updateSendControls();
    send(batch ? {type:'offer', files:entries} : {type:'offer', ...entries[0]});
  }

  async function sendClipboard(after) {
    if (!clipboard || !available() || outgoing || incoming || readingClipboard) return;
    readingClipboard = true;
    updateSendControls();
    try {
      const files = await clipboard.read(after, abort);
      if (!available()) return;
      if (files.length) offer(files);
      else if (after === undefined) status('剪贴板里没有文件。请在资源管理器中复制文件后再试。');
    } catch {
      if (available()) status('无法读取剪贴板。请确认复制的是文件且合计不超过 128 MiB。');
    } finally {
      readingClipboard = false;
      if (available()) updateSendControls();
    }
  }

  function ready() {
    if (!available()) return;
    $('files').hidden = false;
    $('file-picker').multiple = batch;
    clipboardButton.hidden = !clipboard;
    $('file-accept-copy').hidden = !clipboard;
    status(batch ? idleMessage : '单个文件最多 128 MiB。');
    pasteArea.textContent = clipboard ? '拖入文件，或在此按 Ctrl+V 发送已复制的文件。'
      : '拖入文件，或在此按 Ctrl+V 粘贴浏览器能读取的文件。';
    $('send-file').onclick = () => $('file-picker').click();
    clipboardButton.onclick = () => void sendClipboard();
    $('file-picker').onchange = () => {
      const files = [...$('file-picker').files];
      $('file-picker').value = '';
      offer(files);
    };
    pasteArea.ondragover = event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = outgoing || incoming ? 'none' : 'copy';
    };
    pasteArea.ondrop = event => {
      event.preventDefault();
      if ([...event.dataTransfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        return status('请拖入文件。文件夹可先压缩，再发送压缩包。');
      }
      offer([...event.dataTransfer.files]);
    };
    pasteArea.onpaste = event => {
      event.preventDefault();
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) offer(files);
      else if (clipboard) void sendClipboard();
      else status('浏览器没有收到可粘贴的文件，请拖入或选择文件。');
    };
  }

  function clear() {
    outgoing = incoming = undefined;
    $('file-actions').hidden = true;
    progress.hidden = true;
    updateSendControls();
  }

  function reset() {
    clear();
    resetDownload();
    $('files').hidden = true;
    $('file-picker').onchange = null;
    pasteArea.ondragover = pasteArea.ondrop = pasteArea.onpaste = null;
  }

  async function sendFiles(current) {
    current.accepted = true;
    progress.hidden = false;
    progress.value = 0;
    status(`正在发送 ${describe(current.files)}`);
    let sent = 0;
    for (const file of current.files) {
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        while (channel.bufferedAmount > 64 * 1024 && outgoing === current && available()) {
          await new Promise(resolve => setTimeout(resolve, 15));
        }
        if (outgoing !== current || !available()) return;
        const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
        if (outgoing !== current || !available()) return;
        channel.send(chunk);
        sent += chunk.byteLength;
        progress.value = sent / current.size;
      }
    }
    if (outgoing === current && available()) send({type:'done'});
  }

  function skipCompleted(current) {
    while (current.index < current.files.length && current.files[current.index].bytes === current.files[current.index].size) {
      current.index++;
    }
  }

  async function putOnClipboard(group) {
    copyButton.disabled = true;
    try {
      await clipboard.copy(group.files, abort);
      if (available() && received === group) status('文件已复制到本机剪贴板。打开目标文件夹后按 Ctrl+V。');
    } catch {
      if (available() && received === group) status('无法写入本机剪贴板。请重试，或使用下方链接保存。');
    } finally {
      if (available() && received === group) copyButton.disabled = false;
    }
  }

  function finishDownload(current) {
    resetDownload();
    const files = current.files.map(entry => new File(entry.chunks, entry.name, {type:'application/octet-stream'}));
    const group = received = {files, urls:files.map(file => URL.createObjectURL(file))};
    $('file-downloads').replaceChildren(...files.map((file, index) => {
      const link = document.createElement('a');
      link.className = 'download';
      link.href = group.urls[index];
      link.download = file.name;
      link.textContent = `保存 ${file.name}`;
      return link;
    }));
    copyButton.hidden = !clipboard;
    copyButton.disabled = false;
    copyButton.onclick = () => void putOnClipboard(group);
    clear();
    status('文件接收完成。');
    send({type:'received'});
    if (current.copy) void putOnClipboard(group);
  }

  channel.binaryType = 'arraybuffer';
  if (channel.readyState === 'open') ready();
  else channel.onopen = ready;
  channel.onclose = () => { if (!abort.aborted) reset(); };
  abort.addEventListener('abort', reset, {once:true});
  channel.onmessage = ({data}) => {
    if (abort.aborted) return;
    if (data instanceof ArrayBuffer) {
      const file = incoming?.accepted && incoming.files[incoming.index];
      if (!file || data.byteLength < 1 || data.byteLength > chunkSize || file.bytes + data.byteLength > file.size) {
        return channel.close();
      }
      file.chunks.push(data);
      file.bytes += data.byteLength;
      incoming.bytes += data.byteLength;
      progress.value = incoming.bytes / incoming.size;
      skipCompleted(incoming);
      return;
    }
    if (typeof data !== 'string' || data.length > (batch ? 20000 : 1200)) return channel.close();
    let message;
    try { message = JSON.parse(data); } catch { return channel.close(); }
    switch (message?.type) {
      case 'offer': {
        const entries = batch ? message.files : [message];
        if (outgoing || incoming || !Array.isArray(entries) || !entries.length || entries.length > (batch ? fileLimit : 1) ||
            entries.some(entry => typeof entry?.name !== 'string' || entry.name.length > 180 ||
              !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > byteLimit) || sizeOf(entries) > byteLimit) {
          send({type:'decline'});
          break;
        }
        const files = entries.map(entry => ({name:cleanName(entry.name), size:entry.size, bytes:0, chunks:[]}));
        incoming = {files, size:sizeOf(files), bytes:0, index:0, accepted:false};
        skipCompleted(incoming);
        status(`收到 ${describe(files)}（${new Intl.NumberFormat('zh-CN').format(incoming.size)} 字节）`);
        $('file-actions').hidden = false;
        updateSendControls();
        break;
      }
      case 'accept':
        if (outgoing && !outgoing.accepted) sendFiles(outgoing).catch(() => channel.close());
        break;
      case 'decline':
        if (outgoing && !outgoing.accepted) { clear(); status('对方暂未接收文件。'); }
        break;
      case 'done':
        if (!incoming?.accepted || incoming.index !== incoming.files.length) return channel.close();
        finishDownload(incoming);
        break;
      case 'received':
        if (outgoing?.accepted) { clear(); status('发送完成。'); }
        break;
      default:
        channel.close();
    }
  };
  function accept(copy = false) {
    if (!incoming || incoming.accepted || !available()) return;
    incoming.accepted = true;
    incoming.copy = copy;
    $('file-actions').hidden = true;
    progress.hidden = false;
    progress.value = 0;
    send({type:'accept'});
  }
  $('file-accept').onclick = () => accept();
  $('file-accept-copy').onclick = () => accept(true);
  $('file-decline').onclick = () => {
    if (!incoming || incoming.accepted || !available()) return;
    send({type:'decline'});
    clear();
    status('已拒绝接收文件。');
  };
  return {sendClipboard};
}
