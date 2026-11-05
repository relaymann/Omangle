export type PartnerLeftReason = "skipped" | "disconnected" | "left";

export type MatchmakerEvents = {
  matched: (offererId: string, answererId: string) => void;
  partnerLeft: (socketId: string, reason: PartnerLeftReason) => void;
};

export class Matchmaker {
  private readonly waiting: string[] = [];
  private readonly waitingSet = new Set<string>();
  private readonly partners = new Map<string, string>();
  private readonly recentPairs = new Map<string, number>();

  constructor(
    private readonly events: MatchmakerEvents,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now
  ) {}

  join(socketId: string): void {
    if (!socketId || this.partners.has(socketId) || this.waitingSet.has(socketId)) return;

    this.pruneCooldowns();
    const candidateIndex = this.waiting.findIndex(
      (candidate) => candidate !== socketId && !this.isCoolingDown(socketId, candidate)
    );

    if (candidateIndex === -1) {
      this.waiting.push(socketId);
      this.waitingSet.add(socketId);
      return;
    }

    const [candidateId] = this.waiting.splice(candidateIndex, 1);
    if (!candidateId) return;
    this.waitingSet.delete(candidateId);
    this.partners.set(socketId, candidateId);
    this.partners.set(candidateId, socketId);
    this.events.matched(socketId, candidateId);
  }

  skip(socketId: string): void {
    const partnerId = this.partners.get(socketId);
    if (!partnerId) {
      this.removeFromQueue(socketId);
      this.join(socketId);
      return;
    }

    this.unlink(socketId, partnerId);
    this.recentPairs.set(this.pairKey(socketId, partnerId), this.now() + this.cooldownMs);
    this.events.partnerLeft(partnerId, "skipped");
    this.join(partnerId);
    this.join(socketId);
  }

  disconnect(socketId: string): void {
    this.removeFromQueue(socketId);
    const partnerId = this.partners.get(socketId);
    if (!partnerId) return;

    this.unlink(socketId, partnerId);
    this.events.partnerLeft(partnerId, "disconnected");
    this.join(partnerId);
  }

  leave(socketId: string): void {
    this.removeFromQueue(socketId);
    const partnerId = this.partners.get(socketId);
    if (!partnerId) return;

    this.unlink(socketId, partnerId);
    this.events.partnerLeft(partnerId, "left");
    this.join(partnerId);
  }

  getPartner(socketId: string): string | undefined {
    return this.partners.get(socketId);
  }

  isPaired(socketId: string): boolean {
    return this.partners.has(socketId);
  }

  getWaitingCount(): number {
    return this.waitingSet.size;
  }

  private unlink(socketId: string, partnerId: string): void {
    this.partners.delete(socketId);
    this.partners.delete(partnerId);
  }

  private removeFromQueue(socketId: string): void {
    if (!this.waitingSet.delete(socketId)) return;
    const index = this.waiting.indexOf(socketId);
    if (index !== -1) this.waiting.splice(index, 1);
  }

  private pairKey(firstId: string, secondId: string): string {
    return [firstId, secondId].sort().join(":");
  }

  private isCoolingDown(firstId: string, secondId: string): boolean {
    const expiresAt = this.recentPairs.get(this.pairKey(firstId, secondId));
    return expiresAt !== undefined && expiresAt > this.now();
  }

  private pruneCooldowns(): void {
    const currentTime = this.now();
    for (const [key, expiresAt] of this.recentPairs) {
      if (expiresAt <= currentTime) this.recentPairs.delete(key);
    }
  }
}
