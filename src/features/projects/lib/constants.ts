/** Prompt length limits (the max matches the `projects.prompt` check constraint). */
export const PROMPT_MIN_LENGTH = 2
export const PROMPT_MAX_LENGTH = 4000

/**
 * Composer modes (stored in `projects.mode`): in "build" the agent edits the project; in "chat"
 * it can only read it (the server gives it read-only tools).
 */
export const PROJECT_MODES = ['build', 'chat'] as const
export type ProjectMode = (typeof PROJECT_MODES)[number]
