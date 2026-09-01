import { config, assertConfig } from "./config.mjs";
import { GithubClient } from "./github.mjs";
import { OpenCodeClient, fallbackFreeModels, isRotationError } from "./opencode.mjs";
import { StateStore } from "./state-store.mjs";
import { TelegramClient, splitTelegramMessage } from "./telegram.mjs";

assertConfig();

const telegram = new TelegramClient(config.telegramToken);
const github = new GithubClient(config.githubToken, config.githubRepository);
const store = new StateStore({
  stateFile: config.stateFile,
  encryptionKey: config.stateEncryptionKey,
  github
});
const openCode = new OpenCodeClient(config.openCodeBaseUrl);
const pending = new Map();
let offset = 0;
let stopping = false;

function userIdOf(message) {
  return String(message.from?.id ?? "");
}

function userRecord(state, userId) {
  if (!state.users[userId]) {
    state.users[userId] = {
      tokens: [],
      activeTokenId: null,
      model: fallbackFreeModels[0].id,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  }
  state.users[userId].lastSeenAt = new Date().toISOString();
  return state.users[userId];
}

async function saveState(state) {
  await store.save(state);
}

function tokenPreview(token) {
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function addToken(userId, value, label = "OpenCode Zen") {
  const token = value.trim();
  if (token.length < 12 || token.length > 300 || /\s/.test(token)) {
    throw new Error("Token terlihat tidak valid. Kirim token OpenCode Zen tanpa spasi.");
  }
  const state = await store.load();
  const user = userRecord(state, userId);
  const existing = user.tokens.find((item) => item.value === token);
  if (existing) {
    user.activeTokenId = existing.id;
    existing.status = "active";
    await saveState(state);
    return existing;
  }
  const created = {
    id: `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.slice(0, 40),
    value: token,
    status: "active",
    uses: 0,
    addedAt: new Date().toISOString()
  };
  user.tokens.push(created);
  user.activeTokenId = created.id;
  await saveState(state);
  return created;
}

async function removeToken(userId, tokenId) {
  const state = await store.load();
  const user = userRecord(state, userId);
  const before = user.tokens.length;
  user.tokens = user.tokens.filter((item) => item.id !== tokenId);
  if (user.activeTokenId === tokenId) user.activeTokenId = user.tokens[0]?.id ?? null;
  if (user.tokens.length === before) return false;
  await saveState(state);
  return true;
}

async function withRotatingToken(userId, operation) {
  const state = await store.load();
  const user = userRecord(state, userId);
  const ordered = [...user.tokens].sort((a, b) => {
    if (a.id === user.activeTokenId) return -1;
    if (b.id === user.activeTokenId) return 1;
    return new Date(a.addedAt) - new Date(b.addedAt);
  });
  if (!ordered.length) throw new Error("Belum ada token. Gunakan /addtoken untuk menambahkan token OpenCode Zen.");
  let lastRotationError;
  for (const item of ordered) {
    try {
      const result = await operation(item.value, item);
      item.status = "active";
      item.lastUsedAt = new Date().toISOString();
      item.uses = (item.uses ?? 0) + 1;
      user.activeTokenId = item.id;
      await saveState(state);
      return result;
    } catch (error) {
      if (!isRotationError(error.status, error.body)) throw error;
      item.status = "limited";
      item.lastError = new Date().toISOString();
      lastRotationError = error;
      await saveState(state);
    }
  }
  throw new Error(`Semua token sedang limit atau tidak punya kredit. Tambahkan token baru dengan /addtoken.${lastRotationError ? ` (${lastRotationError.message})` : ""}`);
}

async function currentModels(userId) {
  return withRotatingToken(userId, (token) => openCode.listModels(token));
}

async function ask(userId, prompt) {
  const state = await store.load();
  const user = userRecord(state, userId);
  return withRotatingToken(userId, (token) =>
    openCode.complete(token, {
      model: user.model,
      system:
        "You are a concise coding assistant inside Telegram. Give practical answers, use Markdown, " +
        "and never claim to have edited a repository unless a repository action was actually completed.",
      prompt,
      maxOutputTokens: 3500
    })
  );
}

function safeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";
}

function parseGeneratedJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model tidak mengembalikan format project yang valid.");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function buildProject(userId, request) {
  if (!github.enabled) {
    throw new Error("Generator project membutuhkan GITHUB_TOKEN dan GITHUB_REPOSITORY agar hasil bisa di-commit.");
  }
  const state = await store.load();
  const user = userRecord(state, userId);
  const result = await withRotatingToken(userId, (token) =>
    openCode.complete(token, {
      model: user.model,
      system:
        "You are a repository generator. Return ONLY valid JSON with this shape: " +
        '{"name":"short-project-name","summary":"one sentence","files":[{"path":"README.md","content":"..."}]}. ' +
        "Generate a small runnable project from the user request. Paths must be relative, safe, and under src or the project root. " +
        "Do not include secrets, credentials, binary files, node_modules, or lockfiles. Keep files concise.",
      prompt: request,
      maxOutputTokens: 7000
    })
  );
  const project = parseGeneratedJson(result);
  const name = safeSlug(project.name);
  const files = Array.isArray(project.files) ? project.files.slice(0, config.maxGeneratedFiles) : [];
  if (!files.length) throw new Error("Project generator tidak menghasilkan file.");
  const invalid = files.find((file) => {
    const relative = String(file.path ?? "");
    return !relative || relative.startsWith("/") || relative.includes("..") || relative.includes("\\") ||
      Buffer.byteLength(String(file.content ?? ""), "utf8") > config.maxGeneratedFileBytes;
  });
  if (invalid) throw new Error("Model menghasilkan path atau file yang tidak aman; commit dibatalkan.");
  const prefix = `generated-projects/${name}`;
  for (const file of files) {
    await github.writeFile(`${prefix}/${file.path}`, String(file.content ?? ""), `feat: generate ${name}`);
  }
  await github.writeFile(
    `${prefix}/.opencode-generation.json`,
    JSON.stringify({ request, summary: project.summary ?? "", generatedAt: new Date().toISOString(), files: files.map((file) => file.path) }, null, 2),
    `chore: record ${name} generation`
  );
  return { name, summary: project.summary ?? "Project berhasil dibuat.", url: `${github.repositoryUrl()}/tree/main/${prefix}` };
}

function helpText() {
  return [
    "OpenCode Telegram Bot",
    "",
    "/start — mulai dan tambahkan token OpenCode Zen",
    "/addtoken — tambah token API baru",
    "/tokens — lihat token tersimpan dan status rotasi",
    "/models — lihat model yang tersedia",
    "/model <id> — pilih model",
    "/use <id> — jadikan token aktif",
    "/remove <id> — hapus token",
    "/build <deskripsi> — generate project dan commit ke repository",
    "/status — status sesi bot dan repository",
    "/stop — hentikan sesi saat ini",
    "",
    "Kirim pertanyaan coding biasa untuk mulai vibe coding."
  ].join("\n");
}

async function reply(chatId, text, options = {}) {
  for (const chunk of splitTelegramMessage(text)) await telegram.sendMessage(chatId, chunk, options);
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const userId = userIdOf(message);
  const text = message.text?.trim();
  if (!chatId || !userId || !text) return;
  if (message.chat.type !== "private") {
    await reply(chatId, "Demi keamanan token API, gunakan bot ini lewat chat pribadi.");
    return;
  }
  const pendingAction = pending.get(userId);
  if (pendingAction) {
    pending.delete(userId);
    await telegram.deleteMessage(chatId, message.message_id);
    if (pendingAction === "token") {
      try {
        const token = await addToken(userId, text);
        await reply(chatId, `Token ${tokenPreview(token.value)} tersimpan dan langsung aktif. Token disimpan terenkripsi.`);
      } catch (error) {
        await reply(chatId, error.message);
      }
    }
    return;
  }

  const [command, ...args] = text.split(/\s+/);
  const value = args.join(" ").trim();
  try {
    if (command === "/start" || command === "/addtoken") {
      pending.set(userId, "token");
      await reply(chatId, "Kirim token OpenCode Zen sekarang. Pesan token akan dihapus setelah diterima.");
      return;
    }
    if (command === "/help") {
      await reply(chatId, helpText());
      return;
    }
    if (command === "/tokens") {
      const state = await store.load();
      const user = userRecord(state, userId);
      if (!user.tokens.length) return reply(chatId, "Belum ada token. Gunakan /addtoken.");
      await reply(chatId, user.tokens.map((token, index) =>
        `${index + 1}. ${token.id} — ${tokenPreview(token.value)} — ${token.status}${token.id === user.activeTokenId ? " — aktif" : ""}`
      ).join("\n"));
      return;
    }
    if (command === "/models") {
      const models = await currentModels(userId);
      await reply(chatId, models.slice(0, 30).map((model) => `${model.id}${model.free ? " — free" : ""}`).join("\n"));
      return;
    }
    if (command === "/model") {
      if (!value) return reply(chatId, "Contoh: /model big-pickle");
      const state = await store.load();
      const user = userRecord(state, userId);
      user.model = value;
      await saveState(state);
      await reply(chatId, `Model aktif diubah ke ${value}.`);
      return;
    }
    if (command === "/use") {
      const state = await store.load();
      const user = userRecord(state, userId);
      const token = user.tokens.find((item) => item.id === value);
      if (!token) return reply(chatId, "ID token tidak ditemukan. Lihat daftar dengan /tokens.");
      user.activeTokenId = token.id;
      token.status = "active";
      await saveState(state);
      await reply(chatId, `Token ${tokenPreview(token.value)} sekarang aktif.`);
      return;
    }
    if (command === "/remove") {
      if (!value) return reply(chatId, "Contoh: /remove key-...");
      await reply(chatId, (await removeToken(userId, value)) ? "Token dihapus." : "ID token tidak ditemukan.");
      return;
    }
    if (command === "/status") {
      const state = await store.load();
      const user = userRecord(state, userId);
      const remaining = Math.max(0, config.sessionMinutes * 60_000 - (Date.now() - startedAt));
      await reply(chatId, [
        `Sesi aktif: sekitar ${Math.ceil(remaining / 60_000)} menit tersisa`,
        `Token: ${user.tokens.length}`,
        `Model: ${user.model}`,
        `Persistensi terenkripsi: ${config.stateEncryptionKey ? "aktif" : "tidak aktif"}`,
        `Repository: ${github.enabled ? github.repositoryUrl() : "belum terhubung"}`
      ].join("\n"));
      return;
    }
    if (command === "/build") {
      if (!value) return reply(chatId, "Contoh: /build bot Discord untuk notifikasi deploy dari GitHub");
      await reply(chatId, "Saya sedang membuat project dan menulis file hasilnya ke repository. Tunggu sebentar.");
      const result = await buildProject(userId, value);
      await reply(chatId, `Project ${result.name} selesai.\n${result.summary}\n${result.url}`);
      return;
    }
    if (command === "/stop") {
      await reply(chatId, "Sesi akan dihentikan. Workflow GitHub Actions berikutnya akan memulai sesi baru.");
      stopping = true;
      return;
    }
    await telegram.typing(chatId);
    const answer = await ask(userId, text);
    await reply(chatId, answer);
  } catch (error) {
    await reply(chatId, `Gagal: ${error.message}`);
  }
}

const startedAt = Date.now();
const stopAt = startedAt + config.sessionMinutes * 60_000;

async function run() {
  await telegram.call("deleteWebhook", { drop_pending_updates: false });
  await telegram.call("getMe");
  await reply(config.adminUserIds.values().next().value, `Bot aktif selama ${config.sessionMinutes} menit.`).catch(() => {});
  while (!stopping && Date.now() < stopAt) {
    try {
      const updates = await telegram.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleMessage(update.message);
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

run().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});