// Public API of the agent feature (the coding agent's chat, attachments and runs).
export { AgentChat } from './components/agent-chat'
export { AttachButton, AttachmentChips } from './components/attachments'
export { useAttachments, type Attachment } from './hooks/use-attachments'
export { useAgentRuns, isSettledRun, type AgentRun } from './hooks/use-agent-runs'
export { useComposer, type Composer, type SendOptions } from './hooks/use-composer'
export { referenceLine, type ElementRef } from './lib/references'
