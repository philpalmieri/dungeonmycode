/**
 * Dungeon builder — takes analyzed app structure and creates a navigable dungeon
 * based on application flows, not file trees.
 *
 * The dungeon represents the conceptual model of the application:
 * - REST API: lobby → route groups → individual endpoints → handlers
 * - CLI: lobby → subcommands → flags/options
 * - Frontend: lobby → pages → components
 * - Library: lobby → exported modules → functions
 */

const BIOMES = {
  'rest-api':  { name: 'The Living Server', theme: 'arcane', color: 'info' },
  'cli':       { name: 'The Command Spire', theme: 'stone', color: 'dim' },
  'frontend':  { name: 'The Interface Realm', theme: 'crystal', color: 'bright' },
  'library':   { name: 'The Artifact Vault', theme: 'ancient', color: 'warning' },
  'fullstack': { name: 'The Dual Realm', theme: 'hybrid', color: 'info' },
};

const METHOD_ICONS = {
  GET:    '🔍',
  POST:   '⚡',
  PUT:    '🔧',
  PATCH:  '🩹',
  DELETE: '💀',
  ALL:    '🌐',
  USE:    '🛡️',
};

const METHOD_DANGER = {
  GET: 1, POST: 3, PUT: 3, PATCH: 2, DELETE: 5, ALL: 2, USE: 1,
};

/**
 * Build a conceptual dungeon from analyzed app structure
 */
export function buildConceptualDungeon(appType, analysis, repoInfo, languages) {
  const biome = BIOMES[appType] || BIOMES['rest-api'];

  switch (appType) {
    case 'rest-api':
      return buildApiDungeon(analysis, repoInfo, biome);
    case 'cli':
      return buildCliDungeon(analysis, repoInfo, biome);
    case 'frontend':
      return buildFrontendDungeon(analysis, repoInfo, biome);
    default:
      return buildApiDungeon(analysis, repoInfo, biome);
  }
}

