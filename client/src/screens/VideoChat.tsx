import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../context/SocketProvider";
import peerservice from "../service/peer";
import ReactPlayer from "react-player";
import { Button } from "../components/ui/button";
import Messages from "../components/Messages";
import { ScreenShare, StepBack, StepForward } from "lucide-react";
import { ClipLoader } from "react-spinners"; // Import the spinner
import { useTheme } from "../components/theme-provider";
import { useNavigate } from "react-router-dom";
import "../css/VideoChat.css";

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
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const [peerVersion, setPeerVersion] = useState(0);

  const theme = useTheme();
  const navigate = useNavigate();

  const loaderColor = theme.theme === "dark" ? "#D1D5DB" : "#4B5563";

  const getUserStream = useCallback((): Promise<MediaStream> => {
    const existingStream = localStreamRef.current;
    const hasLiveCamera = existingStream?.getVideoTracks().some((track) => track.readyState === "live");
    const hasLiveMicrophone = existingStream?.getAudioTracks().some((track) => track.readyState === "live");
    if (existingStream && hasLiveCamera && hasLiveMicrophone) return Promise.resolve(existingStream);

    if (localStreamPromiseRef.current) {
      return localStreamPromiseRef.current;
    }

    const capturePromise = navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }).then((stream) => {
      // Replace a partially-ended stream only after the new capture succeeds.
      existingStream?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = stream;
      setMyStream(stream);
      setIsCameraOn(stream.getVideoTracks().some((track) => track.enabled && track.readyState === "live"));
      setIsMicOn(stream.getAudioTracks().some((track) => track.enabled && track.readyState === "live"));
      localStreamPromiseRef.current = null;
      return stream;
    }).catch((error: unknown) => {
      localStreamPromiseRef.current = null;
      throw error;
    });

    localStreamPromiseRef.current = capturePromise;
    return capturePromise;
  }, []);

  useEffect(() => {
    void getUserStream().catch((error: unknown) => {
      console.error("Unable to access camera or microphone:", error);
    });
  }, [getUserStream]);

  const toggleCamera = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live") return;

    const nextCameraState = !isCameraOn;
    videoTrack.enabled = nextCameraState;
    setIsCameraOn(nextCameraState);
  }, [isCameraOn]);

  const toggleMic = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live") return;

    const nextMicState = !isMicOn;
    audioTrack.enabled = nextMicState;
    setIsMicOn(nextMicState);
  }, [isMicOn]);

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
    const audioTrack = stream.getAudioTracks()[0];
    const senders = peerservice.peer.getSenders();

    if (videoTrack && !senders.some((sender) => sender.track === videoTrack)) {
      peerservice.peer.addTrack(videoTrack, screenStreamRef.current ?? stream);
    }

    if (audioTrack && !senders.some((sender) => sender.track === audioTrack)) {
      peerservice.peer.addTrack(audioTrack, stream);
    }
  }, []);

  const stopScreenShare = useCallback(async (stopCapture = true) => {
    const stream = screenStreamRef.current;
    const cameraTrack = localStreamRef.current?.getVideoTracks().find((track) => track.readyState === "live") ?? null;
    const videoSender = peerservice.peer.getSenders().find((sender) => sender.track?.kind === "video");
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
    if (screenStreamRef.current) {
      await stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      console.warn("Screen sharing is not supported by this browser or context.");
      return;
    }
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
      setFlag(false);
      setRemoteSocketId(remoteId);
      const offer = await peerservice.getOffer();

      socket?.emit("offer", { offer, to: remoteId });
      // console.log("user joined");
    },
    [socket]
  );

  const handleIncommingOffer = useCallback(
    async ({ offer, from }: Offer) => {
      setFlag(false);
      setRemoteSocketId(from);
      await getUserStream();

      if (peerservice.peer.signalingState === "stable") {
        const answer = await peerservice.getAnswer(offer);
        await flushPendingIceCandidates();
        setAudioBandwidth(peerservice.peer);
        socket?.emit("answer", { answer, to: from });
        // console.log("Answer created and sent");
        sendStream();
      } else {
        console.warn(
          "Cannot handle incoming offer in signaling state:",
          peerservice.peer.signalingState
        );
      }
    },
    [getUserStream, socket, sendStream, flushPendingIceCandidates]
  );

  const handleIncommingAnswer = useCallback(
    async ({ answer }: Answer) => {
      if (peerservice.peer.signalingState === "have-local-offer") {
        await peerservice.setRemoteDescription(answer);
        await flushPendingIceCandidates();
        sendStream();
        // console.log("get Answer");
      } else {
        console.warn("Peer not in a proper state to set remote description.");
      }
    },
    [sendStream, flushPendingIceCandidates]
  );

  const handleNegotiationNeeded = useCallback(async () => {
    if (peerservice.peer.signalingState !== "stable") {
      return;
    }

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
      if (
        peerservice.peer.signalingState === "stable" ||
        peerservice.peer.signalingState === "have-local-offer"
      ) {
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
      if (
        peerservice.peer.signalingState === "have-local-offer" ||
        peerservice.peer.signalingState === "have-remote-offer"
      ) {
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

    socket?.emit("skip");
  }, [socket]);

  useEffect(() => {
    peerservice.peer.addEventListener("negotiationneeded", handleNegotiationNeeded);

    return () => {
      peerservice.peer.removeEventListener(
        "negotiationneeded",
        handleNegotiationNeeded
      );
    };
  }, [flag, handleNegotiationNeeded, peerVersion]);

  useEffect(() => {
    const handleTrackEvent = (event: RTCTrackEvent) => {
      const incomingStream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStream(incomingStream);
    };

    peerservice.peer.addEventListener("track", handleTrackEvent);

    return () => {
      peerservice.peer.removeEventListener("track", handleTrackEvent);
    };
  }, [isScreenSharing, sendStream, flag, peerVersion]);

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
    peerservice.peer.onicecandidate = (event) => {
      if (event.candidate) {
        // console.log("Sending ICE candidate:", event.candidate);
        socket?.emit("ice-candidate", {
          candidate: event.candidate,
          to: remoteSocketId
        });
      }
    };
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
      socket?.emit("matchmaking:join");
    };

    socket?.on("connect", handleSocketConnect);
    socket?.on("disconnect", userDisConnected);
    socket?.on("user:connect", handleUserJoined);
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
      socket?.off("user:connect", handleUserJoined);
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
    handleUserJoined,
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
    localStreamPromiseRef.current = null;
    setMyStream(null);
    setScreenStream(null);
    setIsScreenSharing(false);

    // Disconnect the socket
    if (socket) {
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
            <ReactPlayer
              className="absolute inset-0 rounded-lg"
              url={myStream}
              playing
              muted
              width="100%"
              height="100%"
            />
            <div className="absolute bottom-0 left-0 bg-gradient-to-t from-black via-transparent to-transparent p-3 text-white text-sm rounded-tl-lg">
              My Stream
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-64 lg:h-1/2 bg-gray-400 dark:bg-gray-700 rounded-lg shadow-md">
            <ClipLoader color={loaderColor} size={50} />
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              Loading your stream...
            </p>
          </div>
        )}

        {/* Remote Stream */}
        {remoteStream ? (
          <div className="relative w-full h-64 lg:h-1/2">
            <ReactPlayer
              className="absolute inset-0 rounded-lg"
              url={remoteStream}
              playing
              muted={false}
              width="100%"
              height="100%"
            />
            <div className="absolute bottom-0 left-0 bg-gradient-to-t from-black via-transparent to-transparent p-3 text-white text-sm rounded-tl-lg">
              Remote Stream
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-64 lg:h-1/2 bg-gray-400 dark:bg-gray-700 rounded-lg shadow-md">
            <ClipLoader color={loaderColor} size={50} />
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              Waiting for user to connect...
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
            <span>{isCameraOn ? "Turn Off Camera" : "Turn On Camera"}</span>
          </Button>
          <Button className="flex-1 p-2 gap-2 bg-gray-600 text-white rounded-md" onClick={toggleMic}>
            <span>{isMicOn ? "Turn Off Mic" : "Turn On Mic"}</span>
          </Button>
        </div>

        {/* Messages Area */}
        <div className="flex-1 max-h-[calc(100vh-128px)] overflow-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow-inner">
          {screenStream ? (
            <ReactPlayer
              className="w-full h-full rounded-lg"
              url={screenStream}
              playing
              width="100%"
              height="100%"
            />
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
