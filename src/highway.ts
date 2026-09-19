import type { PlayableNote } from "./game";
import { LANE_KEYS } from "./input";

const LANE_COLORS = ["#22c55e", "#ef4444", "#eab308", "#3b82f6", "#f97316"]; // green,red,yellow,blue,orange
const LANE_COUNT = LANE_COLORS.length;

const HIT_LINE_RATIO = 0.85; // hit line as a fraction of canvas height from the top

export function drawHighway(
  ctx: CanvasRenderingContext2D,
  notes: PlayableNote[],
  currentTime: number,
  lookaheadSeconds: number,
): void {
  const { width, height } = ctx.canvas;
  const laneWidth = width / LANE_COUNT;
  const hitLineY = height * HIT_LINE_RATIO;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);

  drawLanes(ctx, laneWidth, height, hitLineY);
  drawNotes(ctx, notes, currentTime, laneWidth, hitLineY, lookaheadSeconds);
}

function drawLanes(ctx: CanvasRenderingContext2D, laneWidth: number, height: number, hitLineY: number): void {
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    ctx.strokeStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(lane * laneWidth, 0);
    ctx.lineTo(lane * laneWidth, height);
    ctx.stroke();
  }

  ctx.strokeStyle = "#888";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, hitLineY);
  ctx.lineTo(laneWidth * LANE_COUNT, hitLineY);
  ctx.stroke();
  ctx.lineWidth = 1;

  ctx.fillStyle = "#888";
  ctx.font = `${Math.round(laneWidth * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    ctx.fillText(LANE_KEYS[lane].toUpperCase(), lane * laneWidth + laneWidth / 2, hitLineY + laneWidth * 0.4);
  }
}

function yForTime(noteTime: number, currentTime: number, hitLineY: number, lookaheadSeconds: number): number {
  const secondsUntilHit = noteTime - currentTime;
  return hitLineY - (secondsUntilHit / lookaheadSeconds) * hitLineY;
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: PlayableNote[],
  currentTime: number,
  laneWidth: number,
  hitLineY: number,
  lookaheadSeconds: number,
): void {
  const noteRadius = laneWidth * 0.3;

  for (const note of notes) {
    if (note.hit || note.missed) continue;
    if (note.timeSeconds < currentTime - 0.5) continue; // already passed
    if (note.timeSeconds > currentTime + lookaheadSeconds) break; // notes are time-sorted

    const x = note.lane * laneWidth + laneWidth / 2;
    const y = yForTime(note.timeSeconds, currentTime, hitLineY, lookaheadSeconds);

    if (note.sustainSeconds > 0) {
      const tailY = yForTime(note.timeSeconds + note.sustainSeconds, currentTime, hitLineY, lookaheadSeconds);
      ctx.strokeStyle = LANE_COLORS[note.lane];
      ctx.lineWidth = noteRadius * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, tailY);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    ctx.fillStyle = LANE_COLORS[note.lane];
    ctx.beginPath();
    ctx.arc(x, y, noteRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
