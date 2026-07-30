# font-checker

Node CLI that scans a page for fonts, understands obfuscation, and can unwrap woff2 → `.otf` (sfnt).

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