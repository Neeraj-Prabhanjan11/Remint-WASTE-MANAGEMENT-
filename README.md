# Remint — Smart Waste Management

A full-stack waste recovery web application. The Value Chain is the landing page; Sort & Log, Pickups, Overview, and Impact read and update the same SQLite database. People can create their own accounts, and records are private to the account that created them.

## Run locally

Requires Node.js 22.13 or newer (the server uses the built-in `node:sqlite` module).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The development command starts both the Vite frontend and the SQLite API. For a production build, run `npm run build`, then `npm run server`.

The database is created at `data/remint.sqlite` on first run. Set `DB_PATH` to use a different SQLite file, and `PORT` to change the API port (default `4179`). No demo records are seeded; each new account starts with an empty workspace.

## Deploy for public access

### GitHub Pages frontend

Like the HACKARENA example, Remint can publish its frontend through a GitHub Actions Pages workflow. The Remint Pages URL is `https://neeraj-prabhanjan11.github.io/Remint-WASTE-MANAGEMENT-/`. The workflow builds Vite's `dist/` output, including a Pages 404 fallback for sign-in and sign-up routes.

GitHub Pages serves static files only. It cannot run Remint's Node API or database. To enable account sign-in, shared records, and the dashboard modules, first deploy the API on a separate HTTPS host with persistent storage. Then add the repository Actions variable `REMINT_API_URL` with the API's base URL (for example `https://api.example.com`), and configure that API host with `APP_ORIGIN=https://neeraj-prabhanjan11.github.io`. The API allows credentialed requests only from that exact frontend origin and uses secure cross-site session cookies in this mode. Browser privacy settings that block third-party cookies may prevent sign-in across the GitHub Pages and API domains; a same-site custom domain and reverse proxy is the most reliable production setup.

The Pages workflow runs on pushes to `main` and can also be started manually from the repository's Actions tab. Until an API URL is configured, the page displays a setup notice instead of pretending that account or database features are available.

### Single-host Docker deployment

The app includes a Docker deployment that builds the frontend and runs it with the API and SQLite database in one service. It can be deployed on a server or container host that supports Docker/Compose and persistent volumes:

```sh
docker compose up --build -d
```

The site is served on port `4179` by default; set `PORT` in the environment to change the host-side port. The SQLite database is stored in the `remint-data` Docker volume and survives container restarts and image updates. To back up the data, back up that volume. Do not use an ephemeral container filesystem for the database.

For an internet-facing deployment, put the service behind an HTTPS reverse proxy or a hosting provider's TLS endpoint, and configure the proxy/host firewall and domain accordingly. The production server marks session cookies `Secure`; users must access it over HTTPS. The server binds to `0.0.0.0` inside its container so the host can route traffic to it. `docker compose down` preserves the database volume; `docker compose down -v` deletes it.

This Docker setup is a single-instance deployment: keep one app replica because SQLite is local to the persistent volume, and use a managed multi-instance database before scaling horizontally. Public hosting is not automatic: you must deploy the repository to a Docker-capable host and configure its domain, TLS, and persistent storage.

## Accounts and workspace privacy

Create an account or sign in at `/signup` and `/login`. Waste logs, pickups, and impact factors are scoped to the signed-in account. Passwords are stored as salted scrypt hashes, and the browser receives an HttpOnly, SameSite=Lax session cookie with a 30-day lifetime. The light/dark preference is saved in that browser.

The account system supports public self-registration but does not currently provide email verification, password reset, multi-factor authentication, or account recovery. Use a strong unique password. Before relying on the service for sensitive or business-critical data, arrange backups and monitoring, review the authentication and rate-limiting setup for your hosting environment, and add appropriate account recovery and support processes.

## Connected workflow

- **Sort & Log** saves category, weighed quantity, source, sorting method, date, and optional recovered/compost quantities and recorded rupee values. Edit and delete update all dashboard totals.
- **Pickups** records location, source, material, estimated quantity, date, collector, and status. Completing a pickup requires an actual weighed amount and atomically creates a linked waste log. The pickup and linked log remain connected; deleting the pickup preserves the log as history.
- **Impact** is calculated from waste-log records within the selected dates. Landfill diversion is recorded recovered plus composted kg; recovery rate is diversion divided by logged kg; material recovery, compost, and rupee values are entered records. CO₂ is explicitly an estimate: `recovered kg × recovered factor + compost kg × compost factor`. Factors are configurable and persisted. Defaults (1.5 and 0.3 kg CO₂ per kg) are illustrative and should be replaced with a documented local methodology before formal reporting.
- **Value Chain** and **Overview** read those same persisted records. Theme preference is available on both the account screens and workspace.

## Checks

```sh
npm test
npm run build
```
