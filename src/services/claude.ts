import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ClaudeAnalysis, ClaudeSessionEvent } from '../types.js';

// Prompt injection detection patterns (defense-in-depth)
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+the\s+above/i,
  /disregard\s+(all\s+)?prior/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*you\s+are/i,
  /run\s+(this\s+)?command/i,
  /execute\s+(the\s+)?following/i,
  /use\s+the\s+bash\s+tool/i,
  /curl\s+.*\|\s*bash/i,
  /wget\s+.*\|\s*sh/i,
];

function containsPromptInjection(payload: Record<string, unknown>): boolean {
  const jsonStr = JSON.stringify(payload);
  return INJECTION_PATTERNS.some(pattern => pattern.test(jsonStr));
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
  private logDir: string;

  constructor(config: { maxTurns: number; timeout: number }) {
    this.maxTurns = config.maxTurns;
    this.timeout = config.timeout;
    this.logDir = path.join(os.homedir(), '.lineu', 'logs');

    // Create logs directory
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  async analyze(repoPath: string, payload: Record<string, unknown>, jobId?: number, teamList?: string): Promise<ClaudeAnalysis> {
    // Defense-in-depth: Check for prompt injection attempts
    if (containsPromptInjection(payload)) {
      console.warn(`[Claude] Rejected payload: contains suspicious prompt injection patterns`);
      throw new ClaudeExecutionError('Payload contains suspicious content');
    }

    const prompt = this.buildPrompt(payload, teamList);
    const logFile = path.join(this.logDir, `claude-${jobId || Date.now()}.log`);
    const sessionLogPath = path.join(this.logDir, `claude-${jobId || Date.now()}.jsonl`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const sessionLog = fs.createWriteStream(sessionLogPath, { flags: 'w' });
    const startTime = Date.now();

    const logEvent = (event: ClaudeSessionEvent) => {
      sessionLog.write(JSON.stringify(event) + '\n');
    };

    console.log(`[Claude] Starting analysis, log: ${logFile}`);
    logStream.write(`=== Claude Analysis Started at ${new Date().toISOString()} ===\n`);
    logStream.write(`Repo: ${repoPath}\n`);
    logStream.write(`Prompt:\n${prompt}\n\n`);

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--max-turns', String(this.maxTurns),
        '--verbose',
        '--allowedTools', 'Read,Glob,Grep,LS',  // Restrict to read-only tools for security
      ], {
        cwd: repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Manual timeout
      const timeoutId = this.timeout > 0 ? setTimeout(() => {
        logEvent({ ts: new Date().toISOString(), type: 'error', message: `Timeout after ${this.timeout}ms` });
        logStream.write(`\n=== TIMEOUT after ${this.timeout}ms ===\n`);
        logStream.end();
        sessionLog.end();
        proc.kill('SIGTERM');
        reject(new ClaudeExecutionError(`Claude timed out after ${this.timeout}ms`));
      }, this.timeout) : null;

      let fullOutput = '';
      let lastResult: unknown = null;
      const toolMap = new Map<string, string>(); // tool_use_id -> tool name

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        fullOutput += chunk;

        // Log raw output
        logStream.write(chunk);

        // Also print to console for real-time visibility
        process.stdout.write(chunk);

        // Try to parse stream-json events and log structured events
        const lines = chunk.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            const ts = new Date().toISOString();

            if (event.type === 'assistant') {
              const content = event.message?.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    logEvent({ ts, type: 'text', content: block.text });
                  } else if (block.type === 'tool_use') {
                    // Track tool_use_id -> tool name for matching results
                    if (block.id) {
                      toolMap.set(block.id, block.name);
                    }
                    logEvent({ ts, type: 'tool_use', tool: block.name, input: block.input });
                  }
                }
              }
            } else if (event.type === 'user') {
              const content = event.message?.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const output = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                    // Look up tool name from tool_use_id
                    const toolName = block.tool_use_id ? toolMap.get(block.tool_use_id) : undefined;
                    logEvent({
                      ts,
                      type: 'tool_result',
                      tool: toolName,
                      output: output.substring(0, 1000),
                      lines: output.split('\n').length,
                    });
                  }
                }
              }
            } else if (event.type === 'result') {
              lastResult = event;
            }
          } catch {
            // Not JSON, ignore
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        logStream.write(`[STDERR] ${chunk}`);
        process.stderr.write(chunk);
      });

      proc.on('error', (err) => {
        logEvent({ ts: new Date().toISOString(), type: 'error', message: err.message });
        logStream.write(`\n=== ERROR: ${err.message} ===\n`);
        logStream.end();
        sessionLog.end();
        reject(new ClaudeExecutionError(`Failed to spawn claude: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);

        logEvent({ ts: new Date().toISOString(), type: 'result', duration_ms: Date.now() - startTime });
        logStream.write(`\n=== Claude exited with code ${code} ===\n`);
        logStream.end();
        sessionLog.end();

        if (code !== 0) {
          reject(new ClaudeExecutionError(`Claude exited with code ${code}`, fullOutput));
        } else {
          try {
            resolve(this.parseStreamOutput(fullOutput, lastResult));
          } catch (err) {
            reject(new ClaudeExecutionError(`Failed to parse Claude output: ${err}`, fullOutput));
          }
        }
      });
    });
  }

  private buildPrompt(payload: Record<string, unknown>, teamList?: string): string {
    const teamSection = teamList ? `
## Times Disponíveis

${teamList}

Para escolher o time:
1. Se encontrar CODEOWNERS, use o owner dos arquivos afetados
2. Se não, escolha baseado no contexto do erro
3. Se incerto, retorne null (mas tente escolher!)
` : '';

    return `Você é um analisador de erros de produção. Analise rapidamente e responda APENAS com JSON.

## Payload do Erro

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
${teamSection}
## Instruções IMPORTANTES

IMPORTANTE: Você tem no MÁXIMO 5 buscas para investigar. Após isso, DEVE responder com JSON.

1. Faça 1-2 buscas rápidas (grep/glob) para localizar arquivos relevantes
2. Se existir CODEOWNERS, leia para entender ownership
3. Leia no máximo 2-3 arquivos chave
4. IMEDIATAMENTE responda com o JSON abaixo

NÃO continue investigando indefinidamente. Faça uma hipótese rápida baseada no que encontrou.

## Resposta OBRIGATÓRIA (JSON)

\`\`\`json
{
  "category": "bug|infrastructure|database|external-service|configuration|performance",
  "priority": "critical|high|medium|low",
  "summary": "Descrição curta (max 80 chars)",
  "affected_files": ["caminho/arquivo.rb"],
  "root_cause_hypothesis": "Causa provável baseada na investigação",
  "suggested_fix": "Como resolver",
  "investigation_steps": ["Passo 1", "Passo 2"],
  "related_code": "Snippet relevante encontrado",
  "suggested_team": "TEAM_KEY ou null se incerto"
}
\`\`\`

RESPONDA APENAS COM O JSON ACIMA. Nenhum texto adicional.`;
  }

  private parseStreamOutput(fullOutput: string, lastResult: unknown): ClaudeAnalysis {
    // Try to extract from last result event
    if (lastResult && typeof lastResult === 'object') {
      const result = lastResult as Record<string, unknown>;
      if (result.result) {
        const content = result.result;
        if (typeof content === 'string') {
          return this.extractJsonFromText(content);
        }
        if (typeof content === 'object' && content !== null) {
          const obj = content as Record<string, unknown>;
          if (obj.category && obj.summary) {
            return obj as unknown as ClaudeAnalysis;
          }
        }
      }
    }

    // Fallback: try to find JSON in full output
    return this.extractJsonFromText(fullOutput);
  }

  private extractJsonFromText(text: string): ClaudeAnalysis {
    // Try to find JSON block in markdown
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Try to find raw JSON object
    const objectMatch = text.match(/\{[\s\S]*"category"[\s\S]*"summary"[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }

    throw new Error('No valid JSON analysis found in output');
  }
}
