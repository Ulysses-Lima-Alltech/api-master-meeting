"use client";

import { useCallback, useMemo, useState } from "react";

type ApiClient = {
  id: string | number;
  email: string;
  name?: string | null;
  max_concurrent_bots?: number;
  created_at?: string | null;
};

type TokenInfo = {
  id: number;
  user_id?: number;
  token?: string;
  scopes: string[];
  name?: string | null;
  created_at?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
};

type Scope = "bot" | "tx" | "browser";

const SCOPE_OPTIONS: Array<{ id: Scope; label: string; description: string }> = [
  { id: "bot", label: "Entrar em reuniÃµes", description: "Iniciar, acompanhar e encerrar bots." },
  { id: "tx", label: "Ler transcriÃ§Ãµes", description: "Consultar reuniÃµes e transcriÃ§Ãµes." },
  { id: "browser", label: "NavegaÃ§Ã£o web", description: "Acesso ao navegador remoto quando necessÃ¡rio." },
];

const EXPIRIES = [
  { label: "Sem expiraÃ§Ã£o", value: 0 },
  { label: "24 horas", value: 86_400 },
  { label: "30 dias", value: 30 * 86_400 },
  { label: "90 dias", value: 90 * 86_400 },
];

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;

  if (!response.ok) {
    throw new Error(body.error || `A operaÃ§Ã£o falhou (${response.status}).`);
  }

  return body;
}

