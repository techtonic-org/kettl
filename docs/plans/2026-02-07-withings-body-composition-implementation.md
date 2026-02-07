# Withings Body Composition Connector — Implementation Plan

## Context

The user has a Withings scale that syncs weight/body composition to Withings cloud but not to Garmin. The existing `get_weight_trend` Garmin tool only reads from GarminDB SQLite (which has no Withings data). We need to:

1. Connect to the Withings API to fetch body composition measurements
2. Replace the Garmin weight tool with a Withings-backed one
3. Include body composition in EOD daily summaries
4. Establish a **ports & adapters** pattern so data providers can be swapped in the future

---

## Step 1: Define the Body Composition Port

**Create** `src/ports/body-composition.ts`

```typescript
export interface BodyCompositionMeasurement {
  date: string           // YYYY-MM-DD
  time: string           // HH:MM
  weight: number         // kg
  fatPercent?: number     // %
  muscleMass?: number    // kg
  boneMass?: number      // kg
  waterPercent?: number  // %
  bmi?: number
}

export interface BodyCompositionPort {
  getLatest(): Promise<BodyCompositionMeasurement | null>
  getForDate(date: string): Promise<BodyCompositionMeasurement[]>
  getTrend(days: number): Promise<BodyCompositionMeasurement[]>
}
```

This is the abstract interface. No Withings-specific details leak through.

---

## Step 2: Withings OAuth2 Auth Module

**Create** `src/adapters/withings/auth.ts`

Handles the full OAuth2 lifecycle:

- **`setupAuth()`** — One-time setup function:
  - Starts a temporary `Bun.serve()` on `localhost:3000` for the OAuth callback
  - Opens the Withings authorization URL in the browser (`https://account.withings.com/oauth2_user/authorize2`)
  - Scope: `user.metrics`
  - Receives the auth code at the callback, exchanges it for access + refresh tokens via `https://account.withings.com/oauth2/token`
  - Stores tokens in `data/withings/tokens.json` (access_token, refresh_token, expires_at)
  - Shuts down the temp server
- **`getAccessToken()`** — Used by the client:
  - Reads `data/withings/tokens.json`
  - If access token expired (3h lifetime), refreshes via the token endpoint using the refresh token
  - Saves the new tokens (important: refresh token rotates on each refresh)
  - Returns valid access token
- **Token file format:**
  ```json
  {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890
  }
  ```

---

## Step 3: Withings API Client

**Create** `src/adapters/withings/client.ts`

Thin wrapper around the Withings Measure API:

- **`getMeasurements(startDate, endDate)`** — Calls `POST https://wbsapi.withings.net/measure` with:
  - `action=getmeas`
  - `meastypes=1,6,76,88,77,91` (weight, fat%, muscle, bone, water, BMI)
  - `startdate` / `enddate` as unix timestamps
  - `category=1` (real measurements only)
  - Auth header: `Bearer {accessToken}`
- Parses the response: `body.measuregrps[]` → each group contains `measures[]` with `type`, `value`, `unit`
  - Real value = `value * 10^unit` (e.g., value=80136, unit=-3 → 80.136 kg)
- Returns `BodyCompositionMeasurement[]`

Meastype mapping:
| Type ID | Field |
|---------|-------|
| 1 | weight |
| 6 | fatPercent |
| 76 | muscleMass |
| 88 | boneMass |
| 77 | waterPercent (convert kg→% using weight) |
| 91 | bmi |

---

## Step 4: Withings Adapter (Implements the Port)

**Create** `src/adapters/withings/adapter.ts`

Implements `BodyCompositionPort` using the Withings client:

- **`getLatest()`** — Queries last 30 days, returns most recent measurement
- **`getForDate(date)`** — Queries that specific day (start of day → end of day unix timestamps)
- **`getTrend(days)`** — Queries from `now - days` to `now`, returns all measurements sorted by date desc

**Create** `src/adapters/withings/index.ts` — Exports the adapter instance

---

## Step 5: One-Time Setup Script

**Create** `src/adapters/withings/setup.ts`

Standalone script to run the OAuth flow:
```sh
bun run src/adapters/withings/setup.ts
```

- Validates `WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET` are set
- Calls `setupAuth()`
- Prints success message with token file location

Add a convenience script to `package.json`:
```json
"withings:setup": "bun run src/adapters/withings/setup.ts"
```

---

## Step 6: Config Changes

**Edit** `src/config.ts`

Add:
```typescript
// Withings
withingsClientId: () => getEnvOrThrow("WITHINGS_CLIENT_ID"),
withingsClientSecret: () => getEnvOrThrow("WITHINGS_CLIENT_SECRET"),
withingsCallbackUrl: getEnvOrDefault("WITHINGS_CALLBACK_URL", "http://localhost:3000/callback"),
withingsTokensPath: expandPath(getEnvOrDefault("WITHINGS_TOKENS_PATH", "./data/withings/tokens.json")),
```

