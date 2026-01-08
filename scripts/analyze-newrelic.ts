import 'dotenv/config';

const API_KEY = process.env.NEWRELIC_API_KEY!;
const ACCOUNT_ID = process.env.NEWRELIC_ACCOUNT_ID!;
const ENDPOINT = 'https://api.newrelic.com/graphql';

interface NerdGraphResponse {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

async function query(gql: string): Promise<NerdGraphResponse> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API-Key': API_KEY,
    },
    body: JSON.stringify({ query: gql }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<NerdGraphResponse>;
}

async function main() {
  console.log('='.repeat(60));
  console.log('ANÁLISE DE ALERTAS - NEW RELIC');
  console.log('Account ID:', ACCOUNT_ID);
  console.log('='.repeat(60));

  // 1. Buscar Alert Policies
  console.log('\n📋 POLICIES DE ALERTA');
  console.log('-'.repeat(40));

  const policiesResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        alerts {
          policiesSearch {
            policies {
              id
              name
              incidentPreference
            }
            totalCount
          }
        }
      }
    }
  }`);

  const policies = (policiesResult.data as any)?.actor?.account?.alerts?.policiesSearch?.policies || [];
  console.log(`Total de policies: ${policies.length}`);
  policies.forEach((p: any) => {
    console.log(`  - [${p.id}] ${p.name} (${p.incidentPreference})`);
  });

  // 2. Buscar NRQL Alert Conditions
  console.log('\n⚡ CONDIÇÕES DE ALERTA (NRQL)');
  console.log('-'.repeat(40));

  const conditionsResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        alerts {
          nrqlConditionsSearch {
            nrqlConditions {
              id
              name
              enabled
              policyId
              nrql {
                query
              }
              signal {
                aggregationWindow
              }
              terms {
                threshold
                thresholdOccurrences
                thresholdDuration
                operator
                priority
              }
            }
            totalCount
          }
        }
      }
    }
  }`);

  const conditions = (conditionsResult.data as any)?.actor?.account?.alerts?.nrqlConditionsSearch?.nrqlConditions || [];
  console.log(`Total de condições NRQL: ${conditions.length}`);
  conditions.forEach((c: any) => {
    const status = c.enabled ? '✅' : '❌';
    console.log(`\n  ${status} [${c.id}] ${c.name}`);
    console.log(`     Policy ID: ${c.policyId}`);
    console.log(`     Query: ${c.nrql?.query}`);
    console.log(`     Termos:`);
    c.terms?.forEach((t: any) => {
      console.log(`       - ${t.priority}: ${t.operator} ${t.threshold} por ${t.thresholdDuration}s (${t.thresholdOccurrences})`);
    });
  });

  // 3. Buscar Workflows
  console.log('\n🔄 WORKFLOWS');
  console.log('-'.repeat(40));

  const workflowsResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        aiWorkflows {
          workflows {
            entities {
              id
              name
              enrichmentsEnabled
              destinationsEnabled
              workflowEnabled
              issuesFilter {
                predicates {
                  attribute
                  operator
                  values
                }
              }
              destinationConfigurations {
                channelId
                name
                type
              }
            }
            totalCount
          }
        }
      }
    }
  }`);

  const workflows = (workflowsResult.data as any)?.actor?.account?.aiWorkflows?.workflows?.entities || [];
  console.log(`Total de workflows: ${workflows.length}`);
  workflows.forEach((w: any) => {
    const status = w.workflowEnabled ? '✅' : '❌';
    console.log(`\n  ${status} [${w.id}] ${w.name}`);
    console.log(`     Enrichments: ${w.enrichmentsEnabled ? 'Sim' : 'Não'}`);
    console.log(`     Destinations: ${w.destinationsEnabled ? 'Sim' : 'Não'}`);

    if (w.issuesFilter?.predicates?.length) {
      console.log(`     Filtros:`);
      w.issuesFilter.predicates.forEach((p: any) => {
        console.log(`       - ${p.attribute} ${p.operator} [${p.values?.join(', ')}]`);
      });
    }

    if (w.destinationConfigurations?.length) {
      console.log(`     Destinos:`);
      w.destinationConfigurations.forEach((d: any) => {
        console.log(`       - ${d.type}: ${d.name}`);
      });
    }
  });

  // 4. Buscar Destinations
  console.log('\n📬 DESTINATIONS (Canais de Notificação)');
  console.log('-'.repeat(40));

  const destinationsResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        aiNotifications {
          destinations {
            entities {
              id
              name
              type
              active
              status
            }
            totalCount
          }
        }
      }
    }
  }`);

  const destinations = (destinationsResult.data as any)?.actor?.account?.aiNotifications?.destinations?.entities || [];
  console.log(`Total de destinations: ${destinations.length}`);
  destinations.forEach((d: any) => {
    const status = d.active ? '✅' : '❌';
    console.log(`  ${status} [${d.id}] ${d.name} (${d.type}) - Status: ${d.status}`);
  });

  // 5. Buscar erros recentes para comparar
  console.log('\n🔴 ERROS RECENTES (últimas 24h)');
  console.log('-'.repeat(40));

  const errorsResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        nrql(query: "SELECT count(*) as total, uniqueCount(error.message) as unique_errors, uniqueCount(appName) as apps FROM TransactionError SINCE 24 hours ago") {
          results
        }
      }
    }
  }`);

  const errorStats = (errorsResult.data as any)?.actor?.account?.nrql?.results?.[0];
  if (errorStats) {
    console.log(`  Total de erros: ${errorStats.total}`);
    console.log(`  Mensagens únicas: ${errorStats.unique_errors}`);
    console.log(`  Apps afetados: ${errorStats.apps}`);
  }

  // 6. Top erros por mensagem
  console.log('\n🔥 TOP 10 ERROS POR FREQUÊNCIA');
  console.log('-'.repeat(40));

  const topErrorsResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        nrql(query: "SELECT count(*) FROM TransactionError FACET error.message, appName SINCE 24 hours ago LIMIT 10") {
          results
        }
      }
    }
  }`);

  const topErrors = (topErrorsResult.data as any)?.actor?.account?.nrql?.results || [];
  topErrors.forEach((e: any, i: number) => {
    console.log(`  ${i + 1}. [${e.count}x] ${e.appName}: ${(e['error.message'] || 'Unknown').substring(0, 60)}...`);
  });

  // 7. Buscar incidentes recentes
  console.log('\n🚨 INCIDENTES RECENTES (últimas 24h)');
  console.log('-'.repeat(40));

  const incidentsResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        nrql(query: "SELECT count(*) FROM NrAiIncident SINCE 24 hours ago") {
          results
        }
      }
    }
  }`);

  const incidentStats = (incidentsResult.data as any)?.actor?.account?.nrql?.results?.[0];
  console.log(`  Total de incidentes: ${incidentStats?.count || 0}`);

  // 8. Comparação: erros vs incidentes
  console.log('\n📊 ANÁLISE DE GAPS');
  console.log('='.repeat(60));

  const totalErrors = errorStats?.total || 0;
  const totalIncidents = incidentStats?.count || 0;
  const uniqueErrors = errorStats?.unique_errors || 0;

  console.log(`\n  Erros nas últimas 24h: ${totalErrors}`);
  console.log(`  Mensagens de erro únicas: ${uniqueErrors}`);
  console.log(`  Incidentes gerados: ${totalIncidents}`);
  console.log(`  Cobertura: ${uniqueErrors > 0 ? Math.round((totalIncidents / uniqueErrors) * 100) : 0}%`);

  // Verificar condições desabilitadas
  const disabledConditions = conditions.filter((c: any) => !c.enabled);
  if (disabledConditions.length > 0) {
    console.log(`\n  ⚠️ ATENÇÃO: ${disabledConditions.length} condição(ões) desabilitada(s):`);
    disabledConditions.forEach((c: any) => {
      console.log(`     - ${c.name}`);
    });
  }

  // Verificar workflows desabilitados
  const disabledWorkflows = workflows.filter((w: any) => !w.workflowEnabled);
  if (disabledWorkflows.length > 0) {
    console.log(`\n  ⚠️ ATENÇÃO: ${disabledWorkflows.length} workflow(s) desabilitado(s):`);
    disabledWorkflows.forEach((w: any) => {
      console.log(`     - ${w.name}`);
    });
  }

  // Verificar destinations inativos
  const inactiveDestinations = destinations.filter((d: any) => !d.active);
  if (inactiveDestinations.length > 0) {
    console.log(`\n  ⚠️ ATENÇÃO: ${inactiveDestinations.length} destination(s) inativo(s):`);
    inactiveDestinations.forEach((d: any) => {
      console.log(`     - ${d.name} (${d.type})`);
    });
  }

  // Buscar erros que não têm condições
  console.log('\n  🔍 ERROS SEM COBERTURA DE ALERTA:');

  const errorClassesResult = await query(`{
    actor {
      account(id: ${ACCOUNT_ID}) {
        nrql(query: "SELECT uniqueCount(error.message) as count, latest(error.message) as example FROM TransactionError FACET error.class SINCE 24 hours ago LIMIT 20") {
          results
        }
      }
    }
  }`);

  const errorClasses = (errorClassesResult.data as any)?.actor?.account?.nrql?.results || [];

  // Verificar quais classes de erro não têm condições de alerta correspondentes
  const conditionQueries = conditions.map((c: any) => c.nrql?.query?.toLowerCase() || '');

  errorClasses.forEach((ec: any) => {
    const errorClass = ec['error.class'] || 'Unknown';
    const hasAlert = conditionQueries.some((q: string) =>
      q.includes(errorClass.toLowerCase()) ||
      q.includes('transactionerror')
    );

    if (!hasAlert) {
      console.log(`     ❌ ${errorClass} (${ec.count} erros únicos)`);
      console.log(`        Exemplo: ${(ec.example || '').substring(0, 50)}...`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('FIM DA ANÁLISE');
  console.log('='.repeat(60));
}

main().catch(console.error);
