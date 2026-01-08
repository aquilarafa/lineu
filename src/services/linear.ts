import { LinearClient } from '@linear/sdk';
import type { ClaudeAnalysis, LinearIssue, TeamInfo } from '../types.js';

export class LinearService {
  private client: LinearClient;
  private teams: Map<string, TeamInfo> = new Map();

  constructor(config: { apiKey: string }) {
    this.client = new LinearClient({ apiKey: config.apiKey });
  }

  async fetchTeams(): Promise<{ success: boolean; count: number }> {
    try {
      const result = await this.client.teams({ first: 100 });
      for (const team of result.nodes) {
        this.teams.set(team.key, {
          id: team.id,
          key: team.key,
          name: team.name,
        });
      }
      console.log(`[Linear] Loaded ${result.nodes.length} teams`);
      return { success: true, count: result.nodes.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Linear] Failed to fetch teams: ${msg}`);
      return { success: false, count: 0 };
    }
  }

  getTeamListForPrompt(): string {
    if (this.teams.size === 0) return '';
    return Array.from(this.teams.values())
      .map(t => `- ${t.key}: ${t.name}`)
      .join('\n');
  }

  resolveTeamId(suggestedKey: string | null): string | null {
    if (!suggestedKey) {
      return null;
    }
    const team = this.teams.get(suggestedKey);
    if (team) {
      return team.id;
    }
    console.warn(`[Linear] Team "${suggestedKey}" not found`);
    return null;
  }

  async createIssue(
    teamId: string,
    payload: Record<string, unknown>,
    analysis: ClaudeAnalysis,
    fingerprint: string
  ): Promise<LinearIssue> {
    const priorityMap: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };

    const result = await this.client.createIssue({
      teamId,
      title: `[${analysis.category.toUpperCase()}] ${analysis.summary}`,
      description: this.buildDescription(payload, analysis, fingerprint),
      priority: priorityMap[analysis.priority],
    });

    const issue = await result.issue;
    if (!issue) {
      throw new Error('Linear API returned no issue');
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  }

  private buildDescription(
    payload: Record<string, unknown>,
    analysis: ClaudeAnalysis,
    fingerprint: string
  ): string {
    const files = analysis.affected_files.length > 0
      ? analysis.affected_files.map(f => `- \`${f}\``).join('\n')
      : '- Não identificado';

    // Support both new and legacy formats
    const investigationSteps = analysis.investigation_log || analysis.investigation_steps || [];
    const steps = investigationSteps
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n');

    // Build exception section
    const exceptionSection = analysis.exception
      ? `## Exception\n\n**${analysis.exception.type}**: ${analysis.exception.message}\n\n`
      : '';

    // Build stack trace section
    const stackTraceSection = analysis.stack_trace_summary
      ? `### Stack Trace (Resumo)\n\`\`\`\n${analysis.stack_trace_summary}\n\`\`\`\n\n`
      : '';

    // Build root cause section (support both new and legacy)
    const rootCauseContent = analysis.root_cause
      ? `**Hipótese**: ${analysis.root_cause.hypothesis}\n\n**Confiança**: ${analysis.root_cause.confidence}\n\n**Evidência**: ${analysis.root_cause.evidence}`
      : analysis.root_cause_hypothesis || 'Não identificada';

    // Build impact section
    const impactSection = analysis.impact
      ? `### Impacto\n\n**Descrição**: ${analysis.impact.description}\n\n**Escopo**: ${analysis.impact.scope}\n\n`
      : '';

    // Build fix section (support both new and legacy)
    let fixSection = '';
    if (analysis.fix) {
      fixSection = `### Correção Proposta\n\n${analysis.fix.suggestion}\n\n`;
      if (analysis.fix.code_example) {
        fixSection += `**Exemplo de código**:\n\`\`\`\n${analysis.fix.code_example}\n\`\`\`\n\n`;
      }
      if (analysis.fix.files_to_modify.length > 0) {
        fixSection += `**Arquivos a modificar**: ${analysis.fix.files_to_modify.map(f => `\`${f}\``).join(', ')}\n\n`;
      }
    } else if (analysis.suggested_fix) {
      fixSection = `### Sugestão de Fix\n\n${analysis.suggested_fix}\n\n`;
    }

    // Build prevention section
    const preventionSection = analysis.prevention
      ? `### Prevenção\n\n**Teste sugerido**: ${analysis.prevention.test_suggestion}\n\n${analysis.prevention.monitoring_suggestion ? `**Monitoramento**: ${analysis.prevention.monitoring_suggestion}\n\n` : ''}`
      : '';

    // Build code snippets section (support both new and legacy)
    let codeSection = '';
    if (analysis.related_code_snippets && analysis.related_code_snippets.length > 0) {
      codeSection = '### Código Relacionado\n\n';
      for (const snippet of analysis.related_code_snippets) {
        codeSection += `**${snippet.file}** (linhas ${snippet.lines})\n`;
        codeSection += `*${snippet.relevance}*\n\`\`\`\n${snippet.code}\n\`\`\`\n\n`;
      }
    } else if (analysis.related_code) {
      codeSection = `### Código Relacionado\n\`\`\`\n${analysis.related_code}\n\`\`\`\n\n`;
    }

    // Build additional context section
    const additionalContextSection = analysis.additional_context
      ? `### Contexto Adicional\n\n${analysis.additional_context}\n\n`
      : '';

    return `${exceptionSection}## Análise (Claude Code)

${stackTraceSection}### Causa Raiz

${rootCauseContent}

${impactSection}### Arquivos Afetados

${files}

${codeSection}${fixSection}${preventionSection}### Investigação Realizada

${steps}

${additionalContextSection}---

## Payload Original

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

---

### Ação Necessária

- [ ] Investigar causa raiz
- [ ] Implementar correção
- [ ] Adicionar teste para prevenir regressão
- [ ] Validar em produção

---
*Fingerprint: \`${fingerprint}\`*
*Analisado por Claude Code*`;
  }
}
