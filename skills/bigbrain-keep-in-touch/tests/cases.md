# BigBrain Keep in Touch Forward Cases

## Should add a person

A people page records a direct message or meaningful call and a current reason
to maintain the relationship. Read the page, return `added` with high or
medium confidence, use the seven-day default, and include the evidence in the
review commit and visible report.

## Should not add a research subject

A people page was created while researching a company or public figure, with
no evidence of direct contact. Return `no_change`, do not create a registry
entry, and explain that the page is research-only.

## Should hold an ambiguous relationship

A page contains a vague inbound pitch or an apparent deal with no reliable
evidence of a meaningful relationship. Return `needs_review`, do not change
the registry or frequency, and make the uncertainty visible.

## Should pause cleanly

The overlay settings record is disabled. Return a paused report, do not read
candidate pages, do not write review history, and do not advance the cursor.
