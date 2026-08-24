# Datacom Kudos

An internal employee-recognition feature built using a specification-first development process.

## Technology

- Node.js HTTP server and REST API
- Node.js built-in SQLite database
- Plain HTML, CSS and browser JavaScript
- Node.js built-in test runner

## Project structure

```text
task 2/
├── SPECIFICATION.md    # Approved requirements and technical design
├── package.json        # Project metadata and runnable commands
├── src/                # Backend and database code
├── public/             # Browser interface
└── test/               # Automated tests
```

Implementation instructions will be completed as each approved implementation step is built and verified.

## Requirements

- Node.js 22.5 or later with the built-in `node:sqlite` module
- No third-party package installation is required

## Run locally

```bash
npm run db:init
npm start
```

Open <http://localhost:3000>. Stop the server cleanly with `Control+C`.

The local database is created at `data/kudos.db`. Set `DATABASE_PATH` to use a
different location and `PORT` to use a different HTTP port.

## Demo identities

| User | Role |
|---|---|
| Avery Chen | Employee |
| Jordan Patel | Employee |
| Sam Williams | Employee |
| Morgan Lee | Administrator |

Demo identity selection exists only for local evaluation. Production must use
company SSO and HTTPS.

## Test

```bash
npm test
```

Tests start the API on a temporary loopback port and use a fresh in-memory
database. They never modify `data/kudos.db`.

## Key security controls

- Opaque, expiring, `HttpOnly`, `SameSite=Strict` session cookies
- Server-side employee and administrator authorization
- Same-origin checks for browser mutations
- Parameterized SQL and database constraints
- Plain-text rendering of user content
- Message validation, duplicate protection and rate limiting
- Content Security Policy and defensive HTTP headers
- Moderation auditing before permanent deletion
- Structured logs that exclude cookies and message bodies

## Production considerations

Before production deployment, replace demo login and in-memory sessions with
company SSO and shared session storage. Use HTTPS, a managed relational
database, migrations, backups, centralized rate limiting, monitoring, and a
company-approved retention/privacy policy. SQLite is intentionally used for
this standalone demonstration.
