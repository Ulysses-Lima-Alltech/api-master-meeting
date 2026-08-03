/**
 * Cliente de Integração Vexa API (Node.js)
 * 
 * Este arquivo serve como módulo de integração (SDK) que você pode importar no
 * seu backend (Node.js, Express, NestJS, etc) para operar o Vexa.
 * 
 * Pré-requisitos:
 * npm install axios
 */

const axios = require('axios');

class VexaApiClient {
  /**
   * Instancia o cliente da API do Vexa.
   * @param {string} baseUrl A URL pública do seu projeto Railway (ex: https://celebrated-manifestation.up.railway.app)
   * @param {string} apiKey O token do usuário gerado via Admin API com escopos `bot,tx`.
   */
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash se houver
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Envia o Bot para uma reunião.
   * @param {Object} params Parâmetros da reunião
   * @param {string} params.platform A plataforma (ex: "google_meet", "zoom")
   * @param {string} params.meeting_url URL completa da reunião
   * @param {string} [params.bot_name="Vexa Assistant"] Nome do bot na chamada
   * @param {string} [params.language="pt-BR"] Idioma para transcrição
   * @param {boolean} [params.transcribe_enabled=true] Ativa transcrição
   * @param {boolean} [params.recording_enabled=false] Ativa gravação de vídeo
   * @returns {Promise<Object>} Dados da sessão da reunião (inclui meeting_id)
   */
  async spawnBot({
    platform,
    meeting_url,
    bot_name = "Vexa Assistant",
    language = "pt-BR",
    transcribe_enabled = true,
    recording_enabled = false
  }) {
    try {
      const response = await this.client.post('/bots', {
        platform,
        meeting_url,
        bot_name,
        language,
        transcribe_enabled,
        recording_enabled
      });
      return response.data;
    } catch (error) {
      console.error("Erro ao enviar bot:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Obtém a transcrição da reunião (funciona em tempo real e pós-reunião).
   * @param {number|string} meetingId O ID da reunião retornado pelo spawnBot
   * @returns {Promise<Array>} Lista de segmentos transcritos
   */
  async getTranscript(meetingId) {
    try {
      const response = await this.client.get(`/transcripts/by-id/${meetingId}`);
      return response.data;
    } catch (error) {
      console.error("Erro ao buscar transcrição:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Remove o bot da reunião e encerra a gravação/transcrição.
   * @param {string} platform A plataforma (ex: "google_meet")
   * @param {string} nativeMeetingId O ID nativo (ex: o "abc-defg-hij" do Google Meet)
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async stopBot(platform, nativeMeetingId) {
    try {
      await this.client.delete(`/bots/${platform}/${nativeMeetingId}`);
      return true;
    } catch (error) {
      console.error("Erro ao remover bot:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Retorna os status de todos os bots ativos.
   * @returns {Promise<Array>}
   */
  async getActiveBots() {
    try {
      const response = await this.client.get('/bots/status');
      return response.data;
    } catch (error) {
      console.error("Erro ao buscar bots:", error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = VexaApiClient;

// ============================================================================
// EXEMPLO DE USO
// ============================================================================
if (require.main === module) {
  (async () => {
    // Substitua pela sua URL real do Railway
    const BASE_URL = "https://SEU_PROJETO.up.railway.app";
    const API_KEY = "SEU_TOKEN_DE_INTEGRACAO";

    const vexa = new VexaApiClient(BASE_URL, API_KEY);

    console.log("1. Enviando Bot para o Google Meet...");
    // const sessao = await vexa.spawnBot({
    //   platform: "google_meet",
    //   meeting_url: "https://meet.google.com/abc-defg-hij"
    // });
    // console.log("Sessão criada! Meeting ID:", sessao.meeting_id);
    
    // console.log("\n2. Puxando Transcrição...");
    // const transcript = await vexa.getTranscript(sessao.meeting_id);
    // console.log("Transcrição Atual:", transcript);

    // console.log("\n3. Removendo Bot da Reunião...");
    // await vexa.stopBot("google_meet", "abc-defg-hij");
    // console.log("Bot removido com sucesso.");
  })();
}
