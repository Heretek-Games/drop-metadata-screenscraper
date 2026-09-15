import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, {
  mapGameDetails,
  mapSearchResults,
  resolveConfig,
  type ScreenScraperConfig,
} from "../src/index.js";

function media(type: string, region: string, url: string, format = "png") {
  return { type, parent: "jeu", region, url, format };
}

const SEARCH_FIXTURE = {
  response: {
    jeux: [
      {
        id: "3",
        noms: [
          { region: "jp", text: "ソニック・ザ・ヘッジホッグ" },
          { region: "wor", text: "Sonic the Hedgehog" },
        ],
        dates: [
          { region: "jp", text: "1991-07-26" },
          { region: "wor", text: "1991-06-23" },
        ],
        synopsis: [
          { langue: "fr", text: "Sonic doit sauver les animaux..." },
          { langue: "en", text: "Sonic must save the animals..." },
        ],
        medias: [
          media("box-2D", "wor", "https://screenscraper.fr/image.php?media=box2D(wor)"),
          media("ss", "wor", "https://screenscraper.fr/image.php?media=ss(wor)", "jpg"),
        ],
      },
    ],
  },
};

const DETAIL_FIXTURE = {
  response: {
    jeu: {
      id: "3",
      noms: [{ region: "wor", text: "Sonic the Hedgehog" }],
      dates: [{ region: "wor", text: "1991-06-23" }],
      genres: [
        {
          id: "4",
          noms: [
            { langue: "fr", text: "Action" },
            { langue: "en", text: "Action" },
          ],
        },
        {
          id: "10",
          noms: [{ langue: "en", text: "Platform" }],
        },
      ],
      developpeur: { id: "43", text: "Sonic Team" },
      editeur: { id: "14", text: "SEGA" },
      synopsis: [
        { langue: "fr", text: "Sonic doit sauver les animaux..." },
        { langue: "en", text: "Sonic must save the animals and defeat Dr. Robotnik." },
      ],
      joueurs: { text: "1" },
      note: { text: "18" },
      systeme: { id: "1", nom: "Mega Drive" },
      medias: [
        media("box-2D", "us", "https://screenscraper.fr/image.php?media=box2D(us)"),
        media("box-2D", "wor", "https://screenscraper.fr/image.php?media=box2D(wor)"),
        media("fanart", "wor", "https://screenscraper.fr/image.php?media=fanart(wor)", "jpg"),
        media("wheel", "wor", "https://screenscraper.fr/image.php?media=wheel(wor)"),
        media("ss", "wor", "https://screenscraper.fr/image.php?media=ss1(wor)", "jpg"),
        media("sstitle", "us", "https://screenscraper.fr/image.php?media=sstitle(us)", "jpg"),
      ],
    },
  },
};

interface FetchCall {
  url: string;
}

function createFetchStub(fixtures: Array<{ match: string; body: unknown; status?: number }>): {
  calls: FetchCall[];
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    calls.push({ url });
    const fixture = fixtures.find((entry) => url.includes(entry.match));
    if (!fixture) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch };
}

async function createProviderContext(
  fixtures: Array<{ match: string; body: unknown; status?: number }>,
  config?: ScreenScraperConfig,
): Promise<{ ctx: MockPluginContext; calls: FetchCall[]; messages: string[] }> {
  const ctx = new MockPluginContext("drop-metadata-screenscraper", ["metadata:provider", "network", "storage"]);
  const messages: string[] = [];
  ctx.logger = {
    info: (message: string) => messages.push(message),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const stub = createFetchStub(fixtures);
  (ctx as { fetch: typeof stub.fetch }).fetch = stub.fetch;
  if (config) {
    await ctx.storage.set("config", config);
  }
  await new Plugin().init(ctx);
  return { ctx, calls: stub.calls, messages };
}

test("drop-metadata-screenscraper registers a metadata provider", async () => {
  const { ctx, messages } = await createProviderContext([]);
  assert.equal(ctx.metadataProviders.size, 1);
  assert.equal(ctx.metadataProviders.get("screenscraper")?.name, "ScreenScraper");
  assert.deepEqual(messages, [
    "ScreenScraper metadata provider registered (developer credentials not configured)",
  ]);
});

test("drop-metadata-screenscraper resolves stored config before env", () => {
  const env = {
    SCREENSCRAPER_DEVID: "env-dev",
    SCREENSCRAPER_DEVPASSWORD: "env-dev-pass",
    SCREENSCRAPER_SOFTNAME: "env-soft",
    SCREENSCRAPER_SSID: "env-user",
    SCREENSCRAPER_SSPASSWORD: "env-user-pass",
  } as NodeJS.ProcessEnv;

  assert.deepEqual(resolveConfig({ devId: "stored-dev" }, env), {
    devId: "stored-dev",
    devPassword: "env-dev-pass",
    softName: "env-soft",
    ssId: "env-user",
    ssPassword: "env-user-pass",
  });

  assert.deepEqual(resolveConfig(null, env), {
    devId: "env-dev",
    devPassword: "env-dev-pass",
    softName: "env-soft",
    ssId: "env-user",
    ssPassword: "env-user-pass",
  });

  assert.deepEqual(resolveConfig(null, {} as NodeJS.ProcessEnv), {
    devId: undefined,
    devPassword: undefined,
    softName: "drop-metadata-screenscraper",
    ssId: undefined,
    ssPassword: undefined,
  });
});

test("drop-metadata-screenscraper maps a jeuRecherche payload", () => {
  const results = mapSearchResults(SEARCH_FIXTURE);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "3");
  assert.equal(results[0].title, "Sonic the Hedgehog");
  assert.equal(results[0].releaseYear, 1991);
  assert.equal(results[0].coverUrl, "https://screenscraper.fr/image.php?media=box2D(wor)");
  assert.equal(results[0].description, "Sonic must save the animals...");
  assert.equal(results[0].provider, "screenscraper");
});

