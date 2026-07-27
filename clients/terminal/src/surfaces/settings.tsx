"use client";
/** Settings — the footer-gear CENTER tab (design-spec meeting-lifecycle-v2, W5): account-level
 *  configuration in one place — Calendar integration, API tokens, GitHub token, Account. The old
 *  "API Tokens" activity-bar item retired into here (its panels are imported, not duplicated);
 *  the Meetings sidebar keeps its own calendar connect UI at the point of need — this is the
 *  durable home. Sections are a left nav (no sub-routing; one tab, local state). */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { registerTab } from "../contributions";
import { Icon } from "../ui-kit";
import { GitHubTokenCard, TokensPanel } from "./tokens";
import { getCalendarConfig, setCalendarConfig, getCalendarSyncStatus, syncCalendarNow, type CalendarConfig, type CalendarSyncStamp } from "./plannedApi";
import { getModelPrefs, setModelPrefs, getTranscriptionPrefs, setTranscriptionPrefs, getGlobalSetting, setGlobalSetting, testModels, testTranscription, type ConfigTestResult } from "./settingsApi";
import { getBotConfig, setBotConfig, type BotConfig } from "./botConfig";

type SectionId = "calendar" | "bot" | "models" | "tokens" | "github" | "account";
const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "calendar", label: "Calendário", icon: "cal" },
  { id: "bot", label: "Bot", icon: "user" },
  { id: "models", label: "Modelos", icon: "spark" },
  { id: "tokens", label: "Tokens de API", icon: "key" },
  { id: "github", label: "GitHub", icon: "github" },
  { id: "account", label: "Conta", icon: "user" },
];

const field: CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: 12, padding: "6px 9px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", color: "var(--t1)" };
const btn: CSSProperties = { fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel2)", color: "var(--t1)", cursor: "pointer" };

/** Calendar integration — the ICS feed + the global auto-join default. Same API the Meetings
 *  sidebar's connect button uses (identity admin-api via the gateway); errors stay loud. */
function CalendarSection() {
  const [cfg, setCfg] = useState<CalendarConfig | null>(null);
  const [stamp, setStamp] = useState<CalendarSyncStamp | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    getCalendarConfig().then((c) => { setCfg(c); setErr(null); }).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    getCalendarSyncStatus().then(setStamp).catch(() => undefined);
  };
  useEffect(refresh, []);

  const save = async (body: { ics_url?: string | null; auto_join?: boolean }) => {
    setBusy(true); setErr(null);
    try { setCfg(await setCalendarConfig(body)); setUrl(""); refresh(); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const syncNow = async () => {
    setSyncing(true); setErr(null);
    try { setStamp(await syncCalendarNow()); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSyncing(false); }
  };

  const connected = !!cfg?.ics_url_set;
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.5, marginBottom: 12, maxWidth: 460 }}>
        Conecte o feed ICS secreto do seu calendário e as reuniões agendadas aparecerão sozinhas em Reuniões;
        com a entrada automática ativada, o bot entra quando elas começarem.
      </div>
      {err && <div role="alert" style={{ fontSize: 11.5, color: "var(--danger)", marginBottom: 10 }}>⚠ {err}</div>}
      {connected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="cal" size={13} style={{ color: "var(--green)" }} />
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--t2)", fontFamily: "var(--mono)" }}>{cfg?.ics_url_masked ?? "conectado"}</span>
            <button disabled={busy || syncing} onClick={() => void syncNow()} style={btn}>{syncing ? "Sincronizando…" : "Sincronizar agora"}</button>
            <button disabled={busy || syncing} onClick={() => void save({ ics_url: null })} style={{ ...btn, color: "var(--danger)" }}>Desconectar</button>
          </div>
          {stamp?.last_error
            ? <div role="alert" style={{ fontSize: 11.5, color: "var(--danger)", lineHeight: 1.5 }}>⚠ A última sincronização falhou: {stamp.last_error}</div>
            : stamp?.last_sync && <div style={{ fontSize: 11, color: "var(--t3)" }}>Última sincronização {new Date(stamp.last_sync).toLocaleString()}</div>}
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--t2)", cursor: "pointer" }}>
            <input type="checkbox" checked={cfg?.auto_join !== false} disabled={busy}
              onChange={(e) => void save({ auto_join: e.target.checked })} />
            Entrada automática — envie o bot para reuniões do calendário que têm um link
          </label>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/…/basic.ics (endereço secreto)"
            onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) void save({ ics_url: url.trim() }); }} style={field} />
          <button disabled={busy || !url.trim()} onClick={() => void save({ ics_url: url.trim() })}
            style={{ ...btn, background: "var(--accent)", color: "var(--on-accent)", border: "none", opacity: busy || !url.trim() ? 0.5 : 1, flex: "none" }}>
            {busy ? "Conectando…" : "Conectar"}
          </button>
        </div>
      )}
    </div>
  );
}

