# Guitar Hero Clone

A browser-based rhythm game — upload your own songs, play with a real console guitar controller, hit the notes as they scroll down the highway.

**🎮 [Play it live](#)** ← replace with your GitHub Pages link once deployed

![gameplay screenshot](#) <!-- replace with a screenshot or GIF once you have gameplay to show -->

## What it does

- Play any song by uploading an audio file paired with a `.chart` file (the same format used by Clone Hero / Moonscraper — there's a large library of fan-made charts available for popular songs)
- 5-lane scrolling note highway rendered on HTML5 Canvas
- Play with keyboard, or plug in a real PS3/Xbox 360 guitar controller — it's picked up automatically via the browser's Gamepad API
- Hit detection, scoring, and combo multiplier

## Tech stack

- Vanilla JavaScript/TypeScript
- HTML5 Canvas for rendering
- Web Audio API for playback and timing
- Gamepad API for controller input
- Vite for bundling/dev server
- Deployed on GitHub Pages

## How it works

**Audio-synced timing.** Instead of driving the note highway off the browser's animation frame timer (which drifts over a multi-minute song), note positions are calculated from the Web Audio API's own playback clock. That's what keeps hit windows accurate all the way through a song instead of just at the start.

**Real controller support.** Most wired console guitar controllers (PS3, Xbox 360) enumerate as standard HID/XInput gamepads once plugged into a PC, so the browser's `navigator.getGamepads()` can read fret buttons, the strum bar, and the whammy bar directly — no native app or special drivers needed. Button mapping isn't standardized across controller models, so the game includes an in-app calibration screen where you press each fret to map it, rather than hardcoding button indices.

## Running it locally

```bash
git clone https://github.com/YOUR-USERNAME/guitar-hero-clone.git
cd guitar-hero-clone
npm install
npm run dev
```

Then open the local URL it prints in your browser.

## Controls

| Action | Keyboard | Guitar controller |
|---|---|---|
| Frets 1–5 | (fill in once mapped) | Fret buttons |
| Strum | (fill in once mapped) | Strum bar |
| Whammy | — | Whammy bar (during held notes) |

## Status

Built over one week as a hands-on project to learn end-to-end app development with Claude Code — from render loop, to audio sync, to real hardware input, to deployment.

- [ ] Canvas render loop + note highway
- [ ] Audio playback synced to note timing
- [ ] `.chart` file parser
- [ ] Keyboard input + scoring
- [ ] Gamepad API + controller calibration
- [ ] Song upload + local library
- [ ] Deployed to GitHub Pages
