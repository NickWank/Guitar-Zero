import "./style.css";
import { parseChart } from "./chart";
import { AudioClock } from "./audio";
import { drawHighway } from "./highway";

const SONG_DIR = "/songs/i-wanna-be-adored";

const canvas = document.querySelector<HTMLCanvasElement>("#highway")!;
const ctx = canvas.getContext("2d")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

async function main() {
  const [chartText] = await Promise.all([
    fetch(`${SONG_DIR}/notes.chart`).then((r) => r.text()),
  ]);
  const chart = parseChart(chartText);

  const audio = new AudioClock();
  await audio.load(`${SONG_DIR}/song.mp3`);

  startButton.textContent = `Play "${chart.song.name}" — ${chart.song.artist}`;
  startButton.disabled = false;

  startButton.addEventListener("click", () => {
    startButton.remove();
    audio.play();
    requestAnimationFrame(function frame() {
      drawHighway(ctx, chart, audio.currentTime);
      if (audio.isPlaying) requestAnimationFrame(frame);
    });
  });
}

main().catch((err) => {
  startButton.textContent = "Failed to load song — see console";
  console.error(err);
});
