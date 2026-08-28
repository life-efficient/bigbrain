# Local Development

Document local ports, dev-server expectations, auth callback URLs, build checks,
and environment setup conventions.

## Update Testing

- Development and unsigned desktop builds may check for releases but must not
  pretend an operating-system update was installed.
- Keep release fetching and installer activation behind injectable boundaries
  so checks, available releases, failures, and rollback can be tested without
  publishing a real release.
- A scheduled updater must expose a one-shot command that can be run directly
  in tests before installing a timer or LaunchAgent.
- Verify the local service separately after an update: process readiness, MCP
  initialize/tools-list, and client registration are distinct results.
- Cover equal, older, newer, unavailable, source-managed, remote, and unknown
  service states. Assert that newer and non-desktop-owned services never invoke
  reinstall.
- Test the persisted restart receipt across process launches, including an app
  version that did not advance and a local MCP that failed post-update checks.
