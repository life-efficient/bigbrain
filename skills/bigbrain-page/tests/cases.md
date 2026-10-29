## Should trigger

Run the seven synthetic [deal consistency forward regressions](deal-consistency/README.md)
for linked deal/task updates. They define prompts, mock records, read/write/send
traces, and an evaluator. Evaluator unit tests are not agent behavior results.

- Create a new canonical page when no owner exists and evidence is sufficient.
- Update an existing canonical page when evidence changes durable understanding.
- Return a verified no-op when a source adds no material change.
- Create a concise page for a key organization, person, or framework that needs standalone context and links.

## Should stop or preserve another shape

- Stop when ownership is ambiguous or evidence supports only a stub.
- Keep a one-off country, planet, or obvious background reference in its owning page rather than creating an incidental entity page.
- Keep task, meeting, and source-sidecar workflows on their specialized shapes.

## Should not trigger by itself

- Change page visibility, maintain the Brain, or create a task.

## Existing deal has successive dated meeting updates

Prompt: Audit and repair a deal whose body begins with an old opportunity description, then appends three dated meeting updates. The newest meeting revises the phase-one capacity, withdraws an earlier claimed customer commitment, and adds technical constraints; some earlier engineering details remain valid.

Expected behavior:
- Read the complete existing page and linked source evidence before rewriting.
- Produce one substantive current briefing organized by the deal, its current terms and technical constraints, relationships, and open questions.
- Replace superseded phase-one capacity and qualify the customer commitment from evidence. Preserve still-useful engineering details, attribution, and uncertainty.
- Keep the three source meetings linked and preserve chronology in the writer-managed timeline. Do not append another dated update section or move a useful technical briefing wholesale out of the body.
- Read the body alone to verify it gives the current understanding without reconstructing updates.

Adjacent request: Summarize the chronology of a specific meeting transcript. Keep the meeting-specific chronology in that specialized record; do not apply the subject-page consolidation rule to erase a requested source account.


## Preserve substantive history during consolidation

Request: Repair a deal page whose body contains three dated meeting updates but whose timeline records only filing corrections.

Expected behavior:
- Build a source-event inventory from the three updates and their linked evidence, then compare against existing timeline entries.
- Synthesize the current body and append each missing substantial milestone through the writer's structured timeline input with its evidenced event date and current recording time.
- Preserve existing entries and per-event provenance; do not duplicate the same event across a meeting and WhatsApp report.
- Keep a proposed investor introduction as proposed unless evidence verifies it happened. Hold an undated milestone rather than assigning the migration date as its occurrence.
- Keep administrative correction separate from progress and verify milestone coverage on read-back. A single cleanup event or links alone fail this case.
