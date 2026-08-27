#!/usr/bin/env node

import {
  GOOGLE_OAUTH_SCOPES,
  readToken,
  redactTokenForStatus,
  refreshAccessToken,
  removeToken,
  resolveCredentialsPath,
  resolveTokenPath,
  runLocalOAuthLogin,
} from "./google-oauth-lib.mjs";

const HELP = `Usage:
  node skills/google-form-callback/scripts/google-auth.mjs <command> [options]

Commands:
  login             Open a browser and authorize Google Forms/Sheets access.
  status            Check whether a local Google OAuth token exists and refreshes.
  logout            Delete the local Google OAuth token file.

Options:
  --credentials <file>   Google OAuth desktop client JSON.
                         Defaults to GOOGLE_FORM_CALLBACK_OAUTH_CLIENT_FILE,
                         then ~/.config/google-form-callback/oauth-client.json.
  --token <file>         Local token cache path.
                         Defaults to GOOGLE_FORM_CALLBACK_OAUTH_TOKEN_FILE,
                         then ~/.config/google-form-callback/token.json.
  --no-browser           With login, print the auth URL instead of opening it.
  --help                 Show this help.

Required scopes:
${GOOGLE_OAUTH_SCOPES.map((scope) => `  - ${scope}`).join("\n")}
`;

function parseArgs(argv) {
  const result = {
    command: null,
    noBrowser: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--no-browser") {
      result.noBrowser = true;
      continue;
    }
    if (!arg.startsWith("--") && !result.command) {
      result.command = arg;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;

    switch (key) {
      case "credentials":
        result.credentials = next;
        break;
      case "token":
        result.token = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exit(2);
  }

  if (args.help || !args.command) {
    process.stdout.write(HELP);
    return;
  }

  const credentialsPath = resolveCredentialsPath(args.credentials);
  const tokenPath = resolveTokenPath(args.token);

  if (args.command === "login") {
    const result = await runLocalOAuthLogin({
      credentialsPath,
      tokenPath,
      noBrowser: args.noBrowser,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    return;
  }

  if (args.command === "status") {
    const before = readToken(tokenPath);
    if (!before) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            credentialsPath,
            tokenPath,
            authenticated: false,
            requiredScopes: GOOGLE_OAUTH_SCOPES,
          },
          null,
          2
        )}\n`
      );
      return;
    }

    const token = await refreshAccessToken({ credentialsPath, tokenPath });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          credentialsPath,
          tokenPath,
          ...redactTokenForStatus(token),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (args.command === "logout") {
    removeToken(tokenPath);
    process.stdout.write(`${JSON.stringify({ ok: true, tokenPath, removed: true }, null, 2)}\n`);
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  console.error(HELP);
  process.exit(2);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
