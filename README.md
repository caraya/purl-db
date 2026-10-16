# Building a production PURL resolver

When working with web content, one of the hardest things to deal with is link rot, when links on your web content die, are moved, or otherwise become unavailable.

This guide outlines how to build, deploy, and manage a high-performance Persistent Uniform Resource Locator (PURL) resolver using Node.js, Express, PostgreSQL, Redis, and Drizzle ORM.

## What is a PURL and why choose it?

A Persistent Uniform Resource Locator (PURL) is a standard web address that acts as a permanent routing alias for a digital object. Instead of pointing directly to a server where a file lives, a PURL points to an intermediate resolution service. This service looks up the current physical location of the resource and redirects the user. This provides a crucial layer of indirection to permanently combat link rot.

While there are many types of persistent identifiers, PURLs are often the best choice for independent organizations due to their simplicity, web-native design, and lack of dependency on central authorities. Here is how they compare to alternatives:

* **DOIs (Digital Object Identifiers):** DOIs are highly structured and heavily governed. Registering them generally requires paying membership and minting fees to a central registration agency (like Crossref or DataCite).

  * *The PURL Advantage:* PURLs are completely free to mint and fully under your sovereign control. There is no bureaucratic overhead, central bottleneck, or recurring tax per link.

* **URNs (Uniform Resource Names):** A URN is purely a naming scheme (e.g., `urn:isbn:0451450523`). Web browsers do not natively know what to do with a URN; they require a secondary, often complex resolution infrastructure (like a browser plugin) to actually fetch a file.

  * *The PURL Advantage:* PURLs are just standard HTTP URLs. They work natively in every web browser, automated script, and HTTP client on Earth right out of the box.

* **ARKs (Archival Resource Keys):** ARKs are complex identifiers designed for libraries. They heavily utilize URL inflections (e.g., appending `?` or `??` to a URL to fetch metadata instead of the file), which violates modern web practices and interferes with standard web tracking, analytics, and query parameters.

  * *The PURL Advantage:* PURLs adhere to the "dumb pipe" philosophy. By relying strictly on standard HTTP redirects, they do not hijack standard web mechanics. Internal metadata management is handled securely on the backend, while the public strictly experiences a seamless, standard web redirect.

### Persistent URLs vs. URL shorteners (like bit.ly)

It is important to distinguish the system we are building from commercial URL shorteners (like bit.ly) and marketing "pURLs" (Personalized URLs used to track individual user engagement).

While a Persistent URL and a URL shortener operate using the exact same technical mechanism under the hood—an HTTP 302 redirect—their core philosophies and use cases are entirely opposite:

* **Primary Goal:** URL shorteners prioritize brevity and click-tracking for temporary marketing campaigns. PURLs prioritize permanence and stability to guarantee a citation will work decades from now.

* **Target Mutability:** A short link's destination is generally static; if the target page dies, the short link dies with it. A PURL's core purpose is to be dynamically updated when a target file moves, ensuring the original published link never breaks.

* **Sovereignty:** URL shorteners are SaaS dependencies. If the provider goes bankrupt or raises prices, your links break. A self-hosted PURL resolver gives you absolute ownership over your organization's routing infrastructure.

### Naming philosophy: Semantic vs. Opaque identifiers

When minting your PURLs, you must choose a naming convention. There are two primary schools of thought:

#### **1. Semantic (Human-Readable) Identifiers**

* *Example:* `/research/physics/2026/data`
* *Pros:* Provides essential context in environments where the URL must be explicitly written out. If a user is reading a printed paper, or reading a formal bibliography (like Chicago or APA style) where the raw URL is fully displayed, they know exactly what they are navigating to.
* *Cons & Operator Governance:* Semantic identifiers are vulnerable to administrative operator error. If a department is renamed from "Physics" to "Physical Sciences", the underlying file location will eventually change (link rot). When an administrator logs in to update the PURL's destination to fix the link rot, the human-readable path (`/physics`) tempts them to also update the PURL path to match the new department name. Doing so instantly breaks all existing printed citations.

  *The Solution:* This is strictly an operator issue, solved by software governance. **The PURL path must be mathematically immutable.** Once created, your software must never allow the path string to be edited. If a department demands a new semantic URL to reflect their new name, the administrator simply creates a *second, brand-new* PURL for them, while leaving the original PURL permanently active and pointing to the same destination.

#### **2. Opaque (Random) Identifiers**

* *Example:* `/item/a7x9j2m4PqW1`

* *Pros:* The ultimate defense against human meddling. Because a random string carries no meaning, it can never become politically sensitive or factually incorrect. Administrators are never tempted to "fix" the text of an opaque URL when fixing link rot.

* *Cons:* In formal printed citations (e.g., Chicago style) where the reader is forced to look at the raw URL without a hyperlink, the string gives absolutely no contextual clues about the destination, and can appear difficult to type or visually unappealing.

*Note on Technical Permanence:* Regardless of the naming convention you choose, a PURL fundamentally prevents technical link rot. Even if the target destination file is completely deleted from the live internet, the PURL administrator can simply update the database to redirect the PURL to a snapshot on the Internet Archive, ensuring the original citation lives on forever.

## Core architecture

