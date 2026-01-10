# Arquitetura do Lineu

## Diagrama

```
+------------------+
|  Fonte de Erros  |
|  (New Relic,     |
|   Sentry, etc)   |
+--------+---------+
         |
   POST qualquer JSON
         |
         v
+------------------+     +------------------+
|  Lineu Server    |---->|    SQLite DB     |
|                  |     |  - jobs (fila)   |
|  POST /webhook   |     |  - fingerprints  |
|  GET /health     |     +--------+---------+
|  GET /stats      |              |
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
+--------+---------+     +------------------+
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
|  Cria issue com: |
|  - Análise       |
|  - Arquivos      |
|  - Sugestões     |
+------------------+
```

## Fluxo de Processamento

1. **Webhook recebe erro** - Salva job no SQLite e retorna 202 imediatamente
2. **Worker processa** - Lê jobs pendentes a cada 10 segundos
3. **Git sync** - Pull roda a cada 5 minutos (independente dos jobs)
4. **Tratamento de falhas** - Se Claude/Linear falhar, job fica `failed` (não cria issue lixo)

## Componentes Principais

| Componente | Arquivo | Responsabilidade |
|------------|---------|------------------|
| CLI | `src/index.ts` | Entry point, comandos serve/test/stats |
| Server | `src/server.ts` | Endpoints Fastify (webhook, health, stats, dashboard) |
| Worker | `src/worker.ts` | Loop de processamento de jobs em background |
| Database | `src/db.ts` | Camada SQLite para jobs e fingerprints |
| Claude | `src/services/claude.ts` | Integração com Claude CLI |
| Linear | `src/services/linear.ts` | Criação de issues via SDK |

## Endpoints HTTP

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/webhook` | Recebe erros (qualquer JSON) |
| GET | `/health` | Health check |
| GET | `/stats` | Estatísticas de jobs |
| GET | `/dashboard` | Dashboard web (requer autenticação) |
