import { config } from "../../config";

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface WithingsTokenResponse {
  status: number;
  body: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

async function readTokens(): Promise<TokenData | null> {
  const file = Bun.file(config.withingsTokensPath);
  if (!(await file.exists())) return null;
  return file.json();
}

async function writeTokens(tokens: TokenData): Promise<void> {
  const { dirname } = await import("node:path");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(config.withingsTokensPath), { recursive: true });
  await Bun.write(config.withingsTokensPath, JSON.stringify(tokens, null, 2));
}

async function exchangeCode(code: string): Promise<TokenData> {
  const response = await fetch("https://wbsapi.withings.net/v2/oauth2", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "requesttoken",
      grant_type: "authorization_code",
      client_id: config.withingsClientId(),
      client_secret: config.withingsClientSecret(),
      code,
      redirect_uri: config.withingsCallbackUrl,
    }),
  });

  const data = (await response.json()) as WithingsTokenResponse;
  if (data.status !== 0) {
    throw new Error(`Withings token exchange failed: ${JSON.stringify(data)}`);
  }

  return {
    access_token: data.body.access_token,
    refresh_token: data.body.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.body.expires_in,
  };
}

async function refreshTokens(refreshToken: string): Promise<TokenData> {
  const response = await fetch("https://wbsapi.withings.net/v2/oauth2", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "requesttoken",
      grant_type: "refresh_token",
      client_id: config.withingsClientId(),
      client_secret: config.withingsClientSecret(),
      refresh_token: refreshToken,
    }),
  });

  const data = (await response.json()) as WithingsTokenResponse;
  if (data.status !== 0) {
    throw new Error(`Withings token refresh failed: ${JSON.stringify(data)}`);
  }

  return {
    access_token: data.body.access_token,
    refresh_token: data.body.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.body.expires_in,
  };
}

export async function getAccessToken(): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) {
    throw new Error(
      "Withings not configured. Run: bun run withings:setup"
    );
  }

  // Refresh if expired (with 60s buffer)
  if (Date.now() / 1000 >= tokens.expires_at - 60) {
    console.log("[Withings] Access token expired, refreshing...");
    const newTokens = await refreshTokens(tokens.refresh_token);
    await writeTokens(newTokens);
    console.log("[Withings] Token refreshed successfully");
    return newTokens.access_token;
  }

  return tokens.access_token;
}

export async function setupAuth(): Promise<void> {
  const clientId = config.withingsClientId();
  const callbackUrl = config.withingsCallbackUrl;

  const authUrl =
    `https://account.withings.com/oauth2_user/authorize2` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&scope=user.metrics` +
    `&state=kettl`;

  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log("\nWaiting for callback...\n");

  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: 3000,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        if (!code) {
          return new Response("Missing code parameter", { status: 400 });
        }

        try {
          const tokens = await exchangeCode(code);
          await writeTokens(tokens);
          console.log(`[Withings] Tokens saved to ${config.withingsTokensPath}`);

          // Shut down server after short delay
          setTimeout(() => {
            server.stop();
            resolve();
          }, 100);

          return new Response(
            "<h1>Withings connected!</h1><p>You can close this tab.</p>",
            { headers: { "Content-Type": "text/html" } }
          );
        } catch (error) {
          server.stop();
          reject(error);
          return new Response(`Error: ${error}`, { status: 500 });
        }
      },
    });

    console.log(`[Withings] Callback server listening on port 3000`);
  });
}

export async function hasTokens(): Promise<boolean> {
  const file = Bun.file(config.withingsTokensPath);
  return file.exists();
}
