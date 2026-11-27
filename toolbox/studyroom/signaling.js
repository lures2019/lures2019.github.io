const PING_INTERVAL = 15000
const PING_TIMEOUT = 45000
const LEGACY_RETRY_MS = 45000
export const disconnectMessages = {
  1008: '操作过于频繁，请稍后重新加入。',
  1009: '会议消息超出大小限制。',
  4401: '重连时限已过，请重新加入会议。',
  4403: '你已被房主移出会议。',
  4404: '当前会议服务找不到这个会议码。请确认房主仍在会中，并使用同一个会议服务。若房主用的是本机测试版，请切到线上会议重新建房。',
  4408: '会议人数已满。',
  4409: '此会议会话已在别处恢复。',
  4410: '房主已结束会议。',
  4423: '房主已锁定会议。',
  4425: '开房需要有效的房主密钥。受邀者可以直接输入会议码或打开邀请链接。'
}

export class MeetingSignal {
  constructor({ address, code, createKey, welcome, message, status, failure }) {
    this.address = address
    this.code = code
    this.createKey = createKey
    this.welcome = welcome
    this.message = message
    this.status = status
    this.failure = failure
    this.tries = 0
    this.wake = () => {
      if (!this.lostAt || this.socket || this.stopped) return
      clearTimeout(this.retry)
      this.dial()
    }
  }

  start() {
    window.addEventListener('online', this.wake)
    this.dial()
  }

  dial() {
    const url = new URL(this.address)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/signal/${this.code || 'create'}`
    let socket
    const protocols = this.token ? ['studyroom-resume', this.token] :
      this.createKey ? ['studyroom-create', this.createKey] : []
    this.createKey = undefined
    try { socket = new WebSocket(url, protocols) }
    catch { this.fail('会议服务地址无效。'); return }
    this.socket = socket
    this.handshake = setTimeout(() => this.dropped(socket, 4000), 11500)
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return
      if (event.data === 'study-pong') {
        this.receivedAt = Date.now()
        return
      }
      let data
      try { data = JSON.parse(event.data) } catch { return }
      if (!data || typeof data !== 'object') return
      if (data.type === 'welcome' && !this.connected) {
        if (this.createdAt && this.createdAt !== data.createdAt) {
          this.fail('原会议已结束，请重新加入。')
          return
        }
        clearTimeout(this.handshake)
        const resumed = Boolean(this.lostAt)
        this.createdAt = data.createdAt
        this.code = data.code
        this.token = data.resumeToken
        this.retryWindow = Math.max(5000, (data.resumeMs ?? LEGACY_RETRY_MS) - 5000)
        this.receivedAt = Date.now()
        this.tries = 0
        this.lostAt = 0
        this.connected = true
        this.beginHeartbeat(socket)
        this.welcome(data, resumed)
        this.status(false)
      } else if (this.connected && data.type !== 'welcome') {
        this.receivedAt = Date.now()
        this.message(data)
      }
    })
    socket.addEventListener('close', event => this.dropped(socket, event.code))
  }

  beginHeartbeat(socket) {
    let lastTick = Date.now()
    const tick = () => {
      if (this.socket !== socket || !this.connected) return
      const now = Date.now()
      // A throttled tab or suspended device needs a fresh probe on wake.
      if (now - lastTick >= PING_INTERVAL * 2) this.receivedAt = now
      lastTick = now
      if (this.token && now - this.receivedAt >= PING_TIMEOUT) this.dropped(socket, 4000)
      else if (socket.readyState === WebSocket.OPEN) socket.send('study-ping')
    }
    tick()
    this.heartbeat = setInterval(tick, PING_INTERVAL)
  }

  send(message) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  dropped(socket, code) {
    if (this.socket !== socket) return
    clearTimeout(this.handshake)
    clearInterval(this.heartbeat)
    this.socket = null
    this.connected = false
    if (socket.readyState < WebSocket.CLOSING) socket.close(4000, 'signaling timeout')
    if (disconnectMessages[code]) { this.fail(disconnectMessages[code]); return }
    if (!this.createdAt) {
      this.fail('暂时连不上会议服务。请检查网络和连接设置。')
      return
    }
    if (!this.lostAt) {
      this.lostAt = Date.now()
      this.status(true)
    }
    const remaining = this.retryWindow - (Date.now() - this.lostAt)
    const delay = Math.min(8000, 400 * 2 ** this.tries++) + Math.random() * 300
    if (remaining < delay) {
      this.fail('自动重连超时。会议码已保留，网络恢复后可重新加入。')
      return
    }
    this.retry = setTimeout(() => this.dial(), delay)
  }

  fail(message) {
    this.stop()
    this.failure(message)
  }

  stop() {
    this.stopped = true
    this.connected = false
    window.removeEventListener('online', this.wake)
    clearTimeout(this.handshake)
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(4001, 'left')
  }
}