Use lazy getters for client ID/secret (only needed when actually calling the API, not at startup).

---

## Step 7: Replace Garmin Weight Tool

**Edit** `src/tools/garmin.ts`
- Remove the `get_weight_trend` tool registration (lines 100-119)
- Remove `getWeightTrend` from the import

**Create** `src/tools/body-composition.ts`

Register two tools backed by the port:

1. **`get_latest_weight`** — "Get the most recent body composition measurement (weight, fat%, muscle mass, bone mass, water%, BMI)."
   - No parameters
   - Calls `port.getLatest()`

2. **`get_weight_trend`** — "Get body composition measurements over N days. Includes weight, fat%, muscle mass, bone mass, water%, BMI."
   - Parameter: `days` (default: 30)
   - Calls `port.getTrend(days)`

The tool file imports the adapter from `../adapters/withings` and uses it as the port implementation.

**Edit** `src/tools/index.ts`
- Add `import "./body-composition";`

---

## Step 8: EOD Summary Integration

**Edit** `src/summaries/generator.ts`

- Import the body composition port adapter
- Add a 5th data source to the `Promise.all`:
  ```typescript
  const [vitals, activities, sleep, chats, bodyComp] = await Promise.all([
    getSummaryForDate(dateStr),
    getActivitiesForDate(dateStr),
    getSleepForDate(dateStr),
    getChatsForDate(dateStr),
    bodyCompPort.getForDate(dateStr).catch(() => []),
  ]);
  ```
- If `bodyComp` is empty, fall back: `bodyCompPort.getLatest().catch(() => null)`
- Add a "BODY COMPOSITION" section to `buildDataContext()`:
  ```
  BODY COMPOSITION:
  - Weight: 80.1 kg
  - Fat: 18.2%
  - Muscle Mass: 36.4 kg
  - Bone Mass: 3.2 kg
  - Water: 55.1%
  - BMI: 24.3
  ```
  If using fallback (no same-day measurement): add `(latest, from YYYY-MM-DD)` note
- Add `## Body Composition` section to `SUMMARY_GENERATION_PROMPT`

---

## Step 9: Update System Prompt

**Edit** `src/prompts.ts`

In `buildMainPrompt()`, update the Data Freshness section:
- Remove `get_weight_trend` from the SQLite tools list
- Add a new section:
  ```
  **Body Composition (Withings):** Real-time from Withings API
  - Use for: weight, body fat %, muscle mass, bone mass, water %, BMI
  - Tools: get_latest_weight, get_weight_trend
  ```

---

## Step 10: Initialization

**Edit** `src/index.ts`

- Import Withings adapter and check if tokens exist at startup
- Log whether Withings is configured (don't crash if not — graceful degradation)
- If tokens file doesn't exist, log a warning: `[Startup] Withings not configured. Run: bun run withings:setup`

---

## Files Changed (Summary)

| Action | File | What |
|--------|------|------|
| Create | `src/ports/body-composition.ts` | Port interface |
| Create | `src/adapters/withings/auth.ts` | OAuth2 flow + token management |
| Create | `src/adapters/withings/client.ts` | Withings API client |
| Create | `src/adapters/withings/adapter.ts` | Port implementation |
| Create | `src/adapters/withings/index.ts` | Re-exports |
| Create | `src/adapters/withings/setup.ts` | One-time auth setup script |
| Create | `src/tools/body-composition.ts` | Tool registrations |
| Edit | `src/tools/garmin.ts` | Remove `get_weight_trend` |
| Edit | `src/tools/index.ts` | Add body-composition import |
| Edit | `src/config.ts` | Add Withings config |
| Edit | `src/summaries/generator.ts` | Add body comp to data context + prompt |
| Edit | `src/prompts.ts` | Update system prompt with new tools |
| Edit | `src/index.ts` | Startup check for Withings tokens |
| Edit | `package.json` | Add `withings:setup` script |

---

## Verification

1. **OAuth setup**: Run `bun run withings:setup`, complete browser flow, verify `data/withings/tokens.json` is created
2. **Tool call**: Start the bot, ask "what's my latest weight?" — should return Withings data with all body comp metrics
3. **Trend**: Ask "show me my weight trend for the last 2 weeks" — should return multiple measurements
4. **EOD summary**: Trigger a summary generation manually or wait for scheduled run — verify the body composition section appears
5. **Graceful degradation**: Remove tokens file, restart — bot should still work, just log a warning about Withings not being configured
6. **Token refresh**: Wait 3+ hours (or manually expire the token), make a request — should auto-refresh
