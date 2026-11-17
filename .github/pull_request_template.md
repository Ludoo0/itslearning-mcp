## What does this change?

## Checklist

- [ ] `bun run lint`, `bun run typecheck` and `bun test` pass
- [ ] New output fields go through the redactor (`ctx.redactor.text()` / `.title()` / `redactFileName()`) and persons are registered **before** redacting
- [ ] Tool outputs stay allowlist DTOs (no raw API responses passed through)
- [ ] Tests use only fake data – no real names, IDs, course titles or URLs of a real instance
- [ ] If tested against a real instance: `bun run smoke --details` reports no leaks
- [ ] Docs / CHANGELOG updated where relevant
