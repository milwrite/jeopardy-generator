# User and board storage

The production Worker sends account and board requests to the `UserStore` Durable Object. Its SQLite database holds users, hashed session tokens, and each user's boards. The browser receives a random session token in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie; SQLite stores only its SHA-256 hash and expiry.

Registration is limited to five attempts per source address per hour, while login is limited to twenty attempts per ten minutes. The API also applies request-size limits, generic login failures, and same-origin checks for every request that changes data.

`wrangler.jsonc` creates the SQLite-backed class through the `user-store-v1` migration. Deployment must apply that migration and preserve the `USER_STORE` Durable Object binding. Kale Deploy uses Workers for Platforms, so its upload step must include both the binding and migration metadata from the Wrangler configuration.

Use `npm run dev:worker` when testing accounts or saved boards locally. The ordinary `npm run dev` command only runs Next.js and cannot expose API handlers while static export is enabled. `npm run check:worker` builds the static application and validates the Worker bundle, assets, binding, and migration without deploying it.

## Board API

- `GET /api/boards` lists the signed-in user's boards without the full board payload.
- `POST /api/boards` creates a board. It accepts `name`, `board_data`, `source`, `ai_provider`, `ai_model`, `metadata`, and `schema_version`.
- `GET /api/boards/:id` returns an owned board and records `last_opened_at`.
- `PUT` or `PATCH /api/boards/:id` updates an owned board. Every update must include `expected_revision`; a stale revision returns `409` with the current summary.
- `DELETE /api/boards/:id` deletes an owned board.

Generated boards use `source: "generated"` and must supply both `ai_provider` and `ai_model`. Metadata can include safe generation details such as temperature, topics, and generation time. API keys, authorization values, passwords, and tokens are rejected from metadata.

The Worker currently routes every account to one Durable Object instance named `primary`. This provides serial, strongly consistent writes and keeps username and email uniqueness straightforward. If usage grows enough for one object to limit throughput or storage, the next design should separate the account index from user-specific board objects while retaining a single authority for account uniqueness.
