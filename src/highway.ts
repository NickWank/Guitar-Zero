import type { Hit, Miss, PlayableNote } from "./game";
import { HIT_FLASH_SECONDS, MISS_FLASH_SECONDS } from "./game";
import { LANE_KEYS } from "./input";

const LANE_COLORS = ["#22c55e", "#ef4444", "#eab308", "#3b82f6", "#f97316"]; // green,red,yellow,blue,orange
const LANE_COUNT = LANE_COLORS.length;

const HIT_LINE_RATIO = 0.85; // hit line as a fraction of canvas height from the top
const TOP_WIDTH_RATIO = 0.35; // highway width at the vanishing point, as a fraction of its width at the hit line
const BOTTOM_WIDTH_RATIO = 0.75; // highway width at the hit line, as a fraction of canvas width
const PERSPECTIVE_EASE = 1.4; // >1 = width grows slower at first then faster near the hit line

const RUNG_INTERVAL_SECONDS = 0.25; // spacing between scrolling "treadmill" cross-lines

export function drawHighway(
  ctx: CanvasRenderingContext2D,
  notes: PlayableNote[],
  currentTime: number,
  lookaheadSeconds: number,
  recentMisses: Miss[] = [],
  recentHits: Hit[] = [],
): void {
  const { width, height } = ctx.canvas;
  const hitLineY = height * HIT_LINE_RATIO;
  const perspective = makePerspective(width, hitLineY);

  drawBackground(ctx, width, height);
  drawTreadmillRungs(ctx, perspective, currentTime, hitLineY, lookaheadSeconds);
  drawLaneDividers(ctx, perspective, hitLineY);
  drawNotes(ctx, notes, currentTime, perspective, hitLineY, lookaheadSeconds);
  drawReceptors(ctx, perspective, hitLineY, currentTime, recentHits);
  drawMissFlashes(ctx, recentMisses, currentTime, perspective, hitLineY);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0b0b16");
  gradient.addColorStop(1, "#1c1c30");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
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

/** Scrolling cross-lines that give the highway a sense of continuous forward motion, like a treadmill. */
function drawTreadmillRungs(
  ctx: CanvasRenderingContext2D,
  perspective: Perspective,
  currentTime: number,
  hitLineY: number,
  lookaheadSeconds: number,
): void {
  const firstRung = Math.ceil(currentTime / RUNG_INTERVAL_SECONDS) * RUNG_INTERVAL_SECONDS;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  for (let t = firstRung; t <= currentTime + lookaheadSeconds; t += RUNG_INTERVAL_SECONDS) {
    const y = yForTime(t, currentTime, hitLineY, lookaheadSeconds);
    if (y < 0 || y > hitLineY) continue;

    ctx.beginPath();
    ctx.moveTo(perspective.laneLeftX(y, 0), y);
    ctx.lineTo(perspective.laneLeftX(y, LANE_COUNT), y);
    ctx.stroke();
  }
}

function drawLaneDividers(ctx: CanvasRenderingContext2D, perspective: Perspective, hitLineY: number): void {
  for (let lane = 0; lane <= LANE_COUNT; lane++) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.beginPath();
    ctx.moveTo(perspective.laneLeftX(0, lane), 0);
    ctx.lineTo(perspective.laneLeftX(hitLineY, lane), hitLineY);
    ctx.stroke();
  }
}

function yForTime(noteTime: number, currentTime: number, hitLineY: number, lookaheadSeconds: number): number {
  const secondsUntilHit = noteTime - currentTime;
  return hitLineY - (secondsUntilHit / lookaheadSeconds) * hitLineY;
}

const SUSTAIN_BAR_WIDTH_RATIO = 0.4; // sustain bar width as a fraction of the lane's width

