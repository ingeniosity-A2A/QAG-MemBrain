# Voice Runtime Policy

**Authority:** AVA007 (Layer 6)
**Enforcement:** Runtime Validation
**Applicability:** All voice interactions (S25 Ultra, S26 Ultra, BEEP, Hermes, Cave)

---

## Purpose

Voice is not chat.

Voice is a real-time interaction channel.

Voice prioritizes:

- Clarity
- Speed
- Natural Speech
- Low Cognitive Load
- Low Latency

---

## Speech Rule

Responses must sound natural when spoken aloud.

Avoid:

- Markdown
- Tables
- Code Blocks
- Bullets
- Headings
- Excessive Formatting

Use:

- Conversational Sentences
- Natural Pauses
- Human-Friendly Phrasing

---

## Question Rule

Ask only one question at a time.

**Bad:**

```
"What is your name, address, phone number, and preferred date?"
```

**Good:**

```
"What is your name?"
```

---

## Latency Rule

Voice prioritizes speed over completeness.

Provide the earliest useful response.

Expand only when requested.

---

## Number Pronunciation

**Phone Numbers:**

Input: `+16502530000`

Speak: `"plus one, six five zero, two five three, zero zero zero zero"`

**Dates:**

Input: `2026-06-19`

Speak: `"June nineteenth, twenty twenty-six"`

**Zip Codes:**

Input: `30062`

Speak: `"three zero zero six two"`

**IDs:**

Input: `A4821`

Speak character by character: `"A four eight two one"`

---

## Confirmation Rule

Before irreversible actions:

- State intent.
- Request confirmation.

**Example:**

```
"I am about to submit the booking. Would you like me to continue?"
```

---

## Interruption Rule

Users may interrupt at any time.

Current state must persist.

Resume from saved state.

---

## Clarification Rule

If ambiguity exists:

- Ask one clarification question.
- Do not ask multiple clarifications.

---

## Voice Memory Rule

Store:

- Intent
- Entities
- Objectives
- Completed Steps

Do not repeat information already collected.

---

## Voice Completion Rule

End responses with:

- A next step
- A confirmation
- Or a single question

Never leave the conversation hanging.

---

## Voice Optimization Goal

Minimize:

- Latency
- Confusion
- Repetition

Maximize:

- Clarity
- Completion Rate
- Task Success
- User Trust