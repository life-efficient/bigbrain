# BigBrain event relay

This is a provider-neutral, self-hostable relay for events that cannot reach a
client directly. It authenticates inbound requests, durably queues them on disk,
and forwards them to a BigBrain webhook listener when the client is reachable.

Run it with the repository's Node runtime:

```sh
BIGBRAIN_RELAY_HOST=0.0.0.0 \
BIGBRAIN_RELAY_PORT=5580 \
BIGBRAIN_RELAY_INBOUND_SECRET='provider-to-relay-secret' \
BIGBRAIN_RELAY_FORWARD_URL='https://client.example/deliveries/org-rss' \
BIGBRAIN_RELAY_FORWARD_SECRET='relay-to-client-secret' \
node scripts/run-event-relay.mjs
```

The relay accepts `POST /v1/events` with an `x-bigbrain-signature` HMAC-SHA256
header over the exact request body. It forwards the same event with its own
signature and removes the queue entry only after a 2xx response. `GET /health`
and `GET /v1/queue` expose operational status without returning queued payloads.

The relay intentionally has no Brain credentials and does not decide how an
event is filed. The client or organization host owns the listener registry and
Codex processing policy.
