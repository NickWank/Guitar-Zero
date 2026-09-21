import type { Chart, ChartNote } from "./chart";

export interface PlayableNote extends ChartNote {
  hit: boolean;
  missed: boolean;
}

const HIT_WINDOW_SECONDS = 0.15; // +/- around a note's timestamp that counts as a hit
const POINTS_PER_HIT = 100;
const COMBO_PER_MULTIPLIER_STEP = 10; // every N combo, multiplier goes up by 1x
const MAX_MULTIPLIER = 4;
export const MISS_FLASH_SECONDS = 0.3; // how long a miss stays in recentMisses for the flash effect

export interface Miss {
  lane: number;
  time: number;
}

export class Game {
  readonly notes: PlayableNote[];
  score = 0;
  combo = 0;
  recentMisses: Miss[] = [];

  constructor(chart: Chart) {
    this.notes = chart.notes.map((note) => ({ ...note, hit: false, missed: false }));
  }

  get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.combo / COMBO_PER_MULTIPLIER_STEP));
  }

  /** Call once per frame: marks notes as missed once they've scrolled past the hit window unplayed. */
  update(currentTime: number): void {
    for (const note of this.notes) {
      if (note.hit || note.missed) continue;
      if (currentTime > note.timeSeconds + HIT_WINDOW_SECONDS) {
        note.missed = true;
        this.combo = 0;
        this.recentMisses.push({ lane: note.lane, time: currentTime });
      }
    }
    this.recentMisses = this.recentMisses.filter((miss) => currentTime - miss.time < MISS_FLASH_SECONDS);
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
    }
  }
}
