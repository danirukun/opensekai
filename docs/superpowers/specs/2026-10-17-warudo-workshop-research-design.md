# Warudo Workshop research design

Date: 2026-10-17. Scope: a research study of Warudo Steam Workshop content (app 2079120). The study writes findings and parity changes. It writes no import code. The [architecture](2026-10-02-opensekai-architecture-design.md) says that `.warudo` archives are not first-release interchange formats. This study does not change that decision. It gives the evidence for a later selection gate.

## Problem

OpenSekai plans a package format, an extension sandbox (EXT items), and environment and prop import (ENV-01, ENV-03). Warudo has a working content ecosystem on the Steam Workshop. We do not know what that content contains, how it is built, or how it is unsafe. Without this data, our package and sandbox design guesses.

## Known facts from three samples

A first look at three items gave these facts:

- A `.warudo` file starts with the 4 bytes `UMOD`, a little-endian `u32` payload length, and a `u32` zero. A standard zip archive follows. The format comes from uMod 2.0 (Trivial Interactive), exporter 2.9.0.
- The zip has `modinfo.dat`, `sharedassets.bin`, and `sharedassets.meta`. An environment also has `sceneassets.bin` and `sceneassets.meta`.
- `modinfo.dat` has its own `UMOD` header and .NET `BinaryWriter` strings: uMod version, Unity version, Warudo SDK version, name, version, description, author, and other fields. A preview PNG can follow.
- Each `.bin` entry is a Unity `UnityFS` AssetBundle. Each `.meta` entry lists the source asset paths, for example a `Prop.prefab` or an `Environment.unity` scene.
- Item 3817817029 ("American Highway Cafe Day") is malware. Its `DesktopOverlay.dll` is a Warudo plugin. Its `OnCreate` finds a loose `.bat` file and opens it through `Application.OpenURL`. The `.bat` file starts a hidden PowerShell process with the execution policy bypassed. That process decodes an XOR-encrypted payload from the `.bat` file and runs it. The user reports the item to Steam.

## Research questions

1. **Format.** What is the full container and `modinfo.dat` layout? Which entries does each Workshop type have?
2. **Content shape.** For each type: Unity and SDK versions, bundle sizes, mesh, texture, and material counts, texture formats, lightmaps, and baked lighting.
3. **Materials and shaders.** Which shader families occur (URP Lit or Unlit, lilToon, Poiyomi, NiloToon, custom), and how often?
4. **Behavior.** How many items have C# code (MonoScript or DLL), blueprint data, or files outside the archive?
5. **Ecosystem.** Tag distribution, subscriber counts, sizes, license and credit practice, update and dependency patterns, and the malware case.
6. **Implications.** What must the OpenSekai package format, extension sandbox, content registry, and import do? Is `.warudo` import worth a selection gate?

## Method

1. **Sample.** About 30 items over all Workshop types, 4 or 5 for each type. Use a mix of the most subscribed and the most recent items. Get the type tags from the public browse page first.
2. **Metadata.** Get the tags, size, subscriber count, dates, and description for each item from the keyless Steam `GetPublishedFileDetails` endpoint.
3. **Download.** Use `steamcmd +workshop_download_item 2079120 <id>` on the Mac. Move each result into the evidence folder. Skip an item above about 1 GB and record the skip.
4. **Structure.** A read-only Python script reads each `.warudo` file with UnityPy. It writes one JSON report for each item: the UMOD and `modinfo.dat` fields, the bundle list, the Unity object types and counts, the shader names, the script references, the texture sizes and formats, and the files outside the archive.
5. **Spot check.** Export the Livehouse Stage environment (3783948202) with AssetRipper. Record how its hierarchy, materials, and lightmaps would map to glTF and three.js.
6. **Summary.** Aggregate the reports into tables for each type.

## Safety

- Treat each download as untrusted data. Do not run, load, or decompile its DLL, `.bat`, `.ps1`, or `.exe` files. Record only the hash, the `file` type, and a strings scan.
- Do not copy any download to the Windows VM.
- Keep the scripts in `artifacts/warudo-workshop/tools/`, apart from the download folders. Run them with `python -I` from a virtual environment in the evidence folder. Pass the item paths as arguments.

## Evidence and commits

Raw downloads, reports, extracted assets, and notes stay in the git-ignored `artifacts/warudo-workshop/` folder. They are never committed.

The study commits:

- A findings document, `docs/superpowers/specs/2026-10-17-warudo-workshop-research.md`, in ASD-STE100. It has the format description, aggregate tables with no copied content, the risks, and the implications with their selection gates. It names item 3817817029 and summarizes the evidence.
- Detail lines in [the parity checklist](../../warudo-parity.md) under EXT-04 and the related ENV and SCN items. New items as needed, for example package content scans and trust warnings.
- A roadmap issue for each new item with the `parity`, `phase:later`, and `status:planned` labels, and a link from #139.

## Completion

The study is complete when the findings document answers the six questions with data from the sample, and the checklist and the issues agree with it.
