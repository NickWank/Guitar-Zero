/**
 * Wraps Web Audio playback and exposes the current song position derived
 * from the audio clock itself (ctx.currentTime), not requestAnimationFrame —
 * that's what keeps note timing accurate over a multi-minute song instead of
 * drifting with frame timing.
 */
export class AudioClock {
  private ctx = new AudioContext();
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAtContextTime = 0;

  async load(url: string): Promise<void> {
    const response = await fetch(url);
    await this.decode(await response.arrayBuffer());
  }

  /** Loads audio from a locally-held file (e.g. an upload or an IndexedDB record), no network fetch. */
  async loadFromBlob(blob: Blob): Promise<void> {
    await this.decode(await blob.arrayBuffer());
  }

  private async decode(arrayBuffer: ArrayBuffer): Promise<void> {
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /**
   * Schedules playback to begin `delaySeconds` from now. Until then,
   * `currentTime` reads negative — a count-in the caller can use to let
   * notes scroll into view before the song's t=0 actually sounds.
   */
  play(delaySeconds = 0): void {
    if (!this.buffer) throw new Error("Audio not loaded yet");
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.ctx.destination);
    this.startedAtContextTime = this.ctx.currentTime + delaySeconds;
    source.start(this.startedAtContextTime);
    this.source = source;
  }

  /** Seconds elapsed since the song's t=0 (negative during the count-in). */
  get currentTime(): number {
    if (!this.source) return 0;
    return this.ctx.currentTime - this.startedAtContextTime;
  }

  get isPlaying(): boolean {
    return this.source !== null && this.currentTime < this.duration;
  }
}
