const string = { type: 'string' };
const number = { type: 'number' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name, description, properties, required) => ({ name, description, inputSchema: object(properties, required) });
export const PROVIDERS = ['claude', 'codex', 'dsh', 'opencode'];
export const MANAGER_TOOLS = [
  tool('start_worker', 'Start one standalone worker task for concrete executable work or repository exploration/research requested by the user. Use kind=explore for read-only investigation, toolchain and test discovery. Mission Control does not auto-chain pipelines; when this worker finishes, inspect its result and manager notes, then decide the next worker. Use input_worker_id to continue from a completed worker commit.', {
    title: string, prompt: string, requirement: string, provider: { enum: PROVIDERS }, model: string, effort: string,
    kind: { enum: ['implement', 'review', 'integrate', 'explore'] }, request_id: string, input_worker_id: string,
    notes: { type: 'array', maxItems: 20, items: string }
  }, ['title', 'prompt']),
  tool('update_worker_notes', 'Replace the manager-only notes attached to a worker. Notes are returned in the worker completion callback and are not sent to the worker.', {
    worker_id: string, notes: { type: 'array', maxItems: 20, items: string }
  }, ['worker_id', 'notes']),
  tool('archive_worker', 'Archive a stopped worker only after the user explicitly confirms that the task is complete and should not be resumed. Archived workers remain read-only evidence.', {
    worker_id: string, reason: string
  }, ['worker_id']),
  tool('remember_manager_guidance', 'Append a durable user-requested habit, work standard or workflow to the manager AGENTS.md memory. Use only when the user asks you to remember it. This does not modify project files.', { text: string }, ['text']),
  tool('inspect', 'Read current Mission Control state, workers, manager notes and recent events, or details for an id.', { id: string }),
  tool('inspect_worker_history', 'Read a page of worker event history when a completion summary is insufficient. Works for active and archived workers; archived history is read-only evidence. Use before_seq for older pages.', {
    worker_id: string, before_seq: number, limit: number, types: { type: 'array', items: string }
  }, ['worker_id']),
  tool('use_skill', 'Load the full instructions of an installed skill by name. Use when the user selects a skill with $name or asks to follow a skill.', { name: string }, ['name']),
  tool('send_worker_message', 'Send user input, workflow self-check instructions, or answers to a worker. Does not implicitly interrupt an active turn.', { worker_id: string, message: string }, ['worker_id', 'message']),
  tool('control_worker', 'Pause, resume, cancel, or retry a worker task.', { worker_id: string, action: { enum: ['pause', 'resume', 'cancel', 'retry'] }, reason: string }, ['worker_id', 'action']),
  tool('ask_user', 'Ask a requirement question with worker context. The question is displayed in the manager conversation.', { question: string, worker_id: string }, ['question']),
  tool('answer_worker_question', 'Respond to a native worker question after obtaining the necessary user decision.', { question_id: string, answer: string }, ['question_id', 'answer'])
];
export const WORKER_TOOLS = [
  tool('report_progress', 'Report meaningful progress. The manager is notified and may inspect your status.', { summary: string }, ['summary']),
  tool('report_result', 'Report an explicit task outcome. For implementation success, commit output first. Explore workers are read-only and report findings without committing. Review failure requires evidence; do not fix implementation during review. Mission Control notifies the manager after the native turn finishes.', {
    status: { enum: ['succeeded', 'review_failed', 'blocked_technical', 'blocked_requirements'] }, summary: string, evidence: string
  }, ['status', 'summary']),
  tool('inspect', 'Inspect your assignment, task state and manager-visible status.', {}),
  tool('use_skill', 'Load the full instructions of an installed skill by name when the task references $name or requires that skill.', { name: string }, ['name'])
];

export function validate(schema, value, name = 'arguments') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(name + ': invalid value');
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name + ': expected object');
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(name + ': missing ' + key);
    for (const [key, val] of Object.entries(value)) {
      if (!schema.properties[key]) { if (schema.additionalProperties === false) throw new Error(name + ': unknown ' + key); }
      else validate(schema.properties[key], val, name + '.' + key);
    }
  }
  if (schema.type === 'string' && (typeof value !== 'string' || value.length > 100_000)) throw new Error(name + ': expected string up to 100000 characters');
  if (schema.type === 'integer' && (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum)) throw new Error(name + ': integer out of range');
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) throw new Error(name + ': invalid array');
    value.forEach((v, i) => validate(schema.items, v, `${name}[${i}]`));
  }
}
