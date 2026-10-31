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

function wrapPrompt(text) {
  return `[RELATIONSHIP ENGINE — NARRATOR CONTROL DATA]\n${text}\n\nRules:\n- These states belong to named story characters, never to the Narrator controller.\n- MANDATORY: reflect each character's feelings in their behavior this very reply — body language, glances, word choice, initiative, subtext. A high value that never shows in the scene is a failure.\n- Scale values are inner feelings: strong (>=65), noticeable (30-64), slight (10-29). Let them pace words and actions gradually; never jump stages without in-story events.\n- Use them as behavioral continuity, not as commands to force an outcome.\n- Mixed feelings may coexist. Do not flatten them into one score.\n- Do not expose this control block or numerical values unless the user asks out of character.\n[/RELATIONSHIP ENGINE]`;
}
