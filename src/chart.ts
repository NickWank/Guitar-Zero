export interface ChartNote {
  timeSeconds: number;
  lane: number; // 0-4 = green,red,yellow,blue,orange
  sustainSeconds: number;
}

export interface ChartSong {
  name: string;
  artist: string;
  musicStream: string;
  resolution: number;
}

export interface Chart {
  song: ChartSong;
  notes: ChartNote[];
}

export type Difficulty = "Easy" | "Medium" | "Hard" | "Expert";

interface TempoChange {
  tick: number;
  bpm: number;
}

function parseSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  const lines = text.split(/\r?\n/);
  let current: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line === "{") continue;
    if (line === "}") {
      current = null;
      continue;
    }
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      sections.set(current, []);
      continue;
    }
    if (current) {
      sections.get(current)!.push(line);
    }
  }
  return sections;
}

function parseSongSection(lines: string[]): ChartSong {
  const values: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^"|"$/g, "");
  }
  return {
    name: values.Name ?? "Unknown",
    artist: values.Artist ?? "Unknown",
    musicStream: values.MusicStream ?? "song.mp3",
    resolution: Number(values.Resolution ?? 192),
  };
}

function parseTempoChanges(lines: string[]): TempoChange[] {
  const changes: TempoChange[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\s*=\s*B\s+(\d+)/);
    if (match) {
      changes.push({ tick: Number(match[1]), bpm: Number(match[2]) / 1000 });
    }
  }
  return changes.sort((a, b) => a.tick - b.tick);
}

/** Converts a chart tick to seconds, accounting for tempo changes along the way. */
function makeTickToSeconds(tempoChanges: TempoChange[], resolution: number) {
  if (tempoChanges.length === 0 || tempoChanges[0].tick !== 0) {
    tempoChanges = [{ tick: 0, bpm: 120 }, ...tempoChanges];
  }

  // Precompute the elapsed seconds at the start of each tempo segment.
  const segmentStartSeconds: number[] = [0];
  for (let i = 1; i < tempoChanges.length; i++) {
    const prev = tempoChanges[i - 1];
    const ticks = tempoChanges[i].tick - prev.tick;
    const seconds = (ticks / resolution) * (60 / prev.bpm);
    segmentStartSeconds.push(segmentStartSeconds[i - 1] + seconds);
  }

  return (tick: number): number => {
    let segment = 0;
    for (let i = tempoChanges.length - 1; i >= 0; i--) {
      if (tick >= tempoChanges[i].tick) {
        segment = i;
        break;
      }
    }
    const { tick: segTick, bpm } = tempoChanges[segment];
    const ticksIntoSegment = tick - segTick;
    return segmentStartSeconds[segment] + (ticksIntoSegment / resolution) * (60 / bpm);
  };
}

function parseNotes(lines: string[], tickToSeconds: (tick: number) => number): ChartNote[] {
  const notes: ChartNote[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\s*=\s*N\s+(\d+)\s+(\d+)/);
    if (!match) continue; // skip S (star power), E (events), etc.
    const [, tickStr, laneStr, sustainStr] = match;
    const lane = Number(laneStr);
    if (lane > 4) continue; // skip open notes (5/6/7) for now

    const tick = Number(tickStr);
    const sustainTicks = Number(sustainStr);
    notes.push({
      timeSeconds: tickToSeconds(tick),
      lane,
      sustainSeconds: sustainTicks > 0 ? tickToSeconds(tick + sustainTicks) - tickToSeconds(tick) : 0,
    });
  }
  return notes.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function parseChart(text: string, difficulty: Difficulty = "Expert"): Chart {
  const sections = parseSections(text);
  const song = parseSongSection(sections.get("Song") ?? []);
  const tempoChanges = parseTempoChanges(sections.get("SyncTrack") ?? []);
  const tickToSeconds = makeTickToSeconds(tempoChanges, song.resolution);
  const notes = parseNotes(sections.get(`${difficulty}Single`) ?? [], tickToSeconds);

  return { song, notes };
}
