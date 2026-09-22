import "./style.css";
import { parseChart, type Chart, type Difficulty } from "./chart";
import { AudioClock } from "./audio";
import { drawHighway } from "./highway";
import { Game } from "./game";
import { bindHeldLanes, bindKeyboard, bindSyncOffsetControls } from "./input";
import { generateChart } from "./chartGenerator";
import { addLibrarySong, deleteLibrarySong, getLibrarySong, listLibrarySongs, type LibrarySongMeta } from "./library";

const BUILTIN_SONG_DIR = "/songs/i-wanna-be-adored";

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
const songListEl = document.querySelector<HTMLDivElement>("#song-list")!;
const uploadSection = document.querySelector<HTMLDivElement>("#upload-section")!;
const uploadInput = document.querySelector<HTMLInputElement>("#upload-input")!;
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

/** A song the menu can list and play, whether it's the bundled demo or a library upload. */
interface PlayableSong {
  name: string;
  artist: string;
  loadAudio: () => Promise<AudioClock>;
  loadChart: (difficulty: Difficulty) => Promise<Chart>;
}

async function loadBuiltinSong(): Promise<PlayableSong> {
  const chartText = await fetch(`${BUILTIN_SONG_DIR}/notes.chart`).then((r) => r.text());
  const preview = parseChart(chartText, "Expert");

  return {
    name: preview.song.name,
    artist: preview.song.artist,
    loadAudio: async () => {
      const audio = new AudioClock();
      await audio.load(`${BUILTIN_SONG_DIR}/song.mp3`);
      return audio;
    },
    loadChart: async (difficulty) => parseChart(chartText, difficulty),
  };
}

function librarySongToPlayable(meta: LibrarySongMeta): PlayableSong {
  return {
    name: meta.name,
    artist: meta.artist,
    loadAudio: async () => {
      const record = await getLibrarySong(meta.id);
      const audio = new AudioClock();
      await audio.loadFromBlob(record.mp3);
      return audio;
    },
    loadChart: async (difficulty) => {
      const record = await getLibrarySong(meta.id);
      return { song: record.song, notes: record.notesByDifficulty[difficulty] };
    },
  };
}

async function renderSongList(): Promise<void> {
  songListEl.innerHTML = "";
  songListEl.appendChild(makeSongRow(await loadBuiltinSong()));

  const libraryMeta = await listLibrarySongs();
  libraryMeta.sort((a, b) => b.addedAt - a.addedAt);
  for (const meta of libraryMeta) {
    songListEl.appendChild(makeSongRow(librarySongToPlayable(meta), meta.id));
  }
}

function makeSongRow(song: PlayableSong, libraryId?: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "song-row";

  const play = document.createElement("button");
  play.className = "song-row-play";
  play.textContent = `${song.name} — ${song.artist}`;
  play.addEventListener("click", () => showDifficultyPicker(song));
  row.appendChild(play);

  if (libraryId) {
    const remove = document.createElement("button");
    remove.className = "song-row-remove";
    remove.textContent = "×";
    remove.title = "Remove from library";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteLibrarySong(libraryId);
      await renderSongList();
    });
    row.appendChild(remove);
  }

  return row;
}

function showDifficultyPicker(song: PlayableSong): void {
  menuStatus.textContent = `${song.name} — ${song.artist}\nChoose a difficulty:`;
  songListEl.hidden = true;
  uploadSection.hidden = true;
  difficultyPicker.innerHTML = "";
  difficultyPicker.hidden = false;

  (["Easy", "Medium", "Hard", "Expert"] as const).forEach((difficulty) => {
    const button = document.createElement("button");
    button.textContent = difficulty;
    button.addEventListener("click", () => startGame(difficulty, song));
    difficultyPicker.appendChild(button);
  });

  const back = document.createElement("button");
  back.textContent = "‹ Back";
  back.addEventListener("click", async () => {
    difficultyPicker.hidden = true;
    songListEl.hidden = false;
    uploadSection.hidden = false;
    menuStatus.textContent = "Choose a song:";
    await renderSongList();
  });
  difficultyPicker.appendChild(back);
}

uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files?.[0];
  uploadInput.value = ""; // reset so re-selecting the same file re-fires change
  if (!file) return;

  menuStatus.textContent = `Analyzing ${file.name}…`;
  songListEl.hidden = true;

  try {
    const decodeCtx = new AudioContext();
    const buffer = await decodeCtx.decodeAudioData(await file.arrayBuffer());
    await decodeCtx.close();

    const name = file.name.replace(/\.[^/.]+$/, "");
    const generated = await generateChart(buffer, name, "Unknown");
    await addLibrarySong(name, "Unknown", file, generated.song, generated.notesByDifficulty);

    menuStatus.textContent = "Choose a song:";
  } catch (err) {
    menuStatus.textContent = "Failed to analyze that file — see console";
    console.error(err);
  } finally {
    songListEl.hidden = false;
    await renderSongList();
  }
});

async function startGame(difficulty: Difficulty, song: PlayableSong): Promise<void> {
  menuStatus.textContent = "Loading…";
  const [audio, chart] = await Promise.all([song.loadAudio(), song.loadChart(difficulty)]);

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
  const { held: heldLanes } = bindHeldLanes();

  audio.play(lookaheadSeconds + COUNT_IN_BUFFER_SECONDS);
  requestAnimationFrame(function frame() {
    const t = audio.currentTime + syncOffset;

    if (t < 0) {
      countdownEl.textContent = Math.ceil(-t).toString();
    } else if (!countdownEl.hidden) {
      countdownEl.hidden = true;
    }

    game.update(t, heldLanes);
    drawHighway(ctx, game.notes, t, lookaheadSeconds, game.recentMisses, game.recentHits);
    scoreEl.textContent = String(game.score);
    comboEl.textContent = game.combo > 1 ? `${game.combo}x combo (${game.multiplier}x)` : "";
    if (audio.isPlaying) requestAnimationFrame(frame);
  });
}

async function main() {
  menuStatus.textContent = "Choose a song:";
  await renderSongList();
}

main().catch((err) => {
  menuStatus.textContent = "Failed to load songs — see console";
  console.error(err);
});
