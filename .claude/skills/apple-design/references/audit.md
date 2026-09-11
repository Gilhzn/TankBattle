# Audit checklist

Run this against a finished interface and report each line as pass or fail with the evidence. The
point is to turn "it looks nicer" into something checkable — and most of these are checkable by
reading the stylesheet or measuring a screenshot, not by opinion.

Fails are fine. An honest fail with a reason ("the HUD uses a flat fill, not blur, because blur cost
6ms a frame over the canvas") is more useful than a pass that was not verified.

## Hierarchy

- [ ] **Exactly one tinted control per surface.** Count them. More than one and the tint has stopped
      meaning "primary".
- [ ] Every other control shares one neutral treatment.
- [ ] Hierarchy survives a squint test: with the text illegible, the groups and the primary action
      are still apparent from layout alone.
- [ ] No element relies on a border or a drop shadow to say "I am important" where position or size
      could have said it.

## Material

- [ ] No glass element sits on another glass element.
- [ ] No content container — list, table, data card, scroll region — is made of glass.
- [ ] Only one glass variant is in use across the interface.
- [ ] In the resting state of each screen, content and glass do not intersect awkwardly.

## Geometry

- [ ] Nested radii are concentric: inner radius = outer radius − padding (floored at 0). Check the
      computed values, not the intent.
- [ ] Standout touch actions are capsules, or a deliberate fixed radius — not an arbitrary third value.
- [ ] One radius scale across the product; no element has a bespoke corner.

## Type

- [ ] Body text at its smallest computed size is **≥17px** on a phone-width viewport. Measure it at
      the narrowest supported width, where `clamp()` bottoms out.
- [ ] No text anywhere below 11px.
- [ ] Running text is left-aligned; centring is reserved for titles and empty states.
- [ ] Rank is carried by size and weight, not by colour.

## Targets and feedback

- [ ] Every interactive element has a ≥44×44px hit area, even where the visible glyph is smaller.
- [ ] Press states are visible *outside* the control's own bounds — verify on a touch control with a
      simulated finger over it, since that is the case the rule exists for.
- [ ] Unavailable controls are removed rather than accumulating in a disabled state.

## Contrast

- [ ] Every text/background pair measured, not eyeballed, including text over translucent surfaces
      against the worst-case content behind them. Report the ratios.
- [ ] Contrast still passes with the material at its most transparent state.

## Accessibility

- [ ] `prefers-reduced-transparency` produces a frostier or opaque surface that still looks
      deliberate.
- [ ] `prefers-contrast: more` pushes elements to near-black/near-white with a contrasting border.
- [ ] `prefers-reduced-motion` removes elastic and large movement.

## Performance

- [ ] Frame time measured with any blurred surface in place over animating content, under CPU
      throttling, and compared against the same scene without it. State the numbers and which
      treatment shipped.

## Games only

- [ ] The playfield is not glass and keeps its own art direction.
- [ ] Game UI is hidden while a menu is open.
- [ ] Frequent controls sit within thumb reach; menu controls are away from play.
- [ ] Nothing at launch delays the player from reaching the core loop.
