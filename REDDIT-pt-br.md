# Lineu: Automatizei a triagem de erros da minha aplicação com Claude CLI

**TL;DR:** Criei uma ferramenta open-source que recebe alertas de erro (New Relic, Sentry, etc), usa o Claude CLI para analisar o código fonte, e cria issues no Linear automaticamente com diagnóstico completo.

---

## O problema

Todo dev conhece esse ciclo:
1. Alerta de erro chega no Slack/email
2. Você abre o dashboard de monitoramento
3. Copia o stack trace
4. Procura no código onde o problema está
5. Tenta entender o contexto
6. Cria uma issue manualmente

Isso consome tempo e interrompe o foco.

## A solução

**Lineu** é um servidor webhook que:

1. **Recebe** qualquer JSON de erro (compatível com New Relic, Sentry, ou formato customizado)
2. **Analisa** o erro usando Claude CLI diretamente no seu repositório
3. **Cria** issues no Linear com análise completa: causa raiz, arquivos afetados, sugestão de fix, e até snippets de código

O Claude navega pelo código como um dev sênior faria - grep, leitura de arquivos, análise de dependências.

## Como funciona

```bash
# Inicia o servidor apontando para seu repo
lineu serve --repo /path/to/your/project

# Configure o webhook no New Relic/Sentry
# POST http://seu-servidor:3000/webhook
```

O dashboard mostra todos os jobs, a sessão do Claude trabalhando, e link direto para a issue criada.

## Stack

- TypeScript + Fastify
- Claude CLI (usa sua chave local)
- SQLite para fila de jobs
- Linear SDK para criar issues

## Screenshots

Ver pasta `reddit-screenshots/`:
- `dashboard.png` - Dashboard com estatísticas e lista de jobs
- `job-session.png` - Sessão do Claude analisando um bug
- `job-analysis.png` - Análise estruturada gerada

## Links

- GitHub: [aquilarafa/lineu](https://github.com/aquilarafa/lineu)
- MIT License

---

Feedback é bem-vindo! Estou usando em produção há algumas semanas e tem economizado bastante tempo na triagem de erros.
