# Font Checker - Web Font Tool & WOFF2 to OTF

[![Release](https://img.shields.io/github/v/release/taylorivanoff/font-checker)](https://github.com/taylorivanoff/font-checker/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/font-checker/total)](https://github.com/taylorivanoff/font-checker/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/font-checker)](LICENSE)

Font Checker is an open-source, cross-platform desktop app that scans a webpage for fonts and can download and unwrap WOFF2 → OTF web fonts.

Useful for designers, developers, and anyone auditing or recovering web fonts from a site.

<img width="762" height="652" alt="{90D216AC-7466-4CF2-B0EB-ACAC182EF947}" src="https://github.com/user-attachments/assets/039d7848-c0cf-4c7c-af4e-7477be036f9b" />

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

## Usage

1. Paste a page URL
2. Pick Discover, Download, or Convert to OTF
3. Optionally set an output folder
4. Click **Scan** and inspect results / reveal saved files

## Keywords

web font detector, font scraper, woff2 to otf converter, website font finder

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

