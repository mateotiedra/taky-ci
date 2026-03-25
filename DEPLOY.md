# Deployment Guide

## Prerequisites

- Node.js 22+ installed on the VPS
- Claude Code CLI installed and authenticated on the VPS
- `gh` CLI authenticated for GitHub PR creation
- Access to Linear workspace admin (for webhook setup)

## Steps

### 1. Install dependencies and build

```bash
cd ~/Codes/meky/meky-ci
pnpm install
pnpm build
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|----------|-------------|
| `LINEAR_WEBHOOK_SECRET` | Secret from Linear webhook settings |
| `CLAUDE_BOT_USER_ID` | Linear user ID of the bot account |
| `TAKY_CI_PORT` | Port for the webhook server (default: `4177`) |
| `TAKY_CI_MAX_CONCURRENT` | Max concurrent pipelines (default: `1`) |
| `TAKY_CI_LOG_DIR` | Log directory (default: `~/.claude/ci-logs`) |
| `TAKY_CI_CONFIG` | Path to config file (default: `./taky-ci.config.js`) |

### 3. Configure projects

```bash
cp taky-ci.config.example.ts taky-ci.config.ts
```

Edit `taky-ci.config.ts` to define your projects. Each project needs:
- `repoPath` — absolute path to the repo working directory
- `teamKeys` — Linear team key(s) that route to this project
- `skills` — slash commands or prompts for review, fix, test, and commit

See `taky-ci.config.example.ts` for all available options.

**Note:** The config file is TypeScript and gets compiled with the project. After editing, run `pnpm build` again.

### 4. Create Linear bot user

1. Go to Linear workspace settings > Members
2. Invite or create a user for the bot (e.g. "Claude Bot")
3. Copy the user ID from the member's profile URL or API
4. Set `CLAUDE_BOT_USER_ID` in `.env`

### 5. Install systemd service

```bash
sudo cp taky-ci.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now taky-ci
```

Check status:

```bash
sudo systemctl status taky-ci
sudo journalctl -u taky-ci -f
```

### 6. Set up reverse proxy

Configure Dokploy (or nginx) to route a public URL to port 4177:

- Example: `https://ci.meky.ch/webhook/linear` -> `localhost:4177`

### 7. Configure Linear webhook

1. Go to Linear workspace settings > API > Webhooks
2. Click "New webhook"
3. URL: `https://ci.meky.ch/webhook/linear`
4. Set a signing secret (same value as `LINEAR_WEBHOOK_SECRET` in `.env`)
5. Subscribe to: **Issues** (create, update)
6. Save

### 8. Test

Create a Linear issue and either:
- Assign it to the Claude Bot user, or
- Include `@claude` in the description

Watch logs:

```bash
sudo journalctl -u taky-ci -f
ls ~/.claude/ci-logs/
```

## Triggers

The pipeline fires when either condition is met:

| Trigger | Event |
|---------|-------|
| Assigned to bot | Issue created or updated with assignee matching `CLAUDE_BOT_USER_ID` |
| @claude mention | Issue created or updated with `@claude` in description |

Issues are routed to projects by matching the Linear team key against `teamKeys` in the config.

## Pipeline flow

1. **Intake:** Fetch issue details, move to "In Progress", post comment
2. **Implement:** Create branch, implement feature (configurable model/budget/timeout)
3. **Review:** Review + fix loop (configurable iterations, skippable)
4. **Test:** Visual/browser test (configurable attempts, skippable)
5. **Finalize:** Push branch, create PR, move to "In Review"

Phases can be customized per project via the `phases` array in config.

## Safety limits

Defaults (overridable per project in config):

| Limit | Default |
|-------|---------|
| Review+fix iterations | 3 |
| Test attempts | 2 |
| Test-fix-review resets | 2 |
| Per-phase budget | $0.50-$5 |
| Per-phase timeout | 3-20 min |
| Concurrent pipelines | 1 |
| Queue size | 5 |

## Troubleshooting

- **Logs:** `~/.claude/ci-logs/pipeline-{issueId}-{timestamp}.log`
- **Service logs:** `sudo journalctl -u taky-ci -f`
- **Restart:** `sudo systemctl restart taky-ci`
- **Rebuild:** `pnpm build && sudo systemctl restart taky-ci`

## Updating the systemd service file

If you change `taky-ci.service`, re-copy and reload:

```bash
sudo cp taky-ci.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart taky-ci
```
