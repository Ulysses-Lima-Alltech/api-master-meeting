# Auditoria técnica do Vexa em Railway para uso 100% via API

Baseado na leitura do repositório, dos arquivos de deploy lite para Railway, dos modelos do banco e dos logs de inicialização e tráfego já capturados no projeto.

- Gateway público validado
- Transcrição por API viável
- Stop por API viável
- API externa interna não recomendada

## Índice
- Resumo executivo
- Topologia em Railway
- Modelo de autenticação
- Fluxo operacional via API
- Endpoints que importam
- Banco de dados e persistência
- Evidências de funcionamento
- Riscos e divergências
- Guia recomendado de integração
- Arquivos-chave auditados

## Resumo executivo
Sim, é possível operar o foco principal do programa só por API: enviar um bot para a reunião, consultar a transcrição durante e depois da reunião, e remover o bot sem depender da interface. O caminho correto não é a API “externa” embutida, e sim a API pública servida pelo gateway, autenticada com uma chave de usuário de escopos `bot,tx`.

A leitura do código mostra que o `meeting-api` concentra os domínios de bot, transcrição, gravações e lifecycle, enquanto o `gateway` apenas autentica, injeta identidade e encaminha. A leitura dos logs mostra que, no deploy lite do Railway, os serviços subiram e o gateway já encaminhou com sucesso chamadas reais para `/meetings` e `/transcripts/by-id/*`, o que confirma que o fluxo público central está ativo.

**O que usar**
`POST /bots`, `GET /transcripts/by-id/{meeting_id}`, `DELETE /bots/{platform}/{native_meeting_id}`, tudo via gateway.

**O que evitar**
`/api/external/*`, porque usa segredo interno e fixa `user_id=1`, o que inviabiliza uma integração limpa e segura.

**O que é durável**
As transcrições vão para `transcriptions`, e a leitura também mescla o que ainda está temporariamente em Redis.

**Ponto de atenção**
Gravação depende de object storage funcional. Se o foco for só transcrição, vale desligar `recording_enabled` até validar storage.

**Conclusão prática**
Para a sua integração backend, trate o sistema como três camadas: `admin-api` para criar usuário e mintar a chave, `gateway` como frente pública para operar bot e transcrição, e `meeting-api` apenas como backend interno. A interface pode ser construída separadamente sem bloquear o uso operacional da API.

## Topologia em Railway
O deploy lite usa um único container com supervisord, e dentro dele sobem `admin-api`, `meeting-api`, `gateway`, `runtime`, `agent-api`, `terminal`, além de X11, áudio e um Redis local. O nginx publica tudo na porta externa 3001, enquanto o gateway escuta internamente em 8056 e encaminha para `meeting-api` em 8081 e `admin-api` em 8001.

* Figura 1: o caminho relevante para API pública é cliente → gateway → meeting-api/admin-api, com Redis e Postgres no backend.

| Componente | Papel | Porta interna | Observação para integração |
|---|---|---|---|
| Gateway | Frente pública, autenticação por X-API-Key, injeção de x-user-id | 8056 | É a URL pública que sua integração deve consumir. |
| Admin API | CRUD de usuários e tokens, /internal/validate | 8001 | Use para bootstrap da chave de integração. |
| Meeting API | Bot spawn, stop, transcrições, reuniões, gravações | 8081 | Não exponha diretamente para o cliente externo. |
| Runtime | Cria processos do bot e workers | 8090 | Camada interna; sua integração não precisa chamar diretamente. |
| Postgres | Persistência durável | externo Railway | Fonte final para reuniões e transcrições consolidadas. |
| Redis | Segmentos vivos, pubsub e buffers temporários | externo e local | A leitura do transcript usa Redis + Postgres ao mesmo tempo. |

## Modelo de autenticação
Existem três superfícies diferentes no código e elas não devem ser confundidas. A integração correta passa por token de usuário no gateway; a API externa embutida usa segredo interno e foi implementada como atalho operacional, não como contrato público seguro.

