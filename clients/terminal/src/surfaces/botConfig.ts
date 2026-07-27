/** botConfig — persistent bot preferences (name + avatar URL) stored in localStorage.
 *
 *  Every place that sends POST /bots reads these prefs, so changing them in Settings takes
 *  effect for the next bot dispatch without a page reload. The backend already accepts
 *  `bot_name` and `bot_avatar_url` on POST /bots — we just feed them from user prefs
 *  instead of hardcoding "Master Meeting".
 */

export interface BotConfig {
  name: string;
  avatarUrl: string;
  language: string; // "pt-BR" | "en" | "es" | "" (auto)
}

const STORAGE_KEY = "vexa.terminal.bot.config.v1";
const DEFAULT_BOT_NAME = "Master Meeting";

export function getBotConfig(): BotConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        name: (typeof parsed.name === "string" && parsed.name.trim()) || DEFAULT_BOT_NAME,
        avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl.trim() : "",
        language: typeof parsed.language === "string" ? parsed.language : "pt-BR",
      };
    }
  } catch { /* private mode / parse error — use defaults */ }
  return { name: DEFAULT_BOT_NAME, avatarUrl: "", language: "pt-BR" };
}

export function setBotConfig(config: Partial<BotConfig>): BotConfig {
  const current = getBotConfig();
  const next: BotConfig = {
    name: (config.name !== undefined ? config.name.trim() : current.name) || DEFAULT_BOT_NAME,
    avatarUrl: config.avatarUrl !== undefined ? config.avatarUrl.trim() : current.avatarUrl,
    language: config.language !== undefined ? config.language : current.language,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* private mode — config just doesn't persist */ }
  return next;
}

/** Build the bot_name + bot_avatar_url + language fields for a POST /bots body. */
export function botBodyFields(): { bot_name: string; bot_avatar_url?: string; language?: string } {
  const cfg = getBotConfig();
  return {
    bot_name: cfg.name,
    ...(cfg.avatarUrl ? { bot_avatar_url: cfg.avatarUrl } : {}),
    ...(cfg.language ? { language: cfg.language } : {}),
  };
}
