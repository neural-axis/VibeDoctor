# Contributing

Thanks for helping improve VibeDoctor.

## Development

```bash
npm ci
npm run check
```

Use `npm run dev -- <command>` to run the CLI from source, for example:

```bash
npm run dev -- scan --quick
```

## Before opening a pull request

- Keep changes focused and covered by tests.
- Run `npm run check`.
- Update README or command help when user-facing behavior changes.
- Do not commit generated `dist/`, `.vibedoctor` reports, coverage output, or dependency folders.

## Release packaging

`npm pack` runs `npm run build` through the `prepack` script and packages the compiled `dist/` output.

Contributions are accepted under the project license, GPL-3.0-or-later.