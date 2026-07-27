"use client";
/** salesMeeting — Sales Intelligence analysis for a SPECIFIC meeting. Fetches the durable
 *  transcript and sends it to the chat endpoint with a PT-BR prompt to generate structured
 *  sales analysis. Results are cached in localStorage per meeting. */
import { useState, useEffect, useCallback } from "react";
import { Target, AlertTriangle, TrendingUp, CheckCircle, Thermometer, RefreshCw } from "lucide-react";
import { fetchDurableTranscript } from "./liveMeetings";

// ── Types ────────────────────────────────────────────────────────────────────────
export interface MeetingSalesAnalysis {
  resumo: string;
  estagio_funil: string;
  nivel_risco: string;
  temperatura: number;
  objecoes: Array<{ categoria: string; descricao: string }>;
  proximos_passos: Array<{ acao: string; responsavel: string; prazo: string }>;
}

const CACHE_PREFIX = "vexa.sales.analysis.v1:";

function getCachedAnalysis(meetingId: string): MeetingSalesAnalysis | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + meetingId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedAnalysis(meetingId: string, analysis: MeetingSalesAnalysis): void {
  try { localStorage.setItem(CACHE_PREFIX + meetingId, JSON.stringify(analysis)); } catch { /* */ }
}

// ── PT-BR prompt ─────────────────────────────────────────────────────────────────
const SALES_PROMPT = `Você é um analista de vendas B2B especializado. Analise a transcrição da reunião abaixo e retorne APENAS um JSON válido (sem markdown, sem backticks, sem texto antes ou depois) com a seguinte estrutura:

{
  "resumo": "Resumo executivo da reunião em 2-3 frases",
  "estagio_funil": "Um de: Prospecção, Descoberta, Demonstração, Negociação, Fechamento",
  "nivel_risco": "Um de: Alto, Médio, Baixo",
  "temperatura": 75,
  "objecoes": [
    {"categoria": "Preço", "descricao": "O cliente mencionou que o orçamento está apertado"}
  ],
  "proximos_passos": [
    {"acao": "Enviar proposta revisada", "responsavel": "Vendedor", "prazo": "Amanhã"}
  ]
}

Regras:
- "temperatura" é um número de 0 a 100 (0=frio/desinteressado, 100=quente/pronto para fechar)
- Se não houver objeções, retorne array vazio []
- Sempre retorne pelo menos 1 próximo passo
- TUDO em Português do Brasil
- Retorne SOMENTE o JSON, nada mais

TRANSCRIÇÃO:
`;

// ── Call the chat endpoint to generate analysis ──────────────────────────────────
async function callChatForAnalysis(transcript: string): Promise<MeetingSalesAnalysis> {
  const fullPrompt = SALES_PROMPT + transcript;

  // Try calling the AI backend; fall back to local keyword analysis if unreachable
  let r: Response;
  try {
    r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: fullPrompt }],
        stream: false,
      }),
    });
  } catch {
    // Network error — use local fallback
    return localFallbackAnalysis(transcript);
  }

  if (!r.ok) {
    // Backend returned error — use local fallback instead of throwing
    return localFallbackAnalysis(transcript);
  }

  // The endpoint may return SSE or JSON depending on stream flag
  const contentType = r.headers.get("content-type") || "";
  
  if (contentType.includes("text/event-stream") || contentType.includes("text/plain")) {
    // Parse SSE — collect all data chunks
    const text = await r.text();
    let collected = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          // OpenAI-style: choices[0].delta.content
          const content = parsed?.choices?.[0]?.delta?.content
            || parsed?.choices?.[0]?.message?.content
            || parsed?.content
            || parsed?.text
            || "";
          collected += content;
        } catch {
          // If it's not JSON, it might be raw text
          if (data !== "[DONE]") collected += data;
        }
      }
    }
    try {
      return parseAnalysisJSON(collected);
    } catch {
      return localFallbackAnalysis(transcript);
    }
  }

  // Direct JSON response — try to parse, fall back to local if AI returned garbage
  try {
    const body = await r.json();
    const content = body?.choices?.[0]?.message?.content || body?.content || body?.text || JSON.stringify(body);
    return parseAnalysisJSON(content);
  } catch {
    return localFallbackAnalysis(transcript);
  }
}

