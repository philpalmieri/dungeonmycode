# dungeon my code

Turn any GitHub repo into a dungeon-crawling text RPG. Explore codebases like never before.

## Play

Visit **[dungeonmycode.dev](https://philpalmieri.github.io/dungeonmycode)** (or host it yourself — it's just static files).

Paste a public GitHub repo URL and start exploring:

```
> expressjs/express

Generating dungeon from expressjs/express...
  Found 847 passages and chambers...
  Dungeon generated: 42 rooms

═══════════════════════════════════════
  express 🕯️
  /
═══════════════════════════════════════

The entrance to the dungeon.

Exits: lib, test, examples, benchmarks
  [NPC] The Sage — An ancient scroll of wisdom.
  [ARTIFACT] Manifest of Dependencies

> go lib
```

## How it works

| Code concept | Game mechanic |
|---|---|
| Directories | Rooms |
| Files | Items to examine |
| Imports/requires | Portals between rooms |
| TODO/FIXME/HACK | Loot drops |
| File size + complexity | Room danger level |
| Test coverage gaps | Fog of war |
| Contributors | NPCs |
| Primary language | Dungeon biome/theme |

## Commands

| Command | Description |
|---|---|
| `look` | Examine your surroundings |
| `go <dir>` / `cd <dir>` | Move to an adjacent room |
| `ls` | List items and exits |
| `examine <file>` / `cat <file>` | Read a file's contents |
| `map` | Show the dungeon map |
| `search` | Search current room for loot |
| `stats` | Show exploration progress |
| `back` | Return to previous room |
| `history` | Show visited rooms |
| `help` | List all commands |

## Tech

Zero dependencies. Pure vanilla JS. No build step. Runs entirely client-side using the GitHub REST API.

```
dungeonmycode/
├── index.html
├── css/terminal.css
├── js/
│   ├── main.js          # entry point, terminal I/O
│   ├── engine.js        # game loop, commands
│   ├── dungeon.js       # map generator
│   ├── github.js        # API client
│   └── renderer.js      # terminal output
└── README.md
```

## Rate limits

Uses the GitHub API unauthenticated (60 requests/hour). For heavier use, add a personal access token. Private repo support coming via GitHub OAuth.

## License

MIT
