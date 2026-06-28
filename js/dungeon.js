/**
 * Dungeon generator — transforms a GitHub file tree into a navigable dungeon.
 *
 * Each directory = a room. Files inside = things to examine.
 * Imports/requires in files = doors (portals) to other rooms.
 * Special files get special treatment (README = sage, TODO = loot, etc).
 */

const BIOMES = {
  JavaScript: { name: 'Arcane Workshop', color: 'warning' },
  TypeScript: { name: 'Crystal Fortress', color: 'info' },
  Python:     { name: 'Serpent Caverns', color: 'bright' },
  Go:         { name: 'Stone Halls', color: 'dim' },
  Rust:       { name: 'Iron Depths', color: 'danger' },
  Java:       { name: 'Ancient Cathedral', color: 'muted' },
  Ruby:       { name: 'Gem Mines', color: 'danger' },
  Shell:      { name: 'Wind Tunnels', color: 'dim' },
  default:    { name: 'Unknown Caverns', color: 'dim' },
};

const SPECIAL_FILES = {
  'README.md':      { type: 'npc', name: 'The Sage', desc: 'An ancient scroll of wisdom.' },
  'readme.md':      { type: 'npc', name: 'The Sage', desc: 'An ancient scroll of wisdom.' },
  'LICENSE':        { type: 'npc', name: 'The Law Keeper', desc: 'A stone tablet etched with sacred law.' },
  'package.json':   { type: 'artifact', name: 'Manifest of Dependencies', desc: 'Lists the summoned entities powering this realm.' },
  'Cargo.toml':     { type: 'artifact', name: 'Iron Manifest', desc: 'Forging instructions for the Iron Depths.' },
  'go.mod':         { type: 'artifact', name: 'Stone Ledger', desc: 'Records the pacts made with external forces.' },
  'requirements.txt': { type: 'artifact', name: 'Potion Recipe', desc: 'A list of alchemical ingredients.' },
  '.env':           { type: 'legendary', name: 'Bag of Secrets', desc: 'Glowing runes of power. Handle with care.' },
  '.env.example':   { type: 'loot', name: 'Decoded Secrets Template', desc: 'A cipher key, but the secrets are missing.' },
  'Dockerfile':     { type: 'artifact', name: 'Summoning Circle', desc: 'Instructions to conjure this realm in a bottle.' },
  'Makefile':       { type: 'artifact', name: 'Builder\'s Blueprint', desc: 'Ancient instructions for assembling the fortress.' },
  '.gitignore':     { type: 'trap', name: 'Invisibility Cloak', desc: 'Things hidden from the all-seeing eye.' },
};

/**
 * Build dungeon from GitHub tree API response
 */
export function buildDungeon(treeData, repoInfo, languages) {
  const rooms = new Map();
  const rootRoom = createRoom('/', repoInfo.name, repoInfo.description || 'The entrance to the dungeon.');

  rooms.set('/', rootRoom);

  // determine primary biome
  const primaryLang = Object.keys(languages || {})[0] || 'default';
  const biome = BIOMES[primaryLang] || BIOMES.default;

  // process tree items
  for (const item of treeData.tree) {
    if (item.type === 'tree') {
      // directory = room
      const path = '/' + item.path;
      const name = item.path.split('/').pop();
      const room = createRoom(path, name, generateRoomDescription(name, biome));
      rooms.set(path, room);

      // link parent
      const parentPath = getParentPath(path);
      const parent = rooms.get(parentPath);
      if (parent) {
        parent.exits.set(name, path);
        room.exits.set('..', parentPath);
      }
    } else if (item.type === 'blob') {
      // file = item in room
      const dirPath = getParentPath('/' + item.path);
      const fileName = item.path.split('/').pop();
      const room = rooms.get(dirPath);
      if (room) {
        const fileItem = createFileItem(fileName, item.path, item.size);
        room.items.push(fileItem);
      }
    }
  }

  // generate loot from file counts and special files
  for (const [, room] of rooms) {
    room.explored = false;
    room.dangerLevel = calculateDanger(room);
  }

  return {
    rooms,
    biome,
    repoName: repoInfo.name,
    repoDesc: repoInfo.description,
    stars: repoInfo.stargazers_count,
    primaryLanguage: primaryLang,
    totalRooms: rooms.size,
  };
}

function createRoom(path, name, description) {
  return {
    path,
    name,
    description,
    exits: new Map(),
    items: [],
    explored: false,
    dangerLevel: 0,
    portals: [],     // filled later by import analysis
    npcs: [],
    monsters: [],
  };
}

function createFileItem(fileName, fullPath, size) {
  const special = SPECIAL_FILES[fileName];
  const ext = fileName.split('.').pop().toLowerCase();

  const item = {
    name: fileName,
    path: fullPath,
    size,
    type: special?.type || 'file',
    displayName: special?.name || fileName,
    description: special?.desc || describeFile(fileName, size, ext),
    examined: false,
  };

  // find loot in comments
  item.hasLoot = /TODO|FIXME|HACK|XXX|BUG/i.test(fileName);

  return item;
}

