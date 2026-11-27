const SLOTS = ['mic', 'camera', 'screen']

export class MeetingMedia {
  constructor({ self, iceServers, send, remote, status }) {
    this.self = self
    this.iceServers = iceServers
    this.send = send
    this.remote = remote
    this.status = status
    this.peers = new Map()
    this.tracks = new Map()
  }

  add(id) {
    if (id === this.self || this.peers.has(id)) return
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' })
    const peer = { id, pc, leader: this.self < id, queue: Promise.resolve(), candidates: [], pendingRestart: false, lastRestart: 0 }
    this.peers.set(id, peer)
    if (peer.leader) {
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      this.enqueue(peer, async () => {
        await this.sync(peer)
        await pc.setLocalDescription(await pc.createOffer())
        this.signal(id, { kind: 'description', description: pc.localDescription })
      })
    }
    pc.onicecandidate = event => {
      if (event.candidate) this.signal(id, { kind: 'candidate', candidate: event.candidate.toJSON() })
    }
    pc.ontrack = event => {
      const slot = SLOTS[pc.getTransceivers().indexOf(event.transceiver)]
      if (slot && event.track.kind === (slot === 'mic' ? 'audio' : 'video')) this.remote(id, slot, new MediaStream([event.track]))
    }
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return
      this.status(id, pc.connectionState)
      clearTimeout(peer.recoveryTimer)
      if (pc.connectionState === 'connected') peer.recoveryAttempts = 0
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.scheduleRecovery(peer)
      }
    }
  }

  scheduleRecovery(peer) {
    const attempts = peer.recoveryAttempts ?? 0
    if (attempts >= 3) return
    const delay = Math.max(attempts ? 9000 : 1800, 8100 - (Date.now() - peer.lastRestart))
    peer.recoveryTimer = setTimeout(() => {
      if (this.peers.get(peer.id) !== peer || !['failed', 'disconnected'].includes(peer.pc.connectionState)) return
      peer.recoveryAttempts = attempts + 1
      this.requestRestart(peer)
      this.scheduleRecovery(peer)
    }, delay)
  }

  enqueue(peer, action) {
    peer.queue = peer.queue.then(() => {
      if (this.peers.get(peer.id) === peer) return action()
    }).catch(() => {
      if (this.peers.get(peer.id) === peer) this.status(peer.id, 'failed')
    })
    return peer.queue
  }

  signal(to, signal) {
    this.send({ type: 'signal', to, signal })
  }

  async sync({ pc }) {
    await Promise.all(pc.getTransceivers().map(async (transceiver, index) => {
      const slot = SLOTS[index]
      if (!slot) return
      transceiver.direction = 'sendrecv'
      const track = this.tracks.get(slot) ?? null
      if (transceiver.sender.track !== track) await transceiver.sender.replaceTrack(track)
      if (track && slot !== 'mic') {
        const parameters = transceiver.sender.getParameters()
        if (!parameters.encodings?.length) return
        parameters.encodings[0].maxBitrate = slot === 'screen' ? 850000 : 400000
        try { await transceiver.sender.setParameters(parameters) } catch { /* Optional encoding preference */ }
      }
    }))
  }

  replace(slot, track) {
    this.tracks.set(slot, track)
    return Promise.all([...this.peers.values()].map(peer => this.enqueue(peer, () => this.sync(peer))))
  }

  requestRestart(peer) {
    if (this.peers.get(peer.id) !== peer || Date.now() - peer.lastRestart < 8000) return
    peer.lastRestart = Date.now()
    if (peer.leader) this.restart(peer)
    else this.signal(peer.id, { kind: 'restart' })
  }

  restart(peer) {
    this.enqueue(peer, async () => {
      const { pc } = peer
      if (pc.signalingState !== 'stable') { peer.pendingRestart = true; return }
      peer.pendingRestart = false
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }))
      this.signal(peer.id, { kind: 'description', description: pc.localDescription })
    })
  }

  receive(id, signal) {
    const peer = this.peers.get(id)
    if (!peer) return
    if (signal.kind === 'restart') {
      if (peer.leader) this.requestRestart(peer)
      return
    }
    this.enqueue(peer, async () => {
      const { pc } = peer
      if (signal.kind === 'candidate') {
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(signal.candidate) } catch { /* Old ICE generation */ }
        } else if (peer.candidates.length < 80) peer.candidates.push(signal.candidate)
        return
      }
      const { description } = signal
      const expected = peer.leader ? 'answer' : 'offer'
      const kinds = [...description.sdp.matchAll(/^m=(\w+)/gm)].map(match => match[1]).join(',')
      if (description.type !== expected || pc.getTransceivers().length > SLOTS.length || kinds !== 'audio,video,video') return
      await pc.setRemoteDescription(description)
      for (const candidate of peer.candidates.splice(0)) {
        try { await pc.addIceCandidate(candidate) } catch { /* Old ICE generation */ }
      }
      if (!peer.leader) {
        await this.sync(peer)
        await pc.setLocalDescription(await pc.createAnswer())
        this.signal(id, { kind: 'description', description: pc.localDescription })
      } else {
        await this.sync(peer)
        if (peer.pendingRestart) this.restart(peer)
      }
    })
  }

  remove(id) {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    clearTimeout(peer.recoveryTimer)
    peer.pc.close()
  }

  close() {
    for (const id of this.peers.keys()) this.remove(id)
  }
}
