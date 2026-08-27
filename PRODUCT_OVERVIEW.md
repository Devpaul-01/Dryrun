# DryRun — Product Overview

**Status:** Backend/API complete. Mobile client (Expo/React Native) in development against this API.

---

## 1. What DryRun Is

DryRun is a sales-practice simulator. A founder or salesperson describes what they sell and who they sell it to, picks a scenario — a cold outreach, a skeptical buyer, a price objection, a prospect who's gone quiet — and has a real-time text conversation with an AI-generated buyer persona built specifically around their product and audience. When the conversation ends, they get a skill breakdown across six axes, a short coaching debrief, and (if they retry the same scenario) a direct before/after comparison against their first attempt.

It is not a chatbot demo. The product is built around the idea that sales pitches fail in a specific, nameable way — the founder doesn't know what actually breaks down until a real prospect is in front of them, and by then it's a lost deal, not a practice rep — and that the fix is a controlled environment to fail in before the stakes are real.

## 2. The Problem

Most people who need to get good at selling — first-time founders, early sales hires, anyone doing outbound for the first time — learn by doing it live. The feedback loop is brutal and slow: you pitch a real prospect, you don't know why it didn't land, and you might not get another shot at that prospect to try a different approach. Role-playing with a colleague helps, but colleagues get tired of playing the skeptical buyer, don't push back the way a real one would, and can't do it at 11pm before a call the next morning.

What's actually missing is a *repeatable* version of the hard conversation — the same skeptical buyer, the same price objection, on demand, as many times as it takes — with an honest read on what changed between attempts.

## 3. Who It's For

- **First-time founders** doing their own outbound before they've hired anyone to do it for them.
- **New sales hires** ramping up on cold outreach without cannibalizing a manager's time as a role-play partner.
- **Anyone practicing a specific hard conversation** — a renewal pushback, a "not right now," a compliance objection — where the value isn't generic sales training but rehearsing *this* scenario against *this* kind of buyer.

The persona-from-document flow in particular is aimed at a founder who already has a real prospect in mind: paste in that company's about page, and the practice session is grounded in an actual target account rather than a generic archetype.

## 4. Core Workflows

### Setting up what you sell
Before a session, the founder does a one-time "Instant Setup": what they sell, who they sell it to, and a rough tone preference. Every persona the system generates afterward is built from this description rather than a generic buyer — that's what makes a generated persona feel like *their* prospect instead of a stock character.

### Building a buyer to practice against
A persona is either:
- **Generated fresh** from the product/audience description and a scenario type, or
- **Synthesized from a real source** — pasted text, a public company URL, or an uploaded document (PDF, DOCX, image via OCR) — so a founder can practice against a persona grounded in an actual prospect's public information, or
- **Reused** — personas are workspace-level, reusable objects, so a founder can build "the skeptical enterprise buyer" once and practice against that exact character across many sessions.

Document- and URL-based personas go through an asynchronous pipeline (extract → synthesize) because OCR and LLM generation aren't instant; the founder starts the session as soon as extraction finishes, watching the persona go from a "Generating…" placeholder to a filled-in character over a realtime status channel.

### The practice session itself
A session pairs a persona with a scenario (cold open, skeptic, price pushback, bad timing, "the long goodbye," radio silence, or a single-exchange micro-drill), an optional pressure modifier (a decision-maker watching, a competitor already in play, a rushed buyer, compliance concerns — up to two stacked at once), a difficulty level that scales automatically with how many sessions the founder has completed, and an optional goal ("get a meeting booked," "get a real yes/no on budget," "surface an objection," "just get a reply").

Every message exchange runs through a single AI call that returns, in one structured response: the buyer's in-character reply, their private internal monologue (what they're *actually* thinking, shown to the founder after the session), a signed delta to their interest/trust/confusion, a buying-intent and objection-likelihood score, a judgment on whether the stated goal was just achieved, and an optional signal that the conversation has reached a natural ending. The founder sees interest and trust move in real time as the conversation progresses — visible proof that a specific line landed or didn't.

