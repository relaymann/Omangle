const apiBaseUrl = (import.meta.env.VITE_API_SERVER_URL ?? "").replace(/\/+$/, "");
const fallbackIceServers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }];
interface IceConfigurationResponse { iceServers?: RTCIceServer[]; turnConfigured?: boolean; expiresInSeconds?: number | null; }

class PeerService {
    public peer!: RTCPeerConnection;
    private iceServers: RTCIceServer[] = fallbackIceServers;
    private iceConfigPromise: Promise<void> | null = null;
    private iceConfigExpiresAt = 0;
    public turnConfigured = false;
    constructor() { this.initPeer(); }
    initPeer() {
        if (this.peer && this.peer.signalingState !== "closed") { this.peer.getTransceivers().forEach((t) => t.stop()); this.peer.close(); }
        this.peer = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" });
        // Create media sections before negotiation so users can match without granting
        // camera or microphone permission, then attach either track independently later.
        this.peer.addTransceiver("audio", { direction: "sendrecv" });
        this.peer.addTransceiver("video", { direction: "sendrecv" });
    }
    async configureIceServers(): Promise<boolean> {
        if (!apiBaseUrl) return false;
        if (this.iceConfigExpiresAt > Date.now() + 60_000) {
            this.peer.setConfiguration({ iceServers: this.iceServers, iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" });
            return this.turnConfigured;
        }
        if (!this.iceConfigPromise) {
            this.iceConfigPromise = (async () => {
                const response = await fetch(`${apiBaseUrl}/api/ice-servers`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
                if (!response.ok) throw new Error(`ICE configuration request failed (${response.status}).`);
                const config = await response.json() as IceConfigurationResponse;
                if (!Array.isArray(config.iceServers) || config.iceServers.length === 0) throw new Error("No ICE servers returned by backend.");
                this.iceServers = config.iceServers;
                this.turnConfigured = config.turnConfigured === true;
                const ttl = Math.max(60, Math.min(config.expiresInSeconds ?? 300, 86_400));
                this.iceConfigExpiresAt = Date.now() + ttl * 1000;
            })();
        }
        try { await this.iceConfigPromise; }
        catch (error) {
            console.warn("TURN configuration unavailable; falling back to STUN only:", error);
            this.iceServers = fallbackIceServers;
            this.turnConfigured = false;
            this.iceConfigExpiresAt = Date.now() + 30_000;
        } finally { this.iceConfigPromise = null; }
        this.peer.setConfiguration({ iceServers: this.iceServers, iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" });
        return this.turnConfigured;
    }
    async getOffer() { const offer = await this.peer.createOffer(); await this.peer.setLocalDescription(offer); return this.peer.localDescription; }
    async getAnswer(offer: RTCSessionDescriptionInit) { await this.peer.setRemoteDescription(offer); const answer = await this.peer.createAnswer(); await this.peer.setLocalDescription(answer); return this.peer.localDescription; }
    async setRemoteDescription(answer: RTCSessionDescriptionInit) { await this.peer.setRemoteDescription(answer); }
}
const peerservice = new PeerService();
export default peerservice;
