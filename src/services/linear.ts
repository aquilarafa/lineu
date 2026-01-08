import { LinearClient } from '@linear/sdk';
import type { ClaudeAnalysis, LinearIssue } from '../types.js';

export class LinearService {
  private client: LinearClient;
  private teamIdOrKey: string;
  private resolvedTeamId: string | null = null;

  constructor(config: { apiKey: string; teamId: string }) {
    this.client = new LinearClient({ apiKey: config.apiKey });
    this.teamIdOrKey = config.teamId;
  }

  private async getTeamId(): Promise<string> {
    if (this.resolvedTeamId) {
      return this.resolvedTeamId;
    }

    // Check if it's already a UUID
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(this.teamIdOrKey)) {
      this.resolvedTeamId = this.teamIdOrKey;
      return this.resolvedTeamId;
    }

    // Look up team by key
    const teams = await this.client.teams();
    const team = teams.nodes.find(t => t.key === this.teamIdOrKey);
    if (!team) {
      throw new Error(`Team not found with key: ${this.teamIdOrKey}`);
    }

    this.resolvedTeamId = team.id;
    console.log(`[Linear] Resolved team key "${this.teamIdOrKey}" to ID: ${this.resolvedTeamId}`);
    return this.resolvedTeamId;
  }

  async createIssue(
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

    const teamId = await this.getTeamId();
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
