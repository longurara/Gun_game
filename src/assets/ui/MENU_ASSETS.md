# Menu assets

Downloaded from official sources on 2026-10-06. Only the selected files ship with the game; the full archives remain in ignored `output/assets/menu/`.

- **Bunker Panel UI Kit — single-framed panels and buttons** by **Oğuzhan Girgin**, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Source](https://colorosse.com/assets/2d/ui/bunker-panel-ui-kit). Modified: dark/amber colors and simplified cut outlines for responsive nine-slicing. Original license: `bunker/LICENSE.txt`. Attribution is visible in the menu's **NGUỒN ASSET** dialog.
- **Input Prompts** by **Kenney**, CC0 1.0. [Source](https://kenney.nl/assets/input-prompts). 15 keyboard/mouse and 3 touch SVGs, unmodified. License: `input-prompts/License.txt`.
- **Interface Sounds** by **Kenney**, CC0 1.0. [Source](https://kenney.nl/assets/interface-sounds). Four original OGG files renamed to hover, click, confirm and back. License: `../audio/interface/License.txt`.

Reacquire selected assets with `npm run assets:fetch-menu` (Node and Python needed only for acquisition). `menu-manifest.json` records download URLs, original paths, source and installed SHA-256 checksums and modifications. All visual/sound files are served locally by Vite; runtime does not contact asset providers. UI samples share the game's audio context and volume, load after a user gesture and fail silently if unavailable.
