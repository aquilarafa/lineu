// NRQL injection prevention - reject inputs with SQL/NRQL metacharacters
const NRQL_FORBIDDEN = /['";]|--|\b(OR|AND|FACET|SELECT|FROM|WHERE|LIMIT|SINCE)\b/i;

function sanitizeNrqlInput(input: string, fieldName: string): string {
  if (NRQL_FORBIDDEN.test(input)) {
    console.warn(`[NewRelic] Rejected ${fieldName}: contains forbidden NRQL characters`);
    throw new Error(`Invalid ${fieldName}: contains forbidden characters`);
  }
  return input;
}

interface NerdGraphResponse {
  data?: {
    actor?: {
      account?: {
        nrql?: {
          results?: Record<string, unknown>[];
        };
        aiIssues?: {
          issues?: {
            issues?: AiIssue[];
          };
        };
      };
    };
  };
  errors?: { message: string }[];
}

interface AiIssue {
  issueId: string;
  title: string;
  priority: string;
  state: string;
  entityGuids: string[];
  entityNames: string[];
  incidentIds: string[];
  createdAt: number;
  activatedAt: number;
  closedAt: number;
  sources: string[];
}

interface ErrorDetails {
  message: string;
  errorClass: string;
  stackTrace: string;
  transactionName: string;
  host: string;
  timestamp: number;
  attributes: Record<string, unknown>;
}

export class NewRelicService {
  private apiKey: string;
  private accountId: string;
  private endpoint = 'https://api.newrelic.com/graphql';

  constructor(config: { apiKey: string; accountId: string }) {
    this.apiKey = config.apiKey;
    this.accountId = config.accountId;
  }

  async getIssueById(issueId: string): Promise<AiIssue | null> {
    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            aiIssues {
              issues(filter: {ids: ["${issueId}"]}) {
                issues {
                  issueId
                  title
                  priority
                  state
                  entityGuids
                  entityNames
                  incidentIds
                  createdAt
                  activatedAt
                  closedAt
                  sources
                }
              }
            }
          }
        }
      }
    `;

    const response = await this.queryWithExperimental(query);
    const issues = response.data?.actor?.account?.aiIssues?.issues?.issues;

    if (!issues || issues.length === 0) {
      return null;
    }

    return issues[0];
  }

  async getErrorDetails(transactionName: string, since = '1 hour ago'): Promise<ErrorDetails | null> {
    const safeName = sanitizeNrqlInput(transactionName, 'transactionName');
    const safeSince = sanitizeNrqlInput(since, 'since');

    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            nrql(query: "SELECT * FROM TransactionError WHERE transactionName = '${safeName}' SINCE ${safeSince} LIMIT 1") {
              results
            }
          }
        }
      }
    `;

    const response = await this.query(query);
    const results = response.data?.actor?.account?.nrql?.results;

    if (!results || results.length === 0) {
      return null;
    }

    const error = results[0];
    return {
      message: String(error['error.message'] || error.message || 'Unknown error'),
      errorClass: String(error['error.class'] || error.errorClass || 'Unknown'),
      stackTrace: String(error['error.stack'] || error.stackTrace || ''),
      transactionName: String(error.transactionName || transactionName),
      host: String(error.host || 'Unknown'),
      timestamp: Number(error.timestamp || Date.now()),
      attributes: error,
    };
  }

  async getErrorsByEntityGuid(entityGuid: string, since = '1 hour ago', errorClass?: string): Promise<ErrorDetails[]> {
    const safeGuid = sanitizeNrqlInput(entityGuid, 'entityGuid');
    const safeSince = sanitizeNrqlInput(since, 'since');

    let whereClause = `entityGuid = '${safeGuid}'`;
    if (errorClass) {
      const safeErrorClass = sanitizeNrqlInput(errorClass, 'errorClass');
      whereClause += ` AND error.class = '${safeErrorClass}'`;
    }

    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            nrql(query: "SELECT * FROM TransactionError WHERE ${whereClause} SINCE ${safeSince} LIMIT 5") {
              results
            }
          }
        }
      }
    `;

    const response = await this.query(query);
    const results = response.data?.actor?.account?.nrql?.results || [];

    return results.map((error) => ({
      message: String(error['error.message'] || error.message || 'Unknown error'),
      errorClass: String(error['error.class'] || error.errorClass || 'Unknown'),
      stackTrace: String(error['error.stack'] || error.stackTrace || ''),
      transactionName: String(error.transactionName || 'Unknown'),
      host: String(error.host || 'Unknown'),
      timestamp: Number(error.timestamp || Date.now()),
      attributes: error,
    }));
  }

  async getRecentErrors(appName: string, since = '1 hour ago', limit = 5, errorClass?: string): Promise<ErrorDetails[]> {
    const safeAppName = sanitizeNrqlInput(appName, 'appName');
    const safeSince = sanitizeNrqlInput(since, 'since');
    // limit is a number, no need for string sanitization

    let whereClause = `appName = '${safeAppName}'`;
    if (errorClass) {
      const safeErrorClass = sanitizeNrqlInput(errorClass, 'errorClass');
      whereClause += ` AND error.class = '${safeErrorClass}'`;
    }

    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            nrql(query: "SELECT * FROM TransactionError WHERE ${whereClause} SINCE ${safeSince} LIMIT ${limit}") {
              results
            }
          }
        }
      }
    `;

    const response = await this.query(query);
    const results = response.data?.actor?.account?.nrql?.results || [];

    return results.map((error) => ({
      message: String(error['error.message'] || error.message || 'Unknown error'),
      errorClass: String(error['error.class'] || error.errorClass || 'Unknown'),
      stackTrace: String(error['error.stack'] || error.stackTrace || ''),
      transactionName: String(error.transactionName || 'Unknown'),
      host: String(error.host || 'Unknown'),
      timestamp: Number(error.timestamp || Date.now()),
      attributes: error,
    }));
  }

  private async query(query: string): Promise<NerdGraphResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': this.apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`NerdGraph API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as NerdGraphResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`NerdGraph query error: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return data;
  }

  private async queryWithExperimental(query: string): Promise<NerdGraphResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': this.apiKey,
        'nerd-graph-unsafe-experimental-opt-in': 'AiIssues',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`NerdGraph API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as NerdGraphResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`NerdGraph query error: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return data;
  }
}
