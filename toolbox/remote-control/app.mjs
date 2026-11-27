import {publicSignal, unlockBookmark, PairTicket, Signal, base64, confirmationCode, credentialKind, endpoint, invitationLimit, isLoopback, localDescription, rtcServers, timeLimit} from './transport.mjs?v=pair3';
import {fileChannel} from './files.mjs';

export const $ = id => document.getElementById(id);
export function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).dataset.error = String(error);
}

export function peerState(peer) {
  const state = peer.connectionState || peer.iceConnectionState;
  return state === 'completed' ? 'connected' : state;
}

export function trackLocalAddress(field, hint) {
  function update() { $(hint).hidden = !isLoopback($(field).value.trim()); }
  $(field).addEventListener('input', update);
  return update;
}

export function compatibilityIssue() {
  if (!window.isSecureContext) return '请通过 HTTPS 页面或本机测试链接打开远桌。';
  if (!window.crypto?.subtle || typeof RTCPeerConnection !== 'function' ||
      typeof MediaStream !== 'function' || typeof AbortController !== 'function') {
    return '当前浏览器缺少加密连接或 WebRTC 支持。请使用更新版 Edge 或 Chrome。';
  }
  return '';
}

export function watchPeer(peer, abort, update, fail, negotiationTimeout = 35000) {
  let disconnected;
  const timeout = setTimeout(() => fail('画面连接超时。请确认对方已完成协商；若两端网络限制直连，需要双方网络允许的媒体中继。'), negotiationTimeout);
  abort.addEventListener('abort', () => {
    clearTimeout(timeout);
    clearTimeout(disconnected);
    peer.close();
  }, {once: true});
  const event = 'connectionState' in peer ? 'connectionstatechange' : 'iceconnectionstatechange';
  peer.addEventListener(event, () => {
    if (abort.aborted) return;
    clearTimeout(disconnected);
    switch (peerState(peer)) {
      case 'connected': clearTimeout(timeout); update('已连接'); break;
      case 'disconnected':
        update('连接中断，正在恢复');
        disconnected = setTimeout(() => fail('网络连接已中断。'), 5000);
        break;
      case 'failed': case 'closed': fail('会话已结束，或当前网络无法互通。'); break;
    }
  });
}

const screen = $('screen');
const video = $('video');
const updateLocalAddress = trackLocalAddress('endpoint', 'endpoint-hint');
let session;
let deviceBookmark;
let savePairedDevice;
let signPairedDevice;

export function configureSavedPeer(save, profile, sign) {
  signPairedDevice = sign;
  function render(current) {
    $('saved-peer').hidden = !current.peerKey;
    $('saved-address').textContent = current.peerAddress;
    $('saved-connect').onclick = () => {
      if (session) return;
      $('endpoint').value = current.peerAddress;
      updateLocalAddress();
      $('key').value = current.peerKey;
      $('connect').querySelector('button[type=submit]').click();
    };
    $('forget-peer').onclick = async () => {
      if (session) return;
      try {
        render(await save('', ''));
        status('status', '已从本机移除配对记录。');
      } catch { status('status', '无法移除配对记录。', true); }
    };
  }
  savePairedDevice = async (address, key) => render(await save(address, key));
  render(profile);
}

function updateRemember() {
  const canRemember = !!savePairedDevice && credentialKind($('key').value.trim()) === 'pair';
  $('remember-row').hidden = !canRemember;
  if (!canRemember) $('remember-peer').checked = false;
}

function end(message, error = false) {
  if (!session) return;
  session.abort.abort();
  session = undefined;
  video.srcObject = null;
  if (document.fullscreenElement === screen) document.exitFullscreen().catch(() => {});
  $('session').hidden = true;
  screen.hidden = false;
  $('connect-panel').hidden = false;
  $('support').hidden = false;
  $('connect').querySelector('button[type=submit]').disabled = false;
  $('cancel').hidden = true;
  $('mode-share').disabled = false;
  status('status', message, error);
}

