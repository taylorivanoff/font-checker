export function parseArgs(argv) {
  const args = {
    url: null,
    download: false,
    convert: false,
    out: 'font-output',
    json: false,
    timeout: 30_000,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--download') args.download = true;
    else if (a === '--convert') {
      args.convert = true;
      args.download = true;
    } else if (a === '--json') args.json = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else if (!args.url) args.url = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }

  return args;
}
