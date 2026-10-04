# Smoke fixture source policy

Asset bytes and absolute paths stay in ignored fixtures/local. The tracked manifest contains AssetRecord metadata only. The local manifest uses the same records with absolute paths below its directory. These assets are local test inputs. They are not included in a release.

## VRM 1

Source: [three-vrm sample](https://raw.githubusercontent.com/pixiv/three-vrm/ff42fae4fcee1fcbca2cd262c7f5f8cbddeaf5ab/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm), revision `ff42fae4fcee1fcbca2cd262c7f5f8cbddeaf5ab`.
Model: VRM1_Constraint_Twist_Sample v1.0.1. Author: pixiv Inc. Copyright: (c) 2022 pixiv Inc.
The model specifies [VRM Public License 1.0](https://vrm.dev/licenses/1.0/). Review [the upstream sample terms](https://github.com/vrm-c/vrm-specification/tree/master/samples) before any distribution. The loader MIT license does not grant model rights.

Embedded terms, copied without reinterpretation:

```json
{
  "allowAntisocialOrHateUsage": false,
  "allowExcessivelySexualUsage": true,
  "allowExcessivelyViolentUsage": true,
  "allowPoliticalOrReligiousUsage": true,
  "allowRedistribution": true,
  "authors": [
    "pixiv Inc."
  ],
  "avatarPermission": "everyone",
  "commercialUsage": "corporation",
  "copyrightInformation": "(c) 2022 pixiv Inc.",
  "creditNotation": "unnecessary",
  "licenseUrl": "https://vrm.dev/licenses/1.0/",
  "modification": "allowModificationRedistribution",
  "name": "VRM1_Constraint_Twist_Sample",
  "thumbnailImage": 18,
  "version": "v1.0.1"
}
```

The embedded terms permit everyone to use the avatar, corporate commercial use, redistribution and modification redistribution. Antisocial or hate use is prohibited. Local renderer evaluation uses the model as a sample only. No VRM0 licensed input was supplied; VRM0 acceptance remains pending.

## GLB reference

The self-contained GLB was generated for OpenSekai. It has one mesh, one material and no textures. Project license is pending. It is a local test input and is not distributed. Its exact bytes and SHA-256 are recorded in the manifest.
