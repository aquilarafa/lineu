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
2. Se não, escolha baseado no contexto técnico do erro (domínio, módulo, serviço)
3. Se ainda incerto, retorne null
` : '';

    return `# Você é um Engenheiro de Software Sênior especializado em investigação de bugs de produção

Sua missão é analisar este erro e propor uma solução. Seja EFICIENTE - você tem limite de ações.

## LIMITE CRÍTICO: Máximo 6 buscas (grep/glob/read), depois DEVE responder com JSON

## Contexto do Erro

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
${teamSection}
## Estratégia de Investigação (RÁPIDA)

1. **Busca 1-2**: Localize o Job/Service mencionado no erro (grep pelo nome da classe)
2. **Busca 3-4**: Leia os arquivos principais encontrados
3. **Busca 5-6**: Procure a validação/erro específico se necessário
4. **PARE E RESPONDA**: Formule hipótese com base no que encontrou

NÃO continue buscando indefinidamente. Com 6 buscas você tem informação suficiente.

## Critérios de Prioridade

- **critical**: Sistema fora do ar, perda de dados, segurança comprometida
- **high**: Funcionalidade core quebrada, muitos usuários afetados
- **medium**: Bug afeta fluxo secundário, workaround disponível
- **low**: Cosmético, edge case raro

## Resposta Obrigatória

Após suas buscas (máximo 6), responda IMEDIATAMENTE com este JSON:

\`\`\`json
{
  "category": "bug|infrastructure|database|external-service|configuration|performance|security",
  "priority": "critical|high|medium|low",
  "summary": "Título conciso do problema (max 80 chars)",
  "exception": {
    "type": "Nome da exception (ex: TypeError, NoMethodError)",
    "message": "Mensagem de erro principal"
  },
  "stack_trace_summary": "Resumo das 3-5 linhas mais relevantes do stack trace",
  "affected_files": ["caminho/arquivo.rb:linha"],
  "root_cause": {
    "hypothesis": "Explicação técnica detalhada da causa raiz",
    "confidence": "high|medium|low",
    "evidence": "O que você encontrou no código que suporta esta hipótese"
  },
  "impact": {
    "description": "Impacto para o usuário/cliente/negócio",
    "scope": "Estimativa de quantos usuários/operações são afetados"
  },
  "fix": {
    "suggestion": "Descrição clara da correção proposta",
    "code_example": "Snippet de código mostrando a correção (se aplicável)",
    "files_to_modify": ["arquivo1.rb", "arquivo2.rb"]
  },
  "prevention": {
    "test_suggestion": "Que teste adicionar para evitar regressão",
    "monitoring_suggestion": "Que alerta/métrica adicionar (se aplicável)"
  },
  "investigation_log": ["Passo 1: O que você fez", "Passo 2: O que descobriu"],
  "related_code_snippets": [
    {
      "file": "caminho/arquivo.rb",
      "lines": "10-25",
      "code": "código relevante encontrado",
      "relevance": "Por que este código é relevante"
    }
  ],
  "suggested_team": "TEAM_KEY ou null",
  "additional_context": "Qualquer informação adicional relevante (Jobs Sidekiq, serviços externos, etc.)"
}
\`\`\`

## Regras OBRIGATÓRIAS

1. **MÁXIMO 6 buscas**: Após 6 operações de busca/leitura, você DEVE parar e responder
2. **Seja específico**: Aponte arquivos, linhas, variáveis concretas
3. **Proponha soluções reais**: Correção implementável, não "investigar mais"
4. **FORMATO CRÍTICO**:
   - Responda APENAS com o bloco JSON
   - Comece com \`\`\`json e termine com \`\`\`
   - ZERO texto antes ou depois do JSON`;
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
    // Try to find JSON block in markdown - use greedy match to get the LAST complete block
    const jsonBlockMatches = text.matchAll(/```json\s*([\s\S]*?)```/g);
    for (const match of jsonBlockMatches) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.category && parsed.summary) {
          return parsed;
        }
      } catch {
        // Continue to next match
      }
    }

    // Try to find balanced JSON object starting with { and containing required fields
    // Look for the pattern anywhere in the text
    const patterns = ['{\n  "category"', '{"category"', '{ "category"'];
    for (const pattern of patterns) {
      const startIdx = text.indexOf(pattern);
      if (startIdx !== -1) {
        try {
          return this.extractBalancedJson(text, startIdx);
        } catch {
          // Continue to next pattern
        }
      }
    }

    throw new Error('No valid JSON analysis found in output');
  }

  private extractBalancedJson(text: string, startIdx: number): ClaudeAnalysis {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\' && inString) {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) {
            const jsonStr = text.slice(startIdx, i + 1);
            return JSON.parse(jsonStr);
          }
        }
      }
    }

    throw new Error('Unbalanced JSON in output');
  }
}
