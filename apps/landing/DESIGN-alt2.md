# Design: the `/alt2` landing

This describes the third landing at `/alt2` ("A file manager. The next
generation."): six things a file manager can do now, one section each.
The home page and `/alt` keep their own looks (`assets/css/main.css`,
`DESIGN.md`). Tokens live in `assets/css/alt2.css`; every rule there sits
under `.alt2`, so nothing leaks into the rest of the site. Light only.

The owner chose this direction, "blueprint", from three shown on the same
first screen (blueprint, dark showcase, journal). It was not checked against
other websites.

## Idea

A product map. The hero is the app's window with the six ideas pinned to the
places they live in: the view button, AI, sync, share, the window itself and
the folder's path. Every section carries the same number. The page is cool
paper with a faint grid, near-black type and one blue, like a technical
drawing of the product.

## Under review

`components/alt2/ReviewSwitch.vue` (bottom left) switches options on the live
page. It goes once the owner has chosen.

- **Accent** (`?accent=`): `blue` gives every number the one blue; `logo`
  gives each idea a colour of the app icon (table below).
- **Font** (`?font=`): `inter` is Inter Tight for headings and Inter for
  text; `manrope` is Manrope for both, weight 700 and tighter tracking in
  headings, as in the dark showcase; `geologica` is Geologica for headings
  and Onest for text, as on `/alt`. The mono labels and numbers stay
  JetBrains Mono whatever the font.

Once the owner has chosen, the switch, the unused options' tokens and their
font imports go (Geologica and Onest stay installed for `/alt`).

## Color

| Token | Value | Role |
| --- | --- | --- |
| `--a2-bg` | `#f5f6f8` | Page background, cool paper |
| `--a2-bg-alt` | `#ffffff` | Every other section |
| `--a2-line` | `#dde1e8` | Borders and dividers |
| `--a2-ink` | `#0b1220` | Headings, primary button, the final panel |
| `--a2-ink-2` | `#3a4356` | Body text (9.2:1 on paper) |
| `--a2-ink-3` | `#5f6b80` | Captions and secondary text (5.0:1 on paper) |
| `--a2-accent` | `#2453ff` | Numbers, the second line of the headline, links, focus (5.2:1 on paper) |
| `--a2-accent-soft` | `#e8edff` | Hover fill of the legend |
| `--a2-grid` | `rgb(36 83 255 / 0.07)` | The hero's grid lines |

With `?accent=logo` the six ideas take the app icon's colours. They are
fills for numbers and rings, never text; the number on them is ink, white
only on purple.

| Idea | Token | Value |
| --- | --- | --- |
| 1 Views | `--a2-m1` | `#2194f8` |
| 2 AI | `--a2-m2` | `#6044d9` |
| 3 Sync | `--a2-m3` | `#21f885` |
| 4 Share | `--a2-m4` | `#f82194` |
| 5 Any screen | `--a2-m5` | `#f8f121` |
| 6 Your disk | `--a2-m6` | `#ff8a3d` (the icon has five colours) |

Rules:

- One accent. No gradients on surfaces, no blurred blobs, no gradient text.
- Product scenes keep the app's own palette (`apps/client/src/ui/explorer/tokens.css`):
  they are pictures of the product.

## Typography

- Display: **Inter Tight Variable** (`--a2-font-display`), weight 600,
  letter-spacing −0.035em. Headings only.
- Text: **Inter Variable** (`--a2-font-text`), weights 400, 500 and 600.
- Labels and numbers: **JetBrains Mono Variable** (`--a2-font-label`): the
  section label is mono, uppercase, 0.75rem, tracked 0.08em.
- All three have Cyrillic, so a Russian version needs no new fonts. They are
  self-hosted through `@fontsource-variable/*`.

| Class | Size / line height | Use |
| --- | --- | --- |
| `.a2-h1` | `clamp(2.75rem, 6.4vw, 5.5rem)` / 0.98 | Hero headline, two lines |
| `.a2-h2` | `clamp(2rem, 4.2vw, 3.375rem)` / 1.04 | Section headline |
| `.a2-h3` | 1.1875rem / 1.3 | Fact titles |
| `.a2-lede` | `clamp(1.125rem, 1.6vw, 1.3125rem)` / 1.5 | Paragraph under a headline |
| body | 1.0625rem / 1.6 | Running text |
| `.a2-small` | 0.875rem / 1.5 | Captions, notes |
| `.a2-label` | 0.75rem / 1.2, mono, uppercase | The section's number and word |

Text lines stay within 40rem.

## Spacing

A 4px scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.

- Section padding: `--a2-section` = `clamp(4.5rem, 9vw, 8rem)` top and bottom.
- Content width: `--a2-width` = 76rem. Side gutter: 20px, 32px from 768px.

## Shape and depth

- Radius: `--a2-radius-s` 4px (small controls), `--a2-radius-m` 8px (legend
  items), `--a2-radius-l` 14px (frames, the final panel).
- Buttons are pills (`--a2-btn-radius`), like the app's floating panels.
- Numbered markers are 4px squares.
- One shadow, `--a2-frame-shadow`, under product frames only.

## Components

- **Button** `.a2-btn`: pill, 48px high (40px with `.a2-btn-sm`), weight 600.
  - `.a2-btn-primary`: ink background, white text.
  - `.a2-btn-secondary`: grey border, ink text.
  - On the final panel: `.a2-btn-inverse` and `.a2-btn-inverse-ghost`.
  - Focus: 2px `--a2-link` outline, 3px offset. One primary button per view.
- **Marker** `.a2-marker`: the idea's number in a small square; the same
  number on the map, in the legend and in the section label.
- **Section** `Alt2Section`: label, headline on the left, paragraph on the
  right, then the scene, three facts with a top rule, and an optional note.
- **Frame** `.a2-frame`: holds a product scene.
- **Header**: logo, the six ideas as anchors (from 1100px), Pricing, GitHub,
  one small primary button.
- **Footer**: the same links as the site's footer.

## Scenes

Every section has a scene drawn after the real app in its palette, with the
app's own strings. Each shows its settled frame first; it plays by itself
while on screen when motion is welcome, and its Play runs it once even with
reduced motion, since the visitor asks for it.

| Section | Component | Shows |
| --- | --- | --- |
| Hero | `MapScene` | The window with the six numbered places; the legend links to the sections |
| 1 Views | `ViewsScene` | Nine views in the menu's order and three groups |
| 2 AI | `AiScene`, `ModelSettings`, `AgentChat` | Four actions (the home page's scenes); a model in Settings → AI; an agent's plan in the Sort dialog |
| 3 Sync | `SyncScene` | A folder and its cloud copy, the Sync button's status, the same view on both sides |
| 4 Share | `ShareScene` | Share with…, Make a public folder, Publish on the Hub, and what others see |
| 5 Any screen | `DevicesScene` | One cloud folder on a monitor, a tablet and a phone, at one scale |
| 6 Your disk | `DiskScene` | The app deleted and installed again beside an ordinary file window |

## Imagery and icons

- The product is shown by live scenes drawn after the real app, never by
  stock pictures. The hero's photos come from the demo moodboard
  (`public/landing-alt2/`).
- UI icons: Lucide; the app's own icons are Tabler, as in the app.
