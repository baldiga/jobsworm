## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How it was tested

<!-- Tests added, commands run, what you checked by hand. -->

## Checklist

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm --filter web build` pass
- [ ] Behaviour changes come with tests
- [ ] New env vars are in `.env.example`
- [ ] Migrations are new files, `revoke ... from public`, and enable RLS on new tables
- [ ] New sources: terms of use linked above, and they allow republishing
- [ ] No keys, tokens, or real people's personal data anywhere in the diff