| Superfície | Como autentica | Quando usar | Conclusão |
|---|---|---|---|
| Gateway público | X-API-Key de um api_tokens válido; o gateway consulta /internal/validate | Enviar bot, listar reuniões, puxar transcrição, parar bot, listar gravações | É o caminho recomendado. |
| Admin API | X-Admin-API-Key igual ao segredo administrativo | Criar usuário e gerar token com escopos bot,tx | Use só para bootstrap e administração. |
| /api/external/* | X-API-Key comparado com INTERNAL_API_SECRET | Atalho interno criado dentro do meeting-api | Não recomendado para a sua integração. |

Os escopos válidos para token de usuário são `bot`, `tx` e `browser`. Para o caso de uso descrito, a combinação correta é `bot,tx`, porque `/bots` exige escopo bot ou browser, enquanto `/transcripts` e `/meetings` exigem tx.

**Achado importante**
A rota interna `core/meetings/services/meeting-api/src/meeting_api/external_api/router.py` faz spawn e leitura de transcrição com `user_id=1` fixo. Isso quebra isolamento multiusuário e significa que ela não deve ser tratada como API pública real para produção.

## Fluxo operacional via API

**1. Criar ou localizar o usuário da integração**
A camada administrativa tem endpoints para criar usuário por e-mail e gerar tokens por usuário. Isso permite que sua futura interface ou backend opere sem depender da UI do Terminal.
- `POST /admin/users`
- `GET /admin/users/email/{email}`
- `POST /admin/users/{user_id}/tokens?scopes=bot,tx`

**2. Enviar o bot para a reunião**
O endpoint público é `POST /bots`. Ele aceita `platform` e `native_meeting_id`, ou apenas `meeting_url` quando o link já está disponível, e o backend resolve o resto, cria a linha em `meetings`, cria `meeting_sessions` e pede ao runtime para subir o bot.

```http
POST /bots
X-API-Key: <token do usuário>
Content-Type: application/json

{
  "platform": "google_meet",
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "bot_name": "Vexa Recorder",
  "language": "pt-BR",
  "transcribe_enabled": true,
  "recording_enabled": false
}
```

**3. Acompanhar a reunião e descobrir o meeting_id**
A resposta do spawn já retorna a reunião criada, inclusive o identificador numérico. Se você quiser confirmar o estado, pode consultar `GET /bots/status` ou `GET /meetings`.

**4. Ler a transcrição em andamento ou concluída**
O endpoint mais confiável para integração é `GET /transcripts/by-id/{meeting_id}`. Ele monta a resposta juntando o que já foi persistido em `transcriptions` com o que ainda está vivo em Redis, então serve tanto para reunião ativa quanto para reunião já encerrada.

**5. Remover o bot da reunião**
O caminho robusto é `DELETE /bots/{platform}/{native_meeting_id}`. Ele marca a reunião como stopping, publica o comando `{"action":"leave"}` em Redis e, se o bot ainda estiver em fase de boot, tenta derrubar o workload diretamente para evitar processo órfão.

**6. Consultar gravações, se storage estiver pronto**
As rotas `GET /recordings`, `GET /recordings/{recording_id}` e `GET /recordings/{recording_id}/master?type=audio` existem, mas dependem de upload e finalização em object storage. Como a sua meta é operar por API, isso é suportado pelo desenho do sistema, mas precisa de storage validado primeiro.

## Endpoints que importam

| Método | Rota | Camada | Uso | Autenticação |
|---|---|---|---|---|
| POST | /admin/users | admin-api | Criar usuário técnico da integração | X-Admin-API-Key |
| POST | /admin/users/{user_id}/tokens?scopes=bot,tx | admin-api | Gerar token para a integração | X-Admin-API-Key |
| GET | /auth/me | gateway | Verificar se a chave pública está válida | X-API-Key |
| POST | /bots | gateway → meeting-api | Enviar robô para a reunião | X-API-Key com bot |
| GET | /bots/status | gateway → meeting-api | Listar bots em execução | X-API-Key |
| GET | /meetings | gateway → meeting-api | Listar reuniões do usuário | X-API-Key com tx |
| GET | /transcripts/by-id/{meeting_id} | gateway → meeting-api | Ler transcript da linha exata | X-API-Key com tx |
| GET | /transcripts/{platform}/{native_meeting_id} | gateway → meeting-api | Ler transcript pela chave nativa da reunião | X-API-Key com tx |
| DELETE | /bots/{platform}/{native_meeting_id} | gateway → meeting-api | Parar bot e pedir saída da reunião | X-API-Key com bot |
| GET | /recordings | gateway → meeting-api | Listar gravações anexadas às reuniões | X-API-Key com tx ou bot |

**Rota pública que eu não recomendo usar**
O gateway expõe `POST /bots/{platform}/{native_meeting_id}/stop`, mas o route real do fluxo público de stop no `meeting-api` é `DELETE /bots/{platform}/{native_meeting_id}`. A variante em `POST .../stop` só aparece na API externa interna, então há uma divergência de contrato e o seu backend deve padronizar em `DELETE`.

## Banco de dados e persistência
O banco real do core API é Postgres, com Redis atuando como camada viva para segmentos ainda mutáveis e pubsub. A parte importante para o seu caso é que não existe tabela dedicada de gravações: gravações e metadados ficam dentro de `meetings.data` em JSONB.

| Tabela | Função | Campos-chave | Observação operacional |
|---|---|---|---|
| users | Usuários da API | email, max_concurrent_bots, data | data guarda webhook, memberships e preferências. |
| api_tokens | Tokens de autenticação | token, user_id, scopes, expires_at | É a fonte de verdade do gateway para validar X-API-Key. |
| platform_settings | Config global | key, value | Usado para defaults de modelo e transcrição. |
| meetings | Linha central da reunião | id, user_id, platform, platform_specific_id, status, data | data concentra gravações, notes, docs, workspace bind e dados auxiliares. |
| transcriptions | Segmentos persistidos | meeting_id, start_time, end_time, text, segment_id | Recebe flush via db_writer com upsert por (meeting_id, segment_id). |
| meeting_sessions | Conexões do bot | meeting_id, session_uid | Permite associar uploads e callbacks à reunião correta. |

**Como a transcrição fica disponível**
1. O bot envia segmentos para Redis.
2. O `db_writer` move segmentos imutáveis para a tabela `transcriptions`.
3. Ao finalizar a reunião, o lifecycle chama um finalizador para drenar o restante imediatamente.
4. `GET /transcripts/by-id/{meeting_id}` mescla o que já está em Postgres com o que ainda vive em `meeting:{id}:segments` no Redis.

**O que isso significa para a integração**
Você não precisa esperar um pós-processamento final para começar a ler texto. O endpoint por `meeting_id` já foi desenhado para devolver tanto histórico consolidado quanto o estado vivo da reunião.

## Evidências de funcionamento
Os logs do projeto mostram que o deploy lite subiu `meeting-api`, `gateway`, `runtime` e `admin-api` com sucesso. Também há registros do gateway encaminhando com sucesso chamadas para `http://127.0.0.1:8081/meetings` e para múltiplos `/transcripts/by-id/*`, todos com `200 OK`, o que é um sinal forte de que a camada pública principal da API está operacional.

Existe ainda um arquivo de exemplo no próprio repositório, `test_api.js`, que usa exatamente o fluxo recomendado para Railway: gerar um token com escopos `bot,tx`, chamar `/bots`, depois `/transcripts/by-id/{meeting_id}` e por fim `DELETE /bots/{platform}/{native_meeting_id}`. Esse script reforça que o uso pretendido para integração externa já é o gateway público e não a API externa interna.

## Riscos e divergências
1. **Segredos expostos**: Foram compartilhados no contexto segredos sensíveis de banco, LLM e Railway. Mesmo que eu não os replique aqui, o recomendado é rotacionar todos antes de colocar a integração em produção, porque qualquer segredo exposto fora do cofre de deploy deve ser tratado como comprometido.
2. **Rota pública de stop inconsistente**: O gateway tem uma rota `POST /bots/{platform}/{native_meeting_id}/stop`, mas o fluxo público real do `meeting-api` usa `DELETE /bots/{platform}/{native_meeting_id}`. Para não depender de um encaminhamento inconsistente, sua integração deve sempre usar `DELETE`.
3. **API externa interna é tentadora, mas errada para produção**: `/api/external/*` parece útil porque permite spawn, transcrição e stop com um único segredo interno, mas o código fixa `user_id=1` e valida contra `INTERNAL_API_SECRET`. Isso mistura integração externa com privilégio interno e elimina separação adequada de tenant.
4. **Object storage provavelmente não está pronto para gravações**: O deploy lite sobe o core em um único container, mas o `.env` fornecido aponta `MINIO_ENDPOINT=minio:9000` com credenciais dummy. Como a gravação depende de storage funcional e não há evidência equivalente nos logs mostrando upload/finalização de media, eu trataria gravações como não validadas até testar explicitamente. Se o foco imediato for transcrição, defina `recording_enabled:false`.
5. **URLs com crases no .env**: Algumas variáveis fornecidas aparecem com crases, como `` `https://api.openai.com/v1` ``. Se isso tiver sido realmente salvo assim no ambiente, a URL fica malformada. Os logs mostram uma URL limpa para transcrição, então o deploy em execução pode já estar com valor corrigido, mas o arquivo fonte deve ser higienizado.
6. **Redis local e Redis externo convivendo no lite**: O container inicia um Redis local via supervisord, mas o runtime também honra `REDIS_URL` externo. Isso não impede a API, porém aumenta a complexidade operacional e pode gerar confusão em troubleshooting se diferentes componentes acabarem olhando para backends distintos.
7. **Erros de VNC e Terminal não são o foco**: Os logs mostram falhas de x11vnc e erros transitórios do Terminal ao subir, mas isso não invalida o fluxo central por API. Para a sua integração backend, esses erros são secundários; o que importa é que gateway, admin-api, meeting-api e runtime subiram e responderam.

## Guia recomendado de integração
Se eu fosse implementar agora um backend próprio por cima desse deploy, eu seguiria esta sequência e bloquearia qualquer desvio fora dela. Ela aproveita o que o código já sustenta bem e evita as partes que ainda são claramente internas ou frágeis.

**Sequência de implantação**
1. Use o admin-api para criar um usuário técnico ou localizar um existente.
2. Gere um token com escopos `bot,tx`.
3. Guarde esse token no seu backend e use-o em todas as chamadas para o domínio público do Railway.
4. No spawn, envie `meeting_url` e deixe `transcribe_enabled:true`.
5. Enquanto o storage não for validado, envie `recording_enabled:false`.
6. Use a resposta do spawn para guardar `meeting_id`, `platform` e `native_meeting_id`.
7. Faça polling em `/transcripts/by-id/{meeting_id}` para montar o transcript no seu produto.
8. Quando precisar tirar o robô, chame `DELETE /bots/{platform}/{native_meeting_id}`.
9. Se depois quiser expor gravação, valide primeiro storage, finalize um master e só então abra o recurso ao cliente.

**Exemplo de bootstrap administrativo**
```bash
# 1) criar ou garantir usuário
curl -X POST "https://SEU-DOMINIO-RAILWAY/admin/users" \
  -H "X-Admin-API-Key: SEU_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"integracao@seudominio.com","name":"Integração API","max_concurrent_bots":3}'

# 2) mintar token de integração
curl -X POST "https://SEU-DOMINIO-RAILWAY/admin/users/1/tokens?scopes=bot,tx&name=integracao-backend" \
  -H "X-Admin-API-Key: SEU_ADMIN_TOKEN"
```

**Exemplo de operação pública**
```bash
# spawn
curl -X POST "https://SEU-DOMINIO-RAILWAY/bots" \
  -H "X-API-Key: SEU_TOKEN_BOT_TX" \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"google_meet",
    "meeting_url":"https://meet.google.com/abc-defg-hij",
    "bot_name":"Vexa Recorder",
    "language":"pt-BR",
    "transcribe_enabled":true,
    "recording_enabled":false
  }'

# consultar transcript
curl -H "X-API-Key: SEU_TOKEN_BOT_TX" \
  "https://SEU-DOMINIO-RAILWAY/transcripts/by-id/123"

# parar bot
curl -X DELETE \
  -H "X-API-Key: SEU_TOKEN_BOT_TX" \
  "https://SEU-DOMINIO-RAILWAY/bots/google_meet/abc-defg-hij"
```

**Recomendação final**
Construa sua nova interface sobre o gateway público e trate o `meeting_id` como identificador principal do fluxo. O desenho do código já favorece esse modelo e ele evita ambiguidades de várias execuções da mesma reunião nativa.

## Arquivos-chave auditados
Os pontos abaixo foram os mais relevantes para concluir como a API opera de verdade e onde estão os riscos.

- `README.md` — posicionamento do produto e fluxo público esperado.
- `test_api.js` — script de exemplo já alinhado ao uso do gateway em Railway.
- `railway.json`, `deploy/lite/Dockerfile.lite`, `deploy/lite/supervisord.conf`, `deploy/lite/entrypoint.sh` — desenho real do deploy lite.
- `core/gateway/services/gateway/src/gateway/app.py` e `adapters.py` — autenticação, injeção de identidade e forwarding.
- `core/identity/services/admin-api/src/admin_api/app/main.py` — criação de usuários, tokens e validação interna.
- `core/identity/services/admin-api/src/admin_api/schema/models.py` — modelos de `users`, `api_tokens`, `platform_settings` e tabelas auxiliares.
- `core/meetings/services/meeting-api/src/meeting_api/app.py` — composição do monólito modular.
- `core/meetings/services/meeting-api/src/meeting_api/bot_spawn/router.py` — rota pública de spawn.
- `core/meetings/services/meeting-api/src/meeting_api/lifecycle/stop_router.py` — stop público por `DELETE`.
- `core/meetings/services/meeting-api/src/meeting_api/collector/app.py` e `adapters.py` — reuniões, transcrições e autorização de leitura.
- `core/meetings/services/meeting-api/src/meeting_api/collector/db_writer.py` — flush Redis→Postgres e finalização de transcript.
- `core/meetings/services/meeting-api/src/meeting_api/recordings/router.py` — leitura e finalização de gravações.
- `core/meetings/services/meeting-api/src/meeting_api/external_api/router.py` — API externa interna com `user_id=1`.
- `startup_logs.txt` e `celebrated_manifestation_logs.txt` — evidência de subida e tráfego real.
