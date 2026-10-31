# Движок отношений для SillyTavern

**[Подробное руководство пользователя на русском](docs/РУКОВОДСТВО.md)**

**Установка:** Extensions → Install extension → вставь URL:
`https://github.com/lvslivnaya-dev/SillyTavern-Relationship-Engine`

Directed relationship continuity for narrator-driven roleplay in **SillyTavern 1.19.0+**.

Relationship Engine tracks what one story character feels toward another. It does not treat the active Narrator card as a romantic participant and does not collapse mixed feelings into one love score.

## Current capabilities

- Multiple simultaneous romantic and non-romantic relationships.
- Directed pairs: `A → B` is independent from `B → A`.
- Affection, trust, respect, attraction, friendship, fear, resentment, hostility, jealousy, and dependency.
- Per-chat storage in SillyTavern chat metadata.
- Reversible message transactions for swipe, edit, and delete workflows.
- Compact runtime instructions injected before generation.
- Optional LLM scene analysis using the currently selected SillyTavern API.
- Large Relationship Studio and a movable compact widget.
- JSON import/export.
- Warning when Love Score appears to be active.

## Installation from GitHub

After this project is published, its repository URL can be pasted directly into SillyTavern. Set `homePage` in `manifest.json` to that URL and enable `auto_update` when the release repository is final.

1. Open **Extensions** in SillyTavern.
2. Choose **Install extension**.
3. Paste the repository URL.
4. Reload SillyTavern if requested.
5. Disable Love Score before enabling this relationship engine.

## Installation from a ZIP file

Extract the archive into either:

- `SillyTavern/data/<user>/extensions/relationship-engine` for one user; or
- `SillyTavern/public/scripts/extensions/third-party/relationship-engine` for all users.

The folder containing `manifest.json` must be the extension root.

## Development

Requires Node.js 20 or newer.

```text
npm test
npm run check
npm run pack:zip
```

The extension deliberately has no runtime or build dependencies. All source files are browser-native ES modules, so a cloned repository is directly installable by SillyTavern.

## Data model

- Global preferences: `extensionSettings.relationshipEngine`
- Current chat state: `chatMetadata["relationshipEngine.v1"]`
- Message transaction metadata: the engine's namespaced field in `message.extra`

Relationship histories are stored but only a compact selection is inserted into the generation prompt.

## Privacy and API use

The extension does not store API keys. Optional automatic analysis uses the API connection selected in SillyTavern. Scene text is sent to that provider only when automatic analysis is enabled or manual analysis is requested.

## Compatibility

Relationship Engine is designed for SillyTavern 1.19.0 and newer. Running it alongside another relationship state engine may produce contradictory instructions. Love Score is detected and reported, but never modified or disabled automatically.

## License

MIT
