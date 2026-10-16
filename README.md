# PURL Resolver

A self-hosted Persistent URL resolver with immutable PURL paths, a PostgreSQL mapping store, Redis caching, GitHub OAuth administration, and a React dashboard. See [architecture.md](architecture.md) for design background and implementation details.

## Requirements

- Node.js 22.12 or later
- Docker with Docker Compose for the local Compose workflow
- A GitHub OAuth app

## Configure

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Generate secrets:

   ```sh
   openssl rand -hex 16
   openssl rand -hex 32
   ```

   Use the first value as `POSTGRES_PASSWORD` and the second as `SESSION_SECRET` in `.env`. Set the same PostgreSQL password in `DATABASE_URL`. The session secret must be at least 32 bytes; the 32-byte random value is encoded as 64 hexadecimal characters.

3. Register a GitHub OAuth app under your personal account or an organization where you have permission to create apps. In **Settings -> Developer settings -> OAuth Apps -> New OAuth App**, enter:

   | GitHub field | Value |
   | --- | --- |
   | Application name | `PURL Resolver` (or another public-facing name) |
   | Homepage URL | `https://purl.example.com/admin` |
   | Application description | Optional |
   | Authorization callback URL | `https://purl.example.com/api/admin/auth/github/callback` |

   The homepage is the public dashboard URL. The callback is the backend route that completes sign-in; these are different URLs. For local Docker Compose, use homepage URL `http://localhost:6677/admin` and callback URL `http://localhost:6677/api/admin/auth/github/callback`. If you also want to sign in locally, use **Add callback URL** to add that localhost callback. GitHub allows up to 10 callback URLs. Alternatively, create a separate OAuth app for local development.

   Register the app, copy its **Client ID**, then choose **Generate a new client secret** and copy the secret into your secret manager or local `.env`. GitHub only shows the generated secret when it is created. Leave **Enable Device Flow** off; this app uses the browser authorization-code flow and requests only the `read:user` scope to check the signed-in GitHub username. It does not need repository access or a GitHub token after sign-in.

4. Update these `.env` values:

   ```dotenv
   GITHUB_CLIENT_ID=your-oauth-client-id
   GITHUB_CLIENT_SECRET=your-oauth-client-secret
   GITHUB_USERNAME=your-github-username
   APP_ORIGIN=http://localhost:6677
   TRUST_PROXY=false
   ```

   `GITHUB_USERNAME` is the only GitHub account allowed to administer PURLs and must match the account's GitHub login. `APP_ORIGIN` is the browser-facing origin, without a path or trailing route. The callback URL registered with GitHub must exactly equal `${APP_ORIGIN}/api/admin/auth/github/callback`; do not enter the literal `${APP_ORIGIN}` expression in GitHub settings. For local Compose use `APP_ORIGIN=http://localhost:6677`; for production use the public HTTPS origin, such as `https://purl.example.com`. Set `TRUST_PROXY=true` only when the app is behind a trusted reverse proxy that forwards the original protocol.

The remaining values in `.env.example` work with the supplied Compose services. If you change the PostgreSQL user, password, or database name, update both the `POSTGRES_*` settings and `DATABASE_URL` to match. URL-encode any special characters in credentials used in `DATABASE_URL`.

## Run

Start the resolver, PostgreSQL, and Redis:

```sh
docker-compose up --build
```

Compose publishes host port `HOST_PORT` (default `6677`) to the app's container port `PORT` (default `3000`), waits for PostgreSQL and Redis health checks, applies the Drizzle schema, and starts the app. Open [http://localhost:6677/admin](http://localhost:6677/admin) and sign in with the configured GitHub account. The dashboard lives at `/admin`; `/` is handled by the PURL resolver and returns `PURL not found` unless you have registered a root PURL. `APP_ORIGIN` is the origin only (`http://localhost:6677`), not the dashboard URL. `vite.config.ts` sets the port for the Vite development server only; it does not control the production container's port. Do not run Vite and Compose on host port 6677 at the same time.

Create PURLs in the dashboard. Their paths are permanent and cannot be edited; to establish a new name, create another PURL. Updating a destination or deactivating a PURL does not change its path.

A PURL such as `http://localhost:6677/research/2026/report.pdf` redirects to the destination registered for `/research/2026`, with the remaining path appended.

Stop the services with:

```sh
docker-compose down
```

This preserves the named PostgreSQL volume. `docker-compose down -v` also deletes that volume and its data.

## Development

Install dependencies and run the checks:

```sh
npm install
npm test
npm run build
```

