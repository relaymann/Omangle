# Omangle architecture

## System boundaries

~~~text
Browser A                         Signaling/API                         Browser B
---------                         -------------                         ---------
React UI  -- HTTPS/WSS -------> Express + Socket.IO <------ HTTPS/WSS -- React UI
Media capture                     Matchmaking state                      Media capture
RTCPeerConnection <------ SDP / ICE relay ------> RTCPeerConnection
          <=============== encrypted WebRTC media ===============>
~~~

The application server owns socket identity, queue membership, active pairing, and permission to relay events. Browsers own media capture and playback. WebRTC carries audio/video/screen tracks; Socket.IO is signaling and control only.

## Core invariants

1. A socket is in at most one state: idle, waiting, or paired.
2. A socket has at most one active peer.
3. A peer can receive signaling/chat only from its current partner.
4. Queue entries are removed on pairing, skip, and disconnect.
5. A skip must not immediately rematch the same pair. A short server-side cooldown prevents a two-user skip loop.
6. A disconnect releases the surviving participant back into matchmaking.
7. Matchmaking and signaling never accept a client-selected arbitrary destination.
8. Signaling completion does not mean media is connected.
9. Temporary state is cleaned when a socket disconnects or a match ends.

## Connection lifecycle

- A browser opens a Socket.IO connection over HTTPS/WSS in production.
- The server places the guest socket into matchmaking.
- The client registers its match/signaling listeners before requesting queue entry, and repeats that request after a socket reconnect. The server pairs two eligible sockets and notifies both. One side is designated offerer to avoid simultaneous initial offers.
- Peers exchange SDP and ICE through the signaling server. The server checks that each message comes from the currently paired socket and routes it only to that peer.
- WebRTC attempts a direct encrypted path. ICE configuration is fetched from `/api/ice-servers`. The backend returns STUN plus authenticated, short-lived TURN credentials when configured. TURN over TLS/TCP 443 is the preferred fallback on restrictive networks. Without a deployed TURN service, STUN-only connections may fail.
- A participant may skip, leave, or disconnect. Both sides discard the old peer connection and tracks before another match starts.

## Matchmaking contract

The server is authoritative. The client may request join, skip, or leave, but cannot choose a peer. Queue operations must be idempotent. Pairing is atomic within one server process. Before horizontal scaling, move queue/pair state to a shared coordinator such as Redis and use a Socket.IO adapter; in-memory state is not multi-instance safe.

A cooldown after skip prevents two users from being paired with each other again immediately.

## WebRTC contract

- Create one RTCPeerConnection per active match, never a module-global connection shared across screens or users.
- Keep camera/microphone capture lifecycle separate from the peer connection lifecycle.
- Prefer MediaStreamTrack.enabled for mute/camera toggles. Do not stop a track merely to mute it.
- Use RTCRtpSender.replaceTrack for camera/screen track replacement where compatible; handle failure and renegotiation explicitly.
- Buffer incoming ICE candidates until the remote description is set.
- Handle track, connectionstatechange, iceconnectionstatechange, signalingstatechange, and track ended events.
- Use a single cleanup path that closes the peer connection, removes listeners, stops owned tracks, clears timers, and detaches media elements.
- Attach remote streams to native video elements with playsInline; surface autoplay failures and offer user-gesture recovery.
- Never mark remote video/audio/screen share as working until remote tracks arrive and playback succeeds.

## Security and abuse controls

- Exact origin allowlist in production; no wildcard CORS.
- Server-authorized peer routing for every offer, answer, ICE candidate, negotiation, and message.
- Payload validation, size limits, and event-specific rate limits.
- No arbitrary room joins or user-supplied socket targets.
- Skip, block, report, and moderation workflows must be server-authoritative.
- Keep production logs free of message content, SDP, ICE candidate contents, and secrets.

## Deployment model

The static frontend can be hosted on a CDN platform. The signaling service must run on a persistent Node-capable host that supports WebSockets and correct proxy timeouts. Set CLIENT_URLS to the production frontend origin. Use HTTPS/WSS. Configure authenticated, short-lived TURN credentials; do not commit TURN secrets or hard-code public credentials.

## Current prototype limitations

The existing React screen and global peer helper are legacy prototype code. They do not yet satisfy the per-match peer connection, bidirectional media verification, TURN fallback, or complete cleanup contracts above. The new server foundation is not a declaration that the current camera/microphone/screen-share UI is production-ready.
