import type {
  MetadataDetails,
  MetadataProvider,
  MetadataSearchResult,
  PluginContext,
  ServerPlugin,
} from "@droposs/plugin-sdk";

export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://api.screenscraper.fr/api2";
const SOFT_NAME_DEFAULT = "drop-metadata-screenscraper";
const CONFIG_KEY = "config";

const ENV_KEYS = {
  devId: "SCREENSCRAPER_DEVID",
  devPassword: "SCREENSCRAPER_DEVPASSWORD",
  softName: "SCREENSCRAPER_SOFTNAME",
  ssId: "SCREENSCRAPER_SSID",
  ssPassword: "SCREENSCRAPER_SSPASSWORD",
} as const;

const REGION_PRIORITY = ["wor", "us", "eu", "jp", "fr"];
const LANGUAGE_PRIORITY = ["en", "fr"];

export interface ScreenScraperConfig {
  devId?: string;
  devPassword?: string;
  softName?: string;
  ssId?: string;
  ssPassword?: string;
}

interface LocalizedText {
  region?: string;
  langue?: string;
  text?: string;
}

export interface ScreenScraperMedia {
  type?: string;
  parent?: string;
  region?: string;
  url?: string;
  format?: string;
  size?: string;
}

interface ScreenScraperGenre {
  id?: string;
  noms?: LocalizedText[];
}

interface NamedRecord {
  id?: string;
  text?: string;
}

export interface ScreenScraperGame {
  id?: string | number;
  noms?: LocalizedText[];
  dates?: LocalizedText[];
  genres?: ScreenScraperGenre[];
  developpeur?: NamedRecord;
  editeur?: NamedRecord;
  synopsis?: LocalizedText[];
  joueurs?: { text?: string };
  note?: { text?: string };
  medias?: ScreenScraperMedia[];
  systeme?: { id?: string; nom?: string };
}

function pickByKey(
  entries: LocalizedText[] | undefined,
  key: "region" | "langue",
  priority: string[],
): string | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (const wanted of priority) {
    const match = entries.find(
      (entry) => entry?.[key] === wanted && typeof entry.text === "string" && entry.text.length > 0,
    );
    if (match) return match.text;
  }
  return entries.find((entry) => typeof entry?.text === "string" && entry.text.length > 0)?.text;
}

