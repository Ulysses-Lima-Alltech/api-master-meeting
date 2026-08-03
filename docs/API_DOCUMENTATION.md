# Documentação Pública da API - Vexa (Railway)

Esta documentação detalha o uso da API pública do Vexa operando através do Gateway. 
O Gateway atua como o ponto de entrada principal e roteador seguro, autenticando via `X-API-Key`.

## Base URL
Todas as requisições devem ser feitas para o domínio público da sua aplicação no Railway (onde o Nginx e o Gateway estão expostos).
- Exemplo: `https://celebrated-manifestation.up.railway.app` (substitua pelo domínio exato fornecido pelo Railway).

## Autenticação

A API pública requer um token de usuário passado no cabeçalho.
- **Header**: `X-API-Key: <seu_token>`
- **Escopos Necessários**: `bot,tx`

> [!NOTE]
> Para gerar o `<seu_token>`, você precisa usar a **Admin API** (passando o `X-Admin-API-Key` configurado no seu `.env` como `ADMIN_API_TOKEN`). Veja a seção de Bootstrap no final deste documento.

---

## Endpoints Operacionais

### 1. Inserir Bot em Reunião (Spawn)
Envia o bot para uma reunião em andamento.

- **Método:** `POST /bots`
- **Headers:** `X-API-Key: <seu_token>`, `Content-Type: application/json`
- **Body:**
```json
{
  "platform": "google_meet",
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "bot_name": "Vexa Recorder",
  "language": "pt-BR",
  "transcribe_enabled": true,
  "recording_enabled": false
}
```
- **Resposta (200 OK):** Retorna os detalhes da sessão criada, incluindo o `meeting_id` (necessário para buscar a transcrição) e o status de inicialização.

### 2. Consultar Transcrição (Em Tempo Real ou Finalizada)
Obtém o texto transcrito da reunião. Este endpoint funde dados persistidos com dados em tempo real (no Redis).

- **Método:** `GET /transcripts/by-id/{meeting_id}`
- **Headers:** `X-API-Key: <seu_token>`
- **Path Params:**
  - `meeting_id`: O ID numérico retornado na chamada de Spawn.
- **Resposta (200 OK):**
```json
{
  "meeting_id": 123,
  "segments": [
    {
      "start_time": 12.5,
      "end_time": 15.2,
      "text": "Olá pessoal, bom dia.",
      "speaker": "Speaker 1"
    }
  ]
}
```

### 3. Remover Bot da Reunião (Stop)
Remove o bot de uma chamada ativa.

- **Método:** `DELETE /bots/{platform}/{native_meeting_id}`
- **Headers:** `X-API-Key: <seu_token>`
- **Path Params:**
  - `platform`: Ex: `google_meet`, `zoom`, `teams`.
  - `native_meeting_id`: O identificador da reunião na plataforma (ex: `abc-defg-hij`).
- **Resposta (200 OK):** Confirmação de que o bot está saindo.

### 4. Consultar Status das Reuniões e Bots
Lista as reuniões ativas e histórico vinculado ao seu usuário.

- **Listar Reuniões:** `GET /meetings` (Requer `X-API-Key`)
- **Listar Bots Rodando:** `GET /bots/status` (Requer `X-API-Key`)

---

## Bootstrap Administrativo (Apenas uma vez)
Para que a sua integração (o seu backend) tenha a chave `X-API-Key`, você precisa gerá-la usando a chave de administrador (que no seu `.env` está como `changeme` a menos que tenha sido alterada em runtime).

**Passo 1: Criar Usuário**
```bash
curl -X POST "https://SEU_DOMINIO_RAILWAY/admin/users" \
  -H "X-Admin-API-Key: changeme" \
  -H "Content-Type: application/json" \
  -d '{"email":"api@seu-sistema.com","name":"API Integracao","max_concurrent_bots":5}'
```
*(Anote o `id` retornado na resposta, ex: `1`)*

**Passo 2: Gerar Token do Usuário**
```bash
curl -X POST "https://SEU_DOMINIO_RAILWAY/admin/users/1/tokens?scopes=bot,tx&name=token-api" \
  -H "X-Admin-API-Key: changeme"
```
*(O `token` retornado aqui é a chave que você usará no header `X-API-Key` das chamadas operacionais acima).*
