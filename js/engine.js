/**
 * Game engine — state management, command parsing, game loop.
 */

import * as github from './github.js';
import { detectAppType, extractRoutes, extractCommands, extractPages } from './analyzer.js';
import { buildConceptualDungeon, findPortals, findLoot } from './dungeon-builder.js';
import { Renderer } from './renderer.js';

const COMMANDS = {
  help:     'Show available commands',
  look:     'Examine your surroundings',
  go:       'Move to an adjacent room (go <direction>)',
  cd:       'Alias for go',
  ls:       'List items and exits in the current room',
  examine:  'Examine a file (examine <filename>)',
  cat:      'Alias for examine',
  map:      'Show the dungeon map',
  stats:    'Show your exploration stats',
  search:   'Search for loot in current room files',
  portals:  'Show discovered portals in current room',
  back:     'Go to the previous room',
  history:  'Show rooms you\'ve visited',
  clear:    'Clear the terminal',
  quit:     'Return to the entrance',
};

export class Engine {
  constructor(renderer) {
    this.renderer = renderer;
    this.dungeon = null;
    this.currentRoom = null;
    this.repoOwner = null;
    this.repoName = null;
    this.visitHistory = [];
    this.exploredRooms = new Set();
    this.discoveredLoot = [];
    this.discoveredPortals = [];
    this.examineCache = new Map();
    this.state = 'menu'; // menu | loading | playing
  }

  async handleCommand(input) {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (this.state === 'menu') {
      return this.handleMenuInput(trimmed);
    }

    if (this.state === 'loading') {
      this.renderer.print('Still loading... please wait.', 'dim');
      return;
    }

    const [cmd, ...args] = trimmed.split(/\s+/);
    const arg = args.join(' ');

    switch (cmd.toLowerCase()) {
      case 'help':    return this.cmdHelp();
      case 'look':    return this.cmdLook();
      case 'go':
      case 'cd':      return this.cmdGo(arg);
      case 'ls':      return this.cmdLs();
      case 'examine':
      case 'cat':     return this.cmdExamine(arg);
      case 'map':     return this.cmdMap();
      case 'stats':   return this.cmdStats();
      case 'search':  return this.cmdSearch();
      case 'portals': return this.cmdPortals();
      case 'back':    return this.cmdBack();
      case 'history': return this.cmdHistory();
      case 'clear':   return this.renderer.clear();
      case 'quit':
      case 'exit':    return this.cmdQuit();
      default:
        this.renderer.print(`Unknown command: ${cmd}. Type 'help' for available commands.`, 'warning');
    }
  }

  showWelcome() {
    this.renderer.printArt(`
 ██████╗ ██╗   ██╗███╗   ██╗ ██████╗ ███████╗ ██████╗ ███╗   ██╗
 ██╔══██╗██║   ██║████╗  ██║██╔════╝ ██╔════╝██╔═══██╗████╗  ██║
 ██║  ██║██║   ██║██╔██╗ ██║██║  ███╗█████╗  ██║   ██║██╔██╗ ██║
 ██║  ██║██║   ██║██║╚██╗██║██║   ██║██╔══╝  ██║   ██║██║╚██╗██║
 ██████╔╝╚██████╔╝██║ ╚████║╚██████╔╝███████╗╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
       ███╗   ███╗██╗   ██╗     ██████╗ ██████╗ ██████╗ ███████╗
       ████╗ ████║╚██╗ ██╔╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
       ██╔████╔██║ ╚████╔╝     ██║     ██║   ██║██║  ██║█████╗
       ██║╚██╔╝██║  ╚██╔╝      ██║     ██║   ██║██║  ██║██╔══╝
       ██║ ╚═╝ ██║   ██║       ╚██████╗╚██████╔╝██████╔╝███████╗
       ╚═╝     ╚═╝   ╚═╝        ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝`);

    this.renderer.print('');
    this.renderer.print('Turn any GitHub repo into a dungeon. Explore codebases like never before.', 'info');
    this.renderer.print('');
    this.renderer.print('Enter a GitHub repo URL or owner/repo to begin:', 'bright');
    this.renderer.print('  Example: expressjs/express', 'dim');
    this.renderer.print('  Example: https://github.com/facebook/react', 'dim');
    this.renderer.print('');
  }

