# LazerLine AR — Design

## Intent

A web-based AR golf training aid for Meta Quest 3. The golfer swings a real (VR) club with a Quest controller mounted on it, or the bare controller. Lasers shoot out of both ends of the virtual shaft and land on the real floor as dots. The goal is to keep those dots on a line painted on the floor through the whole swing — the classic "laser on the plane line" drill — so the golfer grooves the feel of swinging on plane.

Success: put on the headset, open a web page, calibrate in seconds, place the line, swing, and immediately see whether you stayed on plane and where you came off.

## Goals

- Passthrough AR (the real room is visible) in the Quest 3 browser. No app store install.
- A line on the floor that the golfer places and rotates, then squares up to.
- Adjustable line width: wide and forgiving for beginners, narrow and strict as they improve. The "on the line" tolerance is the line width.
- A virtual shaft attached to the controller, calibrated so it lines up with the real club.
- Two lasers along the shaft axis: one out the clubhead end, one out the grip (butt) end. A dot appears on the floor wherever an end points at the floor.
- Live feedback: the line glows green while the active dot is on it, red when off.
- Traced paths of both dots on the floor during the swing.
- After each swing: the colored trails stay on the floor with a result summary showing where the swing came off plane. (A slow-motion ghost replay was built, then removed after headset testing: the live line is the drill.)

## Non-goals (for now)

- Swing history, stats across sessions, accounts, cloud anything.
- Ball flight, club speed, impact detection.
- A realistic clubhead model (a plain stick is fine to start).
- Support for headsets other than Quest 3 (others may work by accident).

## Anti-goals

- Requiring button presses during the swing. Hands are on the grip; the swing must be detected automatically.
- Laggy or jittery dots. If the dots don't feel locked to the club, the drill is worthless.
- A fiddly setup. Calibrate + place line should take under ~15 seconds.

## Constraints

- Runs as a WebXR `immersive-ar` session in the Meta Quest Browser.
- Must be served over HTTPS (WebXR requires a secure context). For development, local serve + port forwarding to the headset or any static HTTPS host is fine.
- Uses the `local-floor` reference space; the floor is the plane y = 0.
- Static site, no backend.

## How it works

### Modes and calibration

The golfer picks **Club adapter** or **Controller only** on the start page (2D, before entering AR).

The controller on the user's VR club sits in an angled holder at the end of the club, so the shaft direction is not any fixed controller axis. Calibration solves this:

1. Prompt: "Point the club straight down at the floor and pull the trigger."
2. On trigger, record the shaft axis in controller-local space: `axisLocal = inverse(controllerRotation) · (0, -1, 0)`. This direction is "toward the clubhead". The opposite direction is "toward the butt".
3. The shaft line from then on is the line through the controller position along `controllerRotation · axisLocal`.

Twist around the shaft does not matter, since the lasers only use the axis direction.

Known limit (decided, revisit after testing): calibration captures direction only, not position. The angled holder puts the controller a few cm off the real shaft axis, so the dots may sit a few cm off from where the real shaft points. Fine at wide line widths. If it matters at narrow widths, add a second calibration step later (e.g. touch the clubhead end to the floor). Calibration runs on every session start and can be redone from a button.

Fine-tune (added after first headset test): nobody holds the club perfectly vertical, so the virtual stick can come out tilted relative to the real grip. Right after the trigger, the golfer nudges the stick's tilt with the thumbstick (in their own view: right/left and toward/away) until it lines up with the real grip in passthrough, then pulls the trigger again.

Mode differences (both use the same calibration and the same infinite laser line, so scoring is identical; only where the stick is drawn differs):
- **Club adapter:** the user's VR club is a grip with the controller holder just below it, roughly halfway down where a normal shaft would be. The virtual stick extends *both ways* from the controller: up the shaft to the butt end of the grip (a short, adjustable "grip length", default ~0.4 m, builder's call), and down to where the clubhead would be (club length minus grip length). The butt-end laser starts at the top of the grip and the clubhead laser at the virtual clubhead.
- **Controller only:** the hand holds the controller, so the controller is the grip. The butt end sits at the controller, and the virtual stick extends a full club length toward the clubhead.
- In both modes there is a club-length setting (e.g. short iron to driver) that only changes how the stick looks. The lasers are infinite rays along the shaft line, so length doesn't affect the on-plane check.

### Lasers and dots