/** One models/transcription config form — the SAME fields serve the per-user prefs and (for
 *  admins) the global platform defaults; only load/save differ. Secrets arrive MASKED
 *  (********abcd): an untouched masked value is never sent back, typing replaces it, emptying a
 *  previously-set field clears it (empty string = clear, the API's contract). */
function ConfigForm({ fields, load, save, note }: {
  fields: Array<{ key: string; label: string; placeholder?: string; secret?: boolean; options?: Array<{ value: string; label: string }>; showIf?: (v: Record<string, string>) => boolean }>;
  load: () => Promise<Record<string, string>>;
  save: (update: Record<string, string>) => Promise<Record<string, string>>;
  note?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let on = true;
    load().then((v) => { if (on) { setValues(v); setInitial(v); } })
      .catch((e: unknown) => on && setErr(e instanceof Error ? e.message : String(e)));
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = fields.some((f) => (values[f.key] ?? "") !== (initial[f.key] ?? ""));
  const doSave = async () => {
    setBusy(true); setErr(null); setSaved(false);
    // Send only what changed; an untouched masked secret stays server-side.
    const update: Record<string, string> = {};
    for (const f of fields) {
      if ((values[f.key] ?? "") !== (initial[f.key] ?? "")) update[f.key] = values[f.key] ?? "";
    }
    try { const v = await save(update); setValues(v); setInitial(v); setSaved(true); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
      {note && <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.5 }}>{note}</div>}
      {err && <div role="alert" style={{ fontSize: 11.5, color: "var(--danger)" }}>⚠ {err}</div>}
      {fields.map((f) => (f.showIf && !f.showIf(values)) ? null : (
        <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--t2)" }}>
          <span style={{ width: 110, flex: "none", color: "var(--t3)" }}>{f.label}</span>
          {f.options ? (
            <select value={values[f.key] ?? ""}
              onChange={(e) => { setSaved(false); setValues((v) => ({ ...v, [f.key]: e.target.value })); }}
              style={{ ...field, width: "auto", flex: 1 }}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input value={values[f.key] ?? ""} placeholder={f.placeholder}
              type={f.secret && (values[f.key] ?? "") !== (initial[f.key] ?? "") ? "password" : "text"}
              onChange={(e) => { setSaved(false); setValues((v) => ({ ...v, [f.key]: e.target.value })); }}
              style={field} />
          )}
        </label>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button disabled={busy || !dirty} onClick={() => void doSave()}
          style={{ ...btn, background: dirty ? "var(--accent)" : "var(--panel2)", color: dirty ? "var(--on-accent)" : "var(--t3)", border: dirty ? "none" : btn.border, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
        {saved && <span style={{ fontSize: 11.5, color: "var(--green)" }}>Salvo — o próximo turno do agente o usará</span>}
      </div>
    </div>
  );
}

/** On-demand credential test row (fail-loud surface): runs the EFFECTIVE config — the same
 *  user > global > env resolution a chat turn / bot spawn applies — against the real backend
 *  and prints the verdict inline, remedy included. What Save can't tell you, Test does. */
function TestRow({ label, run }: { label: string; run: () => Promise<ConfigTestResult> }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ConfigTestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const doTest = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await run()); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const provenance = res ? [res.mode, res.source && `via ${res.source}`].filter(Boolean).join(" · ") : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 460, marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button disabled={busy} onClick={() => void doTest()}
          style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Testando…" : label}
        </button>
        {res && (
          <span style={{ fontSize: 11.5, color: res.ok ? "var(--green)" : "var(--danger)" }}>
            {res.ok ? "✓" : "✗"} {provenance && <span style={{ color: "var(--t3)" }}>[{provenance}] </span>}
            {res.summary}
          </span>
        )}
        {err && <span role="alert" style={{ fontSize: 11.5, color: "var(--danger)" }}>⚠ o teste falhou: {err}</span>}
      </div>
    </div>
  );
}

/** Models — which LLM the agent runs on and which STT backend the bot transcribes with; your own
 *  settings first, the deployment-wide defaults below for admins. Empty fields = the level below
 *  decides (global settings, then the deployment env). */
function ModelsSection() {
  const [globalAdmin, setGlobalAdmin] = useState(false);
  useEffect(() => {
    let on = true;
    // Admin probe: the global card renders only when /api/admin/settings answers (404 = not admin).
    getGlobalSetting("models").then((v) => on && setGlobalAdmin(v !== null)).catch(() => undefined);
    return () => { on = false; };
  }, []);

  const modelFields = [
    { key: "mode", label: "Provedor", options: [
      { value: "", label: "Padrão de implantação" },
      { value: "subscription", label: "Assinatura do Claude (credenciais de implantação)" },
      { value: "custom", label: "Endpoint personalizado (código aberto / gateway)" },
    ] },
    { key: "base_url", label: "URL base", placeholder: "https://… (gateway compatível com Anthropic/OpenAI)", showIf: (v: Record<string, string>) => v.mode === "custom" },
    { key: "api_key", label: "Chave da API", placeholder: "inalterado a menos que digitado", secret: true, showIf: (v: Record<string, string>) => v.mode === "custom" },
    { key: "model", label: "Modelo de chat", placeholder: "padrão da implantação (ex. sonnet)" },
    { key: "meeting_model", label: "Modelo de reunião", placeholder: "o padrão é o modelo de chat" },
  ];
  const transcriptionFields = [
    { key: "url", label: "URL do Serviço", placeholder: "padrão da implantação" },
    { key: "token", label: "Token", placeholder: "inalterado a menos que digitado", secret: true },
  ];
  const asStrings = (v: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (typeof val === "string" && val) out[k] = val;
    return out;
  };
  const head: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--t1)", margin: "14px 0 6px" };

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.5, marginBottom: 12, maxWidth: 460 }}>
        Qual modelo o agente executa e qual serviço de transcrição os bots de reunião usam. O provedor
        &ldquo;subscription&rdquo; usa as credenciais do Claude da implantação; &ldquo;custom&rdquo; aponta para o seu próprio
        endpoint compatível com Anthropic/OpenAI (um gateway LiteLLM/OpenRouter atende a modelos de código aberto).
        Campos vazios herdam os padrões da implantação.
      </div>
      <div style={head}>Seus modelos</div>
      <ConfigForm fields={modelFields} load={async () => asStrings(await getModelPrefs())}
        save={async (u) => asStrings(await setModelPrefs(u))} />
      <TestRow label="Testar credenciais do modelo" run={testModels} />
      <div style={head}>Seu backend de transcrição</div>
      <ConfigForm fields={transcriptionFields} load={async () => asStrings(await getTranscriptionPrefs())}
        save={async (u) => asStrings(await setTranscriptionPrefs(u))} />
      <TestRow label="Testar backend de transcrição" run={testTranscription} />
      {globalAdmin && <>
        <div style={{ ...head, marginTop: 22, color: "var(--accent)" }}>Padrões globais (admin — todos os usuários sem configurações próprias)</div>
        <ConfigForm fields={modelFields} load={async () => (await getGlobalSetting("models")) ?? {}}
          save={(u) => setGlobalSetting("models", u)} />
        <div style={head}>Backend de transcrição global</div>
        <ConfigForm fields={transcriptionFields} load={async () => (await getGlobalSetting("transcription")) ?? {}}
          save={(u) => setGlobalSetting("transcription", u)} />
      </>}
    </div>
  );
}

