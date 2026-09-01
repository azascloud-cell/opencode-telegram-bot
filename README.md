# OpenCode Telegram Bot

Telegram-first vibe coding with OpenCode Zen. Users can add multiple personal
OpenCode Zen API tokens, select a model, chat with the coding assistant, and
switch to another token automatically when the current token reaches a
rate/quota limit.

The bot is designed to run without a terminal through GitHub Actions:

- one workflow starts every six hours;
- each session is capped at 5 hours 50 minutes;
- encrypted state is committed to `data/state.enc`;
- `/build <description>` asks OpenCode to generate a project and commits it
  under `generated-projects/`;
- a Pterodactyl adapter is included for a permanent-hosting option.

## 1. Create the Telegram bot

Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
Do not commit it.

## 2. Configure GitHub Actions secrets

In **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Description |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `STATE_ENCRYPTION_KEY` | Random 32-byte secret used to encrypt user tokens |

Generate a state key locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The workflow's built-in `GITHUB_TOKEN` is used for encrypted state and
generated-project commits. It is never sent to OpenCode Zen or Telegram.

## 3. Start it

Run **Actions → OpenCode Telegram Bot → Run workflow** once. The schedule then
starts a new run every six hours. The workflow has `contents: write` because
the bot must persist encrypted state and generated files in the same repository.

## Telegram commands

- `/start` or `/addtoken` — securely add a token; the token message is deleted
  after receipt
- `/tokens` — list masked token IDs and rotation status
- `/models` — show only detected free models as inline buttons
- `/model <id>` — choose a model manually
- `/use <id>` — choose the active token
- `/remove <id>` — remove a token
- `/build <description>` — generate a project and commit it
- `/status` — show session, model, token, and persistence status
- `/stop` — end the current session

Send any other private message as a coding prompt.

`401` means OpenCode Zen rejected a token (usually invalid or expired).
`429` means the token hit a rate limit. The rotation pool treats them
differently and tries the next token when appropriate.

## Security notes

- Use the bot only in a private Telegram chat. Group messages are rejected.
- User OpenCode tokens are encrypted with AES-256-GCM before persistence.
- Token values are masked in Telegram responses and never intentionally logged.
- `/build` rejects unsafe paths, oversized files, binary output, and secrets by
  instruction before committing generated files.
- Do not expose `STATE_ENCRYPTION_KEY` or the Telegram token to the model.
- GitHub Actions is not a permanent server. If continuous uptime is required,
  use the Pterodactyl adapter or another always-on host.

## Local run

```bash
cp .env.example .env
# Fill TELEGRAM_BOT_TOKEN and STATE_ENCRYPTION_KEY in .env
npm start
```

Run `npm run check` for syntax checks.

## License

MIT