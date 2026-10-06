# Free asset integration

Updated 7 October 2026: 70 GLB models, 6 PNG images, 22 OGG sounds; **7,863,890 bytes** (~7.50 MiB). Licenses and authors: [CREDITS](../public/assets/coverage/CREDITS.md). Exact files, byte lengths, hashes and transformations are in the three `*-manifest.json` files next to the assets.

## Rebuild the selected runtime files

Requires Node, Python, network access and FFmpeg for OGA audio. The existing building sources must be present first (`npm run assets:fetch-buildings`).

```sh
npm run assets:fetch-coverage
npm run assets:fetch-coverage-models
npm run assets:prepare-coverage
npm run assets:fetch-coverage-audio
```

Set `FFMPEG_PATH` to the FFmpeg executable if it is not on PATH. Kenney archives remain under ignored `output/assets/coverage/`; only selected runtime files ship in `public/assets/coverage/`. Particle selection explicitly prefers **PNG (Transparent)** over the alternative black-background files. Original GLBs from Poly Pizza are preserved; Kenney models have external images embedded unchanged. Audio is converted/normalized as described in CREDITS.

Building details added 7 October 2026 from the local source library: columns, gutters, awnings, AC units and small chimneys (+82,148 bytes). See [building asset review](BUILDING_ASSET_REVIEW.md).

Six additional Kenney packs were downloaded on 7 October (569 GLBs); 16 new selected runtime models add 693,764 bytes. Homes now mix brick, timber, metal/gable/hip roofs and mill facades. Six landmark types are placed on every open map, with explicit physical parts and cheaper fallback geometry. Crypt entrances and stone courtyards remain walkable. Architectural stone colors are adapted in the loader; two house roof models use planar UVs and the existing roof tile texture. Original source GLBs remain intact.

## Rendering

- `coverage-assets.ts`: scene-owned shared templates, four concurrent loads per request, failure fallback, unique geometry before baking shared GLB primitives, baked coordinate transforms, source albedo retention with documented architecture finishes, normalized bounds, missing normals/UV/color supplied, bodies batched by material. Weapon baking first makes its geometry unique to protect the cached template.
- `coverage-vehicles.ts`: nine model mappings, fitted to existing gameplay hulls. Main renderer upgrades loaded vehicle models and adds authored wheels to three distinct procedural chassis. Wheel pivots keep animation local.
- `main.ts`: pickup model mappings, labeled ammo, textured/detail armor, projectile models, parachute/airdrop upgrades and alpha billboards. Loot remains merged/instanced by kind.
- `island-renderer.ts`: selected modular surfaces and interior props replace already-blocked obstacle footprints. Nearby chunks use models; medium/far chunks keep cheaper geometry. Equal materials are consolidated; chunk-owned multi-materials are disposed without destroying shared source materials.
- `coverage-materials.ts`: additional material-name mappings reuse existing wood, weave, metal, road, grass, earth, bark, rock, plaster and roof textures.
- `island-decor.ts` / `coverage-vfx.ts`: day sky image, custom periodic water detail, transparent effects. No photographic water PBR pack is claimed.
- `audio.ts` / `foley-assets.ts`: samples preload after user audio unlock, synthesis remains immediate while loading, shared master volume and spatial/reverb paths. Engine pitch tracks speed, a single engine loop is stopped on exit/pause/dispose. Wind grains and drip scheduling limit overlaps.
- `coverage-credits.ts` / `menu-assets.ts`: source attribution in game, including CC BY license links and adaptation notice. Text is inserted via DOM textContent.

Source changes: regenerate the manifests and update `coverage-credits.ts`/CREDITS together. Validate hashes with `tests/coverage-files.test.ts`.

## Checks

```sh
npm test
npm run build
npx tsx --test --test-concurrency=1 tests/e2e/coverage-assets.e2e.ts tests/e2e/aircraft-assets.e2e.ts tests/e2e/free-assets.e2e.ts tests/e2e/enemy-assets.e2e.ts
```

Browser tests use Edge on Windows; set `BROWSER_PATH` for the coverage browser test when using a different installation. Gallery fixture: `/tests/fixtures/coverage-gallery.html`. Generated screenshots/logs under `output/` are ignored by Git.

Current model-sharing and procedural exceptions are recorded in [the coverage audit](ASSET_COVERAGE_AUDIT.md).
