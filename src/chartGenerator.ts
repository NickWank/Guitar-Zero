/**
 * Generates a playable chart directly from an uploaded song's audio, with no
 * ML transcription: a handful of frequency bands (one per lane, low pitch ->
 * low fret, same idea as the manual MIDI-authoring script) each get their own
 * energy-envelope onset/offset detector. It's driven entirely by the song's
 * own waveform and uses no randomness, so the same file always produces the
 * same chart, and different songs naturally produce different patterns.
 *
 * Onsets that land in different lanes within the same instant become a
 * chord (multiple lanes at one timestamp); an onset whose band energy stays
 * elevated afterward becomes a held/sustained note. Both are thinned more
 * aggressively at lower difficulties, mirroring the manual MIDI-authoring
 * script's per-tier `minGapSeconds`/`maxLanes` approach.
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
const SMOOTHING_WINDOW_FRAMES = 5; // ~50ms box smoothing, see `smoothEnvelope`
const ONSET_THRESHOLD_STD_DEVS = 1.2; // peak must exceed band mean + this many std devs
const MIN_ONSET_GAP_SECONDS = 0.1; // refractory period between onsets within one lane
const SIMULTANEOUS_WINDOW_SECONDS = 0.03; // onsets this close across lanes become one chord
const MAX_CHORD_LANES = 3; // caps a broadband transient (e.g. a drum hit) from lighting up every lane

const SUSTAIN_MIN_SECONDS = 0.2; // shorter decays are charted as a tap, not a hold
const SUSTAIN_DECAY_RATIO = 0.5; // a hold ends once its band's energy falls below this fraction of the peak
const MAX_SUSTAIN_SECONDS = 3; // caps one loud, slow-decaying note from swallowing the notes after it

interface DifficultyConfig {
  minGapSeconds: number;
  maxLanes: number;
}

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  Expert: { minGapSeconds: 0, maxLanes: MAX_CHORD_LANES },
  Hard: { minGapSeconds: 0.15, maxLanes: 2 },
  Medium: { minGapSeconds: 0.3, maxLanes: 1 },
  Easy: { minGapSeconds: 0.5, maxLanes: 1 },
};

interface RawOnset {
  time: number;
  lane: number;
  strength: number; // z-score within its own band, comparable across bands
  sustainSeconds: number;
}

interface ChordEvent {
  time: number;
  // Sorted strongest-first, so per-difficulty thinning can keep the most prominent lanes.
  notes: { lane: number; sustainSeconds: number }[];
}

export async function generateChart(buffer: AudioBuffer, name: string, artist: string): Promise<GeneratedChart> {
  const laneOnsets = await Promise.all(LANE_BANDS.map((band, lane) => detectLaneOnsets(buffer, band, lane)));
  const chords = clusterIntoChords(laneOnsets.flat());

  const notesByDifficulty = {} as Record<Difficulty, ChartNote[]>;
  for (const difficulty of Object.keys(DIFFICULTY_CONFIG) as Difficulty[]) {
    notesByDifficulty[difficulty] = thinToDifficulty(chords, DIFFICULTY_CONFIG[difficulty]);
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
  const envelope = smoothEnvelope(computeEnvelope(filtered.getChannelData(0), buffer.sampleRate));
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

/**
 * Box-smooths the per-hop energy. A fixed-size hop's raw RMS still tracks the
 * underlying waveform's own oscillation (most visibly in the low bands, whose
 * cycle length approaches the hop size), so without this a genuinely held
 * note's energy swings up and down every frame instead of decaying smoothly —
 * which made sustain detection see a "note off" a few ms into every note.
 */
function smoothEnvelope(raw: Float32Array): Float32Array {
  const halfWindow = Math.floor(SMOOTHING_WINDOW_FRAMES / 2);
  const smoothed = new Float32Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(raw.length - 1, i + halfWindow); j++) {
      sum += raw[j];
      count++;
    }
    smoothed[i] = sum / count;
  }

  return smoothed;
}

/**
 * Local-max peak picking with a per-band adaptive threshold and refractory
 * period, followed by a decay walk from each peak to size its hold length.
 */
function pickPeaks(envelope: Float32Array, lane: number): RawOnset[] {
  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length || 0;
  const variance = envelope.reduce((a, b) => a + (b - mean) ** 2, 0) / envelope.length || 0;
  const stdDev = Math.sqrt(variance) || 1e-9;
  const threshold = mean + stdDev * ONSET_THRESHOLD_STD_DEVS;
  const minGapFrames = Math.round(MIN_ONSET_GAP_SECONDS / ENVELOPE_HOP_SECONDS);

  const peakFrames: number[] = [];
  let lastPeakFrame = -Infinity;

  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] < threshold) continue;
    if (envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1]) continue;
    if (i - lastPeakFrame < minGapFrames) continue;

    peakFrames.push(i);
    lastPeakFrame = i;
  }

  const maxSustainFrames = Math.round(MAX_SUSTAIN_SECONDS / ENVELOPE_HOP_SECONDS);
  const sustainGapFrames = Math.round(0.05 / ENVELOPE_HOP_SECONDS); // leave a small gap before the next onset

  return peakFrames.map((frame, idx) => {
    const peakValue = envelope[frame];
    // Relative to this note's own peak, not the song-wide threshold — in a
    // dense mix the whole-song threshold sits close to most peak values, so
    // clamping decay to it meant nothing ever counted as a hold.
    const decayFloor = peakValue * SUSTAIN_DECAY_RATIO;
    const nextPeakFrame = idx + 1 < peakFrames.length ? peakFrames[idx + 1] : envelope.length;
    const maxEndFrame = Math.min(envelope.length, frame + maxSustainFrames, nextPeakFrame - sustainGapFrames);

    let endFrame = frame;
    while (endFrame < maxEndFrame && envelope[endFrame] >= decayFloor) endFrame++;

    const holdSeconds = (endFrame - frame) * ENVELOPE_HOP_SECONDS;

    return {
      time: frame * ENVELOPE_HOP_SECONDS,
      lane,
      strength: (peakValue - mean) / stdDev,
      sustainSeconds: holdSeconds >= SUSTAIN_MIN_SECONDS ? holdSeconds : 0,
    };
  });
}

/** Groups onsets across lanes that land within the same instant into chords, capped at `MAX_CHORD_LANES`. */
function clusterIntoChords(onsets: RawOnset[]): ChordEvent[] {
  const sorted = [...onsets].sort((a, b) => a.time - b.time);
  const chords: ChordEvent[] = [];
  let cluster: RawOnset[] = [];

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const notes = [...cluster]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, MAX_CHORD_LANES)
      .map(({ lane, sustainSeconds }) => ({ lane, sustainSeconds }));
    chords.push({ time: cluster[0].time, notes });
    cluster = [];
  };

  for (const onset of sorted) {
    if (cluster.length > 0 && onset.time - cluster[0].time >= SIMULTANEOUS_WINDOW_SECONDS) {
      flushCluster();
    }
    cluster.push(onset);
  }
  flushCluster();

  return chords;
}

function thinToDifficulty(chords: ChordEvent[], config: DifficultyConfig): ChartNote[] {
  const notes: ChartNote[] = [];
  let lastKeptTime = -Infinity;

  for (const chord of chords) {
    if (chord.time - lastKeptTime < config.minGapSeconds) continue;
    lastKeptTime = chord.time;

    const lanes = chord.notes.slice(0, config.maxLanes).sort((a, b) => a.lane - b.lane);
    for (const { lane, sustainSeconds } of lanes) {
      notes.push({ timeSeconds: chord.time, lane, sustainSeconds });
    }
  }

  return notes;
}
