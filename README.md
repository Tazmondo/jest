# Disclosure

Mostly AI-written (GPT-5.6-sol), but it works as a stop-gap until we get official jest-roblox on wally.

# Jest Roblox for Pesde

[![Validate](https://github.com/Tazmondo/jest/actions/workflows/validate.yml/badge.svg)](https://github.com/Tazmondo/jest/actions/workflows/validate.yml)

An unofficial [Pesde](https://pesde.dev/) distribution of
[Roblox Jest](https://github.com/Roblox/jest-roblox) 3.19.0.

This repository vendors the generated package tree so consumers do not need
Rotriever. It is based on Roblox Jest commit
[`42f02fd`](https://github.com/Roblox/jest-roblox/commit/42f02fdcc9fe7c420ba494242e83477373be830c)
and continues the packaging work started by
[`paralov/jest`](https://github.com/paralov/jest).

This project is not an official Roblox distribution and is not affiliated
with or endorsed by Roblox Corporation.

## Installation

Until a registry release is available, pin the repository to a commit:

```toml
[dev_dependencies]
Jest = { repo = "Tazmondo/jest", rev = "<commit SHA>" }
```

The dependency alias determines the generated linker name. The example above
creates a `Jest` module in the consumer's Pesde packages directory.

## Usage

The package root exposes the standard `Jest` runner and a
test-environment-aware accessor for `JestGlobals`:

```luau
local Jest = require(ReplicatedStorage.vendor.Jest)
local JestGlobals = Jest.getJestGlobals()

local describe = JestGlobals.describe
local expect = JestGlobals.expect
local it = JestGlobals.it
```

`getJestGlobals()` resolves the globals through the calling Jest sandbox so
they are bound to the active test environment.

## Distribution scope

The runtime distribution contains all 441 source files from Roblox Jest
3.19.0. All production dependencies and exported type forwards are generated
from the upstream Rotriever manifests.

There are three intentional packaging differences:

- `Packages/init.luau` combines the `Jest` entry point with
  `getJestGlobals()`.
- Jest's string resolver accepts Pesde-generated `./../package` links.
- Five React-related development dependencies used only by upstream's
  internal PrettyFormat and RobloxShared tests are not vendored.

The omitted development dependencies do not participate in the packaged
runtime. This repository's smoke suite and consumer integration tests cover
the supported distribution boundary.

## Development

Install the tools declared in `mise.toml`, then build the model:

```sh
mise install
mise x -c "pesde install"
mise x -c "rojo build default.project.json --output .jest-roblox/JestRoblox.rbxm"
```

To reproduce the generated tree, check out the pinned upstream commit in a
sibling directory and run:

```sh
mise x -c "node scripts/sync-jest-roblox.mjs ../jest-roblox"
```

The sync script copies upstream source, rebuilds dependency links and exported
type forwards, removes obsolete packages, and applies the documented Pesde
path compatibility patch.
