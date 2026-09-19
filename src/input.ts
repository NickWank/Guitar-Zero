export const LANE_KEYS = ["a", "s", "d", "f", "g"];

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
