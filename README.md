# AgRegen: open-source web platform for site-specific nutrient management

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24454203.svg)](https://doi.org/10.5281/zenodo.24454203)

AgRegen is a Spanish-language platform for defining management zones from satellite imagery or georeferenced soil samples, developing variable-rate prescriptions, and running soil amendment and crop nutrition calculations. This repository accompanies the SoftwareX submission and includes three cases that can be reproduced offline.

## Architecture

| Layer | Technology and role |
| --- | --- |
| Web | React 19, TypeScript and Vite: parcel maps, soil and satellite workflows, review of prescriptions |
| API | Node.js 20 and Express 5: parcel data, orchestration and prescription review |
| Geospatial service | Python 3.11/3.12 and FastAPI: interpolation, zoning and raster processing |
| Persistence | PostgreSQL (Drizzle ORM); PostGIS is available for installations using database-side spatial operations. The offline cases do not need either. |

The satellite prescription calculates nitrogen rates from the mean NDVI of each zone using [`shared/ndvi-nitrogen-rules.json`](shared/ndvi-nitrogen-rules.json), a versioned table shared by Node and Python. The rates are **kg of elemental N per hectare**, not product rates. The LLM is optional and can only explain the calculated rates; set `NDVI_NITROGEN_AI_EXPLANATION=true` to enable it or leave it unset to disable it. See [limitations](LIMITATIONS.md) before interpreting the case as agronomic evidence.

## Reproduce the cases

With Node.js 18, 20, or 22 installed, clone the [public AgRegen repository](https://github.com/javiercorrea1255-ship-it/AgRegen) and run:

```bash
git clone https://github.com/javiercorrea1255-ship-it/AgRegen.git
cd AgRegen
npm run demo:all
npm run test:cases
```

These commands need no package installation, network calls, credentials or database. The demos write reports to the ignored `outputs/` directory.

| Case | Included materials | Checks |
| --- | --- | ---: |
| [01: Oat NDVI zones and N prescription](data/case_01_oat_satellite/) | Six management zones, satellite statistics, deterministic rates and comparison against 80 kg N/ha | 69 |
| [02: San José soil interpolation](data/case_02_sanjose_soil/) | 21 soil sampling points, IDW of pH and EC, quantile zones and worked liming scenario | 59 |
| [03: Agronomic calculators](data/case_03_calculators/) | Worked soil amendment and nutrient calculations | 48 |

## Install and run the application

Use **Node.js 20.19 or later in the 20.x series**, npm, **Python 3.11 or 3.12**, and a development PostgreSQL database. The full application uses service credentials for features such as live Earth Engine imagery and WhatsApp; the reproducible cases and offline test suites do not. Do not put credentials in Git.

```bash
npm ci
python -m pip install -r geo-service/requirements.txt
```

Set `DATABASE_URL` and a strong `SESSION_SECRET` in your shell or a secrets manager. Run `npm run db:push` **against a new development database only** to initialize the schema. In one terminal run:

```bash
cd geo-service
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

In another terminal, from the repository root:

```bash
export GEO_SERVICE_URL=http://127.0.0.1:8000
npm run dev
```

Open `http://localhost:5000` unless `PORT` is set to a different value. Configure the relevant provider credentials for live services separately; the geospatial calculations on local inputs do not require them.

To provision the first administrator, configure `AG_REGEN_ADMIN_EMAIL` and `AG_REGEN_ADMIN_PASSWORD` (a unique password of at least 16 characters) before the first startup. Remove the bootstrap password from the environment after the account is created. There is no built-in administrator password.

## Tests

```bash
AGRONOMIC_DB_TESTS=0 SOIL_HEALTH_DB_TESTS=0 SOIL_HEALTH_PRIVATE_FIXTURE=0 npm test
npm run check
cd geo-service
python -m pytest tests/ --cov=services --cov=utils --cov-report=term-missing
```

GitHub Actions runs the three offline cases across Windows, macOS and Ubuntu with Node 18/20/22, Vitest on Ubuntu with Node 20, and pytest with coverage on Ubuntu with Python 3.11/3.12. The opt-in database suites and the one original-workbook comparison are disabled in CI; no live-provider credentials are supplied.

## Source code layout

AgRegen organizes its source code by service rather than in a single top-level `src/` directory.

- `client/`: React and TypeScript frontend. The application source lives in `client/src/`.
- `server/`: Node.js and Express API, including persistence and integrations.
- `shared/`: shared schema and the versioned NDVI nitrogen rule table.
- `geo-service/`: Python and FastAPI service for geospatial processing.
- `tests/`: automated tests and assertions for the reproducible cases.
- `demo/`: scripts that run the reproducible cases offline.
- `data/`: input datasets and historical snapshots for the reproducible cases.
- `docs/`: case methodology; see also [comparison](COMPARISON.md).

## License and citation

Code is licensed under [MIT](LICENSE). An identical copy is provided as [`LICENSE.txt`](LICENSE.txt) for SoftwareX. The datasets in `data/` are licensed separately under [CC BY 4.0](LICENSE-DATA). Third-party imagery, marks and dependencies retain their respective terms.

Correa Islas, J. de J.; Muñoz Rodríguez, M.; Martínez González, E. G.; Altamirano Cárdenas, J. R.; and Ontiveros Capurata, R. E. (2026). *AgRegen: open-source web platform for site-specific nutrient management* (v1.1.0) [Software]. Zenodo. [https://doi.org/10.5281/zenodo.24454203](https://doi.org/10.5281/zenodo.24454203).

Use this **version DOI** to cite the archived v1.1.0 release. Machine-readable citation metadata is available in [`CITATION.cff`](CITATION.cff).
