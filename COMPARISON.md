# Feature comparison

This is a comparison of documented capabilities, not a performance benchmark. **Partial** means the capability is available only in a narrower scope or through an additional tool; **—** means not documented as native in the cited project, not that it is impossible.

| Platform | Open source | Remote sensing | Multi-method interpolation + LOOCV | Management zoning | VRA prescription | Reproducible cases | Spanish | Mexican agronomic standards |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AgRegen | MIT | Sentinel-2 indices | IDW, kriging, RBF, SVR | Yes | Yes; review before use | Three offline cases | Yes | NOM-021 referenced in soil case; not certification |
| [farmOS](https://farmos.org/) | Yes | Partial; integrations | — | Partial; field mapping | — | Partial; examples | Partial; community translations | — |
| [OpenATK](https://github.com/OpenATK) | Yes; see each project | — | — | Partial; field mapping | — | Partial; project examples | Not verified | — |
| [QGIS](https://qgis.org/) + [SCP](https://semiautomaticclassificationmanual.readthedocs.io/) | Yes | Yes | Partial; GIS tools and custom validation | Partial; classification and custom workflows | Partial; custom GIS workflow | Partial; tutorials | Yes; translations vary by plugin | — |
| [PyKrige](https://geostat-framework.readthedocs.io/projects/pykrige/) | Yes | — | Partial; kriging models and scikit-learn cross-validation | — | — | Partial; code examples | Not verified | — |
| [Climate FieldView](https://climate.com/) | No | Yes | — | Yes | Yes; features vary by market | — | Available in some markets | — |
| [EOSDA Crop Monitoring](https://eos.com/products/crop-monitoring/) | No | Yes | — | Yes | Partial; VRA maps, product-dependent | — | Yes | — |
