# feat: Lineu - CLI Server for Error Triage to Linear

**Date**: 2026-01-07
**Type**: Enhancement
**Status**: Draft

## Overview

CLI server que automatiza triage de erros usando **Claude Code CLI** com contexto completo do repositório:

1. Recebe webhooks com **qualquer JSON** (New Relic, Sentry, Datadog, custom)
2. Executa **Claude Code CLI** no repositório configurado
3. Cria cards no Linear com análise contextualizada
4. Deduplica erros via hash do payload

**Modelo**: Uma instância do Lineu = Um repositório. Se você tem 3 serviços, roda 3 instâncias.

**Payload flexível**: Aceita qualquer JSON. Claude Code interpreta o conteúdo.

## Por que Claude Code CLI ao invés do SDK?

| SDK Anthropic | Claude Code CLI |
|---------------|-----------------|
| Recebe só texto do erro | Acesso ao código fonte completo |
| Sem contexto do projeto | Lê CLAUDE.md, entende convenções |
| Categorização genérica | Pode grep/glob para achar código relacionado |
| "Parece um bug de database" | "Bug em `src/services/user.ts:142`, função `processPayment`" |

**O diferencial**: Claude Code pode navegar no repositório, entender a arquitetura, e dar uma análise muito mais acionável.

## Architecture

```
+------------------+
|  Any Error       |
|  Source          |
|  (New Relic,     |
|   Sentry, etc)   |
+--------+---------+
         |
   POST any JSON
         |
         v
+------------------+     +------------------+
|  Lineu Server    |---->|    SQLite DB     |
|                  |     |  - jobs (fila)   |
|  POST /webhook   |     |  - fingerprints  |
|  GET /health     |     +--------+---------+
|  GET /jobs/:id   |              |
+------------------+              |
                                  | Worker lê jobs
      +---------------------------+ pendentes (10s)
      |
      v
+------------------+     +------------------+
|  Background      |     |  Repositório     |
|  Worker          |---->|  Configurado     |
|                  |     |                  |
|  - Processa jobs |     |  git pull (5min) |
|  - Git pull      |     +------------------+
+--------+---------+
         |
         | Executa Claude Code
         v
+------------------+
|  Claude Code CLI |
|                  |
|  $ claude -p     |
|    --output json |
+--------+---------+
         |
         v
+------------------+
|  Linear API      |
|                  |
|  Cria card com:  |
|  - Análise       |
|  - Arquivos      |
|  - Sugestões     |
+------------------+
```

**Fluxo:**
1. Webhook salva job no SQLite → retorna 202 imediatamente
2. Worker processa jobs pendentes a cada 10s
3. Git pull roda a cada 5 min (independente dos jobs)
4. Se Claude/Linear falhar, job fica `failed` (não cria card lixo)

## Configuração

Uma instância = um repositório. Configuração simples:

```bash
# Repositório local existente
lineu serve --repo /path/to/myapp --port 3000

# Clonar automaticamente (para deploy)
lineu serve --repo-url git@github.com:acme/myapp.git --port 3000

# Via env vars
LINEU_REPO=/path/to/myapp
LINEU_PORT=3000
lineu serve
```

## Fluxo

### 1. Webhook chega (qualquer fonte)

**Aceita qualquer JSON válido** - sem estrutura obrigatória. Cada fonte de erro (New Relic, Sentry, Datadog, custom) pode enviar seu próprio formato.

```typescript
// Qualquer JSON válido
type ErrorPayload = Record<string, unknown>;
```

**Exemplos de payloads aceitos:**

```json
// New Relic
{
  "issueId": "abc123",
  "condition": { "name": "Error rate > 5%" },
  "entity": { "name": "payment-api" }
}

// Sentry
{
  "event_id": "xyz789",
  "message": "TypeError: undefined is not a function",
  "exception": { "values": [...] }
}

// Custom
{
  "error": "Connection timeout",
  "service": "user-api",
  "timestamp": "2026-01-07T10:00:00Z"
}

// Mínimo possível
{
  "msg": "Something broke"
}
```

**Claude Code interpreta o payload** - não precisamos normalizar campos.

### 2. Lineu atualiza o repo e executa Claude Code

