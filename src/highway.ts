import type { Miss, PlayableNote } from "./game";
import { MISS_FLASH_SECONDS } from "./game";
import { LANE_KEYS } from "./input";

const LANE_COLORS = ["#22c55e", "#ef4444", "#eab308", "#3b82f6", "#f97316"]; // green,red,yellow,blue,orange
const LANE_COUNT = LANE_COLORS.length;

const HIT_LINE_RATIO = 0.85; // hit line as a fraction of canvas height from the top
const TOP_WIDTH_RATIO = 0.12; // highway width at the vanishing point, as a fraction of its width at the hit line
const BOTTOM_WIDTH_RATIO = 0.75; // highway width at the hit line, as a fraction of canvas width
const PERSPECTIVE_EASE = 2; // >1 = width grows slowly at first then rushes wider near the hit line

export function drawHighway(
  ctx: CanvasRenderingContext2D,
  notes: PlayableNote[],
  currentTime: number,
  lookaheadSeconds: number,
  recentMisses: Miss[] = [],
): void {
  const { width, height } = ctx.canvas;
  const hitLineY = height * HIT_LINE_RATIO;
  const perspective = makePerspective(width, hitLineY);

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);

  drawLanes(ctx, perspective, hitLineY);
  drawNotes(ctx, notes, currentTime, perspective, hitLineY, lookaheadSeconds);
  drawMissFlashes(ctx, recentMisses, currentTime, perspective, hitLineY);
}

interface Perspective {
  /** x of the left edge of `lane` at vertical position `y` (0 = top/far, hitLineY = near). */
  laneLeftX(y: number, lane: number): number;
  laneWidth(y: number): number;
}

function makePerspective(canvasWidth: number, hitLineY: number): Perspective {
  const centerX = canvasWidth / 2;
  const bottomWidth = canvasWidth * BOTTOM_WIDTH_RATIO;
  const topWidth = bottomWidth * TOP_WIDTH_RATIO;

  function totalWidth(y: number): number {
    const t = Math.min(1, Math.max(0, y / hitLineY));
    return topWidth + (bottomWidth - topWidth) * t ** PERSPECTIVE_EASE;
  }

  return {
    laneWidth: (y) => totalWidth(y) / LANE_COUNT,
    laneLeftX: (y, lane) => centerX - totalWidth(y) / 2 + lane * (totalWidth(y) / LANE_COUNT),
  };
}

function drawLanes(ctx: CanvasRenderingContext2D, perspective: Perspective, hitLineY: number): void {
  for (let lane = 0; lane <= LANE_COUNT; lane++) {
    ctx.strokeStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(perspective.laneLeftX(0, lane), 0);
    ctx.lineTo(perspective.laneLeftX(hitLineY, lane), hitLineY);
    ctx.stroke();
  }

  ctx.strokeStyle = "#888";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(perspective.laneLeftX(hitLineY, 0), hitLineY);
  ctx.lineTo(perspective.laneLeftX(hitLineY, LANE_COUNT), hitLineY);
  ctx.stroke();
  ctx.lineWidth = 1;

  const laneWidthAtHit = perspective.laneWidth(hitLineY);
  ctx.fillStyle = "#888";
  ctx.font = `${Math.round(laneWidthAtHit * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const x = perspective.laneLeftX(hitLineY, lane) + laneWidthAtHit / 2;
    ctx.fillText(LANE_KEYS[lane].toUpperCase(), x, hitLineY + laneWidthAtHit * 0.4);
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
  perspective: Perspective,
  hitLineY: number,
  lookaheadSeconds: number,
): void {
  for (const note of notes) {
    if (note.hit || note.missed) continue;
    if (note.timeSeconds < currentTime - 0.5) continue; // already passed
    if (note.timeSeconds > currentTime + lookaheadSeconds) break; // notes are time-sorted

    const y = Math.max(0, yForTime(note.timeSeconds, currentTime, hitLineY, lookaheadSeconds));
    const laneWidth = perspective.laneWidth(y);
    const x = perspective.laneLeftX(y, note.lane) + laneWidth / 2;
    const radius = laneWidth * 0.3;

    if (note.sustainSeconds > 0) {
      const tailY = Math.max(0, yForTime(note.timeSeconds + note.sustainSeconds, currentTime, hitLineY, lookaheadSeconds));
      const tailLaneWidth = perspective.laneWidth(tailY);
      const tailX = perspective.laneLeftX(tailY, note.lane) + tailLaneWidth / 2;
      ctx.strokeStyle = LANE_COLORS[note.lane];
      ctx.lineWidth = radius * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    ctx.fillStyle = LANE_COLORS[note.lane];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMissFlashes(
  ctx: CanvasRenderingContext2D,
  recentMisses: Miss[],
  currentTime: number,
  perspective: Perspective,
  hitLineY: number,
): void {
  const laneWidth = perspective.laneWidth(hitLineY);

  for (const miss of recentMisses) {
    const age = currentTime - miss.time;
    if (age < 0 || age > MISS_FLASH_SECONDS) continue;

    const opacity = 1 - age / MISS_FLASH_SECONDS;
    const x = perspective.laneLeftX(hitLineY, miss.lane);

    ctx.fillStyle = `rgba(239, 68, 68, ${opacity * 0.5})`;
    ctx.fillRect(x, hitLineY - laneWidth * 0.6, laneWidth, laneWidth * 0.6);

    ctx.fillStyle = `rgba(239, 68, 68, ${opacity})`;
    ctx.font = `bold ${Math.round(laneWidth * 0.35)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("MISS", x + laneWidth / 2, hitLineY - laneWidth * 0.7);
  }
}
