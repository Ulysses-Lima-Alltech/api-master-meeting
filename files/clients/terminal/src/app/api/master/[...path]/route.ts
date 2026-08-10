import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;
const VALID_SCOPES = new Set(["bot", "tx", "browser"]);

type RouteContext = { params: Promise<{ path: string[] }> };

type AdminResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

type AdminUser = {
  id: string | number;
  email: string;
  name?: string | null;
  max_concurrent_bots?: number;
  created_at?: string | null;
};

type AdminToken = {
  id?: number;
  user_id?: number;
  token?: string;
  scopes?: string[];
  name?: string | null;
  created_at?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
};

function localRequestOnly(request: NextRequest): NextResponse | null {
  if (process.env.MASTER_API_PANEL_ALLOW_REMOTE === "true") return null;

  let hostname = "";
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  const allowed = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (allowed.has(hostname)) return null;

  return NextResponse.json(
    {
      error:
        "O painel administrativo aceita apenas acesso local. Defina MASTER_API_PANEL_ALLOW_REMOTE=true somente atrás de autenticação administrativa.",
    },
    { status: 403, headers: NO_STORE },
  );
}

function adminConfig(): { url: string; key: string } | null {
  const url = (process.env.VEXA_ADMIN_API_URL || "").replace(/\/$/, "");
  const key = process.env.VEXA_ADMIN_API_KEY || "";
  if (!url || !key || key === "your_admin_api_key_here") return null;
  return { url, key };
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<AdminResult<T>> {
  const cfg = adminConfig();
  if (!cfg) {
    return {
      ok: false,
      status: 503,
      error: "Admin API não configurada no servidor (VEXA_ADMIN_API_URL / VEXA_ADMIN_API_KEY).",
    };
  }

  try {
    const response = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-API-Key": cfg.key,
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    const raw = await response.text();
    let data: T | undefined;

    if (raw) {
      try {
        data = JSON.parse(raw) as T;
      } catch {
        data = undefined;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: raw.slice(0, 500) || `admin-api retornou ${response.status}`,
      };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    const err = error as Error;
    return {
      ok: false,
      status: 503,
      error: err.name === "TimeoutError" ? "Tempo limite ao acessar a Admin API." : err.message,
    };
  }
}

function jsonError(result: AdminResult<unknown>, fallback: string): NextResponse {
  return NextResponse.json(
    { error: result.error || fallback },
    { status: result.status || 502, headers: NO_STORE },
  );
}

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 3 &&
    value.trim().length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

async function ensureClient(request: NextRequest): Promise<NextResponse> {
  let body: { email?: unknown };

  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400, headers: NO_STORE });
  }

  if (!validEmail(body.email)) {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400, headers: NO_STORE });
  }

  const email = body.email.trim().toLowerCase();
  const found = await adminRequest<AdminUser>(`/admin/users/email/${encodeURIComponent(email)}`, {
    method: "GET",
  });

  if (found.ok && found.data) {
    return NextResponse.json({ client: found.data, created: false }, { headers: NO_STORE });
  }

  if (found.status !== 404) return jsonError(found, "Não foi possível localizar o cliente.");

  const created = await adminRequest<AdminUser>("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  if (!created.ok || !created.data) return jsonError(created, "Não foi possível criar o cliente.");

  return NextResponse.json({ client: created.data, created: true }, { status: 201, headers: NO_STORE });
}

function parsePositiveId(value: string | undefined): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return value;
}

async function listTokens(userId: string): Promise<NextResponse> {
  const listed = await adminRequest<AdminToken[]>(`/admin/users/${encodeURIComponent(userId)}/tokens`, {
    method: "GET",
  });

  if (!listed.ok) return jsonError(listed, "Não foi possível listar as chaves.");

  return NextResponse.json({ tokens: listed.data ?? [] }, { headers: NO_STORE });
}

async function mintToken(request: NextRequest, userId: string): Promise<NextResponse> {
  let body: { scopes?: unknown; name?: unknown; expiresIn?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400, headers: NO_STORE });
  }

  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  if (scopes.length === 0 || scopes.some((scope) => !VALID_SCOPES.has(scope))) {
    return NextResponse.json(
      { error: "Selecione ao menos um escopo válido: bot, tx ou browser." },
      { status: 400, headers: NO_STORE },
    );
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 255)
      : undefined;

  const expiresIn =
    typeof body.expiresIn === "number" && Number.isFinite(body.expiresIn) && body.expiresIn > 0
      ? Math.floor(body.expiresIn)
      : undefined;

  const query = new URLSearchParams({ scopes: [...new Set(scopes)].join(",") });
  if (name) query.set("name", name);
  if (expiresIn) query.set("expires_in", String(expiresIn));

  const minted = await adminRequest<AdminToken>(
    `/admin/users/${encodeURIComponent(userId)}/tokens?${query.toString()}`,
    { method: "POST" },
  );

  if (!minted.ok || !minted.data?.token) return jsonError(minted, "Não foi possível gerar a chave.");

  return NextResponse.json({ token: minted.data }, { status: 201, headers: NO_STORE });
}

async function revokeToken(request: NextRequest, tokenId: string): Promise<NextResponse> {
  const userId = parsePositiveId(request.nextUrl.searchParams.get("userId") || undefined);

  if (!userId) {
    return NextResponse.json(
      { error: "userId é obrigatório para validar a propriedade da chave." },
      { status: 400, headers: NO_STORE },
    );
  }

  const listed = await adminRequest<AdminToken[]>(`/admin/users/${encodeURIComponent(userId)}/tokens`, {
    method: "GET",
  });

  if (!listed.ok) return jsonError(listed, "Não foi possível validar a chave.");

  const belongsToClient = (listed.data ?? []).some((token) => String(token.id) === tokenId);

  if (!belongsToClient) {
    return NextResponse.json(
      { error: "Chave não encontrada para este cliente." },
      { status: 404, headers: NO_STORE },
    );
  }

  const revoked = await adminRequest<void>(`/admin/tokens/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
  });

  if (!revoked.ok) return jsonError(revoked, "Não foi possível revogar a chave.");

  return NextResponse.json({ success: true }, { headers: NO_STORE });
}

async function dispatch(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const localError = localRequestOnly(request);
  if (localError) return localError;

  const { path = [] } = await context.params;
  const method = request.method.toUpperCase();

  if (method === "POST" && path.length === 1 && path[0] === "clients") {
    return ensureClient(request);
  }

  if (path.length === 3 && path[0] === "clients" && path[2] === "tokens") {
    const userId = parsePositiveId(path[1]);

    if (!userId) {
      return NextResponse.json(
        { error: "ID de cliente inválido." },
        { status: 400, headers: NO_STORE },
      );
    }

    if (method === "GET") return listTokens(userId);
    if (method === "POST") return mintToken(request, userId);
  }

  if (method === "DELETE" && path.length === 2 && path[0] === "tokens") {
    const tokenId = parsePositiveId(path[1]);

    if (!tokenId) {
      return NextResponse.json(
        { error: "ID de chave inválido." },
        { status: 400, headers: NO_STORE },
      );
    }

    return revokeToken(request, tokenId);
  }

  return NextResponse.json(
    { error: "Rota administrativa não encontrada." },
    { status: 404, headers: NO_STORE },
  );
}

export function GET(request: NextRequest, context: RouteContext) {
  return dispatch(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return dispatch(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return dispatch(request, context);
}
