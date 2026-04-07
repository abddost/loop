# AGENTS.md

## Task Completion Requirements

- Both `bun lint` and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

Loop is a minimal web GUI for using code agents in Desktop Application

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

`If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there are shared logic that can be extracted to a separate module. Duplicate logic across mulitple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Visual Design Standards

Prioritize:
- **Color & Theme**: Commit to a deliberate visual identity. Define colors through CSS variables to ensure consistency. Favor a strong dominant palette with sharp accent colors over flat, evenly-spread schemes that fade into the background.
- **Motion**: Leverage animation for transitions and subtle interaction feedback. Prefer pure CSS for HTML-based work; use the Motion library in React where applicable. Invest in a few high-impact moments — a choreographed entrance with staggered delays lands far better than scattered, forgettable micro-interactions. Scroll-triggered reveals and hover states should feel surprising and intentional.
- **Spatial Composition**: Break free from predictable grid systems. Embrace asymmetry, overlapping layers, diagonal movement, and elements that escape their containers. Alternate between generous whitespace and tightly packed density depending on the mood.
- **Backgrounds & Visual Texture**: Build atmosphere through depth rather than flat color fills. Layer contextual effects and textures that reinforce the overall tone. Reach for gradient meshes, noise overlays, geometric motifs, translucent stacking, deep shadows, ornamental borders, custom cursors, and film-grain effects to add richness.

NEVER produce generic, AI-default aesthetics: avoid overworked typefaces (Inter, Roboto, Arial, system-ui), tired color stories (purple gradients on white being the prime offender), cookie-cutter component patterns, or any design that could belong to any project and therefore belongs to none.

Interpret every context creatively and make choices that feel purposefully crafted for it. No two designs should look alike — cycle freely across light and dark themes, varied typefaces, and diverse visual personalities. Resist gravitating toward the same safe picks (e.g. Space Grotesk) across different generations.

**IMPORTANT**: Calibrate implementation depth to the design's ambition. Maximalist visions demand rich, elaborate code with layered animations and effects. Minimalist or refined aesthetics call for restraint, tight spacing, and meticulous typographic control. Excellence means executing the chosen vision completely — not defaulting to a comfortable middle ground.
use(if you find suitable) @heroui for ready components and @openai/apps-sdk-ui for icons 