  async handleMenuInput(input) {
    const parsed = github.parseRepo(input);
    if (!parsed) {
      this.renderer.print('Could not parse that. Try owner/repo or a GitHub URL.', 'warning');
      return;
    }

    this.repoOwner = parsed.owner;
    this.repoName = parsed.repo;
    this.state = 'loading';

    this.renderer.print('');
    this.renderer.print(`Generating dungeon from ${parsed.owner}/${parsed.repo}...`, 'info');
    this.renderer.print('');

    try {
      this.renderer.print('  Scouting the repository...', 'dim');
      const [repoInfo, treeData, languages] = await Promise.all([
        github.fetchRepoInfo(parsed.owner, parsed.repo),
        github.fetchTree(parsed.owner, parsed.repo),
        github.fetchLanguages(parsed.owner, parsed.repo),
      ]);

      this.renderer.print(`  Found ${treeData.tree.length} files...`, 'dim');
      this.renderer.print('  Analyzing application structure...', 'dim');

      // detect what kind of app this is
      const { type: appType, confidence } = await detectAppType(
        parsed.owner, parsed.repo, treeData, languages
      );
      this.renderer.print(`  Detected: ${appType} (confidence: ${confidence})`, 'dim');

      // extract logical structure based on app type
      let analysis = {};
      if (appType === 'rest-api' || appType === 'fullstack') {
        this.renderer.print('  Mapping routes and endpoints...', 'dim');
        analysis = await extractRoutes(parsed.owner, parsed.repo, treeData);
      } else if (appType === 'cli') {
        this.renderer.print('  Discovering commands...', 'dim');
        const commands = await extractCommands(parsed.owner, parsed.repo, treeData);
        analysis = { commands };
      } else if (appType === 'frontend') {
        this.renderer.print('  Charting pages and views...', 'dim');
        const pages = await extractPages(parsed.owner, parsed.repo, treeData);
        analysis = { pages };
      } else {
        // fallback: try routes first, then commands
        analysis = await extractRoutes(parsed.owner, parsed.repo, treeData);
        if (analysis.routes.length === 0) {
          const commands = await extractCommands(parsed.owner, parsed.repo, treeData);
          if (commands.length > 0) analysis = { commands };
        }
      }

      this.renderer.print('  Building dungeon from application flow...', 'dim');

      // build the conceptual dungeon
      const effectiveType = analysis.commands ? 'cli' :
                            analysis.pages ? 'frontend' : 'rest-api';
      this.dungeon = buildConceptualDungeon(effectiveType, analysis, repoInfo, languages);

      this.renderer.print(`  Dungeon generated: ${this.dungeon.totalRooms} rooms`, 'dim');
      if (this.dungeon.totalRoutes) this.renderer.print(`  Routes mapped: ${this.dungeon.totalRoutes}`, 'dim');
      if (this.dungeon.totalCommands) this.renderer.print(`  Commands found: ${this.dungeon.totalCommands}`, 'dim');
      this.renderer.print('');

      // enter the dungeon
      this.state = 'playing';
      this.enterRoom('lobby');

      this.renderer.print('');
      this.renderer.print('Type \'help\' for commands. Type \'look\' to examine your surroundings.', 'dim');

    } catch (err) {
      this.state = 'menu';
      this.renderer.print(`Failed to generate dungeon: ${err.message}`, 'danger');
      this.renderer.print('');
      this.renderer.print('Make sure the repository is public and the URL is correct.', 'dim');

      // check rate limit
      try {
        const rate = await github.checkRateLimit();
        if (rate.remaining < 5) {
          this.renderer.print(`GitHub API rate limit: ${rate.remaining}/${rate.limit} remaining. Resets at ${new Date(rate.reset * 1000).toLocaleTimeString()}.`, 'warning');
        }
      } catch (_) {}
    }
  }

