# Agentic AI Content Studio

A daily automation that produces **one faceless 60-second video package** per day
for **manual** upload to YouTube / TikTok. Built on [Trigger.dev](https://trigger.dev)
v4 + TypeScript.

> **Status: Step 1 — Foundation only.** Project structure, niche rotation, env
> validation, logging, and shared types are in place. AI scripting, video
> rendering, storage, and Telegram notifications are **not built yet**.

## How it works (the plan)

Every day a scheduled task picks the active **niche** and (in later steps) builds
a complete video package. The niche rotates on a fixed schedule:

| Order | Niche                | Style                                         |
| ----- | -------------------- | --------------------------------------------- |
| 1     | Scary Stories        | Short, original horror micro-stories.         |
| 2     | Tech News            | A punchy recap of one notable tech story.     |
| 3     | Relationship Advice  | One practical, actionable relationship tip.   |
| 4     | User Storytelling    | A 60s story built from a user-submitted idea. |

**Rotation rule:** each niche stays active for **3 days**, then moves to the next,
wrapping back to the first after the last.

## Project structure

```
src/
  config/
    env.ts          ← read + validate raw environment variables ONLY
    runtime.ts      ← settings derived from env (environment, timezone, output dir)
    constants.ts    ← fixed values (video length, rotation days, niches, platforms)
    app.ts          ← composes runtime + constants into one `appConfig`
    niches.ts       ← the niches, in rotation order, + lookup helper
  core/             ← reusable CONTRACTS + orchestration (no business logic)
    workflow-state.ts   ← the named pipeline stages (Pending → ... → Completed)
    workflow-context.ts ← the shared "backpack" passed to every agent
    base-agent.ts       ← the one execute() contract every agent implements
    workflow-step.ts    ← the unit of work the engine runs
    workflow-definition.ts ← a named, ordered list of steps (a "recipe")
    execution-result.ts ← the typed "report card" a run returns
    execution-events.ts ← typed events (started/completed/failed) — contracts only
    retry-policy.ts     ← retry-policy data contracts (no retry logic)
    state-machine.ts    ← validates state transitions; rejects invalid ones
    agent-registry.ts   ← register/resolve agents (dependency injection)
    workflow-engine.ts  ← the conductor: runs steps, drives state, returns result
    lifecycle/          ← the SAME execution skeleton every agent inherits
      agent-lifecycle.ts  ← abstract base class; runs the steps in order
      agent-hooks.ts      ← optional before/after/onError slots
      agent-result.ts     ← the standard "report card" each agent returns
      agent-metrics.ts    ← typed run metrics (mostly placeholders)
      agent-timing.ts     ← a tiny stopwatch (start/finish/duration)
    records.ts          ← data shapes that repositories store
    repositories.ts     ← storage abstractions (no DB/ORM/SQL)
    cost.ts             ← cost-tracking contracts (no providers, no maths)
    agents/             ← interface-only placeholders for the 9 future agents
    index.ts            ← one import point for the whole core layer
  pipeline/         ← the shared DATA MODEL every agent reads from / writes to
    pipeline-data.ts    ← the one central object (all sections optional)
    video-package.ts    ← the final deliverable once the run completes
    pipeline-builder.ts ← create a fresh/empty PipelineData
    pipeline-update.ts  ← immutable helpers (return updated COPIES)
    validators.ts       ← validation contracts (no checks implemented)
    models/             ← one focused file per section (topic, script, video...)
    index.ts            ← one import point for the whole pipeline layer
  providers/        ← swappable INTERFACES to outside services (+ mocks)
    research/
      research-provider.ts      ← the ResearchProvider contract
      mock-research-provider.ts ← fake-but-realistic data (no AI, no network)
      types.ts                  ← request/response shapes
    script/
      script-provider.ts        ← the ScriptProvider contract
      mock-script-provider.ts   ← fake-but-realistic script (no AI, no network)
      types.ts                  ← request/response shapes
    voice/
      voice-provider.ts         ← the VoiceProvider contract
      mock-voice-provider.ts    ← fake voice direction METADATA (no audio/files)
      types.ts                  ← request/response shapes
  agents/           ← concrete agent IMPLEMENTATIONS (extend AgentLifecycle)
    research/
      research-agent.ts ← reads topic, calls provider, writes research
    script/
      script-agent.ts   ← reads topic + research, calls provider, writes script
    voice/
      voice-agent.ts    ← reads script, calls provider, writes voiceover (metadata)
  demos/            ← tiny runnable demonstrations (not Trigger.dev tasks)
    research-demo.ts  ← Research → Script → Voice chain · `npm run demo:research`
  lib/
    logger.ts       ← tiny structured (JSON) logger, safe for shared code
    errors.ts       ← typed error classes (retryable flag + toJSON for logging)
    correlation.ts  ← unique correlationId per workflow run (framework-agnostic)
    niche-rotation.ts ← pure function: which niche belongs to a given date
  trigger/
    content-studio/
      generate-daily-video.ts ← the daily scheduled task (skeleton for now)
  types/
    index.ts        ← shared domain types (Niche, Platform, VideoPackage, ...)
trigger.config.ts   ← project ref, runtime, retries, task dir
.env / .env.example ← secrets (git-ignored) + a committed template
```

### Foundation modules (Step 2)

- **Config is split by responsibility:** `env.ts` only *reads/validates* env vars;
  `constants.ts` holds *fixed* values; `runtime.ts` holds *derived* settings;
  `app.ts` *composes* them. Import `appConfig` for one-stop access.
- **Typed errors** (`lib/errors.ts`): a shared `BaseError` plus `ValidationError`,
  `ConfigurationError`, `AIProviderError`, `RateLimitError`, `StorageError`,
  `RetryableError`, `NonRetryableError`. Each carries a stable `code`, a
  `retryable` flag, and `toJSON()` for structured logging. Use `isRetryable(err)`
  to decide whether to retry.
- **Correlation IDs** (`lib/correlation.ts`): `newCorrelationId("daily-video")`
  tags every log line of one run so it can be traced end-to-end.

### The core layer (Step 2A)

`src/core/` holds the **contracts** — the agreed shapes and rules — that the rest
of the system is built on. It contains **no business logic, no AI, no providers,
and no database**; it only describes *how* the pieces talk to each other.

**What's in it**

- **WorkflowState** — the named stages a run moves through (`pending` →
  `researching` → … → `completed`/`failed`), as a value *and* a type. Extensible:
  add a stage with one line.
- **WorkflowContext** — the read-only "backpack" handed to every agent. It carries
  the `correlationId`, `executionId`, current `state`, current `niche`, the
  `logger`, the `runtime` config, and `startedAt`. State changes create a *new*
  context via `withWorkflowState()` instead of mutating.
- **BaseAgent<TInput, TOutput>** — the single contract every agent implements: one
  `execute(context, input)` method. Generics let each agent pick its own input and
  output types while still being run the same way.
- **Repositories** (`WorkflowRepository`, `ExecutionRepository`, `AssetRepository`)
  — interfaces describing *what* can be saved/fetched, not *where*. A real backend
  is slotted in later without touching any agent.
- **Cost contracts** (`ModelUsage`, `ProviderCost`, `ExecutionCost`) — the shape of
  future billing data. No prices, no calculations yet.
- **Agent placeholders** — interface-only files for the nine future agents
  (Research, Script, Voiceover, VisualAsset, VideoAssembly, SEO, QualityReview,
  Storage, Notification). Each `extends BaseAgent`.

**Why interfaces before implementations?**
Agreeing on the contract first means every part can be built (and tested) in
isolation, swapped out, or stubbed — without surprises. Code depends on the
*interface*, never on a specific implementation, which keeps the system loosely
coupled and easy to scale.

**How future agents plug in**
A future agent simply implements its interface — e.g. a real `ScriptAgent`
provides `execute(context, input)` returning a `ScriptOutput`. The orchestrator
calls every agent through the same `BaseAgent` contract, so adding or replacing an
agent never ripples through the rest of the codebase.

### The workflow engine (Step 2B)

The core layer now includes the **orchestration** machinery — the part that
actually *runs* a pipeline — while still knowing nothing about AI, providers,
storage, video, or Telegram.

- **Workflow Engine** (`workflow-engine.ts`) — the conductor. Give it a
  `WorkflowContext` and a `WorkflowDefinition` (an ordered list of steps) and it
  runs each step in order, feeds each step's output into the next step's input,
  advances the state *through the state machine*, stops at the first failure, and
  returns a typed `ExecutionResult`. It can optionally call an `onEvent` listener
  with typed events as it goes.
- **State Machine** (`state-machine.ts`) — the rules for moving between stages.
  It's a one-way road: you may move to the next stage, or jump to `failed` from
  any active stage. Anything else throws `InvalidStateTransitionError`. The engine
  never changes state directly — it asks the state machine first. To change the
  pipeline order, edit the single `WORKFLOW_SEQUENCE` array.
- **Agent Registry** (`agent-registry.ts`) — a phone book of agents. Code
  registers an agent under its name and later resolves it by name, so the engine
  (or a workflow builder) never constructs agents with `new`. That indirection
  enables dependency injection, fakes in tests, and provider swaps.
- **Supporting contracts** — `WorkflowStep`, `WorkflowDefinition`,
  `ExecutionResult` (`success`/`failed`/`skipped`/`cancelled`), typed
  `WorkflowEvent`s, and `RetryPolicy` data (no retry logic yet).

**Why orchestration is separated from business logic**
The engine answers *"what runs, in what order, and what happens on failure?"* The
agents answer *"how do I write a script / make a voiceover?"* Keeping these apart
means you can test the whole pipeline's control-flow with simple fake steps, swap
any agent without touching the engine, and reuse the exact same engine for
completely different workflows. One small, stable conductor; many interchangeable
performers.

### The pipeline data model (Step 3)

`src/pipeline/` defines **one shared object** — `PipelineData` — that the entire
workflow reads from and writes to. It contains only data shapes and pure helpers:
no business logic, AI, providers, storage, or database code.

**Why every agent shares one PipelineData object**
Imagine a single folder passed from desk to desk. The researcher drops in their
notes, the scriptwriter adds the script, the renderer adds the video file, and so
on. Because everyone works on the *same* folder, there's a **single source of
truth** — no agent has to guess what another produced, and nothing gets lost in
ad-hoc objects passed between steps. Every section is **optional** because each
stage fills in a different part; a field stays `undefined` until the stage that
produces it has run.

**Why immutable updates are preferred**
Agents never scribble on the shared folder directly. Instead they make a
**photocopy with their addition** and hand that back (see `pipeline-update.ts`:
`updatePipeline`, `setSection`, `appendScene`, …). Immutable updates keep data
predictable — an agent holding a reference can trust it won't change underneath
them — and they make it easy to keep a history of each stage for debugging.

**How PipelineData evolves during a run**
```
start            → {}                      (empty, from createEmptyPipelineData)
research stage   → { research }            (research filled in)
script stage     → { research, script }    (script added, research untouched)
scene stage      → { ..., scenes }
voiceover stage  → { ..., voiceover }
render stage     → { ..., video }
seo / qa / store → { ..., seo, qa, storage }
complete         → assemble a VideoPackage (the final deliverable)
```
Each arrow is a **new copy** with one more section filled — the object grows as
the workflow advances, never losing what came before.

**How agents will use it (the contract)**
Every future agent will follow the same shape: receive a `WorkflowContext` and the
current `PipelineData`, do its job, and return an **updated `PipelineData`** — never
an unrelated custom object.

### The agent lifecycle framework (Step 4)

`src/core/lifecycle/` gives every future agent the **same execution skeleton** so
none of them re-write timing, validation, error handling, or result-shaping. It is
pure framework — no AI, providers, storage, rendering, or business logic.

**Why every agent follows the exact same lifecycle**
A real agent only has to answer one question: *"what work do I do?"* (the `execute`
method). Everything around that work — start a timer, check the input, run the
work, check the output, handle errors, build a tidy result — is identical for
every agent, so the base class (`AgentLifecycle`) does it once for all of them. The
fixed order is:

```
beforeExecute → validateInput → execute → validateOutput → afterExecute → onSuccess
   (on error instead) → onFailure + onError
   (always, at the end) → cleanup
→ returns an AgentResult { success, durationMs, warnings, errors, metrics, pipelineData, correlationId }
```

**Why hooks exist**
The lifecycle steps are **optional override slots** ("hooks"). By default they do
nothing. An agent that needs something extra — warm a cache before running, emit a
metric afterwards, release a resource on error — just overrides that one hook and
leaves the rest alone. No agent is forced to care about steps it doesn't use.

**How this reduces duplicated code**
Without the framework, every agent would copy-paste the same try/catch, stopwatch,
and result-building boilerplate — and each copy could drift or hide a bug. With it,
that logic lives in ONE place. A new agent is just: `extends AgentLifecycle`,
implement `execute()`, done. Less code, fewer bugs, and a guarantee that every
agent behaves consistently.

### The first real agent: ResearchAgent (Step 5)

`src/agents/research/` contains the first working agent, and `src/providers/research/`
the service abstraction it depends on. Try it:

```bash
npm install         # first time only (adds the tsx runner)
npm run demo:research
```

**Why providers are abstracted**
The agent never talks to OpenAI/Claude/Perplexity directly. It talks to a
`ResearchProvider` *interface* (`researchTopic`, `validateTopic`, `summarize`).
Today a `MockResearchProvider` implements that interface with fake-but-realistic
data — no network, no API key. Tomorrow a real AI provider implements the *same*
interface, and the agent doesn't change at all. The interface is a stable
"socket"; providers are interchangeable "plugs".

**Why dependency injection is used**
The provider is passed INTO the agent through its constructor
(`new ResearchAgent(provider)`) — the agent never builds its own provider. This
"inject the dependency" approach means you can hand the agent a mock in tests, a
real provider in production, or a different provider entirely, all without
touching the agent's code. It also keeps the agent easy to reason about: its
dependencies are explicit.

**Why we start with mocks before AI**
Mocks let us build and prove the *entire* shape of the system — the lifecycle, the
pipeline updates, registration, the result — quickly, deterministically, and for
free. No flaky network, no spend, no keys. Once the architecture is solid, swapping
in real AI is a small, low-risk change rather than a leap of faith.

**What the demo shows**
It creates a `PipelineData` with a topic, registers the `ResearchAgent` (built with
the mock provider) in the registry, resolves it by name, runs it, and prints the
updated pipeline — `PipelineData.research` is now filled in, while the rest of the
pipeline is untouched (immutable update).

### The second agent: ScriptAgent (Step 6)

`src/agents/script/` adds the next agent, following the exact same pattern. The
demo now runs **Research → Script** over one shared pipeline (`npm run demo:research`).

**Why Script depends on Research**
A script is only as good as the facts behind it, so the `ScriptAgent` reads
`PipelineData.research` (the summary + key points the `ResearchAgent` produced) and
turns it into a title, hook, body, and call-to-action. This is the pipeline pattern
in action: each agent consumes what earlier stages wrote and adds its own section.
If research is missing, the agent raises a `ValidationError` — the lifecycle catches
it and returns an `AgentResult` with `success: false` (a clean failure, not a crash),
so the demo can stop gracefully instead of throwing.

**Why agents should never know provider implementations**
The `ScriptAgent` only knows the `ScriptProvider` *interface* (`generateScript`,
`improveHook`, `generateCTA`, `validateLength`). It has no idea whether the script
came from a mock, OpenAI, or Claude — and that's the point. Hiding the
implementation behind an interface means we can change the model, the vendor, or
the pricing later without editing a single line of agent code. The agent stays
focused on *what* it needs; the provider decides *how* to deliver it.

### The third agent: VoiceAgent (Step 7)

`src/agents/voice/` adds the voiceover stage. The demo now runs
**Research → Script → Voice** (`npm run demo:research`).

**Metadata only — no audio.** This stage produces voice *direction*, not sound:
the narration text, speaker, voice id, language, speaking style, speed, estimated
length, pronunciation notes, pauses, and emphasis markers. No audio is generated,
no files are written, no network is used — a future render step turns this
direction into an actual audio file.

**Voice depends on Script.** The `VoiceAgent` reads `PipelineData.script` and writes
`PipelineData.voiceover`. If the script is missing it raises a `ValidationError`,
which the lifecycle turns into an `AgentResult` failure (no crash) — exactly like
the ScriptAgent's dependency on research.

**One small, necessary model change.** The Step-3 `Voiceover` model was a
placeholder assuming a finished audio file. To store the voice *direction* this
step produces, the model was extended **additively**: optional metadata fields were
added, and `audioLocation`/`durationSeconds` were made optional (no audio file
exists yet). This is backward-compatible — nothing read those fields — and every
existing abstraction (PipelineData, AgentLifecycle, providers, DI, immutable
updates) is untouched.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Put your Trigger.dev project ref in trigger.config.ts
#    (replace REPLACE_WITH_YOUR_PROJECT_REF — find it at cloud.trigger.dev → Settings)

# 3. Log in to the Trigger.dev CLI (one-time, opens a browser)
npm run login

# 4. Copy the env template and start the dev server
cp .env.example .env
npm run dev
```

## Environment variables

- Real secrets live in `.env` (git-ignored). A committed `.env.example` documents
  every key.
- Every secret must ALSO be added in the Trigger.dev dashboard (your project →
  Environment Variables) for **both** staging and prod, or production runs fail.
- Read secrets via the helpers in `src/config/env.ts` — never `process.env`
  directly, and **never log a secret's value**.

## Scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run login`     | Authenticate the Trigger.dev CLI      |
| `npm run dev`       | Start the Trigger.dev dev server      |
| `npm run deploy`    | Deploy tasks to production            |
| `npm run typecheck` | Type-check without emitting files     |

## Roadmap (not built yet)

- [ ] **AI scripting** — generate a 60s script tailored to the day's niche
- [ ] **Video render** — voiceover + vertical (9:16) 60s video
- [ ] **Storage** — save packages to local folder, Google Drive, and cloud storage
- [ ] **Notifications** — Telegram message with the finished package + links

## Testing

Once the dev server is running:

1. Open the Trigger.dev dashboard → **Test** tab.
2. Run `generate-daily-video`.
3. Confirm the logs show the correct niche for today's date and the run succeeds.

## Troubleshooting

- **Missing env var in production** — added to `.env` but not the dashboard.
- **Import path errors** — TypeScript task-to-task imports need a `.js` extension.
- **Wrong niche** — check `ROTATION_ANCHOR` / `DAYS_PER_NICHE` in
  `src/lib/niche-rotation.ts`.
