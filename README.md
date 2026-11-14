# lucide-pen

[Lucide](https://lucide.dev) icons as [pen.dev](https://pen.dev) component libraries for Pen files to import:

- `dist/lucide.lib.pen`: Lucide's icons, from `lucide-static`.
- `dist/lucide-lab.lib.pen`: Lucide's [lab](https://github.com/lucide-icons/lucide-lab) icons, from `@lucide/lab`. These are icons with unknown use cases that Lucide keeps out of its main set. Lab and Lucide reuse some names for different drawings, so lab is a library of its own.

Each icon is a reusable 24 × 24 `path` component whose id is its Lucide name (`activity`, `circle-exclamation-point`), filled with the library's `icon` colour variable (black). Recolour an icon by overriding its instance's fill. The icons are filled outlines of Lucide's 2-pt strokes, so their weight scales with their size. A Pen path keeps its stroke width in points, so a stroked icon would look lighter as it grows.

**Status: experiment.** Version 0.2.0 holds Lucide 1.73.0's 2,055 icons, plus 34 aliases for ids Lucide has renamed since 1.48.0, and lab 0.13.0's 357 icons.

## Using it

The package isn't published to a registry, so install it from GitHub, pinned to a release tag (or a commit):

```sh
bun add github:superbmeteor/lucide-pen#v0.2.0
```

Then import the libraries from a Pen file with paths relative to that file:

```json
"imports": {
  "f": "../../node_modules/@superbmeteor/lucide-pen/dist/lucide.lib.pen",
  "lab": "../../node_modules/@superbmeteor/lucide-pen/dist/lucide-lab.lib.pen"
}
```

Refer to an icon as `f:<lucide-name>` or `lab:<lab-name>`. Pen reads libraries only when a file opens, so reopen importing files after upgrading the package.

[`examples/sample.pen`](examples/sample.pen) imports both libraries from this repository and shows core and lab icons, renamed ids drawn through their aliases, the two different `layout-grid-plus` icons, one icon from 16 to 96 points, and colour overrides. Pen named its imports `n` (core) and `4` (lab) there; an alias is whatever the importing file chooses.

## Rules

- **Ids are permanent.** An id that has appeared in a release stays in every later release of its library and keeps drawing the icon it meant.
  - A renamed Lucide icon keeps its old name as an alias: a copy of the icon it was renamed to.
  - A lab icon that graduates into Lucide keeps its lab id as an alias of the Lucide icon of the same name.
  - An icon dropped with no successor is retired: it keeps the outline it last had.
- **Releases are never deleted or unpublished**, because a consumer's old commits pin them.

Each library has an ids file beside it in `dist/`, `lucide.ids.json` and `lucide-lab.ids.json`. It records the release the library was built from, the aliases (old id → Lucide icon) and the retired ids. On the canvas, the release's icons come first in a grid, then, after a blank row, the aliases, then the retired ids.

## Updating to new Lucide releases

The releases are the exact versions of the `lucide-static` and `@lucide/lab` dev dependencies. The generator needs only Bun, on any platform; [mise](https://mise.jdx.dev) installs the version in `mise.toml` (`mise install`), then `bun install` sets up the rest.

```sh
bun add -d --exact lucide-static@latest @lucide/lab@latest   # or specific versions
bun run generate
```

`generate` rewrites everything in `dist/` and `LICENSE-LUCIDE`; never edit them by hand. For each library it lists the icons added, the icons redrawn, and the ids that have become aliases or been retired. Bump `version` in `package.json`, update the status line above, and commit.

- Ids carry forward from the current libraries and ids files, so generate from the last release, not from a clean checkout of an older one.
- Lucide drops old aliases at major versions. To keep following renames, update to the last release of each major version before moving to the next.
- Update lab and Lucide together. When a lab icon graduates, its lab id becomes an alias only if the Lucide release being built already has the icon; otherwise the id is retired, and a retired id stays retired.
- If a release reuses an alias or retired id as the name of a new icon, `generate` stops rather than change what that id draws. Decide which icon the id should draw and edit the ids file to match.

`bun run check` type-checks the generator, runs its tests (`bun test`), and regenerates everything in memory, failing if any generated file differs. That catches hand edits and a dependency bump made without a regenerate.

### How the outlines are made

`tools/generate.ts` reads each package's `icon-nodes.json`, and Skia (`canvaskit-wasm`, pinned like the icon packages) strokes each SVG element 2 wide with round caps and joins. The strokes become the icon's path, with Skia's quadratic and conic curves written as cubics. They overlap where elements meet, which draws correctly under the nonzero fill rule. Skia can merge them into one shape, but its path operations fail on some icons and fill in holes on others, so the generator doesn't.

The only parts Lucide fills are dots of radius 1 or less, which the stroke already covers; the generator stops if a release fills anything larger. Lucide's renames come from `lucide-static`'s exports, which list every alias for each icon.

## Licence

The icon data is Lucide's, under the ISC licence, with some icons from Feather under the MIT licence; see `LICENSE-LUCIDE`, which covers both `lucide-static` and `@lucide/lab` (the generator stops if their licences ever differ). This repository's own code is under the MIT licence; see `LICENSE`.
