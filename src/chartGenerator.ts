/**
 * Generates a playable chart from an uploaded song's audio by tracking a
 * single dominant melodic line over time — a monophonic pitch tracker, not
 * per-band onset triggers. That's what makes it feel like it's following a
 * lead line rather than reacting to loudness in five arbitrary frequency
 * bins: at each moment we ask "what's the one clearest pitched tone right
 * now?" via Harmonic Product Spectrum (HPS), gate out anything that isn't
 * actually tonal (drum hits, silence, noise), and turn the resulting pitch
 * trace into notes.
 *
 * This is still a heuristic, not real source separation — it can't isolate
 * "the guitar" from vocals/bass in a mix. It follows whichever pitched
 * sound is most harmonically dominant at each instant, which tracks a lead
 * vocal or guitar reasonably well when one is prominent, but has no way to
 * know which instrument it's "supposed" to be listening to.
 */
import type { ChartNote, ChartSong, Difficulty } from "./chart";

export interface GeneratedChart {
  song: ChartSong;
  notesByDifficulty: Record<Difficulty, ChartNote[]>;
}

const FFT_SIZE = 2048;
const ANALYSIS_HOP_SECONDS = 0.015; // ~67 pitch estimates/sec
const MIN_FREQUENCY_HZ = 80; // just below a guitar low E (82Hz)
const MAX_FREQUENCY_HZ = 1500; // generous headroom for high notes/bends
const NUM_HARMONICS = 5; // HPS depth: how many harmonics reinforce the fundamental estimate

const HARMONIC_RATIO_THRESHOLD = 0.12; // fraction of in-range spectral energy that must sit on the harmonic series
const RMS_GATE_RATIO = 0.25; // frame must be at least this fraction of the song's mean loudness to count

const PITCH_MEDIAN_WINDOW = 5; // frames; denoises single-frame octave errors and blips
const RETRIGGER_SEMITONES = 0.7; // pitch must move at least this far to count as a new note, not vibrato
const MAX_GAP_FRAMES = 3; // consecutive unvoiced frames tolerated before a held note is considered over

const MIN_NOTE_SECONDS = 0.05; // shorter than this is treated as detection noise, not a real note
const SUSTAIN_MIN_SECONDS = 0.2; // shorter than this is charted as a tap, not a hold
const MAX_SUSTAIN_SECONDS = 3; // caps one very long held note

const DIFFICULTY_MIN_GAP_SECONDS: Record<Difficulty, number> = {
  Expert: 0,
  Hard: 0.15,
  Medium: 0.3,
  Easy: 0.5,
};

interface MelodyNote {
  startTime: number;
  endTime: number;
  meanPitch: number; // in fractional MIDI note units
}

export async function generateChart(buffer: AudioBuffer, name: string, artist: string): Promise<GeneratedChart> {
  const mono = toMono(buffer);
  const pitchTrace = trackPitch(mono, buffer.sampleRate);
  const smoothed = medianFilterPitch(pitchTrace);
  const melodyNotes = segmentNotes(smoothed);

  const notesByDifficulty = {} as Record<Difficulty, ChartNote[]>;
  for (const difficulty of Object.keys(DIFFICULTY_MIN_GAP_SECONDS) as Difficulty[]) {
    notesByDifficulty[difficulty] = toChartNotes(melodyNotes, DIFFICULTY_MIN_GAP_SECONDS[difficulty]);
  }

  return {
    song: { name, artist, musicStream: "", resolution: 192 },
    notesByDifficulty,
  };
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    mono[i] = sum / channels.length;
  }
  return mono;
}

interface PitchFrame {
  time: number;
  pitch: number | null; // fractional MIDI note, or null if this frame isn't confidently pitched
}

function trackPitch(mono: Float32Array, sampleRate: number): PitchFrame[] {
  const hopSize = Math.max(1, Math.round(ANALYSIS_HOP_SECONDS * sampleRate));
  const window = hannWindow(FFT_SIZE);
  const binHz = sampleRate / FFT_SIZE;
  const minBin = Math.max(1, Math.floor(MIN_FREQUENCY_HZ / binHz));
  const maxBin = Math.min(Math.floor(FFT_SIZE / 2 / NUM_HARMONICS), Math.ceil(MAX_FREQUENCY_HZ / binHz));

  const frameCount = Math.max(0, Math.floor((mono.length - FFT_SIZE) / hopSize) + 1);
  const frameStarts: number[] = [];
  for (let f = 0; f < frameCount; f++) frameStarts.push(f * hopSize);

  const rmsValues = frameStarts.map((start) => frameRms(mono, start, FFT_SIZE));
  const meanRms = rmsValues.reduce((a, b) => a + b, 0) / (rmsValues.length || 1);
  const rmsGate = meanRms * RMS_GATE_RATIO;

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  return frameStarts.map((start, i) => {
    const time = start / sampleRate;
    if (rmsValues[i] < rmsGate) return { time, pitch: null };

    for (let j = 0; j < FFT_SIZE; j++) {
      re[j] = mono[start + j] * window[j];
      im[j] = 0;
    }
    fft(re, im);

    const magnitude = new Float64Array(FFT_SIZE / 2);
    for (let k = 0; k < magnitude.length; k++) magnitude[k] = Math.hypot(re[k], im[k]);

    const bestBin = findFundamentalBin(magnitude, minBin, maxBin);
    if (bestBin === null) return { time, pitch: null };

    const refinedBin = parabolicPeakOffset(magnitude, bestBin);
    const frequency = (refinedBin * sampleRate) / FFT_SIZE;
    const pitch = 69 + 12 * Math.log2(frequency / 440);
    return { time, pitch };
  });
}