test("drop-metadata-screenscraper sends the developer and user credentials on search", async () => {
  const { ctx, calls } = await createProviderContext(
    [{ match: "jeuRecherche.php", body: SEARCH_FIXTURE }],
    {
      devId: "stored-dev",
      devPassword: "stored-dev-pass",
      softName: "drop-tests",
      ssId: "stored-user",
      ssPassword: "stored-user-pass",
    },
  );
  const results = await ctx.metadataProviders.get("screenscraper")?.search("sonic");
  assert.equal(results?.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api2/jeuRecherche.php");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    output: "json",
    softname: "drop-tests",
    devid: "stored-dev",
    devpassword: "stored-dev-pass",
    ssid: "stored-user",
    sspassword: "stored-user-pass",
    recherche: "sonic",
  });
});

test("drop-metadata-screenscraper maps a jeuInfos payload with medias", async () => {
  const { ctx } = await createProviderContext(
    [{ match: "jeuInfos.php", body: DETAIL_FIXTURE }],
    { devId: "dev", devPassword: "dev-pass" },
  );
  const details = await ctx.metadataProviders.get("screenscraper")?.getDetails("3");
  assert.ok(details);
  assert.equal(details.title, "Sonic the Hedgehog");
  assert.equal(details.releaseYear, 1991);
  assert.equal(details.coverUrl, "https://screenscraper.fr/image.php?media=box2D(wor)");
  assert.equal(details.bannerUrl, "https://screenscraper.fr/image.php?media=fanart(wor)");
  assert.equal(details.iconUrl, "https://screenscraper.fr/image.php?media=wheel(wor)");
  assert.deepEqual(details.screenshots, [
    "https://screenscraper.fr/image.php?media=ss1(wor)",
    "https://screenscraper.fr/image.php?media=sstitle(us)",
  ]);
  assert.deepEqual(details.genres, ["Action", "Platform"]);
  assert.deepEqual(details.developers, ["Sonic Team"]);
  assert.deepEqual(details.publishers, ["SEGA"]);
  assert.equal(details.description, "Sonic must save the animals and defeat Dr. Robotnik.");
  assert.equal(details.metadata?.system, "Mega Drive");
  assert.equal(details.metadata?.players, "1");
});

test("drop-metadata-screenscraper detail mapper returns null for empty payloads", () => {
  assert.equal(mapGameDetails({ response: {} }), null);
  assert.equal(mapGameDetails(undefined), null);
});

test("drop-metadata-screenscraper never logs secrets", async () => {
  const { messages } = await createProviderContext([], {
    devId: "stored-dev",
    devPassword: "super-secret-dev-pass",
    ssPassword: "super-secret-user-pass",
  });
  assert.deepEqual(messages, [
    "ScreenScraper metadata provider registered (developer credentials configured)",
  ]);
  assert.ok(messages.every((message) => !message.includes("secret")));
});

test("drop-metadata-screenscraper throws on failed requests", async () => {
  const { ctx } = await createProviderContext([
    { match: "jeuInfos.php", body: { error: "forbidden" }, status: 403 },
  ]);
  await assert.rejects(
    () => ctx.metadataProviders.get("screenscraper")?.getDetails("3") ?? Promise.resolve(null),
    /ScreenScraper request failed with status 403/,
  );
});
