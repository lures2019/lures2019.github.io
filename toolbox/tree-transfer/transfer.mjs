const encoder = new TextEncoder();
const CHUNK = 48 * 1024;
const WINDOW = 4 * 1024 * 1024;
const CREDIT_STEP = 512 * 1024;

export function invite() {
  return 'ST1.' + hex(crypto.getRandomValues(new Uint8Array(16)));
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function readPairingCode(input) {
  const code = input.trim().normalize('NFC');
  if (code.startsWith('ST1.')) {
    if (!/^ST1\.[0-9a-f]{32}$/.test(code)) throw new Error('随机密钥格式有误，请粘贴完整密钥。');
    return {code,custom:false};
  }
  const length = Array.from(code).length;
  if (length < 8 || length > 64 || /\p{Cc}/u.test(code)) {
    throw new Error('请输入 8–64 个字符的自定义密钥，或粘贴完整的随机密钥。');
  }
  return {code,custom:true};
}

const hmac = {name:'HMAC', hash:'SHA-256'};

async function identity({code,custom}) {
  if (custom) {
    // The room identifier and the channel proof key use separate derivations.
    const password = await crypto.subtle.importKey('raw',encoder.encode(code),'PBKDF2',false,['deriveKey']);
    const root = await crypto.subtle.deriveKey({
      name:'PBKDF2', hash:'SHA-256', iterations:600000, salt:encoder.encode('TreeTransfer/1 custom pairing'),
    },password,{...hmac,length:256},false,['sign']);
    const [room,proof] = await Promise.all(['room','proof'].map(label =>
      crypto.subtle.sign('HMAC',root,encoder.encode(label))));
    const key = await crypto.subtle.importKey('raw',proof,hmac,false,['sign','verify']);
    return {id:'tree-transfer-custom-' + hex(room).slice(0,40),key,custom};
  }
  const id = hex(await crypto.subtle.digest('SHA-256', encoder.encode('TreeTransfer/1 room ' + code)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(code), hmac, false, ['sign','verify']);
  return {id:'tree-transfer-' + id.slice(0,40),key,custom};
}

function fingerprint(description) {
  const value = description?.sdp.match(/^a=fingerprint:sha-256 ([\dA-Fa-f:]{95})\s*$/m)?.[1];
  if (!value) throw new Error('无法验证设备的加密指纹。');
  return value.toUpperCase();
}

function clock(message, delay) {
  let timer;
  return {
    promise: new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), delay); }),
    clear: () => clearTimeout(timer),
  };
}

export class Pair {
  constructor(ui, config) {
    this.ui = ui;
    this.config = config;
    this.active = true;
    this.pending = [];
    this.backlog = 0;
  }

  async start(credential, generated) {
    this.credentials = await identity(credential);
    if (!this.active) return;
    this.openPeer(generated || credential.custom);
  }

