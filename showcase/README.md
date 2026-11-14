# Showcase video

The scripts that make Bannuar's showcase video: a slow, captioned walk through the website, the HR
portal, the client portal and the employee app (about 9½ minutes, 1920×1080, 30 fps, with music).

Every screen in it is the real software, captured in Chromium. Every record on screen is demo data.
Nothing reaches Bannuar's Supabase project while capturing: the portal and the app talk to a stand-in
API inside the browser, the website's calls are answered with demo answers, and requests to
`*.supabase.co` and storage hosts are blocked. People in the photos are illustrations.

## What you need

- Node 22 and Playwright's Chromium (`require('playwright')` must work)
- ffmpeg, Python 3 with numpy, and `pdftoppm` (poppler-utils, for the certificate page)
- `bannuar-app` and `bannuar-website` checked out next to `bannuar-portal` (or set `APP_DIR` and
  `WEBSITE_DIR`), with their packages installed

## Make the video

Run these from the `bannuar-portal` folder.

1. Build the employee app for the browser (react-native-web stands in for React Native, `app-web/stubs`
   for the phone-only modules, `app-web/mock.js` for Supabase):

   ```bash
   (cd ../bannuar-app && npm i --no-save react-native-web@0.21.2 react-dom@19.0.0 esbuild@0.25.10)
   ```

   ```bash
   node showcase/app-web/build.mjs
   ```

   With the app elsewhere: `APP_DIR=/path/to/bannuar-app node showcase/app-web/build.mjs`.

2. Build the website, then capture the three parts. Each writes screenshots and the boxes the video
   points at (marks) into `showcase/.out`:

   ```bash
   (cd ../bannuar-website && npm run build)
   ```

   ```bash
   node showcase/capture/website.mjs
   ```

   ```bash
   node showcase/capture/app.mjs
   ```

   ```bash
   node showcase/capture/portal.mjs
   ```

3. Render. This writes `showcase/bannuar-showcase.mp4` (about 10 minutes on 4 cores):

   ```bash
   node showcase/video/render.mjs
   ```

   To check the pictures first, `--stills` writes one still of every beat to `showcase/.out/stills`,
   and `--at 12.5,40` writes stills at those seconds. `--from 60 --to 75` renders only that part.

## Change the video

- **What is shown, for how long, and the captions:** `video/storyboard.js`. A beat is one screen with
  its hold in seconds, an optional zoom to a mark, a ring around a mark, and a tap at the end.
  Holds are long on purpose: one idea a screen, enough time to read the caption.
- **Layout, motion and devices:** `video/stage.js` and `video/stage.html`.
- **Music:** `video/music.py` makes it from the timeline with numpy alone (no samples, nothing to
  license): calm in D major, a part for each chapter, a soft click on each tap.
- **Fonts:** Archivo, under the SIL Open Font License (`video/assets/Archivo-OFL.txt`).

The rendered video is committed as `bannuar-showcase.mp4`, with its narration script in [voice-over.md](voice-over.md). `showcase/.out` (captures and stills) is not.