function bindInput(channel, abort) {
  let pendingMove, frame;
  const listeners = [];
  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  }
  function send(message, urgent = false) {
    if (channel.readyState === 'open' && channel.bufferedAmount < (urgent ? 128 : 16) * 1024) {
      channel.send(JSON.stringify(message));
    }
  }
  function position(event, clamp = false) {
    if (!video.videoWidth || !video.videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    const x = (event.clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return {x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y))};
  }
  function discardMove() {
    cancelAnimationFrame(frame);
    pendingMove = undefined;
    frame = undefined;
  }
  const release = () => { discardMove(); send({kind: 'release'}, true); };
  for (const name of ['pointerdown', 'pointerup']) {
    listen(screen, name, event => {
      const down = name === 'pointerdown';
      const point = position(event, !down);
      if (!point || event.button < 0 || event.button > 2) return;
      event.preventDefault();
      if (down) {
        screen.focus({preventScroll: true});
        if (screen.setPointerCapture && event.pointerId != null) screen.setPointerCapture(event.pointerId);
      }
      discardMove();
      send({kind: 'button', button: event.button, down, ...point}, true);
    });
  }
  listen(screen, 'pointermove', event => {
    if (document.activeElement !== screen) return;
    const point = position(event, !!event.buttons);
    if (!point) return;
    pendingMove = {kind: 'move', ...point};
    if (frame === undefined) frame = requestAnimationFrame(() => {
      if (pendingMove) send(pendingMove);
      discardMove();
    });
  });
  listen(screen, 'pointercancel', release);
  listen(screen, 'contextmenu', event => event.preventDefault());
  listen(screen, 'wheel', event => {
    const point = position(event);
    if (!point) return;
    event.preventDefault();
    const factor = event.deltaMode === 0 ? 2 : 120;
    const bound = delta => Math.max(-960, Math.min(960, Math.round(delta * factor)));
    send({kind: 'wheel', wheel: -bound(event.deltaY), pan: bound(event.deltaX), ...point});
  }, {passive: false});
  for (const name of ['keydown', 'keyup']) {
    listen(screen, name, event => {
      if (event.isComposing || !event.code) return;
      event.preventDefault();
      send({kind: 'key', code: event.code, down: name === 'keydown'}, true);
    });
  }
  listen(screen, 'blur', release);
  listen(window, 'blur', release);
  listen(document, 'visibilitychange', () => { if (document.hidden) release(); });
  abort.addEventListener('abort', () => {
    release();
    listeners.forEach(remove => remove());
  }, {once: true});
  listen($('text-form'), 'submit', event => {
    event.preventDefault();
    const input = $('send-text');
    if (input.value) send({kind: 'text', text: input.value}, true);
    input.value = '';
  });
  $('input-tip').hidden = false;
  $('text-form').hidden = false;
}

function watchStats(peer, abort) {
  const timer = setInterval(async () => {
    try {
      const stats = await peer.getStats();
      if (abort.aborted) return;
      const entries = [...stats.values()];
      const media = entries.find(item => item.type === 'inbound-rtp' && item.kind === 'video');
      const id = entries.find(item => item.type === 'transport' && item.selectedCandidatePairId)?.selectedCandidatePairId;
      const pair = stats.get(id);
      const relay = [pair?.localCandidateId, pair?.remoteCandidateId].some(id => stats.get(id)?.candidateType === 'relay');
      const latency = pair?.currentRoundTripTime;
      $('stats').textContent = [media?.frameWidth && `${media.frameWidth} × ${media.frameHeight}`,
        media?.framesPerSecond !== undefined && `${Math.round(media.framesPerSecond)} FPS`,
        latency !== undefined && `${Math.round(latency * 1000)} ms RTT`, pair && (relay ? 'TURN 中继' : '直连')].filter(Boolean).join(' · ');
    } catch { /* Closing a peer can interrupt statistics collection. */ }
  }, 1000);
  abort.addEventListener('abort', () => clearInterval(timer), {once: true});
}

