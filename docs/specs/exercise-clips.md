# Exercise clips

## What it does

Each catalogue exercise has a short looping clip that shows how to do it.
The set card shows the clip above the cues.
Each warm-up row shows a small looping thumbnail.
A tap on an exercise name on the session, warm-up, rest or training screen opens an exercise sheet with the clip at full width, all cues and the muscles worked.
On the plan screen, the exercise page that a tap already opens shows the same clip, cues and muscles at the top.
The clips are bundled in the APK and work offline.

## Decisions

- Source is the openGym media set (`catalogue/media/clip/<id>.mp4`, 180 px) — the use, including AI processing, is approved and recorded in `.internal/DECISIONS.md`.
- The SDD figure pipeline (MediaPipe pose, Skia figure, B06, B10, gate H2, V15) is replaced by these clips — real renders teach form better, and pose data from a 180 px source is poor.
- The clips get a fixed recolour in Vee's theme at build time: dark lines take the `text` token, the red target muscles take the `accent` token, the white background becomes the `surface` token, one light and one dark variant — the motion and frame timing stay the source's, so nobody needs to review the form.
- Real-ESRGAN (local, free, `realesr-animevideov3`) upscales each clip 3× before the recolour, and the output is 480 px at WebP quality 40 — the 180 px source is blurry at full width, an upscaler does not redraw the body, and 480 px keeps all clips under 10 MB.
- No generative restyle and no OpenRouter call — a generative model redraws each frame and can change the form.
- The output is opaque animated WebP on the `surface` colour, shown with expo-image on a `surface` tile — it loops with no player controls, and an alpha channel made each clip about four times larger.
- `vee-internal/media/map.yaml` maps each Vee exercise id to one openGym id; output files are named by openGym id and a generated `index.js` maps exercise ids to them — variants that share a source share one file.
- A variant with no own openGym entry (pause, negative, band-assisted, weighted, slow) maps to its base movement — the cues describe the difference.
- An exercise with no match has no map entry; the app shows the cues only for it.
- Source clips, map and processed clips live in `vee-internal/media/` — the media is not AGPL and the owner stays anonymous, so it stays out of the public repo.
- `just media` builds the clips from `vee-internal` and copies them into `apps/mobile/assets/clips/`, which git ignores; `just apk` depends on it — a public clone without `.internal` builds an APK with cues only, because the app requires the folder as an optional Metro dependency.
- With the system reduced-motion setting on, the app shows the first frame and does not animate — the SDD already requires this for exercise demos.
- The rest screen does not show the clip inline — the timer stays the only large item there.
- The warm-up content does not change — it stays as one light set of each of the session's exercises.
- After the build, the PRD figure line and the SDD figure pipeline section are rewritten to this design, and B06 and B10 in BUILD and PROGRESS point to this spec.

## Out

- New warm-up drills (arm circles, leg swings and others) or any engine change.
- Clips for exercises outside the Vee catalogue.
- Downloading clips from a server.
- Video sound, playback controls, slow motion.
- Publishing the media or its licence notice in the public repo.

## How I know it works

- `just media` writes two WebP files (light and dark) for each mapped source into `apps/mobile/assets/clips/` and prints the exercise ids that have no clip.
- `just check` fails when `map.yaml` names an exercise id that is not in the catalogue.
- `git status` in `vee` shows no clip files after `just media`.
- On the Fold 6, the goblet squat set card shows a looping duotone clip in the theme colours, in light and dark mode.
- On the Fold 6, each warm-up row shows a moving thumbnail.
- A tap on an exercise on the plan screen opens its page with the clip, all cues and the muscles.
- A tap on an exercise name in the warm-up opens the sheet.
- With "Remove animations" on in Android settings, the clips show a still frame.
- An APK built without `.internal` opens a session and shows cues with no clip and no error.
- The release APK grows by less than 10 MB.
