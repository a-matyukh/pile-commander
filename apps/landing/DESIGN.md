# Design: the `/alt` landing

This describes the alternative landing at `/alt` ("From a pile to order").
The home page and the other pages keep their current look (`assets/css/main.css`).
Tokens live in `assets/css/alt.css`; every rule there sits under `.alt`, so
nothing leaks into the rest of the site. Light theme only.

The direction comes from the app icon: a white tile with five flat, vivid
shapes. It was not checked against other websites.

## Idea

The icon's five shapes are the pile. In the hero they lie scattered; at the
end of the page they stand in a row. Between them the page is white paper,
near-black type and the product itself.

## Color

| Token | Value | Role |
| --- | --- | --- |
| `--alt-paper` | `#ffffff` | Page background, frames, cards |
| `--alt-wash` | `#f6f6f3` | Alternate section background, quiet fills |
| `--alt-line` | `#e5e4df` | Borders and dividers |
| `--alt-ink` | `#14151a` | Headings, primary button, the final panel |
| `--alt-ink-2` | `#3d3f47` | Body text (10.6:1 on paper) |
| `--alt-ink-3` | `#6b6e78` | Captions and secondary text (5.1:1 on paper) |
| `--alt-link` | `#0b6fd0` | Text links and focus rings (5.0:1 on paper) |
| `--alt-blue` | `#2194f8` | Shape fill. Section accent: See |
| `--alt-purple` | `#6044d9` | Shape fill; also safe as text (6.3:1). Section accent: Tidy |
| `--alt-pink` | `#f82194` | Shape fill; text only at 24px and larger (3.7:1). Section accent: Make |
| `--alt-green` | `#21f885` | Shape fill only, never text. Section accent: Files |
| `--alt-yellow` | `#f8f121` | Shape fill only, never text. Section accent: Start |

Rules:

- The five icon colors are fills for shapes, markers and small highlights.
  Text is ink; links are `--alt-link`.
- One accent per section. All five appear together only in the hero and in
  the final panel.
- No gradients on page surfaces, no blurred blobs, no gradient text.
- Product scenes (`components/home/*Scene.vue`, the view switcher) keep the
  app's own blue-gray palette: they are pictures of the product.

## Typography

- Display: **Geologica Variable** (`--alt-font-display`), weight 600,
  letter-spacing −0.035em. Headings only.
- Text: **Onest Variable** (`--alt-font-text`), weights 400, 500 and 600.
- Both have Cyrillic, so a Russian version needs no new fonts. They are
  self-hosted through `@fontsource-variable/*`.

| Class | Size / line height | Use |
| --- | --- | --- |
| `.alt-h1` | `clamp(2.75rem, 7vw, 5.75rem)` / 0.98 | Hero headline |
| `.alt-h2` | `clamp(2rem, 4.4vw, 3.5rem)` / 1.04 | Section headline |
| `.alt-h3` | 1.25rem / 1.3 | Card and fact titles |
| `.alt-lede` | `clamp(1.125rem, 1.6vw, 1.3125rem)` / 1.5 | Paragraph under a headline |
| body | 1.0625rem / 1.6 | Running text |
| `.alt-small` | 0.875rem / 1.5 | Captions, notes |
| `.alt-label` | 0.875rem / 1.2, weight 600 | Section label next to its shape |

Text lines stay within 40rem.

## Spacing

A 4px scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.

- Section padding: `--alt-section` = `clamp(4rem, 9vw, 7.5rem)` top and bottom.
- Content width: `--alt-width` = 75rem. Side gutter: 20px, 32px from 768px.

## Shape and depth

- Radius: `--alt-radius-s` 8px (small controls), `--alt-radius-m` 16px
  (frames, cards), `--alt-radius-l` 28px (large panels). Buttons are pills.
- One shadow, `--alt-shadow`, under product frames only. Cards have a border
  and no shadow.

## Components

- **Button** `.alt-btn`: pill, 48px high (40px with `.alt-btn-sm`), weight 600.
  - `.alt-btn-primary`: ink background, white text; hover lifts to `#2b2d36`.
  - `.alt-btn-secondary`: paper background, ink border and text; hover fills wash.
  - On the ink panel: `.alt-btn-light` (paper background, ink text) is the
    primary, `.alt-btn-ghost` (white border and text) the secondary.
  - Focus: 2px `--alt-link` outline, 3px offset; white on the ink panel.
    One primary button per view.
- **Quiet link** `.alt-link`: `--alt-link`, underlined on hover, optional arrow.
- **Section label** `.alt-label`: a small icon shape in the section's accent,
  then one word (See, Tidy, Make…). It replaces the uppercase eyebrow.
- **Frame** `.alt-frame`: paper, 1px `--alt-line`, radius 16px, `--alt-shadow`.
  Holds a product scene or a screenshot.
- **Tabs**: a pill group; the active tab is ink with white text. The view
  switcher taken from the home page gets the same look through `See.vue`.
- **Header**: logo, Pricing, GitHub, one small primary button.
- **Footer**: the page's own, with the same links as the site's footer, on
  paper with ink text.

## Imagery and icons

- The product is shown by live scenes and real screenshots, never by stock
  pictures or illustrations of people.
- Decoration is only the five icon shapes: line, rectangle, square, circle,
  arc. Flat fills, no outlines, no shadows.
- UI icons: Lucide; the app's own view icons are Tabler, as in the app.
