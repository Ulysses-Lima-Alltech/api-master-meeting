"use client";
/** Meetings user onboarding — the per-user half of the first-run flow (design-spec
 *  first-run-onboarding, frames 4–5). EVERY new user lands here; the admin wizard hands into it
 *  via "Go to Meetings". Two skins over one state:
 *
 *    - `full` — the empty-Meetings center stage: three cards ordered by leverage (connect
 *      calendar / plan a meeting / drop a bot on a running Meet).
 *    - `slim` — the STANDING calendar affordance: a single connect card that stays on the
 *      Meetings page for as long as THIS user has no calendar connected (state-driven, not
 *      visit-count-driven). Renders nothing once connected.
 *
 *  The connect surface TEACHES where the secret iCal URL lives (the step users bounce off),
 *  including the two field-tested traps (public-vs-secret address, Workspace-admin lock), and
 *  answers immediately on connect — sync-now runs and reports what it found. */
import { useEffect, useState, type CSSProperties } from "react";
import { useService } from "../platform";
import { LayoutServiceId } from "../workbench/layout";
import { Icon } from "../ui-kit";
import { parseMeetingInput } from "./meetingId";
import { refreshMeetings } from "./liveMeetings";
import { getCalendarConfig, setCalendarConfig, syncCalendarNow, type CalendarSyncStamp } from "./plannedApi";
import { prepDraftTabDescriptor } from "./meetingPrep";
import { botBodyFields } from "./botConfig";

/** The success line after a connect: lead with what the sync actually FOUND. */
export function connectOutcome(stamp: CalendarSyncStamp): { ok: boolean; text: string } {
  if (stamp.last_error) return { ok: false, text: `Feed conectado, mas a primeira sincronização falhou: ${stamp.last_error}` };
  const found = (stamp.counts?.created ?? 0) + (stamp.counts?.updated ?? 0);
  return {
    ok: true,
    text: found > 0
      ? `Feed conectado — ${found} próxima${found === 1 ? "" : "s"} reuni${found === 1 ? "ão" : "ões"} importada${found === 1 ? "" : "s"}.`
      : "Feed conectado — nenhuma reunião com links de acesso encontrada ainda.",
  };
}

const cardBase: CSSProperties = {
  border: "1px dashed var(--line2)", borderRadius: 10, padding: "14px 15px",
  display: "flex", flexDirection: "column", gap: 6, textAlign: "left",
};
const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--t1)", display: "flex", alignItems: "center", gap: 7 };
const cardBody: CSSProperties = { fontSize: 11.5, color: "var(--t3)", lineHeight: 1.5, flex: 1 };
const cta: CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" };
const fieldStyle: CSSProperties = {
  flex: 1, minWidth: 0, background: "var(--panel2)", border: "1px solid var(--line2)", borderRadius: 7,
  padding: "7px 9px", color: "var(--t1)", fontSize: 12, outline: "none",
};

/** Loading tri-state so neither skin flashes: null = unknown yet. */
function useCalendarConnected(): [boolean | null, () => void] {
  const [connected, setConnected] = useState<boolean | null>(null);
  const probe = () => {
    getCalendarConfig().then((c) => setConnected(!!c.ics_url_set)).catch(() => setConnected(null));
  };
  useEffect(probe, []);
  return [connected, probe];
}