async function connect(event) {
  event.preventDefault();
  if (session) return;
  const issue = compatibilityIssue();
  if (issue) return status('status', issue, true);
  const abort = new AbortController();
  let wait;
  session = {abort};
  $('connect').querySelector('button[type=submit]').disabled = true;
  $('mode-share').disabled = true;
  $('cancel').hidden = false;
  $('key').type = 'password';
  $('reveal').textContent = '显示';
  $('reveal').ariaLabel = '显示密钥';
  try {
    const manual = !deviceBookmark && $('manual-control').checked;
    const address = manual ? publicSignal : endpoint($('endpoint').value);
    let credential;
    if (deviceBookmark) {
      const password = $('device-password').value;
      $('device-password').value = '';
      credential = await unlockBookmark(deviceBookmark, password);
      if (abort.signal.aborted) return;
    } else credential = $('key').value.trim();
    const kind = credentialKind(credential);
    const remember = kind === 'pair' && $('remember-peer').checked && savePairedDevice;
    if (manual && kind !== 'invite') throw new Error('手动连接请使用共享方生成的一次性 RD1 邀请。');
    if (!kind) throw new Error('请输入完整的 RD1 邀请或 RD2 长期配对码。');
    status('status', kind === 'pair' ? '正在查找配对设备…' : '正在发送连接请求…');
    wait = timeLimit(abort.signal, invitationLimit);
    const handshake = wait.signal;
    let invitation = credential;
    if (kind === 'pair') {
      const directory = await PairTicket.open(address, credential);
      invitation = await directory.read(handshake);
    }
    const Transport = manual ? (await import('./manual.mjs?v=pair3')).ManualSignal : Signal;
    if (abort.signal.aborted) return;
    const signal = await Transport.open(address, invitation, 1, handshake);
    if (manual) abort.signal.addEventListener('abort', () => signal.finish(), {once:true});
    if (abort.signal.aborted) { if (manual) signal.finish(); return; }
    const nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
    const proof = kind === 'pair' && signPairedDevice ? await signPairedDevice({invitation, nonce, phase: 'request'}) : undefined;
    await signal.send('request', {version: 1, nonce, proof});
    $('key').value = '';
    updateRemember();
    status('status', `等待对方接入。首次连接请与对方核对确认码 ${confirmationCode(nonce)}。`);
    const offer = await signal.next('offer');
    if (abort.signal.aborted) return;
    if (offer?.nonce !== nonce || offer.description?.type !== 'offer' || typeof offer.description.sdp !== 'string') throw new Error('连接响应与当前请求不匹配。');
    const st = offer.ice?.find(item => typeof item.urls === 'string' && item.urls.startsWith('stun'));
    const tr = offer.ice?.find(item => typeof item.urls === 'string' && item.urls.startsWith('turn'));
    const peer = new RTCPeerConnection({iceServers: rtcServers(st?.urls, tr?.urls, tr?.username, tr?.credential)});
    $('connect-panel').hidden = true;
    $('support').hidden = true;
    $('session').hidden = false;
    $('screen-tip').hidden = false;
    $('screen-tip').textContent = '正在等待共享画面';
    $('play-video').hidden = true;
    $('fullscreen').hidden = !screen.requestFullscreen;
    $('input-tip').hidden = true;
    $('text-form').hidden = true;
    $('mute').hidden = true;
    $('stats').textContent = '';
    status('session-status', '正在协商连接');
    video.muted = true;
    const tracks = new MediaStream();
    video.srcObject = tracks;
    peer.ontrack = ({track}) => {
      tracks.addTrack(track);
      if (track.kind === 'audio') {
        $('mute').hidden = false;
        $('mute').textContent = '打开声音';
      }
    };
    const opened = new Set();
    peer.ondatachannel = ({channel}) => {
      if (opened.has(channel.label)) return channel.close();
      opened.add(channel.label);
      if (channel.label === 'files-v1') fileChannel(channel, abort.signal);
      else if (channel.label === 'input-v1') {
        if (channel.readyState === 'open') bindInput(channel, abort.signal);
        else channel.onopen = () => bindInput(channel, abort.signal);
      }
      else if (channel.label === 'session-v1') channel.onclose = () => { if (!abort.signal.aborted) end('共享方已结束会话。'); };
      else channel.close();
    };
    let saved = false;
    watchPeer(peer, abort.signal, message => {
      if (manual && message === '已连接') signal.finish();
      status('session-status', message === '已连接' && offer.unattended ? '已连接 · 受信任设备' : message);
      if (message === '已连接' && remember && !saved) {
        saved = true;
        remember(address, credential).catch(() => {
          if (!abort.signal.aborted) status('session-status', '已连接 · 配对码保存失败', true);
        });
      }
    }, m => end(m, true), manual ? 180000 : 35000);
    watchStats(peer, abort.signal);
    await peer.setRemoteDescription(offer.description);
    const description = await localDescription(peer, await peer.createAnswer(), handshake);
    const answerProof = proof ? await signPairedDevice({invitation, nonce, phase: 'answer', sdp: description.sdp}) : undefined;
    await signal.send('answer', {nonce, description, proof: answerProof});
  } catch (error) {
    if (!abort.signal.aborted) end(wait?.expired ? '连接请求已超时，请重新发起。' :
      error instanceof TypeError || error.name === 'AbortError' ? '连接请求未完成。请点「检测信令服务」。若服务不可达，可与共享方改用「手动交换连接信息」。' : error.message, true);
  } finally {
    wait?.dispose();
  }
}

