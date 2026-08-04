# font-checker — Web Font Detector & WOFF2 to OTF Converter

Node.js CLI that **scans a webpage for fonts**, handles common obfuscation, and can **download and convert WOFF2 to OTF**. Useful for designers, developers, and anyone auditing or recovering web fonts from a site.

## Features

- Discover fonts used on any URL
- Understand font obfuscation patterns
- Download fonts and convert **woff2 → `.otf`**
- JSON output for scripting and pipelines

## Setup

```bash
cd font-checker
npm install
```

## Usage

```bash
# Discover only
node src/cli.js https://example.com

# Download + convert woff2 → otf
node src/cli.js https://example.com --convert --out ./out

# JSON
node src/cli.js https://example.com --json
```

## Keywords

web font detector, font scraper, woff2 to otf converter, website font finder, Node.js font CLI, extract fonts from website

## License

See repository license file if present.