Every frame:
- Cast a ray from the controller along +axis (clubhead end) and another along −axis (butt end).
- If a ray points downward, intersect it with the floor plane y = 0. That's the dot.
- A ray pointing upward or nearly horizontal has no dot. Builder's call: cap the dot distance (e.g. ignore hits more than a few meters away) so a near-horizontal shaft doesn't throw a dot across the room.
- Draw each laser as a thin red beam from the club end to the dot, and the dot as a small red disc half the line's width, so it visibly sits inside the line.

Through a normal swing this naturally gives: the clubhead dot during takeaway, then the butt-end dot once the grip end points down (late backswing / top / early downswing), then the clubhead dot again through impact and follow-through.

### The line

- Placement: aim the club at the floor and pull the trigger. The line's center snaps to the clubhead dot. Thumbstick left/right rotates the line around that point. Trigger again locks it.
- The line is a flat strip on the floor, 5 m long (lengthened from 3 m after headset testing so the dot stays over it more of the swing), 10 cm wide by default, yellow when idle.
- Width: thumbstick up/down (or A/B) steps the width up and down, with a visible readout. Remember the last width (and mode, club length) in localStorage.
- "On the line" = the dot's perpendicular distance from the line's center line (measured in the floor plane) is ≤ half the width. Dots past the ends of the line are not scored (the line isn't long enough to judge there); dots beside the line count as off.
- Live color: green while the active dot is on, red while off. During moments nothing is scored (no dot, or dots past the line's ends) the line keeps its last green/red instead of flashing yellow.
- Re-place the line anytime from a button.

### Swing detection

Automatic, no buttons:
- **Address:** the club is roughly still and pointing down near the line for a short moment.
- **Swing start:** the club turns faster than 1 rad/s, or turns more than ~9° (0.15 rad) away from its address direction at any speed — so slow-motion practice swings start too.
- **Waggles and lifts:** a start that settles back at address is dropped (stay at address); one that sits still 3 s without passing impact is abandoned. Neither produces a result.
- **Swing end:** the club settles after the follow-through.
- Builder tunes the thresholds (speed, stillness duration) on real hardware.

During the swing, record a sample every frame: timestamp, controller pose, both dot positions (or none), on/off for each dot, and whether the pose was tracked or estimated.

### Swing speed and tracking quality

The golfer starts with slow practice swings and moves to full-speed swings as they improve. Both must work, with slow swings being the first target.

At full speed, especially at the top of the backswing, the controller can leave the headset cameras' view. The Quest then estimates its pose from inertial sensors, which drifts. WebXR flags these poses (`emulatedPosition` on the grip/target-ray pose).

- Samples with an estimated pose are marked **unsure**. They are not counted as on or off plane, and they are drawn in a neutral color (e.g. grey) on the trails.
- The result line never blames a phase for coming off plane based on unsure samples. If a large share of the swing is unsure, say so, e.g. "Tracking lost at the top — try a slower swing or face the line more."
- Samples where a dot is missing (shaft near horizontal) don't count toward the percentage either.
- Builder's call: light smoothing of the dots is fine if it doesn't add visible lag.

Split the swing into phases for reporting: takeaway, backswing, top, downswing, follow-through. Builder's call on how, e.g. from the shaft angle and the direction of motion. "Top" is where the backswing reverses.

### After the swing

- **Trails stay on the floor**, made of segments colored green (on) and red (off).
- **Result line**, floating in front of the golfer: percent of samples on plane and the first phase where it went off, e.g. "92% on plane — came off at the top of the backswing". If 100%: "Great job!"
- Address for the next swing clears the trails and result.

Only the last swing is kept.

### Controls (summary, builder may adjust)

| Input | Action |
|---|---|
| Trigger | Calibrate / place line / lock line |
| Thumbstick L/R | Rotate line (while placing) |
| Thumbstick U/D or A/B | Line width up/down |
| Menu/one button | Re-calibrate or re-place line |

Use whichever controller pulls the trigger first as the club.

## Tech (builder's call, stated defaults)

- Plain HTML + JavaScript with three.js (loaded from a CDN or vendored), using its built-in WebXR support and `ARButton`. No build step unless it earns its keep.
- Test on device; the Immersive Web Emulator browser extension is fine for quick desktop checks.

## Left to the builder

- Exact visuals: colors, dot size, beam thickness, text rendering in XR.
- Swing detection thresholds and phase segmentation method.
- Dot distance cap, default line length, width steps and limits.
- File layout, how to serve over HTTPS during development.
