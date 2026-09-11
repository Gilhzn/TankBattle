# Materials: Liquid Glass

Glass is a **functional layer that floats above content**. Its job is to separate controls from the
thing the person came to look at, while letting that thing stay visible. It is not a decorative
finish, and the moment it is used as one it starts costing legibility for nothing.

## The two variants

**Regular** is the default and the answer almost every time. It carries the full set of adaptive
behaviours, so it stays legible at any size, over any content, with anything placed on top of it.
If you are unsure which to use, it is this one.

**Clear** is permanently more transparent and has *no* adaptive behaviour. It needs a dimming layer
underneath it or legibility falls apart. Apple allows it only when all three of these hold:

1. the element sits over media-rich content, and
2. that content is not harmed by a dimming layer, and
3. what sits on top of the glass is bold and bright.

**Never mix the two variants in one interface.** Two materials that behave differently read as a
bug, not a choice.

## Layering

- Glass belongs to the navigation and control layer. Content below it gets a larger, more expansive
  canvas precisely *because* the controls floated off it.
- **No glass on glass.** When something needs to sit on a glass surface, use a fill, transparency or
  vibrancy — a thin overlay that reads as part of the same material rather than a second pane.
- **No glass in the content layer.** Lists, tables, data cards and anything scrollable full of
  information are content. Building them out of glass destroys the very separation glass exists to
  create.
- Avoid content and glass intersecting in a resting state (the moment a screen finishes loading).
  If they collide, reposition or rescale the content rather than accepting the overlap.
- Apply the material to the control itself, never to an inner view inside it.

## Tinting

Tinting exists to mark **the one primary action**, and its power comes entirely from scarcity.

- Tint selectively: the confirm, the buy, the play. One per surface.
- Never tint everything. Apple's phrasing is that it "creates confusion when everything stands out
  equally" — which is exactly what a screen of differently-coloured buttons does.
- If the product needs to feel colourful, that colour goes in the **content layer**, not on chrome.
- A good tint adapts: it maps a range of tones to the brightness of what is behind it, the way real
  coloured glass shifts hue and saturation with its backdrop.

## Adaptive legibility

- **Small elements** (a toolbar, a tab bar, a HUD chip) continuously adapt to what is behind them,
  and will flip between light and dark to stay discernible. Symbols and glyphs flip with them.
- **Large elements** (menus, sidebars, sheets) adapt more gently and do *not* flip — at that size a
  flip is a distraction. What sits on top of them still flips for contrast.
- **Shadows carry adaptive opacity**: stronger over text, lighter over solid pale backgrounds. Their
  job is grounding the element so it is always findable, not decoration.
- When glass grows (a button expanding into a menu) it should read as thicker material: deeper
  shadow, more pronounced refraction, softer light scatter. That extra depth is what keeps the
  content inside it legible.

## Accessibility

These are behaviours the material owes the user, not optional extras:

- **Reduced transparency** — the material becomes frostier and obscures more of what is behind it.
  The design should still look deliberate in this state, not broken.
- **Increased contrast** — elements go predominantly black or white and gain a contrasting border.
- **Reduced motion** — effect intensity drops and elastic behaviour is disabled.

On the web these map to `prefers-reduced-transparency`, `prefers-contrast: more` and
`prefers-reduced-motion`. Wire all three; a translucent interface that ignores them is unusable for
some people rather than merely less pretty.

## Cost

Backdrop blur is not free. Over static content it is cheap enough; over a canvas or video that
repaints every frame it can dominate the frame budget on a phone. Measure it. Where it costs too
much, a plain translucent fill at the same tone is visually near-identical at small sizes — take
that trade rather than dropping frames during interaction.
