# Layout: concentricity, grouping, type, targets

## Concentricity

Apple calls the result "quiet geometry": shapes that nest cleanly so nothing fights. Three shape
types cover everything.

| Shape | Rule | Use for |
|---|---|---|
| Fixed | a constant radius | predictable standalone containers |
| Capsule | radius = half the height | touch-friendly standout actions, sliders, switches |
| Concentric | radius = parent radius − padding | anything nested inside another rounded container |

The concentric rule is the one people get wrong. A 12px-radius card with 16px padding needs its
inner element at *zero* radius, not 12px — matching the parent's radius makes the corners look
pinched, because the gap between the two curves is not constant. In CSS this is
`calc(var(--parent-radius) - var(--padding))`, floored at 0.

Give a component that is used both nested and standalone a fallback radius, so it still looks right
when it has no parent to be concentric with.

## Grouping

Grouping is the main tool for hierarchy, so it deserves more thought than the colours do.

- **Group by function and frequency.** Things used together sit together; things used constantly sit
  where the hand already is.
- **Never put a symbol and a text label in one container.** People read that as a single button and
  tap the wrong half.
- **The primary action sits apart from the group** and is the one tinted element.
- Don't mix persistent and contextual controls in the same bar — a checkout button does not belong
  in a tab bar that is present on every screen. That blurs what is navigation and what is action.
- Near a screen edge, a capsule with extra margin sits better than a shape aligned to the edge; on
  larger canvases, a concentric shape aligned to the window edge balances better.

## Spacing

Use one spacing scale and stay on it. Space is what makes grouping legible: if the gap between
groups is not clearly larger than the gap within a group, there are no groups, only a list.

A practical check: squint at the screen. If you cannot see the groups when the text is unreadable,
the spacing is not doing its job and no amount of borders will fix it.

## Typography

- **Bolder** weights read more clearly, especially over a material.
- **Left-align** running text. Centred text is for short, deliberate moments — a title, an empty
  state — not for lists or paragraphs.
- Emphasise at the moments that matter: alerts, onboarding, confirmation.
- Keep one type scale across the product, and let size and weight — not colour — carry rank.

### Sizes

For anything a person reads while doing something else (which on a phone is most things):

| Context | Recommended | Floor |
|---|---|---|
| Phone / tablet body and callouts | **17pt or larger** | 11pt for genuinely incidental labels |
| Desktop body | 13pt or larger | 10pt |

The principle behind it: *the more compact the device, the larger the text should be.* When space is
tight, put the content in a scroll view — do not shrink the type or the controls to fit. Shrinking is
how an interface becomes unusable in exactly the situation where it is needed most.

## Tap targets

| Input | Standard | Minimum |
|---|---|---|
| Touch | **44×44pt** | 28pt, for infrequent controls only |
| Pointer | 28×28pt | 20pt |

The visual size of a control and its tap target are allowed to differ — a small glyph can carry a
44pt hit area around it, and usually should.

## Safe areas

Safe areas are **guides, not margins**. Keep interactive elements and anything that must be read
inside them, but let the content itself — artwork, a game world, a photo — use every pixel. Treating
the safe area as a hard margin wastes the screen and makes the design look boxed in.
