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

## AI providers

The Provider SDK Layer (`src/ai/providers/`) isolates every LLM behind the
`ProviderClient` interface. The first real provider is **Anthropic Claude**
(`src/ai/providers/claude/`) — its Anthropic SDK usage and types never leave that
folder. To try it:

1. Add your key to `.env`: `ANTHROPIC_API_KEY=sk-ant-...` (from
   [console.anthropic.com](https://console.anthropic.com/)). Never commit it.
2. Run `npm run demo:claude` — sends one normalized `ProviderRequest` through
   `ClaudeProviderClient` to the real API and prints the standardized
   `ProviderResponse` (content, usage, model, latency). Without a key it exits
   cleanly with a notice.

Adding OpenAI/Gemini later follows the exact same pattern: a sibling
`providers/<name>/` adapter implementing `ProviderClient`, plus one `case` in the
factory — nothing upstream (AI Kernel, agents) changes.

## AI Kernel

The **AI Kernel** (`src/ai/`) is the single public entry point for every AI
interaction. A caller provides only a prompt id, variables, and the expected
output — never prompts, providers, models, or tokens. One call,
`kernel.generate(request)`, runs the whole lifecycle:

1. **PromptManager** resolves the prompt and its **active version** (e.g. `v2`).
2. It **renders** the version's template with the caller's variables.
3. The kernel picks **model / temperature / provider** — request override →
   prompt metadata (`preferredModel`, `preferredProvider`, `temperature`) →
   `ModelSelector` fallback.
4. The **Provider Factory** returns a `ProviderClient` for that provider.
5. The kernel builds a normalized `ProviderRequest` and calls the **Provider SDK
   Layer** (real Claude, or the mock).
6. The **ResponseValidator** turns the returned content into the expected type.
7. **TokenTracker** and **CostTracker** record usage (cost is still a placeholder).
8. It returns a typed **`AIGenerateResult`** (output, prompt id + version,
   provider, model, token usage, latency).

Two factories, identical pipeline — only the injected Provider Factory differs:

- `createDefaultAIKernel()` — offline; every request is served by the mock
  provider. No key, no network. Used by `npm run demo:ai`.
- `createClaudeAIKernel()` — live; routes `"claude"` prompts to the real
  Anthropic adapter. Requires `ANTHROPIC_API_KEY`. Used by `npm run demo:generate`.

**How a future ResearchAgent will use it** — one call, nothing else:

```ts
const result = await kernel.generate<string>({
  promptId: "research.system",
  variables: { topic, audience, tone, language, Platform },
  expectedOutput: { format: "text" },
});
// result.output, result.model, result.usage.totalTokens, result.latencyMs ...
```

The agent never imports `PromptManager` or a `ProviderClient`, never sees the
Anthropic SDK, and never handles model names or tokens. Swapping Claude for
OpenAI is a factory change — the agent code is untouched.

## Real AI research (the first AI-powered agent)

`ClaudeResearchProvider` (`src/providers/research/`) is the first provider that
runs on real AI. It implements the **same `ResearchProvider` interface** the mock
did, so `ResearchAgent` was swapped onto it with **zero agent changes**. Its only
route to AI is `AIKernel.generate()` — no Anthropic SDK, no prompt text, no model
names, no HTTP inside the provider. Run it with `npm run demo:research` (needs
`ANTHROPIC_API_KEY`).

**Prompt validation — `requiredVariables`.** A prompt now declares the variables
it *must* have in its metadata, e.g. `research.system`:

```ts
requiredVariables: ["topic", "audience", "tone", "language", "platform"]
```

Before it renders anything, `PromptManager.renderPrompt()` checks every required
variable is present **and non-empty**. If one is missing it throws a
`PromptValidationError` (listing exactly what's missing) instead of rendering a
prompt with a `{{hole}}` in it. Because the check lives in the one render choke
point, **every** caller — including the AI Kernel — is protected. This is what
prevents the silent "the model got a broken prompt" class of bug: a missing
variable fails loudly and early rather than producing a confusing result.

**How `ResearchAgent` stays provider-independent.** The agent depends only on the
`ResearchProvider` interface, injected via its constructor. It calls
`provider.researchTopic(...)` and maps the result into the pipeline — it has no
idea whether that provider is the mock or Claude. The `ClaudeResearchProvider`
supplies the extra prompt context the agent doesn't carry (audience, tone,
language, platform) from its own config, builds one `AIGenerateRequest`, and maps
the parsed `ResearchResult` back down to the interface's `ResearchProviderResult`.
Result: real AI, same agent, same interface.

## Content planning (the stage between research and script)

`ClaudeContentPlanningProvider` (`src/providers/content-planning/`) turns a
`ResearchResult` into a strongly-typed **`ContentPlan`** — the blueprint for the
video. Like the research provider, its only route to AI is `AIKernel.generate()`
(no Anthropic SDK, no prompt text, no model names, no HTTP). Run it with
`npm run demo:content-plan` (needs `ANTHROPIC_API_KEY`). It is a **provider demo
only — not wired into the workflow yet.**

The pipeline is becoming:

```
Research → Content Plan → Script
```

**Why Content Planning exists.** Raw research is a pile of facts; it doesn't say
what the *video* is. The plan makes the creative decisions once, in a structured
way: the hook, the core message, the ordered sections (with per-section durations
and key points), the call-to-action, the visual style, and any risk notes — all
pinned to a target duration. That's the difference between "here are 5 facts about
AI in healthcare" and "here's a 60-second video: 8s hook → 16s diagnosis →
16s personalized care → 14s oversight → 6s wrap, ending on a comment prompt."

**Why Script should consume a `ContentPlan`, not raw research.** If the Script
agent read research directly, it would have to re-decide structure, pacing, hook,
and CTA every time — mixing creative planning with line-by-line writing, and
producing inconsistent results. Consuming a `ContentPlan` means the script writer
just *voices* an already-approved structure: it knows exactly how many seconds
each beat gets and what each must land. Planning and writing become separate,
reviewable, individually-improvable steps.

**How future agents reuse the same plan.** The `ContentPlan` is the shared source
of truth for the whole back half of the pipeline:

- **Storyboard** reads `sections[]` + `visualStyle` to shot-list each beat.
- **Thumbnail** reads `hook` + `visualStyle` for the cover concept.
- **SEO** reads `coreMessage` + `targetAudience` + `callToAction` for title/description/tags.
- **QA** checks the finished script/video against the plan (duration, beats, CTA, `riskNotes`).

One plan in, many agents out — each working from the same structured decisions
instead of re-deriving them from raw research.

> Prompt note: `content-plan.system` and `content-plan.user` both live in Prompt
> Management with required variables. The current AI Kernel sends one prompt per
> call (as the user message), so the provider drives the self-contained
> `content-plan.user`; `content-plan.system` is registered as the system-role
> prompt for when the kernel gains separate system-message support.

## Narrative generation (the spoken script)

`ClaudeNarrativeProvider` (`src/providers/narrative/`) turns a `ContentPlan` into
a timed **`NarrativeScript`** — the exact words to speak, broken into segments on
a 0→~60s timeline, each tagged with an `emotion` and a `visualHint`. Same rules
as the other providers: only `AIKernel.generate()`, no Anthropic SDK, no prompt
text, no model names, no HTTP. Run it with `npm run demo:narrative` (needs
`ANTHROPIC_API_KEY`). **Provider demo only — not wired into the workflow yet.**

The pipeline is now:

```
Research → Content Plan → Narrative
```

**Why a structured `NarrativeScript` beats plain text.** A wall of narration text
forces every downstream step to re-parse it and guess: where does one beat end?
how long is it? what should be on screen? By making the structure explicit —
timed `segments[]` with `startSecond`/`endSecond`, `text`, `emotion`,
`visualHint` — the hard decisions (pacing, timing, delivery, visuals) are made
once and encoded, so nothing downstream has to reverse-engineer them. It's also
directly checkable: you can assert the timeline is contiguous and lands near 60s.

**How every downstream agent consumes the same `NarrativeScript`:**

- **Voice** synthesizes each segment's `text` with `emotion` guiding delivery.
- **Captions** get on-screen text and exact timing straight from `startSecond`/`endSecond`.
- **Storyboard** turns each segment's `visualHint` into a shot for that time window.
- **QA** checks the timeline is contiguous, lands near the target duration, and matches the plan.
- **Video Composition** aligns voice, captions, and visuals on the one shared timeline.

One timed script in, the entire audio/visual assembly out — every agent reading
the same segments instead of re-cutting a plain-text blob.

## Visual direction (the art-direction brief)

`ClaudeVisualDirectionProvider` (`src/providers/visual-direction/`) turns a
`NarrativeScript` into a **`VisualDirectionPlan`** — for each narration segment it
recommends an `assetType` (stock-video, ai-image, ai-video, motion-graphics,
screen-recording, mixed), plus camera movement, visual style, color mood,
transition, animation style, and a preferred source. Same rules: only
`AIKernel.generate()`, no Anthropic SDK, no prompt text, no model names, no HTTP.
Run it with `npm run demo:visual-direction` (needs `ANTHROPIC_API_KEY`).
**Provider demo only — not wired into the workflow yet, and no assets are
generated here.**

The pipeline is now:

```
Research → Content Plan → Narrative Timeline → Visual Direction
```

**Why Visual Direction exists BEFORE Storyboard.** A storyboard commits to
concrete shots — specific frames, specific assets. Deciding that per shot without
a guiding brief produces an incoherent, mismatched look. Visual Direction makes
the *art-direction* decisions first, once, across the whole timeline: the color
mood, the motion language, when to use real footage vs. AI vs. motion graphics.
It's the difference between "each shot invented in isolation" and "every shot
drawn from one consistent visual system." Storyboard then executes that system
instead of guessing it.

**How the next stages reuse the `VisualDirectionPlan`:**

- **Storyboard** turns each segment's direction into a concrete shot/frame description.
- **Scene Planning** groups segments and sequences transitions using `transition` + `cameraMovement`.
- **Asset Generation** reads `assetType` + `preferredSource` to route each segment to the right pipeline (stock search, image model, video model, motion-graphics template).

Because it's keyed by `segmentId`, the plan lines up 1:1 with the narration
timeline — so voice, captions, and visuals all share the same segment grid.

## Asset planning (the sourcing brief)

`ClaudeAssetPlanningProvider` (`src/providers/asset-planning/`) turns a
`VisualDirectionPlan` into an **`AssetPlan`** — for each segment it recommends
*where* the asset comes from (a `primaryProvider` + `fallbackProvider` from
Pexels, Pixabay, Unsplash, Runway, OpenAI Images, Google Veo, User Library, Local
Storage) and *how* to get it (`searchQueries` for stock, a detailed `visualPrompt`
for AI), plus estimated duration and licensing notes. Same rules: only
`AIKernel.generate()`, no Anthropic SDK, no prompt text, no model names, no HTTP.
Run it with `npm run demo:asset-plan` (needs `ANTHROPIC_API_KEY`). **Provider demo
only — it downloads and generates NOTHING; it only recommends providers.**

The pipeline is now:

```
Research → Content Plan → Narrative → Visual Direction → Asset Plan
```

**Why Asset Planning exists BEFORE Asset Generation.** Generating/fetching assets
is the slow, expensive, failure-prone part (rate limits, paid credits, licensing,
providers that go down). Deciding *what to source and from where* is fast, cheap,
and fully reviewable. Separating them means you can inspect and approve the whole
sourcing strategy — providers, queries, prompts, licensing — before spending a
single API credit, and you get built-in resilience: every segment already carries
a `fallbackProvider` for when the primary fails. It also keeps the plan
provider-agnostic: swapping Pexels for Pixabay is a plan edit, not a code change.

**How Storyboard and Asset Generation reuse the `AssetPlan`:**

- **Storyboard** pairs each `AssetPlanSegment` with its `VisualDirectionSegment`
  (same `segmentId`) to lay out concrete shots with a known source and duration.
- **Asset Generation** executes the plan per segment: it routes `stock-video` to
  the stock `searchQueries`, `ai-image`/`ai-video` to the `visualPrompt`, and
  falls back to `fallbackProvider` on failure — checking `licenseRequirements`
  before anything is used.

Keyed by `segmentId`, the AssetPlan stays aligned 1:1 with narration, visual
direction, voice, and captions — one shared segment grid all the way through.

## Scene planning (the execution contract)

`ClaudeScenePlanningProvider` (`src/providers/scene-planning/`) **merges** the
`NarrativeScript`, `VisualDirectionPlan`, and `AssetPlan` into one **`ScenePlan`**
— an ordered list of fully-specified `Scene`s. Each scene pins everything needed
to actually build that moment: `startSecond`/`endSecond`, `primaryAsset` +
`fallbackAsset`, `cameraMovement`, `transitionIn`/`transitionOut`, `overlayText` +
`captionPosition`, `voiceSegmentId`, `musicMood`, and notes. Same rules: only
`AIKernel.generate()`, no Anthropic SDK, no prompt text, no model names, no HTTP.
Run it with `npm run demo:scene-plan` (needs `ANTHROPIC_API_KEY`). **Provider demo
only — it generates nothing.**

The full planning pipeline is now:

```
Research → Content Plan → Narrative → Visual Direction → Asset Plan → Scene Plan
```

**Why the `ScenePlan` is the execution contract.** Everything upstream is a
*planning* artifact — one concern at a time (facts, structure, words, look,
sourcing). The `ScenePlan` is where they converge into a single, unambiguous
build order: for each moment on the timeline, exactly what asset to fetch, how the
camera moves, what text is on screen, which voice line plays, and how scenes
transition. Production stages don't re-plan or cross-reference five documents —
they read one `Scene` and execute it. It's the handoff line between "deciding what
the video is" and "building it," and because every field is explicit and typed,
the whole video can be reviewed and validated *before* a single second is rendered.

**How every production stage consumes the same `ScenePlan`:**

- **Asset Generation** fetches/creates `primaryAsset` per scene (falling back to `fallbackAsset`).
- **Voice Generation** synthesizes the line for each scene's `voiceSegmentId` and aligns it to `startSecond`/`endSecond`.
- **Captions** render `overlayText` at `captionPosition` for each scene's time window.
- **Video Composition** lays assets, voice, captions, and `musicMood` onto the shared timeline, applying `cameraMovement` and the `transitionIn`/`transitionOut` between scenes.

One contract in, a finished video out — every production stage reading the same
ordered scenes instead of re-deriving them from the upstream plans.

## Asset generation (leaving the planning phase)

`ClaudeAssetGenerationProvider` (`src/providers/asset-generation/`) is the first
**production** stage. It consumes an `AssetPlan` and produces **`GeneratedAssets`**
— a fully-specified manifest of media resources, each with `assetId`, `sceneId`,
`segmentId`, `assetType`, `provider`, `sourceUrl` (a source reference, never a
fabricated link), planned `localPath`, `mimeType`, dimensions, duration, license,
`generationMethod`, and per-asset `metadata` (status, providers, cost). Same
rules: only `AIKernel.generate()`, no Anthropic SDK, no `PromptManager`, no HTTP,
no downloads, no rendering. Run it with `npm run demo:asset-generation` (needs
`ANTHROPIC_API_KEY`). **Provider demo only — it downloads and generates nothing.**

```
… → Asset Plan → Asset Generation (GeneratedAssets)
```

**Why Asset Generation is separate from Asset Planning.** Planning is a pure
*decision* — cheap, deterministic, reviewable, and easy to change your mind about.
Generation is the *side-effecting* part: real network calls, paid model credits,
rate limits, retries, files on disk. Keeping them separate means the entire "what
and from where" is settled and approved before anything expensive or irreversible
happens, and generation stays a dumb executor of an approved plan.

**Why downloading/generation happens HERE, not earlier.** The upstream stages must
stay fast, free, and re-runnable — you iterate on research, narration, and visual
direction many times. If any of them fetched files, every tweak would re-trigger
paid API calls and downloads. Deferring all I/O to this one stage means the whole
creative plan is locked first; generation runs once, at the end, against a frozen
`AssetPlan`. (In this step the provider still only *describes* the production via
Claude — real adapters like Pexels/Flux/Runway/Veo plug in behind the same
interface later, with no caller changes.)

**How later stages consume `GeneratedAssets`:**

- **Voice** pairs each `segmentId` with its audio and aligns to the scene timeline.
- **Captions** overlay text within each segment's time window.
- **Composition** places each asset by `localPath` at its `sceneId`/`segmentId` slot, applying camera + transitions from the ScenePlan.
- **QA** validates every asset exists, matches its `mimeType`/dimensions/duration, and satisfies its `license` — using the structured `AssetGenerationWarning`s to catch problems before render.

Because assets are keyed by `segmentId`/`sceneId`, they drop straight onto the same
shared timeline as narration, visual direction, and the scene plan.

## Voice generation (real audio — production stage 1)

`OpenAIVoiceGenerationProvider` (`src/providers/voice-generation/`) consumes the
`NarrativeScript` and produces **real narration audio**: it calls OpenAI TTS per
segment (native `fetch`, no SDK), writes `.mp3` files to `output/voice/`, and
measures each with **ffprobe** to build the **actual** timeline. Run it with
`npm run demo:voice-generation` (needs `OPENAI_API_KEY`).

Unlike the planning stages, this does real I/O (network + disk). It does **not**
go through the AI Kernel — the Kernel is for Claude *text*; speech is a different
modality with its own endpoint. It follows the same provider/DI pattern, so
ElevenLabs/Azure could swap in with no caller changes.

**Why it measures with ffprobe.** Synthesized speech rarely matches the planned
duration (a 30s estimate came out to ~22s real). The measured per-segment
durations become the master timeline that captions, visuals, and composition all
sync to — so audio and picture never drift.

## Dynamic niches (one profile drives every stage)

The studio produces different content types, and each gets its **own creative
identity** — voice, tone, audience, visual style, colour mood, music, pacing.
That identity lives in `src/config/niche-profiles.ts` (`NICHE_PROFILES`), and
`src/config/niche-context.ts` turns one profile into every provider's context.
So a single `niche` drives the whole run; nothing is hardcoded per niche.

| Niche | Voice | Delivery | Look |
|---|---|---|---|
| Scary Stories | onyx | deep, ominous, dark humor | dark cinematic horror |
| Tech News | echo | crisp, fast, confident | sleek neon-tech |
| Relationship Advice | shimmer | warm, empathetic | soft, warm, intimate |
| User Storytelling | fable | expressive narrator | filmic, character-driven |

`npm run demo:niches` prints each profile + derived contexts and (with
`OPENAI_API_KEY`) synthesizes a sample line **in each niche's own voice + delivery**
to `output/voice/samples/<niche>/`, so you can hear the difference. Voice delivery
uses OpenAI `gpt-4o-mini-tts`'s `instructions` field, so the *style* changes per
niche, not just the voice id.

This is config + pure mapping functions — no new orchestration. Adding a new stage
(captions, visuals, music, composition) means giving it a niche-driven context the
same way.

## Caption generation (subtitles — production stage 2)

`SubtitleCaptionProvider` (`src/providers/caption-generation/`) turns the measured
voiceover into a synced subtitle track. It's fully **local** (no AI, no network,
no key): it splits each measured segment into short cues (≤5 words) and
distributes the segment's real time window across them, then writes a portable
`.srt` and a styled `.ass` for burned-in captions. Run it with
`npm run demo:captions`.

The `.ass` styling is **niche-driven** — font, position, accent glow, and karaoke
mode all come from the niche profile (`captionFont`, `captionPosition`,
`captionAccent`, `captionKaraoke`): scary = Arial Black + red, tech = Verdana +
cyan, advice = Georgia + gold, story = Trebuchet MS + amber. Composition later
burns the `.ass` onto the video. Because cues come straight from the voice
timeline, captions never drift from the narration.

**Karaoke mode** (on for scary + tech): the whole sentence stays on screen —
never broken mid-phrase — and each word flips to the accent colour as it is
spoken (ASS `\k` timing, estimated per word from the cue's real window). Calm
niches (advice, story) keep plain white sentence cues. The `.srt` stays plain
either way.

## Image generation (real visuals — production stage 3)

`OpenAIImageGenerationProvider` (`src/providers/image-generation/`) makes the first
real pixels: it takes each segment's `visualPrompt` (already niche-styled), appends
the niche's `visualStyle` + `colorMood`, calls OpenAI Images (`gpt-image-1`,
`1024x1536` portrait), and writes a `.png` per segment to `output/assets/images/`.
Run it with `npm run demo:image-generation` (needs `OPENAI_API_KEY`).

Native `fetch`, no SDK, no AI Kernel (that's Claude text). Defensive: a failed
image is a structured warning + skipped file (never a crash or a corrupt PNG), and
it handles both API return shapes (inline base64 or a URL). Images are clean —
**no baked-in text** — because captions are burned separately at composition.
Rough cost/speed: `gpt-image-1` `medium` ≈ $0.04 and ~30s per image.

## Music generation (ambient bed — production stage 4)

`FfmpegMusicProvider` (`src/providers/music-generation/`) synthesizes a simple
ambient bed with FFmpeg oscillators, matched to the niche's mood (tense drone for
horror, upbeat electronic for tech, warm pad for advice, emotive for stories),
sized to the narration length with a fade in/out. Fully local — no AI, no network,
no key. Run it with `npm run demo:music`.

It's deliberately an *atmosphere*, not a produced track — swappable for a real
music library or generation API later behind the same interface. Composition ducks
it under the narration. A synthesis failure is a warning + empty path, so the video
still composes without music.

**Per-run variety:** every bed gets a seeded variation — the whole oscillator
stack is transposed by a musical interval (−3…+3 semitones) and the tremolo rate
and noise level are jittered — so no two videos share an identical bed while the
mood stays recognisable. The applied variation (seed, semitones, tremolo factor)
is recorded in the result metadata; the same seed reproduces the same bed.

## Composition (the finished MP4 — production stage 5)

`FfmpegCompositionProvider` (`src/providers/composition/`) assembles everything
into one vertical MP4. It's **staged** for reliability rather than one giant
filtergraph: (1) one image clip per segment scaled-cropped to 1080×1920 with a
gentle Ken-Burns pan, (2) concat the clips, (3) concat the per-segment voice into
one track, (4) a final pass that burns the `.ass` captions, ducks the music under
the voice, and encodes H.264 + AAC. Run it with `npm run demo:compose` (needs
`OPENAI_API_KEY` for the narration and ffmpeg on PATH); it renders
`output/video/<niche>.mp4`.

**Motion variety:** each scene cycles through four eased Ken-Burns moves —
zoom-in, pan-up, zoom-out, pan-down (zooms via `zoompan` with a 2× pre-scale for
smoothness; pans via an animated crop window; both with smoothstep easing so
movement starts and ends gently).

Defensive throughout: a failed motion clip degrades to the **static image**, then
to a black card (never straight to black); a missing image becomes a colour card;
and if the caption burn fails it retries once **without** captions so you still
get a video. This is the only stage that knows FFmpeg composition — everything
upstream stays render-agnostic.

## Quality assurance (validate the render — production stage 6)

`FfprobeQaProvider` (`src/providers/quality-assurance/`) is the safety net before
publishing. It probes the MP4 with ffprobe and runs a checklist — file readable +
non-trivial size, has a video **and** audio stream, correct dimensions, sane frame
rate, H.264/AAC codecs, and duration within ±15% of the narration — returning a
structured `QaReport` (`pass` / `warn` / `fail`, per-check results). Run it with
`npm run demo:qa`. It's **read-only**: it inspects the file, never edits it. Wire
it after Composition so a broken render is blocked automatically instead of
uploaded.

## Run the whole studio (end-to-end)

`runStudio(niche, topic?)` (`src/studio/run-studio.ts`) chains **every** stage into
one autonomous run and exports a QA'd package to `output/final/<niche>-<stamp>/`
(`video.mp4` + `captions.srt` + `manifest.json` + `upload.txt`):

```
topic → Research → ContentPlan → Narrative → scene images + Voice
      → Captions → Music → Composition → QA → SEO pack → Export
```

Run it:

```bash
npm run demo:studio                                   # scary-stories, auto topic
npm run demo:studio -- tech-news                      # a niche, auto topic
npm run demo:studio -- scary-stories "The last voicemail"   # explicit topic
```

Auto-topic generation (`src/providers/topic-generation/`) invents a fresh idea per
niche via the AI Kernel; passing a topic overrides it. **Scene images are grounded
in each narrated line**, so every scene gets its own on-topic image in the niche's
look. Needs `OPENAI_API_KEY` (voice + images) and ffmpeg. A full run makes ~8–12
images (~$0.30–0.60) and takes ~4–9 minutes. This runner is the single
orchestration layer — a sequential runner over the existing providers, no new
framework.

## SEO upload kit (posting = copy-paste)

`ClaudeSeoProvider` (`src/providers/seo/`) runs after QA and turns the finished
video's content into **platform-ready upload metadata**: a YouTube title (≤90
chars, curiosity-driven), a hook-led description with CTA, 10–15 search tags,
hashtags (always incl. `#shorts`), plus a TikTok caption (≤130 chars) with
hashtags (always incl. `#fyp`). One cheap AI Kernel text call; try it alone with
`npm run demo:seo`.

