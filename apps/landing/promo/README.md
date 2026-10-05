# Promo video and ProductHunt slides

These scripts record the **real web client** on its `/demo` workspace. That is the demo
pack exported from the local `piles/` folder (Welcome, Features, Use cases) by
`bun run demo:pack`; see `DEMO_FROM_PILES.md`.

Outputs:

- `apps/landing/public/demo.mp4` (1920×1080 H.264, ~53 s, no audio) and `demo-poster.jpg`.
  The landing's "Watch demo video" modal plays this file. Copies are also written to `out/`.
- `out/slides/*.png`: the ProductHunt gallery, 1270×760 rendered at 2× (2540×1520).

## Regenerate

You need Google Chrome (the demo videos are H.264, which Playwright's Chromium can't play),
ffmpeg with libx264 (`brew install ffmpeg`) and the client dev server:

```bash
bun run dev:web
```

Then, from the repo root:

```bash
bun run demo:pack                        # piles/ → apps/client/public/demo-pack
bun apps/landing/promo/record.ts         # shots + stills → .work/ (record.ts views → one shot)
bun apps/landing/promo/compose.ts        # → public/demo.mp4 + poster
bun apps/landing/promo/slides.ts         # → out/slides/
```

- Captions, timing and speed live in the `segments` table in `compose.ts`.
- The URL on the outro card and slide 6 defaults to `pile-commander.com`. Override it with `PROMO_URL=…`.
- Each shot is a scripted function in `record.ts`. A fake cursor and click ripple are injected
  into the page, because headless Chrome has no visible pointer.
