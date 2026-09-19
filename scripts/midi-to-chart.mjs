// One-off authoring tool: converts a MIDI track into a Clone Hero-style .chart
// file. Not part of the runtime app — run manually when preparing test songs.
import pkg from "@tonejs/midi";
import { readFileSync, writeFileSync } from "node:fs";

const { Midi } = pkg;

const [midiPath, outPath, trackIndexArg, songName, artist] = process.argv.slice(2);
const trackIndex = Number(trackIndexArg);

const midi = new Midi(readFileSync(midiPath));
const track = midi.tracks[trackIndex];
if (!track) {
  throw new Error(`No track at index ${trackIndex}`);
}

const bpm = midi.header.tempos[0]?.bpm ?? 120;
const resolution = 192; // ticks per quarter note in the output chart
const ticksPerSecond = (resolution * bpm) / 60;

// Group notes that start within 50ms of each other into one "chord" event —
// a real chart represents a strummed chord as multiple frets on one tick,
// not as separate consecutive notes.
const CHORD_WINDOW = 0.05;
const sorted = [...track.notes].sort((a, b) => a.time - b.time);
const chords = [];
for (const note of sorted) {
  const last = chords[chords.length - 1];
  if (last && note.time - last.time <= CHORD_WINDOW) {
    last.notes.push(note);
  } else {
    chords.push({ time: note.time, notes: [note] });
  }
}

// Bin pitch range into 5 lanes (0=green .. 4=orange): lower pitch -> lower fret.
const pitches = track.notes.map((n) => n.midi);
const minPitch = Math.min(...pitches);
const maxPitch = Math.max(...pitches);
const pitchRange = Math.max(1, maxPitch - minPitch);

function laneFor(pitch) {
  const t = (pitch - minPitch) / pitchRange;
  return Math.min(4, Math.floor(t * 5));
}

const SUSTAIN_MIN_SECONDS = 0.2; // shorter than this is charted as a tap (length 0)

const lines = [];
for (const chord of chords) {
  const tick = Math.round(chord.time * ticksPerSecond);
  const lanes = new Set(chord.notes.map((n) => laneFor(n.midi)));
  const maxDuration = Math.max(...chord.notes.map((n) => n.duration));
  const sustainTicks =
    maxDuration >= SUSTAIN_MIN_SECONDS ? Math.round(maxDuration * ticksPerSecond) : 0;
  for (const lane of lanes) {
    lines.push(`  ${tick} = N ${lane} ${sustainTicks}`);
  }
}

const chart = `[Song]
{
  Name = "${songName}"
  Artist = "${artist}"
  Charter = "auto-generated (MIDI onset conversion)"
  Offset = 0
  Resolution = ${resolution}
  Player2 = bass
  Difficulty = 0
  PreviewStart = 0
  PreviewEnd = 0
  Genre = "rock"
  MediaType = "cd"
  MusicStream = "song.mp3"
}
[SyncTrack]
{
  0 = TS 4
  0 = B ${Math.round(bpm * 1000)}
}
[Events]
{
}
[ExpertSingle]
{
${lines.join("\n")}
}
`;

writeFileSync(outPath, chart);
console.log(`Wrote ${outPath}`);
console.log(`Track "${track.name}": ${track.notes.length} source notes -> ${chords.length} chord events -> ${lines.length} chart notes`);
console.log(`Pitch range: ${minPitch}-${maxPitch}, BPM: ${bpm}`);