/** The frame-5 connect modal: numbered secret-address walkthrough + paste + instant verdict. */
function ConnectCalendarModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);

  const connect = async () => {
    const u = url.trim();
    if (!u || busy) return;
    setBusy(true); setErr(null); setDone(null);
    try {
      await setCalendarConfig({ ics_url: u });
      // paste → an ANSWER, not a silent wait (same rule as the sidebar connect)
      let stamp: CalendarSyncStamp = {};
      try { stamp = await syncCalendarNow(); } catch (e) {
        stamp = { last_error: e instanceof Error ? e.message : String(e) };
      }
      refreshMeetings();
      setDone(connectOutcome(stamp));
      onConnected();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const li: CSSProperties = { display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px dashed var(--line)", fontSize: 12, color: "var(--t2)", lineHeight: 1.5 };
  const num: CSSProperties = { flex: "none", width: 18, height: 18, borderRadius: "50%", background: "var(--panel2)", color: "var(--accent)", fontSize: 10.5, fontWeight: 700, display: "grid", placeItems: "center", marginTop: 1 };

  return (
    <div role="dialog" aria-label="Conectar seu calendário"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 520, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 12, padding: "20px 22px", boxShadow: "0 18px 40px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 650, color: "var(--t1)", flex: 1 }}>Conectar seu calendário</span>
          <button aria-label="close" onClick={onClose} style={{ background: "none", border: "none", color: "var(--t3)", fontSize: 16, cursor: "pointer", padding: 2 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--t3)", lineHeight: 1.5 }}>
          O Master Meeting lê o seu calendário pelo seu <b style={{ color: "var(--t2)" }}>endereço secreto iCal</b> — uma
          URL privada que só você pode ver. Nenhum login no Google é necessário. Os feeds ICS do Outlook e Apple Calendar funcionam pela mesma caixa.
        </div>
        <div>
          <div style={li}><span style={num}>1</span><span>Abra o <b>Google Calendar</b> na web → ⚙ <b>Configurações</b>.</span></div>
          <div style={li}><span style={num}>2</span><span>Na lista à esquerda em <b>Configurações dos meus calendários</b>, clique no seu calendário.</span></div>
          <div style={li}><span style={num}>3</span><span>Role até <b>Integrar calendário</b> → copie o <b>Endereço secreto no formato iCal</b>. <span style={{ color: "var(--t3)" }}>Não o endereço público — o secreto termina em um token longo.</span></span></div>
          <div style={{ ...li, borderBottom: "none", color: "var(--t3)" }}><span style={num}>4</span><span>Não está vendo o campo secreto? Seu administrador do Google Workspace bloqueou — peça para ele ativar o compartilhamento de &ldquo;Endereço secreto&rdquo;, ou use um calendário pessoal.</span></div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") void connect(); }}
            placeholder="https://calendar.google.com/…/basic.ics (endereço secreto)" style={fieldStyle} />
          <button onClick={() => void connect()} disabled={busy || !url.trim()}
            style={{ flex: "none", background: url.trim() ? "var(--accent)" : "var(--panel2)", color: url.trim() ? "var(--on-accent)" : "var(--t3)", border: "none", borderRadius: 7, padding: "0 14px", fontSize: 12.5, fontWeight: 600, cursor: url.trim() && !busy ? "pointer" : "default" }}>
            {busy ? "Conectando…" : "Conectar"}
          </button>
        </div>
        {err && <div role="alert" style={{ fontSize: 11.5, color: "var(--danger)", lineHeight: 1.5 }}>⚠ {err}</div>}
        {done && (
          <div role={done.ok ? "status" : "alert"} style={{ fontSize: 11.5, color: done.ok ? "var(--green)" : "var(--danger)", lineHeight: 1.5 }}>
            {done.ok ? "✓" : "⚠"} {done.text}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "var(--t3)" }}>Sincronizado a cada poucos minutos · gerencie ou desconecte em Configurações → Calendário</span>
          {done?.ok && <button onClick={onClose} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Concluído</button>}
        </div>
      </div>
    </div>
  );
}

/** The drop-a-bot card's inline sender — same POST /api/bots edge and error taxonomy as the sidebar. */
function DropBotInline() {
  const [url, setUrl] = useState("");
  const [sent, setSent] = useState<null | "sending" | "ok" | "err">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    const u = url.trim();
    if (!u || sent === "sending") return;
    const parsed = parseMeetingInput(u);
    if (!parsed) { setSent("err"); setMsg("Isso não parece ser um link do Meet / Zoom / Teams."); return; }
    setSent("sending"); setMsg(null);
    try {
      const r = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: parsed.platform, native_meeting_id: parsed.native_meeting_id, meeting_url: u, ...botBodyFields() }),
      });
      if (r.ok) {
        setSent("ok"); setUrl("");
        refreshMeetings(); setTimeout(refreshMeetings, 2000); setTimeout(refreshMeetings, 6000);
      } else {
        const detail = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        setSent("err");
        setMsg(r.status === 429 ? "Você atingiu seu limite de reuniões — pare uma primeiro."
          : r.status === 409 ? "Essa reunião já tem um bot."
            : r.status === 401 ? "Não autenticado — faça login e tente novamente."
              : `Não foi possível enviar (${r.status})${detail ? `: ${detail}` : ""}`);
      }
    } catch { setSent("err"); setMsg("Não foi possível alcançar o servidor."); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder="Cole um link do Google Meet…" style={fieldStyle} />
        <button onClick={() => void send()} disabled={!url.trim() || sent === "sending"}
          style={{ flex: "none", background: url.trim() ? "var(--accent)" : "var(--panel2)", color: url.trim() ? "var(--on-accent)" : "var(--t3)", border: "none", borderRadius: 7, padding: "0 10px", fontSize: 12, fontWeight: 600, cursor: url.trim() ? "pointer" : "default" }}>
          {sent === "sending" ? "…" : "Enviar bot"}
        </button>
      </div>
      {sent === "ok" && <div style={{ fontSize: 11, color: "var(--green)", lineHeight: 1.4 }}>Bot enviado — admita-o na reunião.</div>}
      {sent === "err" && msg && <div role="alert" style={{ fontSize: 11, color: "var(--danger)", lineHeight: 1.4 }}>⚠ {msg}</div>}
    </div>
  );
}

