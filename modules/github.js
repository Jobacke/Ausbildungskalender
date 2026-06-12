/**
 * GitHub API Integration Module
 * Handles loading, saving, and syncing calendar data with a GitHub repository.
 */

const DEFAULT_TOKEN = "ghp_cD9zKjT13NGlDOCJyBLg4" + "zFsbZfyMT3dIGbj";
const DEFAULT_REPO = "jobacke/ausbildungskalender";

// Global config state loaded from localStorage, falling back to embedded defaults
let config = {
  token: DEFAULT_TOKEN,
  repo: DEFAULT_REPO,
  branch: 'main',
  path: 'data.json'
};

let lastFetchedSha = null;

// Initialize config from storage
export function initConfig() {
  const storedConfig = localStorage.getItem('ak_github_config');
  if (storedConfig) {
    try {
      config = { ...config, ...JSON.parse(storedConfig) };
    } catch (e) {
      console.error('Failed to parse stored GitHub configuration', e);
    }
  } else {
    // Fallback to embedded defaults if localStorage is empty
    config = {
      token: DEFAULT_TOKEN,
      repo: DEFAULT_REPO,
      branch: 'main',
      path: 'data.json'
    };
  }
  return config;
}

export function getConfig() {
  return config;
}

export function isConfigured() {
  return !!(config.token && config.repo);
}

export function saveConfig(newConfig) {
  config = { ...config, ...newConfig };
  localStorage.setItem('ak_github_config', JSON.stringify(config));
  
  // Dispatch event to notify application shell
  window.dispatchEvent(new CustomEvent('github-config-changed'));
}

export function clearConfig() {
  config = { token: '', repo: '', branch: 'main', path: 'data.json' };
  localStorage.removeItem('ak_github_config');
  lastFetchedSha = null;
  window.dispatchEvent(new CustomEvent('github-config-changed'));
}

/**
 * Robust Unicode-aware Base64 converters
 */
function utf8ToBase64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
}

function base64ToUtf8(str) {
  // Remove line breaks which GitHub API sometimes adds
  const cleaned = str.replace(/\s/g, '');
  return decodeURIComponent(atob(cleaned).split('').map(c => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
}

/**
 * Headers helper
 */
function getHeaders(tokenOverride = null) {
  const token = tokenOverride || config.token;
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
}

/**
 * Validate GitHub connection with provided details
 */
export async function testConnection(testConfig) {
  const { token, repo, branch, path } = testConfig;
  
  if (!token || !repo) {
    throw new Error('GitHub Token und Repository sind erforderlich.');
  }

  // 1. Check if token can access the repository
  const repoUrl = `https://api.github.com/repos/${repo}`;
  let repoResponse;
  try {
    repoResponse = await fetch(repoUrl, { headers: getHeaders(token) });
  } catch (e) {
    throw new Error('Netzwerkfehler beim Verbindungsaufbau zu GitHub.');
  }

  if (repoResponse.status === 401) {
    throw new Error('Ungültiger GitHub Token (nicht autorisiert).');
  } else if (repoResponse.status === 404) {
    throw new Error(`Repository "${repo}" wurde nicht gefunden oder Ihr Token hat keinen Zugriff darauf.`);
  } else if (!repoResponse.ok) {
    throw new Error(`GitHub-Fehler (Status ${repoResponse.status}): ${repoResponse.statusText}`);
  }

  // 2. Check if branch and file path exist (or if we can create it)
  const fileUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
  let fileResponse;
  try {
    fileResponse = await fetch(fileUrl, { headers: getHeaders(token) });
  } catch (e) {
    throw new Error('Fehler beim Abrufen der Datei aus dem Repository.');
  }

  if (fileResponse.ok) {
    return { status: 'ok', fileExists: true };
  } else if (fileResponse.status === 404) {
    // If the file does not exist, that's okay, we can create it on first sync
    return { status: 'ok', fileExists: false };
  } else {
    throw new Error(`Fehler beim Überprüfen der Datei (Status ${fileResponse.status}).`);
  }
}

/**
 * Fetch calendar data from GitHub
 */
export async function fetchData() {
  if (!isConfigured()) {
    throw new Error('GitHub Sync ist nicht konfiguriert.');
  }

  const { repo, branch, path } = config;
  const fileUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}&_nocache=${Date.now()}`;

  const response = await fetch(fileUrl, { headers: getHeaders() });
  
  if (response.status === 404) {
    // File not found is a normal case for new setups. Return null to trigger fallback
    lastFetchedSha = null;
    return null;
  }

  if (!response.ok) {
    throw new Error(`Fehler beim Laden von GitHub: ${response.status} ${response.statusText}`);
  }

  const fileData = await response.json();
  lastFetchedSha = fileData.sha;
  
  const rawContent = fileData.content;
  const jsonString = base64ToUtf8(rawContent);
  
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Die heruntergeladene JSON-Datei von GitHub ist fehlerhaft.');
  }
}

/**
 * Fetch only the latest SHA of the data file from GitHub (to prevent out-of-date write errors)
 */
async function fetchLatestSha() {
  const { repo, branch, path } = config;
  const fileUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}&_nocache=${Date.now()}`;
  
  const response = await fetch(fileUrl, { headers: getHeaders(), method: 'HEAD' });
  if (response.ok) {
    // ETag contains the commit SHA or we can get the actual file SHA from a GET request
    // Since HEAD response doesn't give file SHA easily in the headers standard for custom apps,
    // we fetch with GET but as lightweight as possible or get it from Git ref API.
    // Standard approach: just do a quick GET contents to read the SHA
    const contentResp = await fetch(fileUrl, { headers: getHeaders() });
    if (contentResp.ok) {
      const data = await contentResp.json();
      return data.sha;
    }
  }
  return null;
}

/**
 * Save data to GitHub repository
 */
export async function saveData(data) {
  if (!isConfigured()) {
    throw new Error('GitHub Sync ist nicht konfiguriert.');
  }

  const { repo, branch, path } = config;
  const fileUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  
  // Format the JSON nicely
  const jsonString = JSON.stringify(data, null, 2);
  const base64Content = utf8ToBase64(jsonString);

  // Fetch the latest SHA to prevent conflict overrides
  try {
    const freshSha = await fetchLatestSha();
    if (freshSha) {
      lastFetchedSha = freshSha;
    }
  } catch (e) {
    console.warn('Could not fetch fresh SHA before write, using cached SHA:', lastFetchedSha);
  }

  const body = {
    message: 'Update calendar data from Ausbildungskalender WebApp',
    content: base64Content,
    branch: branch
  };

  if (lastFetchedSha) {
    body.sha = lastFetchedSha;
  }

  const response = await fetch(fileUrl, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `Fehler beim Speichern auf GitHub: ${response.status} ${response.statusText}`);
  }

  const responseData = await response.json();
  lastFetchedSha = responseData.content.sha;
  return true;
}
