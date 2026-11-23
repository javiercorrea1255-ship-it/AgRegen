# Changelog

## AgRegen v1.1.0 – SoftwareX submission

Source code: [AgRegen on GitHub](https://github.com/javiercorrea1255-ship-it/AgRegen).

- Added a versioned, deterministic NDVI nitrogen rule table shared by the Node and Python services. The optional language-model explanation cannot set or change rates.
- Regenerated the reproducible oat case for all six original management zones: 599.13 kg N, an estimated USD 449.35, and a 41.15% modeled reduction versus a uniform 80 kg N/ha. An anonymized historical snapshot is retained separately.
- Licensed the code under MIT and kept CC BY 4.0 for the datasets under `data/`.
- Added GitHub Actions for the offline cases, Vitest and type checking, and pytest with geospatial coverage.