$('connect').addEventListener('submit', connect);
$('key').addEventListener('input', updateRemember);
$('test-relay').onclick = async () => {
  const button = $('test-relay');
  button.disabled = true;
  const timeout = timeLimit(null, 8000);
  try {
    const url = endpoint($('endpoint').value);
    status('status', '正在从这台设备检测信令服务…');
    const reply = await fetch(url + '/healthz', {signal:timeout.signal, cache:'no-store', credentials:'omit', redirect:'error'});
    status('status', reply.status === 204 ? '这台设备可以访问信令服务。请让共享方也检查服务地址，并重新开启等待。' : '服务返回 HTTP ' + reply.status + '，请检查信令地址。', reply.status !== 204);
  } catch { status('status', '这台设备未能读取信令服务响应。可用手动交换连接信息，或向网络管理员确认此服务是否可访问。', true); }
  finally { timeout.dispose();button.disabled = false; }
};
for (const id of ['key', 'endpoint']) {
  $(id).addEventListener('paste', event => {
    const [address, invitation, extra] = event.clipboardData.getData('text').trim().split(/\r?\n/);
    if (extra !== undefined || !credentialKind(invitation || '')) return;
    try {
      $('endpoint').value = endpoint(address);
      updateLocalAddress();
      $('key').value = invitation;
      updateRemember();
      event.preventDefault();
    } catch { /* Let the browser paste ordinary text. */ }
  });
}
$('reveal').onclick = () => {
  const show = $('key').type === 'password';
  $('key').type = show ? 'text' : 'password';
  $('reveal').textContent = show ? '隐藏' : '显示';
  $('reveal').ariaLabel = `${$('reveal').textContent}密钥`;
};
$('cancel').onclick = $('disconnect').onclick = () => end('会话已结束。');
$('fullscreen').onclick = () => screen.requestFullscreen().catch(() => status('session-status', '此环境无法进入全屏。'));
$('mute').onclick = () => { video.muted = !video.muted; $('mute').textContent = video.muted ? '打开声音' : '静音'; };
function playVideo() {
  const stream = video.srcObject;
  if (!stream) return;
  Promise.resolve(video.play()).catch(() => {
    if (video.srcObject !== stream) return;
    $('screen-tip').textContent = '浏览器暂停了自动播放。';
    $('play-video').hidden = false;
  });
}
video.onloadedmetadata = $('play-video').onclick = playVideo;
video.onplaying = () => { $('screen-tip').hidden = $('play-video').hidden = true; };
window.addEventListener('pagehide', () => end('会话已结束。'));

const fragment = location.hash.slice(1);
if (location.pathname === '/desktop/' && location.hostname === '127.0.0.1' && /^[\w-]{43}$/.test(fragment)) {
  history.replaceState(null, '', location.pathname);
  document.querySelector('.brand').addEventListener('click', event => event.preventDefault());
  $('endpoint').value = publicSignal;
  import('./host.mjs').then(({startDesktop}) => startDesktop(fragment)).catch(error => status('status', error.message, true));
} else {
  $('back').hidden = $('win-guide').hidden = !location.pathname.startsWith('/toolbox/remote-control/');
  const fields = new URLSearchParams(fragment);
  if (fields.has('device')) {
    deviceBookmark = fields.get('device') || 'invalid';
    $('endpoint').value = publicSignal;
    $('endpoint').readOnly = true;
    $('key').required = false;
    $('key').parentElement.hidden = true;
    document.querySelector('label[for=key]').hidden = true;
    $('device-password-row').hidden = false;
    $('manual-control-row').hidden = true;
    $('device-password').required = true;
    $('device-password').focus();
  } else if (fragment) {
    $('manual-control').checked = fields.get('manual') === '1';
    $('endpoint').value = (fields.get('relay') || '').slice(0, 300);
    $('key').value = (fields.get('key') || '').slice(0, 70);
    history.replaceState(null, '', location.pathname + location.search);
  } else if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    $('endpoint').value = location.origin;
  } else {
    $('endpoint').value = publicSignal;
  }
}
updateLocalAddress();
const initialIssue = compatibilityIssue();
if (initialIssue) status('status', initialIssue, true);