`npm test` type-checks the test files and runs the resolver, admin API, and OAuth behavior tests. `npm run build` compiles the server and creates the production dashboard bundle.

To run outside Docker, provide reachable PostgreSQL and Redis instances and set the same required variables from `.env` in your shell. Use host-reachable service URLs (for example, `localhost` rather than Compose service names), then run:

```sh
npm run db:push
npm start
```

The server listens on `PORT` (default `3000`).

## Google Cloud deployment

Docker is optional. For a static React frontend and a dynamic resolver, deploy the two parts separately. The apex domain can remain on Netlify; use a dedicated subdomain such as `purl.example.com` for the PURL app.

### Static frontend and dynamic backend

Use Firebase Hosting for the built React files in `dist/public`, and route dynamic requests to the resolver service:

- `/admin` serves the static React dashboard.
- `/api/**` routes OAuth and admin API calls to the backend.
- Other paths route to the backend for PURL resolution and HTTP redirects.

This keeps frontend assets on Firebase's CDN while leaving database lookups in the backend. Keeping both behind the same subdomain also lets the dashboard use its current same-origin `/api/...` requests and session cookie.

Create a `firebase.json` in the deployment checkout with the following Hosting configuration. Firebase Hosting serves files that exist in `dist/public`; rewrites handle `/admin` and dynamic requests:

```json
{
   "hosting": {
      "public": "dist/public",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [
         { "source": "/api/**", "run": { "serviceId": "purl-resolver", "region": "REGION" } },
         { "source": "/admin", "destination": "/index.html" },
         { "source": "**", "run": { "serviceId": "purl-resolver", "region": "REGION" } }
      ]
   }
}
```

Build and deploy the static site with the Firebase CLI:

```sh
npm ci
npm run build
firebase deploy --only hosting --project PROJECT_ID
```

Connect `purl.example.com` to Firebase Hosting using the DNS records shown in its custom-domain setup. Netlify can continue serving the apex domain. DNS record types vary by provider and setup; follow Firebase's instructions rather than assuming every subdomain uses a CNAME. Set `APP_ORIGIN=https://purl.example.com` and the GitHub OAuth callback URL to `https://purl.example.com/api/admin/auth/github/callback`.

### Cloud Run backend

#### Provision Cloud Run dependencies

Complete these steps before running the Cloud Run deploy command. Keep Cloud Run, Cloud SQL, Memorystore, and the VPC connector in the same Google Cloud project and region where possible.

