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
  };
  deduplication: {
    windowDays: number;
  };
  worker: {
    pollInterval: number;
    gitPullInterval: number;
  };
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'duplicate';

export interface Job {
  id: number;
  payload: string;
  fingerprint: string;
  status: JobStatus;
  error?: string;
  analysis?: string;
  linear_issue_id?: string;
  linear_identifier?: string;
  created_at?: string;
  processed_at?: string;
}

export type ClaudeEventType = 'text' | 'tool_use' | 'tool_result' | 'result' | 'error';

export interface ClaudeSessionEvent {
  ts: string;
  type: ClaudeEventType;
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  lines?: number;
  duration_ms?: number;
  message?: string;
}

export interface ClaimedJob {
  id: number;
  payload: string;
  fingerprint: string;
}

export interface DashboardJob {
  id: number;
  fingerprint: string;
  status: string;
  error: string | null;
  linear_identifier: string | null;
  created_at: string;
  processed_at: string | null;
  duration_seconds: number | null;
}

export interface TimelineEntry {
  hour: string;
  total: number;
  completed: number;
  failed: number;
}

export interface ClaudeAnalysis {
  category: 'bug' | 'infrastructure' | 'database' | 'external-service' | 'configuration' | 'performance' | 'security';
  priority: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  exception?: {
    type: string;
    message: string;
  };
  stack_trace_summary?: string;
  affected_files: string[];
  root_cause: {
    hypothesis: string;
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
  };
  impact?: {
    description: string;
    scope: string;
  };
  fix: {
    suggestion: string;
    code_example?: string;
    files_to_modify: string[];
  };
  prevention?: {
    test_suggestion: string;
    monitoring_suggestion?: string;
  };
  investigation_log: string[];
  related_code_snippets?: Array<{
    file: string;
    lines: string;
    code: string;
    relevance: string;
  }>;
  suggested_team: string | null;
  additional_context?: string;
  // Legacy fields for backwards compatibility
  root_cause_hypothesis?: string;
  suggested_fix?: string;
  investigation_steps?: string[];
  related_code?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
}

export interface TeamInfo {
  id: string;
  key: string;
  name: string;
}
