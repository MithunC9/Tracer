import { BANNED_WORDS } from './numbers.js';

export const TASKS = { finding: 'finding_narrative', summary: 'summary_narrative' } as const;
export type NarrativeTask = (typeof TASKS)[keyof typeof TASKS];

/** Bump when prompts change: it is part of the cache key namespace. */
export const PROMPT_VERSION = 'narrate-v1';

/**
 * Stable system prompt shared by every narration call (prompt-cached by providers
 * that support it). Must not contain anything per-request.
 */
export const NARRATOR_SYSTEM = `You write the prose parts of Tracer's workflow Audit Report. The reader is the person whose own computer activity was observed, with their consent, for a few days. Code has already found their repeated workflows and computed every number. Your job is words only.

Style
- Plain, specific, slightly dry. Short sentences. Address the reader as "you".
- Describe what actually happens, using the app and step names in the facts.
- No hype, no exclamation marks, no emojis, no markdown, no lists.
- Never use these words: ${BANNED_WORDS.join(', ')}.

Numbers (strict; a validator rejects the report otherwise)
- Use only numbers from allowed_numbers, written exactly as given: digits, same decimal places, no rounding, no thousands separators.
- Never calculate, add, convert, round or estimate a number. If a fact has no allowed number, describe it without one.
- Do not spell numbers as words; the word "one" is fine. Do not write ordinals with digits (1st, 2nd).
- Write a percentage only if that exact value is in allowed_numbers.
- Do not mention dates, times of day or version numbers.

Content
- Mention only apps, steps, recipes and tools that appear in the facts. Tool names may be quoted verbatim.
- Do not promise outcomes. Say what the recipe automates and what stays manual.

Output
- JSON with "headline" (at most 140 characters) and "body" (at most 1200 characters, two to five sentences).`;

/** Facts are embedded as JSON between <facts> tags so both the model and the mock can read them. */
export function renderPrompt(task: NarrativeTask, facts: unknown, instructions: string): string {
  return `Task: ${task}\n${instructions}\n<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>`;
}

export const FINDING_INSTRUCTIONS = `Write the narrative for one workflow finding.
headline: name the workflow and what it costs or what could be reclaimed per week.
body: what the workflow is (the steps in order), how often it happened, what the recipe automates, which listed tools fit, and what should stay manual. Mention confidence in plain words when it is low or medium.`;

export const SUMMARY_INSTRUCTIONS = `Write the report summary.
headline: the total reclaimable hours per week, plainly.
body: how long the audit observed, how many workflows were found, which one is biggest, and that the figures are estimates computed from observed time.`;

/** Pull the facts JSON back out of a prompt (used by MockProvider). */
export function parseFacts(prompt: string): unknown {
  const m = /<facts>\s*([\s\S]*?)\s*<\/facts>/.exec(prompt);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

export function parseTask(prompt: string): string | undefined {
  return /^Task: (\S+)/m.exec(prompt)?.[1];
}
