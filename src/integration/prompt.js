import { PROMPT_KEY } from './settings.js';

const POSITION_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

export function updateRelationshipPrompt(context, text, enabled = true) {
  try {
    const value = enabled && text ? wrapPrompt(text) : '';
    context.setExtensionPrompt(PROMPT_KEY, value, POSITION_IN_CHAT, 1, false, ROLE_SYSTEM);
  } catch (error) {
    console.error('[Relationship Engine] Failed to update runtime prompt.', error);
  }
}

export function clearRelationshipPrompt(context) {
  updateRelationshipPrompt(context, '', false);
}

// The rules deliberately avoid "show feelings every reply": that wording made
// models push warmth into every scene and soften conflicts.
export function wrapPrompt(text) {
  return `[RELATIONSHIP ENGINE — NARRATOR CONTROL DATA]\n${text}\n\nRules:\n- These states belong to named story characters, never to the Narrator controller.\n- Let each character's feelings colour their behaviour when they are present and it fits the scene — body language, word choice, initiative, subtext. Not every feeling has to surface in every reply.\n- Scale values are inner feelings: strong (>=65), noticeable (30-64), slight (10-29). Unlisted feelings are neutral. Low or absent warmth means distance or indifference, not hidden affection.\n- Negative feelings (fear, resentment, hostility, guilt, disapproval, distrust) matter exactly as much as warm ones. Do not soften, excuse or quickly resolve them, and do not turn conflict into closeness without in-story events.\n- Do not advance relationships on your own initiative: no confessions, reconciliations or sudden trust unless the story earns them. Never jump stages.\n- Use the states as behavioural continuity, not as commands to force an outcome. Mixed feelings may coexist; do not flatten them into one score.\n- headcanon lines are established facts about how a pair relates (habits, private jokes, unspoken rules). Treat them as true background and let them colour the scene when relevant; never recite them or force them in.\n- Do not expose this control block or numerical values unless the user asks out of character.\n[/RELATIONSHIP ENGINE]`;
}