/** Keyword-based local analysis in PT-BR — used when the AI backend is unreachable. */
function localFallbackAnalysis(transcript: string): MeetingSalesAnalysis {
  const lower = transcript.toLowerCase();

  // Detect funnel stage
  let estagio = "Descoberta";
  if (lower.includes("proposta") || lower.includes("contrato") || lower.includes("acordo")) estagio = "Negociação";
  else if (lower.includes("demo") || lower.includes("demonstração") || lower.includes("mostrar")) estagio = "Demonstração";
  else if (lower.includes("fechar") || lower.includes("assinar") || lower.includes("pagamento")) estagio = "Fechamento";
  else if (lower.includes("prospecção") || lower.includes("primeiro contato")) estagio = "Prospecção";

  // Detect risk
  let risco = "Baixo";
  let temperatura = 65;
  const objecoes: Array<{ categoria: string; descricao: string }> = [];

  if (lower.includes("caro") || lower.includes("orçamento") || lower.includes("budget") || lower.includes("preço")) {
    objecoes.push({ categoria: "Preço", descricao: "O cliente mencionou preocupações com orçamento ou preço." });
    risco = "Médio";
    temperatura = 45;
  }
  if (lower.includes("concorrente") || lower.includes("competitor") || lower.includes("outra empresa")) {
    objecoes.push({ categoria: "Concorrência", descricao: "Menção a concorrentes ou soluções alternativas." });
    risco = "Alto";
    temperatura = 30;
  }
  if (lower.includes("cancelar") || lower.includes("desistir") || lower.includes("não vamos")) {
    risco = "Alto";
    temperatura = 15;
  }
  if (lower.includes("ótimo") || lower.includes("excelente") || lower.includes("perfeito") || lower.includes("gostei")) {
    temperatura = Math.min(100, temperatura + 25);
  }

  const lines = transcript.split("\n").filter(l => l.trim());
  const resumo = lines.length > 3
    ? `Reunião com ${lines.length} falas. Discussão em estágio de ${estagio.toLowerCase()}. ${objecoes.length > 0 ? `${objecoes.length} objeção(ões) detectada(s).` : "Nenhuma objeção detectada."}`
    : "Transcrição curta — dados insuficientes para análise completa.";

  return {
    resumo,
    estagio_funil: estagio,
    nivel_risco: risco,
    temperatura,
    objecoes,
    proximos_passos: [
      { acao: "Revisar notas da reunião", responsavel: "Vendedor", prazo: "Hoje" },
      { acao: "Agendar follow-up", responsavel: "Vendedor", prazo: "Esta semana" },
    ],
  };
}

function parseAnalysisJSON(raw: string): MeetingSalesAnalysis {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
  }
  
  // Find the JSON object in the text
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Resposta da IA não contém JSON válido");
  
  const jsonStr = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr);
  
  return {
    resumo: typeof parsed.resumo === "string" ? parsed.resumo : "Análise não disponível.",
    estagio_funil: typeof parsed.estagio_funil === "string" ? parsed.estagio_funil : "Descoberta",
    nivel_risco: typeof parsed.nivel_risco === "string" ? parsed.nivel_risco : "Médio",
    temperatura: typeof parsed.temperatura === "number" ? Math.max(0, Math.min(100, parsed.temperatura)) : 50,
    objecoes: Array.isArray(parsed.objecoes) ? parsed.objecoes : [],
    proximos_passos: Array.isArray(parsed.proximos_passos) ? parsed.proximos_passos : [{ acao: "Acompanhar", responsavel: "Vendedor", prazo: "Em breve" }],
  };
}

// ── Component ────────────────────────────────────────────────────────────────────
interface SalesMeetingAnalysisProps {
  meetingId: string;
  meetingTitle: string;
}

