# Art spec: thick-outline cartoon SVG drawings

Every drawing is a string of SVG **inner markup** (what goes inside `<svg viewBox="0 0 120 120">`), stored in a
TypeScript record. Kids and grown-ups play on a TV from across the room, so drawings must read instantly, look
friendly, and share one style.

## File format

```ts
// src/art/<file>.ts
export const art: Record<string, string> = {
  cat: `<g>...</g>`,
  "ice cream": `<g>...</g>`,
};
```

Use template literals. Never write `${` or a backtick inside the markup. Keys are exactly as listed in your task.

## Canvas and composition

- ViewBox is `0 0 120 120`. Keep the subject centered inside roughly `8..112` on both axes, with its base near `y=108`.
- One clear subject, big simple shapes, about 8 to 25 elements. Chunky beats detailed.

## Style (follow exactly)

- **Outline** `#2b2d42`, `stroke-width="5"` (use `4` for small details, `3` for tiny ones), `stroke-linecap="round"`,
  `stroke-linejoin="round"`. Put `stroke`, `stroke-width`, `fill` etc. directly on every shape as attributes. Do not
  depend on CSS for anything except animation.
- **Fills**: flat colors only, from this palette:
  red `#ef476f`, orange `#ff9f1c`, yellow `#ffd23f`, green `#06d6a0`, blue `#118ab2`, sky `#8ed8ff`, purple `#9b5de5`,
  pink `#f15bb5`, cream `#fff4d6`, white `#ffffff`, brown `#a0653a`, tan `#e0a96d`, gray `#b8c0cc`, ink `#2b2d42`.
  Darker shade of a fill is allowed sparingly for a simple shadow shape (flat, no gradient).
- **Faces** on animals, creatures and people: two round ink eyes with a small white highlight dot, a small smile,
  optional pink cheeks. Wrap the eyes in `<g class="a-blink o-c">...</g>` so they blink.
- Shiny highlight: one or two short white `stroke-width="4"` curved lines or a small white ellipse (opacity 0.7).

## Forbidden

`<text>` or any letters or numbers (the artist is not allowed to write words), `id`, `<defs>`, gradients, filters,
masks, `<style>`, `<script>`, `<image>`, `<use>`, external references, emoji characters, `viewBox` or `<svg>` tags
(the wrapper adds them). Every shape must be visible with no CSS applied (the preview renders statically).

## Animation (required)

A wrapper already pops the whole drawing in and wiggles it, so **do not animate the whole thing**. Instead, give
**one to three parts** their own motion by adding classes to a `<g>` or shape. Pick an animation class and a pivot class.

Animation classes: `a-wiggle` (rock), `a-sway` (slow rock, plants or hanging things), `a-wag` (fast rock, tails),
`a-wave` (rock, arms and hands), `a-flap` (wings and ears), `a-bob` (up and down), `a-bounce` (squash and hop),
`a-blink` (eyes), `a-pulse` (grow and shrink), `a-spin` (slow turn), `a-spin-fast`, `a-float` (drift),
`a-twinkle` (sparkle on and off), `a-drip` (falls and fades), `a-shake` (tiny jitter), `a-puff` (rises and fades,
steam and smoke), `a-slide` (side to side).

Pivot classes (where it rotates or scales from, relative to that element's own box): `o-c` center, `o-t` top,
`o-b` bottom, `o-l` left, `o-r` right, `o-tl`, `o-tr`, `o-bl`, `o-br`. For example, a tail is
`class="a-wag o-l"` (pivot at its left end, which should be where it attaches to the body); a wing is `a-flap o-bl`
or `o-br`. Add `d1`..`d4` to offset timing of repeated parts.

Rotating or translating classes only move the element's own box, so group the part you want to move into one `<g>`.

## Verify your work (do this)

Rendering uses macOS Quick Look. Build a contact sheet SVG with every drawing in a 4-column grid (each in its own
`<svg viewBox="0 0 120 120" width="240" height="240">` on a light `#c6ecff` background, with a text label under each
that exists ONLY in the preview, not in your file), then:

```sh
qlmanage -t -s 2000 -o <outdir> <sheet>.svg    # writes <sheet>.svg.png
```

Read the PNG, check each drawing is recognizable, centered, clean, and consistent with the others, fix problems and
re-render. Do at least one review round. Keep scripts and previews in your own folder under
a temporary folder outside the project, and never put them in the project.
Finish by checking the TypeScript compiles: run `npx tsc --noEmit` from the project root.

Only write your own `src/art/<file>.ts`. Do not touch any other file.
