# lucide-pen

[Lucide](https://lucide.dev) icons as a [pen.dev](https://pen.dev) component library, `lucide.lib.pen`, for Pen files to import.

Each icon is a reusable 24 × 24 `path` component whose id is its Lucide name (`activity`, `circle-alert`), filled with the library's `doc-text` colour variable. The icons are filled outlines of Lucide's 2-pt strokes, so their weight scales with their size. A Pen path keeps its stroke width in points, so a stroked icon would look lighter as it grows.

**Status: experiment.** Version 0.1.0 holds Lucide 1.48.0's 1,854 icons, outlined by `reference/lucide-outline-1.48.py`. The sync from Lucide's repository, with permanent ids, aliases for renamed icons and the lab set, is still to be built.

## Using it

Install the package with Bun (or npm), then import the library from a Pen file with a path relative to that file:

```json
"imports": { "f": "../../node_modules/@superbmeteor/lucide-pen/lucide.lib.pen" }
```

Refer to an icon as `f:<lucide-name>`. Pen reads libraries only when a file opens, so reopen importing files after upgrading the package.

## Rules

- **Ids are permanent.** An id that has appeared in a release stays in every later release and keeps drawing the icon it meant. A renamed icon keeps its old name as an alias.
- **Releases are never deleted or unpublished**, because a consumer's old commits pin them.

## Licence

The icon data is Lucide's, under the ISC licence, with some icons from Feather under the MIT licence; see `LICENSE-LUCIDE`. The licence for this repository's own code is still to be chosen.
