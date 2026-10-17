# BlackMail — Logo Generation Prompt

A ready-to-paste prompt for an image/logo generator (Midjourney, DAL·E, Ideogram, Figma AI, etc.),
plus variants and the brand constraints behind it. BlackMail is a privacy-messaging app: you write
one message in your real voice; a **formal** version goes on the record through normal apps, while the
**original** stays sealed behind a short-lived, revocable pass. The logo should say *two sides of one
message* and *sealed / private*, in the app's black + Signal-blue identity.

---

## Primary prompt (app icon / wordmark)

> Design a modern, minimal app logo for **"BlackMail"**, a privacy-first messaging app whose tagline
> is *"One message. Two sides of you."* The concept: a single message that has a public, formal side
> and a private, sealed side. Core mark: a lowercase **"b."** monogram set in a rounded-square app
> tile, where the period is a small glowing dot. Integrate a subtle **envelope fold / chat-bubble**
> that also reads as **two halves meeting** (the two channels), and a hint of a **lock or seal**.
> Palette: near-black tile (#0A0A0C to #15171C gradient) with a single **Signal-blue** accent
> (#3B82F6, highlight #5B9BFF) — no other colors. Flat vector, crisp geometry, soft inner glow on the
> blue, generous padding, works at 16px favicon and on a dark UI. Clean, trustworthy, premium — think
> Linear / Signal / Vercel, **not** neon "hacker" green and not clip-art. Deliver on a transparent and
> on a dark background. Vector, centered, no text other than the "b." mark.

**Negative / avoid:** stock-photo realism, heavy gradients, drop shadows, skeuomorphic leather,
neon green, multiple accent colors, busy detail, literal padlock clip-art, 3D bevels.

---

## Variant prompts

**A — Duality mark (no letter):**
> A minimal logomark: two overlapping rounded speech bubbles forming one shape — the left solid
> near-black, the right outlined in Signal-blue (#3B82F6) and partially "sealed" with a thin blue
> envelope fold across the middle. Symbolizes one message with a public and a private side. Flat
> vector, transparent background, balanced, favicon-safe.

**B — Envelope + reverse (ties to the "flip the script" idea):**
> App icon: a rounded-square black tile; inside, a simple envelope outline in Signal-blue whose flap
> doubles as a subtle circular reverse/refresh arrow, implying a message that can be recalled/expires.
> One accent color only (#3B82F6), soft glow, minimal, premium, dark-UI native.

**C — Wordmark (horizontal lockup):**
> Horizontal wordmark "BlackMail" in a clean geometric sans (medium weight, tight tracking), near-white
> on dark. The "b" carries a small Signal-blue dot; a thin blue seam runs under the word splitting a
> faint "formal / original" label. Modern, understated, high-end SaaS branding.

---

## Brand constraints (hand these to any tool or designer)

- **Colors:** base near-black `#0A0A0C` / `#15171C`; the *only* accent is Signal-blue `#3B82F6`
  (bright `#5B9BFF`). Text `#EEF0F4` / muted `#A3A9B5`. No green, no second accent.
- **Feel:** trustworthy, calm, secure-comms (Signal / Linear), premium — never "hacker terminal".
- **Meaning to encode:** one message, two sides (public formal ↔ private original); *sealed /
  short-lived*. A lock/seal or envelope-fold motif is on-brand; a reverse-arrow nods to expiry/revocation.
- **Must survive:** 16px favicon, dark and light surfaces, single-color (monochrome) fallback.
- **Format:** vector (SVG/PDF) with transparent + dark versions; an app-tile (squircle) and a
  horizontal wordmark lockup.

> A hand-built starter mark already ships at `extension/logo.svg` (the "b." tile with the blue
> envelope seam) — use it as the reference silhouette, or feed it to a generator as a style anchor.