function pickMediaUrl(medias: ScreenScraperMedia[], types: string[]): string | undefined {
  const matches = medias.filter((media) => media?.type && types.includes(media.type) && media.url);
  for (const region of REGION_PRIORITY) {
    const match = matches.find((media) => media.region === region);
    if (match?.url) return match.url;
  }
  return matches.find((media) => media.url)?.url;
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /\d{4}/.exec(value);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function extractGames(payload: unknown): ScreenScraperGame[] {
  const response = (payload as { response?: { jeux?: unknown; jeu?: unknown } } | undefined)?.response;
  const games = response?.jeux ?? response?.jeu;
  if (Array.isArray(games)) return games as ScreenScraperGame[];
  if (games && typeof games === "object") return [games as ScreenScraperGame];
  return [];
}

export function mapSearchResults(payload: unknown): MetadataSearchResult[] {
  return extractGames(payload)
    .filter((game) => game?.id !== undefined)
    .map((game) => {
      const medias = Array.isArray(game.medias) ? game.medias : [];
      return {
        id: String(game.id),
        title: pickByKey(game.noms, "region", REGION_PRIORITY) ?? "Unknown",
        releaseYear: parseYear(pickByKey(game.dates, "region", REGION_PRIORITY)),
        coverUrl: pickMediaUrl(medias, ["box-2D"]),
        description: pickByKey(game.synopsis, "langue", LANGUAGE_PRIORITY),
        provider: "screenscraper",
      };
    });
}

export function mapGameDetails(payload: unknown): MetadataDetails | null {
  const game = extractGames(payload)[0];
  if (!game?.id) return null;

  const medias = Array.isArray(game.medias) ? game.medias : [];
  const screenshots = medias
    .filter((media) => media.type === "ss" || media.type === "sstitle")
    .map((media) => media.url)
    .filter((url): url is string => Boolean(url));

  const genres = (Array.isArray(game.genres) ? game.genres : [])
    .map((genre) => pickByKey(genre?.noms, "langue", LANGUAGE_PRIORITY))
    .filter((name): name is string => Boolean(name));

  return {
    id: String(game.id),
    title: pickByKey(game.noms, "region", REGION_PRIORITY) ?? "Unknown",
    releaseYear: parseYear(pickByKey(game.dates, "region", REGION_PRIORITY)),
    coverUrl: pickMediaUrl(medias, ["box-2D"]),
    bannerUrl: pickMediaUrl(medias, ["fanart"]),
    iconUrl: pickMediaUrl(medias, ["wheel", "wheel-hd"]),
    description: pickByKey(game.synopsis, "langue", LANGUAGE_PRIORITY),
    genres,
    developers: game.developpeur?.text ? [game.developpeur.text] : undefined,
    publishers: game.editeur?.text ? [game.editeur.text] : undefined,
    screenshots: Array.from(new Set(screenshots)),
    provider: "screenscraper",
    metadata: {
      system: game.systeme?.nom,
      players: game.joueurs?.text,
      rating: game.note?.text,
    },
  };
}

export function resolveConfig(
  config: ScreenScraperConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ScreenScraperConfig {
  return {
    devId: config?.devId?.trim() || env[ENV_KEYS.devId]?.trim() || undefined,
    devPassword: config?.devPassword?.trim() || env[ENV_KEYS.devPassword]?.trim() || undefined,
    softName:
      config?.softName?.trim() || env[ENV_KEYS.softName]?.trim() || SOFT_NAME_DEFAULT,
    ssId: config?.ssId?.trim() || env[ENV_KEYS.ssId]?.trim() || undefined,
    ssPassword: config?.ssPassword?.trim() || env[ENV_KEYS.ssPassword]?.trim() || undefined,
  };
}

export class ScreenScraperProvider implements MetadataProvider {
  id = "screenscraper";
  name = "ScreenScraper";

  constructor(
    private readonly config: ScreenScraperConfig,
    private readonly fetchFn: HttpFetch,
  ) {}

  async search(query: string): Promise<MetadataSearchResult[]> {
    const url = this.buildUrl("jeuRecherche.php");
    url.searchParams.set("recherche", query);
    const payload = await this.request(url);
    return mapSearchResults(payload);
  }

  async getDetails(id: string): Promise<MetadataDetails | null> {
    const url = this.buildUrl("jeuInfos.php");
    url.searchParams.set("gameid", id);
    const payload = await this.request(url);
    return mapGameDetails(payload);
  }

  private buildUrl(endpoint: string): URL {
    const url = new URL(`${API_BASE}/${endpoint}`);
    url.searchParams.set("output", "json");
    url.searchParams.set("softname", this.config.softName ?? SOFT_NAME_DEFAULT);
    if (this.config.devId) url.searchParams.set("devid", this.config.devId);
    if (this.config.devPassword) url.searchParams.set("devpassword", this.config.devPassword);
    if (this.config.ssId) url.searchParams.set("ssid", this.config.ssId);
    if (this.config.ssPassword) url.searchParams.set("sspassword", this.config.ssPassword);
    return url;
  }

  private async request(url: URL): Promise<unknown> {
    const response = await this.fetchFn(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`ScreenScraper request failed with status ${response.status}`);
    }
    return response.json();
  }
}

export default class ScreenScraperPlugin implements ServerPlugin {
  metadata = {
    id: "drop-metadata-screenscraper",
    name: "ScreenScraper",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["metadata:provider" as const, "network" as const, "storage" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    const stored = await ctx.storage.get<ScreenScraperConfig>(CONFIG_KEY);
    const config = resolveConfig(stored);
    ctx.registerMetadataProvider(new ScreenScraperProvider(config, ctx.fetch.bind(ctx)));
    const configured = Boolean(config.devId && config.devPassword);
    ctx.logger.info(
      `ScreenScraper metadata provider registered (developer credentials ${
        configured ? "configured" : "not configured"
      })`,
    );
  }
}
