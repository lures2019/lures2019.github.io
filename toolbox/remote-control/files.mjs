const limit = 128 * 1024 * 1024;
const chunkSize = 16 * 1024;
const $ = id => document.getElementById(id);

export function fileChannel(channel, abort) {
  let outgoing, incoming, download;
  const progress = $('file-progress');
  const status = message => { $('file-status').textContent = message; };
  const send = message => channel.send(JSON.stringify(message));
  const cleanName = name => name.replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_').slice(0, 180).trim() || '文件';

  function resetDownload() {
    if (download) URL.revokeObjectURL(download);
    download = undefined;
    $('file-download').hidden = true;
    $('file-download').removeAttribute('href');
  }
  function ready() {
    $('files').hidden = false;
    $('send-file').onclick = () => $('file-picker').click();
    $('file-picker').onchange = () => {
      const file = $('file-picker').files[0];
      $('file-picker').value = '';
      if (!file || outgoing || incoming) return;
      if (file.size > limit) return status('文件超过 128 MiB。');
      resetDownload();
      outgoing = {file, accepted: false};
      $('send-file').disabled = true;
      status(`等待对方接收 ${cleanName(file.name)}`);
      send({type: 'offer', name: cleanName(file.name), size: file.size});
    };
  }
  function clear() {
    outgoing = undefined;
    incoming = undefined;
    $('send-file').disabled = false;
    $('file-actions').hidden = true;
    progress.hidden = true;
  }
  function reset() {
    clear();
    resetDownload();
    status('单个文件最多 128 MiB。');
    $('files').hidden = true;
    $('file-picker').onchange = null;
  }
  async function sendFile(current) {
    current.accepted = true;
    progress.hidden = false;
    progress.value = 0;
    status(`正在发送 ${cleanName(current.file.name)}`);
    for (let offset = 0; offset < current.file.size; offset += chunkSize) {
      while (channel.bufferedAmount > 256 * 1024 && outgoing === current && !abort.aborted) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (outgoing !== current || abort.aborted) return;
      const chunk = await current.file.slice(offset, offset + chunkSize).arrayBuffer();
      if (outgoing !== current || abort.aborted || channel.readyState !== 'open') return;
      channel.send(chunk);
      progress.value = Math.min(1, (offset + chunk.byteLength) / current.file.size);
    }
    if (outgoing === current && channel.readyState === 'open') send({type: 'done'});
  }

  channel.binaryType = 'arraybuffer';
  if (channel.readyState === 'open') ready();
  else channel.onopen = ready;
  channel.onclose = () => { if (!abort.aborted) reset(); };
  abort.addEventListener('abort', reset, {once: true});
  channel.onmessage = ({data}) => {
    if (abort.aborted) return;
    if (data instanceof ArrayBuffer) {
      if (!incoming?.accepted || data.byteLength < 1 || data.byteLength > chunkSize || incoming.bytes + data.byteLength > incoming.size) {
        channel.close();
        return;
      }
      incoming.chunks.push(data);
      incoming.bytes += data.byteLength;
      progress.value = incoming.bytes / incoming.size;
      return;
    }
    if (typeof data !== 'string' || data.length > 1200) return channel.close();
    let message;
    try { message = JSON.parse(data); } catch { return channel.close(); }
    switch (message?.type) {
      case 'offer': {
        if (outgoing || incoming || typeof message.name !== 'string' || !Number.isSafeInteger(message.size) || message.size < 0 || message.size > limit) {
          send({type: 'decline'});
          break;
        }
        resetDownload();
        incoming = {name: cleanName(message.name), size: message.size, bytes: 0, chunks: [], accepted: false};
        status(`收到 ${incoming.name}（${new Intl.NumberFormat('zh-CN').format(incoming.size)} 字节）`);
        $('file-actions').hidden = false;
        $('send-file').disabled = true;
        break;
      }
      case 'accept':
        if (outgoing && !outgoing.accepted) sendFile(outgoing).catch(() => channel.close());
        break;
      case 'decline':
        if (outgoing && !outgoing.accepted) { clear(); status('对方暂未接收文件。'); }
        break;
      case 'done': {
        if (!incoming?.accepted || incoming.bytes !== incoming.size) return channel.close();
        download = URL.createObjectURL(new Blob(incoming.chunks, {type: 'application/octet-stream'}));
        const link = $('file-download');
        link.href = download;
        link.download = incoming.name;
        link.textContent = `保存 ${incoming.name}`;
        link.hidden = false;
        clear();
        status('文件接收完成。');
        send({type: 'received'});
        break;
      }
      case 'received':
        if (outgoing?.accepted) { clear(); status('发送完成。'); }
        break;
      default:
        channel.close();
    }
  };
  $('file-accept').onclick = () => {
    if (!incoming || incoming.accepted || channel.readyState !== 'open') return;
    incoming.accepted = true;
    $('file-actions').hidden = true;
    progress.hidden = false;
    progress.value = 0;
    send({type: 'accept'});
  };
  $('file-decline').onclick = () => {
    if (incoming && !incoming.accepted && channel.readyState === 'open') send({type: 'decline'});
    clear();
    status('已拒绝接收文件。');
  };
}
