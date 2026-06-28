/**
 * App Analyzer — detects what kind of application a repo is and extracts
 * its logical structure (routes, commands, models, flows).
 *
 * This replaces raw file-tree navigation with conceptual navigation.
 */

import * as github from './github.js';

/**
 * Detect the app type from package.json, go.mod, Cargo.toml, etc.
 */
export async function detectAppType(owner, repo, tree, languages) {
  const fileNames = new Set(tree.tree.map(t => t.path.split('/').pop()));
  const filePaths = tree.tree.map(t => t.path);

  // check for framework indicators
  const pkg = await github.fetchFile(owner, repo, 'package.json').catch(() => null);
  const goMod = await github.fetchFile(owner, repo, 'go.mod').catch(() => null);
  const requirements = await github.fetchFile(owner, repo, 'requirements.txt').catch(() => null);
  const pyproject = await github.fetchFile(owner, repo, 'pyproject.toml').catch(() => null);

  const indicators = {
    deps: pkg ? JSON.parse(pkg).dependencies || {} : {},
    devDeps: pkg ? JSON.parse(pkg).devDependencies || {} : {},
    scripts: pkg ? JSON.parse(pkg).scripts || {} : {},
    bin: pkg ? JSON.parse(pkg).bin || null : null,
    main: pkg ? JSON.parse(pkg).main || null : null,
    filePaths,
    fileNames,
    languages: Object.keys(languages || {}),
    goMod,
    requirements,
    pyproject,
  };

  // score each app type
  const scores = {
    'rest-api': scoreRestApi(indicators),
    'cli': scoreCli(indicators),
    'frontend': scoreFrontend(indicators),
    'library': scoreLibrary(indicators),
    'fullstack': scoreFullstack(indicators),
  };

  const detected = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { type: detected[0], confidence: detected[1], indicators };
}

function scoreRestApi(ind) {
  let score = 0;
  const deps = { ...ind.deps, ...ind.devDeps };

  // Node.js REST frameworks
  if (deps.express || deps.fastify || deps.koa || deps.hapi || deps['@nestjs/core']) score += 5;
  if (deps['body-parser'] || deps.cors || deps.helmet) score += 2;

  // Python REST
  if (ind.requirements?.includes('flask') || ind.requirements?.includes('fastapi') || ind.requirements?.includes('django')) score += 5;
  if (ind.pyproject?.includes('fastapi') || ind.pyproject?.includes('flask')) score += 5;

  // Go REST
  if (ind.goMod?.includes('gin-gonic') || ind.goMod?.includes('gorilla/mux') || ind.goMod?.includes('chi')) score += 5;

  // route-like file patterns
  const routeFiles = ind.filePaths.filter(p => /route|controller|endpoint|handler|api/i.test(p));
  score += Math.min(routeFiles.length, 5);

  // middleware patterns
  const mwFiles = ind.filePaths.filter(p => /middleware/i.test(p));
  score += Math.min(mwFiles.length * 2, 4);

  return score;
}

function scoreCli(ind) {
  let score = 0;
  const deps = { ...ind.deps, ...ind.devDeps };

  if (ind.bin) score += 5;
  if (deps.commander || deps.yargs || deps.meow || deps.inquirer || deps.chalk) score += 3;
  if (deps['@oclif/core'] || deps.vorpal || deps.caporal) score += 5;

  // Go CLI
  if (ind.goMod?.includes('cobra') || ind.goMod?.includes('urfave/cli')) score += 5;

  // Python CLI
  if (ind.requirements?.includes('click') || ind.requirements?.includes('typer') || ind.requirements?.includes('argparse')) score += 4;

  // cmd/ directory pattern (Go)
  const cmdFiles = ind.filePaths.filter(p => p.startsWith('cmd/'));
  score += Math.min(cmdFiles.length, 4);

  if (ind.scripts?.start && /node\s+.*cli|bin/.test(ind.scripts.start)) score += 2;

  return score;
}

function scoreFrontend(ind) {
  let score = 0;
  const deps = { ...ind.deps, ...ind.devDeps };

  if (deps.react || deps.vue || deps.svelte || deps['@angular/core'] || deps.next || deps.nuxt) score += 5;
  if (deps.webpack || deps.vite || deps.parcel || deps.rollup) score += 2;
  if (ind.fileNames.has('index.html') || ind.filePaths.some(p => /pages|views|components/i.test(p))) score += 2;

  return score;
}