function frameRms(mono: Float32Array, start: number, size: number): number {
  const end = Math.min(mono.length, start + size);
  let sumSquares = 0;
  for (let i = start; i < end; i++) sumSquares += mono[i] * mono[i];
  return Math.sqrt(sumSquares / Math.max(1, end - start));
}

function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return window;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curWr = 1;
      let curWi = 0;
      const half = len / 2;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + half] * curWr - im[i + j + half] * curWi;
        const vi = re[i + j + half] * curWi + im[i + j + half] * curWr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nextWr = curWr * wr - curWi * wi;
        const nextWi = curWr * wi + curWi * wr;
        curWr = nextWr;
        curWi = nextWi;
      }
    }
  }
}

/** Picks the bin whose harmonic series (HPS) best explains the spectrum, gated by how tonal it actually is. */
function findFundamentalBin(magnitude: Float64Array, minBin: number, maxBin: number): number | null {
  let bestBin = minBin;
  let bestScore = -Infinity;

  for (let bin = minBin; bin <= maxBin; bin++) {
    let score = 0;
    for (let h = 1; h <= NUM_HARMONICS; h++) score += Math.log(magnitude[bin * h] + 1e-8);
    if (score > bestScore) {
      bestScore = score;
      bestBin = bin;
    }
  }

  let harmonicEnergy = 0;
  for (let h = 1; h <= NUM_HARMONICS; h++) harmonicEnergy += magnitude[bestBin * h];

  let totalEnergy = 0;
  const regionEnd = maxBin * NUM_HARMONICS;
  for (let k = 1; k <= regionEnd; k++) totalEnergy += magnitude[k];

  const harmonicRatio = harmonicEnergy / (totalEnergy + 1e-8);
  return harmonicRatio >= HARMONIC_RATIO_THRESHOLD ? bestBin : null;
}

/** Quadratic interpolation around a spectral peak for sub-bin frequency accuracy. */
function parabolicPeakOffset(magnitude: Float64Array, bin: number): number {
  const y0 = bin > 0 ? magnitude[bin - 1] : magnitude[bin];
  const y1 = magnitude[bin];
  const y2 = bin + 1 < magnitude.length ? magnitude[bin + 1] : magnitude[bin];
  const denom = y0 - 2 * y1 + y2;
  if (denom === 0) return bin;
  return bin + 0.5 * (y0 - y2) / denom;
}

/** Median-filters the pitch trace (in semitone space) to kill single-frame octave errors and blips. */
function medianFilterPitch(frames: PitchFrame[]): PitchFrame[] {
  const half = Math.floor(PITCH_MEDIAN_WINDOW / 2);

  return frames.map((frame, i) => {
    const windowValues: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(frames.length - 1, i + half); j++) {
      const pitch = frames[j].pitch;
      if (pitch !== null) windowValues.push(pitch);
    }
    if (windowValues.length < Math.ceil(PITCH_MEDIAN_WINDOW / 2)) return { time: frame.time, pitch: null };

    windowValues.sort((a, b) => a - b);
    const median = windowValues[Math.floor(windowValues.length / 2)];
    return { time: frame.time, pitch: median };
  });
}

/** Turns a smoothed pitch trace into discrete melody notes, re-triggering only on a real pitch change. */
function segmentNotes(frames: PitchFrame[]): MelodyNote[] {
  const notes: MelodyNote[] = [];
  let open: { startTime: number; endTime: number; pitches: number[] } | null = null;
  let gapFrames = 0;

  const closeOpenNote = () => {
    if (!open) return;
    const duration = open.endTime - open.startTime;
    if (duration >= MIN_NOTE_SECONDS) {
      const meanPitch = open.pitches.reduce((a, b) => a + b, 0) / open.pitches.length;
      notes.push({ startTime: open.startTime, endTime: open.endTime, meanPitch });
    }
    open = null;
  };

  for (const frame of frames) {
    if (frame.pitch === null) {
      gapFrames++;
      if (open && gapFrames > MAX_GAP_FRAMES) closeOpenNote();
      continue;
    }
    gapFrames = 0;

    if (!open) {
      open = { startTime: frame.time, endTime: frame.time, pitches: [frame.pitch] };
      continue;
    }

    const heldPitch = open.pitches[open.pitches.length - 1];
    if (Math.abs(frame.pitch - heldPitch) >= RETRIGGER_SEMITONES) {
      closeOpenNote();
      open = { startTime: frame.time, endTime: frame.time, pitches: [frame.pitch] };
    } else {
      open.endTime = frame.time;
      open.pitches.push(frame.pitch);
    }
  }
  closeOpenNote();

  return notes;
}

function toChartNotes(melodyNotes: MelodyNote[], minGapSeconds: number): ChartNote[] {
  if (melodyNotes.length === 0) return [];

  const minPitch = Math.min(...melodyNotes.map((n) => n.meanPitch));
  const maxPitch = Math.max(...melodyNotes.map((n) => n.meanPitch));
  const pitchRange = Math.max(1, maxPitch - minPitch);
  const laneFor = (pitch: number) => Math.min(4, Math.floor(((pitch - minPitch) / pitchRange) * 5));

  const notes: ChartNote[] = [];
  let lastKeptTime = -Infinity;

  for (const note of melodyNotes) {
    if (note.startTime - lastKeptTime < minGapSeconds) continue;
    lastKeptTime = note.startTime;

    const duration = Math.min(MAX_SUSTAIN_SECONDS, note.endTime - note.startTime);
    notes.push({
      timeSeconds: note.startTime,
      lane: laneFor(note.meanPitch),
      sustainSeconds: duration >= SUSTAIN_MIN_SECONDS ? duration : 0,
    });
  }

  return notes;
}
