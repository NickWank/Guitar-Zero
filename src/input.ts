export const LANE_KEYS = ["a", "s", "d", "f", "g"];

const SYNC_OFFSET_STEP_SECONDS = 0.02;

/** Binds keyboard lane presses; returns a cleanup function. */
export function bindKeyboard(onLanePress: (lane: number) => void): () => void {
  const handler = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const lane = LANE_KEYS.indexOf(event.key.toLowerCase());
    if (lane !== -1) onLanePress(lane);
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

/**
 * Tracks which lanes are currently held down (as opposed to `bindKeyboard`'s
 * one-shot press events) — needed to know whether a sustain is still being
 * held through its duration. Returns a live Set the caller reads each frame,
 * plus a cleanup function.
 */
export function bindHeldLanes(): { held: ReadonlySet<number>; dispose: () => void } {
  const held = new Set<number>();

  const down = (event: KeyboardEvent) => {
    const lane = LANE_KEYS.indexOf(event.key.toLowerCase());
    if (lane !== -1) held.add(lane);
  };
  const up = (event: KeyboardEvent) => {
    const lane = LANE_KEYS.indexOf(event.key.toLowerCase());
    if (lane !== -1) held.delete(lane);
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return {
    held,
    dispose: () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    },
  };
}

/**
 * Binds `[` / `]` to nudge the audio/note sync offset earlier or later —
 * a manual escape hatch since an auto-generated chart from a different
 * recording (e.g. a cover) can't be assumed to line up perfectly.
 */
export function bindSyncOffsetControls(onAdjust: (deltaSeconds: number) => void): () => void {
  const handler = (event: KeyboardEvent) => {
    if (event.key === "[") onAdjust(-SYNC_OFFSET_STEP_SECONDS);
    if (event.key === "]") onAdjust(SYNC_OFFSET_STEP_SECONDS);
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
