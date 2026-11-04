// Native protocol probe. Creates an ephemeral thread; never starts a model turn.
import { StdioRpc } from '../src/adapters/rpc.js';
import { MANAGER_TOOLS } from '../src/core/tools.js';
const rpc = new StdioRpc(process.env.LO_CODEX_COMMAND ?? 'codex', ['app-server', '--stdio'], { cwd: process.cwd() }, async method => { throw new Error('Unexpected request: ' + method); }, () => {});
try {
  const initialized = await rpc.request('initialize', { clientInfo: { name: 'last-order_probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  rpc.notify('initialized', {});
  await rpc.request('thread/start', { cwd: process.cwd(), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', developerInstructions: 'Protocol probe only. No model turn will be started.', dynamicTools: MANAGER_TOOLS.map(tool => ({ type: 'function', ...tool })) });
  const worker = await rpc.request('thread/start', { cwd: process.cwd(), ephemeral: true, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', developerInstructions: 'Protocol probe only. No model turn will be started.' });
  if (worker.approvalsReviewer !== 'auto_review') throw new Error('Codex did not enable auto_review: ' + worker.approvalsReviewer);
  console.log(JSON.stringify({ nativeHandshake: true, ephemeralThreadWithScheduleTools: true, workerApprovalsReviewer: worker.approvalsReviewer, modelTurnsStarted: 0, userAgent: initialized.userAgent }));
} finally { await rpc.stop(); }
