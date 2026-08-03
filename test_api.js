/**
 * Exercita a API pública exposta pelo gateway no Railway.
 *
 * Crie uma chave de usuário com os escopos `bot,tx` e informe-a apenas no
 * ambiente do seu terminal. Este arquivo não armazena segredos do deploy.
 *
 * Uso:
 *   API_BASE=https://seu-dominio.up.railway.app VEXA_API_KEY=... MEETING_URL=https://meet.google.com/abc-defg-hij node test_api.js spawn
 *   API_BASE=https://seu-dominio.up.railway.app VEXA_API_KEY=... MEETING_ID=123 node test_api.js transcript
 *   API_BASE=https://seu-dominio.up.railway.app VEXA_API_KEY=... PLATFORM=google_meet NATIVE_MEETING_ID=abc-defg-hij node test_api.js stop
 */

const baseUrl = (process.env.API_BASE || "").replace(/\/$/, "");
const apiKey = process.env.VEXA_API_KEY;
const action = process.argv[2];

if (!baseUrl) {
  throw new Error("API_BASE é obrigatório (a URL pública do Railway).");
}
if (!apiKey) {
  throw new Error("VEXA_API_KEY é obrigatório e precisa ter os escopos bot,tx.");
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey, ...init.headers },
  });
  const body = await response.json().catch(() => ({ detail: "Resposta não é JSON" }));
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} → ${response.status}: ${body.detail || JSON.stringify(body)}`);
  }
  return body;
}

async function spawn() {
  const meetingUrl = process.env.MEETING_URL;
  if (!meetingUrl) throw new Error("MEETING_URL é obrigatório para enviar um robô.");

  const meeting = await request("/bots", {
    method: "POST",
    body: JSON.stringify({
      platform: process.env.PLATFORM || "google_meet",
      meeting_url: meetingUrl,
      bot_name: process.env.BOT_NAME || "Vexa Recorder",
      language: process.env.LANGUAGE || "pt-BR",
      transcribe_enabled: true,
      recording_enabled: true,
    }),
  });
  console.log(JSON.stringify(meeting, null, 2));
  console.log(`\nUse MEETING_ID=${meeting.id ?? meeting.meeting_id} para consultar a transcrição.`);
}

async function transcript() {
  const meetingId = process.env.MEETING_ID;
  if (!meetingId) throw new Error("MEETING_ID é obrigatório para consultar a transcrição.");
  console.log(JSON.stringify(await request(`/transcripts/by-id/${encodeURIComponent(meetingId)}`), null, 2));
}

async function stop() {
  const platform = process.env.PLATFORM || "google_meet";
  const nativeId = process.env.NATIVE_MEETING_ID;
  if (!nativeId) throw new Error("NATIVE_MEETING_ID é obrigatório para encerrar o robô.");
  console.log(JSON.stringify(await request(`/bots/${encodeURIComponent(platform)}/${encodeURIComponent(nativeId)}`, {
    method: "DELETE",
  }), null, 2));
}

const handlers = { spawn, transcript, stop };
if (!handlers[action]) throw new Error("Escolha uma ação: spawn, transcript ou stop.");
await handlers[action]();
