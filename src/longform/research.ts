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
  // Search the SUBJECT, not the headline. Wikipedia's full-text search scores
  // every word, so "HOW McDONALD'S CONQUERED THE WORLD" returns World War I.
  const subject = subjectOf(topic);
  let found = await searchTitles(subject, maxArticles);
  if (found.failed) {
    return { articles: [], sourceText: "", citations: [], failure: "failed" };
  }
  // Trimming can go too far on a phrasing this does not know. The full topic is
  // a worse query but never a wrong one, so it is the fallback, not the default.
  if (subject !== topic && !isAbout(found.titles, subject)) {
    const whole = await searchTitles(topic, maxArticles);
    if (!whole.failed && isAbout(whole.titles, topic)) found = whole;
  }

  const titles = found.titles;
  if (titles.length === 0) {
    return { articles: [], sourceText: "", citations: [], failure: "empty" };
  }
  // Results that are not about the subject are worse than no results. They look
  // like success all the way down: the writer draws on its own memory, the fact
  // checker compares that against articles on a different subject, every beat
  // is flagged, and the run dies reporting a writing problem. A McDonald's
  // documentary failed exactly this way on sources about the world wars.
  if (!isAbout(titles, subject) && !isAbout(titles, topic)) {
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

/* ------------------------------ topic -> query ----------------------------- */

/** Framing that tells you the shape of a video, not what to look up. */
const LEADING_FRAME =
  /^(?:the\s+)?(?:how|why|what|when|where|inside|story of|the story of|untold story of|the untold story of|true story of|the true story of|history of|the history of|rise and fall of|the rise and fall of|rise of|the rise of|fall of|the fall of|truth about|the truth about|secret[s]? of|the secret[s]? of|making of|the making of|documentary (?:on|about))\s+/iu;

/**
 * Narrative predicates. Everything from here on describes what the subject DID,
 * which is the part of a title that poisons a keyword search — "conquered the
 * world" is why a McDonald's query came back with the world wars.
 */
const TRAILING_PREDICATE =
  /\s+(?:conquered|took over|take over|changed|changes|changing|became|become|built|build|made|make|ruled|rules|won|win|lost|lose|died|dies|failed|fails|collapsed|collapses|fell|falls|rose|rises|beat|destroyed|destroys|created|creates|invented|invents|stopped|stops|ended|ends|went|goes|saved|saves|lost|dominated|dominates|disappeared|disappears)\b.*$/iu;

/**
 * The searchable subject inside a documentary title.
 *
 *   "HOW McDONALD'S CONQUERED THE WORLD"      -> "McDONALD'S"
 *   "the rise and fall of Blockbuster"        -> "Blockbuster"
 *   "why the Concorde stopped flying"         -> "the Concorde"
 *
 * Returns the original when trimming would leave nothing to search for — a
 * worse query beats an empty one.
 */
export function subjectOf(topic: string): string {
  const trimmed = topic
    .trim()
    .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/gu, "")
    .replace(LEADING_FRAME, "")
    .replace(TRAILING_PREDICATE, "")
    .replace(/\s+/gu, " ")
    .trim();
  return trimmed.length >= 3 ? trimmed : topic.trim();
}

/** Words too common to prove an article is about anything. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "from", "by", "with",
  "its", "his", "her", "their", "world", "story", "history", "rise", "fall", "how", "why",
  "what", "when", "where", "inside", "first", "last", "new", "old", "big", "great",
]);

/** Comparable form: lowercase letters and digits only, so "McDonald's" ~ "McDonalds". */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
}

/**
 * Does this set of articles plausibly cover the subject?
 *
 * One distinctive word shared with a title is enough — Wikipedia's own titles
 * are terse, so "McDonald's" matches "History of McDonald's" and "Richard and
 * Maurice McDonald" while matching nothing in "World War I".
 */
export function isAbout(titles: readonly string[], subject: string): boolean {
  const terms = normalise(subject)
    .split(" ")
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  if (terms.length === 0) return true; // nothing distinctive to check against

  const words = titles.flatMap((title) => normalise(title).split(" ").filter(Boolean));
  return terms.some((term) => words.some((word) => sameWord(word, stem(term))));
}

/** Drop a plural or possessive so "McDonald's" and "McDonald" are one word. */
function stem(word: string): string {
  return word.replace(/(?:'s|s)$/u, "");
}

/**
 * Prefix matching in either direction, but only between words long enough for
 * a shared prefix to mean something. Without the length floor a three-letter
 * title word ("war", "con") would match any term beginning with it.
 */
function sameWord(word: string, term: string): boolean {
  const left = stem(word);
  if (left === term) return true;
  return left.length >= 4 && term.length >= 4 && (left.startsWith(term) || term.startsWith(left));
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
