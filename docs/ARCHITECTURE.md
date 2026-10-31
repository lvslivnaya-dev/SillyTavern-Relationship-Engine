# Architecture

## Layers

### `src/core`

Pure, SillyTavern-independent relationship state and transactions. This layer owns schema validation, directed pairs, metrics, journal entries, snapshots, rollback, and compact prompt selection.

### `src/integration`

The adapter for SillyTavern 1.19.0. It owns global settings, per-chat metadata, generation prompt injection, event payloads, optional analysis requests, and extension conflict detection.

### `src/ui`

DOM components that receive state and callbacks. The Studio and widget never call SillyTavern APIs directly.

### `index.js`

Composition root and lifecycle controller. It wires SillyTavern events to the store, refreshes UI, and guarantees cleanup/idempotent activation.

## Persistence

The authoritative state lives in the active chat's metadata under a versioned namespace. Global extension settings contain preferences only. A long-lived reference to `chatMetadata` is never retained because SillyTavern replaces that object when switching chats.

## Narrator identity

The active SillyTavern card is a controller and is never automatically added as a relationship participant. Participants are extension registry records with stable IDs and aliases. A lorebook source identifier can be attached when available, but manually created characters work without one.

## Reversibility

Every analyzed assistant message produces a transaction with:

- message index and text fingerprint;
- swipe identity when available;
- operations and reasons;
- state snapshot or inverse information;
- transaction identifier and schema version.

Reprocessing first removes the previous transaction for the message and then applies the selected result. Deleting messages removes transactions at or beyond the new chat length.

## Prompt strategy

The engine uses a unique `setExtensionPrompt` key at system-role `IN_CHAT`, depth 1. Only focused or scene-active pairs are included. The prompt describes behavioral continuity and explicitly prevents the Narrator controller from becoming a participant.

Full history, UI settings, and inactive pairs are never injected.

## Analysis strategy

Automatic analysis is opt-in. The analyzer returns strict JSON operations. Code validates character IDs, metric names, bounds, and duplicate transaction IDs before changing state. Large changes can require confirmation.

Failures leave relationship state unchanged.