If a goal is achieved mid-conversation, the session ends there — "you got what you came for" is treated as a hard stop, not a suggestion the founder can ignore. If the AI signals a natural ending (the buyer's genuinely done, one way or another), the founder decides whether to accept it or push for a few more exchanges.

### Getting the read afterward
Once a session ends, two things generate in the background: a **debrief** (one specific strength, one specific improvement, and the single most important coachable moment from that exact conversation) and a **skill score** across six axes — clarity, value communication, discovery questions, objection handling, brevity, and call-to-action strength — plus a composite and a named weakest/strongest axis. The founder doesn't wait on these; they show up asynchronously and the founder gets notified.

### Retrying and measuring improvement
A retry reuses the *same* persona and scenario deliberately — the product's position is that "your retry attempt against your original session" only means something if the buyer didn't also change. Once both sessions are scored, the system computes an exact numeric delta per axis (never AI-generated arithmetic — computed directly in code) and asks the model for one sentence of encouraging, specific framing around the most notable change.

### Turning a good session into a repeatable script
If a session goes well, the founder can generate a **playbook** from it: an opening message, a set of discovery questions, canned objection responses, a closing call-to-action, and one key insight — extracted from the actual transcript, not written from scratch. Playbooks can be shared via a public, unauthenticated link (with an optional attribution toggle), so a founder can hand a working script to a co-founder or a new hire without giving them app access.

### Staying on track over time
Two background systems close the loop without the founder having to ask for them: a **rolling skill trend** (a 30-session rolling composite average, recomputed after every scored session) and a **curriculum recommendation** (identifies the weakest of the six axes from the last ten sessions, proposes a two-session focused drill on it, and adds a third "spaced repetition" session if a scenario type hasn't been practiced in three weeks). A weekly summary email ties this together — sessions completed, score trend versus last week, strongest/weakest axis, goals hit, badges earned, and the current curriculum focus.

### Trying it before signing up
A visitor can run a capped demo session (no login, no persona storage, eight messages) against one of three preset personas. Converting to a real account migrates that exact conversation — transcript, persona, and all — into the new account as their first completed session, so the demo isn't throwaway; it becomes real history.

### Practicing as a team
Workspaces support multiple members with owner/admin/member roles. An admin can see aggregate team skill trends, but — deliberately — never an individual member's raw transcript or debrief. The privacy boundary here isn't a UI convention; the aggregate-progress query is structurally incapable of selecting session content, because it never joins against the tables that hold it.

## 5. Product Decisions Worth Noting

**A session goal is a hard judgment, not a vibe.** Each goal type (book a meeting, get a real yes/no, surface an objection, just get a reply, or a custom goal) has an explicit per-turn criterion given to the model — "sure, Tuesday works" counts as booking a meeting, "maybe sometime" doesn't. Once achieved, it's locked permanently for that session; the model is asked to keep confirming it every turn specifically so the backend doesn't have to trust a single judgment call, but the backend — not the model — is what actually enforces the one-way lock.

**Retries never regenerate the buyer.** An earlier version of this feature generated a fresh persona for every retry, which meant "your retry" and "your original" were actually two different buyers — comparison scores that looked meaningful were confounded by a different character reacting differently. Retry sessions now explicitly carry the original persona forward.

**Momentum is computed, not asked for.** The model reports raw interest/trust/confusion deltas per turn; a rolling three-turn momentum figure (used to show whether a conversation is heating up or cooling off) is calculated server-side from the accepted deltas, on the same principle as the retry comparison deltas — anything that can be computed exactly is computed exactly, not delegated to the model.

**Long conversations don't lose their memory, but the record never gets rewritten.** Only a bounded recent window of messages is sent to the live-turn model on every call, to keep latency and cost predictable regardless of how long a session runs. Once a session crosses a message-count threshold, a background job summarizes everything *outside* that window into a compact synthetic note, which gets prepended ahead of the raw window on future turns — so the buyer stays coherent with something said fifty messages ago without resending the full transcript every time. The underlying message history itself is never edited, regenerated, or deleted — a deliberate stance that a practice record should stay an honest record of what was actually said, not something either party can retroactively clean up.

**Free-tier limits are a data question the product answers gradually, not a wall on day one.** Payment enforcement is a runtime flag, not a deploy-time decision — every entitlement check runs unconditionally, but if the flag is off, the check always passes and logs that it *would* have blocked the action. That gives a real usage signal ("how many people would actually hit the free session cap") before the cap is ever turned on for real users.

## 6. How the Pieces Fit Together

The workflows above aren't independent features bolted together — they're stages of one loop: **describe what you sell → build a buyer to practice against → have the conversation → get an honest read on how it went → fix the specific thing that's weakest → try again and see the number move.** Personas feed sessions; sessions feed debriefs, scores, and playbooks; scores feed the skill trend and curriculum; the curriculum points back at a new session with a specific scenario in mind. Nothing in the loop is optional filler — each stage exists because the stage before it would be inert without it (a session score means nothing without a trend to place it against; a trend means nothing without a curriculum recommendation acting on it).
