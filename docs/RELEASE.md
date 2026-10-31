# Release checklist

1. Create a public GitHub repository for this directory.
2. Replace the manifest placeholder policy by adding the final repository URL as `homePage`.
3. Set `auto_update` to `true` only after the repository URL is stable.
4. Run `npm run check`.
5. Run `npm run pack:zip` and inspect the archive root for `manifest.json`.
6. Install the repository URL through SillyTavern's extension manager.
7. Complete `docs/MANUAL-TESTS.md` on the current release build of SillyTavern.
8. Tag the commit with the same version found in `manifest.json` and `package.json`.
9. Attach `dist/SillyTavern-Relationship-Engine.zip` to the GitHub release.

Do not commit user chat metadata, API credentials, local SillyTavern settings, or generated relationship exports.
