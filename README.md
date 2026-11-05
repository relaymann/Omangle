# Omangle

Omangle is a real-time random conversation platform inspired by Omegle and modern WebRTC chat services. The goal is a fast, mobile-friendly experience for meeting people through video, voice, and text.

> This repository contains an inherited early prototype. This update establishes a more reliable, secure, and testable foundation; it does not certify the existing media UI as production-ready.

## Principles

- Fast to join, mobile-first, and responsive.
- Reliable media: local preview is not proof of success; both participants must receive each other's media.
- Privacy by default: do not expose socket IDs, IP addresses, or unnecessary profile data.
- Safety built in: skip, block, report, rate limits, and moderation before public launch.
- Honest status: never show a media control as active unless the browser confirms the track state.

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, TypeScript, Express, Socket.IO
- Media: browser WebRTC; direct paths where possible, TURN relay when required

The signaling server coordinates matchmaking and exchanges WebRTC negotiation data. It must not receive or store raw media. The browser registers match and signaling listeners before requesting queue entry, and re-enters matchmaking after a socket reconnect.

## Layout

- client/ — browser application
- server/ — HTTP, Socket.IO signaling, and matchmaking
- docs/ARCHITECTURE.md — system boundaries and lifecycle contracts
- docs/ROADMAP.md — staged implementation plan
- DEVELOPMENT_RULES.md — mandatory engineering and audit requirements

## Local development

Requirements: Node.js 20+ and npm.

Backend:
~~~bash
cd server
npm ci
cp .env.example .env
npm run dev
~~~

Frontend, in a second terminal:
~~~bash
cd client
npm ci
cp .env.example .env
npm run dev
~~~

The backend listens on port 8000 by default; Vite normally serves at http://localhost:5173. Set CLIENT_URLS in server/.env to a comma-separated list of exact allowed frontend origins when testing from another device or deploying. Do not use wildcard origins in production.

## Quality checks

Frontend:
~~~bash
cd client
npm ci
npm run lint
npm run build
~~~

Backend:
~~~bash
cd server
npm ci
npm run build
npm test
~~~

GitHub Actions runs these checks on pushes and pull requests. A green build does not replace the two required audits or real two-device media testing.

## Media test requirement

For every media-related change, test with two independent participants/devices. Confirm:
1. Both participants see their own preview and the other's live video.
2. Audio is audible in both directions.
3. Mute, unmute, camera off/on, and device switching are reflected correctly at the other end.
4. Screen sharing arrives at the remote participant and stops cleanly from either the app control or browser UI.
5. Skip, disconnect, reconnect, permission denial, and device removal do not leave stale tracks or sessions.

A local-only browser test cannot prove remote delivery. Record unsupported devices, permission failures, and untested network paths honestly.

## Deployment notes

The frontend can be hosted on a static/CDN platform. The signaling backend needs a persistent Node-capable host that supports WebSockets and correct proxy timeouts. Production requires HTTPS/WSS, an exact frontend origin allowlist, configured STUN/TURN infrastructure, and browser/device testing. Public STUN servers alone are not a production connectivity strategy.

See docs/ARCHITECTURE.md and docs/ROADMAP.md before extending the system.