The pack lands in three places: the `manifest.json`, a **ready-to-paste
`upload.txt`** next to the video, and the Telegram message (real title +
hashtags, with `upload.txt` attached). Defensive by design — if generation ever
fails, it degrades to a usable fallback built from the topic/hook/keywords, so a
finished video is never blocked by SEO.

## Thumbnails (cover image per video)

`FfmpegThumbnailProvider` (`src/providers/thumbnail-generation/`) renders two
covers per video — **fully local and free**: it reuses the **hook scene's image**
(the most striking shot, already generated) and burns the SEO pack's
`thumbnailText` (2–4 ALL-CAPS words, written in the same SEO call — zero extra AI
cost) in huge white type with a black outline and the niche's accent glow (the
same proven libass path as the captions):

- `thumbnail.jpg` — 1080×1920 vertical (TikTok / Reels / Facebook covers)
- `thumbnail-wide.jpg` — 1280×720 (YouTube)

Both are copied into the final package, listed in the manifest, and attached to
the Telegram delivery. Try it alone with `npm run demo:thumbnail` (uses an
existing scene image; renders in ~1s). Defensive: a missing image or failed
render is a warning + empty path — never a blocked video.

## Daily automation (Trigger.dev + Telegram)

`src/trigger/content-studio/generate-daily-video.ts` is a **scheduled task** (9am
daily) that picks the day's niche from the rotation, runs `runStudio`, and DMs the
finished MP4 + an upload-ready caption (title, hook, hashtags) to Telegram via
`TelegramDeliveryProvider` (`src/providers/delivery/`). `trigger.config.ts`
installs ffmpeg in the deploy via the `ffmpeg()` build extension.

