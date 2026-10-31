# Monster Hunt AR

Point a phone around the house and little monsters are *in it* — walking across the
 carpet, floating near the ceiling, hiding behind the sofa cushions. Tap to throw an
 orb, watch it wobble, and add another name to the book.

Built for a 7-year-old to play on an iPhone with no app store, no account and no
downloads. Everything is generated at runtime: no 3D files, no images, no audio files.

## Play it

1. Deploy (below) and open the link on the phone.
2. Tap **Let them in!** → allow the camera, then allow **Motion & Orientation**.
3. Tap **Start hunting!** and slowly look around. The first monster appears about two
   metres in front of you, so you cannot miss it.

Best played standing and walking. With motion allowed, tilting turns the camera and
**each real step you take moves you forward** — that trick is what makes it feel like
AR rather than a video with a crosshair on it.

### No camera? It still works

If the camera is denied, or you tap **Just pretend-play**, the game switches to
**Dreamland**: the same creatures on a candy-purple floor. Same monsters, same orbs,
same book. Handy for testing at a desk.

### Adding it to the Home Screen (iPhone)

Share → **Add to Home Screen**. It then opens full-screen with its own icon, works with
the network switched off, and keeps your monsters in local storage.

---

## Deploy it

The camera and the motion sensor both require **HTTPS** (or `localhost`), so a deployed
link is the only way to play on a phone. Both hosts below are free and static.

### GitHub Pages (recommended — the build runs for you)

```bash
cd /path/to/monster-hunt-ar
git init -b main
git add -A && git commit -m "Monster Hunt AR"
gh repo create monster-hunt-ar --public --source=. --push
```

Then on the repo page: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. Push again; after a minute the site lives at
`https://<you>.github.io/monster-hunt-ar/`.

`.github/workflows/deploy.yml` does the build; `base: './'` in `vite.config.ts` means it
works at any sub-path with no configuration.

### Cloudflare Pages

Create a project from the repo, then:

| setting | value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `22` (env var `NODE_VERSION=22`) |

---

## Developing

```bash
npm install
npm run dev        # http://localhost:5173  (camera + motion work here)
npm run build      # dist/
npm run preview    # serves dist/ on all interfaces, no-store headers
npm run typecheck  # strict TypeScript, no emit
```

`scripts/phone.html` is a dev-only harness that frames the built game in a 390×844
iPhone viewport, which beats guessing at mobile layout on a desktop monitor:

```bash
npm run build && cp scripts/phone.html dist/phone.html
npm run preview -- --port 4317   # then open /phone.html
```

Browsers cap how much camera and motion data a page in an iframe may see, so the frame
page only checks layout — test motion and walking at the plain URL on a real phone.

To wipe a save while iterating, add `?fresh` to the URL (and `?nosw` skips the service
worker, which is otherwise network-first but still caches the shell).

### A real phone on the same wifi

```bash
npm run preview -- --port 4317
ipconfig getifaddr en0     # e.g. 192.168.1.86
```

`http://192.168.1.86:4317` loads on the phone, and `allowedHosts` is open so tunnel
hostnames work too. But `getUserMedia` and `DeviceOrientationEvent.requestPermission()`
are **refused on plain http**, so over the LAN you get Dreamland with drag-to-look.

To try the real camera and step detection at a desk, put the dev server behind https. The
least fuss is a tunnel that terminates TLS for you:

```bash
npm run dev -- --host          # listens on all interfaces
npx cloudflared tunnel --url http://localhost:5173   # gives you an https:// URL
```

The `trycloudflare.com` hostname is accepted because `allowedHosts: true`. Alternatively
add `@vitejs/plugin-basic-ssl` to `vite.config.ts` and visit the LAN address once,
choosing through Safari's certificate warning.

## How it works

```
src/
  main.ts            boot, screen flow, render loop, input, scoring
  ar/camera.ts       getUserMedia passthrough + graceful fallbacks
  ar/motion.ts       gyro attitude, step detection, drag-to-look fallback
  ar/room.ts         floor estimate, lighting, Dreamland backdrop
  game/build.ts      every creature assembled from primitives at runtime
  game/species.ts    the 14 monsters: stats, colours, blurb, where they hide
  game/monster.ts    per-creature behaviour: roam, shy, hop, hover, sniff
  game/world.ts      spawning, density, recycle, roar-summon
  game/capture.ts    throw arc, aim assist, beam, wobble, escape
  game/fx.ts         orb, beam, confetti, sparkles, capture ring
  game/save.ts       localStorage save, XP and ranks, orb economy, settings
  ui/ui.ts           HUD, album, detail, level-up, toasts, text-to-speech
  styles.css         all CSS, tuned for small screens with notches
public/sw.js         offline shell; code and styles are network-first
scripts/gen-icons.mjs  writes the PWA icons: a tiny PNG encoder in 200 lines of Node
                     built-ins, artwork from signed-distance functions, no image library
```

**The AR trick.** A `<video>` element sits behind a transparent WebGL canvas. The gyro
drives the camera's quaternion (device orientation → world axes, gravity-aligned so
roll does not tilt the horizon). The compass direction is re-zeroed at "Start hunting!"
so the heading on offer when you tapped is straight ahead.

**Walking without GPS.** The accelerometer is high-passed to strip gravity, then a peak
detector with a refractory period finds footfalls. Each step pushes the player forward
by a fraction of a stride. The threshold adapts by taking the median of recent peaks, so
a phone swinging on a lanyard does not count as walking. "Walking detection" in the
Grown-ups menu picks off / normal / keen.

**Rendering.** Toon-shaded merged primitives with an inverted-hull outline, a rim light
in the shader, and a blob shadow. 14 creatures are one merged geometry each, so an
iPhone 8 holds 60 fps with three or four on screen. All 3D previews (album thumbnails,
the detail stage, the reward card) are rendered by the *same* WebGL context into an
offscreen size and blitted into a 2D canvas — iOS kills a page that opens several GL
contexts.

**Sound.** WebAudio only: filtered noise for the throw, five rising pings for the
wobble, an arpeggio for a capture, a growl for the roar. Nothing is loaded, so the game
opens in the garden with the network off.

## Tuning

Two knobs matter most once a real child gets hold of it:

- `PRESENCE` in `src/game/build.ts` — all creatures are scaled by this. Real monsters
  would be 25 cm and about 30 pixels tall on a phone at 3 m, which looks like a smudge
  on the screen. It is deliberately oversized (≈0.5 m) so it reads as a creature.
- `ORB_MAX` / the trickle rates in `src/game/save.ts` — 30 orbs, refilling in 11 s while
  a monster is in view and 18 s otherwise. Long enough that she has to care where she
  throws, short enough that she is never stuck.

Capture odds scale with distance, throw accuracy, streak and rarity, and an escape is
never fatal — the monster stays for another try and the hint says so.

## Grown-ups menu

Sound, music, spoken names, roar-to-summon, how crowded the room is, walking sensitivity,
turn speed, throwing help, re-centre the heading, and **Start a new adventure** (wipes the
save). It is honest about the fact that the camera and microphone stay on during play.