function buildApiDungeon(analysis, repoInfo, biome) {
  const rooms = new Map();
  const { routes, middleware, models } = analysis;

  // create lobby
  const lobby = createRoom('lobby', repoInfo.name, `
You stand in the main hall of ${repoInfo.name}. ${repoInfo.description || 'A mysterious server hums with energy.'}
${routes.length} routes branch out from this central hub.
${middleware.length > 0 ? `${middleware.length} guardians patrol the corridors.` : ''}
${models.length > 0 ? `Whispers speak of ${models.length} ancient data entities.` : ''}`.trim());
  lobby.roomType = 'lobby';
  rooms.set('lobby', lobby);

  // group routes by first path segment
  const routeGroups = new Map();
  for (const route of routes) {
    const segments = route.path.split('/').filter(Boolean);
    const group = segments[0] || 'root';
    if (!routeGroups.has(group)) routeGroups.set(group, []);
    routeGroups.get(group).push(route);
  }

  // create a room for each route group
  for (const [groupName, groupRoutes] of routeGroups) {
    const groupId = `route:${groupName}`;
    const room = createRoom(groupId, groupName, generateRouteGroupDesc(groupName, groupRoutes));
    room.roomType = 'route-group';
    room.dangerLevel = Math.min(groupRoutes.length, 8);

    // link to lobby
    lobby.exits.set(groupName, groupId);
    room.exits.set('lobby', 'lobby');

    // add individual routes as items
    for (const route of groupRoutes) {
      const icon = METHOD_ICONS[route.method] || '📡';
      room.items.push({
        name: `${route.method} ${route.path}`,
        displayName: `${icon} ${route.method} ${route.path}`,
        description: route.description || describeEndpoint(route),
        type: route.method === 'DELETE' ? 'trap' : route.method === 'POST' ? 'artifact' : 'file',
        examined: false,
        sourceFile: route.file,
        method: route.method,
        path: route.path,
        dangerLevel: METHOD_DANGER[route.method] || 1,
      });
    }

    // create sub-rooms for deeper routes
    const deepRoutes = groupRoutes.filter(r => r.path.split('/').filter(Boolean).length > 2);
    const subGroups = new Map();
    for (const route of deepRoutes) {
      const segments = route.path.split('/').filter(Boolean);
      const subGroup = segments.slice(0, 2).join('/');
      if (!subGroups.has(subGroup)) subGroups.set(subGroup, []);
      subGroups.get(subGroup).push(route);
    }

    for (const [subName, subRoutes] of subGroups) {
      if (subRoutes.length >= 2) {
        const subId = `route:${subName}`;
        const subRoom = createRoom(subId, subName, `A deeper passage in the ${groupName} wing. ${subRoutes.length} endpoints await.`);
        subRoom.roomType = 'route-sub';
        subRoom.dangerLevel = Math.min(subRoutes.length + 2, 8);
        room.exits.set(subName.split('/').pop(), subId);
        subRoom.exits.set('..', groupId);
        rooms.set(subId, subRoom);
      }
    }

    rooms.set(groupId, room);
  }

  // middleware as a special room (the gauntlet)
  if (middleware.length > 0) {
    const mwId = 'middleware';
    const mwRoom = createRoom(mwId, 'The Gauntlet', `
A narrow corridor lined with ${middleware.length} guardians. Every request must pass through here.
Each guardian inspects, transforms, or blocks what passes.`.trim());
    mwRoom.roomType = 'middleware';
    mwRoom.dangerLevel = 4;

    for (const mw of middleware) {
      mwRoom.items.push({
        name: mw.name,
        displayName: `🛡️ ${mw.name}`,
        description: describeMiddleware(mw.name),
        type: 'npc',
        examined: false,
        sourceFile: mw.file,
      });
    }

    lobby.exits.set('gauntlet', mwId);
    mwRoom.exits.set('lobby', 'lobby');
    rooms.set(mwId, mwRoom);
  }

  // models as a special room (the vault)
  if (models.length > 0) {
    const modelId = 'models';
    const modelRoom = createRoom(modelId, 'The Data Vault', `
A vast chamber filled with ${models.length} crystallized data entities.
These are the shapes that all information takes in this realm.`.trim());
    modelRoom.roomType = 'models';
    modelRoom.dangerLevel = 2;

    for (const model of models) {
      modelRoom.items.push({
        name: model,
        displayName: `◈ ${model}`,
        description: `A data entity called ${model}. Its structure defines how ${model.toLowerCase()} data flows through the system.`,
        type: 'artifact',
        examined: false,
      });
    }

    lobby.exits.set('vault', modelId);
    modelRoom.exits.set('lobby', 'lobby');
    rooms.set(modelId, modelRoom);
  }

  return {
    rooms,
    biome,
    appType: 'rest-api',
    repoName: repoInfo.name,
    repoDesc: repoInfo.description,
    stars: repoInfo.stargazers_count,
    totalRooms: rooms.size,
    totalRoutes: routes.length,
    totalModels: models.length,
  };
}

function buildCliDungeon(analysis, repoInfo, biome) {
  const rooms = new Map();
  const { commands } = analysis;

  const lobby = createRoom('lobby', repoInfo.name, `
You stand before ${repoInfo.name}. ${repoInfo.description || 'A powerful command-line tool.'}
${commands.length} commands are inscribed on the walls before you.
Each one leads deeper into the tool's capabilities.`.trim());
  lobby.roomType = 'lobby';
  rooms.set('lobby', lobby);

  // each command is a room
  for (const cmd of commands) {
    const cmdId = `cmd:${cmd.name}`;
    const room = createRoom(cmdId, cmd.name, cmd.description || `The ${cmd.name} command. Its purpose awaits discovery.`);
    room.roomType = 'command';
    room.dangerLevel = 2;

    room.items.push({
      name: cmd.name,
      displayName: `⚙️ ${cmd.name}`,
      description: cmd.description || `Execute the ${cmd.name} command.`,
      type: 'artifact',
      examined: false,
      sourceFile: cmd.file,
    });

    lobby.exits.set(cmd.name, cmdId);
    room.exits.set('lobby', 'lobby');
    rooms.set(cmdId, room);
  }

  return {
    rooms,
    biome,
    appType: 'cli',
    repoName: repoInfo.name,
    repoDesc: repoInfo.description,
    stars: repoInfo.stargazers_count,
    totalRooms: rooms.size,
    totalCommands: commands.length,
  };
}

