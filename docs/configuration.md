# Configuração

## Arquivo de Configuração

O Lineu usa um arquivo YAML para configurar quais times do Linear podem receber issues.

**Localização padrão:** `~/.lineu/config.yml`

```yaml
# Lista de team keys do Linear permitidos para sugestão.
# Se omitido, Claude usa todos os times ativos da API.
teams:
  - ENG
  - INFRA
  - PRODUCT
```

## Comportamento

| Cenário | Resultado |
|---------|-----------|
| Arquivo não existe (path padrão) | Usa todos os times, sem erro |
| Arquivo não existe (via `--config`) | Erro |
| Arquivo malformado | Erro com mensagem do parser YAML |
| Time configurado não existe no Linear | Warning no log |

## Variáveis de Ambiente

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `LINEAR_API_KEY` | Sim | API key do Linear para criar issues |
| `DASHBOARD_USER` | Não | Usuário para autenticação do dashboard |
| `DASHBOARD_PASS` | Não | Senha para autenticação do dashboard |

## Exemplo `.env`

```bash
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx
DASHBOARD_USER=admin
DASHBOARD_PASS=senha-segura
```
