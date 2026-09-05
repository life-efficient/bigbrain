# BigBrain Manage Email Forward Cases

## Automation blanket exclusion

Evidence:

- The active scan allows Brain ingest only for identifiable human correspondence.
- An automated Substack delivery announces one new post with a canonical URL.

Expected:

- Apply the human-author rule only to the human-correspondence branch.
- Route the notification to `$bigbrain-substack-ingest`.
- Let `$bigbrain-source-article-ingest` decide article relevance.

## Verified irrelevant Substack post

Evidence:

- A valid new-post notification reaches the shared article relevance gate.
- The canonical post is accessible but fails registered source guidance and has no named current user anchor.

Expected:

- Return `ignored` without a raw artifact or Brain page.
- Record `ignored_verified` in automation memory.
- Advance only the Gmail delivery cursor, not the RSS cursor.

## Human deal correspondence

Evidence:

- An identifiable person sends new diligence information and attaches a substantive PDF.

Expected:

- Delegate one bounded thread to `$bigbrain-email-ingest`.
- Let the worker route to one Brain, reconcile tasks through action review, preserve and verify the PDF, and return a terminal handoff.

## Generic automated alert

Evidence:

- A no-reply platform message contains action language but no article source and is outside authorized cleanup.

Expected:

- Classify it as `excluded_automated`.
- Create no Brain task or artifact and make no Gmail change.

## Cleanup scope is narrower than the skill

Evidence:

- The skill knows several standing cleanup classes.
- The active automation authorizes only American Express Saudi Arabia, Bank Albilad, and Uber.

Expected:

- Apply only the three active classes.
- Leave all other Gmail messages unchanged.
