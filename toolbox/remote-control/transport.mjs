const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const publicSignal = 'https://treehouse-assist.vault-cloud.workers.dev';
export const invitationLimit = 2 * 60 * 60 * 1000;
const temporaryLimit = 5 * 60 * 1000;

// Use the original AbortController API on runtimes without AbortSignal.any/timeout.
export function timeLimit(parent, milliseconds) {
  const controller = new AbortController();
  let expired = false;
  function cancel() { controller.abort(); }
  const timer = setTimeout(() => { expired = true; cancel(); }, milliseconds);
  function dispose() {
    clearTimeout(timer);
    if (parent) parent.removeEventListener('abort', cancel);
  }
  controller.signal.addEventListener('abort', dispose, {once: true});
  if (parent) {
    if (parent.aborted) cancel();
    else parent.addEventListener('abort', cancel, {once: true});
  }
  return {signal: controller.signal, dispose, get expired() { return expired; }};
}

export function base64(data) {
  let binary = '';
  for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function from64(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

export function newInvitation() {
  return `RD1.${base64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function credentialKind(value) {
  if (/^RD1\.[A-Za-z0-9_-]{43}$/.test(value) && base64(from64(value.slice(4))) === value.slice(4)) return 'invite';
  const match = /^RD2\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (match && base64(from64(match[1])) === match[1] && base64(from64(match[2])) === match[2]) return 'pair';
  return '';
}

export class PairTicket {
  static async open(address, credential) {
    if (credentialKind(credential) !== 'pair') throw new Error('长期配对码格式有误。');
    const [, device, secret] = credential.split('.');
    const root = await crypto.subtle.importKey('raw', from64(secret), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const params = info => ({name: 'HKDF', hash: 'SHA-256', salt: from64(device), info: encoder.encode(`YuanZhuo pairing v2 ${info}`)});
    const id = base64(await crypto.subtle.deriveBits(params('locator'), root, 128));
    const bearer = base64(await crypto.subtle.deriveBits(params('access'), root, 256));
    const cipher = await crypto.subtle.deriveKey(params('ticket'), root, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    return new PairTicket(`${endpoint(address)}/v1/pairs/${id}`, id, bearer, cipher);
  }

  constructor(url, id, bearer, cipher) {
    Object.assign(this, {url, id, bearer, cipher});
  }

  async request(method, options = {}) {
    const headers = {'X-Room-Key': this.bearer};
    if (method !== 'GET') {
      headers['X-Close-Key'] = this.owner;
      headers['X-Ticket-Tag'] = this.tag;
    }
    if (options.createKey) headers['X-Create-Key'] = options.createKey;
    const limit = timeLimit(options.signal, method === 'DELETE' ? 4000 : 10000);
    try {
      const response = await fetch(this.url, {
        method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: limit.signal, body: options.body, keepalive: method === 'DELETE',
      });
      return {status: response.status, ok: response.ok, text: response.ok && method === 'GET' ? await response.text() : ''};
    } finally { limit.dispose(); }
  }

  async publish(invitation, owner, createKey, signal) {
    this.owner = owner;
    this.tag = base64(crypto.getRandomValues(new Uint8Array(16)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(this.id)}, this.cipher, encoder.encode(invitation));
    const envelope = new Uint8Array(12 + cipher.byteLength);
    envelope.set(iv);
    envelope.set(new Uint8Array(cipher), 12);
    const response = await this.request('PUT', {body: base64(envelope), createKey, signal});
    if (response.status === 409) throw new Error('这台设备已有长期监听。请停止旧客户端，或等待旧监听过期。');
    if (response.status !== 201) throw new Error('长期监听发布失败。请更新信令服务，并核对建房口令。');
  }

  async read(signal) {
    const response = await this.request('GET', {signal});
    if (response.status === 404) throw new Error('配对设备当前未在等待连接，或信令服务尚未升级。');
    if (!response.ok) throw new Error(`信令服务返回 ${response.status}。`);
    const {text} = response;
    if (!/^[A-Za-z0-9_-]{38,768}$/.test(text)) throw new Error('配对响应格式有误。');
    const bytes = from64(text);
    const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(this.id)}, this.cipher, bytes.slice(12));
    const invitation = decoder.decode(plain);
    if (credentialKind(invitation) !== 'invite') throw new Error('配对响应格式有误。');
    return invitation;
  }

  async remove() {
    if (this.owner) await this.request('DELETE');
  }
}

export function confirmationCode(nonce) {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) throw new Error('连接请求格式有误。');
  const bytes = from64(nonce);
  if (base64(bytes) !== nonce) throw new Error('连接请求格式有误。');
  const number = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return String(number).padStart(6, '0');
}

export function endpoint(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整的信令服务地址。'); }
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('信令服务须使用 HTTPS 域名，或本机 HTTP 地址。');
  }
  return url.origin;
}

export function isLoopback(address) {
  try { return ['127.0.0.1', '[::1]', 'localhost'].includes(new URL(address).hostname); }
  catch { return false; }
}

export class Signal {
  static async open(address, invitation, role, abort) {
    if (credentialKind(invitation) !== 'invite') throw new Error('一次性密钥格式有误。');
    const bytes = from64(invitation.slice(4));
    const root = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const params = info => ({name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('YuanZhuo v1'), info: encoder.encode(info)});
    const room = base64(await crypto.subtle.deriveBits(params('room'), root, 128));
    const bearer = base64(await crypto.subtle.deriveBits(params('relay authorization'), root, 256));
    const key = (direction, use) => crypto.subtle.deriveKey(params(`signaling ${direction}`), root,
      {name: 'AES-GCM', length: 256}, false, [use]);
    const outgoing = await key(role, 'encrypt');
    const incoming = await key(1 - role, 'decrypt');
    return new Signal(`${endpoint(address)}/v1/rooms/${room}`, bearer, role, outgoing, incoming, abort);
  }

  constructor(url, bearer, role, outgoing, incoming, abort) {
    Object.assign(this, {url, bearer, role, outgoing, incoming, abort});
    this.read = 0;
    this.written = 0;
    this.pending = [];
  }

  async request(method, query = '', body, createKey = '') {
    const headers = {'X-Room-Key': this.bearer};
    if (createKey) headers['X-Create-Key'] = createKey;
    if (method === 'PUT' || method === 'DELETE') headers['X-Close-Key'] = this.closeKey;
    const limit = method === 'DELETE' ? timeLimit(null, 4000) : timeLimit(this.abort, 20000);
    try {
      const response = await fetch(this.url + query, {
        method, body, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: limit.signal, keepalive: method === 'DELETE', headers,
      });
      if (response.status === 404) throw new Error('邀请不存在、已过期，或信令地址不正确。');
      if (response.status === 409) throw new Error('邀请冲突或已使用，请重新生成。');
      if (method === 'PUT' && response.status === 403) throw new Error('信令服务拒绝建房，请检查建房口令。');
      if (!response.ok) throw new Error(`信令服务返回 ${response.status}。`);
      return {headers: response.headers, messages: method === 'GET' && response.status !== 204 ? await response.json() : []};
    } finally { limit.dispose(); }
  }

  async create(key, temporary) {
    this.closeKey = base64(crypto.getRandomValues(new Uint8Array(32)));
    const {headers} = await this.request('PUT', temporary ? '?temporary=1' : '', undefined, key);
    // Releases through v0.2 omit this header and keep their five-minute lifetime.
    const lifetime = Number(headers.get('X-Invite-Lifetime')) * 1000;
    return lifetime === invitationLimit ? lifetime : temporaryLimit;
  }

  remove() { return this.request('DELETE'); }

  aad(direction, sequence) { return encoder.encode(`${this.url.slice(this.url.lastIndexOf('/') + 1)}:${direction}:${sequence}`); }

  async send(type, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const options = {name: 'AES-GCM', iv, additionalData: this.aad(this.role, this.written)};
    const cipher = await crypto.subtle.encrypt(options, this.outgoing, encoder.encode(JSON.stringify({type, data})));
    const envelope = new Uint8Array(12 + cipher.byteLength);
    envelope.set(iv);
    envelope.set(new Uint8Array(cipher), 12);
    await this.request('POST', `?role=${this.role}`, base64(envelope));
    this.written++;
  }

  async next(type) {
    while (!this.pending.length) {
      const {messages} = await this.request('GET', `?role=${this.role}&after=${this.read}`);
      this.pending = messages;
      if (!Array.isArray(this.pending) || this.pending.length > 4) throw new Error('信令响应格式有误。');
    }
    const message = this.pending.shift();
    if (typeof message !== 'string' || message.length > 81920) throw new Error('信令消息格式有误。');
    const envelope = from64(message);
    const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: envelope.slice(0, 12),
      additionalData: this.aad(1 - this.role, this.read)}, this.incoming, envelope.slice(12));
    const {type: actual, data} = JSON.parse(decoder.decode(plain));
    this.read++;
    if (actual === 'denied') throw new Error('共享端本次只接受已登记的 Windows 控制端。');
    if (actual !== type) throw new Error('邀请已经处理，请重新生成。');
    return data;
  }
}

export function rtcServers(stun, turn, username, credential) {
  const servers = [];
  if (stun) {
    if (!/^stuns?:[A-Za-z0-9.:[\]-]+$/.test(stun)) throw new Error('STUN 地址格式有误。');
    servers.push({urls: stun});
  }
  if (turn) {
    if (!/^turns?:[A-Za-z0-9.:[\]-]+(?:\?transport=(?:udp|tcp))?$/.test(turn) || !username || !credential) {
      throw new Error('请检查 TURN 地址、用户名和密码。');
    }
    servers.push({urls: turn, username, credential});
  }
  return servers;
}

export async function localDescription(peer, description, abort) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== 'complete') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(), 8500);
      function finish(error) {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onState);
        abort.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve();
      }
      function onState() { if (peer.iceGatheringState === 'complete') finish(); }
      function onAbort() { finish(new DOMException('连接已取消。', 'AbortError')); }
      peer.addEventListener('icegatheringstatechange', onState);
      abort.addEventListener('abort', onAbort);
      if (abort.aborted) onAbort(); else onState();
    });
  }
  const {type, sdp} = peer.localDescription;
  return {type, sdp};
}
