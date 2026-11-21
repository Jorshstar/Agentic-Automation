import { research, subjectOf } from "../longform/research.js";
const topics = process.argv.slice(2);
for (const topic of topics.length > 0 ? topics : ["HOW McDONALD’S CONQUERED THE WORLD"]) {
  const r = await research(topic);
  console.log(`${topic}\n  subject: ${subjectOf(topic)}\n  -> ${r.articles.map((a) => a.title).join(", ") || `(none: ${r.failure})`}`);
}
