# Contributing

Relationship Engine uses dependency-free browser ES modules.

1. Fork and clone the repository.
2. Use Node.js 20 or newer.
3. Run `npm test` before submitting a change.
4. Keep SillyTavern-specific APIs inside `src/integration`.
5. Keep state transformations in `src/core` pure and covered by tests.
6. Do not store API keys or relationship histories in global settings.
7. Preserve rollback behavior for swipe, edit, delete, continue, and chat switching.

Bug reports should include the SillyTavern version, browser, relevant console error, and whether another relationship extension was enabled.
