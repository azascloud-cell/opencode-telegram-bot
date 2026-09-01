const API_URL = "https://api.github.com";

export class GithubClient {
  constructor(token, repository) {
    this.token = token;
    const [owner, repo] = repository.split("/");
    this.owner = owner;
    this.repo = repo;
  }

  get enabled() {
    return Boolean(this.token && this.owner && this.repo);
  }

  async request(endpoint, options = {}) {
    if (!this.enabled) throw new Error("GitHub persistence is not configured.");
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers ?? {})
      }
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const detail = typeof body === "object" ? body?.message : body;
      throw new Error(`GitHub API ${response.status}: ${detail ?? "request failed"}`);
    }
    return body;
  }

  async readFile(filePath) {
    try {
      const result = await this.request(
        `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${filePath
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
      );
      if (Array.isArray(result) || !result?.content) return null;
      return {
        sha: result.sha,
        content: Buffer.from(result.content.replace(/\n/g, ""), "base64").toString("utf8")
      };
    } catch (error) {
      if (String(error.message).startsWith("GitHub API 404:")) return null;
      throw error;
    }
  }

  async writeFile(filePath, content, message) {
    const existing = await this.readFile(filePath);
    const body = {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(existing?.sha ? { sha: existing.sha } : {})
    };
    return this.request(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
  }

  repositoryUrl() {
    return `https://github.com/${this.owner}/${this.repo}`;
  }
}