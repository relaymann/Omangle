# Mandatory Engineering Rules

These requirements apply to every change, including tiny fixes, dependency updates, configuration changes, refactors, and major features. They are release gates, not suggestions.

## 1. Performance first

The target is to eliminate avoidable lag and keep the application responsive under realistic network, device, and concurrency conditions. Literal zero lag cannot be guaranteed across the public internet.

For every update:
- Review rendering, bundle size, memory, CPU work, and loading behavior where relevant.
- Review API, Socket.IO, matchmaking, database, and WebRTC latency/resource use where relevant.
- Avoid unnecessary polling, duplicate requests, blocking work, memory leaks, and unbounded queues/listeners.
- Exercise slow networks, reconnects, and concurrent usage when affected.
- Fix measurable performance regressions before release.

## 2. Bug checks after every update

Run bug checks after every update, regardless of size. Inspect new code and existing behavior that could be affected, including integration boundaries and backwards compatibility.

## 3. Two separate full audits after every update

Both audits are mandatory and distinct. They are not two labels for one quick check.

### Audit One — comprehensive technical and functional audit
- Inspect the complete change and surrounding implementation.
- Check correctness, edge cases, error handling, regressions, and compatibility.
- Check security, privacy, input validation, and abuse risks where relevant.
- Check frontend/backend contracts, APIs, Socket.IO events, database access, and WebRTC signaling where relevant.
- Run available automated tests, type checks, lint, and production builds.
- Run focused manual or integration tests for affected user flows.
- Inspect performance and resource usage for affected paths.

### Audit Two — independent verification and regression audit
- Re-examine the affected system independently; do not merely copy Audit One's conclusions.
- Verify every fix and requirement with tests or direct evidence.
- Re-test affected existing features and important end-to-end flows.
- Look for regressions, race conditions, reconnect/disconnect failures, stale state, leaks, and recovery failures where relevant.
- Re-check performance and production build/runtime behavior.
- Confirm Audit One findings were resolved and no new defects were introduced.

## 4. Failure blocks completion

- Do not call an update complete, safe, or production-ready while a required check is failing.
- Fix discovered defects, then repeat both full audits.
- If a test cannot run because of missing credentials, infrastructure, devices, or tooling, explicitly record what could not be verified and why.
- Never hide, skip, or silently waive failures. Document unresolved issues and assess release readiness honestly.

## 5. Required update report

Every update report must include:
1. What changed.
2. Audit One scope, commands/tests run, and results.
3. Audit Two scope, commands/tests run, and results.
4. Performance checks and findings.
5. Bugs found, fixes made, and remaining limitations.
6. Final status: passed, blocked, or partially verified.

## 6. Change workflow

1. Inspect the current implementation before editing.
2. Make the smallest coherent change that solves the task.
3. Run bug checks and Audit One.
4. Fix all discovered issues.
5. Run Audit Two independently.
6. If Audit Two finds an issue, fix it and repeat both audits.
7. Report evidence and status before considering the update complete.

## 7. Camera, microphone, audio, and screen-share reliability

Media is a core feature. A local preview alone is never evidence that a call works.

For every update, run media regression checks. For every media-related update, explicitly test both participants' sides and verify:
- Each participant sees their own local preview and the other participant's live video.
- Each participant can hear the other participant, and each microphone reaches the other side.
- Screen sharing is visible to the remote participant; the sharer can confirm the correct screen/window is shared.
- Camera, microphone, mute/unmute, camera on/off, and screen-share start/stop/cancel controls reflect actual track state and are synchronized.
- Permission granted, denied, revoked, dismissed, and re-requested states.
- Missing, busy, disconnected, removed, and switched devices.
- Local preview, remote track delivery, autoplay restrictions, and user-gesture recovery.
- Screen-share track ending through browser controls, renegotiation, reconnect, ICE failure/recovery, and cleanup after skip/disconnect.
- HTTPS, STUN/ICE, authenticated TURN fallback, actionable errors, and supported browser/device combinations.

Do not claim a feature is active unless the browser and remote participant confirm it. Use real two-device testing when possible. Universal availability cannot be guaranteed when hardware, permissions, browser support, or network conditions prevent it; document every untested combination and limitation. A media regression blocks completion until fixed, then repeat both full audits.

## 8. Privacy and safety are foundational

- Never trust client-supplied peer IDs, room IDs, roles, or moderation outcomes.
- Authorize every signaling and chat relay against server-owned active-match state.
- Validate and bound every payload; rate-limit connection, matching, signaling, and messaging actions.
- Do not log message contents, SDP, ICE candidates, media, or secrets in routine production logs.
- Do not expose IP addresses, internal socket IDs, or other participants' private metadata.
- Provide skip, block, and report flows before public launch; keep safety controls available during active calls.
- Do not store media or message history by default. Any future retention must be explicit, minimized, and documented.

**These requirements are permanent and must be followed for every future update.**
