import type { Chart, ChartNote } from "./chart";

const LANE_COLORS = ["#22c55e", "#ef4444", "#eab308", "#3b82f6", "#f97316"]; // green,red,yellow,blue,orange
const LANE_COUNT = LANE_COLORS.length;

const LOOKAHEAD_SECONDS = 2.5; // how far ahead notes become visible
const HIT_LINE_RATIO = 0.85; // hit line as a fraction of canvas height from the top

export function drawHighway(ctx: CanvasRenderingContext2D, chart: Chart, currentTime: number): void {
  const { width, height } = ctx.canvas;
  const laneWidth = width / LANE_COUNT;
  const hitLineY = height * HIT_LINE_RATIO;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);

  drawLanes(ctx, laneWidth, height, hitLineY);
  drawNotes(ctx, chart.notes, currentTime, laneWidth, hitLineY);
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
}

function yForTime(noteTime: number, currentTime: number, hitLineY: number): number {
  const secondsUntilHit = noteTime - currentTime;
  return hitLineY - (secondsUntilHit / LOOKAHEAD_SECONDS) * hitLineY;
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: ChartNote[],
  currentTime: number,
  laneWidth: number,
  hitLineY: number,
): void {
  const noteRadius = laneWidth * 0.3;

  for (const note of notes) {
    if (note.timeSeconds < currentTime - 0.5) continue; // already passed
    if (note.timeSeconds > currentTime + LOOKAHEAD_SECONDS) break; // notes are time-sorted

    const x = note.lane * laneWidth + laneWidth / 2;
    const y = yForTime(note.timeSeconds, currentTime, hitLineY);

    if (note.sustainSeconds > 0) {
      const tailY = yForTime(note.timeSeconds + note.sustainSeconds, currentTime, hitLineY);
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
