# AGENTS.md — drop-metadata-screenscraper

ScreenScraper metadata provider plugin for Drop (#207).

## Toolchain

- Node >= 22, npm 10+
- `npm ci`, `npm run build`, `npm test`, `npm run typecheck`

## Contract

Built on [`@droposs/plugin-sdk`](https://github.com/Heretek-Games/drop-plugin-sdk)
(plugin API v2). The SDK is consumed from the public npm registry
(`@droposs/plugin-sdk@^0.4.0`), so fresh clones and CI installs need no sibling
checkout.

## Configuration

Credentials are read from plugin storage (`ctx.storage`, key `config`) with
environment fallbacks:

| Config field | Environment variable |
| :--- | :--- |
| `devId` | `SCREENSCRAPER_DEVID` |
| `devPassword` | `SCREENSCRAPER_DEVPASSWORD` |
| `softName` | `SCREENSCRAPER_SOFTNAME` (defaults to `drop-metadata-screenscraper`) |
| `ssId` | `SCREENSCRAPER_SSID` |
| `ssPassword` | `SCREENSCRAPER_SSPASSWORD` |

`devid`, `devpassword`, and `softname` are required by the upstream API;
`ssid`/`sspassword` identify the user quota. Secrets are never logged.

## Upstream API

- `GET https://api.screenscraper.fr/api2/jeuRecherche.php?...&recherche={query}` for search
- `GET https://api.screenscraper.fr/api2/jeuInfos.php?...&gameid={gameId}` for details
- `response.jeu.medias[]` media entries (`ss`, `sstitle`, `box-2D`, `fanart`, `wheel`) are
  mapped to screenshots, cover, banner, and icon.