**Set up Telegram (≈5 min):**

1. In Telegram, message **@BotFather** → `/newbot` → copy the token → `TELEGRAM_BOT_TOKEN`.
2. Message your new bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates`
   and copy `result[].message.chat.id` → `TELEGRAM_CHAT_ID`.
3. Put both in `.env`, then test: `npm run demo:deliver` (sends your latest video).

**Schedule it on Trigger.dev:**

1. Create a free project at [cloud.trigger.dev](https://cloud.trigger.dev), copy the
   `proj_...` ref into `trigger.config.ts`.
2. `npx trigger.dev@latest login`.
3. Add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   to the dashboard → Environment Variables.
4. Test locally: `npx trigger.dev@latest dev`, then trigger `generate-daily-video`
   from the dashboard's Test tab.
5. Deploy: `npx trigger.dev@latest deploy` → it runs itself daily.

Delivery is graceful — if the bot isn't configured, the run logs a warning instead
of failing.

## The Brief Engine — command the studio in plain words

`src/studio/content-brief.ts` makes the studio fully dynamic: a **ContentBrief**
says what to make, and the same hardened pipeline produces it.

```bash
# AI designs a ONE-OFF identity (voice, look, music, captions) from your words:
npm run studio:brief -- "a calm bedtime history channel about ancient mysteries"

