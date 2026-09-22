import type { Chart, ChartNote } from "./chart";

export interface PlayableNote extends ChartNote {
  hit: boolean;
  missed: boolean;
  sustainHeldSeconds: number; // accumulated hold time toward this note's sustain, if any
  sustainResolved: boolean; // true once the sustain bonus has been finalized (dropped or completed)
}

const HIT_WINDOW_SECONDS = 0.15; // +/- around a note's timestamp that counts as a hit
const POINTS_PER_HIT = 100;
const SUSTAIN_POINTS_PER_SECOND = 100; // scaled by held-ratio and combo multiplier, see resolveSustain
const COMBO_PER_MULTIPLIER_STEP = 10; // every N combo, multiplier goes up by 1x
const MAX_MULTIPLIER = 4;
export const MISS_FLASH_SECONDS = 0.3; // how long a miss stays in recentMisses for the flash effect
export const HIT_FLASH_SECONDS = 0.2; // how long a hit stays in recentHits for the receptor pulse effect

export interface Miss {
  lane: number;
  time: number;
}

export interface Hit {
  lane: number;
  time: number;
}

export class Game {
  readonly notes: PlayableNote[];
  score = 0;
  combo = 0;
  recentMisses: Miss[] = [];
  recentHits: Hit[] = [];
  private lastUpdateTime: number | null = null;

  constructor(chart: Chart) {
    this.notes = chart.notes.map((note) => ({
      ...note,
      hit: false,
      missed: false,
      sustainHeldSeconds: 0,
      sustainResolved: false,
    }));
  }

  get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.combo / COMBO_PER_MULTIPLIER_STEP));
  }

  /**
   * Call once per frame with the current song time and which lanes are
   * currently held down: marks unplayed notes as missed once they scroll
   * past the hit window, and accrues/resolves sustain holds.
   */
  update(currentTime: number, heldLanes: ReadonlySet<number>): void {
    const dt = this.lastUpdateTime === null ? 0 : Math.max(0, currentTime - this.lastUpdateTime);
    this.lastUpdateTime = currentTime;

    for (const note of this.notes) {
      if (!note.hit && !note.missed && currentTime > note.timeSeconds + HIT_WINDOW_SECONDS) {
        note.missed = true;
        this.combo = 0;
        this.recentMisses.push({ lane: note.lane, time: currentTime });
      }

      if (note.hit && note.sustainSeconds > 0 && !note.sustainResolved) {
        const sustainEnd = note.timeSeconds + note.sustainSeconds;
        if (heldLanes.has(note.lane) && currentTime < sustainEnd) {
          note.sustainHeldSeconds += dt;
        } else {
          this.resolveSustain(note);
        }
      }
    }

    this.recentMisses = this.recentMisses.filter((miss) => currentTime - miss.time < MISS_FLASH_SECONDS);
    this.recentHits = this.recentHits.filter((hit) => currentTime - hit.time < HIT_FLASH_SECONDS);
  }

  /** Call on a lane keypress: finds the closest unresolved note in that lane within the hit window. */
  handleLanePress(lane: number, currentTime: number): void {
    let closest: PlayableNote | null = null;
    let closestDelta = Infinity;

    for (const note of this.notes) {
      if (note.hit || note.missed || note.lane !== lane) continue;
      const delta = Math.abs(note.timeSeconds - currentTime);
      if (delta <= HIT_WINDOW_SECONDS && delta < closestDelta) {
        closest = note;
        closestDelta = delta;
      }
    }

    if (closest) {
      closest.hit = true;
      this.combo += 1;
      this.score += POINTS_PER_HIT * this.multiplier;
      this.recentHits.push({ lane, time: currentTime });
    }
  }

  /** Locks in the sustain bonus, scaled by how much of its duration was actually held. */
  private resolveSustain(note: PlayableNote): void {
    note.sustainResolved = true;
    const heldRatio = Math.min(1, note.sustainHeldSeconds / note.sustainSeconds);
    this.score += Math.round(SUSTAIN_POINTS_PER_SECOND * note.sustainSeconds * heldRatio * this.multiplier);
  }
}