```typescript
async function analyzeWithClaude(repoPath: string, payload: Record<string, unknown>): Promise<Analysis> {
  const prompt = buildPrompt(payload);

  const { stdout } = await exec(
    `claude -p "${prompt}" --output-format json --max-turns 3`,
    { cwd: repoPath }
  );

  return JSON.parse(stdout);
}

function buildPrompt(payload: Record<string, unknown>): string {
  return `Você é um especialista em debugging. Analise este erro de produção.

## Payload Recebido

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

## Sua Tarefa

1. **Interprete o payload**: Identifique a mensagem de erro, stack trace, severidade, ou qualquer informação relevante
2. **Localize o bug**: Use grep/glob para encontrar o código mencionado
3. **Analise o contexto**: Leia os arquivos relevantes
4. **Categorize**: É bug de código, infraestrutura, dependência externa?
5. **Priorize**: Qual o impacto real?
6. **Sugira investigação**: Quais logs verificar?

Responda em JSON:
{
  "category": "bug|infrastructure|database|external-service|configuration",
  "priority": "critical|high|medium|low",
  "summary": "Uma linha descrevendo o problema",
  "affected_files": ["src/services/payment.ts"],
  "root_cause_hypothesis": "O que provavelmente está causando",
  "suggested_fix": "Como resolver",
  "investigation_steps": ["Passo 1", "Passo 2"],
  "related_code": "Snippet relevante (se encontrar)"
}`;
}
```

### 3. Cria card no Linear

Com a análise rica do Claude Code, o card fica muito mais útil:

```markdown
## [BUG] TypeError em processPayment - property 'id' of undefined

### Análise (Claude Code)

**Arquivos afetados**: `src/services/payment.ts:142`

### Hipótese de Causa Raiz
O objeto `user` está chegando como `undefined` na função `processPayment`.
Isso acontece quando o middleware de autenticação falha silenciosamente.

### Código Problemático
```typescript
// src/services/payment.ts:142
const userId = user.id; // user pode ser undefined!
```

### Sugestão de Fix
```typescript
if (!user?.id) {
  throw new UnauthorizedError('User not authenticated');
}
```

### Passos de Investigação
1. Verificar logs do middleware de auth
2. Checar timeout no serviço de sessão

---
*Fingerprint: `abc123`*
*Analisado por Claude Code*
```

## Technical Approach

### Phase 1: Foundation

#### 1.1 Project Structure

```
lineu/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts             # CLI entry
│   ├── server.ts            # Fastify server (webhook + health)
│   ├── worker.ts            # Background job processor
│   ├── db.ts                # SQLite (jobs + fingerprints)
│   ├── services/
│   │   ├── claude.ts        # Claude Code CLI executor
│   │   └── linear.ts        # Linear API
│   ├── lib/
│   │   ├── config.ts        # Configuração
│   │   └── fingerprint.ts   # Hash para deduplicação
│   └── types.ts
└── tests/
```

#### 1.2 Configuration

```typescript
// src/lib/config.ts
interface LineuConfig {
  server: {
    port: number;              // Default: 3000
  };
  repo: {
    path: string;              // Caminho do repositório (obrigatório)
    url?: string;              // Se fornecido, clona automaticamente
  };
  database: {
    path: string;              // Default: ./lineu.db
  };
  claude: {
    maxTurns: number;          // Default: 3
    timeout: number;           // Default: 120000 (2 min)
  };
  linear: {
    apiKey: string;
    teamId: string;
  };
  deduplication: {
    windowDays: number;        // Default: 7
  };
  worker: {
    pollInterval: number;      // Default: 10000 (10s)
    gitPullInterval: number;   // Default: 300000 (5 min)
  };
}
```

#### 1.3 Files to Create

- `src/lib/config.ts`
- `src/index.ts`
- `.env.example`

### Phase 2: SQLite Database

```typescript
// src/db.ts
import Database from 'better-sqlite3';

const SCHEMA = `
-- Fila de jobs para processamento assíncrono
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | processing | completed | failed | duplicate
  error TEXT,
  linear_issue_id TEXT,
  linear_identifier TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);

