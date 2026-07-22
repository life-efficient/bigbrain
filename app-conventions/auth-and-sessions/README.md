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