1. **Prepare the project and network.** Select a Google Cloud project with billing enabled and initialize the `gcloud` CLI. Create or choose a VPC network. Enable the Cloud Run, Cloud Build, Artifact Registry, Cloud SQL Admin, Memorystore for Redis, Serverless VPC Access, and Secret Manager APIs. The [VPC connector setup guide](https://docs.cloud.google.com/run/docs/configuring/vpc-connectors) walks through the console and CLI steps. Create the connector in the same region as Cloud Run, attach it to the VPC, and reserve an unused `/28` IPv4 range for the connector. The range must not overlap any existing subnet or route. The connector adds recurring cost; [Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc) is an alternative that does not require a connector resource.

2. **Create Cloud SQL for PostgreSQL.** Follow Google's [Cloud SQL instance creation guide](https://docs.cloud.google.com/sql/docs/postgres/create-instance). Choose PostgreSQL, the same region, and private IP on the VPC reachable from Cloud Run. Configure Private Services Access if the console asks for it. Create a database named `purls` and a dedicated application user with a strong password. Record the instance connection name shown on its Overview page; it has the form `PROJECT_ID:REGION:INSTANCE_ID`. The [Cloud Run connection guide](https://docs.cloud.google.com/sql/docs/postgres/connect-run) explains the Cloud SQL attachment and IAM requirements. The Cloud Run service account needs the `Cloud SQL Client` role (`roles/cloudsql.client`).

   Store this connection string as the `DATABASE_URL` secret, replacing the placeholders and URL-encoding special characters in the password:

   ```text
   postgresql://APP_USER:URL_ENCODED_PASSWORD@/purls?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_ID
   ```

   The deploy command's `--add-cloudsql-instances PROJECT_ID:REGION:INSTANCE_ID` attaches the instance and makes that Unix socket available to the app.

3. **Create Memorystore for Redis.** Follow the [Memorystore for Redis creation guide](https://docs.cloud.google.com/memorystore/docs/redis/create-manage-instances). Select Redis 7, the same region, and the same VPC as the connector. Choose Basic tier for a non-HA development setup or Standard tier when you need high availability. After creation, find the instance's private IP address and port in its details. With AUTH and in-transit encryption disabled, the app setting is `REDIS_URL=redis://REDIS_PRIVATE_IP:6379`. If you enable Redis AUTH or TLS, configure the corresponding credentials and `rediss://` URL; do not expose the Redis endpoint publicly.

4. **Create secrets.** In [Secret Manager](https://docs.cloud.google.com/secret-manager/docs/creating-and-accessing-secrets), create secrets named `DATABASE_URL`, `GITHUB_CLIENT_SECRET`, and `SESSION_SECRET`, then add a version containing each value. Use the OAuth client secret from GitHub and generate a session secret with `openssl rand -hex 32`. Grant the Cloud Run runtime service account `Secret Manager Secret Accessor` (`roles/secretmanager.secretAccessor`) on these secrets. `GITHUB_CLIENT_ID`, `GITHUB_USERNAME`, `APP_ORIGIN`, `TRUST_PROXY`, and `REDIS_URL` are non-secret service environment variables.

5. **Create or select the Cloud Run service account.** Grant it `roles/cloudsql.client` and access to the three secrets above. Set the service's VPC connector to the connector created in step 1 and use private-ranges-only egress for the Redis private IP and other private endpoints.

The backend must accept public requests from Firebase Hosting rewrites for PURL redirects; admin routes remain protected by the GitHub allowlist and session. Apply the Drizzle schema once as a controlled release step before routing traffic to the new revision.

Cloud Run is a low-operations backend option, but it is serverless: instances can start cold, scale down, or be replaced during deploys. Minimum instances reduce cold starts but do not guarantee an instance will never be terminated. Keep the database and cache connections close to the service and measure redirect latency. **This app does not yet gracefully drain HTTP requests or close its connections on `SIGTERM`; add shutdown handling and use a database pool before relying on Cloud Run for production traffic.**

Deploy the backend from source without installing Docker locally:

```sh
gcloud run deploy purl-resolver \
   --source . \
   --region REGION \
   --allow-unauthenticated \
   --command npm \
   --args start \
   --vpc-connector VPC_CONNECTOR \
   --vpc-egress private-ranges-only \
   --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE \
   --set-env-vars GITHUB_CLIENT_ID=CLIENT_ID,GITHUB_USERNAME=ADMIN_USERNAME,APP_ORIGIN=https://purl.example.com,TRUST_PROXY=true,REDIS_URL=redis://REDIS_PRIVATE_IP:6379 \
   --set-secrets DATABASE_URL=DATABASE_URL:latest,GITHUB_CLIENT_SECRET=GITHUB_CLIENT_SECRET:latest,SESSION_SECRET=SESSION_SECRET:latest
```

Replace the uppercase placeholders and provision the VPC connector, Cloud SQL instance, Memorystore instance, and secrets first. For a Cloud SQL Unix socket connection, the `DATABASE_URL` secret can use this form:

```text
postgresql://DB_USER:URL_ENCODED_PASSWORD@/DB_NAME?host=/cloudsql/PROJECT_ID:REGION:INSTANCE
```

`--source .` avoids a local Docker workflow, but Cloud Run still runs a container. Because this repository has a `Dockerfile`, Cloud Build uses it to build the image. The command override above bypasses the Dockerfile's Compose-oriented schema push on startup. Apply schema changes once in a controlled release step before directing traffic to the new revision, rather than running migrations independently from autoscaled instances.

If predictable instance lifetime or latency matters more than minimizing operations, run the backend on Compute Engine behind a managed instance group and HTTPS load balancer. This avoids Cloud Run scale-to-zero behavior but makes you responsible for VM patching, process supervision, capacity, and availability. GKE is appropriate when your organization already operates Kubernetes or needs its scheduling and policy controls; it still runs containers and does not eliminate pod replacement or network latency. For a single resolver, use GKE only when Kubernetes itself is a requirement.

## Troubleshooting

- **The app exits before starting:** Check that all required values are set in `.env`, especially `DATABASE_URL`, `REDIS_URL`, the three GitHub values, and `SESSION_SECRET`.
- **GitHub reports a callback mismatch:** The callback URL in the OAuth app must exactly match `${APP_ORIGIN}/api/admin/auth/github/callback`, including scheme, host, port, and path.
- **The dashboard sends you back to sign-in:** Confirm that `GITHUB_USERNAME` matches the GitHub login that completed OAuth.
- **Database connection fails:** Confirm `DATABASE_URL` uses the credentials and database configured for PostgreSQL. Inside Compose, the database hostname is `db`.
