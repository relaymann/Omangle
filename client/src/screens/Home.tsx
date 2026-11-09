import { useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { useSocket } from "../context/SocketProvider";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
// import { Github } from "lucide-react";
import { Helmet } from "react-helmet-async";

export default function Home() {
  const { socket, setSocket } = useSocket();
  const navigate = useNavigate();
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleStartCall = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setConnectionError(null);
      if (!socket) {
        const apiUrl = String(import.meta.env.VITE_API_SERVER_URL ?? "").trim().replace(/\/+$/, "");
        if (!apiUrl) {
          console.error("VITE_API_SERVER_URL is missing. Configure it to point to the Render backend.");
          setConnectionError("Omangle matchmaking is not configured yet. Please try again later.");
          return;
        }
        const newSocket = io(apiUrl, {
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 500,
          reconnectionDelayMax: 5000,
          timeout: 20000,
          transports: ["polling", "websocket"]
        });
        setSocket(newSocket);
      } else if (!socket.connected) {
        socket.connect();
      }
      navigate("/chat");
    },
    [setSocket, socket, navigate]
  );

  return (
    <>
      <Helmet>
        <title>Omangle - Connect, Chat, Collaborate</title>
        <meta
          name="description"
          content="Omangle is an innovative video chat application designed to connect users from all around the world for spontaneous and engaging conversations. Built with a focus on ease of use and seamless interaction, Omangle allows users to effortlessly start video calls, share screens, and exchange messages in real-time. Whether you're seeking to meet new people, collaborate on projects, or simply enjoy face-to-face interactions, Omangle delivers a smooth experience with user-friendly features. It prioritizes privacy, utilizing encrypted connections to ensure that all communications are secure. The platform's sleek and modern design, combined with features like quick user pairing, screen sharing, and integrated messaging, makes Omangle a go-to choice for both casual and professional video chatting."
        />
        <meta
          name="keywords"
          content="Omangle, random chat, video chat, voice chat, text chat, WebRTC, meet people"
        />
      </Helmet>
      <main className="flex flex-col justify-center h-full mx-auto w-full p-4 lg:p-8">
        {connectionError && <p role="alert" className="mx-auto mb-4 max-w-xl rounded-lg border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-800">{connectionError}</p>}
        <div className="w-full flex flex-col lg:flex-row justify-center items-center lg:justify-evenly mx-auto">
          {/* Logo Section */}
          <div className="flex flex-col items-center justify-center text-center mb-6 lg:mb-0 w-full lg:w-auto">
            <img
              src="/logo.png"
              alt="Omangle"
              width={640}
              height={640}
              fetchPriority="high"
              className="w-[min(76vw,420px)] lg:w-[min(38vw,520px)] h-auto mb-6 shadow-2xl"
            />
            <p className="text-base sm:text-lg md:text-xl mb-4 sm:mb-6 ">
              Meet. Chat. Connect.
            </p>
          </div>

          {/* Description & Call-to-Action Section */}
          <div className="bg-black shadow-xl rounded-3xl p-6 md:p-8 w-full lg:w-[60%] mx-0 backdrop-blur-lg bg-opacity-60 border border-orange-500">
            <p className="text-sm sm:text-base md:text-lg mb-6 md:mb-8 leading-relaxed text-gray-200">
              Omangle is an innovative video chat application designed to connect
              users from all around the world for spontaneous and engaging
              conversations. Built with a focus on ease of use and seamless
              interaction, Omangle allows users to effortlessly start video
              calls, share screens, and exchange messages in real-time. Whether
              you're seeking to meet new people, collaborate on projects, or simply
              enjoy face-to-face interactions, Omangle delivers a smooth experience
              with user-friendly features. It prioritizes privacy, utilizing encrypted
              connections to ensure that all communications are secure. The platform's
              sleek and modern design, combined with features like quick user pairing,
              screen sharing, and integrated messaging, makes Omangle a go-to choice
              for both casual and professional video chatting.
            </p>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-6 md:mb-8">
              <Button
                className="w-full sm:w-auto py-3 sm:py-4 text-base sm:text-lg font-semibold tracking-wider shadow-lg transition-transform duration-300 hover:scale-105 bg-orange-600 hover:bg-orange-500 rounded-xl"
                onClick={handleStartCall}
              >
                Start Your Journey
              </Button>
              {/* <a
                href="https://github.com/Shobhit2205/Omangle"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto"
              >
                <Button
                  variant="outline"
                  className="w-full py-3 sm:py-4 text-base sm:text-lg font-semibold tracking-wider shadow-lg transition-transform duration-300 hover:scale-105 flex items-center justify-center gap-2 border-gray-600 rounded-xl"
                >
                  <Github size={24} />
                  Contribute on GitHub
                </Button>
              </a> */}
            </div>

            <div className="text-xs sm:text-sm text-center mt-4 text-orange-200">
              By using Omangle, you agree to our Terms of Service and Privacy
              Policy.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