  enterRoom(path) {
    const room = this.dungeon.rooms.get(path);
    if (!room) {
      this.renderer.print('That path leads nowhere.', 'warning');
      return;
    }

    if (this.currentRoom) {
      this.visitHistory.push(this.currentRoom.path);
    }

    this.currentRoom = room;
    room.explored = true;
    this.exploredRooms.add(path);

    // room header
    const dangerIndicator = room.dangerLevel > 7 ? ' ☠️' :
                            room.dangerLevel > 4 ? ' ⚔️' :
                            room.dangerLevel > 2 ? ' 🗡️' : ' 🕯️';

    this.renderer.print('');
    this.renderer.print(`═══════════════════════════════════════`, 'dim');
    this.renderer.print(`  ${room.name}${dangerIndicator}`, 'bright');
    this.renderer.print(`  ${room.path}`, 'dim');
    this.renderer.print(`═══════════════════════════════════════`, 'dim');
    this.renderer.print('');
    this.renderer.print(room.description);
    this.renderer.print('');

    // show exits
    if (room.exits.size > 0) {
      const exits = [...room.exits.keys()].filter(e => e !== '..').join(', ');
      if (exits) this.renderer.print(`Exits: ${exits}`, 'info');
      if (room.exits.has('..')) this.renderer.print(`You can go back (..)`, 'dim');
    }

    // show notable items
    const special = room.items.filter(i => i.type !== 'file');
    if (special.length > 0) {
      this.renderer.print('');
      for (const item of special) {
        const color = item.type === 'legendary' ? 'loot' :
                      item.type === 'loot' ? 'loot' :
                      item.type === 'npc' ? 'info' :
                      item.type === 'trap' ? 'danger' : 'warning';
        this.renderer.print(`  [${item.type.toUpperCase()}] ${item.displayName}`, color);
      }
    }

    // item count
    const fileCount = room.items.filter(i => i.type === 'file').length;
    if (fileCount > 0) {
      this.renderer.print(`  ${fileCount} file${fileCount > 1 ? 's' : ''} to examine (type 'ls' to list)`, 'dim');
    }
  }

