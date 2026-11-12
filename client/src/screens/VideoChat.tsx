import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../context/SocketProvider";
import peerservice from "../service/peer";
import { Button } from "../components/ui/button";
import Messages from "../components/Messages";
import { ScreenShare, StepBack, StepForward } from "lucide-react";
import { ClipLoader } from "react-spinners"; // Import the spinner
import { useTheme } from "../components/theme-provider";
import { useNavigate } from "react-router-dom";
import "../css/VideoChat.css";

function MediaVideo({ stream, muted = false, className = "" }: { stream: MediaStream; muted?: boolean; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    const startPlayback = () => {
      void video.play().catch((error: unknown) => {
        console.warn("Video autoplay was blocked; playback needs a user gesture:", error);
      });
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) startPlayback();
    else video.addEventListener("loadedmetadata", startPlayback, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", startPlayback);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  return <video ref={videoRef} className={className} autoPlay playsInline controls={!muted} muted={muted} />;
}

function getSenderForKind(peer: RTCPeerConnection, kind: "audio" | "video"): RTCRtpSender | undefined {
  return peer.getSenders().find((sender) => sender.track?.kind === kind)
    ?? peer.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === kind)?.sender;
}

interface Offer {
  offer: RTCSessionDescriptionInit;
  from: string;
}

interface Answer {
  answer: RTCSessionDescriptionInit;
  from: string;
}

interface NegotiationDone {
  answer: RTCSessionDescriptionInit;
  to: string;
}

export default function VideoChat() {
  const { socket } = useSocket();
  const [remoteSocketId, setRemoteSocketId] = useState<string | null>(null);
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [flag, setFlag] = useState(false);
  const [messagesArray, setMessagesArray] = useState<
    Array<{ sender: string; message: string }>
  >([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [matchStatus, setMatchStatus] = useState("Connecting to matchmaking...");
  const [cameraPermission, setCameraPermission] = useState<"idle" | "granted" | "denied">("idle");
  const [micPermission, setMicPermission] = useState<"idle" | "granted" | "denied">("idle");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const screenShareBusyRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraPromiseRef = useRef<Promise<MediaStreamTrack> | null>(null);
  const microphonePromiseRef = useRef<Promise<MediaStreamTrack> | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const matchRoleRef = useRef<"offerer" | "answerer" | null>(null);
  const negotiationReadyRef = useRef(false);
  const matchInProgressRef = useRef(false);
  const [peerVersion, setPeerVersion] = useState(0);

  const theme = useTheme();
  const navigate = useNavigate();

  const loaderColor = theme.theme === "dark" ? "#D1D5DB" : "#4B5563";

  const captureDevice = useCallback(async (kind: "video" | "audio"): Promise<MediaStreamTrack> => {
    const current = localStreamRef.current ?? new MediaStream();
    const existing = current.getTracks().find((track) => track.kind === kind && track.readyState === "live");
    if (existing) return existing;

    const promiseRef = kind === "video" ? cameraPromiseRef : microphonePromiseRef;
    if (promiseRef.current) return promiseRef.current;

    const request = navigator.mediaDevices.getUserMedia(
      kind === "video"
        ? { video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 24, max: 30 } }, audio: false }
        : { video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
    ).then((captured) => {
      const track = captured.getTracks().find((item) => item.kind === kind);
      if (!track) {
        captured.getTracks().forEach((item) => item.stop());
        throw new Error(kind === "video" ? "The camera did not provide a video track." : "The microphone did not provide an audio track.");
      }
      const aggregate = localStreamRef.current ?? new MediaStream();
      aggregate.getTracks().filter((item) => item.kind === kind).forEach((item) => {
        aggregate.removeTrack(item);
        if (item !== track) item.stop();
      });
      aggregate.addTrack(track);
      localStreamRef.current = aggregate;
      setMyStream(new MediaStream(aggregate.getTracks()));
      track.addEventListener("ended", () => {
        if (kind === "video") { setIsCameraOn(false); setCameraPermission("idle"); }
        else { setIsMicOn(false); setMicPermission("idle"); }
        const sender = getSenderForKind(peerservice.peer, kind);
        if (sender?.track === track) void sender.replaceTrack(null).catch((error) => console.warn("Unable to detach ended media track:", error));
      }, { once: true });
      if (kind === "video") { setCameraPermission("granted"); setIsCameraOn(true); }
      else { setMicPermission("granted"); setIsMicOn(true); }
      const sender = getSenderForKind(peerservice.peer, kind);
      if (sender) void sender.replaceTrack(track).catch((error) => console.warn("Unable to attach newly enabled media:", error));
      else if (remoteSocketId) peerservice.peer.addTrack(track, aggregate);
      return track;
    }).catch((error: unknown) => {
      if (kind === "video") { setCameraPermission("denied"); setIsCameraOn(false); }
      else { setMicPermission("denied"); setIsMicOn(false); }
      throw error;
    }).finally(() => { promiseRef.current = null; });

    promiseRef.current = request;
    return request;
  }, [remoteSocketId]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Camera and microphone capture are unavailable in this browser or page context. Use HTTPS and a supported browser.");
    }
    return () => {
      // Capture tracks are stopped by the explicit page cleanup below.
    };
  }, []);

  const toggleCamera = useCallback(async () => {
    try {
      const current = localStreamRef.current?.getVideoTracks().find((track) => track.readyState === "live");
      if (!current) {
        await captureDevice("video");
        setMediaError(null);
        return;
      }
      current.enabled = !current.enabled;
      setIsCameraOn(current.enabled);
      setMediaError(null);
    } catch (error) {
      console.error("Unable to access camera:", error);
      setMediaError("Camera access was denied or unavailable. You can still use Omangle with your microphone, screen sharing, or text.");
    }
  }, [captureDevice]);

  const toggleMic = useCallback(async () => {
    try {
      const current = localStreamRef.current?.getAudioTracks().find((track) => track.readyState === "live");
      if (!current) {
        await captureDevice("audio");
        setMediaError(null);
        return;
      }
      current.enabled = !current.enabled;
      setIsMicOn(current.enabled);
      setMediaError(null);
    } catch (error) {
      console.error("Unable to access microphone:", error);
      setMediaError("Microphone access was denied or unavailable. You can still use Omangle with your camera, screen sharing, or text.");
    }
  }, [captureDevice]);

  const flushPendingIceCandidates = useCallback(async () => {
    const pending = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      try {
        await peerservice.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn("Unable to apply a queued ICE candidate:", error);
      }
    }
  }, []);

  const sendStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const activeScreenTrack = screenStreamRef.current?.getVideoTracks().find((track) => track.readyState === "live");
    const videoTrack = activeScreenTrack ?? stream.getVideoTracks().find((track) => track.readyState === "live");
    const audioTrack = stream.getAudioTracks().find((track) => track.readyState === "live");
    const videoSender = getSenderForKind(peerservice.peer, "video");
    const audioSender = getSenderForKind(peerservice.peer, "audio");

    if (videoTrack && videoSender && videoSender.track !== videoTrack) {
      void videoSender.replaceTrack(videoTrack).catch((error) => console.warn("Unable to replace video sender track:", error));
    } else if (videoTrack && !videoSender) {
      peerservice.peer.addTrack(videoTrack, screenStreamRef.current ?? stream);
    }

    if (audioTrack && audioSender && audioSender.track !== audioTrack) {
      void audioSender.replaceTrack(audioTrack).catch((error) => console.warn("Unable to replace audio sender track:", error));
    } else if (audioTrack && !audioSender) {
      peerservice.peer.addTrack(audioTrack, stream);
    }
  }, []);

  const stopScreenShare = useCallback(async (stopCapture = true) => {
    const stream = screenStreamRef.current;
    const cameraTrack = localStreamRef.current?.getVideoTracks().find((track) => track.readyState === "live") ?? null;
    const videoSender = getSenderForKind(peerservice.peer, "video");
    try {
      if (videoSender) await videoSender.replaceTrack(cameraTrack);
    } catch (error) {
      console.error("Unable to restore camera after screen sharing:", error);
    }
    if (stopCapture) stream?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsScreenSharing(false);
    setMyStream(localStreamRef.current);
  }, []);

  const handleScreenShare = useCallback(async () => {
    if (screenShareBusyRef.current) return;
    if (screenStreamRef.current) {
      screenShareBusyRef.current = true;
      try { await stopScreenShare(); } finally { screenShareBusyRef.current = false; }
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("Screen sharing is not supported by this browser. Use a supported browser over HTTPS.");
      return;
    }
    screenShareBusyRef.current = true;
    try {
      // getDisplayMedia must be called directly from this user gesture.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("The selected screen did not provide a video track.");
      }
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setMyStream(stream);
      setIsScreenSharing(true);
      setMediaError(null);
      const videoSender = peerservice.peer.getSenders().find((sender) => sender.track?.kind === "video");
      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
      } else if (remoteSocketId) {
        peerservice.peer.addTrack(screenTrack, stream);
        // addTrack fires negotiationneeded; the shared handler performs signaling.
      }
      screenTrack.addEventListener("ended", () => {
        void stopScreenShare(false);
      }, { once: true });
    } catch (error) {
      // Picker cancellation is a normal user action, not an application error.
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
        console.error("Unable to start screen sharing:", error);
      }
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      setIsScreenSharing(false);
      setMyStream(localStreamRef.current);
      setMediaError("Screen sharing could not be started. Try again and allow the browser screen picker.");
    } finally {
      screenShareBusyRef.current = false;
    }
  }, [remoteSocketId, stopScreenShare]);

  const setAudioBandwidth = (peerConnection: RTCPeerConnection) => {
    const sender = peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === "audio");
    if (sender) {
      const parameters = sender.getParameters();
      if (parameters.encodings.length > 0) {
        parameters.encodings[0] = { ...parameters.encodings[0], maxBitrate: 128000 };
        void sender.setParameters(parameters).catch((error) => {
          console.warn("Unable to apply audio bitrate preference:", error);
        });
      }
    }
  };

  const handleUserJoined = useCallback(
    async (remoteId: string) => {
      if (!remoteId || matchInProgressRef.current) return;
      matchInProgressRef.current = true;
      matchRoleRef.current = "offerer";
      negotiationReadyRef.current = false;
      pendingIceCandidatesRef.current = [];
      setFlag(false);
      setRemoteSocketId(remoteId);
      setMatchStatus("Match found — establishing connection...");
      try {
        await peerservice.configureIceServers();
        if (peerservice.peer.signalingState !== "stable") throw new Error(`Peer is not ready to offer (${peerservice.peer.signalingState}).`);
        sendStream();
        const offer = await peerservice.getOffer();
        if (!offer || !socket?.connected) throw new Error("Match signaling socket is unavailable.");
        socket.emit("offer", { offer, to: remoteId });
      } catch (error) {
        console.error("Initial WebRTC offer failed:", error);
        setMatchStatus("Connection failed — finding another person...");
        matchInProgressRef.current = false;
        matchRoleRef.current = null;
        negotiationReadyRef.current = false;
        socket?.emit("skip");
      }
    },
    [sendStream, socket]
  );

  const handleMatchFound = useCallback((match: { peerId?: string; role?: "offerer" | "answerer" }) => {
    if (!match?.peerId || (match.role !== "offerer" && match.role !== "answerer")) {
      console.error("Received an invalid matchmaking assignment:", match);
      setMatchStatus("Match setup failed — reconnecting to matchmaking...");
      socket?.emit("matchmaking:leave");
      socket?.emit("matchmaking:join");
      return;
    }
    setMatchStatus("Match found — establishing connection...");
    if (match.role === "offerer") {
      void handleUserJoined(match.peerId);
      return;
    }
    if (matchInProgressRef.current) return;
    matchInProgressRef.current = true;
    matchRoleRef.current = "answerer";
    negotiationReadyRef.current = false;
    pendingIceCandidatesRef.current = [];
    setRemoteSocketId(match.peerId);
  }, [handleUserJoined, socket]);

  const handleIncommingOffer = useCallback(
    async ({ offer, from }: Offer) => {
      try {
        setFlag(false);
        matchInProgressRef.current = true;
        matchRoleRef.current = "answerer";
        setRemoteSocketId(from);
        await peerservice.configureIceServers();
        if (peerservice.peer.signalingState !== "stable") throw new Error(`Cannot accept offer in signaling state ${peerservice.peer.signalingState}.`);
        await peerservice.peer.setRemoteDescription(offer);
        sendStream();
        const answer = await peerservice.peer.createAnswer();
        await peerservice.peer.setLocalDescription(answer);
        await flushPendingIceCandidates();
        setAudioBandwidth(peerservice.peer);
        negotiationReadyRef.current = true;
        if (!socket?.connected) throw new Error("Match signaling socket disconnected before answer.");
        socket.emit("answer", { answer: peerservice.peer.localDescription, to: from });
      } catch (error) {
        console.error("Unable to answer the incoming WebRTC offer:", error);
        setMatchStatus("Connection setup failed — finding another person...");
        matchInProgressRef.current = false;
        matchRoleRef.current = null;
        negotiationReadyRef.current = false;
        socket?.emit("skip");
      }
    },
    [socket, sendStream, flushPendingIceCandidates]
  );

  const handleIncommingAnswer = useCallback(
    async ({ answer }: Answer) => {
      if (peerservice.peer.signalingState === "have-local-offer") {
        await peerservice.setRemoteDescription(answer);
        await flushPendingIceCandidates();
        negotiationReadyRef.current = true;
        sendStream();
        // console.log("get Answer");
      } else {
        console.warn("Peer not in a proper state to set remote description.");
      }
    },
    [sendStream, flushPendingIceCandidates]
  );

  const handleNegotiationNeeded = useCallback(async () => {
    if (!remoteSocketId || !negotiationReadyRef.current || !matchRoleRef.current ||
        peerservice.peer.signalingState !== "stable" || !socket?.connected) return;

    const offer = await peerservice.getOffer();
    if (!offer) return;

    setAudioBandwidth(peerservice.peer);
    socket?.emit("peer:nego:needed", {
      offer,
      to: remoteSocketId
    });
  }, [remoteSocketId, socket]);

  // const handleNegotiationNeeded = useCallback(async () => {

  //   if (peerservice.peer.signalingState === "stable") {
  //     const currentOffer = await peerservice.getOffer();
  //     socket?.emit("peer:nego:needed", {
  //       offer: currentOffer,
  //       to: remoteSocketId,
  //     });
  //     console.log("Negotiation initiated.");
  //   } else {
  //     console.warn("Peer is not in a stable state for negotiation.");
  //   }
  // }, [remoteSocketId, socket]);

  const handleNegotiationIncomming = useCallback(
    async ({ offer, from }: Offer) => {
      // Either participant may initiate later renegotiation (for example,
      // when starting screen share); role restrictions apply only to the
      // initial offer, not subsequent media changes.
      if (!negotiationReadyRef.current) return;
      await peerservice.configureIceServers();
      if (peerservice.peer.signalingState === "stable") {
        const answer = await peerservice.getAnswer(offer);
        await flushPendingIceCandidates();
        socket?.emit("peer:nego:done", { answer, to: from });
      } else {
        console.warn(
          "Cannot handle negotiation in state:",
          peerservice.peer.signalingState
        );
      }
      // console.log("nego:incomming");
    },
    [socket, flushPendingIceCandidates]
  );

  const handleNegotiationFinal = useCallback(
    async ({ answer }: NegotiationDone) => {
      if (peerservice.peer.signalingState === "have-local-offer") {
        await peerservice.setRemoteDescription(answer);
        await flushPendingIceCandidates();
        sendStream();
        // console.log("Final negotiation step completed.");
      } else if (peerservice.peer.signalingState === "stable") {
        console.log("Connection is stable, no need for further negotiation.");
      } else {
        console.warn(
          "Cannot set remote description: Peer connection is in state",
          peerservice.peer.signalingState
        );
      }
    },
    [sendStream, flushPendingIceCandidates]
  );

  const handleSkip = useCallback(async () => {
    // Stop display capture before leaving this stranger; keep camera and mic for the next match.
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsScreenSharing(false);
    setMyStream(localStreamRef.current);

    peerservice.peer.getTransceivers().forEach((transceiver) => {
      if (transceiver.stop) {
        transceiver.stop();
      }
    });

    peerservice.peer.getSenders().forEach((sender) => {
      // Preserve local capture tracks so they can be reused for the next stranger.
      peerservice.peer.removeTrack(sender);
    });

    peerservice.peer.onicecandidate = null;
    peerservice.peer.ontrack = null;
    peerservice.peer.onnegotiationneeded = null;

    if (peerservice.peer.signalingState !== "closed") {
      // console.log("closed");
      peerservice.peer.close();
    }
    peerservice.initPeer();
    pendingIceCandidatesRef.current = [];
    setPeerVersion((version) => version + 1);
    setMessagesArray([]);
    setFlag(false);

    setRemoteStream(null);
    setRemoteSocketId(null);
    matchRoleRef.current = null;
    negotiationReadyRef.current = false;
    matchInProgressRef.current = false;
    setMatchStatus("Looking for someone...");

    socket?.emit("skip");
  }, [socket]);

  // Prevent silent offer/ICE failures from leaving a stale match active forever.
  useEffect(() => {
    if (!remoteSocketId || matchStatus === "Connected" || !matchInProgressRef.current) return;
    const timeout = window.setTimeout(() => {
      if (matchInProgressRef.current && peerservice.peer.connectionState !== "connected") {
        console.warn("WebRTC connection timed out; releasing the stale match.");
        setMatchStatus("Connection timed out — finding another person...");
        void handleSkip();
      }
    }, 25_000);
    return () => window.clearTimeout(timeout);
  }, [remoteSocketId, matchStatus, peerVersion, handleSkip]);
  useEffect(() => {
    const peerConnection = peerservice.peer;
    peerConnection.addEventListener("negotiationneeded", handleNegotiationNeeded);
    return () => peerConnection.removeEventListener("negotiationneeded", handleNegotiationNeeded);
  }, [flag, handleNegotiationNeeded, peerVersion]);

  useEffect(() => {
    const peerConnection = peerservice.peer;
    const handleTrackEvent = (event: RTCTrackEvent) => {
      const incomingStream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStream(incomingStream);
    };
    const handleConnectionState = () => {
      const state = peerConnection.connectionState;
      if (state === "connected") setMatchStatus("Connected");
      else if (state === "failed" || peerConnection.iceConnectionState === "failed") {
        console.warn("WebRTC connection failed; returning both participants to matchmaking.");
        setMatchStatus("Connection failed — finding another person...");
        if (matchInProgressRef.current) void handleSkip();
      } else if (state === "disconnected") setMatchStatus("Connection interrupted — attempting to recover...");
    };
    peerConnection.addEventListener("track", handleTrackEvent);
    peerConnection.addEventListener("connectionstatechange", handleConnectionState);
    return () => {
      peerConnection.removeEventListener("connectionstatechange", handleConnectionState);
      peerConnection.removeEventListener("track", handleTrackEvent);
    };
  }, [peerVersion, handleSkip]);

  const userDisConnected = useCallback(async () => {
    // End screen capture when the remote participant leaves; preserve local camera/mic.
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsScreenSharing(false);
    setMyStream(localStreamRef.current);
    setFlag(true);
    peerservice.peer.getTransceivers().forEach((transceiver) => {
      if (transceiver.stop) {
        transceiver.stop();
      }
    });

    peerservice.peer.getSenders().forEach((sender) => {
      peerservice.peer.removeTrack(sender);
    });

    peerservice.peer.onicecandidate = null;
    peerservice.peer.ontrack = null;
    peerservice.peer.onnegotiationneeded = null;

    if (peerservice.peer.signalingState !== "closed") {
      // console.log("closed");
      peerservice.peer.close();
    }

    setRemoteStream(null);
    setRemoteSocketId(null);
    matchRoleRef.current = null;
    negotiationReadyRef.current = false;
    matchInProgressRef.current = false;
    setMatchStatus("Looking for someone...");

    peerservice.initPeer();
    pendingIceCandidatesRef.current = [];
    setPeerVersion((version) => version + 1);
    setMessagesArray([]);
  }, []);

  useEffect(() => {
    socket?.on("skipped", userDisConnected);

    return () => {
      socket?.off("skipped", userDisConnected);
    };
  }, [socket, userDisConnected]);

  useEffect(() => {
    const peerConnection = peerservice.peer;
    const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && remoteSocketId && socket?.connected) {
        socket.emit("ice-candidate", { candidate: event.candidate, to: remoteSocketId });
      }
    };
    peerConnection.addEventListener("icecandidate", handleIceCandidate);
    return () => peerConnection.removeEventListener("icecandidate", handleIceCandidate);
  }, [socket, remoteSocketId, peerVersion]);

  useEffect(() => {
    socket?.on("ice-candidate", (data) => {
      if (data.candidate) {
        if (!peerservice.peer.remoteDescription) {
          // Candidates can arrive before the offer/answer has been applied.
          // Keep a bounded queue and flush it immediately after remoteDescription.
          if (pendingIceCandidatesRef.current.length >= 256) {
            pendingIceCandidatesRef.current.shift();
          }
          pendingIceCandidatesRef.current.push(data.candidate as RTCIceCandidateInit);
          return;
        }
        void peerservice.peer
          .addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch((error) => {
            console.warn("Unable to apply ICE candidate:", error);
          });
      }
    });

    return () => {
      socket?.off("ice-candidate");
    };
  }, [socket]);

  useEffect(() => {
    const handleSocketConnect = () => {
      setMatchStatus("Looking for someone...");
      socket?.emit("matchmaking:join");
    };

    socket?.on("connect", handleSocketConnect);
    socket?.on("disconnect", userDisConnected);
    socket?.on("match:found", handleMatchFound);
    socket?.on("connect_error", () => setMatchStatus("Unable to reach matchmaking server. Retrying..."));
    const handleProtocolError = (error: { code?: string }) => {
      console.error("Matchmaking/signaling protocol error:", error?.code ?? "unknown");
      if (matchInProgressRef.current) {
        setMatchStatus("Signaling failed — finding another person...");
        matchInProgressRef.current = false;
        matchRoleRef.current = null;
        negotiationReadyRef.current = false;
        socket?.emit("skip");
      } else {
        setMatchStatus("Matchmaking error. Reconnecting...");
        socket?.emit("matchmaking:leave");
        socket?.emit("matchmaking:join");
      }
    };
    socket?.on("protocol:error", handleProtocolError);
    socket?.on("offer", handleIncommingOffer);
    socket?.on("answer", handleIncommingAnswer);
    socket?.on("peer:nego:needed", handleNegotiationIncomming);
    socket?.on("peer:nego:final", handleNegotiationFinal);
    socket?.on("partnerDisconnected", userDisConnected);

    // The socket may already be connected before this screen mounts.
    if (socket?.connected) handleSocketConnect();

    return () => {
      socket?.off("connect", handleSocketConnect);
      socket?.off("disconnect", userDisConnected);
      socket?.off("match:found", handleMatchFound);
      socket?.off("connect_error");
      socket?.off("protocol:error", handleProtocolError);
      socket?.off("offer", handleIncommingOffer);
      socket?.off("answer", handleIncommingAnswer);
      socket?.off("peer:nego:needed", handleNegotiationIncomming);
      socket?.off("peer:nego:final", handleNegotiationFinal);
      socket?.off("partnerDisconnected", userDisConnected);
    };
  }, [
    handleIncommingAnswer,
    handleIncommingOffer,
    handleNegotiationFinal,
    handleNegotiationIncomming,
    handleMatchFound,
    socket,
    userDisConnected
  ]);

  const handleCleanup = useCallback(() => {
    // console.log("Cleaning up...");

    // Stop both independent capture sources. During screen sharing myStream is
    // the display stream, while localStreamRef still owns camera and microphone.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    cameraPromiseRef.current = null;
    microphonePromiseRef.current = null;
    setMyStream(null);
    setScreenStream(null);
    setIsScreenSharing(false);

    // Disconnect the socket
    if (socket) {
      socket.emit("matchmaking:leave");
      socket.disconnect();
    }

    // Close and reset Peer Connection
    if (peerservice.peer.signalingState !== "closed") {
      peerservice.peer.close();
      peerservice.initPeer(); // Re-initialize the peer connection if needed
    }

    navigate("/");
  }, [navigate, socket]);

  return (
    <div className="flex flex-col lg:flex-row w-screen bg-gradient-to-b from-gray-200 to-gray-400 dark:from-gray-800 dark:to-gray-900 transition-colors duration-300">
      {/* Left Side */}
      <div className="lg:w-[450px] w-full lg:h-[calc(100vh-64px)] h-auto border-b lg:border-b-0 lg:border-r border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl rounded-lg overflow-hidden">
        {/* My Stream */}
        {myStream ? (
          <div className="relative w-full h-64 lg:h-1/2">
            <MediaVideo stream={myStream} muted className="absolute inset-0 h-full w-full rounded-lg object-cover" />
            <div className="absolute bottom-0 left-0 bg-gradient-to-t from-black via-transparent to-transparent p-3 text-white text-sm rounded-tl-lg">
              My Stream
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-64 lg:h-1/2 bg-gray-400 dark:bg-gray-700 rounded-lg shadow-md">
            <ClipLoader color={loaderColor} size={50} />
            <p className="text-gray-600 dark:text-gray-300 mt-2">Camera is optional</p>
          </div>
        )}

        {/* Remote Stream */}
        {remoteStream ? (
          <div className="relative w-full h-64 lg:h-1/2">
            <MediaVideo stream={remoteStream} className="absolute inset-0 h-full w-full rounded-lg object-cover" />
            <div className="absolute bottom-0 left-0 bg-gradient-to-t from-black via-transparent to-transparent p-3 text-white text-sm rounded-tl-lg">
              Remote Stream
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-64 lg:h-1/2 bg-gray-400 dark:bg-gray-700 rounded-lg shadow-md">
            <ClipLoader color={loaderColor} size={50} />
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              {matchStatus}
            </p>
          </div>
        )}
      </div>

      {/* Right Side */}
      <div className="flex-1 flex flex-col w-full">
        {/* Button Controls */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-row gap-4 h-auto sm:h-16 shadow rounded-lg bg-gray-50 dark:bg-gray-900">
          <Button
            className="flex-1 p-2 gap-2 bg-red-600 text-white rounded-md"
            size={"icon"}
            onClick={handleCleanup}
          >
            <StepBack size={18} />
            <span className="hidden sm:inline">Stop</span>
          </Button>
          <Button
            className={`flex-1 p-2 gap-2 bg-blue-600 text-white rounded-md ${
              remoteSocketId === null ? "opacity-50 cursor-not-allowed" : ""
            }`}
            size={"icon"}
            onClick={handleSkip}
            disabled={remoteSocketId === null}
          >
            <StepForward size={18} />
            <span className="hidden sm:inline">Skip</span>
          </Button>
          <Button
            className="flex-1 p-2 gap-2 bg-green-600 text-white rounded-md"
            onClick={handleScreenShare}
            size={"icon"}
          >
            <ScreenShare size={18} />
            <span className="hidden sm:inline">
              {isScreenSharing ? "Stop Sharing" : "Share Screen"}
            </span>
          </Button>
          <Button className="flex-1 p-2 gap-2 bg-gray-600 text-white rounded-md" onClick={toggleCamera}>
            <span>{isCameraOn ? "Turn Off Camera" : cameraPermission === "denied" ? "Retry Camera" : "Enable Camera"}</span>
          </Button>
          <Button className="flex-1 p-2 gap-2 bg-gray-600 text-white rounded-md" onClick={toggleMic}>
            <span>{isMicOn ? "Turn Off Mic" : micPermission === "denied" ? "Retry Mic" : "Enable Mic"}</span>
          </Button>
        </div>

        <p className="mx-4 mt-2 text-xs text-gray-600 dark:text-gray-300">Camera: {cameraPermission === "granted" ? (isCameraOn ? "on" : "off") : cameraPermission === "denied" ? "permission denied" : "not enabled"} · Microphone: {micPermission === "granted" ? (isMicOn ? "on" : "off") : micPermission === "denied" ? "permission denied" : "not enabled"}</p>
        {mediaError && <p role="alert" className="mx-4 mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{mediaError}</p>}

        {/* Messages Area */}
        <div className="flex-1 max-h-[calc(100vh-128px)] overflow-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow-inner">
          {screenStream ? (
            <MediaVideo stream={screenStream} muted className="h-full w-full rounded-lg object-contain" />
          ) : (
            <Messages
              remoteSocketId={remoteSocketId}
              messagesArray={messagesArray}
              setMessagesArray={setMessagesArray}
            />
          )}
        </div>
      </div>
    </div>
  );
}
