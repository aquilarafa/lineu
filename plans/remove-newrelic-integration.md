# Remove New Relic Integration

## Overview

Remover completamente a integração com New Relic do Lineu. O enriquecimento de payloads será responsabilidade do cliente que envia o webhook.

## Motivação

- Simplificar o Lineu para ser apenas um processador de webhooks genérico
- O cliente já pode enviar payloads enriquecidos com dados do New Relic
- Reduzir complexidade e dependências externas

## Arquivos a Modificar

### 1. Deletar Completamente

| Arquivo | Motivo |
|---------|--------|
| `src/services/newrelic.ts` | Serviço de integração com NerdGraph |
| `docs/solutions/security-issues/nrql-and-prompt-injection-prevention.md` | Doc específica de NRQL |

### 2. Modificar

#### `src/server.ts`
- [ ] Remover import do `NewRelicService` (linha 5)
- [ ] Remover interface `NewRelicWebhookPayload` (linhas 8-32)
- [ ] Remover inicialização do `newrelic` service (linhas 40-43)
- [ ] Remover endpoint `/webhook/newrelic` completo (linhas 64-189)
- [ ] Remover `newrelicConfigured` do health check (linha 195)

#### `src/types.ts`
- [ ] Remover campo `newrelic?` da interface `LineuConfig` (linhas 19-22)

#### `src/lib/config.ts`
- [ ] Remover leitura de `NEWRELIC_API_KEY` e `NEWRELIC_ACCOUNT_ID` (linhas 24-26)
- [ ] Remover atribuição condicional de `newrelic` config (linhas 46-49)

#### `src/worker.ts`
- [ ] Remover verificação de `nerdGraphFailed` (linhas 82-88)

#### `.env.example`
- [ ] Remover variáveis `NEWRELIC_API_KEY` e `NEWRELIC_ACCOUNT_ID` (linhas 5-7)

### 3. Documentação 

Estes arquivos mencionam New Relic:
- `docs/solutions/integration-issues/lineu-error-triage-claude-code-linear.md`
- `docs/prevention-strategies.md`

## Acceptance Criteria

- [ ] Endpoint `/webhook/newrelic` não existe mais
- [ ] `NewRelicService` removido
- [ ] Config não requer `NEWRELIC_*` env vars
- [ ] Health check não menciona `newrelicConfigured`
- [ ] Build passa sem erros
- [ ] Endpoint `/webhook` genérico continua funcionando

## Impacto

- **Breaking Change**: Clientes usando `/webhook/newrelic` precisam migrar para `/webhook`
- **Simplificação**: Menos código, menos dependências, menos pontos de falha

## Ordem de Execução

1. Deletar `src/services/newrelic.ts`
2. Limpar `src/server.ts`
3. Limpar `src/types.ts`
4. Limpar `src/lib/config.ts`
5. Limpar `src/worker.ts`
6. Limpar `.env.example`
7. Deletar doc de NRQL injection
8. Build e verificar
