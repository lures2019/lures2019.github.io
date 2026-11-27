// PeerJS Cloud provides signaling. A self-hosted deployment can set
// host/port/path/secure and supply its own ICE servers. Avoid publishing
// private TURN credentials in this static file.
export const peerOptions = {
  config: {
    iceServers: [{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}],
  },
};