function describeFile(name, size, ext) {
  const sizeDesc = size > 10000 ? 'massive' : size > 3000 ? 'hefty' : size > 500 ? 'modest' : 'small';

  const typeDescs = {
    js: 'A tome of arcane JavaScript incantations',
    ts: 'A crystalline TypeScript manuscript',
    py: 'A coiled Python scroll',
    go: 'A stone tablet inscribed in Go',
    rs: 'An iron-forged Rust document',
    java: 'An ancient Java scripture',
    rb: 'A ruby-encrusted scroll',
    sh: 'A whispered shell command',
    json: 'A structured data crystal',
    yaml: 'A configuration parchment',
    yml: 'A configuration parchment',
    md: 'A readable manuscript',
    css: 'A style enchantment scroll',
    html: 'A structural blueprint',
    sql: 'A database query stone',
    test: 'A trial chamber scroll',
    spec: 'A trial chamber scroll',
  };

  const typeDesc = typeDescs[ext] || 'A mysterious document';
  return `${typeDesc}. ${sizeDesc} (${formatSize(size)}).`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function generateRoomDescription(name, biome) {
  const descs = {
    src:          'The main chamber of the codebase. Passages branch in many directions.',
    lib:          'A library of reusable incantations. The shelves are well organized.',
    test:         'A proving ground. The echoes of past trials linger.',
    tests:        'A proving ground. The echoes of past trials linger.',
    __tests__:    'A proving ground. The echoes of past trials linger.',
    spec:         'A proving ground. The echoes of past trials linger.',
    docs:         'A hall of records. Knowledge is carved into every wall.',
    config:       'A control room filled with switches and dials.',
    utils:        'A workshop of small but powerful tools.',
    helpers:      'A workshop of small but powerful tools.',
    components:   'A gallery of building blocks, each one distinct.',
    models:       'A chamber of blueprints. The shapes of data are defined here.',
    controllers:  'A command center. Orders are dispatched from this room.',
    routes:       'A crossroads. Many paths converge and diverge here.',
    api:          'The gateway. External travelers arrive through this chamber.',
    middleware:   'A narrow corridor. Everything passes through here.',
    services:     'The engine room. Complex machinery hums with purpose.',
    hooks:        'A room of enchanted triggers. Touch one and things happen.',
    styles:       'A painter\'s studio. Colors and forms take shape.',
    assets:       'A treasure vault of images, fonts, and relics.',
    public:       'An open courtyard. Visible to all who approach.',
    scripts:      'An armory of automated tools.',
    bin:          'A collection of executable weapons.',
    dist:         'The finished product. Built and ready for battle.',
    build:        'A forge. Raw materials become something greater.',
    node_modules: 'An impossibly deep chasm. Thousands of voices echo from below. You probably shouldn\'t go in here.',
    vendor:       'A bustling marketplace of borrowed goods.',
    '.github':    'A hidden alcove of automation spirits.',
    '.vscode':    'A shrine to the editor gods.',
  };

  return descs[name] || `A chamber in the ${biome.name}. The air hums with code.`;
}

function getParentPath(path) {
  if (path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/');
}

function calculateDanger(room) {
  let danger = 0;

  // more files = more complex = more dangerous
  danger += Math.min(room.items.length * 0.5, 5);

  // more exits = hub = busier
  danger += Math.min(room.exits.size * 0.3, 3);

  // large files are scarier
  for (const item of room.items) {
    if (item.size > 10000) danger += 1;
    if (item.hasLoot) danger += 0.5;
  }

  return Math.min(Math.round(danger), 10);
}

/**
 * Scan file contents for import/require statements → portals
 */
export function findPortals(content, currentPath) {
  const portals = [];
  const importPatterns = [
    /import\s+.*?from\s+['"](.+?)['"]/g,
    /require\s*\(\s*['"](.+?)['"]\s*\)/g,
    /from\s+(\S+)\s+import/g,
  ];

  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const target = match[1];
      if (target.startsWith('.')) {
        portals.push({ type: 'local', target, raw: match[0] });
      } else {
        portals.push({ type: 'external', target, raw: match[0] });
      }
    }
  }

  return portals;
}

/**
 * Scan file contents for TODO/FIXME/HACK → loot drops
 */
export function findLoot(content, fileName) {
  const loot = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const todoMatch = line.match(/(TODO|FIXME|HACK|XXX|BUG)[\s:]+(.+)/i);
    if (todoMatch) {
      loot.push({
        type: todoMatch[1].toUpperCase(),
        message: todoMatch[2].trim(),
        line: i + 1,
        file: fileName,
      });
    }
  }

  return loot;
}
