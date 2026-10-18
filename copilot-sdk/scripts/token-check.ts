import { CopilotClient, approveAll } from "@github/copilot-sdk";

// Token from your device flow (ghu_... from a GitHub App, gho_... from an OAuth App).
// Read it from the environment so it never lands in a file or shell history.
const token = process.env.COPILOT_TEST_TOKEN;
if (!token) {
  console.error("Set COPILOT_TEST_TOKEN first.");
  process.exit(1);
}

// Step 1: is the token valid, and whose is it?
const me = await fetch("https://api.github.com/user", {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  },
});
console.log("Token prefix:", token.slice(0, 4));
console.log(
  "GitHub /user:",
  me.status,
  me.ok ? (await me.json()).login : await me.text(),
);

// Step 2: can the Copilot SDK use this token on its own?
// useLoggedInUser: false stops the SDK from falling back to stored CLI or gh credentials,
// so a success here really comes from this token.
const client = new CopilotClient({
  gitHubToken: token,
  useLoggedInUser: false,
});

try {
  // start() spawns the CLI server and connects. listModels() throws "Client not connected" without it.
  await client.start();

  // Listing models is the cheapest call that proves the token reaches Copilot.
  const models = await client.listModels();
  console.log("Models available:", models.map((m) => m.id).join(", ") || "(none)");

  const model = models[0]?.id;
  const session = await client.createSession({
    model,
    onPermissionRequest: approveAll,
  });
  const reply = await session.sendAndWait({
    prompt: "Reply with exactly: copilot ok",
  });
  console.log("Copilot reply:", reply?.data.content);
  await session.disconnect();
} catch (err) {
  console.error("Copilot SDK failed:", err);
  process.exitCode = 1;
} finally {
  await client.stop();
}

process.exit(process.exitCode ?? 0);
