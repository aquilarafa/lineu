export interface LineuConfig {
  server: {
    port: number;
  };
  repo: {
    path: string;
    url?: string;
  };
  database: {
    path: string;
  };
  claude: {
    maxTurns: number;
    timeout: number;
  };
  linear: {
    apiKey: string;
    teamId: string;
  };
  newrelic?: {
    apiKey: string;
    accountId: string;
  };
  deduplication: {
    windowDays: number;
  };
  worker: {
    pollInterval: number;
    gitPullInterval: number;
  };
}

export interface Job {
  id: number;
  payload: string;
  fingerprint: string;
  status: string;
  error?: string;
  linear_issue_id?: string;
  linear_identifier?: string;
  created_at?: string;
  processed_at?: string;
}

export interface ClaimedJob {
  id: number;
  payload: string;
  fingerprint: string;
}

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

export interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
}
