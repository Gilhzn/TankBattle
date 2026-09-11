# Games: HUD, controls, and feedback

Games break the usual assumption that the interface *is* the product. Here the arena is the content
and every control is something in the way of it — useful, but in the way. That reframing decides
most of the calls below.

## The playfield is the content layer

The world, board or arena is content, so it keeps its own art direction and never becomes glass.
The HUD and the controls are the floating layer above it. This is the same rule as any other app;
it just happens to settle the tempting question of whether to "glassify" the game art. Don't.

## HUD

- Show only what the player needs *while playing*. Everything else belongs on a screen they choose
  to open.
- **Remove controls that are currently unavailable** rather than greying out a growing pile of them.
  Clutter costs attention in the one place attention is scarce.
- **Hide the game UI entirely while a menu is open.** Virtual controls over a menu obscure it and
  make it awkward to navigate.
- Update glyphs contextually as what a control does changes. A button that means different things at
  different moments should say so.
- Keep the HUD inside the safe area; let the arena itself run to the edges.

## On-screen controls

- **Place frequent actions where the thumbs already are** — the lower corners on a phone. Menu
  buttons go at the top, away from play.
- Avoid the centre of the display (where the character or the action usually is) and avoid the
  region where movement or camera input happens.
- Expand input areas generously. There is no tactile edge to feel for, so a control that is exactly
  as large as it looks will be missed.
- Prefer direct manipulation to simulated hardware: dragging to pan a camera beats a virtual
  thumbstick, and tap-to-move suits an overhead view. Familiar system gestures (pinch to zoom) are
  worth matching.
- Use the full dynamic range of touch where it helps — pressure or distance can carry a second axis
  of intent without a second control.

## Press feedback — the rule most often missed

**A finger covers the button it is pressing.** A press state drawn only inside the control's own
bounds is therefore invisible at the exact moment it matters.

So a press must be visible *outside* the control: a glow or highlight that extends past its edge,
theme-matched to the game. Pair it with a subtle haptic on touch-down and touch-up, and with sound
designed for the action itself. Together these replace the tactile confirmation a physical button
would have given.

## Defaults and onboarding

- **Set things up for the player automatically.** Don't ask about screen size, aspect ratio, or
  whether a controller is attached — detect it. Remove options that are not relevant rather than
  presenting them.
- **Get into play as fast as possible.** At launch, avoid splash screens, menus, agreements,
  rating prompts and notification opt-ins. Anything not directly about the core loop — daily
  challenges, tournaments, leaderboards — waits until after the player has actually played.
- Teach the core loop first, one step at a time, in short tutorials delivered at the moment each is
  relevant rather than one long sequence up front. Let the player act during it, and let them skip it.
- Keep a reference section where tutorials can be replayed later.
- Introduce purchases only after normal gameplay has been experienced, and explain what the thing
  does and where it is used.

## Input beyond touch

- Use the platform's controller framework to get correct glyphs at runtime rather than baking button
  art into the game — remapped controls and new hardware will otherwise show the wrong thing.
- Validate keyboard mappings against the platform's actual modifier layout instead of assuming.

## Test on a real device

Emulators and desktop browsers hide exactly the problems this page is about: how big a control
really feels, whether a thumb reaches it, whether the press state is visible under a finger, and
whether the frame rate holds. Nothing substitutes for holding it.