-- Fingerprints para deduplicação (erros já processados)
CREATE TABLE IF NOT EXISTS fingerprints (
  hash TEXT PRIMARY KEY,
  linear_issue_id TEXT NOT NULL,
  linear_identifier TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export interface Job {
  id: number;
  payload: string;
  fingerprint: string;
  status: string;
}

export interface LineuDatabase {
  // Jobs
  insertJob: (payload: Record<string, unknown>, fingerprint: string) => number;
  getJob: (id: number) => Job | undefined;
  getPendingJobs: (limit: number) => Job[];
  markProcessing: (id: number) => void;
  markCompleted: (id: number, linearIssueId: string, linearIdentifier: string) => void;
  markFailed: (id: number, error: string) => void;
  markDuplicate: (id: number, linearIdentifier: string) => void;

  // Fingerprints
  findFingerprint: (hash: string, windowDays: number) => { linear_identifier: string } | undefined;
  insertFingerprint: (hash: string, linearIssueId: string, linearIdentifier: string) => void;

  close: () => void;
}

export function createDatabase(dbPath: string): LineuDatabase {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  return {
    // Jobs
    insertJob: (payload, fingerprint) => {
      const result = db.prepare(`
        INSERT INTO jobs (payload, fingerprint) VALUES (?, ?)
      `).run(JSON.stringify(payload), fingerprint);
      return result.lastInsertRowid as number;
    },

    getJob: (id) => db.prepare(`
      SELECT id, payload, fingerprint, status, error, linear_identifier, created_at, processed_at
      FROM jobs WHERE id = ?
    `).get(id) as Job | undefined,

    getPendingJobs: (limit) => db.prepare(`
      SELECT id, payload, fingerprint, status FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as Job[],

    markProcessing: (id) => db.prepare(`
      UPDATE jobs SET status = 'processing' WHERE id = ?
    `).run(id),

    markCompleted: (id, linearIssueId, linearIdentifier) => db.prepare(`
      UPDATE jobs SET status = 'completed', linear_issue_id = ?, linear_identifier = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(linearIssueId, linearIdentifier, id),

    markFailed: (id, error) => db.prepare(`
      UPDATE jobs SET status = 'failed', error = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(error, id),

    markDuplicate: (id, linearIdentifier) => db.prepare(`
      UPDATE jobs SET status = 'duplicate', linear_identifier = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(linearIdentifier, id),

    // Fingerprints
    findFingerprint: (hash, windowDays) => db.prepare(`
      SELECT linear_identifier FROM fingerprints
      WHERE hash = ? AND created_at > datetime('now', '-' || ? || ' days')
    `).get(hash, windowDays) as { linear_identifier: string } | undefined,

    insertFingerprint: (hash, linearIssueId, linearIdentifier) => db.prepare(`
      INSERT OR IGNORE INTO fingerprints (hash, linear_issue_id, linear_identifier)
      VALUES (?, ?, ?)
    `).run(hash, linearIssueId, linearIdentifier),

    close: () => db.close(),
  };
}
```

### Phase 3: Claude Code CLI Executor

```typescript
// src/services/claude.ts
import { spawn } from 'child_process';

export interface ClaudeAnalysis {
  category: 'bug' | 'infrastructure' | 'database' | 'external-service' | 'configuration' | 'performance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  affected_files: string[];
  root_cause_hypothesis: string;
  suggested_fix: string;
  investigation_steps: string[];
  related_code?: string;
}

export class ClaudeExecutionError extends Error {
  constructor(message: string, public readonly stderr?: string) {
    super(message);
    this.name = 'ClaudeExecutionError';
  }
}

export class ClaudeService {
  private maxTurns: number;
  private timeout: number;

  constructor(config: { maxTurns: number; timeout: number }) {
    this.maxTurns = config.maxTurns;
    this.timeout = config.timeout;
  }

  async analyze(repoPath: string, payload: Record<string, unknown>): Promise<ClaudeAnalysis> {
    const prompt = this.buildPrompt(payload);

    // Usar spawn com array de argumentos para evitar command injection
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', [
        '-p', prompt,
        '--output-format', 'json',
        '--max-turns', String(this.maxTurns),
      ], {
        cwd: repoPath,
        timeout: this.timeout,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('error', (err) => {
        reject(new ClaudeExecutionError(`Failed to spawn claude: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new ClaudeExecutionError(`Claude exited with code ${code}`, stderr));
        } else {
          try {
            resolve(this.parseOutput(stdout));
          } catch (err) {
            reject(new ClaudeExecutionError(`Failed to parse Claude output: ${err}`, stdout));
          }
        }
      });
    });
  }

  private buildPrompt(payload: Record<string, unknown>): string {
    return `Analise este erro de produção.

## Payload Recebido

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

## Instruções

1. Interprete o payload - identifique mensagem de erro, stack trace, severidade
2. Use grep/glob para encontrar o código mencionado
3. Leia os arquivos relevantes
4. Se existir CLAUDE.md, leia para entender as convenções

Responda APENAS com JSON:
{
  "category": "bug|infrastructure|database|external-service|configuration|performance",
  "priority": "critical|high|medium|low",
  "summary": "Descrição curta (max 80 chars)",
  "affected_files": ["caminho/arquivo.ts"],
  "root_cause_hypothesis": "Causa provável",
  "suggested_fix": "Como resolver",
  "investigation_steps": ["Passo 1", "Passo 2"],
  "related_code": "Snippet relevante"
}`;
  }

  private parseOutput(stdout: string): ClaudeAnalysis {
    // Claude Code --output-format json retorna JSON estruturado
    const response = JSON.parse(stdout);
    const content = response.result ?? response.content ?? response;

    // Extrair JSON do texto de resposta se necessário
    if (typeof content === 'string') {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      }
    }

    return content as ClaudeAnalysis;
  }
}
```

#### Files to Create

- `src/services/claude.ts`

### Phase 4: Background Worker

```typescript
// src/worker.ts
import { spawn } from 'child_process';

export function startWorker(
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService
) {
  // Processa jobs pendentes a cada 10 segundos
  const processInterval = setInterval(async () => {
    await processJobs(config, db, claude, linear);
  }, 10_000);

  // Git pull a cada 5 minutos
  const gitPullInterval = setInterval(async () => {
    await gitPull(config.repo.path);
  }, 5 * 60 * 1000);

  // Git pull inicial
  gitPull(config.repo.path);

  return {
    stop: () => {
      clearInterval(processInterval);
      clearInterval(gitPullInterval);
    },
  };
}

async function processJobs(
  config: LineuConfig,
  db: LineuDatabase,
  claude: ClaudeService,
  linear: LinearService
) {
  const jobs = db.getPendingJobs(10); // Processa até 10 jobs por ciclo

  for (const job of jobs) {
    db.markProcessing(job.id);
    const payload = JSON.parse(job.payload);

    try {
      // 1. Verificar duplicata
      const existing = db.findFingerprint(job.fingerprint, config.deduplication.windowDays);

      if (existing) {
        console.log(`[Job ${job.id}] Duplicate → ${existing.linear_identifier}`);
        db.markDuplicate(job.id, existing.linear_identifier);
        continue;
      }

      // 2. Executar Claude Code
      console.log(`[Job ${job.id}] Analyzing with Claude Code...`);
      const analysis = await claude.analyze(config.repo.path, payload);

      // 3. Criar card no Linear
      console.log(`[Job ${job.id}] Creating Linear issue...`);
      const issue = await linear.createIssue(payload, analysis, job.fingerprint);

      // 4. Salvar fingerprint e marcar completo
      db.insertFingerprint(job.fingerprint, issue.id, issue.identifier);
      db.markCompleted(job.id, issue.id, issue.identifier);
      console.log(`[Job ${job.id}] Completed → ${issue.identifier}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Job ${job.id}] Failed: ${message}`);
      db.markFailed(job.id, message);
    }
  }
}

function gitPull(repoPath: string): Promise<void> {
  return new Promise((resolve) => {
    console.log('Running git pull...');
    const proc = spawn('git', ['-C', repoPath, 'pull', '--ff-only']);
    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn('Git pull failed, continuing with current state');
      } else {
        console.log('Git pull completed');
      }
      resolve();
    });
    proc.on('error', () => resolve());
  });
}

// src/lib/fingerprint.ts
import crypto from 'crypto';

// Campos que mudam a cada ocorrência e devem ser ignorados no fingerprint
const DYNAMIC_FIELDS = new Set([
  'timestamp', 'occurredAt', 'createdAt', 'updatedAt', 'time', 'date',
  'requestId', 'traceId', 'spanId', 'correlationId',
  'id', 'uuid', 'eventId', 'event_id', 'issueId',
]);

function removeDynamicFields(obj: unknown, seen = new WeakSet()): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return '[circular]';
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map(item => removeDynamicFields(item, seen));
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!DYNAMIC_FIELDS.has(key)) {
      cleaned[key] = removeDynamicFields(value, seen);
    }
  }
  return cleaned;
}

export function generateFingerprint(payload: Record<string, unknown>): string {
  // Remove campos dinâmicos que mudam a cada ocorrência
  const stable = removeDynamicFields(payload);
  const sorted = JSON.stringify(stable, Object.keys(stable as object).sort());
  return crypto.createHash('sha256').update(sorted).digest('hex').substring(0, 32);
}
```

#### Files to Create

- `src/services/processor.ts`

### Phase 5: Linear Integration

```typescript
// src/services/linear.ts
import { LinearClient } from '@linear/sdk';

export class LinearService {
  private client: LinearClient;
  private teamId: string;

  constructor(config: { apiKey: string; teamId: string }) {
    this.client = new LinearClient({ apiKey: config.apiKey });
    this.teamId = config.teamId;
  }

  async createIssue(payload: Record<string, unknown>, analysis: ClaudeAnalysis, fingerprint: string) {
    const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };

    const result = await this.client.createIssue({
      teamId: this.teamId,
      title: `[${analysis.category.toUpperCase()}] ${analysis.summary}`,
      description: this.buildDescription(payload, analysis, fingerprint),
      priority: priorityMap[analysis.priority],
    });

    const issue = await result.issue;
    if (!issue) {
      throw new Error('Linear API returned no issue');
    }
    return { id: issue.id, identifier: issue.identifier, url: issue.url };
  }

  private buildDescription(payload: Record<string, unknown>, analysis: ClaudeAnalysis, fingerprint: string): string {
    const files = analysis.affected_files.map(f => `- \`${f}\``).join('\n') || '- Não identificado';
    const steps = analysis.investigation_steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const code = analysis.related_code ? `### Código\n\`\`\`\n${analysis.related_code}\n\`\`\`\n` : '';

    return `## Análise (Claude Code)

### Causa Provável
${analysis.root_cause_hypothesis}

### Arquivos Afetados
${files}

${code}
### Sugestão de Fix
${analysis.suggested_fix}

### Investigação
${steps}

---

## Payload Original

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

---
*Fingerprint: \`${fingerprint}\`*`;
  }
}
```

#### Files to Create

- `src/services/linear.ts`

### Phase 7: CLI & Server

```typescript
// src/index.ts
import { program } from 'commander';

program
  .name('lineu')
  .description('Error webhook → Claude Code → Linear')
  .version('1.0.0');

program
  .command('serve')
  .description('Start webhook server')
  .requiredOption('-r, --repo <path>', 'Path to repository')
  .option('-p, --port <number>', 'Port', '3000')
  .action(async (opts) => {
    const config = loadConfig({
      repo: { path: opts.repo },
      server: { port: parseInt(opts.port) },
    });

    const db = createDatabase(config.database.path);
    const claude = new ClaudeService(config.claude);
    const linear = new LinearService(config.linear);

    // Inicia worker em background
    const worker = startWorker(config, db, claude, linear);

    // Inicia servidor HTTP
    const server = await createServer(config, db);
    await server.listen({ port: config.server.port });

    console.log(`
Lineu running!
  Repo: ${config.repo.path}
  Webhook: http://localhost:${config.server.port}/webhook
  Health: http://localhost:${config.server.port}/health
  Jobs:   http://localhost:${config.server.port}/jobs/:id
    `);

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      worker.stop();
      await server.close();
      db.close();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });

program
  .command('test')
  .description('Test analysis with a sample error')
  .requiredOption('-r, --repo <path>', 'Path to repository')
  .option('-m, --message <msg>', 'Error message', 'TypeError: Cannot read property of undefined')
  .option('-f, --file <path>', 'JSON file with payload')
  .option('--dry-run', 'Don\'t create Linear card')
  .action(async (opts) => {
    const config = loadConfig({ repo: { path: opts.repo } });
    const db = createDatabase(config.database.path);

    // Payload pode vir de arquivo JSON ou ser gerado com a mensagem
    const payload = opts.file
      ? JSON.parse(fs.readFileSync(opts.file, 'utf-8'))
      : { message: opts.message, timestamp: new Date().toISOString() };

    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('Running Claude Code analysis...');
    // ... process and show result
  });

program
  .command('stats')
  .description('Show statistics')
  .action(() => {
    const db = createDatabase('./lineu.db');
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(occurrence_count) as total_occurrences
      FROM fingerprints
    `).get();
    console.log('Fingerprints:', stats);
  });

program.parse();
```

```typescript
// src/server.ts
import Fastify from 'fastify';

export async function createServer(config: LineuConfig, db: LineuDatabase) {
  const app = Fastify({ logger: true });

  app.post('/webhook', async (request, reply) => {
    const payload = request.body as Record<string, unknown>;

    // Aceita qualquer JSON válido, só rejeita body vazio
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return reply.status(400).send({ error: 'Empty or invalid JSON payload' });
    }

    // Gera fingerprint e salva na fila - retorna imediatamente
    const fingerprint = generateFingerprint(payload);
    const jobId = db.insertJob(payload, fingerprint);

    return reply.status(202).send({
      status: 'queued',
      jobId,
      fingerprint,
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = db.getJob(Number(id));
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    return reply.send(job);
  });

  return app;
}
```

#### Files to Create

- `src/index.ts`
- `src/server.ts`

## Acceptance Criteria

- [ ] `lineu serve --repo /path/to/repo` inicia servidor + worker
- [ ] Webhook retorna 202 imediatamente após salvar job no SQLite
- [ ] Worker processa jobs pendentes em background (a cada 10s)
- [ ] Git pull automático periódico (a cada 5 min)
- [ ] Fingerprint exclui campos dinâmicos (timestamp, id, requestId, etc)
- [ ] Claude Code CLI executa no contexto do repo
- [ ] Se Claude falhar, job fica com status `failed` (não cria card lixo)
- [ ] Cards no Linear incluem o payload original completo
- [ ] Deduplicação via fingerprint (duplicatas marcadas como `duplicate`)
- [ ] `GET /jobs/:id` permite consultar status do job
- [ ] Graceful shutdown (SIGTERM/SIGINT)

## Dependencies

### System Requirements

- **Claude Code CLI** instalado e autenticado (`claude` no PATH)
- **Git** instalado

### npm packages

```json
{
  "dependencies": {
    "@linear/sdk": "^15.0.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "fastify": "^5.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Nota**: Não precisa de `@anthropic-ai/sdk` - usamos Claude Code CLI!

## Configuration

### Environment Variables

```bash
# .env
LINEAR_API_KEY=lin_api_...
LINEAR_TEAM_ID=...
```

## Usage

```bash
# 1. Iniciar servidor apontando para o repo
lineu serve --repo /path/to/myapp --port 3000

# 2. Configurar qualquer fonte de erro para enviar webhooks para:
# http://your-server:3000/webhook
# Aceita qualquer JSON!

# 3. Testar localmente com mensagem simples
lineu test --repo /path/to/myapp -m "TypeError: undefined is not a function"

# 4. Testar com payload JSON customizado
lineu test --repo /path/to/myapp -f ./my-error.json

# 5. Ver estatísticas
lineu stats
```

## Deploy: Múltiplos Serviços

Uma instância = um repo. Para múltiplos serviços:

```bash
# Serviço 1
lineu serve --repo /repos/payment-api --port 3001

# Serviço 2
lineu serve --repo /repos/user-api --port 3002

# Serviço 3
lineu serve --repo /repos/notification-api --port 3003
```

Ou com Docker Compose:

```yaml
services:
  lineu-payment:
    image: lineu
    command: serve --repo /repo --port 3000
    volumes:
      - ./payment-api:/repo
    ports:
      - "3001:3000"

  lineu-users:
    image: lineu
    command: serve --repo /repo --port 3000
    volumes:
      - ./user-api:/repo
    ports:
      - "3002:3000"
```

---

*Plan created: 2026-01-07*
*Uma instância = Um repositório*
*Uses Claude Code CLI for repository-aware analysis*
