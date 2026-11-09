# fripSi.de

[简体中文](./README.md) | [日本語](./README.ja.md) | [English](./README.en.md)

[fripSi.de](https://fripsi.de) is an unofficial, fan-maintained fripSide event calendar and live setlist archive.

The project organizes publicly available information about events, releases, song versions, and live performances. Content is stored in SQLite and maintained through the built-in admin interface, so data updates do not require rebuilding the site.

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
- Query the archive and submit content changes for review through the Remote MCP endpoint (`/mcp`).

## Tech stack

- [Astro](https://astro.build/) SSR
- SQLite (Node's built-in `node:sqlite`); production runs the Astro standalone build on Node 24
- Cloudflare DNS/CDN, Access, and Tunnel
- TypeScript, Vitest, and Playwright
- Bootstrap Icons, bundled as local SVG files at build time
- Leaflet, MapLibre GL, and OpenStreetMap for interactive maps and map tiles

The project does not use React and does not rely on Notion or another third-party service as a live data source.

## Repository layout

```text
apps/
├── web/          Astro website, admin interface, and Web API
├── mcp/          Remote MCP protocol and tools (served at /mcp by the website process)
└── sync/         Official activity sync task (disabled by default)
packages/
├── core/         Data access, validation, authorization, and shared business logic
└── node-runtime/ SQLite and local file storage adapters
migrations/       Database migrations
ops/              Host deployment scripts and database backups
scripts/          Data collection, cleanup, and import scripts
data/             Import templates and research data
docs/             Architecture, data model, and deployment documentation
```

## Local development

Node.js 24 and npm are required. Local development uses the same Node runtime and SQLite as production.

```bash
git clone https://github.com/frip-fans/fripsi.de.git
cd fripsi.de
npm install

cp apps/web/.env.local.example apps/web/.env.local

npm run db:migrate:local   # creates apps/web/.cache/self-hosted/site.sqlite and applies migrations
npm run db:seed:local      # loads sample data
npm run dev:web
```

By default, the website runs at `http://localhost:4321`, the admin interface at `http://localhost:4321/admin`, and MCP at `http://localhost:4321/mcp`. `DEV_AUTH_BYPASS` in `.env.local` provides a local test identity and only takes effect in development mode; it is forced off everywhere else.

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev:web` | Start the website development server |
| `npm run typecheck` | Type-check every workspace and data script |
| `npm test` | Run the test suite |
| `npm run build` | Build the production Node bundle (`apps/web/dist-node`, including the sync task) |
| `npm run visual:check` | Run the Playwright visual check for the home page |
| `node scripts/visual-check-journey.mjs` | Check the Journey map and playback on desktop and mobile |
| `npm run db:migrate:local` | Apply migrations to the local database |
| `npm run db:seed:local` | Load sample data into the local database |
| `npm run db:import:local -- <file.sql>` | Run a generated import SQL file against the local database |

## Data maintenance

Each environment's database is the source of truth for events, songs, releases, and setlists. For bulk updates, prepare data in the repository's CSV format, then use the import scripts to generate or write structured data. When submitting a correction, include a publicly accessible source URL.

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

Production and staging run on separate OCI hosts: Node 24 serves the Astro standalone build, the website process also serves `/mcp`, data lives in a local SQLite database, and Cloudflare provides DNS/CDN, Access, and Tunnel. A workflow in a private deployment repository builds and deploys releases; configuration and secrets stay on the hosts.

Changes reach staging through task PRs. After CI and staging acceptance, a `release/*` branch created from the latest master is aligned with the accepted staging content and merged into master with **Rebase and merge**. Additive database migrations run during deployment (production requires explicit approval). See the [release workflow](./docs/release-workflow.md), [deployment and operations](./docs/oci-deployment.md), [database backups](./docs/sqlite-backups.md), and [collaboration rules](./AGENTS.md).

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
