# Contributing to opencode-failover

## Development setup

```bash
git clone https://github.com/bulutmuf/opencode-failover.git
cd opencode-failover
bun install
```

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- Node.js >= 18 (for type definitions)

### Commands

```bash
bun test              # Run all tests
bun run typecheck     # Type-check without emitting
bun install           # Install dependencies
```

## Code style

- **No comments** unless explaining complex business logic or algorithmic
  choices. Code should be self-documenting.
- **Functional style**: prefer `const`, `map`, `filter`, `reduce` over
  mutable loops.
- **Table-driven tests**: all new logic gets table-driven tests in
  `*.test.ts` files.
- **No premature abstraction**: inline logic at the call site unless it
  is reused or has a clear independent name.
- **TypeScript strict mode**: no `any` types, explicit return types on
  exports.

## Commit format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): summary
```

### Types

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Maintenance (deps, CI, config) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |

### Scopes

| Scope | Use for |
|---|---|
| `config` | Configuration parsing (`src/config.ts`) |
| `state` | Key pool logic (`src/state.ts`) |
| `classify` | Error classification (`src/classify.ts`) |
| `hooks` | Plugin hook wiring (`src/index.ts` chat.headers, event) |
| `tool` | `keychain.status` tool |
| `ci` | GitHub Actions workflows |
| (none) | Cross-cutting changes |

### Examples

```
feat(config): add env var fallback for provider keys
fix(classify): handle missing statusCode gracefully
test(state): add edge case for all-keys-disabled scenario
docs: update troubleshooting guide
chore: bump @opencode-ai/plugin to 1.17.14
```

## Testing

### Writing tests

All new logic gets a `*.test.ts` file adjacent to the source:

```
src/state.ts       → src/state.test.ts
src/classify.ts    → src/classify.test.ts
```

Tests are table-driven:

```typescript
import { describe, it, expect } from "bun:test"
import { classify, ErrorAction } from "./classify.ts"

describe("classify", () => {
  it.each([
    { name: "429 rotates", input: { statusCode: 429 }, expected: ErrorAction.Rotate },
    { name: "401 disables", input: { statusCode: 401 }, expected: ErrorAction.Disable },
  ])("$name", ({ input, expected }) => {
    expect(classify(input).action).toBe(expected)
  })
})
```

### Running tests

```bash
bun test                    # All tests
bun test src/state.test.ts  # Single file
```

### Test requirements

- Cover positive, negative, and edge cases.
- Use `bun:test` (not Jest or Vitest).
- No mocks — test actual implementation.
- 33+ expect() calls across the suite (current baseline).

## Pull request flow

1. Fork or create a branch from `main`.
2. Make changes with atomic commits (one logical change per commit).
3. Run `bun test` and `bun run typecheck` — both must pass.
4. Open a PR with a clear description of what changed and why.
5. PR titles follow the same conventional commit format.

## Architecture decisions

Documented in `documents/`. If your change affects a previously decided
architecture:

1. Update the relevant ADR file.
2. Add a note to the changelog if user-facing.
3. Reference the ADR in your PR description.

## License

By contributing, you agree that your contributions will be licensed under
the MIT License.
