import { EventEmitter } from 'node:events';

export class MultiProjectService extends EventEmitter {
  constructor(projects, startClient) {
    super();
    this._projects = projects.map(project => ({ ...project, client: null, dataDirectory: null, configPath: null, error: null }));
    this.startClient = startClient;
    this.activeIndex = 0;
    this._closed = false;
    this.state = { workers: {}, pipelines: {}, requests: {}, notifications: [], manager: { pending: [] }, approvals: [], questions: [] };
    this.config = {};
  }

  get projects() {
    return this._projects.map((project, index) => ({
      code: project.code, name: project.name, root: project.root,
      active: index === this.activeIndex, connected: Boolean(project.client), error: project.error
    }));
  }

  get activeProject() { return this._projects[this.activeIndex]; }
  get client() { return this.activeProject?.client; }
  get project() { return this.activeProject; }
  get closed() { return this._closed; }
  get store() { return this.client?.store ?? { history: () => [] }; }
  get git() { return this.client?.git ?? { root: this.activeProject?.root ?? '' }; }
  get approvals() { return this.client?.approvals ?? new Map(); }
  get questions() { return this.client?.questions ?? new Map(); }
  snapshot() { return this.state; }

  async start() {
    const client = await this.ensureProject(this.activeIndex);
    this.state = client.state;
    this.config = client.config;
    return this;
  }

  findProject(selector) {
    if (typeof selector === 'number') return this._projects[selector];
    return this._projects.find(project => project.code.toLowerCase() === String(selector).toLowerCase());
  }

  async ensureProject(index) {
    const project = this._projects[index];
    if (!project) throw new Error('Unknown project');
    if (project.client) return project.client;
    try {
      const started = await this.startClient(project);
      project.client = started.client;
      project.dataDirectory = started.dataDirectory;
      project.configPath = started.configPath;
      project.error = null;
      project.client.on('change', payload => {
        if (this.activeProject === project) {
          this.state = project.client.state;
          this.config = project.client.config;
          this.emit('change', payload);
        }
        this.emit('projects', this.projects);
      });
      project.client.on('activity', payload => {
        if (this.activeProject === project) this.emit('activity', payload);
      });
      project.client.on('disconnect', error => {
        project.error = error.message;
        project.client = null;
        this.emit('projects', this.projects);
        if (this.activeProject === project) this.emit('disconnect', error);
      });
      return project.client;
    } catch (error) {
      project.error = error.message;
      this.emit('projects', this.projects);
      throw error;
    }
  }

  async switchProject(selector) {
    const project = this.findProject(selector);
    if (!project) throw new Error(`Unknown project: ${selector}`);
    const index = this._projects.indexOf(project);
    await this.ensureProject(index);
    this.activeIndex = index;
    this.state = project.client.state;
    this.config = project.client.config;
    this.emit('change', { type: 'project_switched', code: project.code, root: project.root });
    this.emit('projects', this.projects);
    return { code: project.code, root: project.root };
  }

  routeInput(text) {
    const match = /^-([A-Za-z]{1,2})(?:\s+([\s\S]*))?$/.exec(String(text ?? '').trim());
    if (!match) return { project: null, text };
    return { project: match[1], text: match[2] ?? '' };
  }

  async sendManagerMessage(text, interrupt = false, quotes = [], attachments = []) {
    const routed = this.routeInput(text);
    if (routed.project) {
      await this.switchProject(routed.project);
      text = routed.text;
      if (!text) return { project_switched: routed.project };
    }
    return (await this.ensureProject(this.activeIndex)).sendManagerMessage(text, interrupt, quotes, attachments);
  }

  async saveSettings(next) {
    const project = this.activeProject;
    const client = await this.ensureProject(this.activeIndex);
    return project.saveSettings ? project.saveSettings(next, project, client) : undefined;
  }

  async interruptManager() { return (await this.ensureProject(this.activeIndex)).interruptManager(); }
  async clearManagerMemory() { return (await this.ensureProject(this.activeIndex)).clearManagerMemory(); }
  async listSkills(actor, forceReload) { return (await this.ensureProject(this.activeIndex)).listSkills(actor, forceReload); }
  async createCheckpoint(label) { return (await this.ensureProject(this.activeIndex)).createCheckpoint(label); }
  async listCheckpoints() { return (await this.ensureProject(this.activeIndex)).listCheckpoints(); }
  async conversationTurns(actor, limit) { return (await this.ensureProject(this.activeIndex)).conversationTurns(actor, limit); }
  async conversationEvent(actor, seq) { return (await this.ensureProject(this.activeIndex)).conversationEvent(actor, seq); }
  async forkConversation(actor, options) { return (await this.ensureProject(this.activeIndex)).forkConversation(actor, options); }
  async revertConversation(actor, beforeTurnId) { return (await this.ensureProject(this.activeIndex)).revertConversation(actor, beforeTurnId); }
  async restoreCheckpoint(id, options) { return (await this.ensureProject(this.activeIndex)).restoreCheckpoint(id, options); }
  async archiveWorker(workerId, reason) { return (await this.ensureProject(this.activeIndex)).archiveWorker(workerId, reason); }
  async sendWorkerMessage(workerId, message) { return (await this.ensureProject(this.activeIndex)).sendWorkerMessage(workerId, message); }
  async controlWorker(workerId, action, reason) { return (await this.ensureProject(this.activeIndex)).controlWorker(workerId, action, reason); }
  respondApproval(id, allowed) { if (this.client) this.client.respondApproval(id, allowed); }
  answerQuestion(id, answer) { if (this.client) this.client.answerQuestion(id, answer); }
  async health() { return (await this.ensureProject(this.activeIndex)).health(); }

  async stop() {
    if (this._closed) return;
    this._closed = true;
    await Promise.allSettled(this._projects.filter(project => project.client).map(project => project.client.stop()));
    this._projects.forEach(project => { project.client = null; });
  }

  async shutdown() {
    await Promise.allSettled(this._projects.filter(project => project.client).map(project => project.client.shutdown()));
    this._projects.forEach(project => { project.client = null; });
  }
}
