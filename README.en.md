# fripSi.de

[简体中文](./README.md) | [日本語](./README.ja.md) | [English](./README.en.md)

[fripSi.de](https://fripsi.de) is an unofficial, fan-maintained fripSide event calendar and live setlist archive.

The project organizes publicly available information about events, releases, song versions, and live performances. Content is stored in Cloudflare D1 and maintained through the built-in admin interface, so data updates do not require rebuilding the site.

> This is not an official fripSide website and is neither affiliated with nor endorsed by fripSide or any related organization. Please refer to [fripside.net](https://fripside.net) for official information.

## Features

- Browse events by month and subscribe through a public iCalendar feed.
- Search historical events by year, type, location, and keyword.
- Explore past in-person events on the Live Journey world map with an interactive timeline.
- Browse live setlists, release track lists, song versions, and the relationships between them.
- Join public conversations through the community page and embedded GitHub Discussions.
- Try the interactive “Satoshi Yaginuma Intensity Calibrator” and generate a playful result.
- Use the public site in Simplified Chinese, Traditional Chinese, Japanese, or English.
- Manage events, songs, releases, and setlists through `/admin`.
- Keep source references and audit records for review and correction.
- Query the archive and submit content changes for review through a separate Remote MCP Worker.

## Tech stack

- [Astro](https://astro.build/) SSR
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- TypeScript, Vitest, and Playwright
- Bootstrap Icons, bundled as local SVG files at build time
- Leaflet, MapLibre GL, and OpenStreetMap for interactive maps and map tiles

The project does not use React and does not rely on Notion or another third-party service as a live data source.

## Repository layout

```text
apps/
├── web/          Astro website, admin interface, and Web API
└── mcp/          Remote MCP Worker
packages/
└── core/         Data access, validation, authorization, and shared business logic
migrations/       D1 database migrations
scripts/          Data collection, cleanup, and import scripts
data/             Import templates and research data
docs/             Architecture, data model, and deployment documentation
```

## Local development

Node.js 24 and npm are required.

```bash
git clone https://github.com/frip-fans/fripsi.de.git
cd fripsi.de
npm install

cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars

npm run db:migrate:local
npm run db:seed:local
npm run dev:web
```

By default, the website runs at `http://localhost:4321`, with the admin interface at `http://localhost:4321/admin`. The sample local configuration uses `DEV_AUTH_BYPASS` to provide a test identity; never enable this option in production.

To debug the MCP Worker, open another terminal and run:

```bash
npm run dev:mcp
```

The default MCP endpoint is `http://localhost:8787/mcp`, and its health check is available at `/health`.

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev:web` | Start the website development server |
| `npm run dev:mcp` | Start the MCP Worker development server |
| `npm run typecheck` | Type-check every workspace and data script |
| `npm test` | Run the test suite |
| `npm run build` | Build all workspaces |
| `npm run build:web` | Build only the website |
| `npm run visual:check` | Run the Playwright visual check for the home page |
| `node scripts/visual-check-journey.mjs` | Check the Journey map and playback on desktop and mobile |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |
| `npm run db:seed:local` | Load sample data into the local D1 database |

## Data maintenance

D1 is the source of truth for events, songs, releases, and setlists. For bulk updates, prepare data in the repository's CSV format, then use the import scripts to generate or write structured data. When submitting a correction, include a publicly accessible source URL.

- [Music library data model and import formats](./docs/music-library.md)
- [Database model](./docs/data-model.md)
- [Admin interface and MCP](./docs/admin-and-mcp.md)

To migrate legacy event data from Notion, use:

```bash
npm run import:notion -- data/raw/export.csv
npm run import:sql
```

Place raw exports in the Git-ignored `data/raw/` directory. Review the generated validation report and SQL before importing anything.

## Deployment

The Web and MCP applications are deployed as separate Cloudflare Workers that share one D1 database. Their `wrangler.jsonc` files contain Worker settings, bindings, and public environment variables. Manage tokens, Access credentials, and other sensitive values through Cloudflare Secrets or build environment variables.

Production database migrations must be run separately; a website build does not apply them automatically. See the [deployment guide](./docs/deployment.md) for the deployment workflow and Cloudflare Access configuration.

## Contributing

Feature requests, data corrections, and bug reports are welcome in [Issues](https://github.com/frip-fans/fripsi.de/issues). Pull requests are welcome as well.

Before submitting code, run:

```bash
npm run typecheck
npm test
npm run build
```

When changing interface text, update all four supported languages. When changing event or music data, include source references and do not commit unauthorized images, audio, or substantial copyrighted text.

## License and rights

Code in this repository is released under the [GNU General Public License v3.0](./LICENSE).

The fripSide name, logos, works, and other related materials belong to their respective rights holders. The GPL applies only to code in this repository that can be licensed by its contributors; it grants no additional rights to third-party names, works, data sources, or media.
