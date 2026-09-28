// The vocabulary book is one Markdown note. Every word is a multi-line card
// in the format of the Spaced Repetition plugin (st3v3nmw):
//
//   **serendipity**
//   ?
//   /ˌserənˈdɪpəti/ 意外发现美好事物的运气
//   *n.* 机缘巧合
//   > …a happy serendipity led her… — 《Book》 [↩](obsidian://…)
//   <!--SR:!2026-10-01,3,250-->        ← written by the review plugin
//
// A card has no blank lines; a blank line ends it. The note is only ever
// appended to, and an existing card only gains context lines above its
// scheduling comment, so review progress is never rewritten.

export const MAX_CARD_CONTEXTS = 3;

export function defaultVocabularyPath(notesFolder, zh = true) {
  const folder = String(notesFolder || "").trim().replace(/^\/+|\/+$/g, "");
  return `${folder || (zh ? "乔木阅读" : "Qiaomu Reader")}/${zh ? "生词本" : "Vocabulary"}.md`;
}
export function vocabularyDeckTag(zh = true) {
  return `flashcards/${zh ? "生词" : "vocabulary"}`;
}
export function vocabularyHeader(zh = true) {
  return [
    "---",
    `tags: [${vocabularyDeckTag(zh)}]`,
    "---",
    `# ${zh ? "生词本" : "Vocabulary"}`,
    "",
    zh
      ? "<!-- 乔木阅读收录的生词。每个词是一张复习卡，可直接修改释义；复习进度由 Spaced Repetition 插件写在卡片末尾，请勿删除。 -->"
      : "<!-- Words collected by Qiaomu Reader. Each word is a review card; edit meanings freely. Review progress is written at the end of each card by the Spaced Repetition plugin — keep it. -->",
    "",
  ].join("\n");
}

// Text placed inside a card must stay on one line and must not contain the
// review plugin's own syntax: "::" makes a single-line card, "==x==" a cloze
// and a lone "?" line a separator.
export function cardText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/:{2,}/g, (m) => m.split("").join(" "))
    .replace(/={2,}/g, (m) => m.split("").join(" "))
    .replace(/<!--/g, "‹!--")
    .trim();
}
export function vocabularyKey(term) {
  return String(term || "").normalize("NFKC").trim().toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
}

function contextLine(entry) {
  const sentence = cardText(entry.context);
  if (!sentence) return "";
  const book = cardText(entry.book);
  const source = [book ? `《${book}》` : "", entry.backlink ? `[↩](${entry.backlink})` : ""].filter(Boolean).join(" ");
  return `> ${sentence}${source ? ` — ${source}` : ""}`;
}

export function buildVocabularyCard(entry) {
  const word = cardText(entry.lemma || entry.term);
  const lines = [`**${word}**`, "?"];
  const head = [cardText(entry.phonetic), cardText(entry.meaning)].filter(Boolean).join(" ");
  const senses = (entry.senses || [])
    .map((sense) => [sense.pos ? `*${cardText(sense.pos)}*` : "", cardText(sense.def)].filter(Boolean).join(" "))
    .filter(Boolean);
  if (head) lines.push(head);
  if (senses.length) lines.push(senses.join("；"));
  if (!head && !senses.length) lines.push("…");
  const context = contextLine(entry);
  if (context) lines.push(context);
  return lines.join("\n");
}

// Cards in the note: a block of non-blank lines that starts with a bold word
// and contains a "?" separator line. Frontmatter and comments are skipped.
export function parseVocabularyCards(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const cards = [];
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const start = i;
    while (i < lines.length && lines[i].trim()) i++;
    const block = lines.slice(start, i);
    const match = /^\*\*(.+?)\*\*/.exec(block[0]);
    const separator = block.findIndex((line) => line.trim() === "?");
    if (!match || separator < 1) continue;
    const sr = block.findIndex((line) => line.includes("<!--SR:"));
    cards.push({
      word: match[1].trim(),
      key: vocabularyKey(match[1]),
      start,
      end: i - 1,
      back: block.slice(separator + 1).filter((line) => !line.includes("<!--SR:")),
      scheduled: sr >= 0,
      srOffset: sr,
    });
  }
  return { lines, cards };
}

// Returns the new note text and what happened. "exists" means nothing changed.
export function addToVocabulary(text, entry, header = vocabularyHeader()) {
  const key = vocabularyKey(entry.lemma || entry.term);
  if (!key) return { text, status: "invalid" };
  const source = String(text || "");
  const { lines, cards } = parseVocabularyCards(source);
  const found = cards.find((card) => card.key === key)
    || (entry.term && cards.find((card) => card.key === vocabularyKey(entry.term)));
  if (found) {
    const context = contextLine(entry);
    const sentence = cardText(entry.context);
    const known = found.back.filter((line) => line.startsWith("> "));
    if (!context || known.some((line) => line.includes(sentence)) || known.length >= MAX_CARD_CONTEXTS) {
      return { text: source, status: "exists", word: found.word };
    }
    // Keep the scheduling comment as the card's last line.
    const at = found.srOffset >= 0 ? found.start + found.srOffset : found.end + 1;
    lines.splice(at, 0, context);
    return { text: lines.join("\n"), status: "context", word: found.word };
  }
  const card = buildVocabularyCard(entry);
  const base = source.trim() ? source.replace(/\s+$/, "") : header.replace(/\s+$/, "");
  return { text: `${base}\n\n${card}\n`, status: "added", word: cardText(entry.lemma || entry.term) };
}

// Minimal Markdown → HTML for Anki fields. Everything else is escaped.
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function inlineMarkdownHtml(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => /^(https?|obsidian):/i.test(url) ? `<a href="${url}">${label}</a>` : label)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}
export function ankiFieldsFromCard(card) {
  const meaning = card.back.filter((line) => !line.startsWith("> ")).map(inlineMarkdownHtml).join("<br>");
  const context = card.back.filter((line) => line.startsWith("> ")).map((line) => inlineMarkdownHtml(line.slice(2))).join("<br>");
  return { Word: escapeHtml(card.word), Meaning: meaning, Context: context };
}
