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

    const steps = analysis.investigation_steps
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n');

    const code = analysis.related_code
      ? `### Código Relacionado\n\`\`\`\n${analysis.related_code}\n\`\`\`\n\n`
      : '';

    return `## Análise (Claude Code)

### Causa Provável
${analysis.root_cause_hypothesis}

### Arquivos Afetados
${files}

${code}### Sugestão de Fix
${analysis.suggested_fix}

### Investigação
${steps}

---

## Payload Original

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

---
*Fingerprint: \`${fingerprint}\`*
*Analisado por Claude Code*`;
  }
}