function AccountSection() {
  const [user, setUser] = useState<{ email?: string | null; name?: string | null } | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => on && setUser((d?.user as { email?: string; name?: string } | undefined) ?? null))
      .catch(() => undefined);
    return () => { on = false; };
  }, []);
  return (
    <div style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.9 }}>
      <div><span style={{ color: "var(--t3)" }}>Conectado como</span> <span style={{ color: "var(--t1)" }}>{user?.name || user?.email || "…"}</span></div>
      {user?.email && <div><span style={{ color: "var(--t3)" }}>E-mail</span> <span style={{ fontFamily: "var(--mono)" }}>{user.email}</span></div>}
      <div style={{ color: "var(--t3)", marginTop: 6 }}>O tema e a opção de sair ficam ao lado do seu nome no rodapé.</div>
    </div>
  );
}

/** Bot configuration — name and avatar the bot uses when joining meetings. */
function BotSection() {
  const [cfg, setCfg] = useState<BotConfig>({ name: "Master Meeting", avatarUrl: "", language: "pt-BR" });
  const [saved, setSaved] = useState(false);
  useEffect(() => { setCfg(getBotConfig()); }, []);
  const save = () => {
    setCfg(setBotConfig(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <div style={{ maxWidth: 460, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.5 }}>
        Configure o nome, imagem de perfil e idioma de transcrição que o bot usará quando entrar em reuniões.
        Essas preferências são salvas no navegador e valem para todos os bots enviados a partir daqui.
      </div>
      <div>
        <label style={{ fontSize: 11.5, color: "var(--t3)", display: "block", marginBottom: 4 }}>Nome do Bot</label>
        <input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
          placeholder="Master Meeting" style={field} />
      </div>
      <div>
        <label style={{ fontSize: 11.5, color: "var(--t3)", display: "block", marginBottom: 4 }}>URL do Avatar (opcional)</label>
        <input value={cfg.avatarUrl} onChange={(e) => setCfg({ ...cfg, avatarUrl: e.target.value })}
          placeholder="https://exemplo.com/avatar.png" style={field} />
      </div>
      {cfg.avatarUrl.trim() && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={cfg.avatarUrl.trim()} alt="Preview do avatar"
            style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--line)", background: "var(--panel2)" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <span style={{ fontSize: 11, color: "var(--t3)" }}>Preview do avatar</span>
        </div>
      )}
      <div>
        <label style={{ fontSize: 11.5, color: "var(--t3)", display: "block", marginBottom: 4 }}>Idioma da Transcrição</label>
        <select value={cfg.language} onChange={(e) => setCfg({ ...cfg, language: e.target.value })}
          style={{ ...field, width: "100%" }}>
          <option value="pt-BR">🇧🇷 Português (Brasil)</option>
          <option value="en">🇺🇸 Inglês</option>
          <option value="es">🇪🇸 Espanhol</option>
          <option value="fr">🇫🇷 Francês</option>
          <option value="de">🇩🇪 Alemão</option>
          <option value="">🌐 Automático (Whisper detecta)</option>
        </select>
        <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 4 }}>
          Travar o idioma evita que a transcrição alterne entre línguas diferentes durante a reunião.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={save} style={{ ...btn, background: "var(--accent)", color: "var(--bg)", border: "none" }}>Salvar</button>
        {saved && <span style={{ fontSize: 11.5, color: "var(--green)" }}>✓ Salvo</span>}
      </div>
    </div>
  );
}

function SettingsView() {
  const [section, setSection] = useState<SectionId>("calendar");
  const bodies: Record<SectionId, ReactNode> = {
    calendar: <CalendarSection />,
    bot: <BotSection />,
    models: <ModelsSection />,
    tokens: <TokensPanel />,
    github: <GitHubTokenCard />,
    account: <AccountSection />,
  };
  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 160, flex: "none", borderRight: "1px solid var(--line)", padding: "14px 8px", background: "var(--sidebar)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", padding: "0 8px 10px" }}>Configurações</div>
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)}
            style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", fontSize: 12.5,
              padding: "6px 9px", borderRadius: 7, border: "none", cursor: "pointer",
              color: section === s.id ? "var(--t1)" : "var(--t2)", background: section === s.id ? "var(--panel2)" : "transparent" }}>
            <Icon name={s.icon} size={13} />{s.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t1)", marginBottom: 12 }}>
          {SECTIONS.find((s) => s.id === section)?.label}
        </div>
        {bodies[section]}
      </div>
    </div>
  );
}

registerTab("settings", SettingsView);
