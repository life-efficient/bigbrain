# Auth And Sessions

Document sign-in, sign-out, session, authorization, redirect, and account-menu
behavior.

## Brain Profile Access

- Reading a brain profile requires an authenticated read-capable session or MCP
  `brain:read` scope. Local no-auth mode is reported as `local_trusted`, not as
  remotely authenticated.
- Profile editing is an owner-level operation. A syntactically valid generated
  draft remains unapproved until an owner explicitly reviews it.
- Never return owner email addresses, credential values, local paths, service
  labels, or raw parser diagnostics in an `about` response.

## Desktop API-Key Onboarding

- Detect credentials only from explicit BigBrain sources: the app environment,
  `~/.config/bigbrain/.env`, and BigBrain-owned macOS Keychain entries.
- Show the source and only the final four characters. Never send a complete
  detected credential to the renderer, brain, registry, or logs.
- Keep direct API-key entry available alongside detected choices and validate
  the selected credential before completing setup.
- Resolve a detected choice again in the main process when it is submitted;
  renderer-provided source identifiers are not authority to read arbitrary
  Keychain records.
