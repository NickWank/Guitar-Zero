import "./style.css";
import { parseChart, type Difficulty } from "./chart";
import { AudioClock } from "./audio";
import { drawHighway } from "./highway";
import { Game } from "./game";
import { bindKeyboard, bindSyncOffsetControls } from "./input";

const SONG_DIR = "/songs/i-wanna-be-adored";

// Larger lookahead = notes travel further before reaching the hit line =
// more reaction time = feels slower, even though the underlying chart data
// (note count/chord size) is what the authoring script already thinned.
const LOOKAHEAD_SECONDS: Record<Difficulty, number> = {
  Easy: 4,
  Medium: 3,
  Hard: 2.5,
  Expert: 2,
};

// Extra silence before the song's audio actually starts, so the first notes
// have time to scroll into view instead of already being on top of you.
const COUNT_IN_BUFFER_SECONDS = 1.5;

const canvas = document.querySelector<HTMLCanvasElement>("#highway")!;
const ctx = canvas.getContext("2d")!;
const menu = document.querySelector<HTMLDivElement>("#menu")!;
const menuStatus = document.querySelector<HTMLParagraphElement>("#menu-status")!;
const difficultyPicker = document.querySelector<HTMLDivElement>("#difficulty-picker")!;
const hud = document.querySelector<HTMLDivElement>("#hud")!;
const scoreEl = document.querySelector<HTMLSpanElement>("#score")!;
const comboEl = document.querySelector<HTMLSpanElement>("#combo")!;
const syncOffsetEl = document.querySelector<HTMLSpanElement>("#sync-offset")!;
const countdownEl = document.querySelector<HTMLDivElement>("#countdown")!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

async function main() {
  const chartText = await fetch(`${SONG_DIR}/notes.chart`).then((r) => r.text());

  const audio = new AudioClock();
  await audio.load(`${SONG_DIR}/song.mp3`);

  const previewChart = parseChart(chartText, "Expert");
  menuStatus.textContent = `${previewChart.song.name} — ${previewChart.song.artist}\nChoose a difficulty:`;

  (["Easy", "Medium", "Hard", "Expert"] as const).forEach((difficulty) => {
    const button = document.createElement("button");
    button.textContent = difficulty;
    button.addEventListener("click", () => startGame(difficulty, chartText, audio));
    difficultyPicker.appendChild(button);
  });
}

function startGame(difficulty: Difficulty, chartText: string, audio: AudioClock): void {
  const chart = parseChart(chartText, difficulty);
  const game = new Game(chart);
  const lookaheadSeconds = LOOKAHEAD_SECONDS[difficulty];
  let syncOffset = 0;

  menu.remove();
  hud.hidden = false;
  countdownEl.hidden = false;

  bindKeyboard((lane) => {
    if (audio.currentTime + syncOffset >= 0) game.handleLanePress(lane, audio.currentTime + syncOffset);
  });
  bindSyncOffsetControls((delta) => {
    syncOffset += delta;
    syncOffsetEl.textContent = `offset ${syncOffset >= 0 ? "+" : ""}${syncOffset.toFixed(2)}s`;
  });

  audio.play(lookaheadSeconds + COUNT_IN_BUFFER_SECONDS);
  requestAnimationFrame(function frame() {
    const t = audio.currentTime + syncOffset;

    if (t < 0) {
      countdownEl.textContent = Math.ceil(-t).toString();
    } else if (!countdownEl.hidden) {
      countdownEl.hidden = true;
    }

    game.update(t);
    drawHighway(ctx, game.notes, t, lookaheadSeconds, game.recentMisses);
    scoreEl.textContent = String(game.score);
    comboEl.textContent = game.combo > 1 ? `${game.combo}x combo (${game.multiplier}x)` : "";
    if (audio.isPlaying) requestAnimationFrame(frame);
  });
}

main().catch((err) => {
  menuStatus.textContent = "Failed to load song — see console";
  console.error(err);
});
