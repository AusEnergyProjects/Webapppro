import { MediaStream, RTCPeerConnection, type MediaStreamTrack, type RTCIceCandidate } from 'react-native-webrtc';

import type { TeamCallParticipant, TeamCallSignal, TeamCallSignalPayload } from '../../../src/lib/trade-team-calls';

export type NativeCallRemote = {
  memberId: string;
  name: string;
  stream: MediaStream | null;
  state: RTCPeerConnection['connectionState'];
};
export type NativeIceServer = { urls: string | string[]; username?: string; credential?: string };
type Candidate = Extract<TeamCallSignalPayload, { candidate: string }>;
type Peer = {
  person: TeamCallParticipant;
  connection: RTCPeerConnection;
  candidates: Candidate[];
  stream: MediaStream | null;
  detach: () => void;
};

// Uses the same session fences and designated offerer as the web client, so
// field phones and office browsers can participate in the same team call.
export class NativeTeamCallConnections {
  private readonly peers = new Map<string, Peer>();
  private closed = false;
  private outgoing: Promise<void> = Promise.resolve();

  constructor(private readonly options: {
    memberId: string;
    sessionId: string;
    local: MediaStream;
    iceServers: NativeIceServer[];
    send: (target: TeamCallParticipant, type: TeamCallSignal['type'], payload: TeamCallSignalPayload) => Promise<void>;
    changed: (peers: NativeCallRemote[]) => void;
    failed: (message: string) => void;
  }) {}

  private current(peer: Peer) {
    return !this.closed && this.peers.get(peer.person.memberId) === peer;
  }

  private changed() {
    if (!this.closed) this.options.changed([...this.peers.values()].map(peer => ({
      memberId: peer.person.memberId, name: peer.person.name, stream: peer.stream,
      state: peer.connection.connectionState,
    })));
  }

  private send(peer: Peer, type: TeamCallSignal['type'], payload: TeamCallSignalPayload) {
    this.outgoing = this.outgoing.then(async () => {
      if (this.current(peer)) await this.options.send(peer.person, type, payload);
    }).catch(() => {
      if (this.current(peer)) this.options.failed('The call connection was interrupted. Call again when connected.');
    });
    return this.outgoing;
  }

  private remove(peer: Peer) {
    peer.detach();
    peer.connection.close();
    peer.stream?.release(false);
    this.peers.delete(peer.person.memberId);
  }

  async sync(people: TeamCallParticipant[]) {
    if (this.closed) return;
    if (people.length > 6) throw new Error('A team call supports up to six people.');
    const remote = people.filter(person => person.memberId !== this.options.memberId);
    for (const peer of this.peers.values()) {
      if (!remote.some(person => person.memberId === peer.person.memberId && person.sessionId === peer.person.sessionId)) this.remove(peer);
    }
    for (const person of remote) {
      if (this.closed) return;
      if (this.peers.has(person.memberId)) continue;
      const connection = new RTCPeerConnection({ iceServers: this.options.iceServers });
      const peer: Peer = { person, connection, candidates: [], stream: null, detach: () => undefined };
      this.peers.set(person.memberId, peer);
      for (const track of this.options.local.getTracks()) connection.addTrack(track, this.options.local);
      connection.ontrack = (event: { streams: MediaStream[]; track: MediaStreamTrack | null }) => {
        if (!this.current(peer)) return;
        const stream = event.streams[0] || peer.stream || new MediaStream();
        const track = event.track;
        if (track && !stream.getTracks().some(item => item.id === track.id)) stream.addTrack(track);
        peer.stream = stream;
        this.changed();
      };
      connection.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
        if (!this.current(peer) || !event.candidate) return;
        void this.send(peer, 'ice', { candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid ?? null, sdpMLineIndex: event.candidate.sdpMLineIndex ?? null });
      };
      connection.onconnectionstatechange = () => {
        if (!this.current(peer)) return;
        this.changed();
        if (connection.connectionState === 'failed') this.options.failed('A teammate could not connect. Check your connection and call again.');
      };
      peer.detach = () => {
        connection.ontrack = null;
        connection.onicecandidate = null;
        connection.onconnectionstatechange = null;
      };
      if (this.options.memberId < person.memberId) {
        // A voice-only answer can still receive the other participant's video.
        const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        if (!this.current(peer)) return;
        await connection.setLocalDescription(offer);
        if (this.current(peer) && connection.localDescription) {
          await this.send(peer, 'offer', { type: 'offer', sdp: connection.localDescription.sdp });
        }
      }
    }
    this.changed();
  }

  async receive(signal: TeamCallSignal) {
    if (this.closed || signal.toSessionId !== this.options.sessionId) return;
    const peer = this.peers.get(signal.fromMemberId);
    if (!peer || peer.person.sessionId !== signal.fromSessionId) return;
    const connection = peer.connection;
    if (signal.type === 'ice' && 'candidate' in signal.payload) {
      if (!connection.remoteDescription) {
        if (peer.candidates.length >= 128) throw new Error('Too many call connection candidates.');
        peer.candidates.push(signal.payload);
      } else await connection.addIceCandidate(signal.payload);
      return;
    }
    if (!('sdp' in signal.payload) || signal.payload.type !== signal.type) throw new Error('Invalid call connection details.');
    if (signal.type === 'offer' && this.options.memberId < signal.fromMemberId) return;
    if (signal.type === 'answer' && connection.signalingState !== 'have-local-offer') return;
    await connection.setRemoteDescription(signal.payload);
    if (!this.current(peer)) return;
    for (const candidate of peer.candidates.splice(0)) {
      if (!this.current(peer)) return;
      await connection.addIceCandidate(candidate);
    }
    if (signal.type === 'offer') {
      const answer = await connection.createAnswer();
      if (!this.current(peer)) return;
      await connection.setLocalDescription(answer);
      if (this.current(peer) && connection.localDescription) {
        await this.send(peer, 'answer', { type: 'answer', sdp: connection.localDescription.sdp });
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const peer of this.peers.values()) this.remove(peer);
    this.peers.clear();
  }
}
