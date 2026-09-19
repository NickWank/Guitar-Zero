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
    const arrayBuffer = await response.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  play(): void {
    if (!this.buffer) throw new Error("Audio not loaded yet");
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.ctx.destination);
    this.startedAtContextTime = this.ctx.currentTime;
    source.start(this.startedAtContextTime);
    this.source = source;
  }

  /** Seconds elapsed since playback started, sourced from the audio clock. */
  get currentTime(): number {
    if (!this.source) return 0;
    return this.ctx.currentTime - this.startedAtContextTime;
  }

  get isPlaying(): boolean {
    return this.source !== null && this.currentTime < this.duration;
  }
}
