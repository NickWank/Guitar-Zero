/**
 * Generates a playable chart directly from an uploaded song's audio, with no
 * ML transcription: a handful of frequency bands (one per lane, low pitch ->
 * low fret, same idea as the manual MIDI-authoring script) each get their own
 * energy-envelope onset detector. It's driven entirely by the song's own
 * waveform and uses no randomness, so the same file always produces the same
 * chart, and different songs naturally produce different patterns.
 *
 * Chords/simultaneous notes aren't charted yet — onsets that land in
 * different lanes within the same instant are collapsed down to the
 * strongest one (see `mergeOnsets`).
 */
import type { ChartNote, ChartSong, Difficulty } from "./chart";

export interface GeneratedChart {
  song: ChartSong;
  notesByDifficulty: Record<Difficulty, ChartNote[]>;
}

interface LaneBand {
  type: BiquadFilterType;
  frequency: number;
  q?: number;
}

// One band per lane (0=green..4=orange), low frequency -> low fret.
const LANE_BANDS: LaneBand[] = [
  { type: "lowpass", frequency: 150 },
  { type: "bandpass", frequency: 250, q: 0.8 },
  { type: "bandpass", frequency: 650, q: 0.8 },
  { type: "bandpass", frequency: 1600, q: 0.8 },
  { type: "highpass", frequency: 2500 },
];

const ENVELOPE_HOP_SECONDS = 0.01; // ~10ms energy-envelope resolution
const ONSET_THRESHOLD_STD_DEVS = 1.2; // peak must exceed band mean + this many std devs
const MIN_ONSET_GAP_SECONDS = 0.1; // refractory period between onsets within one lane
const SIMULTANEOUS_WINDOW_SECONDS = 0.03; // onsets this close across lanes collapse to one

const DIFFICULTY_MIN_GAP_SECONDS: Record<Difficulty, number> = {
  Expert: 0,
  Hard: 0.15,
  Medium: 0.3,
  Easy: 0.5,
};

interface RawOnset {
  time: number;
  lane: number;
  strength: number; // z-score within its own band, comparable across bands
}

export async function generateChart(buffer: AudioBuffer, name: string, artist: string): Promise<GeneratedChart> {
  const laneOnsets = await Promise.all(LANE_BANDS.map((band, lane) => detectLaneOnsets(buffer, band, lane)));
  const merged = mergeOnsets(laneOnsets.flat());

  const notesByDifficulty = {} as Record<Difficulty, ChartNote[]>;
  for (const difficulty of Object.keys(DIFFICULTY_MIN_GAP_SECONDS) as Difficulty[]) {
    notesByDifficulty[difficulty] = thinToDifficulty(merged, DIFFICULTY_MIN_GAP_SECONDS[difficulty]);
  }

  return {
    song: { name, artist, musicStream: "", resolution: 192 },
    notesByDifficulty,
  };
}

async function detectLaneOnsets(buffer: AudioBuffer, band: LaneBand, lane: number): Promise<RawOnset[]> {
  const offlineCtx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  const filter = offlineCtx.createBiquadFilter();
  filter.type = band.type;
  filter.frequency.value = band.frequency;
  if (band.q !== undefined) filter.Q.value = band.q;
  source.connect(filter);
  filter.connect(offlineCtx.destination);
  source.start(0);

  const filtered = await offlineCtx.startRendering();
  const envelope = computeEnvelope(filtered.getChannelData(0), buffer.sampleRate);
  return pickPeaks(envelope, lane);
}

function computeEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hopSize = Math.max(1, Math.round(ENVELOPE_HOP_SECONDS * sampleRate));
  const frameCount = Math.floor(samples.length / hopSize);
  const envelope = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sumSquares = 0;
    const start = i * hopSize;
    for (let j = 0; j < hopSize; j++) {
      const s = samples[start + j];
      sumSquares += s * s;
    }
    envelope[i] = Math.sqrt(sumSquares / hopSize);
  }

  return envelope;
}

/** Local-max peak picking with a per-band adaptive threshold and refractory period. */
function pickPeaks(envelope: Float32Array, lane: number): RawOnset[] {
  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length || 0;
  const variance = envelope.reduce((a, b) => a + (b - mean) ** 2, 0) / envelope.length || 0;
  const stdDev = Math.sqrt(variance) || 1e-9;
  const threshold = mean + stdDev * ONSET_THRESHOLD_STD_DEVS;
  const minGapFrames = Math.round(MIN_ONSET_GAP_SECONDS / ENVELOPE_HOP_SECONDS);

  const peaks: RawOnset[] = [];
  let lastPeakFrame = -Infinity;

  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] < threshold) continue;
    if (envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1]) continue;
    if (i - lastPeakFrame < minGapFrames) continue;

    peaks.push({ time: i * ENVELOPE_HOP_SECONDS, lane, strength: (envelope[i] - mean) / stdDev });
    lastPeakFrame = i;
  }

  return peaks;
}

/** Groups onsets across lanes that land within the same instant, keeping only the strongest per group. */
function mergeOnsets(onsets: RawOnset[]): RawOnset[] {
  const sorted = [...onsets].sort((a, b) => a.time - b.time);
  const merged: RawOnset[] = [];
  let cluster: RawOnset[] = [];

  const flushCluster = () => {
    if (cluster.length === 0) return;
    merged.push(cluster.reduce((best, o) => (o.strength > best.strength ? o : best)));
    cluster = [];
  };

  for (const onset of sorted) {
    if (cluster.length > 0 && onset.time - cluster[0].time >= SIMULTANEOUS_WINDOW_SECONDS) {
      flushCluster();
    }
    cluster.push(onset);
  }
  flushCluster();

  return merged;
}

function thinToDifficulty(onsets: RawOnset[], minGapSeconds: number): ChartNote[] {
  const notes: ChartNote[] = [];
  let lastKeptTime = -Infinity;

  for (const onset of onsets) {
    if (onset.time - lastKeptTime < minGapSeconds) continue;
    lastKeptTime = onset.time;
    notes.push({ timeSeconds: onset.time, lane: onset.lane, sustainSeconds: 0 });
  }

  return notes;
}
