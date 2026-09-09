// The conversational agent behind the bottom bar.
//
// It runs on the user's own Claude Code CLI rather than the Anthropic API: no
// separate key, no per-token billing on top of their subscription. One long-lived
// `claude` process per conversation, fed through stream-json on stdin and read
// back the same way, so turn two doesn't pay the startup cost of turn one.
//
// Writes never happen behind the user's back. A write tool doesn't report success
// — it parks a proposal here, waits for the click, and returns what actually
// happened. The agent's picture of the world therefore stays true, which matters
// the moment it chains "create the project, then add a task to it".
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const IDLE_MS = 30 * 60e3;      // a conversation nobody touches releases its process
const DECISION_MS = 2 * 60e3;   // how long a write tool waits on a click

const SYSTEM = `Tu es l'assistant du command centre Alpes IA de Christophe, indépendant à Annecy
(IA générative et automatisation pour TPE/PME).

Tu as accès à ses vraies données via les outils du serveur MCP "dashboard" : son second brain,
ses projets, sa todo, son agenda et sa boîte. Sers-t'en plutôt que de supposer. Quand une
question porte sur un client, un projet, un montant ou une décision, cherche avant de répondre.

Il te dicte souvent ses messages : attends-toi à de l'oral, des phrases inachevées, des noms
mal transcrits. Rapproche-les de ce que tu trouves dans le second brain plutôt que de demander
une clarification pour chaque approximation.

Les outils d'écriture demandent sa validation : tu proposes, il valide ou refuse, tu apprends
le résultat. S'il refuse, n'insiste pas et ne recommence pas la même action.

Réponds toujours en français, y compris ta toute première phrase. Court et direct. N'annonce
jamais ce que tu vas faire ("je vais regarder…") : fais-le, les outils que tu appelles sont déjà
affichés à l'écran. Quand tu cites une note, donne son chemin.

Tu n'as ni shell ni accès en écriture aux fichiers : tes seuls moyens d'agir sont les outils
ci-dessus. Si l'un échoue, dis-le simplement, ne cherche pas de contournement.`;

export function makeChat(root, cfg) {
  const conversations = new Map();

  function ensure(id) {
    let c = conversations.get(id);
    if (c && !c.child.killed) { c.touched = Date.now(); return c; }

    const mcp = {
      mcpServers: {
        dashboard: {
          command: process.execPath,
          args: [path.join(root, 'lib', 'mcp-dashboard.js')],
          env: { ALPES_OS_API: `http://localhost:${cfg.port}`, ALPES_OS_CHAT: id },
        },
      },
    };

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', cfg.model,
      '--append-system-prompt', SYSTEM,
      '--mcp-config', JSON.stringify(mcp),
      // The confirmation gate is only worth something if the agent cannot step
      // around it: no shell, no file writes, no sub-agents. Reading and web
      // search stay on — the user asked for research.
      '--disallowedTools', 'Bash,Write,Edit,NotebookEdit,Task,KillShell,BashOutput',
      '--disable-slash-commands',
      '--permission-mode', 'bypassPermissions',
    ];

    const child = spawn(cfg.bin, args, { cwd: root, env: { ...process.env, CLAUDECODE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    c = { id, child, buf: '', listeners: new Set(), pending: new Map(), touched: Date.now(), busy: false };

    child.stdout.on('data', d => {
      c.buf += d;
      const lines = c.buf.split('\n');
      c.buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { route(c, JSON.parse(line)); } catch (e) { /* partial or non-JSON noise */ }
      }
    });
    child.stderr.on('data', d => { c.lastError = String(d).slice(-500); });
    child.on('close', () => {
      emit(c, { type: 'closed' });
      conversations.delete(id);
    });

    conversations.set(id, c);
    return c;
  }

  // Turn the CLI's event stream into the few things the browser actually renders.
  function route(c, ev) {
    if (ev.type === 'stream_event') {
      const d = ev.event;
      if (d?.type === 'content_block_delta' && d.delta?.type === 'text_delta') emit(c, { type: 'text', text: d.delta.text });
      return;
    }
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_use') emit(c, { type: 'tool', name: String(b.name).replace(/^mcp__dashboard__/, ''), input: b.input });
      }
      return;
    }
    if (ev.type === 'result') {
      c.busy = false;
      emit(c, { type: 'done', error: ev.is_error ? (ev.result ?? c.lastError ?? 'échec') : undefined });
    }
  }

  const emit = (c, msg) => { for (const fn of c.listeners) { try { fn(msg); } catch (e) { /* client gone */ } } };

  return {
    subscribe(id, fn) {
      const c = ensure(id);
      c.listeners.add(fn);
      for (const p of c.pending.values()) fn({ type: 'confirm', ...p.card });
      return () => c.listeners.delete(fn);
    },

    send(id, text) {
      const c = ensure(id);
      c.busy = true;
      c.child.stdin.write(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: String(text) }] },
      }) + '\n');
      return { ok: true };
    },

    // Called by the MCP server. Resolves only once the user has decided, so the
    // agent learns the truth instead of assuming its write landed.
    propose(id, action) {
      const c = conversations.get(id);
      if (!c) return Promise.resolve({ decided: 'refusé', reason: 'conversation fermée' });
      const key = randomUUID();
      const card = { key, action: action.name, summary: action.summary, details: action.details ?? {} };
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          c.pending.delete(key);
          emit(c, { type: 'confirm-gone', key });
          resolve({ decided: 'expiré', reason: "pas de réponse de l'utilisateur" });
        }, DECISION_MS);
        c.pending.set(key, { card, resolve, timer });
        emit(c, { type: 'confirm', ...card });
      });
    },

    decide(id, key, approved) {
      const c = conversations.get(id);
      const p = c?.pending.get(key);
      if (!p) return { ok: false };
      clearTimeout(p.timer);
      c.pending.delete(key);
      emit(c, { type: 'confirm-gone', key });
      p.resolve({ decided: approved ? 'validé' : 'refusé' });
      return { ok: true };
    },

    close(id) {
      const c = conversations.get(id);
      if (!c) return;
      for (const p of c.pending.values()) { clearTimeout(p.timer); p.resolve({ decided: 'refusé', reason: 'conversation fermée' }); }
      c.child.kill();
      conversations.delete(id);
    },

    sweep() {
      for (const [id, c] of conversations) if (Date.now() - c.touched > IDLE_MS && !c.busy) { c.child.kill(); conversations.delete(id); }
    },
  };
}
