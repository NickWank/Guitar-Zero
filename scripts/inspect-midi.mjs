import pkg from "@tonejs/midi";
import { readFileSync } from "node:fs";

const { Midi } = pkg;

const path = process.argv[2];
const midi = new Midi(readFileSync(path));

console.log(`Duration: ${midi.duration.toFixed(1)}s`);
console.log(`Tempo events: ${midi.header.tempos.map((t) => t.bpm.toFixed(1)).join(", ")}`);
console.log(`Time signatures: ${JSON.stringify(midi.header.timeSignatures)}`);
console.log(`Tracks: ${midi.tracks.length}\n`);

midi.tracks.forEach((track, i) => {
  console.log(
    `[${i}] name="${track.name}" instrument="${track.instrument.name}" channel=${track.channel} notes=${track.notes.length}`,
  );
});
