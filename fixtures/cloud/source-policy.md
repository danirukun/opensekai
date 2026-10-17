# Cloud fixture source policy

`manifest.json` lists metadata only. The asset bytes stay in the private R2 bucket `opensekai-fixtures` and in ignored `fixtures/local/`. They are test inputs. They are not included in a release. [Testing](../../docs/testing.md#fixtures) gives the download and the checks.

## fixture_vrm_1

The VRM 1.0 smoke sample. [The smoke source policy](../smoke/source-policy.md) records its source and terms.

## fixture_vrm0_arkit

VRM 0.x avatar "Catboy with black hoodie" by DaniruKun, the project owner. UniGLTF 2.37.0 export with ARKit (perfect sync) blend shapes. The owner supplied it for testing on 2026-10-17. Agents may load, render, and screenshot it for tests. They must not commit, attach, or upload the file.

Embedded VRM 0 meta, copied without reinterpretation:

```json
{
  "allowedUserName": "OnlyAuthor",
  "author": "DaniruKun",
  "commercialUssageName": "Disallow",
  "licenseName": "Redistribution_Prohibited",
  "sexualUssageName": "Disallow",
  "title": "Catboy with black hoodie",
  "version": "2",
  "violentUssageName": "Disallow"
}
```

## fixture_glb_stage

[TV01 Stage](https://sketchfab.com/3d-models/tv01-stage-3ed17abfce1842aebafd6745eef9d748) by [zHairezt](https://sketchfab.com/zHairezt), licensed [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). Sketchfab glTF export (generator Sketchfab-16.74.0). It uses `KHR_materials_specular` and `KHR_materials_emissive_strength`. A use that shows the stage must credit the author.
