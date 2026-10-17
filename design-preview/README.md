# BlackMail — Design Preview

A static visual mockup of a sleek redesign. **No app code is touched** — this folder
is self-contained. Open `design-preview/index.html` in any browser to view.

## Palette: black + Signal blue

| Token | Value | Use |
| --- | --- | --- |
| Base | `#09090b` | Page background (near-black, not pure #000 — softer contrast) |
| Panels / cards | `#0e0f12` → `#15171c` | Raised surfaces |
| Accent | `#3b82f6` | Signal blue — trust / secure-comms signal, not "hacker green" |
| Accent bright | `#5b9bff` | Links, highlights, the "of you." mark |
| Text | `#f4f5f7` / `#a7acb6` / `#6c717c` | Primary / secondary / muted |

Blue is reserved for the **private channel and anything the user acts on** (the primary
button, the active tab, the pass, the live-access indicator). The public/formal channel
stays neutral — the color itself reinforces *private vs. for-the-record*.

## What changed vs. the current look

- Warm off-white + purple → **dark, high-contrast black base** with a single blue accent.
- Flat nav underline → **segmented pill tabs** with step numbers (01 / 02 / 03).
- The two compose columns now read as **two channels**: the private card glows blue with a
  left accent rail; the formal card is deliberately neutral.
- The expiry window is surfaced as a **live countdown** and a persistent "LIVE" re-check
  indicator in the recipient view — making the 5-minute / revocation model visible.
- Soft radial blue glow + glass header for a modern, premium feel.

## Faithful to the real features

Every screen maps to the actual app: **Compose** (original + formal rewrite → create pass),
**Open a pass** (paste → unlock → auto-clearing original), **Your passes** (local history,
revoke, active/revoked/expired states). Copy is lifted from the live extension.

## Interactivity

Tabs switch, and **Create private pass** reveals the generated-pass card. Everything else is
presentational — there is no backend wiring here by design.
