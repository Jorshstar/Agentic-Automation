import type { AIKernel, AIGenerateRequest } from "../../ai/index.js";
import type { TopicGenerationProvider } from "./topic-generation-provider.js";
import type {
  TopicGenerationRequest,
  GeneratedTopic,
  TopicIdea,
  TopicGenerationWarning,
  TopicGenerationMetadata,
} from "./types.js";

/**
 * ClaudeTopicGenerationProvider — invents a topic idea via the AI Kernel only.
 * No Anthropic SDK, no PromptManager, no HTTP. Defensive JSON parsing.
 */
const TOPIC_PROMPT_ID = "topic-idea.user";

export class ClaudeTopicGenerationProvider implements TopicGenerationProvider {
  readonly name = "claude-topic-generation-provider";

  constructor(private readonly kernel: AIKernel) {}

  async generate(request: TopicGenerationRequest): Promise<GeneratedTopic> {
    const generateRequest: AIGenerateRequest = {
      promptId: TOPIC_PROMPT_ID,
      variables: {
        niche: request.niche,
        audience: request.audience,
        tone: request.tone,
        themes: request.themes.join(", "),
        avoidTopics: request.avoidTopics.trim() === "" ? "none" : request.avoidTopics,
        directive: request.directive.trim() === "" ? "none" : request.directive,
      },
      expectedOutput: { format: "json", description: "one topic idea" },
      maxTokens: 500,
    };

    const generated = await this.kernel.generate<string>(generateRequest);
    const warnings: TopicGenerationWarning[] = [];
    const idea = parseTopic(generated.output, warnings);

    const metadata: TopicGenerationMetadata = {
      promptId: generated.promptId,
      promptVersion: generated.promptVersion,
      provider: generated.provider,
      model: generated.model,
      tokenUsage: {
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        totalTokens: generated.usage.totalTokens,
      },
      latencyMs: generated.latencyMs,
    };

    return { idea, warnings, metadata };
  }
}

function parseTopic(raw: string, warnings: TopicGenerationWarning[]): TopicIdea {
  const root = parseJsonObject(raw, warnings);
  const title = asString(root["title"]);
  const angle = asString(root["angle"]);
  const hook = asString(root["hook"]);
  const keywords = Array.isArray(root["keywords"])
    ? root["keywords"].filter((k): k is string => typeof k === "string")
    : [];

  if (title === "") {
    warnings.push({ code: "missing-field", message: "Topic idea has no title." });
  }
  return { title, angle, hook, keywords };
}

function parseJsonObject(raw: string, warnings: TopicGenerationWarning[]): Record<string, unknown> {
  const withoutFences = raw.replace(/```(?:json)?/giu, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    warnings.push({ code: "parse-error", message: "No JSON object in topic output." });
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    warnings.push({ code: "parse-error", message: "Topic output was not valid JSON." });
    return {};
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