function formatDate(value?: string | null): string {
  if (!value) return "â€”";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

export function MasterApiPanel() {
  const [email, setEmail] = useState("");
  const [client, setClient] = useState<ApiClient | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["bot", "tx"]);
  const [expiresIn, setExpiresIn] = useState(0);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clientWasCreated, setClientWasCreated] = useState(false);
  const [busyClient, setBusyClient] = useState(false);
  const [busyToken, setBusyToken] = useState(false);
  const [busyRevoke, setBusyRevoke] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedScopeText = useMemo(
    () => scopes.map((scope) => SCOPE_OPTIONS.find((item) => item.id === scope)?.label ?? scope).join(", "),
    [scopes],
  );

  const refreshTokens = useCallback(async (selected: ApiClient) => {
    const result = await apiJson<{ tokens: TokenInfo[] }>(
      `/api/master/clients/${encodeURIComponent(String(selected.id))}/tokens`,
    );
    setTokens(result.tokens);
  }, []);

  const selectClient = async () => {
    if (!email.trim() || busyClient) return;

    setBusyClient(true);
    setError(null);
    setMintedToken(null);
    setCopied(false);

    try {
      const result = await apiJson<{ client: ApiClient; created: boolean }>("/api/master/clients", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });

      setClient(result.client);
      setClientWasCreated(result.created);
      await refreshTokens(result.client);
    } catch (reason) {
      setClient(null);
      setTokens([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyClient(false);
    }
  };

  const toggleScope = (scope: Scope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const createToken = async () => {
    if (!client || scopes.length === 0 || busyToken) return;

    setBusyToken(true);
    setError(null);
    setMintedToken(null);
    setCopied(false);

    try {
      const result = await apiJson<{ token: TokenInfo & { token: string } }>(
        `/api/master/clients/${encodeURIComponent(String(client.id))}/tokens`,
        {
          method: "POST",
          body: JSON.stringify({
            name: tokenName.trim() || undefined,
            scopes,
            expiresIn: expiresIn > 0 ? expiresIn : undefined,
          }),
        },
      );

      setMintedToken(result.token.token);
      setTokenName("");
      await refreshTokens(client);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyToken(false);
    }
  };

  const copyToken = async () => {
    if (!mintedToken) return;
    await navigator.clipboard.writeText(mintedToken);
    setCopied(true);
  };

  const revoke = async (token: TokenInfo) => {
    if (!client || busyRevoke !== null) return;
    const confirmed = window.confirm(`Revogar a chave "${token.name || `#${token.id}`}"?`);
    if (!confirmed) return;

    setBusyRevoke(token.id);
    setError(null);

    try {
      await apiJson<{ success: boolean }>(
        `/api/master/tokens/${encodeURIComponent(String(token.id))}?userId=${encodeURIComponent(String(client.id))}`,
        { method: "DELETE" },
      );
      await refreshTokens(client);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRevoke(null);
    }
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandMark">M</div>
        <div>
          <div className="brand">Master Meeting</div>
          <div className="subtitle">Gerenciamento de chaves da API</div>
        </div>
        <div className="localBadge">Uso local</div>
      </header>

      <section className="hero">
        <p className="eyebrow">PAINEL ADMINISTRATIVO</p>
        <h1>Crie e gerencie acessos Ã  API</h1>
        <p className="lead">
          Localize ou crie um cliente pelo e-mail, gere chaves com permissÃµes especÃ­ficas e revogue
          acessos quando necessÃ¡rio. O segredo administrativo permanece somente no servidor.
        </p>
      </section>

      {error && (
        <div className="error" role="alert">
          <strong>NÃ£o foi possÃ­vel concluir a operaÃ§Ã£o.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="grid">
        <section className="card">
          <div className="cardHeader">
            <span className="step">1</span>
            <div>
              <h2>Cliente da API</h2>
              <p>Digite o e-mail. Caso nÃ£o exista, o cadastro serÃ¡ criado automaticamente.</p>
            </div>
          </div>

          <label className="label" htmlFor="client-email">
            E-mail do cliente
          </label>
          <div className="row">
            <input
              id="client-email"
              className="input"
              type="email"
              value={email}
              placeholder="cliente@empresa.com"
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void selectClient();
              }}
            />
            <button className="button primary" disabled={!email.trim() || busyClient} onClick={() => void selectClient()}>
              {busyClient ? "Carregandoâ€¦" : "Localizar ou criar"}
            </button>
          </div>

          {client && (
            <div className="clientBox">
              <div>
                <span className="muted">Cliente selecionado</span>
                <strong>{client.email}</strong>
              </div>
              <div>
                <span className="muted">ID</span>
                <strong>{client.id}</strong>
              </div>
              <div>
                <span className="muted">ReuniÃµes simultÃ¢neas</span>
                <strong>{client.max_concurrent_bots ?? "padrÃ£o"}</strong>
              </div>
              <div className={`status ${clientWasCreated ? "new" : ""}`}>
                {clientWasCreated ? "Criado agora" : "Cadastro existente"}
              </div>
            </div>
          )}
        </section>

        <section className={`card ${client ? "" : "disabledCard"}`}>
          <div className="cardHeader">
            <span className="step">2</span>
            <div>
              <h2>Nova chave</h2>
              <p>Defina um nome, as permissÃµes e a validade do acesso.</p>
            </div>
          </div>

          <label className="label" htmlFor="token-name">
            Nome da chave
          </label>
          <input
            id="token-name"
            className="input"
            value={tokenName}
            disabled={!client}
            placeholder="ex.: integraÃ§Ã£o-produÃ§Ã£o"
            onChange={(event) => setTokenName(event.target.value)}
          />

          <div className="label scopeTitle">PermissÃµes</div>
          <div className="scopeList">
            {SCOPE_OPTIONS.map((option) => (
              <label className="scope" key={option.id}>
                <input
                  type="checkbox"
                  checked={scopes.includes(option.id)}
                  disabled={!client}
                  onChange={() => toggleScope(option.id)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>

          <label className="label" htmlFor="expiry">
            Validade
          </label>
          <select
            id="expiry"
            className="input"
            value={expiresIn}
            disabled={!client}
            onChange={(event) => setExpiresIn(Number(event.target.value))}
          >
            {EXPIRIES.map((expiry) => (
              <option value={expiry.value} key={expiry.label}>
                {expiry.label}
              </option>
            ))}
          </select>

          <div className="summary">
            <span>PermissÃµes selecionadas</span>
            <strong>{selectedScopeText || "Nenhuma"}</strong>
          </div>

          <button
            className="button primary full"
            disabled={!client || scopes.length === 0 || busyToken}
            onClick={() => void createToken()}
          >
            {busyToken ? "Gerando chaveâ€¦" : "Gerar chave de API"}
          </button>
        </section>
      </div>

      {mintedToken && (
        <section className="secretCard">
          <div>
            <p className="eyebrow">CHAVE CRIADA</p>
            <h2>Copie agora â€” ela nÃ£o serÃ¡ exibida novamente</h2>
          </div>
          <code>{mintedToken}</code>
          <div className="secretActions">
            <button className="button primary" onClick={() => void copyToken()}>
              {copied ? "Copiada" : "Copiar chave"}
            </button>
            <button className="button secondary" onClick={() => setMintedToken(null)}>
              Fechar
            </button>
          </div>
        </section>
      )}

      <section className={`card tokensCard ${client ? "" : "disabledCard"}`}>
        <div className="cardHeader">
          <span className="step">3</span>
          <div>
            <h2>Chaves do cliente</h2>
            <p>Os valores secretos nÃ£o sÃ£o recuperÃ¡veis; somente os metadados ficam disponÃ­veis.</p>
          </div>
          {client && (
            <button className="button secondary refresh" onClick={() => void refreshTokens(client)}>
              Atualizar
            </button>
          )}
        </div>

        {!client ? (
          <div className="empty">Selecione um cliente para visualizar as chaves.</div>
        ) : tokens.length === 0 ? (
          <div className="empty">Este cliente ainda nÃ£o possui chaves.</div>
        ) : (
          <div className="tokenTable">
            {tokens.map((token) => (
              <article className="tokenRow" key={token.id}>
                <div className="tokenIcon">â—†</div>
                <div className="tokenMain">
                  <strong>{token.name || `Chave #${token.id}`}</strong>
                  <span>{(token.scopes || []).join(" Â· ")}</span>
                </div>
                <div className="tokenMeta">
                  <span>Criada</span>
                  <strong>{formatDate(token.created_at)}</strong>
                </div>
                <div className="tokenMeta">
                  <span>Expira</span>
                  <strong>{token.expires_at ? formatDate(token.expires_at) : "Nunca"}</strong>
                </div>
                <button
                  className="button danger"
                  disabled={busyRevoke === token.id}
                  onClick={() => void revoke(token)}
                >
                  {busyRevoke === token.id ? "Revogandoâ€¦" : "Revogar"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>
          Painel sem login de usuÃ¡rio e restrito a <strong>localhost</strong>. NÃ£o exponha a porta
          13000 publicamente sem autenticaÃ§Ã£o administrativa.
        </span>
        
      </footer>

      <style jsx>{`
        :global(*) { box-sizing: border-box; }
        :global(html), :global(body) { margin: 0; min-height: 100%; background: #090b10; }
        :global(body) { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f4f7fb; }
        .shell { min-height: 100vh; padding: 0 32px 40px; background:
          radial-gradient(circle at 10% -10%, rgba(33, 197, 148, .17), transparent 30%),
          radial-gradient(circle at 90% 0%, rgba(76, 120, 255, .12), transparent 30%),
          #090b10; }
        .topbar { height: 76px; max-width: 1180px; margin: 0 auto; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #202630; }
        .brandMark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; background: linear-gradient(135deg, #31d6a1, #148f70); color: #06120f; font-weight: 900; }
        .brand { font-size: 15px; font-weight: 750; letter-spacing: .01em; }
        .subtitle { margin-top: 2px; color: #8993a4; font-size: 12px; }
        .localBadge { margin-left: auto; padding: 6px 10px; border: 1px solid #245746; border-radius: 999px; color: #6be0b7; background: #10281f; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
        .hero { max-width: 1180px; margin: 0 auto; padding: 52px 0 30px; }
        .eyebrow { margin: 0 0 10px; color: #43d9a5; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
        h1 { margin: 0; max-width: 760px; font-size: clamp(34px, 5vw, 58px); line-height: 1.02; letter-spacing: -.045em; }
        .lead { max-width: 760px; margin: 18px 0 0; color: #a7b0bf; font-size: 15px; line-height: 1.65; }
        .error { max-width: 1180px; margin: 0 auto 18px; display: flex; flex-direction: column; gap: 4px; padding: 13px 15px; border: 1px solid #78333d; border-radius: 10px; background: #2b1319; color: #ffb0b9; font-size: 13px; }
        .grid { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .card, .secretCard { border: 1px solid #242b36; border-radius: 14px; background: rgba(16, 19, 26, .94); box-shadow: 0 20px 60px rgba(0,0,0,.2); }
        .card { padding: 22px; }
        .cardHeader { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 22px; }
        .cardHeader h2, .secretCard h2 { margin: 0; font-size: 17px; }
        .cardHeader p { margin: 5px 0 0; color: #8993a4; font-size: 12px; line-height: 1.5; }
        .step { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 8px; background: #162d26; color: #54dcae; font-size: 12px; font-weight: 800; }
        .label { display: block; margin: 0 0 7px; color: #b9c1ce; font-size: 12px; font-weight: 650; }
        .input { width: 100%; min-height: 42px; border: 1px solid #303846; border-radius: 9px; background: #0c0f15; color: #f4f7fb; padding: 0 12px; outline: none; }
        .input:focus { border-color: #35c997; box-shadow: 0 0 0 3px rgba(53, 201, 151, .11); }
        .input:disabled { opacity: .55; cursor: not-allowed; }
        .row { display: flex; gap: 9px; }
        .button { min-height: 38px; border-radius: 9px; padding: 0 14px; border: 1px solid transparent; cursor: pointer; color: #eef3f8; font-weight: 700; font-size: 12px; white-space: nowrap; }
        .button:disabled { opacity: .5; cursor: not-allowed; }
        .primary { background: linear-gradient(135deg, #31d6a1, #149171); color: #06120f; }
        .secondary { border-color: #303846; background: #151922; }
        .danger { border-color: #6b3038; background: #2b151a; color: #ff9da9; }
        .full { width: 100%; margin-top: 16px; }
        .clientBox { margin-top: 16px; padding: 14px; display: grid; grid-template-columns: 1.7fr .55fr 1fr auto; gap: 14px; align-items: center; border: 1px solid #25372f; border-radius: 10px; background: #0d1714; }
        .clientBox > div:not(.status) { display: flex; flex-direction: column; gap: 4px; }
        .clientBox strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
        .muted { color: #798394; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
        .status { padding: 5px 8px; border-radius: 999px; background: #172129; color: #aab5c5; font-size: 10px; font-weight: 750; }
        .status.new { background: #153227; color: #65dfb5; }
        .scopeTitle { margin-top: 17px; }
        .scopeList { display: grid; gap: 8px; margin-bottom: 16px; }
        .scope { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid #262d38; border-radius: 9px; background: #0d1016; cursor: pointer; }
        .scope input { margin-top: 3px; accent-color: #35c997; }
        .scope span { display: flex; flex-direction: column; gap: 3px; }
        .scope strong { font-size: 12px; }
        .scope small { color: #7f8998; font-size: 10.5px; line-height: 1.4; }
        .summary { margin-top: 13px; padding: 10px 12px; display: flex; justify-content: space-between; gap: 16px; border-radius: 9px; background: #0c0f15; color: #7f8998; font-size: 11px; }
        .summary strong { color: #c8d0dc; text-align: right; }
        .disabledCard { opacity: .63; }
        .secretCard { max-width: 1180px; margin: 18px auto 0; padding: 22px; border-color: #256449; background: linear-gradient(135deg, rgba(18, 48, 37, .96), rgba(12, 19, 19, .98)); }
        .secretCard code { display: block; margin: 18px 0; padding: 14px; border: 1px solid #2d7356; border-radius: 10px; background: #07100d; color: #74e4bc; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
        .secretActions { display: flex; gap: 8px; }
        .tokensCard { max-width: 1180px; margin: 18px auto 0; }
        .refresh { margin-left: auto; }
        .empty { padding: 28px; border: 1px dashed #2b323e; border-radius: 10px; color: #727d8d; text-align: center; font-size: 12px; }
        .tokenTable { display: grid; gap: 8px; }
        .tokenRow { display: grid; grid-template-columns: auto minmax(180px, 1fr) 180px 180px auto; gap: 14px; align-items: center; padding: 12px; border: 1px solid #252c36; border-radius: 10px; background: #0d1016; }
        .tokenIcon { color: #43d9a5; font-size: 10px; }
        .tokenMain, .tokenMeta { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .tokenMain strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
        .tokenMain span, .tokenMeta span { color: #788292; font-size: 10px; }
        .tokenMeta strong { color: #b9c1ce; font-size: 11px; font-weight: 600; }
        footer { max-width: 1180px; margin: 18px auto 0; display: flex; justify-content: space-between; gap: 20px; color: #667182; font-size: 11px; }
        footer a { color: #65dcb4; text-decoration: none; }
        @media (max-width: 900px) {
          .shell { padding: 0 18px 28px; }
          .grid { grid-template-columns: 1fr; }
          .clientBox { grid-template-columns: 1fr 1fr; }
          .tokenRow { grid-template-columns: auto 1fr auto; }
          .tokenMeta { display: none; }
        }
        @media (max-width: 600px) {
          .hero { padding-top: 34px; }
          .row { flex-direction: column; }
          .clientBox { grid-template-columns: 1fr; }
          footer { flex-direction: column; }
        }
      `}</style>
    </main>
  );
}
