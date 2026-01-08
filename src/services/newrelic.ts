interface NerdGraphResponse {
  data?: {
    actor?: {
      account?: {
        nrql?: {
          results?: Record<string, unknown>[];
        };
      };
    };
  };
  errors?: { message: string }[];
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

  async getErrorDetails(transactionName: string, since = '1 hour ago'): Promise<ErrorDetails | null> {
    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            nrql(query: "SELECT * FROM TransactionError WHERE transactionName = '${transactionName}' SINCE ${since} LIMIT 1") {
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

  async getErrorsByEntityGuid(entityGuid: string, since = '1 hour ago'): Promise<ErrorDetails[]> {
    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            nrql(query: "SELECT * FROM TransactionError WHERE entityGuid = '${entityGuid}' SINCE ${since} LIMIT 5") {
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

  async getRecentErrors(appName: string, since = '1 hour ago', limit = 5): Promise<ErrorDetails[]> {
    const query = `
      {
        actor {
          account(id: ${this.accountId}) {
            nrql(query: "SELECT * FROM TransactionError WHERE appName = '${appName}' SINCE ${since} LIMIT ${limit}") {
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
}
