# Roadmap

## P1 - Crítico (Antes de Produção)

### Segurança
- [ ] Adicionar autenticação no webhook (HMAC signature ou shared secret header)
- [ ] Implementar rate limiting com `@fastify/rate-limit` em todos endpoints
- [ ] Adicionar autenticação no endpoint `/jobs/:id` (expõe payloads e análises)
- [ ] Validar URLs de repositório git (restringir a `https://` e `git@`)
- [ ] Melhorar detecção de prompt injection (Unicode homoglyphs, encoding bypasses)

### Integridade de Dados
- [ ] Wrap `insertFingerprint` + `markCompleted` em transação atômica
- [ ] Implementar recuperação de jobs stuck em `processing` (heartbeat/lease com timeout)
- [ ] Corrigir race condition na deduplicação (lock no fingerprint antes de processar)

## P2 - Importante

### Performance
- [ ] Cache template do prompt no constructor do ClaudeService (evitar leitura sync por job)
- [ ] Adicionar índice composto `idx_jobs_status_created ON jobs(status, created_at)`
- [ ] Adicionar índice `idx_jobs_created_at ON jobs(created_at)` para queries de timeline
- [ ] Implementar contadores materializados para stats (evitar full table scan)
- [ ] Adicionar exponential backoff no polling do worker quando fila vazia

### Segurança
- [ ] Usar `crypto.timingSafeEqual` para comparação de credenciais do dashboard
- [ ] Configurar headers de segurança (Helmet.js ou equivalente)
- [ ] Remover path do repositório do endpoint `/health`

### Qualidade de Código
- [ ] Consolidar funções `gitPull` duplicadas (worker.ts + lib/git.ts)
- [ ] Criar módulo centralizado `lib/paths.ts` para paths `~/.lineu/*`
- [ ] Adicionar validação runtime para JSON.parse (safe parse wrapper)
- [ ] Adicionar schema validation no webhook com Fastify JSON Schema
- [ ] Validar output do Claude contra interface `ClaudeAnalysis`
- [ ] Criar type guards para error narrowing (`isErrnoException`)
- [ ] Habilitar foreign keys no SQLite (`PRAGMA foreign_keys = ON`)

### Manutenibilidade
- [ ] Implementar rotação/cleanup de log files em `~/.lineu/logs`
- [ ] Remover suporte a formato legacy em `buildDescription` (ou migrar dados)
- [ ] Extrair helper `resolveRepoPath` para evitar duplicação em serve/test

## P3 - Nice-to-Have

### Cleanup
- [ ] Remover código não usado: `getPendingJobs`, `markProcessing` em db.ts
- [ ] Remover path traversal check redundante em `dashboard/routes.ts:89`
- [ ] Simplificar fingerprint para single-pass (combinar `removeDynamicFields` + `sortObjectKeys`)
- [ ] Adicionar radix em `parseInt(opts.port)` no index.ts

### Qualidade
- [ ] Substituir `console.log` por logger estruturado (pino)
- [ ] Definir constantes para magic numbers (LIMIT 100, etc)
- [ ] Adicionar barrel exports em `lib/index.ts`
- [ ] Considerar usar UUIDs ao invés de IDs sequenciais para jobs

### Testes
- [ ] Adicionar testes unitários para fingerprinting
- [ ] Adicionar testes de integração para worker loop (mock Claude/Linear)
- [ ] Adicionar testes para database layer
- [ ] Adicionar testes para API endpoints

## Backlog

### Features
- [ ] Alterar prompt do Claude para ser em inglês
- [ ] Permitir o cliente configurar no arquivo de configuração a linguagem que a issue do Linear será escrita (default: en)
- [ ] Implementar retry automático para jobs com falhas transientes
- [ ] Adicionar worker concurrency (processar múltiplos jobs em paralelo)
- [ ] Implementar sistema de migrations com versionamento

### Documentação
- [ ] Criar documentação extensiva para deploy do Lineu em servidor (requisitos, configuração de ambiente, systemd/Docker, proxy reverso, monitoramento)
- [ ] Documentar requisito de HTTPS para basic auth do dashboard

### Release
- [ ] Publicar repositório no GitHub
- [ ] Rodar `npm audit` e atualizar dependências vulneráveis