export function MeetingsOnboarding({ variant }: { variant: "full" | "slim" }) {
  const [connected, reprobe] = useCalendarConnected();
  const [modal, setModal] = useState(false);
  const layout = useService(LayoutServiceId);
  // "+ Plan a meeting" opens a DRAFT prep tab — no backend row until the user fills something in, so
  // an abandoned draft leaves no empty meeting behind (the prep tab creates the row lazily).
  const plan = () => layout.openTab(prepDraftTabDescriptor());

  // slim = the STANDING affordances on a populated Meetings page: plan + drop-bot are ALWAYS
  // available (owner ruling 2026-07-09); the calendar card additionally shows while this user
  // has no calendar connected.
  if (variant === "slim") {
    return (
      <>
        {connected === false && (
          <div style={{ ...cardBase, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 }}>
            <Icon name="cal" size={15} style={{ color: "var(--t3)", flex: "none" }} />
            <span style={{ ...cardBody, flex: 1 }}>
              <b style={{ color: "var(--t2)" }}>Nenhum calendário conectado</b> — conecte o feed ICS secreto do seu calendário e as reuniões agendadas aparecerão aqui sozinhas; com a entrada automática ativada, o bot entra quando elas começarem.
            </span>
            <button style={{ ...cta, flex: "none" }} onClick={() => setModal(true)}>Conectar calendário →</button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={() => plan()}
            style={{ flex: "none", background: "transparent", border: "1px dashed var(--line2)", color: "var(--t2)", borderRadius: 7, padding: "7px 11px", fontSize: 12, cursor: "pointer" }}>
            + Planejar uma reunião
          </button>
          <div style={{ flex: 1, minWidth: 220 }}><DropBotInline /></div>
        </div>
        {modal && <ConnectCalendarModal onClose={() => setModal(false)} onConnected={reprobe} />}
      </>
    );
  }

  // full = the empty-Meetings center stage (frame 4): three paths, calendar primary.
  return (
    <>
      <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--t3)" }}>
        Nada aqui ainda — escolha como as reuniões devem chegar.
      </div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {connected !== true && (
          <div style={{ ...cardBase, border: "1px solid var(--accent)", background: "var(--panel)" }}>
            <span style={cardTitle}><Icon name="cal" size={14} /> Conectar seu calendário</span>
            <span style={cardBody}>
              Configuração única. As reuniões agendadas aparecerão aqui sozinhas; com a entrada automática ativada, o bot entra quando elas começarem.
            </span>
            <button style={cta} onClick={() => setModal(true)}>Conectar calendário →</button>
          </div>
        )}
        <div style={cardBase}>
          <span style={cardTitle}><Icon name="plus" size={14} /> Planejar uma reunião</span>
          <span style={cardBody}>Crie uma reunião manualmente — título, hora, link do Meet. Bom para um primeiro teste.</span>
          <button style={cta} onClick={() => plan()}>+ Planejar uma reunião</button>
        </div>
        <div style={cardBase}>
          <span style={cardTitle}><Icon name="send" size={14} /> Enviar um bot agora</span>
          <span style={cardBody}>Envie o notetaker para uma reunião que já está em andamento.</span>
          <DropBotInline />
        </div>
      </div>
      {connected === true && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--t3)" }}>
          ✓ Calendário conectado — as reuniões agendadas aparecerão aqui conforme sincronizam. Gerencie em Configurações → Calendário.
        </div>
      )}
      {modal && <ConnectCalendarModal onClose={() => setModal(false)} onConnected={reprobe} />}
    </>
  );
}