function drawNotes(
  ctx: CanvasRenderingContext2D,
  notes: PlayableNote[],
  currentTime: number,
  perspective: Perspective,
  hitLineY: number,
  lookaheadSeconds: number,
): void {
  for (const note of notes) {
    if (note.missed) continue;

    if (note.hit) {
      // The note head is already consumed; while its sustain is still being
      // held, keep drawing the shrinking tail so the player can see how much
      // hold is left.
      if (note.sustainSeconds > 0 && !note.sustainResolved) {
        const tailY = Math.max(
          0,
          yForTime(note.timeSeconds + note.sustainSeconds, currentTime, hitLineY, lookaheadSeconds),
        );
        drawSustainBar(ctx, perspective, note.lane, hitLineY, tailY, LANE_COLORS[note.lane], 0.85);
      }
      continue;
    }

    if (note.timeSeconds < currentTime - 0.5) continue; // already passed
    if (note.timeSeconds > currentTime + lookaheadSeconds) break; // notes are time-sorted

    const y = Math.max(0, yForTime(note.timeSeconds, currentTime, hitLineY, lookaheadSeconds));
    const laneWidth = perspective.laneWidth(y);
    const x = perspective.laneLeftX(y, note.lane) + laneWidth / 2;
    const radius = laneWidth * 0.3;

    if (note.sustainSeconds > 0) {
      const tailY = Math.max(0, yForTime(note.timeSeconds + note.sustainSeconds, currentTime, hitLineY, lookaheadSeconds));
      drawSustainBar(ctx, perspective, note.lane, y, tailY, LANE_COLORS[note.lane], 0.55);
    }

    ctx.fillStyle = LANE_COLORS[note.lane];
    ctx.shadowColor = LANE_COLORS[note.lane];
    ctx.shadowBlur = radius * 1.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/** Draws a tapered, perspective-correct bar down a lane from `headY` (near) to `tailY` (far). */
function drawSustainBar(
  ctx: CanvasRenderingContext2D,
  perspective: Perspective,
  lane: number,
  headY: number,
  tailY: number,
  color: string,
  alpha: number,
): void {
  const headCenterX = perspective.laneLeftX(headY, lane) + perspective.laneWidth(headY) / 2;
  const tailCenterX = perspective.laneLeftX(tailY, lane) + perspective.laneWidth(tailY) / 2;
  const headHalfWidth = (perspective.laneWidth(headY) * SUSTAIN_BAR_WIDTH_RATIO) / 2;
  const tailHalfWidth = (perspective.laneWidth(tailY) * SUSTAIN_BAR_WIDTH_RATIO) / 2;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(headCenterX - headHalfWidth, headY);
  ctx.lineTo(headCenterX + headHalfWidth, headY);
  ctx.lineTo(tailCenterX + tailHalfWidth, tailY);
  ctx.lineTo(tailCenterX - tailHalfWidth, tailY);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The "hoop" targets at the hit line — a clear catch zone per lane, pulsing when a note's just been hit. */
function drawReceptors(
  ctx: CanvasRenderingContext2D,
  perspective: Perspective,
  hitLineY: number,
  currentTime: number,
  recentHits: Hit[],
): void {
  const laneWidth = perspective.laneWidth(hitLineY);
  const baseRadius = laneWidth * 0.35;
  const recentHitByLane = new Map(recentHits.map((hit) => [hit.lane, hit.time]));

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const x = perspective.laneLeftX(hitLineY, lane) + laneWidth / 2;
    const hitTime = recentHitByLane.get(lane);
    const age = hitTime !== undefined ? currentTime - hitTime : Infinity;
    const isPulsing = age >= 0 && age < HIT_FLASH_SECONDS;
    const pulseT = isPulsing ? age / HIT_FLASH_SECONDS : 1;
    const radius = isPulsing ? baseRadius * (1 + 0.4 * (1 - pulseT)) : baseRadius;

    ctx.fillStyle = LANE_COLORS[lane];
    ctx.globalAlpha = isPulsing ? 0.35 * (1 - pulseT) + 0.12 : 0.12;
    ctx.beginPath();
    ctx.arc(x, hitLineY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = LANE_COLORS[lane];
    ctx.lineWidth = isPulsing ? 4 : 3;
    ctx.shadowColor = LANE_COLORS[lane];
    ctx.shadowBlur = isPulsing ? 16 : 6;
    ctx.beginPath();
    ctx.arc(x, hitLineY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;

    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = `${Math.round(laneWidth * 0.28)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(LANE_KEYS[lane].toUpperCase(), x, hitLineY);
  }
  ctx.textBaseline = "alphabetic";
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
