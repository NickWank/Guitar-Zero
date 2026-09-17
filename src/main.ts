import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#highway")!;
const ctx = canvas.getContext("2d")!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

// Placeholder render: a dot bouncing across the screen, just to prove the
// loop is alive. Real note-highway rendering replaces this.
let x = 0;

function frame() {
  x = (x + 2) % canvas.width;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#4ade80";
  ctx.beginPath();
  ctx.arc(x, canvas.height / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
