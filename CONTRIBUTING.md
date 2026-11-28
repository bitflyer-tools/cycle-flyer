# Contributing

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). For an overview of the
Electron shell and Cycle.js renderer, see [Architecture](docs/architecture.md).

## Set up the development environment

Fork the repository, clone your fork, and create a branch from `master`. Use
Node.js 24, which CI also uses. From the repository root, run:

```sh
npm ci
npm run start:electron
```

To work on the renderer in a browser, run `npm start` and open the local URL
printed by the dev server. It rebuilds the renderer when source files change.
Use the Electron app to verify desktop behavior such as saving API credentials.

The Electron main-process inspector is disabled by default. To enable it for a
debugging session, run:

```sh
npm run start:electron -- --inspect-electron
```

See the [Electron Forge debugging guide](https://www.electronforge.io/advanced/debugging)
for how to attach a debugger.

## Run the checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage
npm run build
```

Run `npm run format -- --write` to format GitHub Actions and Dependabot YAML
and the hand-written JSON configuration files.

For packaging changes, run `npm run make` to build installers or archives for
your platform under `out/make/`.

## Open a pull request

Push your branch to your fork and open a pull request against
`bitflyer-tools/cycle-flyer:master`. Explain what changed, why it changed, and
how you verified it. Link the related issue if there is one.
