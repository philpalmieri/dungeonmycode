/**
 * GitHub API client — fetches repo trees, file contents, metadata.
 * Uses unauthenticated API (60 req/hr) for public repos.
 */

const API = 'https://api.github.com';

let authToken = null;

export function setToken(token) {
  authToken = token;
}

function headers() {
  const h = { 'Accept': 'application/vnd.github.v3+json' };
  if (authToken) h['Authorization'] = `token ${authToken}`;
  return h;
}

/**
 * Parse a GitHub URL or owner/repo string into { owner, repo }
 */
export function parseRepo(input) {
  input = input.trim().replace(/\/+$/, '');

  // full URL: https://github.com/owner/repo
  const urlMatch = input.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace('.git', '') };

  // shorthand: owner/repo
  const shortMatch = input.match(/^([^\/]+)\/([^\/]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };

  return null;
}

/**
 * Fetch repo metadata
 */
export async function fetchRepoInfo(owner, repo) {
  const res = await fetch(`${API}/repos/${owner}/${repo}`, { headers: headers() });
  if (!res.ok) throw new Error(`Repo not found: ${owner}/${repo} (${res.status})`);
  return res.json();
}

/**
 * Fetch the full recursive file tree
 */
export async function fetchTree(owner, repo, branch = 'main') {
  // try the given branch, fall back to master
  let res = await fetch(
    `${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: headers() }
  );
  if (!res.ok && branch === 'main') {
    res = await fetch(
      `${API}/repos/${owner}/${repo}/git/trees/master?recursive=1`,
      { headers: headers() }
    );
  }
  if (!res.ok) throw new Error(`Could not fetch tree (${res.status})`);
  return res.json();
}

/**
 * Fetch a single file's contents (decoded from base64)
 */
export async function fetchFile(owner, repo, path) {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path}`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.encoding === 'base64') {
    return atob(data.content);
  }
  return data.content || '';
}

/**
 * Fetch contributors (NPCs)
 */
export async function fetchContributors(owner, repo) {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contributors?per_page=20`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  return res.json();
}

/**
 * Fetch languages (biome theming)
 */
export async function fetchLanguages(owner, repo) {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/languages`,
    { headers: headers() }
  );
  if (!res.ok) return {};
  return res.json();
}

/**
 * Check remaining rate limit
 */
export async function checkRateLimit() {
  const res = await fetch(`${API}/rate_limit`, { headers: headers() });
  const data = await res.json();
  return data.rate;
}
