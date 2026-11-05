# Implementation roadmap

## Phase 0 — foundation (current)

- Document engineering, performance, safety, privacy, and two-audit requirements.
- Establish deterministic server-owned matchmaking and signaling authorization.
- Add backend unit tests and continuous integration.
- Make health/status and environment configuration explicit.
- Preserve the existing frontend while its legacy media implementation is replaced in a dedicated phase.

## Phase 1 — client/session lifecycle

- Replace the module-global peer connection with one MediaSession instance per match.
- Add typed Socket.IO client events and connection/reconnection state; attach listeners before queue entry and rejoin after reconnect.
- Implement explicit states: idle → requesting permissions → waiting → matched → negotiating → connected → ending → idle.
- Make join/skip/leave idempotent and cancel stale async work using match/session IDs.
- Add responsive, accessible video/voice/text layouts and real empty/error states.

## Phase 2 — media reliability

- Implement camera/microphone capture with actionable permission/device errors.
- Keep capture tracks independent from peer connection state.
- Implement remote audio/video rendering and autoplay recovery.
- Implement mute/camera toggles using track enabled state and device switching safely.
- Implement screen-share track replacement, browser-ended handling, and camera restoration.
- Add ICE candidate buffering, renegotiation collision handling, connection recovery, and TURN configuration.
- Test both sides with two physical devices across desktop and mobile browsers.

## Phase 3 — safety and privacy

- Add report, block, and skip abuse controls with server-side enforcement.
- Add connection and message rate limits, moderation review workflow, and operational audit events without collecting media.
- Publish community rules, privacy notice, and terms before public launch.
- Establish age policy and safeguards before opening the service to the public.

## Phase 4 — scale and operations

- Move ephemeral queue/pair state to Redis before running multiple signaling instances.
- Add Socket.IO Redis adapter, health/readiness checks, graceful shutdown, metrics, structured redacted logs, and load tests.
- Add authenticated, short-lived TURN credentials and monitor relay bandwidth/cost.
- Add deployment previews and rollback procedures.

## Release gates

- Every change passes both full audits in DEVELOPMENT_RULES.md.
- Backend and frontend checks are green.
- Two-device tests prove actual remote video, two-way audio, and screen-share delivery.
- Skip, disconnect, reconnect, permission denial, and device-switch paths pass.
- No unresolved critical security, privacy, or media regressions.