Unlike complex decentralized identifier systems, a PURL relies on basic, robust web mechanics. The architecture consists of three simple steps:

1. **The Request:** A user clicks or requests a PURL, such as `https://purl.yourdomain.org/research/alpha`.

2. **The Lookup:** The Express server intercepts the request and queries the PostgreSQL database (or the Redis cache) to find the current destination.

3. **The Redirect:** The server issues an HTTP 302 Found response, directing the browser to the actual, current location of the file (e.g., an AWS S3 bucket).

## Run the resolver

The resolver and admin dashboard are implemented in `src/` and `web/`. The app requires Node.js 22.12 or later, Docker Compose, and a GitHub OAuth app.

1. Copy `.env.example` to `.env`. Set `POSTGRES_PASSWORD` and use the same password in `DATABASE_URL`.
1. Create a GitHub OAuth app with callback URL `http://localhost:3000/api/admin/auth/github/callback`. Set its client ID, secret, and the allowed GitHub username in `.env`.
1. Replace `SESSION_SECRET` with the output of `openssl rand -hex 32` and set `APP_ORIGIN=http://localhost:3000`.
1. Run `docker-compose up --build`, then open `http://localhost:3000/admin` and sign in with the allowed GitHub account.

Compose applies the Drizzle schema before starting the app. PURLs can then be created and maintained in the admin dashboard. Run `npm test` for API and resolver tests and `npm run build` to compile the server and dashboard.

## Database schema

We use PostgreSQL for robust persistence and Drizzle ORM for type-safe database interactions. We include a required `title` and optional `description` field to help administrators manage links internally.

```ts
// schema.ts
import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const purlMappings = pgTable('purl_mappings', {
  id: serial('id').primaryKey(),
  path: text('path').unique().notNull(),
  targetUrl: text('target_url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

```

## Resolution server

The executable server is [`src/server.ts`](src/server.ts). It mounts the resolver, GitHub OAuth routes, the session-protected admin API, and the compiled React dashboard. Resolver matching and target construction are in [`src/resolution.ts`](src/resolution.ts); the HTTP and Redis behavior are in [`src/resolver-app.ts`](src/resolver-app.ts).

### Architecture note: Fail-fast validation

`validateEnv()` runs before any listener starts. It requires the PostgreSQL and Redis URLs, GitHub OAuth credentials, an allowlisted username, and a session secret of at least 32 bytes. Missing or invalid settings stop startup.

## Usage examples

If you register `/research/2026` in the database to point to `https://university.edu/storage/dept/2026/`, the resolver automatically handles nested files.

* **User requests:** `https://purl.yourdomain.org/research/2026/report.pdf`

* **Resolver calculates:** Match found for `/research/2026`. Remainder is `/report.pdf`.

* **User is redirected to:** `https://university.edu/storage/dept/2026/report.pdf`

If the university later moves its storage to AWS S3, you simply update the database target to `https://s3.amazonaws.com/uni-archive/2026/`. The original PURL citations in published papers remain perfectly valid.

## Admin API and front-end management

The app includes a GitHub OAuth-protected API and React dashboard. Only the configured GitHub username can manage mappings; client credentials stay on the server and the browser receives an HTTP-only session cookie.

### GitHub OAuth setup

1. Go to GitHub Developer Settings -> OAuth Apps -> "New OAuth App".

1. Set the authorization callback URL to `${APP_ORIGIN}/api/admin/auth/github/callback`. For local Compose, use `http://localhost:3000/api/admin/auth/github/callback`.

1. Set these values in `.env`; generate `SESSION_SECRET` with `openssl rand -hex 32`:

```bash
DATABASE_URL="postgresql://purls:your-password@db:5432/purls"
REDIS_URL="redis://cache:6379"
GITHUB_CLIENT_ID="your_client_id"
GITHUB_CLIENT_SECRET="your_client_secret"
GITHUB_USERNAME="your_github_username"
SESSION_SECRET="your-64-character-hex-secret"
APP_ORIGIN="https://purl.yourdomain.org"
TRUST_PROXY="true"

```

### Admin API routes

[`src/admin-router.ts`](src/admin-router.ts) requires a verified session, validates HTTP(S) targets and PURL paths, and rejects `path` in update payloads. Successful mutations advance the Redis cache generation so nested redirects cannot continue using stale destinations.

The API provides `GET /api/admin/purls`, `POST /api/admin/purls`, and `PUT /api/admin/purls/:id`. The OAuth routes in [`src/auth-router.ts`](src/auth-router.ts) validate one-time state, exchange the code with GitHub, check the configured username, rotate the session ID, and support sign-out.

### Dashboard component

The React interface in [`web/PurlManager.tsx`](web/PurlManager.tsx) supports creating and searching PURLs, editing destinations and metadata, toggling activity, and signing out. Existing PURL paths are displayed read-only.

## Orchestrating with Docker Compose

The project [`Dockerfile`](Dockerfile) builds both the TypeScript service and React dashboard. [`docker-compose.yml`](docker-compose.yml) starts the app with PostgreSQL and Redis, waits for healthy dependencies, applies the Drizzle schema, and then starts the server. Copy `.env.example` to `.env` and configure the GitHub OAuth values before launching.
