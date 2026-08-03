# Report Plan

## Meta
- **Type**: Auditoria técnica
- **Topic**: Uso 100% via API do Vexa Lite em Railway para enviar bot, transcrever, consultar transcrição e remover bot
- **Audience**: Operação técnica e desenvolvimento de integração backend
- **Language**: Português

## Theme
- **Name**: Modern Minimalist
- **Colors**:
  - Background: `#fafafa`
  - Surface: `#f0f0f0`
  - Text: `#36454f`
  - Text Muted: `#708090`
  - Border: `#d3d3d3`
  - Primary: `#36454f`
  - Secondary: `#e8edf0`
- **Document Font**: InstrumentSans
- **Monospace Font**: GeistMono

## Structure
1. Resumo executivo — conclusão direta sobre o que já funciona e o que não deve ser usado
2. Topologia em Railway — serviços, portas internas e papel de cada processo
3. Modelo de autenticação — diferença entre API pública, admin-api e API externa interna
4. Fluxo operacional por API — enviar bot, acompanhar, ler transcrição, parar bot, consultar gravações
5. Banco de dados — tabelas reais, campos relevantes e persistência Redis→Postgres
6. Riscos e divergências — segredos, inconsistências de rota, armazenamento e deploy lite
7. Guia de implementação — sequência recomendada para integração backend
8. Checklist final — pré-requisitos para operar só por API

## Visuals
| Visual | Type | Tool | Purpose |
|--------|------|------|---------|
| Diagrama 1 | Arquitetura | HTML/CSS | Mostrar gateway, admin-api, meeting-api, runtime, Redis e Postgres |
| Tabela 1 | Comparação | HTML table | Separar API pública, admin-api e API externa interna |
| Tabela 2 | Banco | HTML table | Mapear tabelas e onde cada dado fica |

## Key Arguments / Thesis
- O caminho correto para integração externa é a API pública no gateway com uma chave de usuário com escopos `bot,tx`.
- A rota `/api/external/*` existe, mas é um atalho interno inseguro para produção porque autentica por segredo interno e fixa `user_id=1`.
- A transcrição pode ser consumida por API mesmo durante o processamento porque o read path mescla segmentos persistidos no Postgres com segmentos ainda mantidos em Redis.
- Gravações dependem de object storage funcional; transcrição e controle do bot podem funcionar mesmo que a camada de gravação esteja incompleta.
