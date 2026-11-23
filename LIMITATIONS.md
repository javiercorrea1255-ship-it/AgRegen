# Limitations

- **Application equipment:** GeoJSON and supported spatial exports are not ready-to-load ISO-XML/ISOBUS task files. Use external conversion, convert elemental nutrient rates to the selected product, and verify units and compatibility with the implement before application.
- **Roadmap:** Growing-degree-day support and an end-to-end drone orthomosaic workflow are not validated release features; existing image import or index processing is not an orthomosaic-generation pipeline.
- **Regenerative practices:** This release records practices but does not validate or quantify their causal effects on outcomes such as soil carbon or yield.
- **Evidence:** The cases demonstrate one satellite crop (oat), one acidic-soil sampling campaign and worked calculators. They are reproducibility checks, not evidence of performance across crops, regions or seasons.
- **Nitrogen savings:** The reduction compares a rule-based scenario with a uniform 80 kg N/ha baseline. It is counterfactual; field trials with an untreated or standard-management control are needed to establish agronomic and economic outcomes.
- **Interpretation of NDVI:** NDVI alone does not diagnose nitrogen deficiency. Crop stage, soil and tissue results, water stress and other explanations must be checked on the ground.
- **Language model:** The LLM is an optional explanation layer, not a source of doses or a substitute for agronomic review. Neither case execution nor rate calculation requires it.
