/**
 * RESEARCH — real source material for a documentary script.
 *
 * The script writer must not work from memory. A model asked for "the history
 * of X" will produce fluent, plausible, specific-sounding dates and numbers,
 * and some of them will be wrong — which is exactly the failure that makes a
 * history video worthless. Grounding it in fetched text turns the writing job
 * from RECALL into SUMMARY, which models are far better at.
 *
 * Wikipedia is used because it suits this shape of content precisely: it is
 * free, needs no key, covers the kind of topic this format is about, and its
 * articles are dense with the dates and figures the voice depends on. It is not
 * infallible, so the script stage is told to use only what the source supports
 * and the verification stage checks the claims back against it.
 *
 * The studio's existing research provider is not used here because it runs on
 * Anthropic's server-side web search, and this pipeline is OpenAI-only.
 */

const WIKI_API = "https://en.wikipedia.org/w/api.php";
/** Identify the client without leaking anything about the user. */
const USER_AGENT = "AgenticStudio/1.0 (documentary script research)";
/** Enough article text for a script; beyond this the prompt just gets costly. */
const MAX_EXTRACT_CHARS = 24_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface SourceArticle {
  readonly title: string;
  readonly url: string;
  readonly extract: string;
}

export interface ResearchResult {
  readonly articles: readonly SourceArticle[];
  /** Everything concatenated, ready to put in a prompt. */
  readonly sourceText: string;
  /** Where it came from, for the description and for honesty. */
  readonly citations: readonly string[];
}

/**
 * Find and fetch the Wikipedia articles behind a topic.
 *
 * Returns empty rather than throwing: a topic with no article should degrade to
 * a clearly-labelled ungrounded script, not kill the run. The caller decides
 * whether that is acceptable.
 */
export async function research(topic: string, maxArticles = 3): Promise<ResearchResult> {
  const titles = await searchTitles(topic, maxArticles);
  if (titles.length === 0) return { articles: [], sourceText: "", citations: [] };

  const articles: SourceArticle[] = [];
  for (const title of titles) {
    const article = await fetchExtract(title);
    if (article && article.extract.length > 500) articles.push(article);
  }

  // The first article is the main subject and gets the most room; the others
  // are context and are trimmed harder.
  const sourceText = articles
    .map((article, index) => {
      const budget = index === 0 ? MAX_EXTRACT_CHARS : Math.floor(MAX_EXTRACT_CHARS / 3);
      return `### ${article.title}\n${article.extract.slice(0, budget)}`;
    })
    .join("\n\n");

  return {
    articles,
    sourceText,
    citations: articles.map((article) => article.url),
  };
}

/** Article titles matching the topic, best first. */
async function searchTitles(topic: string, limit: number): Promise<string[]> {
  const url =
    `${WIKI_API}?action=query&list=search&format=json&origin=*` +
    `&srsearch=${encodeURIComponent(topic)}&srlimit=${limit}&srnamespace=0`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      query?: { search?: { title?: string }[] };
    };
    return (payload.query?.search ?? [])
      .map((entry) => entry.title ?? "")
      .filter((title) => title !== "");
  } catch {
    return [];
  }
}

/**
 * Plain-text article body.
 *
 * `explaintext` strips the wiki markup, and `exsectionformat=plain` keeps the
 * section headings readable — they carry the chronology a documentary needs.
 */
async function fetchExtract(title: string): Promise<SourceArticle | undefined> {
  const url =
    `${WIKI_API}?action=query&prop=extracts|info&inprop=url&format=json&origin=*` +
    `&explaintext=1&exsectionformat=plain&redirects=1&titles=${encodeURIComponent(title)}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;

    const payload = (await response.json()) as {
      query?: {
        pages?: Record<string, { title?: string; extract?: string; fullurl?: string; missing?: unknown }>;
      };
    };
    const page = Object.values(payload.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || !page.extract) return undefined;

    return {
      title: page.title ?? title,
      url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      extract: page.extract,
    };
  } catch {
    return undefined;
  }
}