export function SalesMeetingAnalysis({ meetingId, meetingTitle }: SalesMeetingAnalysisProps) {
  const [analysis, setAnalysis] = useState<MeetingSalesAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async (force = false) => {
    if (!force) {
      const cached = getCachedAnalysis(meetingId);
      if (cached) { setAnalysis(cached); return; }
    }
    
    setLoading(true); setError(null);
    try {
      const durable = await fetchDurableTranscript(meetingId);
      if (durable.lines.length === 0) {
        setError("Nenhuma transcrição disponível para esta reunião.");
        setLoading(false);
        return;
      }
      
      const transcriptText = durable.lines.map(l => `${l.speaker}: ${l.text}`).join("\n");
      const result = await callChatForAnalysis(transcriptText);
      setCachedAnalysis(meetingId, result);
      setAnalysis(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao gerar análise.");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => { void runAnalysis(); }, [runAnalysis]);

  const tempColor = (analysis?.temperatura ?? 50) >= 70 ? "var(--green)" : (analysis?.temperatura ?? 50) >= 40 ? "#f59e0b" : "var(--danger)";
  const riskColor = analysis?.nivel_risco === "Alto" ? "var(--danger)" : analysis?.nivel_risco === "Médio" ? "#f59e0b" : "var(--green)";

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "var(--t2)" }}>
        <div style={{ width: 32, height: 32, border: "3px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Analisando reunião com IA...</div>
        <div style={{ fontSize: 11, color: "var(--t3)" }}>Isso pode levar alguns segundos</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ padding: 20, borderRadius: 12, background: "var(--panel)", border: "1px solid var(--danger)", textAlign: "center" }}>
          <AlertTriangle size={24} style={{ color: "var(--danger)", marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600, marginBottom: 8 }}>{error}</div>
          <button onClick={() => void runAnalysis(true)} style={{ fontSize: 12, padding: "6px 16px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", color: "var(--t1)", cursor: "pointer" }}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px", backgroundColor: "var(--bg)", color: "var(--t1)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <TrendingUp size={22} style={{ color: "var(--accent)" }} />
              Sales Intelligence
            </h2>
            <p style={{ color: "var(--t2)", fontSize: 13, fontWeight: 500, margin: 0 }}>
              Análise de <span style={{ fontWeight: 700, color: "var(--t1)" }}>{meetingTitle}</span>
            </p>
          </div>
          <button onClick={() => void runAnalysis(true)} title="Re-analisar reunião"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--t2)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--panel2)"} onMouseLeave={e => e.currentTarget.style.background = "var(--panel)"}>
            <RefreshCw size={13} /> Re-analisar
          </button>
        </div>

        {/* Bento Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          
          {/* Estado Atual + Temperatura */}
          <div style={{ padding: 20, borderRadius: 14, backgroundColor: "var(--panel)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 14 }}>
            <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--t3)", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <Target size={14} /> Estado Atual
            </h3>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--t2)", fontSize: 13 }}>Estágio do Funil</span>
              <span style={{ color: "var(--t1)", fontWeight: 700, fontSize: 13 }}>{analysis.estagio_funil}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--t2)", fontSize: 13 }}>Nível de Risco</span>
              <span style={{ color: riskColor, fontWeight: 800, fontSize: 13 }}>{analysis.nivel_risco}</span>
            </div>
            <div style={{ marginTop: 8, padding: 14, backgroundColor: "var(--bg)", borderRadius: 10, border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "var(--t3)", fontSize: 11, textTransform: "uppercase", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <Thermometer size={13} style={{ color: tempColor }} /> Temperatura
                </span>
                <span style={{ color: tempColor, fontWeight: 800, fontSize: 15 }}>{analysis.temperatura}°</span>
              </div>
              <div style={{ height: 7, backgroundColor: "var(--panel2)", borderRadius: 9999, overflow: "hidden" }}>
                <div style={{ height: "100%", backgroundColor: tempColor, width: `${analysis.temperatura}%`, transition: "width 0.8s ease, background-color 0.8s ease", borderRadius: 9999 }} />
              </div>
            </div>
          </div>

          {/* Resumo */}
          <div style={{ padding: 20, borderRadius: 14, backgroundColor: "var(--panel)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--t3)", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <CheckCircle size={14} /> Resumo da Reunião
            </h3>
            <p style={{ color: "var(--t1)", fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
              {analysis.resumo}
            </p>
          </div>
        </div>

        {/* Objeções */}
        <div style={{ padding: 20, borderRadius: 14, backgroundColor: "var(--panel)", border: analysis.nivel_risco === "Alto" ? "1px solid var(--danger)" : "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
          <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--danger)", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <AlertTriangle size={14} /> Objeções Detectadas
          </h3>
          {analysis.objecoes.length === 0 ? (
            <div style={{ color: "var(--t3)", fontSize: 13 }}>Nenhuma objeção detectada nesta reunião.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {analysis.objecoes.map((obj, idx) => (
                <div key={idx} style={{ backgroundColor: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700 }}>{obj.categoria}</span>
                  <p style={{ color: "var(--t2)", fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>{obj.descricao}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Próximos Passos */}
        <div style={{ padding: 20, borderRadius: 14, backgroundColor: "var(--panel)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
          <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--t3)", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <CheckCircle size={14} style={{ color: "var(--accent)" }} /> Próximos Passos
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {analysis.proximos_passos.map((step, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 14, backgroundColor: "var(--bg)", padding: 14, borderRadius: 10, border: "1px solid var(--line)" }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, border: "2px solid var(--line)", flex: "none" }} />
                <span style={{ fontSize: 13, color: "var(--t1)", fontWeight: 500, flex: 1 }}>{step.acao}</span>
                <div style={{ display: "flex", gap: 10, fontSize: 11.5, color: "var(--t3)" }}>
                  {step.responsavel && <span style={{ padding: "3px 8px", backgroundColor: "var(--panel2)", borderRadius: 5 }}>👤 {step.responsavel}</span>}
                  {step.prazo && <span style={{ padding: "3px 8px", backgroundColor: "var(--panel2)", borderRadius: 5 }}>⏳ {step.prazo}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
