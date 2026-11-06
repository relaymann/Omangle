import { createHmac, randomUUID } from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import { Matchmaker, PartnerLeftReason } from "./services/Matchmaker";

dotenv.config();

const app = express();
const httpServer = createServer(app);
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

const isProduction = process.env.NODE_ENV === "production";
const configuredOrigins = process.env.CLIENT_URLS;
if (isProduction && !configuredOrigins?.trim()) {
  throw new Error("CLIENT_URLS must be configured with the exact production frontend origin(s).");
}

const allowedOrigins = (configuredOrigins ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  throw new Error("CLIENT_URLS must contain at least one valid origin.");
}

const originAllowed = (origin?: string): boolean => {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
};

app.use(cors({
  origin: (origin, callback) => {
    if (originAllowed(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed."));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.get("/", (_request, response) => {
  response.json({ service: "omangle-signaling", status: "ok" });
});


const turnUrls = (process.env.TURN_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean);
const turnSharedSecret = process.env.TURN_SHARED_SECRET ?? "";
const turnCredentialTtl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 600);
if (turnUrls.some((url) => !/^(turn|turns):/i.test(url))) throw new Error("TURN_URLS may contain only turn: or turns: URLs.");
if (turnUrls.length > 0 && !turnSharedSecret.trim()) throw new Error("TURN_SHARED_SECRET is required when TURN_URLS is configured.");
if (!Number.isInteger(turnCredentialTtl) || turnCredentialTtl < 60 || turnCredentialTtl > 86_400) throw new Error("TURN_CREDENTIAL_TTL_SECONDS must be between 60 and 86400.");

const iceRequestWindows = new Map<string, { startedAt: number; count: number }>();
app.get("/api/ice-servers", (request, response) => {
  const clientKey = request.ip || "unknown";
  const now = Date.now();
  const current = iceRequestWindows.get(clientKey);
  if (current && now - current.startedAt < 60_000 && current.count >= 30) {
    response.setHeader("Retry-After", "60");
    response.status(429).json({ error: "Too many ICE configuration requests." });
    return;
  }
  if (!current || now - current.startedAt >= 60_000) iceRequestWindows.set(clientKey, { startedAt: now, count: 1 });
  else current.count += 1;
  if (iceRequestWindows.size > 10_000) {
    for (const [key, window] of iceRequestWindows) if (now - window.startedAt >= 60_000) iceRequestWindows.delete(key);
  }
  response.setHeader("Cache-Control", "no-store, private");
  const iceServers: Array<{ urls: string[]; username?: string; credential?: string; credentialType?: "password" }> = [
    { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }
  ];
  if (turnUrls.length) {
    const username = `${Math.floor(now / 1000) + turnCredentialTtl}:${randomUUID()}`;
    const credential = createHmac("sha1", turnSharedSecret).update(username).digest("base64");
    iceServers.push({ urls: turnUrls, username, credential, credentialType: "password" });
  }
  response.status(200).json({ iceServers, turnConfigured: turnUrls.length > 0, expiresInSeconds: turnUrls.length ? turnCredentialTtl : null });
});

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  connectTimeout: 20_000
});

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  if ((!origin && isProduction) || !originAllowed(origin)) {
    next(new Error("Origin is not allowed."));
    return;
  }
  next();
});

type RateWindow = { startedAt: number; count: number };
const rateWindows = new Map<string, Map<string, RateWindow>>();
const peerTokens = new Map<string, string>();

