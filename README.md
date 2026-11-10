# capy

This repository holds two news products. One pipeline writes one database, and both products read it (decisions 23 and 25 in docs/DECISIONS.md). Read CONTEXT.md first. The GitHub repository is now named `hzsl777/globalgist`.

- **GlobalGist** is a public news map at globalgist.io. It places each day's world news where it happened and heads the page with one word for the day. The map code is in `packages/map`. The Worker in `packages/web` serves it.
- **2DayAI** emails each reader one headline a day. A hand-written interest profile picks the headline. The stories, explanations and sources sit one click below it. It is built and tested but has not run live. The code is in `packages/core`, `db`, `pipeline` and `web`.

## GlobalGist

| Morning Edition | Cabinet Map | Wire Room |
|---|---|---|
| ![Morning Edition](docs/map/screenshots/desktop-morning-telegram.jpg) | ![Cabinet Map](docs/map/screenshots/desktop-cabinet-3d.jpg) | ![Wire Room](docs/map/screenshots/desktop-wire-explained.jpg) |

| Ops Room | Blueprint |
|---|---|
| ![Ops Room](docs/map/screenshots/desktop-ops-2d.jpg) | ![Blueprint](docs/map/screenshots/desktop-blueprint-3d.jpg) |

The screenshots show the fictional sample day: made-up outlets and places run through the real pipeline.

The idea comes from Radio Garden. When the page opens, the map turns until a place lands under the crosshair. You can turn the flat map or the globe yourself. The panel lists what outlets reported at that place, newest first. The map shows no borders, no country names and no labels.

- **The word.** The `telegram` stage scores each explained world event from -2 to 2 by what happened to people. It scores once a day (decision 156). Each score quotes the sentence it rests on. Code then places the day on a five-step scale, from Severe harm to Resolution. The day is the importance-weighted average of the significant events. The worst significant event is a floor: the day sits at most one step above it, so good news never averages a tragedy away (decision 162). The model picks the word from that step's fixed list of 24 words. No word repeats within seven days (decisions 128 and 161). The site shows every score with its reason.
- **Four levels of detail.** The day's events sit under the word, one line each. Each event opens to an explanation with numbered citations. Each citation opens to its source with the passage quoted. Headlines appear as the outlets published them.
- **Stories sit where they happened** (decisions 44 and 135). The grouping model names the city. Code looks the name up in the country the model named, first in a fixed list of cities, then in a list of towns of 500 people or more. A story with no city that checks out stays at its outlet's city.
- **818 outlets in 746 places.** They cover nearly every country and territory, and also stateless nations, Indigenous communities and the regions of the ten most populous countries (decisions 31, 45, 48 and 49). The outlets are the `desk: world` entries in `config/sources.yaml`.
- **Local stories from towns.** GDELT's news index adds towns the outlets do not reach (decisions 54, 67 and 78). The map reads them again every three hours (decision 80). They show only at the closest zoom.
- **Zoom shows more.** Zoomed out, the map shows the most important and most widely reported stories. Each step in adds the next of five tiers (decisions 30 and 46). A place's mark shows the model's 1 to 5 rating of its top story. Its size shows how many reports the place has.
- **More.** There are 69 designs, a Map or Globe view, a 24-hour replay, topic filters, place search, pinned places, and translation into about a hundred languages.

## 2DayAI

The design is in docs/SPEC.md. Later changes are in docs/DECISIONS.md. Operating it is in docs/RUNBOOK.md.

### How it stays true to its sources

Every sentence of an explanation cites an article and a passage. Code checks that the passage appears word for word in that article. Code removes any sentence that fails. An event left with fewer than three sentences cannot be picked for anyone. The headline is written from the picked events' checked sentences, never from raw articles. One paragraph is written from a reader's profile instead of the sources. The page labels it as such.

## Run it

You need Node 22. For 2DayAI, copy `.env.example` to `.env`.

```
npm install
npm run check                          # boundaries, typecheck and tests for every package. No network, no key.

# The map
npm run map:sample                     # the fictional day through the real stages, in memory, into the sample data
npm run map:dev                        # the site at http://localhost:5173 on the sample, with a banner
npm run stage -- map export            # the latest real day from DATABASE_URL, as the site sees it
npm run web:deploy                     # build the map and deploy it with the Worker (Cloudflare)

# 2DayAI
npm run stage -- sources check         # fetch every feed in config/sources.yaml and report
npm run db:migrate                     # apply migrations to DATABASE_URL
npm run stage -- day --date 2026-09-04 # ingest, enrich, readers sync, cluster, explain, select
npm run stage -- show --reader r01     # print that reader's edition for the date
npm run stage -- deliver --dry-run     # what would be sent right now
npm run stage -- spend                 # model spend for the date
npm run stage -- spend report          # model spend for every day, by stage
npm run stage -- eval                  # compare model setups on one day's world articles
```

The model provider is a setting (decisions 28 and 29). The default is OpenAI's gpt-5.4-nano, with gpt-5.4-mini for the word. `npm run stage -- eval` compares models on one real day by cost, by the code checks, and by every score with its reason. See "Choose a model" in docs/RUNBOOK.md.

## Layout

- `packages/core`: types, Zod schemas, validators, renderers and versioned prompts. It imports nothing else in the workspace.
- `packages/db`: the Drizzle schema, migrations and shared read models. It imports core. `@2dayai/db/node` holds the postgres-js client.
- `packages/pipeline`: the stages, the CLI, and the model module in `src/llm/`. Only that module imports a model SDK. The package imports core and db.
- `packages/web`: the Cloudflare Worker. It serves the map site and its data, the reader pages and feedback. It imports core and db.
- `packages/map`: the map site. It imports only core's types and reads its data from the Worker.
- `config/sources.yaml`: every feed, on the briefing desk (2DayAI) or the world desk (the map, with a place for each outlet).
- `config/readers/`: reader profiles. Git ignores all of them except the example.

`npm run lint` fails on any import that crosses these lines.

## Hosting

The Worker runs on Cloudflare's free plan. It serves the map, its data and the reader pages. Cloudflare's Git integration (Workers Builds) deploys it on each merge to main. The workflow `.github/workflows/deploy-site.yml` can deploy instead when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set. Use one or the other, not both (decision 38).

The daily run needs no deploy. It stores the day's file and its tiles of local stories in R2, and the Worker serves them (decisions 73 and 78).

### GitHub Actions use

The repository is public, so Actions minutes are free (decision 130). The workflows still keep usage low (decision 163):

- The daily run starts with a job of a few seconds. It asks the site whether yesterday's map is up. If it is, the install and the run are skipped. A run with nothing to build now takes about 8 seconds instead of about 35. The Worker's clock starts the daily run twice a night and GitHub's schedule starts it a third time, and only one of them has a day to build.
- Artifacts expire after two days (the daily map file and the site check's screenshots) or three days (model eval reports).
- Deploy, eval and preflight run only by hand.

Measured in November 2026, a month of these jobs comes to about 1,400 minutes. On a private repository they would use most of the 2,000 free minutes a month:

- the daily run, 9 to 20 minutes on a normal night, most of it waiting for the model's flex queue
- the refresh every three hours, about 3.5 minutes each, so about 27 minutes a day
- CI on each pull request
- the site check (`site-check.yml`, decision 85), about a minute a day

### Worker requests

The free Workers plan allows 100,000 requests a day. Each visit loads the day's file in one request. A visitor who zooms all the way in also loads the tiles in view, usually 5 to 25 more. At about 20 tile requests per such visitor, that leaves room for about 4,000 of them a day. Past that, the paid plan costs 5 USD a month for 10 million requests.
