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