function allowEvent(socketId: string, eventName: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let socketWindows = rateWindows.get(socketId);
  if (!socketWindows) {
    socketWindows = new Map();
    rateWindows.set(socketId, socketWindows);
  }

  const current = socketWindows.get(eventName);
  if (!current || now - current.startedAt >= windowMs) {
    socketWindows.set(eventName, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTarget(payload: unknown, socket: Socket, matcher: Matchmaker): string | null {
  if (!isRecord(payload) || typeof payload.to !== "string") return null;
  const partnerId = matcher.getPartner(socket.id);
  if (!partnerId) return null;
  const expectedPeerToken = peerTokens.get(partnerId);
  if (!expectedPeerToken || payload.to !== expectedPeerToken) return null;
  return partnerId;
}

function validDescription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.type === "offer" || value.type === "answer" || value.type === "pranswer")
    && typeof value.sdp === "string"
    && value.sdp.length > 0
    && value.sdp.length <= 48_000;
}

function validSignalPayload(eventName: string, payload: Record<string, unknown>): boolean {
  if (eventName === "offer" || eventName === "peer:nego:needed") return validDescription(payload.offer);
  if (eventName === "answer" || eventName === "peer:nego:done") return validDescription(payload.answer);
  if (eventName === "ice-candidate") {
    if (!isRecord(payload.candidate)) return false;
    return typeof payload.candidate.candidate === "string"
      && payload.candidate.candidate.length <= 4_096;
  }
  return false;
}

const matchmaker = new Matchmaker({
  matched: (offererId, answererId) => {
    const matchId = randomUUID();
    const offererToken = randomUUID();
    const answererToken = randomUUID();
    peerTokens.set(offererId, offererToken);
    peerTokens.set(answererId, answererToken);

    io.to(offererId).emit("user:connect", answererToken);
    io.to(offererId).emit("match:found", { matchId, peerId: answererToken, role: "offerer" });
    io.to(answererId).emit("match:found", { matchId, peerId: offererToken, role: "answerer" });
  },
  partnerLeft: (remainingSocketId, reason: PartnerLeftReason, departedSocketId) => {
    peerTokens.delete(remainingSocketId);
    peerTokens.delete(departedSocketId);
    if (reason === "skipped") io.to(remainingSocketId).emit("skipped");
    else io.to(remainingSocketId).emit("partnerDisconnected");
  }
});

function relayToPartner(socket: Socket, eventName: string, payload: unknown): void {
  const target = validTarget(payload, socket, matchmaker);
  if (!target || !isRecord(payload) || !validSignalPayload(eventName, payload)) {
    socket.emit("protocol:error", { code: "INVALID_OR_UNPAIRED_SIGNAL" });
    return;
  }

  const senderToken = peerTokens.get(socket.id);
  if (!senderToken) {
    socket.emit("protocol:error", { code: "MATCH_TOKEN_EXPIRED" });
    return;
  }

  const outgoing: Record<string, unknown> = { from: senderToken };
  if (eventName === "offer" || eventName === "peer:nego:needed") outgoing.offer = payload.offer;
  if (eventName === "answer" || eventName === "peer:nego:done") outgoing.answer = payload.answer;
  if (eventName === "ice-candidate") outgoing.candidate = payload.candidate;

  const outgoingEvent = eventName === "peer:nego:done" ? "peer:nego:final" : eventName;
  io.to(target).emit(outgoingEvent, outgoing);
}

io.on("connection", (socket) => {
  rateWindows.set(socket.id, new Map());

  socket.on("offer", (payload: unknown) => {
    if (allowEvent(socket.id, "signal", 30, 10_000)) relayToPartner(socket, "offer", payload);
  });
  socket.on("answer", (payload: unknown) => {
    if (allowEvent(socket.id, "signal", 30, 10_000)) relayToPartner(socket, "answer", payload);
  });
  socket.on("peer:nego:needed", (payload: unknown) => {
    if (allowEvent(socket.id, "signal", 30, 10_000)) relayToPartner(socket, "peer:nego:needed", payload);
  });
  socket.on("peer:nego:done", (payload: unknown) => {
    if (allowEvent(socket.id, "signal", 30, 10_000)) relayToPartner(socket, "peer:nego:done", payload);
  });
  socket.on("ice-candidate", (payload: unknown) => {
    if (allowEvent(socket.id, "ice", 120, 10_000)) relayToPartner(socket, "ice-candidate", payload);
  });

  socket.on("send:message", (payload: unknown) => {
    if (!allowEvent(socket.id, "chat", 8, 10_000)) {
      socket.emit("protocol:error", { code: "MESSAGE_RATE_LIMITED" });
      return;
    }

    const target = validTarget(payload, socket, matchmaker);
    if (!target || !isRecord(payload) || typeof payload.message !== "string") {
      socket.emit("protocol:error", { code: "INVALID_MESSAGE" });
      return;
    }

    const message = payload.message.trim();
    if (!message || message.length > 2_000) {
      socket.emit("protocol:error", { code: "INVALID_MESSAGE" });
      return;
    }

    const senderToken = peerTokens.get(socket.id);
    if (!senderToken) return;
    io.to(target).emit("message:recieved", { message, from: senderToken });
  });

  socket.on("skip", () => {
    if (allowEvent(socket.id, "skip", 4, 10_000)) matchmaker.skip(socket.id);
  });
  socket.on("matchmaking:leave", () => matchmaker.leave(socket.id));
  socket.on("matchmaking:join", () => matchmaker.join(socket.id));

  socket.on("disconnect", () => {
    matchmaker.disconnect(socket.id);
    peerTokens.delete(socket.id);
    rateWindows.delete(socket.id);
  });
});

const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log("Omangle signaling service listening on port " + port);
});

function shutdown(signal: string): void {
  console.log("Received " + signal + "; shutting down.");
  io.close(() => httpServer.close(() => process.exit(0)));
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
