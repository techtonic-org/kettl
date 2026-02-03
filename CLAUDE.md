
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## TDD - Do It Properly

**Before writing mocks, verify actual data:**
- Query the real database/API to see actual schema and data formats
- `bun -e "..."` to inspect SQLite tables: column names, data types, value formats
- Don't assume - check `PRAGMA table_info(table_name)`

**Common pitfalls:**
- SQLite time columns return strings like `"01:30:00.000000"`, not seconds
- GarminDB uses `day` column, not `date`
- Distance may be in km already, don't blindly divide by 1000
- `getRecentActivities(n)` queries from "today", not a specific date

**Test isolation in Bun:**
- `mock.module()` must be at top level, before imports
- Run tests file-by-file to avoid module cache pollution: `for f in src/**/*.test.ts; do bun test "$f"; done`

## GarminDB Schema

```
garmin.db: sleep(day, start, end, total_sleep, deep_sleep, light_sleep, rem_sleep, score)
garmin_summary.db: days_summary(day, steps, rhr_avg, stress_avg, bb_max, bb_min, ...)
garmin_activities.db: activities(activity_id, name, sport, start_time, distance, elapsed_time, avg_hr, max_hr)
```

- Times are strings: `"HH:MM:SS.mmm"`
- Distance in km
- Use `sport` column for activity type (not `type` which is always "uncategorized")

## garmin-connect Library

Pass credentials to constructor, then call login():
```ts
const client = new GarminConnect({ username: email, password: pass });
await client.login();
```

## Docker Build

If DNS fails during build, use: `docker build --network=host -t image-name .`
