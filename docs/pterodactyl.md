# Pterodactyl adapter

GitHub Actions is the default runtime. If a permanent host is preferred, the
repository includes a small Pterodactyl Application API adapter in
`src/pterodactyl.mjs`.

## Required values

- Panel URL, for example `https://panel.example.com`
- Pterodactyl **Application API key** with permission to create servers
- Node ID and allocation ID
- Repository name in `owner/repository` format
- `TELEGRAM_BOT_TOKEN`
- A newly generated `STATE_ENCRYPTION_KEY`

Never put any of these values in the repository. Pass them to a deployment
script or panel secret store. The adapter intentionally does not create a
server from a Telegram message, so an ordinary user cannot provision
infrastructure using the bot.

The generated server uses `npm start` and pulls the repository through the
configured GitHub environment. The egg, nest, and user IDs in the adapter are
defaults for common Node.js Pterodactyl installations; adjust them to match
the target panel before calling the function.