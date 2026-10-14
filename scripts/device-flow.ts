// Runs the GitHub device flow, then hands the token to token-check.ts.
//
// Usage:
//   GITHUB_CLIENT_ID=Iv23... npx tsx device-flow.ts
//
// For an OAuth App (not a GitHub App), also pass a scope, for example:
//   GITHUB_CLIENT_ID=Iv23... GITHUB_SCOPE=read:user npx tsx device-flow.ts
//
// The token stays in memory only. It is never printed or written to disk,
// and the refresh token (if any) is thrown away.

const clientId = process.env.GITHUB_CLIENT_ID;
const scope = process.env.GITHUB_SCOPE; // OAuth Apps only; GitHub Apps ignore scopes

if (!clientId) {
  console.error("Set GITHUB_CLIENT_ID to your app's Client ID (not the App ID).");
  process.exit(1);
}

const sleep = (seconds: number) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function post(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    throw new Error(`${url} returned ${res.status}: ${text.slice(0, 200)}`);
  }
}

// Step 1: ask GitHub for a device code.
const codeParams: Record<string, string> = { client_id: clientId };
if (scope) codeParams.scope = scope;

const code = await post("https://github.com/login/device/code", codeParams);

if (code.data.error) {
  console.error(`Device code request failed: ${code.data.error}`);
  if (code.data.error === "device_flow_disabled") {
    console.error("Tick 'Enable Device Flow' in the app settings and save.");
  } else {
    console.error(
      "Check that you used the Client ID (starts with 'Iv'), not the App ID, and that the app is on github.com.",
    );
  }
  process.exit(1);
}

const { device_code, user_code, verification_uri, expires_in } = code.data;
let interval: number = code.data.interval ?? 5;

// Step 2: tell the user what to do.
console.log("");
console.log(`  1. Open   ${verification_uri}`);
console.log(`  2. Enter  ${user_code}`);
console.log(`  3. Approve the app`);
console.log("");
console.log(`Waiting for approval (code expires in ${Math.round(expires_in / 60)} minutes)...`);

// Step 3: poll until approved, denied, or expired.
const deadline = Date.now() + expires_in * 1000;
let accessToken: string | undefined;
let tokenLifetime: number | undefined;

while (Date.now() < deadline) {
  await sleep(interval);

  const poll = await post("https://github.com/login/oauth/access_token", {
    client_id: clientId,
    device_code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  const err = poll.data.error;
  if (!err) {
    accessToken = poll.data.access_token;
    tokenLifetime = poll.data.expires_in;
    // poll.data.refresh_token is deliberately ignored and never stored.
    break;
  }
  if (err === "authorization_pending") continue;
  if (err === "slow_down") {
    interval += 5;
    continue;
  }
  if (err === "expired_token") {
    console.error("The code expired. Run the script again.");
    process.exit(1);
  }
  if (err === "access_denied") {
    console.error("Approval was cancelled.");
    process.exit(1);
  }
  console.error(`Unexpected error while polling: ${err}`);
  process.exit(1);
}

if (!accessToken) {
  console.error("Timed out waiting for approval. Run the script again.");
  process.exit(1);
}

// Step 4: report what we got, without printing the token.
console.log("");
console.log(
  `Got a ${accessToken.slice(0, 4)} token` +
    (tokenLifetime ? ` (valid for ${Math.round(tokenLifetime / 3600)} hours).` : " (no expiry)."),
);
console.log("Starting the Copilot SDK test...");
console.log("");

// Step 5: set the variable for this process and run the test in it.
process.env.COPILOT_TEST_TOKEN = accessToken;
await import("./token-check.ts");