function buildFrontendDungeon(analysis, repoInfo, biome) {
  const rooms = new Map();
  const { pages } = analysis;

  const lobby = createRoom('lobby', repoInfo.name, `
You materialize in ${repoInfo.name}. ${repoInfo.description || 'A shimmering interface stretches before you.'}
${pages.length} portals lead to different views of this realm.`.trim());
  lobby.roomType = 'lobby';
  rooms.set('lobby', lobby);

  for (const page of pages) {
    const pageId = `page:${page.path}`;
    const room = createRoom(pageId, page.name || page.path, `The ${page.name || page.path} view. Users see this when they navigate to ${page.path}.`);
    room.roomType = 'page';
    room.dangerLevel = 1;

    room.items.push({
      name: page.path,
      displayName: `🖥️ ${page.path}`,
      description: `A rendered view at ${page.path}`,
      type: 'artifact',
      examined: false,
      sourceFile: page.file,
    });

    lobby.exits.set(page.name || page.path, pageId);
    room.exits.set('lobby', 'lobby');
    rooms.set(pageId, room);
  }

  return {
    rooms,
    biome,
    appType: 'frontend',
    repoName: repoInfo.name,
    repoDesc: repoInfo.description,
    stars: repoInfo.stargazers_count,
    totalRooms: rooms.size,
    totalPages: pages.length,
  };
}

// --- helpers ---

function createRoom(id, name, description) {
  return {
    id,
    path: id,
    name,
    description,
    exits: new Map(),
    items: [],
    explored: false,
    dangerLevel: 0,
    roomType: 'generic',
  };
}

function generateRouteGroupDesc(name, routes) {
  const methods = routes.map(r => r.method);
  const getCt = methods.filter(m => m === 'GET').length;
  const postCt = methods.filter(m => m === 'POST').length;
  const deleteCt = methods.filter(m => m === 'DELETE').length;

  let desc = `The ${name} wing. ${routes.length} endpoint${routes.length > 1 ? 's' : ''} reside here.`;

  if (getCt > 0) desc += ` ${getCt} read portal${getCt > 1 ? 's' : ''} glow softly.`;
  if (postCt > 0) desc += ` ${postCt} creation altar${postCt > 1 ? 's' : ''} pulse with energy.`;
  if (deleteCt > 0) desc += ` ${deleteCt} destruction rune${deleteCt > 1 ? 's' : ''} smolder dangerously.`;

  return desc;
}

function describeEndpoint(route) {
  const descs = {
    GET: `A reading portal. Peer through to see ${route.path.split('/').pop() || 'data'}.`,
    POST: `A creation altar. New entities are forged here.`,
    PUT: `A transmutation circle. Existing entities are reshaped.`,
    PATCH: `A mending station. Small repairs are made here.`,
    DELETE: `A destruction rune. Things that enter do not return.`,
  };
  return descs[route.method] || `An endpoint at ${route.path}.`;
}

function describeMiddleware(name) {
  const known = {
    cors: 'The Gatekeeper — decides who may cross realm boundaries.',
    helmet: 'The Armorer — hardens defenses against common attacks.',
    auth: 'The Sentinel — only the authenticated may pass.',
    morgan: 'The Scribe — records every traveler who passes.',
    compression: 'The Compressor — shrinks all that passes through.',
    'body-parser': 'The Translator — converts raw messages into readable form.',
    session: 'The Memory Keeper — remembers returning travelers.',
    'rate-limit': 'The Throttle — prevents any one traveler from overrunning the halls.',
    validator: 'The Inspector — examines all cargo for contraband.',
    errorHandler: 'The Warden — catches those who fall and decides their fate.',
  };

  const lowerName = name.toLowerCase();
  for (const [key, desc] of Object.entries(known)) {
    if (lowerName.includes(key)) return desc;
  }
  return `A guardian called ${name}. Its purpose is yet unknown.`;
}

/**
 * Find loot (TODOs, FIXMEs) in file content
 */
export function findLoot(content, fileName) {
  const loot = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(TODO|FIXME|HACK|XXX|BUG)[\s:]+(.+)/i);
    if (match) {
      loot.push({ type: match[1].toUpperCase(), message: match[2].trim(), line: i + 1, file: fileName });
    }
  }
  return loot;
}

/**
 * Find portals (imports) in file content
 */
export function findPortals(content) {
  const portals = [];
  const patterns = [
    /import\s+.*?from\s+['"](.+?)['"]/g,
    /require\s*\(\s*['"](.+?)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const target = match[1];
      portals.push({ type: target.startsWith('.') ? 'local' : 'external', target });
    }
  }
  return portals;
}
