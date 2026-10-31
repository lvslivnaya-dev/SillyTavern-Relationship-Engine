# Manual test checklist

## Loading

- Extension loads on SillyTavern 1.19.0 without console errors.
- Settings drawer and wand-menu entry appear once after reload.
- Reloading or reactivating does not duplicate UI or event handlers.

## Narrator workflow

- Create two story characters without adding the active Narrator card.
- Select a directed pair and edit its metrics.
- Confirm reversing the pair shows independent values.
- Generate a reply and confirm the compact runtime prompt mentions only the selected story characters.

## Chat boundaries

- Switch chats and confirm each chat has independent relationship state.
- Rename a chat and confirm state remains attached.
- Branch a chat and verify inherited metadata can be edited independently.

## Message lifecycle

- Analyze an assistant message once; duplicate event handling must not double-apply it.
- Swipe the message; old changes are removed before new changes apply.
- Edit the message; old transaction is replaced.
- Delete the message; its transaction is rolled back.
- Delete several messages; all transactions beyond the new chat length are removed.

## UI

- Studio fits desktop and mobile widths.
- Keyboard focus stays usable and all icon buttons have labels.
- Widget drags by pointer and remains inside the viewport after resize.
- Widget position, opacity, and collapsed state survive reload.
- Import rejects malformed JSON without replacing current state.
- Export downloads a readable JSON file.

## Compatibility

- Activating Love Score displays a warning.
- Relationship Engine never disables or modifies Love Score automatically.
- Turning prompt injection off removes the extension prompt.
- Turning automatic analysis off prevents background API calls.
