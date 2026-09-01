import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const asPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const adminIds = (process.env.ADMIN_USER_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  root,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openCodeBaseUrl: (process.env.OPENCODE_ZEN_BASE_URL ?? "https://opencode.ai/zen/v1").replace(/\/+$/, ""),
  stateEncryptionKey: process.env.STATE_ENCRYPTION_KEY ?? "",
  stateFile: path.resolve(root, process.env.STATE_FILE ?? "data/state.enc"),
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubRepository: process.env.GITHUB_REPOSITORY ?? "",
  adminUserIds: new Set(adminIds),
  sessionMinutes: asPositiveInt(process.env.SESSION_MINUTES, 350),
  maxPromptLength: 12000,
  maxGeneratedFiles: 24,
  maxGeneratedFileBytes: 120_000
};

export function assertConfig() {
  const missing = [];
  if (!config.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.openCodeBaseUrl) missing.push("OPENCODE_ZEN_BASE_URL");
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
  if (config.sessionMinutes > 350) {
    throw new Error("SESSION_MINUTES cannot exceed 350 minutes.");
  }
}