  openPeer(host) {
    this.host = host;
    this.signalDown = false;
    const options = {debug: 0, ...this.config};
    const peer = host ? new Peer(this.credentials.id, options) : new Peer(options);
    this.peer = peer;
    const current = () => this.active && this.peer === peer;
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => this.fail(new Error('无法连接信令服务，请检查网络后重试。')), 25000);
    peer.on('open', () => {
      if (!current()) return;
      clearTimeout(this.connectTimer);
      this.signalDown = false;
      if (this.channel) return;
      if (host) this.ui.status('等待对方');
      else {
        try { this.attach(peer.connect(this.credentials.id, {serialization:'raw', reliable:true})); }
        catch (error) { this.fail(error); }
      }
    });
    peer.on('connection', channel => {
      if (!current() || !host || this.channel) channel.close();
      else this.attach(channel);
    });
    peer.on('disconnected', () => {
      if (!current()) return;
      this.signalDown = true;
      if (!this.channel) this.ui.status('信令重连中');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        if (current() && peer.disconnected && !peer.destroyed) peer.reconnect();
      }, 2000);
    });
    peer.on('error', error => {
      if (!current()) return;
      if (error.type === 'unavailable-id' && this.credentials.custom && host && !this.channel) {
        this.peer = null;
        peer.destroy();
        this.ui.status('正在连接');
        try { this.openPeer(false); }
        catch (failure) { this.fail(failure); }
        return;
      }
      if (this.authenticated && ['network', 'disconnected', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) return;
      if (host && this.signalDown && ['network','socket-error','socket-closed'].includes(error.type) && !this.peer.destroyed) return;
      const explanations = {
        'peer-unavailable':'找不到对方。请确认密钥正确，并确认对方页面仍在等待。',
        'unavailable-id':'这组密钥正在使用，请换一组密钥。',
        'network':'无法连接信令服务，请检查网络后重试。',
        'socket-error':'无法连接信令服务，请检查网络后重试。',
        'socket-closed':'信令连接已关闭，请稍后重试。',
      };
      this.fail(new Error(explanations[error.type] || '建立在线连接失败。'));
    });
  }

  attach(channel) {
    if (!channel) throw new Error('无法创建传输通道。');
    this.channel = channel;
    this.ui.status('正在验证');
    this.authTimer = setTimeout(() => this.rejected(new Error('连接超时。请检查双方网络，或切换网络后重新连接。')), 25000);
    channel.on('close', () => {
      if (this.channel === channel) this.rejected(new Error('对方已离开，或网络连接已中断。'));
    });
    channel.on('error', () => {
      if (this.channel === channel) this.rejected(new Error('传输通道异常。请重新配对。'));
    });
    channel.on('open', () => {
      if (this.channel !== channel || !this.active) return;
      const pc = channel.peerConnection;
      pc.addEventListener('connectionstatechange', () => {
        if (this.channel !== channel) return;
        clearTimeout(this.iceTimer);
        if (pc.connectionState === 'failed') this.rejected(new Error('网络连接中断。'));
        if (pc.connectionState === 'disconnected') {
          this.iceTimer = setTimeout(() => this.rejected(new Error('网络连接中断。')), 8000);
        }
      });
      try {
        const local = fingerprint(pc.localDescription);
        const remote = fingerprint(pc.remoteDescription);
        this.fingerprints = this.host ? [local, remote] : [remote, local];
        this.nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
        this.send({type:'hello', nonce:this.nonce});
      } catch (error) { this.rejected(error); }
    });
    channel.on('data', item => {
      if (this.channel !== channel || !this.active) return;
      this.backlog += typeof item === 'string' ? item.length * 2 : item.byteLength;
      if (this.backlog > 2 * WINDOW) return this.rejected(new Error('对方发送的数据超出接收队列。'));
      this.pending.push(item);
      if (!this.draining) void this.drain(channel);
    });
  }

  async drain(channel) {
    this.draining = true;
    try {
      while (this.active && this.channel === channel && this.pending.length) {
        const item = this.pending.shift();
        await this.handle(item);
        if (this.channel !== channel) break;
        this.backlog -= typeof item === 'string' ? item.length * 2 : item.byteLength;
      }
    } catch (error) { if (this.channel === channel) this.rejected(error); }
    finally {
      this.draining = false;
      if (this.active && this.channel && this.pending.length) void this.drain(this.channel);
    }
  }

  transcript(host) {
    const nonces = this.host ? [this.nonce, this.remoteNonce] : [this.remoteNonce, this.nonce];
    return encoder.encode(['TreeTransfer/1', host ? 'host' : 'guest', ...this.fingerprints, ...nonces].join('|'));
  }

  send(value) {
    const dc = this.channel?.dataChannel;
    if (dc?.readyState !== 'open') throw new Error('对方连接已关闭。');
    dc.send(value instanceof ArrayBuffer ? value : JSON.stringify(value));
  }

  async handle(item) {
    if (typeof item !== 'string') return this.receiveChunk(item);
    if (item.length > 192 * 1024) throw new Error('消息过长。');
    const message = JSON.parse(item);
    if (!this.authenticated) {
      if (message.type === 'hello' && !this.remoteNonce && this.nonce && /^[0-9a-f]{32}$/.test(message.nonce)) {
        this.remoteNonce = message.nonce;
        const proof = hex(await crypto.subtle.sign('HMAC', this.credentials.key, this.transcript(this.host)));
        this.send({type:'proof', proof});
        return;
      }
      if (message.type !== 'proof' || !this.remoteNonce || !/^[0-9a-f]{64}$/.test(message.proof)) throw new Error('配对验证失败。');
      const proof = Uint8Array.from(message.proof.match(/../g), part => Number.parseInt(part,16));
      if (!await crypto.subtle.verify('HMAC', this.credentials.key, proof, this.transcript(!this.host))) throw new Error('对方未通过配对密钥验证。');
      this.authenticated = true;
      clearTimeout(this.authTimer);
      this.ui.status('已连接', true);
      return;
    }
    switch (message.type) {
      case 'offer': return this.offer(message);
      case 'answer': return this.updateOutgoing(message, 'answer');
      case 'credit': return this.updateOutgoing(message, 'credit');
      case 'saved': return this.updateOutgoing(message, 'saved');
      case 'file': return this.openIncoming(message);
      case 'end': return this.finishIncoming(message);
      default: throw new Error('收到未知的传输消息。');
    }
  }

  async offer({id, files}) {
    if (typeof id !== 'string' || !/^[\da-f]{24}$/.test(id) || !Array.isArray(files) || !files.length || files.length > 256 ||
        files.some(file => typeof file?.name !== 'string' || !file.name || file.name.length > 255 || !Number.isSafeInteger(file.size) || file.size < 0)) {
      throw new Error('收到无效的文件清单。');
    }
    if (this.outgoing || this.incoming) {
      this.send({type:'answer', id, accepted:false, busy:true});
      return;
    }
    const incoming = {id, files, index:0};
    this.incoming = incoming;
    this.ui.ready(false);
    void Promise.resolve(this.ui.consent(files)).then(sink => {
      if (this.incoming !== incoming || !this.active) return;
      if (!sink) {
        this.incoming = null;
        this.ui.ready(true);
        this.send({type:'answer', id, accepted:false});
        return;
      }
      incoming.sink = sink;
      this.send({type:'answer', id, accepted:true});
    }).catch(error => this.rejected(error));
  }

  async openIncoming({id, index}) {
    const task = this.incoming;
    if (task?.id !== id || !task.sink || index !== task.index || task.file || index >= task.files.length) throw new Error('收到意外的文件。');
    const data = task.files[index];
    const file = {data, received:0, credited:0, started:performance.now()};
    task.file = file;
    file.hash = await hashwasm.createSHA256();
    file.writer = await task.sink(data);
    if (this.incoming !== task) { await file.writer.abort(); return; }
    this.ui.progress('接收', data, 0, file.started);
  }

  async receiveChunk(chunk) {
    const task = this.incoming;
    const file = task?.file;
    if (!this.authenticated || !file || !(chunk instanceof ArrayBuffer) ||
        !chunk.byteLength || chunk.byteLength > CHUNK || file.received + chunk.byteLength > file.data.size) {
      throw new Error('文件数据长度异常。');
    }
    await file.writer.write(chunk);
    if (this.incoming !== task) return;
    file.hash.update(new Uint8Array(chunk));
    file.received += chunk.byteLength;
    this.ui.progress('接收', file.data, file.received, file.started);
    if (file.received - file.credited >= CREDIT_STEP) {
      file.credited = file.received;
      this.send({type:'credit', id:task.id, index:task.index, bytes:file.received});
    }
  }

  async finishIncoming({id,index,digest}) {
    const task = this.incoming;
    const file = task?.file;
    if (task?.id !== id || index !== task.index || !file ||
        file.received !== file.data.size || file.hash.digest() !== digest) throw new Error('文件完整性校验失败，已丢弃未完成文件。');
    await file.writer.commit();
    if (this.incoming !== task) return;
    this.send({type:'saved',id,index});
    task.file = null;
    task.index++;
    if (task.index === task.files.length) {
      this.incoming = null;
      this.ui.ready(true);
      this.ui.complete('接收完成', task.index);
    }
  }

  updateOutgoing(message, type) {
    const task = this.outgoing;
    if (!task || message.id !== task.id) throw new Error('收到意外的传输回执。');
    if (type === 'answer' && !task.answer && typeof message.accepted === 'boolean') task.answer = message;
    else if (type === 'credit' && message.index === task.index && Number.isSafeInteger(message.bytes) &&
        message.bytes >= task.credited && message.bytes <= task.sent) task.credited = message.bytes;
    else if (type === 'saved' && task.ended && message.index === task.index) task.saved = true;
    else throw new Error('收到无效的传输回执。');
    task.wake?.();
  }

  async wait(task, done, timeout) {
    while (this.active && this.outgoing === task && !done()) {
      let timer;
      try {
        const wake = new Promise(resolve => { task.wake = resolve; });
        if (!timeout) await wake;
        else {
          timer = clock('传输长时间没有响应。请检查对方网络或保存磁盘。', timeout);
          await Promise.race([wake, timer.promise]);
        }
      } finally { timer?.clear(); task.wake = null; }
    }
    if (!this.active || this.outgoing !== task) throw new Error('连接已结束。');
  }

  async sendFiles(files) {
    if (!this.authenticated || this.outgoing || this.incoming || !files.length) return;
    if (files.length > 256) { this.ui.error('单次最多可选择 256 个文件，请分批发送。'); return; }
    const task = {id:hex(crypto.getRandomValues(new Uint8Array(12)))};
    this.outgoing = task;
    this.ui.ready(false);
    try {
      this.send({type:'offer', id:task.id, files: files.map(({name,size}) => ({name,size}))});
      this.ui.progress('等待接收方确认', {name:files.length + ' 个文件', size:0}, 0, performance.now());
      await this.wait(task, () => task.answer);
      if (!task.answer.accepted) {
        this.ui.complete(task.answer.busy ? '对方正在处理其他传输' : '对方拒绝了传输');
        return;
      }
      for (const [index, file] of files.entries()) {
        Object.assign(task, {index, sent:0, credited:0, saved:false, ended:false});
        const started = performance.now();
        const hash = await hashwasm.createSHA256();
        this.send({type:'file',id:task.id,index});
        this.ui.progress('发送',file,0,started);
        while (task.sent < file.size) {
          await this.wait(task, () => task.sent - task.credited < WINDOW, 90000);
          const chunk = await file.slice(task.sent, task.sent + CHUNK).arrayBuffer();
          if (!this.active || this.outgoing !== task) return;
          hash.update(new Uint8Array(chunk));
          this.send(chunk);
          task.sent += chunk.byteLength;
          this.ui.progress('发送',file,task.sent,started);
        }
        task.ended = true;
        this.send({type:'end',id:task.id,index,digest:hash.digest()});
        await this.wait(task, () => task.saved,90000);
      }
      this.ui.complete('发送完成',files.length);
    } catch (error) { if (this.active && this.outgoing === task) this.fail(error); }
    finally {
      if (this.outgoing === task) { this.outgoing = null; this.ui.ready(true); }
    }
  }

  rejected(error) {
    if (!this.active) return;
    if (!this.host || this.authenticated) { this.fail(error); return; }
    const channel = this.channel;
    this.channel = null;
    this.pending = [];
    this.backlog = 0;
    this.nonce = this.remoteNonce = null;
    clearTimeout(this.authTimer);
    clearTimeout(this.iceTimer);
    channel?.close();
    this.ui.status('等待对方');
    this.ui.error(error.message);
  }

  fail(error) {
    if (!this.active) return;
    this.stop();
    this.ui.ended(error);
  }

  stop() {
    this.active = false;
    clearTimeout(this.connectTimer);
    clearTimeout(this.authTimer);
    clearTimeout(this.iceTimer);
    clearTimeout(this.reconnectTimer);
    this.outgoing?.wake?.();
    void this.incoming?.file?.writer?.abort().catch(() => {});
    this.outgoing = this.incoming = null;
    this.pending = [];
    this.channel?.close();
    this.peer?.destroy();
  }
}
