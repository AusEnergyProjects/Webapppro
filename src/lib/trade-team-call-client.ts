import type { TeamCallParticipant, TeamCallSignal, TeamCallSignalPayload } from "./trade-team-calls";

export type CallRemote = { memberId: string; name: string; stream: MediaStream | null; state: RTCPeerConnectionState };
type Peer = { person: TeamCallParticipant; connection: RTCPeerConnection; candidates: RTCIceCandidateInit[]; stream: MediaStream | null; deadline?: ReturnType<typeof setTimeout> };
type SignalSender = (target: TeamCallParticipant, type: TeamCallSignal["type"], payload: TeamCallSignalPayload) => Promise<void>;

// One session owns all peer connections. Session IDs fence late packets from a
// previous tab or rejoin; the lower member ID makes the offer, avoiding glare.
export class TeamCallConnections {
  private peers = new Map<string, Peer>();
  private closed = false;
  private outgoing: Promise<void> = Promise.resolve();
  constructor(private readonly options: {
    memberId: string; sessionId: string; local: MediaStream; iceServers: RTCIceServer[];
    send: SignalSender; changed: (peers: CallRemote[]) => void; failed: (message: string) => void;
    createPeer?: (configuration: RTCConfiguration) => RTCPeerConnection;
  }) {}

  private changed() {
    if (!this.closed) this.options.changed([...this.peers.values()].map(peer => ({ memberId: peer.person.memberId, name: peer.person.name,
      stream: peer.stream, state: peer.connection.connectionState })));
  }

  private connectionDeadline(peer: Peer, milliseconds: number) {
    clearTimeout(peer.deadline);
    peer.deadline = setTimeout(() => {
      if (!this.closed && this.peers.get(peer.person.memberId) === peer && peer.connection.connectionState !== "connected") {
        this.options.failed("The call could not connect. Check both devices have internet access, then call again.");
      }
    }, milliseconds);
  }

  private send(peer: Peer, type: TeamCallSignal["type"], payload: TeamCallSignalPayload) {
    this.outgoing = this.outgoing.then(async () => {
      if (!this.closed && this.peers.get(peer.person.memberId) === peer) await this.options.send(peer.person, type, payload);
    }).catch(() => { if (!this.closed) this.options.failed("The call connection was interrupted. Hang up and call again."); });
    return this.outgoing;
  }

  async sync(people: TeamCallParticipant[]) {
    if (this.closed) return;
    const remote = people.filter(person => person.memberId !== this.options.memberId);
    for (const [id, peer] of this.peers) if (!remote.some(person => person.memberId === id && person.sessionId === peer.person.sessionId)) {
      clearTimeout(peer.deadline); peer.connection.close(); this.peers.delete(id);
    }
    for (const person of remote) {
      if (this.peers.has(person.memberId) || this.closed) continue;
      const configuration: RTCConfiguration = { iceServers: this.options.iceServers };
      const connection = this.options.createPeer ? this.options.createPeer(configuration) : new RTCPeerConnection(configuration);
      const peer: Peer = { person, connection, candidates: [], stream: null };
      this.peers.set(person.memberId, peer);
      this.connectionDeadline(peer, 30000);
      for (const track of this.options.local.getTracks()) connection.addTrack(track, this.options.local);
      connection.ontrack = event => {
        if (this.closed || this.peers.get(person.memberId) !== peer) return;
        peer.stream = event.streams[0] || peer.stream || new MediaStream();
        if (!peer.stream.getTracks().some(track => track.id === event.track.id)) peer.stream.addTrack(event.track);
        this.changed();
      };
      connection.onicecandidate = event => { if (event.candidate) void this.send(peer, "ice", {candidate:event.candidate.candidate,sdpMid:event.candidate.sdpMid,sdpMLineIndex:event.candidate.sdpMLineIndex,usernameFragment:event.candidate.usernameFragment}); };
      connection.onconnectionstatechange = () => {
        if (this.closed || this.peers.get(person.memberId) !== peer) return;
        if (connection.connectionState === "connected" || connection.connectionState === "closed" || connection.connectionState === "failed") clearTimeout(peer.deadline);
        if (connection.connectionState === "disconnected") this.connectionDeadline(peer, 15000);
        this.changed();
        if (!this.closed && connection.connectionState === "failed") this.options.failed("A teammate could not connect. Check your connection and call again.");
      };
      if (this.options.memberId < person.memberId) {
        await connection.setLocalDescription(await connection.createOffer());
        if (!this.closed && connection.localDescription) await this.send(peer, "offer", { type: "offer", sdp: connection.localDescription.sdp });
      }
    }
    this.changed();
  }

  async receive(signal: TeamCallSignal) {
    if (this.closed || signal.toSessionId !== this.options.sessionId) return;
    const peer = this.peers.get(signal.fromMemberId);
    if (!peer || peer.person.sessionId !== signal.fromSessionId) return;
    const connection = peer.connection;
    if (signal.type === "ice" && "candidate" in signal.payload) {
      if (!connection.remoteDescription) {
        if (peer.candidates.length >= 128) throw new Error("Too many connection candidates.");
        peer.candidates.push(signal.payload);
      } else await connection.addIceCandidate(signal.payload);
      return;
    }
    if (!("sdp" in signal.payload)) throw new Error("Invalid call signal.");
    if (signal.type === "offer" && this.options.memberId < signal.fromMemberId) return;
    if (signal.type === "answer" && connection.signalingState !== "have-local-offer") return;
    await connection.setRemoteDescription(signal.payload);
    for (const candidate of peer.candidates.splice(0)) await connection.addIceCandidate(candidate);
    if (signal.type === "offer") {
      await connection.setLocalDescription(await connection.createAnswer());
      if (!this.closed && connection.localDescription) await this.send(peer, "answer", { type: "answer", sdp: connection.localDescription.sdp });
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack) {
    if (this.closed) throw new Error("The call has ended.");
    const previous = this.options.local.getVideoTracks()[0];
    if (!previous) throw new Error("This call started with voice only.");
    // Update the shared stream first so a teammate joining mid-switch gets the
    // same camera. replaceTrack preserves the existing call and microphone.
    this.options.local.removeTrack(previous);
    this.options.local.addTrack(track);
    const replace = async (next: MediaStreamTrack) => {
      const outcomes = await Promise.allSettled([...this.peers.values()].map(async peer => {
        const sender = peer.connection.getSenders().find(item => item.track?.kind === "video");
        if (sender && peer.connection.connectionState !== "closed") await sender.replaceTrack(next);
      }));
      return outcomes.some(result => result.status === "rejected");
    };
    if (await replace(track)) {
      this.options.local.removeTrack(track);
      this.options.local.addTrack(previous);
      if (await replace(previous)) this.options.failed("The camera connection failed. Hang up and call again.");
      throw new Error("The camera could not switch. Try again.");
    }
  }

  close() {
    this.closed = true;
    for (const peer of this.peers.values()) { clearTimeout(peer.deadline); peer.connection.ontrack = null; peer.connection.onicecandidate = null; peer.connection.onconnectionstatechange = null; peer.connection.close(); }
    this.peers.clear();
  }
}
