# Miharbor

Visual editor for mihomo (Clash-compatible proxy) configs. Bun + Elysia + Vue 3 + TypeScript monorepo.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design and implementation plans.

## Development

```bash
bun install
bun run web:dev      # Vite dev server on :5173
bun run server:dev   # Elysia server on :3000
bun run typecheck
bun run lint
bun test
```

## License

MIT — see [LICENSE](./LICENSE).
