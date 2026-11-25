# Task spec for Mandarin Journal access over Tailscale

Justin normally uses the live Mandarin Journal from his laptop browser. The journal runs on a Mac mini already on his tailnet. Running `npm run start:live` should automatically allow the Mac mini's discovered Tailscale HTTPS address so the laptop can use a bookmark without its own SSH process.

## Server behavior

- Make discovery the default for the live profile. At startup, get the host's own fully qualified MagicDNS name from Tailscale status JSON (`Self.DNSName`), normalize the terminal DNS dot, and validate the name before using it. Use a bounded, non-shell CLI call. Support the host's macOS CLI setup, including a documented way to address the CLI if it is outside the launch environment's PATH. The checkout carries no machine name.
- Allow the exact default HTTPS origin `https://<self-dns-name>` for the Tailscale route. Keep the existing loopback HTTP origins and loopback listener on the journal port. Require a supplied Origin to match the origin allowed for the request's Host. Tailscale Serve terminates HTTPS and normally preserves Host on its HTTP hop to the journal. Establish the correct external origin from server configuration and discovery.
- A missing CLI, unavailable tailnet, timeout, or invalid discovery result leaves live startup usable over loopback with a concise diagnostic. Fixture and copy profiles use loopback only and need no Tailscale query.
- The operator configures private Tailscale Serve once on the host. The journal runs under the normal startup command. The operator's tailnet access policy controls who reaches the real journal. Preserve exact checks for unrelated hosts and origins. Server code must avoid enabling Serve or Funnel or editing the tailnet policy.

## Acceptance checks

1. Start a disposable journal with a stubbed successful discovery. Verify a browser-style GET and a representative same-origin write through the configured HTTPS host as received by the backend.
2. Verify cross-origin and unrelated-host requests fail, including a lookalike suffix or untrusted forwarded headers. Verify loopback GET and write still work. Include an Origin mismatch between a valid loopback host and the configured tailnet origin.
3. Verify startup and loopback access with missing or invalid discovery and verify the fixture and copy profile isolation. Use disposable data and stubbed/disabled provider calls.
4. Run the spike's focused tests and TypeScript check. Document the one-time Serve command, the bookmark URL, fallback behavior, and the access boundary in the journal runbook. Report whether an actual tailnet browser test was possible. Production server configuration, restarts, and journal data changes are outside the PR.
