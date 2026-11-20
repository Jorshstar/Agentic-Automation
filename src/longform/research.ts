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
/** First backoff step after a 429; doubles each attempt. */
const RETRY_BASE_MS = 1200;
/** Gap between successive article fetches. */
const POLITE_DELAY_MS = 350;

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
  /**
   * Why there is no source material, when there is none.
   *
   * "empty" means Wikipedia genuinely has nothing for this topic. "failed"
   * means the lookup itself broke — rate limited, offline, API change.
   *
   * The two must never be conflated. An audit run hit HTTP 429 and the failure
   * was swallowed into an empty result, so "Nintendo" and "Mary Celeste" — both
   * of which have substantial articles — were reported as having no sources,
   * and the pipeline wrote confident, ungrounded scripts about them anyway.
   * A caller that cannot tell the difference cannot refuse the right runs.
   */
  readonly failure?: "empty" | "failed";
}

/**
 * Find and fetch the Wikipedia articles behind a topic.
 *
 * Never throws; reports why it came back empty instead, so the caller can
 * refuse a run that would otherwise produce an unsourced script.
 */
export async function research(topic: string, maxArticles = 3): Promise<ResearchResult> {
  const found = await searchTitles(topic, maxArticles);
  if (found.failed) {
    return { articles: [], sourceText: "", citations: [], failure: "failed" };
  }
  const titles = found.titles;
  if (titles.length === 0) {
    return { articles: [], sourceText: "", citations: [], failure: "empty" };
  }

  const articles: SourceArticle[] = [];
  for (const title of titles) {
    const article = await fetchExtract(title);
    if (article && article.extract.length > 500) articles.push(article);
  }
  // Titles were found but nothing could be fetched: that is the lookup
  // breaking, not the topic being absent.
  if (articles.length === 0) {
    return { articles: [], sourceText: "", citations: [], failure: "failed" };
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

/**
 * GET with retry on rate limiting.
 *
 * Wikipedia returns 429 to a client that asks too quickly, and an audit of five
 * topics in a row hit exactly that. Without this the 429 became "no article" —
 * silently turning a grounded pipeline into an ungrounded one.
 */
async function getJson(url: string): Promise<unknown | undefined> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.json();
      // 429 and 5xx are worth waiting out; a 404 is not.
      if (response.status !== 429 && response.status < 500) return undefined;
    } catch {
      // network blip — same backoff applies
    }
    await sleep(RETRY_BASE_MS * 2 ** attempt);
  }
  return undefined;
}

/** Spacing between calls, to stay a polite client rather than a throttled one. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TitleSearch {
  readonly titles: string[];
  /** True when the lookup broke, as opposed to finding nothing. */
  readonly failed: boolean;
}

/** Article titles matching the topic, best first. */
async function searchTitles(topic: string, limit: number): Promise<TitleSearch> {
  const url =
    `${WIKI_API}?action=query&list=search&format=json&origin=*` +
    `&srsearch=${encodeURIComponent(topic)}&srlimit=${limit}&srnamespace=0`;

  const payload = (await getJson(url)) as { query?: { search?: { title?: string }[] } } | undefined;
  if (payload === undefined) return { titles: [], failed: true };

  return {
    titles: (payload.query?.search ?? [])
      .map((entry) => entry.title ?? "")
      .filter((title) => title !== ""),
    failed: false,
  };
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

  const payload = (await getJson(url)) as
    | {
        query?: {
          pages?: Record<string, { title?: string; extract?: string; fullurl?: string; missing?: unknown }>;
        };
      }
    | undefined;
  if (payload === undefined) return undefined;

  const page = Object.values(payload.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) return undefined;

  // Space out the next call rather than racing into a 429.
  await sleep(POLITE_DELAY_MS);

  return {
    title: page.title ?? title,
    url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    extract: page.extract,
  };
}