# Preview the designed identity first (~1¢, no video):
npm run studio:brief:dry -- "a chaotic cooking hacks channel for students"

# Base it on a preset niche, change the length, or use your exact title:
npm run studio:brief -- "top 3 AI tools this week" niche=tech-news duration=90
npm run studio:brief -- "The Last Voicemail" title=yes niche=scary-stories
```

- **No niche given** → the identity designer (`src/providers/identity-design/`)
  creates a complete one-off show identity via the AI Kernel; every enum-ish
  field is coerced to a safe set, with a neutral fallback so a bad response can
  never block a run.
- **Any duration** → the word budget, voice measure-then-correct window, and QA
  floor/ceiling all derive from the brief's target (65s → 60/72; 90s → 83/100).
- **The instructions are a directive** — the topic stage must fulfil them, not
  treat them as a suggestion.
- The resolved brief persists to `output/runs/<runId>/brief.json`, so custom runs
  **resume with exactly the same identity** (`npm run studio:resume -- <runId>`).
- Flag note: npm on Windows can eat `--flags`; use the `key=value` forms above
  (or the dedicated `studio:brief:dry` script), which are immune.

## Formats — the same studio, different kinds of shows

`src/studio/formats.ts` is the format registry. A brief picks the format; the
pipeline's middle changes while everything else (ledger, QA, SEO, delivery)
stays shared.

- **narrated-short** (default) — one narrator, scene-matched images.
- **podcast** — two AI hosts in real conversation: the script stage writes a
  cast (distinct voices + personas) and dialogue turns
  (`src/providers/podcast-script/`); every turn is synthesized in *its host's*
  voice and stitched onto one timeline; visuals are four studio "camera" shots
  (wide, host A, host B, topic insert) **cut to whoever is speaking**; captions
  carry `Name:` speaker labels.

```bash
npm run studio:brief -- "two hosts debate whether AI takes dev jobs" format=podcast
# or just tell the Telegram bot: "make a podcast about ..."
```

Coming next: **long-form** — chaptered documentaries stitched from chapter runs.

## Dashboard — the local control room

```bash
npm run studio:dashboard   →   http://localhost:4321
```

A zero-dependency local web UI (`src/dashboard/`) over the data the pipeline
already writes: **Create** (submit briefs with format/identity/duration, free
identity preview, live stage-by-stage progress), **Runs** (every run with status
+ per-stage cost from the ledgers), **Library** (play finished videos in the
browser, copy the upload kit, send to Telegram in one click), **Profiles**, and
**Stats** (total/avg spend). Binds to 127.0.0.1 only; media paths are confined
to `output/`; video streaming supports Range (seeking works).

## Telegram remote control — run the studio from your phone

`npm run studio:listen` turns your delivery bot into a two-way remote
(`src/telegram/`): it long-polls for your messages, parses them with one cheap
AI call, and drives the Brief Engine.

```
You:  make a 90 second scary video about an abandoned lighthouse —
      deep slow voice, dark stormy pictures
Bot:  📋 Plan: … identity: AI-designed · duration: 90s · voice: onyx ·
      pictures: dark stormy… Reply "yes" to start, "preview" for the
      identity first (~1¢), or "no" to cancel.
You:  yes
Bot:  🎬 Working… (one live-updating progress message)
Bot:  ✅ Done → finished video + thumbnails + upload.txt in the chat
```

Safety by design: **only `TELEGRAM_CHAT_ID` can command it** (everyone else is
ignored); **nothing spends money without your explicit "yes"**; old messages are
dropped on startup so restarts never replay commands; runs queue one-at-a-time;
failures alert with the exact resume command; QA-blocked videos are withheld.
`status` / `help` work as plain words. `npm run studio:command -- "..."` feeds
one message through the same controller from the terminal (for testing).

The listener runs on this PC — keep it open (or add it to Windows startup).

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
