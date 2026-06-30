import type { ResearchProvider } from "./research-provider.js";
import type {
  ResearchRequest,
  ResearchProviderResult,
  TopicValidation,
  SummarizeRequest,
  SummarizeResult,
} from "./types.js";

/**
 * MockResearchProvider — a stand-in that returns FAKE but realistic data.
 *
 * It makes NO network calls and needs NO API key. Its job is to let us build and
 * test the ResearchAgent end-to-end before any real AI is wired in. The shape of
 * what it returns mirrors a real provider, so the swap later is painless.
 */
export class MockResearchProvider implements ResearchProvider {
  readonly name = "mock-research-provider";

  async researchTopic(request: ResearchRequest): Promise<ResearchProviderResult> {
    const topic = request.topic.trim();
    return {
      summary:
        `${topic} is a compelling 60-second subject. The hook is its surprising, ` +
        `counter-intuitive core fact, followed by a quick "how it works" beat and a ` +
        `memorable closing line that invites viewers to follow for more.`,
      keyPoints: [
        `${topic}: lead with the single most surprising fact.`,
        "Explain the cause in one plain-language sentence.",
        "Add one concrete, relatable example.",
        "Bust a common misconception about it.",
        "End on a punchy takeaway that drives a follow.",
      ],
      keywords: [
        ...(request.keywords ?? []),
        "explained",
        "in 60 seconds",
        "did you know",
      ],
      sources: [
        { title: `${topic} — overview`, url: "https://example.com/overview" },
        { title: `${topic} — the science`, url: "https://example.com/science" },
        { title: `${topic} — common myths`, url: "https://example.com/myths" },
      ],
      confidence: 0.82,
    };
  }

  async validateTopic(topic: string): Promise<TopicValidation> {
    const trimmed = topic.trim();
    const issues: string[] = [];
    if (trimmed.length === 0) {
      issues.push("Topic is empty.");
    } else if (trimmed.length < 3) {
      issues.push("Topic is too short to research.");
    }
    return { valid: issues.length === 0, issues };
  }

  async summarize(request: SummarizeRequest): Promise<SummarizeResult> {
    const words = request.text.trim().split(/\s+/u);
    const limit = request.maxWords ?? 40;
    const summary = words.slice(0, limit).join(" ");
    return { summary };
  }
}
