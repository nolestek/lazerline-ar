# LazerLine AR — Hoop Mode Design

Builds on the existing app (docs/superpowers/specs/2026-10-23-lazerline-ar-design.md). Everything not mentioned here (calibration + tilt fine-tune, club modes, swing detection, trails, result line, width control, error overlay) works as it does today.

## Intent

A second drill beside the floor line: a virtual swing-plane hoop, like a physical "plane trainer" hoop (a large ring tilted at the club's lie angle, bottom at the ball). The golfer swings and tries to keep the clubhead in the hoop's plane the whole way back and through. It grooves the same on-plane feel as the line drill, but the target is visible in 3D around the golfer instead of on the floor.

## Goals

- Start page gets a **Drill** choice: **Line** (today's mode) or **Hoop**. Stored as `drill: 'line' | 'hoop'` in settings (default `'line'`, invalid values fall back to the default).
- The hoop locks to the golfer's own address: set up normally, hold still ~3 s, confirm.
- Live feedback: the hoop is green while the clubhead is in the hoop's plane (within tolerance), red when not. The club controller gives a short haptic buzz when the clubhead leaves the plane.
- Tolerance adjustable with the thumbstick, like the line width, so it can tighten as the golfer improves.

## Non-goals

- Scoring against the hoop's rim (radius). Only the plane matters; the hoop's size is visual.
- Replay (removed from the app after headset testing).
- Haptics in Line mode (not asked for; easy to add later).

## Setup flow (Hoop drill)

After calibration + tilt fine-tune (unchanged):

1. Prompt: "Take your address and pull the trigger."
2. Trigger → **hold**: prompt shows a countdown ("Hold still… 3", "2", "1"). The countdown restarts if the club moves (builder's call on thresholds; e.g. angular speed > 0.3 rad/s or clubhead drift > 3 cm from where the hold began).
3. After 3 s still, the hoop is built from the address pose (average or final pose of the hold — builder's call) and shown. Prompt: "Pull the trigger to use this hoop."
4. Trigger → **ready**. While the hoop is shown and not yet accepted, holding still again does nothing; to redo, the golfer presses A (see controls).

Buttons (outside a swing they are always live, including during hold and confirm):
- A in Hoop drill restarts hoop setup at step 1 from any hoop-setup state or from ready (it re-places the line in Line drill).
- B recalibrates from any state, as today. The hoop is fixed in the world, so afterwards the app returns to ready if a hoop was accepted (the hoop is kept), else to hoop setup step 1.
- The trigger during a hold does nothing (the countdown just continues).

## Hoop geometry (from the address pose)

At the end of the hold, with controller position `pos` and shaft unit axis `axis` (toward the clubhead, from calibration):

- `head` = virtual clubhead point (same `clubEnds` formula as today, so it uses the club length setting — set it to Driver for driver work).
- Target-line direction `T`: horizontal, perpendicular to the shaft's horizontal projection: `T = normalize(up × axis_h)` where `axis_h` is `axis` with y = 0. (If the shaft is near-vertical so `axis_h` is ~0, fall back to the camera's right vector.)
- **Plane**: through `head`, containing `axis` and `T`. Normal `n = normalize(axis × T)`. The whole address shaft lies in this plane by construction — the club starts inside the hoop's plane.
- **Hoop**: a circle in that plane whose lowest point is the address clubhead (it sits at the ball like the physical ring, never dipping through the floor): `upIn = normalize(up − n·(n·up))` (the in-plane direction closest to straight up), center `C = head + upIn · R`, radius `R`. The address shaft is a chord of the hoop, not a radius. `R` is visual only: club length + 0.6 m (≈ arm + club; builder's call).

## Scoring

Per frame in ready state:

- `d = |n · (clubhead − head₀)|` — the clubhead's distance from the hoop's plane.
- `'on'` if `d ≤ tolerance / 2`, `'off'` otherwise, `'skip'` if the pose is unsure (estimated) — same unsure rule as today.
- Tolerance = the existing `lineWidth` setting (2–30 cm, default 10 cm, thumbstick up/down, persisted). Prompt reads "Thumbstick up/down: tolerance" in Hoop drill.
- Hoop color (decided: always live, like the line in Line drill): green on, red off, grey unsure; yellow before the first scored frame. (No "hold last color" needed: every tracked frame is scored.)
- Haptics (decided: only during a swing, so waggles, walking and carrying the club never buzz): while the detector state is `swinging`, on each on → off transition pulse the club source's `gamepad.hapticActuators[0]` (e.g. `pulse(0.6, 80)`), at most once per 250 ms. Feature-detect; no haptics is not an error.
- Swing samples carry this `state`, so `summarize` (percent on plane, first phase off, tracking-lost line) works unchanged.

## Swing detection in Hoop drill

Same detector. Its `addressNear(s.head)` predicate is fed the floor hit of the clubhead laser in Line drill. In Hoop drill, samples carry `head` = the **virtual clubhead's horizontal position** `{x, z}` (never null while tracked), `butt = null`, plus `tip = {x, y, z}` (3D virtual clubhead, for the trail). The predicate accepts `head` within 0.5 m horizontally of `head₀` (widened from 0.3 m so slow takeaways start before leaving it) — a pure, tested function like `nearLine`.

## Visuals in Hoop drill

- The hoop: a thin ring (tube) of radius `R` in the plane. Thickness/opacity builder's call; it must be clearly visible but not hide the club.
- The floor line and the floor lasers/dots are hidden (the hoop is the target). The virtual stick still shows.
- Trail: the clubhead's 3D path (`tip`, head only) during and after the swing, segments colored by state (green/red/grey), replacing the floor-dot trails in this drill. Persists after the swing and clears on the next address, as today.
- Result line and prompts: same text panel.

## Constraints

- Same stack and rules as the app: static site, three.js 0.170.0 from the CDN, pure logic in Node-tested modules with no three.js/DOM, published via GitHub Pages from `build/lazerline-v1`.
- Pure, tested: hoop plane construction from (pos, axis, settings) and the plane-distance classification, and the hoop address predicate.

## Left to the builder

- Hold stillness thresholds, which pose to use, countdown look.
- Hoop radius formula, tube look, trail look.
- Haptic intensity/duration/rate limit.
- Whether Line drill's code paths are split by a `drill` check in `main.js` or a small per-drill object — keep it simple.
