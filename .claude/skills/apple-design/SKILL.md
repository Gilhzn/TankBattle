---
name: apple-design
description: Apply Apple's design system — Liquid Glass materials, concentric layout, and the Human Interface Guidelines for games — to an interface. Use this whenever you are designing or restyling any UI surface: screens, menus, buttons, cards, modals, navigation bars, a game HUD, or on-screen touch controls; whenever someone asks for a UI to look "more polished", "more professional", "like an Apple app", "less cluttered" or "better designed"; and whenever you are choosing colours, corner radii, type sizes, spacing, tap targets or press states. Also use it to audit an existing interface, even if nobody used the word "Apple" — the checklist in references/audit.md catches the mistakes that make an interface look amateur.
---

# Apple's design system

Apple's system is a discipline, not a look. Almost every rule here follows from one idea:

> **Hierarchy comes from layout and grouping, not from decoration.**

Most interfaces that read as amateur got there by doing the opposite — giving every button its own
saturated colour, its own border, its own shadow — so that everything shouts and nothing leads. The
fastest way to make an interface look designed is usually to *take decoration away* and let
position, grouping, size and weight do the work instead.

The material (glass) is the second idea: **controls float in a distinct layer above the content, and
the content is what the person came for.** Glass earns its place by making that separation legible,
not by looking shiny.

## The three heuristics

Apple frames the whole system as hierarchy, harmony and consistency:

- **Hierarchy** — expressed through layout and grouping. If you are reaching for a colour or a
  border to say "this one matters", stop and ask whether position, size or separation can say it.
- **Harmony** — every element plays in the same key. Shared radii, shared spacing rhythm, shared
  type scale. One element with its own geometry breaks the whole surface.
- **Consistency** — a decision made once carries across every screen and every device size.

## The rules that do the most work

These are the ones worth remembering without opening a reference file:

1. **Tint only the primary action.** Apple is explicit: never tint all elements, because when
   everything stands out equally nothing does. One tinted control per surface. If you want colour in
   the product, put it in the *content*, not on the chrome.
2. **Never stack glass on glass**, and never build content containers — lists, tables, cards full of
   data — out of glass. Glass is the floating control layer only.
3. **Radii are concentric.** A nested element's radius is its parent's radius minus the padding
   between them. Capsules (radius = half the height) are for touch-friendly standout actions.
   Mismatched radii read as "pinched" corners and are one of the loudest amateur tells.
4. **Group by function and frequency**, and never put a symbol and a text label in the same
   container — people read that as one button.
5. **Type is bolder and left-aligned**, and body text does not go below the platform floor
   (17pt on a phone for anything a player reads during play; 11pt is the absolute minimum for
   incidental labels).
6. **Tap targets are 44×44pt**, 28pt only for genuinely minor controls.
7. **Accessibility is behaviour, not an afterthought**: reduced transparency makes the material
   frostier, increased contrast pushes elements to near-black/near-white with a contrasting border,
   reduced motion drops the elastic.

## How to work

Start by finding what is carrying hierarchy today. In a codebase that usually means the button
styles and the token file — read them before changing anything, and notice how many different
treatments exist. Collapsing five button skins into one neutral treatment plus one tinted primary is
usually the single highest-value change available, and it is mostly deletion.

Then work outward: tokens (material, radii, type scale, spacing) → controls → screens → overlays.
Doing it in that order means each layer inherits from a settled one below it, instead of you
retuning the same values five times.

**Measure, don't eyeball, the two things that translucency quietly breaks:** text contrast against
whatever now shows through, and frame time when a blurred surface sits over animating content.
Backdrop blur over a canvas that is redrawing every frame is genuinely expensive on a phone; if the
frame budget moves, use a plain translucent fill for that one surface and keep real glass where the
content underneath is static. The look barely changes at small sizes and the budget is not
negotiable.

## References

Read the one you need; they are short.

- `references/materials.md` — the glass variants and when each is allowed, layering, tinting,
  adaptive legibility, shadows, and the accessibility behaviours.
- `references/layout.md` — concentricity and radii, grouping rules for bars and toolbars, spacing,
  the type scale, and tap target sizes.
- `references/games.md` — the game-specific guidance: HUD, on-screen controls, press feedback, safe
  areas, onboarding. Read this whenever the surface sits over live gameplay.
- `references/audit.md` — a pass/fail checklist. Run it against the finished interface and report
  the results; it is what turns "looks nicer" into something you can actually check.

## Sources

Apple's own sessions, not second-hand summaries:

- Meet Liquid Glass — https://developer.apple.com/videos/play/wwdc2025/219/
- Get to know the new design system — https://developer.apple.com/videos/play/wwdc2025/356/
- Design advanced games for Apple platforms — https://developer.apple.com/videos/play/wwdc2024/10085/
- Onboarding for games — https://developer.apple.com/app-store/onboarding-for-games/
- Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/
