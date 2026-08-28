# BigBrain Action Review forward tests

These cases test judgment, not a persisted task schema. A passing review may
use natural prose, but it must preserve source ownership and make every proposed
task concrete enough to execute and verify.

## Should not replace a source adapter

Prompt:

```text
Use Action Review directly on this raw WhatsApp export and create the tasks.
```

Expected behavior:

- Route the raw communication through the WhatsApp review workflow first so
  visible sender, direction, forwarding, agreement, and current `next_actor`
  are established.
- Run Action Review only after the source adapter prepares attributed evidence.
- Return proposals to the caller rather than creating tasks directly.

Forbidden behavior:

- Interpreting raw WhatsApp evidence without the WhatsApp source rules.
- Writing a Brain task directly from Action Review.

## External owner action and optional offer

Prompt:

```text
Review potential tasks from a meeting about a data-centre opportunity.

Generated summary:
- Coordinate an introduction between WSP and Bloom.
- Harry can provide technical support.

Transcript:
- Kasia: The owners need to introduce WSP to Bloom.
- Harry: If it would be useful, I can help with technical questions.
```

Expected behavior:

- Treat the WSP and Bloom introduction as an external owner-side action.
- Keep Harry's technical help as an optional offer in meeting or deal context.
- Create no Harry task for either item unless later evidence shows that Harry
  accepted a concrete follow-up.

Forbidden behavior:

- Creating a Harry task to coordinate or complete the WSP and Bloom
  introduction.
- Turning the optional technical offer into an open Harry task.

## Corrected Danny and Luciano next actions

Prompt:

```text
Review the meeting again using this user correction and relevant Brain context.

User correction:
- Introduce the opportunity to Data Center Danny to test whether he is a fit
  for the EPC role and for hyperscaler introductions.
- Meet Luciano to introduce the opportunity, identify suitable equity
  investors, and decide whether an investor roadshow would be useful.

Relevant Brain context:
- Data Center Danny is the established contact for data-centre EPC and
  hyperscaler-introduction fit.
- Luciano is the established contact for equity-investor sourcing. A roadshow
  would depend on his initial assessment and willingness to support it.
```

Expected behavior:

- Propose one atomic, specific Danny action: introduce the opportunity to Danny
  to assess EPC fit and hyperscaler-introduction fit.
- Propose a separate atomic, specific Luciano action: meet Luciano to introduce
  the opportunity and assess or source suitable equity investors.
- Keep any investor-roadshow work conditional on Luciano's initial assessment
  and willingness, rather than making it immediately ready.
- Preserve any action-time approval needed before an outbound introduction or
  message.

Forbidden behavior:

- Creating one vague task such as `Find equity, EPC, and end-user partners` or
  `Develop the equity, EPC, and end-user pipeline`.
- Combining Danny and Luciano into one umbrella task.
- Creating an immediately ready investor-roadshow task with no dependency.

## Brain context cannot manufacture ownership

Prompt:

```text
Review potential tasks from this source and the same Danny and Luciano Brain
context.

Source:
- Kasia: The owners need to solve the EPC, hyperscaler, and equity workstreams.
- Harry: I know people who might be able to help if the owners ask.

Brain context:
- Danny could help with EPC and hyperscaler introductions.
- Luciano could help with equity-investor sourcing.
```

Expected behavior:

- Use the Brain context to understand possible routes, but keep the obligation
  with the external owners.
- Treat Harry's statement as an uninvoked optional offer.
- Create no Harry task unless another source establishes that Harry accepted a
  concrete action, the user instructs him to act, or Harry owns a specific
  monitoring follow-up.

Forbidden behavior:

- Using relevant people in the Brain as sufficient evidence that Harry owns the
  work.
- Converting contextual capability into a commitment.

## Explicit Harry monitoring follow-up

Prompt:

```text
Review this additional transcript turn:
- Harry: I will check with Kasia next Tuesday whether the owners connected WSP
  and Bloom.
```

Expected behavior:

- Propose one Harry-owned monitoring task to check the status next Tuesday.
- Keep the owners responsible for making the underlying introduction.

Forbidden behavior:

- Rewriting the task as if Harry owns the WSP and Bloom introduction.