  cmdHelp() {
    this.renderer.print('');
    this.renderer.print('Available commands:', 'bright');
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
      this.renderer.print(`  ${cmd.padEnd(10)} ${desc}`, cmd === 'help' ? 'info' : undefined);
    }
    this.renderer.print('');
  }

  cmdLook() {
    if (!this.currentRoom) return;
    this.renderer.print('');
    this.renderer.print(this.currentRoom.description);
    this.renderer.print('');

    if (this.currentRoom.items.length > 0) {
      this.renderer.print('You see:', 'bright');
      for (const item of this.currentRoom.items) {
        const icon = item.type === 'legendary' ? '✦' :
                     item.type === 'loot' ? '◆' :
                     item.type === 'npc' ? '☻' :
                     item.type === 'trap' ? '▲' :
                     item.type === 'artifact' ? '◈' : '·';
        const color = item.type === 'legendary' ? 'loot' :
                      item.type === 'npc' ? 'info' :
                      item.type === 'trap' ? 'danger' :
                      item.examined ? 'dim' : undefined;
        this.renderer.print(`  ${icon} ${item.displayName}${item.examined ? ' (examined)' : ''}`, color);
      }
    }

    this.renderer.print('');
    const exits = [...this.currentRoom.exits.entries()];
    if (exits.length > 0) {
      this.renderer.print('Exits:', 'bright');
      for (const [name, path] of exits) {
        const targetRoom = this.dungeon.rooms.get(path);
        const explored = targetRoom?.explored ? ' (explored)' : ' (unexplored)';
        this.renderer.print(`  → ${name}${explored}`, targetRoom?.explored ? 'dim' : 'info');
      }
    }
    this.renderer.print('');
  }

  cmdGo(direction) {
    if (!direction) {
      this.renderer.print('Go where? Specify a direction. Type \'ls\' to see exits.', 'warning');
      return;
    }

    if (!this.currentRoom.exits.has(direction)) {
      // fuzzy match
      const match = [...this.currentRoom.exits.keys()].find(
        e => e.toLowerCase().startsWith(direction.toLowerCase())
      );
      if (match) {
        direction = match;
      } else {
        this.renderer.print(`No exit called '${direction}'. Type 'ls' to see exits.`, 'warning');
        return;
      }
    }

    const targetPath = this.currentRoom.exits.get(direction);
    this.enterRoom(targetPath);
  }

  cmdLs() {
    if (!this.currentRoom) return;

    this.renderer.print('');

    // exits (other rooms) first
    const exits = [...this.currentRoom.exits.entries()].filter(([name]) => name !== '..' && name !== 'lobby');
    if (exits.length > 0) {
      for (const [name, path] of exits) {
        const targetRoom = this.dungeon.rooms.get(path);
        const marker = targetRoom?.explored ? 'dim' : 'info';
        this.renderer.print(`  📁 ${name}/`, marker);
      }
    }

    // items in this room
    for (const item of this.currentRoom.items) {
      const icon = item.type === 'legendary' ? '✦ ' :
                   item.type === 'loot' ? '◆ ' :
                   item.type === 'npc' ? '☻ ' :
                   item.type === 'trap' ? '▲ ' :
                   item.type === 'artifact' ? '◈ ' : '  ';
      const color = item.type === 'legendary' ? 'loot' :
                    item.type === 'npc' ? 'info' :
                    item.type === 'trap' ? 'danger' :
                    item.examined ? 'dim' : undefined;
      this.renderer.print(`  ${icon}${item.name}`, color);
    }

    if (this.currentRoom.exits.has('..') || this.currentRoom.exits.has('lobby')) {
      this.renderer.print('');
      this.renderer.print('  ← back (to lobby)', 'dim');
    }
    this.renderer.print('');
  }

  async cmdExamine(fileName) {
    if (!fileName) {
      this.renderer.print('Examine what? Specify a filename.', 'warning');
      return;
    }

    const item = this.currentRoom.items.find(
      i => i.name.toLowerCase() === fileName.toLowerCase() ||
           i.displayName.toLowerCase() === fileName.toLowerCase()
    );

    if (!item) {
      this.renderer.print(`Nothing called '${fileName}' here.`, 'warning');
      return;
    }

    item.examined = true;
    this.renderer.print('');
    this.renderer.print(`── ${item.displayName} ──`, 'bright');
    this.renderer.print(item.description, 'dim');
    this.renderer.print('');

    // fetch file content if there's a source file
    const filePath = item.sourceFile || item.path;
    if (filePath) {
      this.renderer.print('Reading source...', 'dim');

      try {
        let content = this.examineCache.get(filePath);
        if (!content) {
          content = await github.fetchFile(this.repoOwner, this.repoName, filePath);
          if (content) this.examineCache.set(filePath, content);
        }

        if (!content) {
          this.renderer.print('The source is sealed (binary or too large).', 'dim');
        } else {
          // for route items, try to find the relevant handler
          if (item.method && item.path) {
            const relevantLines = findRelevantCode(content, item.method, item.path);
            if (relevantLines.length > 0) {
              this.renderer.print('');
              this.renderer.print('Handler code:', 'info');
              for (const line of relevantLines) {
                this.renderer.print(`  ${line}`, 'dim');
              }
            }
          } else {
            // show first 20 lines
            const lines = content.split('\n').slice(0, 20);
            for (const line of lines) {
              this.renderer.print(`  ${line}`, 'dim');
            }
            const totalLines = content.split('\n').length;
            if (totalLines > 20) {
              this.renderer.print(`  ... (${totalLines - 20} more lines)`, 'muted');
            }
          }

          // find loot
          const loot = findLoot(content, item.name);
          if (loot.length > 0) {
            this.renderer.print('');
            this.renderer.print(`Found ${loot.length} loot drop${loot.length > 1 ? 's' : ''}!`, 'loot');
            for (const l of loot) {
              this.renderer.print(`  [${l.type}] Line ${l.line}: ${l.message}`, 'loot');
              this.discoveredLoot.push(l);
            }
          }

          // find portals
          const portals = findPortals(content);
          if (portals.length > 0) {
            const localPortals = portals.filter(p => p.type === 'local');
            const extPortals = portals.filter(p => p.type === 'external');
            if (localPortals.length > 0) {
              this.renderer.print('');
              this.renderer.print(`Discovered ${localPortals.length} portal${localPortals.length > 1 ? 's' : ''}:`, 'info');
              for (const p of localPortals) {
                this.renderer.print(`  → ${p.target}`, 'info');
                this.discoveredPortals.push(p);
              }
            }
            if (extPortals.length > 0) {
              this.renderer.print(`  (${extPortals.length} external dependencies)`, 'dim');
            }
          }
        }
      } catch (err) {
        this.renderer.print(`Could not read source: ${err.message}`, 'danger');
      }
    }

    this.renderer.print('');
  }

  cmdMap() {
    if (!this.dungeon) return;

    this.renderer.print('');
    this.renderer.print('═══ DUNGEON MAP ═══', 'bright');
    this.renderer.print('');

    const visited = new Set();

    const printTree = (roomId, indent = '') => {
      if (visited.has(roomId)) return;
      visited.add(roomId);

      const room = this.dungeon.rooms.get(roomId);
      if (!room) return;

      const isCurrentRoom = roomId === this.currentRoom.path;
      const explored = room.explored;

      const marker = isCurrentRoom ? '[@]' : explored ? '[·]' : '[?]';
      const color = isCurrentRoom ? 'bright' : explored ? 'dim' : 'muted';
      const dangerIcon = room.dangerLevel > 7 ? ' ☠️' :
                         room.dangerLevel > 4 ? ' ⚔️' : '';

      this.renderer.print(`${indent}${marker} ${room.name}${dangerIcon}`, color);

      const childExits = [...room.exits.entries()]
        .filter(([name, target]) => name !== '..' && name !== 'lobby' && !visited.has(target))
        .sort(([a], [b]) => a.localeCompare(b));

      for (let i = 0; i < childExits.length; i++) {
        const [, childPath] = childExits[i];
        const isLast = i === childExits.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        printTree(childPath, indent + connector);
      }
    };

    printTree('lobby');

    this.renderer.print('');
    this.renderer.print(`[@] = you are here  [·] = explored  [?] = unexplored`, 'dim');
    this.renderer.print('');
  }

  cmdStats() {
    this.renderer.print('');
    this.renderer.print('═══ EXPLORATION STATS ═══', 'bright');
    this.renderer.print('');
    this.renderer.print(`  Dungeon: ${this.dungeon.repoName}`, 'info');
    this.renderer.print(`  Biome: ${this.dungeon.biome.name}`, this.dungeon.biome.color);
    this.renderer.print(`  Stars: ${'⭐'.repeat(Math.min(Math.ceil(this.dungeon.stars / 1000), 5))} (${this.dungeon.stars.toLocaleString()})`, 'loot');
    this.renderer.print('');
    this.renderer.print(`  Rooms explored: ${this.exploredRooms.size} / ${this.dungeon.totalRooms}`, 'bright');
    this.renderer.print(`  Progress: ${Math.round(this.exploredRooms.size / this.dungeon.totalRooms * 100)}%`);
    this.renderer.print(`  Loot found: ${this.discoveredLoot.length}`, 'loot');
    this.renderer.print(`  Portals discovered: ${this.discoveredPortals.length}`, 'info');
    this.renderer.print(`  Steps taken: ${this.visitHistory.length}`);
    this.renderer.print('');

    // progress bar
    const pct = this.exploredRooms.size / this.dungeon.totalRooms;
    const barLen = 30;
    const filled = Math.round(pct * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    this.renderer.print(`  [${bar}]`, pct === 1 ? 'loot' : 'bright');
    this.renderer.print('');
  }

  async cmdSearch() {
    if (!this.currentRoom) return;

    const files = this.currentRoom.items.filter(i => !i.examined);
    if (files.length === 0) {
      this.renderer.print('You\'ve already examined everything in this room.', 'dim');
      return;
    }

    this.renderer.print('');
    this.renderer.print('Searching for loot...', 'info');

    let totalLoot = 0;
    for (const item of files) {
      const filePath = item.sourceFile || item.path;
      if (!filePath) continue;
      try {
        let content = this.examineCache.get(filePath);
        if (!content) {
          content = await github.fetchFile(this.repoOwner, this.repoName, filePath);
          if (content) this.examineCache.set(filePath, content);
        }
        if (!content) continue;

        const loot = findLoot(content, item.name);
        if (loot.length > 0) {
          item.examined = true;
          this.renderer.print(`  ${item.name}:`, 'bright');
          for (const l of loot) {
            this.renderer.print(`    [${l.type}] Line ${l.line}: ${l.message}`, 'loot');
            this.discoveredLoot.push(l);
            totalLoot++;
          }
        }
      } catch (_) {}
    }

    if (totalLoot === 0) {
      this.renderer.print('  No loot found in this room.', 'dim');
    } else {
      this.renderer.print(`  Found ${totalLoot} piece${totalLoot > 1 ? 's' : ''} of loot!`, 'loot');
    }
    this.renderer.print('');
  }

  cmdPortals() {
    if (this.discoveredPortals.length === 0) {
      this.renderer.print('No portals discovered yet. Examine files to find them.', 'dim');
      return;
    }

    this.renderer.print('');
    this.renderer.print('Discovered portals:', 'info');
    for (const p of this.discoveredPortals) {
      const icon = p.type === 'local' ? '→' : '⟶';
      this.renderer.print(`  ${icon} ${p.target} (${p.type})`, p.type === 'local' ? 'info' : 'dim');
    }
    this.renderer.print('');
  }

  cmdBack() {
    if (this.visitHistory.length === 0) {
      this.renderer.print('You\'re at the entrance. Nowhere to go back to.', 'dim');
      return;
    }
    const prevPath = this.visitHistory.pop();
    // don't push to history again
    this.currentRoom = null;
    this.enterRoom(prevPath);
    // remove the duplicate from enterRoom's push
    this.visitHistory.pop();
  }

  cmdHistory() {
    if (this.visitHistory.length === 0) {
      this.renderer.print('You haven\'t been anywhere yet.', 'dim');
      return;
    }
    this.renderer.print('');
    this.renderer.print('Rooms visited:', 'info');
    const recent = this.visitHistory.slice(-15);
    for (const path of recent) {
      const room = this.dungeon.rooms.get(path);
      this.renderer.print(`  ${room?.name || path}  ${path}`, 'dim');
    }
    if (this.visitHistory.length > 15) {
      this.renderer.print(`  ... and ${this.visitHistory.length - 15} more`, 'muted');
    }
    this.renderer.print('');
  }

  cmdQuit() {
    this.renderer.print('');
    this.renderer.print('You retreat to the entrance...', 'dim');
    this.renderer.print('');
    this.dungeon = null;
    this.currentRoom = null;
    this.visitHistory = [];
    this.exploredRooms.clear();
    this.discoveredLoot = [];
    this.discoveredPortals = [];
    this.examineCache.clear();
    this.state = 'menu';
    this.showWelcome();
  }
}

/**
 * Find the relevant code around a route handler definition
 */
function findRelevantCode(content, method, routePath) {
  const lines = content.split('\n');
  const results = [];

  // find the line that defines this route
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    if (lowerLine.includes(method.toLowerCase()) && line.includes(routePath)) {
      // grab context: 2 lines before, the match, and up to 15 lines of the handler
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 15);
      for (let j = start; j < end; j++) {
        results.push(lines[j]);
      }
      break;
    }
  }

  return results.slice(0, 20);
}
