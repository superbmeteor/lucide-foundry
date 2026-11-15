# lucide-pen

[Lucide](https://lucide.dev) icons as [pen.dev](https://pen.dev) component libraries for Pen files to import:

- `dist/lucide.lib.pen`: Lucide's icons, from `lucide-static`.
- `dist/lucide-lab.lib.pen`: Lucide's [lab](https://github.com/lucide-icons/lucide-lab) icons, from `@lucide/lab`. These are icons with unknown use cases that Lucide keeps out of its main set. Lab and Lucide reuse some names for different drawings, so lab is a library of its own.

Each icon is a reusable 24 × 24 `path` component whose id is its Lucide name (`activity`, `circle-exclamation-point`), filled with the library's `icon` colour variable (black). Recolour an icon by overriding its instance's fill. The icons are filled outlines of Lucide's 2-pt strokes, so their weight scales with their size. A Pen path keeps its stroke width in points, so a stroked icon would look lighter as it grows.

**Status: experiment.** Version 0.2.0 holds Lucide 1.73.0's 2,055 icons, plus 34 aliases for ids Lucide has renamed since 1.48.0, and lab 0.13.0's 357 icons.

## Using it

The package isn't published to a registry, so install it from GitHub, pinned to a release tag (or a commit):

```sh
bun add -d github:superbmeteor/lucide-pen#v0.2.0   # or: npm install -D github:superbmeteor/lucide-pen#v0.2.0
```

Then link your Pen files to the libraries. The CLI is plain JavaScript, so it runs with `npx`, `bunx` or `pnpm exec` (Node 22 or later, or Bun):

```sh
npx lucide-pen link designs/my-design.pen   # or a directory: every .pen file in it
```

`link` adds two imports to each file, with paths relative to the file, to the copy of the package in the nearest `node_modules` above it:

```json
"imports": {
  "lucide": "../../node_modules/@superbmeteor/lucide-pen/dist/lucide.lib.pen",
  "lucide-lab": "../../node_modules/@superbmeteor/lucide-pen/dist/lucide-lab.lib.pen"
}
```

Refer to an icon as `lucide:<lucide-name>` or `lucide-lab:<lab-name>`, and to the colour variable as `$lucide:icon`. The aliases are the importing file's choice: `--lucide` and `--lab` pick others for new imports. If a file already uses an alias for some other library, `link` leaves that file as it is, says so and exits 1, and links the rest; pick another alias for it. A library a file already imports keeps its alias, since every instance names it, and `link` only corrects its path; run it again after moving a file. Pen reads imports only when it opens a file, so reopen linked files, and reopen importing files after upgrading the package.

When Pen can't find an imported library, it silently turns the library's instances into local copies. `npx lucide-pen link --check designs` changes nothing and exits 1 if any file would change, so it can guard CI or a pre-commit hook against broken paths.

Pen's components panel lists every imported library's components in one list, sorted by name. So that ours stay together, they're named by group: `Lucide / activity`, `Lucide Aliases / circle-alert`, `Lucide Lab / burger`. Names are only labels; instances refer to the permanent ids, so names can change between releases without breaking anything.

To see which release a file is using, place an instance of a library's About component, which is first in its group: `Lucide` (id `lucide:About`) or `Lucide Lab` (id `lucide-lab:About`). It shows the lucide-pen version, the Lucide package and version with the date npm published it, and how many icons and aliases the library holds, and it updates when the library does.

[`examples/sample.pen`](examples/sample.pen) imports both libraries from this repository and shows core and lab icons, renamed ids drawn through their aliases, the two different `layout-grid-plus` icons, one icon from 16 to 96 points, and colour overrides. Pen named its imports `n` (core) and `4` (lab) there, when they were added in Pen's UI; `bun run check` checks that they're linked.

## Rules

- **Ids are permanent.** An id that has appeared in a release stays in every later release of its library and keeps drawing the icon it meant.
  - A renamed Lucide icon keeps its old name as an alias: a copy of the icon it was renamed to.
  - A lab icon that graduates into Lucide keeps its lab id as an alias of the Lucide icon of the same name.
  - An icon dropped with no successor is retired: it keeps the outline it last had.
- **Releases are never deleted or unpublished**, because a consumer's old commits pin them.

Each library has an ids file beside it in `dist/`, `lucide.ids.json` and `lucide-lab.ids.json`. It records the release the library was built from and the date npm published it, the aliases (old id → Lucide icon) and the retired ids. On the canvas, the `About` component comes first, then a white sheet with the release's icons in a grid, then, after a blank row, the aliases, then the retired ids.

`generate` asks the npm registry for a release's publish date the first time it builds that release, and keeps it in the ids file, so later runs, including `check`, work offline.

## Updating to new Lucide releases

The releases are the exact versions of the `lucide-static` and `@lucide/lab` dev dependencies. The generator needs only Bun, on any platform; [mise](https://mise.jdx.dev) installs the version in `mise.toml` (`mise install`), then `bun install` sets up the rest. Each script is also a mise task (`mise tasks` lists them; `mise run update`), which installs dependencies first.

```sh
bun run update
```

`update` moves each package to its next release on npm and runs `bun run generate`. The next release is the newest release in the package's current major version, or, if the package is already on the last release of that major, the newest release of the next major. If the version in `package.json` already has a release tag, `update` bumps its minor version. To pick versions yourself, run `bun add -d --exact lucide-static@<version> @lucide/lab@<version>` and then `bun run generate`.

`generate` rewrites everything in `dist/` and `LICENSE-LUCIDE`; never edit them by hand. For each library it lists the icons added, the icons redrawn, and the ids that have become aliases or been retired. Update the status line above and commit.

The `update` workflow (`.github/workflows/update.yml`) runs `update` every day and from the Actions tab. When there's a new release, it runs `bun run check` and opens a pull request from the `update-lucide` branch, or refreshes the one already open. The pull request lists what `generate` reported. If `generate` stops on an id conflict, the workflow run fails, and GitHub emails whoever last edited the schedule.

- Ids carry forward from the current libraries and ids files, so generate from the last release, not from a clean checkout of an older one.
- Lucide drops old aliases at major versions. To keep following renames, update to the last release of each major version before moving to the next.
- Update lab and Lucide together. When a lab icon graduates, its lab id becomes an alias only if the Lucide release being built already has the icon; otherwise the id is retired, and a retired id stays retired.
- If a release reuses an alias or retired id as the name of a new icon, `generate` stops rather than change what that id draws. Decide which icon the id should draw and edit the ids file to match.

`bun run check` checks the formatting (oxfmt; `bun run format` fixes it), lints (oxlint), type-checks the tools, runs their tests (`bun test`), regenerates everything in memory, failing if any generated file differs, and checks that the sample is linked. That catches hand edits and a dependency bump made without a regenerate. CI runs it on every push and pull request; `bun run hooks:install` sets up lefthook to run it before each commit.

### How the outlines are made

`tools/generate.ts` reads each package's `icon-nodes.json`, and Skia (`canvaskit-wasm`, pinned like the icon packages) strokes each SVG element 2 wide with round caps and joins. The strokes become the icon's path, with Skia's quadratic and conic curves written as cubics. They overlap where elements meet, which draws correctly under the nonzero fill rule. Skia can merge them into one shape, but its path operations fail on some icons and fill in holes on others, so the generator doesn't.

The only parts Lucide fills are dots of radius 1 or less, which the stroke already covers; the generator stops if a release fills anything larger. Lucide's renames come from `lucide-static`'s exports, which list every alias for each icon.

## Licence

The icon data is Lucide's, under the ISC licence, with some icons from Feather under the MIT licence; see `LICENSE-LUCIDE`, which covers both `lucide-static` and `@lucide/lab` (the generator stops if their licences ever differ). This repository's own code is under the MIT licence; see `LICENSE`.