function scoreLibrary(ind) {
  let score = 0;

  if (ind.main && !ind.bin) score += 3;
  if (ind.filePaths.some(p => p === 'index.js' || p === 'index.ts' || p === 'lib/index.js')) score += 2;
  if (!ind.scripts?.start && !ind.scripts?.dev) score += 2;

  const hasTests = ind.filePaths.some(p => /test|spec|__tests__/i.test(p));
  const hasSrc = ind.filePaths.some(p => p.startsWith('src/'));
  if (hasTests && hasSrc && !ind.bin) score += 2;

  return score;
}

function scoreFullstack(ind) {
  let score = 0;
  const deps = { ...ind.deps, ...ind.devDeps };

  const hasApi = ind.filePaths.some(p => /api|server|backend/i.test(p));
  const hasFrontend = deps.react || deps.vue || deps.svelte;
  if (hasApi && hasFrontend) score += 5;

  if (ind.filePaths.some(p => p.startsWith('client/') || p.startsWith('frontend/'))) score += 3;
  if (ind.filePaths.some(p => p.startsWith('server/') || p.startsWith('backend/'))) score += 3;

  return score;
}

/**
 * Extract REST API routes from source files
 */
export async function extractRoutes(owner, repo, tree) {
  const routeFiles = tree.tree.filter(t =>
    t.type === 'blob' &&
    /route|controller|endpoint|handler|api|router|app\.(js|ts|py)|main\.(go|py)|server\.(js|ts)/i.test(t.path) &&
    !/node_modules|vendor|dist|build|\.test\.|\.spec\.|__test/i.test(t.path)
  ).slice(0, 25); // cap API calls

  const routes = [];
  const middleware = [];
  const models = new Set();

  for (const file of routeFiles) {
    const content = await github.fetchFile(owner, repo, file.path);
    if (!content) continue;

    // Express/Fastify/Koa style routes
    const expressPatterns = [
      /(?:app|router|server)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      /(?:app|router|server)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)['"`].*?(?:\/\/|\/\*)\s*(.+?)(?:\*\/|\n)/gi,
    ];

    // Flask/FastAPI style
    const pythonPatterns = [
      /@(?:app|router|api|blueprint)\.(get|post|put|patch|delete|route)\s*\(\s*['"]([^'"]+)['"]/gi,
      /path\s*\(\s*['"]([^'"]+)['"].*?(?:name\s*=\s*['"]([^'"]+)['"])?/gi,
    ];

    // Go style (gin, chi, mux)
    const goPatterns = [
      /(?:r|router|g|group|e)\.(GET|POST|PUT|PATCH|DELETE|Handle|HandleFunc)\s*\(\s*["']([^"']+)["']/gi,
      /\.Route\s*\(\s*["']([^"']+)["']/gi,
    ];

    // NestJS decorators
    const nestPatterns = [
      /@(Get|Post|Put|Patch|Delete)\s*\(\s*['"]?([^'")\s]*)['"]?\s*\)/gi,
      /@Controller\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
    ];

    const allPatterns = [...expressPatterns, ...pythonPatterns, ...goPatterns, ...nestPatterns];

    for (const pattern of allPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const method = match[1]?.toUpperCase() || 'GET';
        const path = match[2] || match[1];
        if (path && !path.startsWith('function')) {
          routes.push({
            method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL', 'USE'].includes(method) ? method : 'GET',
            path: path.startsWith('/') ? path : '/' + path,
            file: file.path,
            description: match[3]?.trim() || null,
          });
        }
      }
    }

    // middleware detection
    const mwPatterns = [
      /(?:app|router)\.use\s*\(\s*([a-zA-Z_$][\w$]*)/g,
      /@UseGuards?\s*\(\s*([^)]+)\)/g,
      /@Middleware\s*\(\s*([^)]+)\)/g,
    ];
    for (const pattern of mwPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        middleware.push({ name: match[1].trim(), file: file.path });
      }
    }

    // model/schema references
    const modelPatterns = [
      /(?:require|import).*?(?:models?|schemas?|entities?)\/(\w+)/gi,
      /(?:Model|Schema|Entity)\s*[<(]\s*['"]?(\w+)['"]?/gi,
    ];
    for (const pattern of modelPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        models.add(match[1]);
      }
    }
  }

  return { routes, middleware, models: [...models] };
}

/**
 * Extract CLI commands from source files
 */
export async function extractCommands(owner, repo, tree) {
  const cmdFiles = tree.tree.filter(t =>
    t.type === 'blob' &&
    (/cmd\/|commands?\/|cli/i.test(t.path) ||
     /bin\//i.test(t.path) ||
     t.path === 'index.js' || t.path === 'src/index.ts' || t.path === 'main.go') &&
    !/node_modules|vendor|dist|build|\.test\.|\.spec\./i.test(t.path)
  ).slice(0, 20);

  const commands = [];

  for (const file of cmdFiles) {
    const content = await github.fetchFile(owner, repo, file.path);
    if (!content) continue;

    // Commander.js style
    const commanderPatterns = [
      /\.command\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?\)/g,
      /\.description\s*\(\s*['"]([^'"]+)['"]\)/g,
    ];

    // Cobra (Go) style
    const cobraPatterns = [
      /&cobra\.Command\s*\{[^}]*Use:\s*["'](\w+)["'][^}]*Short:\s*["']([^"']+)["']/gs,
      /Use:\s*["'](\w+)["']/g,
    ];

    // Click/Typer (Python) style
    const clickPatterns = [
      /@(?:click\.command|app\.command|cli\.command)\s*\(\s*(?:name\s*=\s*)?['"]?(\w+)['"]?/g,
      /def\s+(\w+)\s*\([^)]*\)\s*:/g,
    ];

    // Yargs style
    const yargsPatterns = [
      /\.command\s*\(\s*['"](\w+)['"]\s*,\s*['"]([^'"]+)['"]/g,
    ];

    const allPatterns = [...commanderPatterns, ...cobraPatterns, ...clickPatterns, ...yargsPatterns];

    for (const pattern of allPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        commands.push({
          name: match[1],
          description: match[2] || null,
          file: file.path,
        });
      }
    }
  }

  // deduplicate by name
  const seen = new Set();
  return commands.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/**
 * Extract frontend pages/routes
 */
export async function extractPages(owner, repo, tree) {
  const pageFiles = tree.tree.filter(t =>
    t.type === 'blob' &&
    (/pages\/|views\/|routes\.(js|ts|jsx|tsx)/i.test(t.path) ||
     /app\/.*?\/page\.(js|ts|jsx|tsx)$/i.test(t.path)) && // Next.js app router
    !/node_modules|\.test\.|\.spec\./i.test(t.path)
  ).slice(0, 20);

  const pages = [];

  for (const file of pageFiles) {
    // Next.js / Nuxt file-based routing: path IS the route
    if (/pages\/|app\//i.test(file.path)) {
      const routePath = file.path
        .replace(/^(src\/)?(app|pages)/, '')
        .replace(/\/(page|index)\.(js|ts|jsx|tsx)$/, '')
        .replace(/\.(js|ts|jsx|tsx|vue|svelte)$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1') || '/';

      pages.push({
        path: routePath || '/',
        file: file.path,
        name: routePath.split('/').pop() || 'home',
      });
    }
  }

  // also look for react-router / vue-router definitions
  const routerFiles = tree.tree.filter(t =>
    t.type === 'blob' &&
    /route/i.test(t.path) &&
    /\.(js|ts|jsx|tsx)$/.test(t.path) &&
    !/node_modules/.test(t.path)
  ).slice(0, 5);

  for (const file of routerFiles) {
    const content = await github.fetchFile(owner, repo, file.path);
    if (!content) continue;

    const routePatterns = [
      /path:\s*['"]([^'"]+)['"]/g,
      /<Route\s+path=["']([^"']+)["']/g,
    ];

    for (const pattern of routePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        pages.push({ path: match[1], file: file.path, name: match[1].split('/').pop() || 'home' });
      }
    }
  }

  // deduplicate
  const seen = new Set();
  return pages.filter(p => {
    if (seen.has(p.path)) return false;
    seen.add(p.path);
    return true;
  });
}
