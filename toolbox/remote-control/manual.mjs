import {Signal, invitationLimit} from './transport.mjs?v=media4';

const el = id => document.getElementById(id);
let active;

// Exchange the same authenticated messages through the two users' clipboard.
// This transport has no network endpoint and never handles screen or input data.
export class ManualSignal extends Signal {
  constructor(...args) {
    super(...args);
    active = this;
    el('manual-panel').hidden = false;
    el('manual-out').hidden = true;
    el('manual-in').hidden = true;
    el('manual-status').textContent = '';
    this.abort.addEventListener('abort', () => this.finish(), {once:true});
  }
  finish() {
    if (active !== this) return;
    this.pendingInput?.();
    el('manual-panel').hidden = true;
    el('manual-export').value = el('manual-import').value = '';
    active = undefined;
  }
  create() { return Promise.resolve(invitationLimit); }
  remove() { this.finish(); return Promise.resolve(); }

  async request(method, _query, body) {
    if (this.abort.aborted || active !== this) throw new DOMException('已取消', 'AbortError');
    const room = this.url.split('/').pop();
    if (method === 'POST') {
      const kind = this.role === 0 ? '共享应答' : this.written === 0 ? '连接请求' : '连接回执';
      el('manual-export-label').textContent = '发给对方 · ' + kind;
      el('manual-export').value = ['YZ1',room,this.role,this.written,body].join('.');
      el('manual-out').hidden = false;
      el('manual-status').textContent = '复制上方完整文本，私发给对方。';
      return {};
    }
    if (method !== 'GET') throw new Error('手动协商步骤有误。');
    const prefix = ['YZ1',room,1-this.role,this.read,''].join('.');
    const kind = this.role === 1 ? '共享应答' : this.read === 0 ? '连接请求' : '连接回执';
    el('manual-import-label').textContent = '粘贴对方发来的' + kind;
    el('manual-in').hidden = false;
    return new Promise((resolve,reject) => {
      const abort = this.abort;
      const clean = () => {
        abort.removeEventListener('abort', cancel);
        el('manual-submit').onclick = null;
        el('manual-in').hidden = true;
        this.pendingInput = undefined;
      };
      const cancel = () => { clean(); reject(new DOMException('已取消','AbortError')); };
      this.pendingInput = cancel;
      abort.addEventListener('abort', cancel, {once:true});
      el('manual-submit').onclick = () => {
        const packet = el('manual-import').value.trim();
        const data = packet.slice(prefix.length);
        if (!packet.startsWith(prefix) || !/^[\w-]{38,81920}$/.test(data)) {
          el('manual-status').textContent = '这段文字与当前邀请或步骤不符。请复制对方最新的完整文本。';return;
        }
        el('manual-import').value = '';
        el('manual-out').hidden = true;
        el('manual-status').textContent = '已接收，正在处理。';
        clean(); resolve({messages:[data]});
      };
    });
  }
}
el('manual-copy').onclick = async () => {
  const field = el('manual-export');
  try {await navigator.clipboard.writeText(field.value);el('manual-status').textContent = '已复制，可以私发给对方。';}
  catch {field.select();el('manual-status').textContent = '已选中文本，请按 Ctrl+C 复制。';}
};

