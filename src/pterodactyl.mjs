function panelUrl(value) {
  return value.replace(/\/+$/, "");
}

export async function createPterodactylServer({
  panel,
  applicationApiKey,
  name = "OpenCode Telegram Bot",
  nodeId,
  allocationId,
  dockerImage = "ghcr.io/parkervcp/yolks:nodejs_22",
  memoryMb = 512,
  diskMb = 2048,
  cpuPercent = 100,
  repositoryUrl,
  telegramToken,
  stateEncryptionKey
}) {
  if (!panel || !applicationApiKey || !nodeId || !allocationId || !repositoryUrl) {
    throw new Error("Pterodactyl deployment requires panel, application key, node ID, allocation ID, and repository URL.");
  }
  const response = await fetch(`${panelUrl(panel)}/api/application/servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${applicationApiKey}`,
      Accept: "Application/vnd.pterodactyl.v1+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      user: 1,
      nest: 1,
      egg: 1,
      docker_image: dockerImage,
      startup: "npm start",
      environment: {
        GITHUB_REPOSITORY: repositoryUrl.replace(/^https:\/\/github.com\//, ""),
        TELEGRAM_BOT_TOKEN: telegramToken,
        STATE_ENCRYPTION_KEY: stateEncryptionKey
      },
      limits: { memory: memoryMb, swap: 0, disk: diskMb, io: 500, cpu: cpuPercent },
      feature_limits: { databases: 0, backups: 1, allocations: 1 },
      deploy: { locations: [], dedicated_ip: false, port_range: [] },
      allocation: { default: allocationId },
      node: nodeId
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Pterodactyl API ${response.status}: ${body?.errors?.[0]?.detail ?? "request failed"}`);
  return body;
}