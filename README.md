# Font Checker - Web Font Detector & WOFF2 to OTF

[![Release](https://img.shields.io/github/v/release/taylorivanoff/font-checker)](https://github.com/taylorivanoff/font-checker/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/font-checker/total)](https://github.com/taylorivanoff/font-checker/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/font-checker)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/taylorivanoff)

**Font Checker** is a free, cross-platform **Electron desktop app** (with a CLI) that scans a webpage for fonts, handles common CDN/obfuscation patterns (including Fontdue / Next.js RSC), and can download and unwrap **WOFF2 → OTF** with install-friendly name tables.

Useful for designers, developers, and anyone auditing or recovering web fonts from a site.

## Features

- Discover fonts used on any URL
- Modes: Discover · Download · Convert to OTF
- Handles Fontdue payloads and Next.js flight-split URLs
- Browser-like download headers to bypass simple hotlink gates
- Results list with name-table details and reveal-in-folder
- Tray icon with show/hide, optional always-on-top, start minimised, updates
- Window bounds persistence, splash screen, single-instance, auto-updater
- Close hides to tray (Quit from tray menu)
- CLI retained for scripts (`bun run cli`)

## Installation

### Windows

1. Download the latest installer from [Releases](https://github.com/taylorivanoff/font-checker/releases)
2. Run the installer and follow the prompts

### macOS

1. Download the `.dmg` from [Releases](https://github.com/taylorivanoff/font-checker/releases) and drag **Font Checker** to Applications
2. macOS may say the app is “damaged” - that is Gatekeeper blocking an unsigned download, not a bad file. Clear quarantine, then open:

```bash
xattr -cr "/Applications/Font Checker.app"
open "/Applications/Font Checker.app"
```

Or right-click the app → **Open** → **Open**.

## Development

```bash
bun install
bun run start
```

### CLI

```bash
bun run cli https://example.com
bun run cli https://example.com --convert --out ./out
bun run cli https://example.com --json
```

### Building

```bash
bun run release
```

### Releasing

Bump the `version` in `package.json` and push to `master`. The GitHub Actions workflow builds Windows and macOS installers, uploads updater metadata, and creates a GitHub Release.

Optional repo secrets for signed builds:

- `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (Windows)
- `CSC_LINK` / `CSC_KEY_PASSWORD` plus Apple notarization env vars (macOS Developer ID)

## Usage

1. Paste a page URL
2. Pick Discover, Download, or Convert to OTF
3. Optionally set an output folder
4. Click **Scan** and inspect results / reveal saved files

## Keywords

web font detector, font scraper, woff2 to otf converter, website font finder, Electron font app, Fontdue font download

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

