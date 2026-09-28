import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVocabularyPath, vocabularyHeader, cardText, vocabularyKey, buildVocabularyCard,
  parseVocabularyCards, addToVocabulary, ankiFieldsFromCard, MAX_CARD_CONTEXTS,
} from "../src/vocabulary.js";
import { ankiInvoke, addAnkiNotes, ankiNote, ANKI_MODEL } from "../src/anki.js";

const entry = (over = {}) => ({
  term: "serendipity", lemma: "serendipity", phonetic: "/ˌserənˈdɪpəti/", meaning: "意外发现美好事物的运气",
  senses: [{ pos: "n.", def: "机缘巧合" }], context: "A happy serendipity led her home.", book: "Emma",
  backlink: "obsidian://qiaomu-reader?vault=V&file=Emma.epub", ...over,
});

test("default location is never the vault root", () => {
  assert.equal(defaultVocabularyPath("", true), "乔木阅读/生词本.md");
  assert.equal(defaultVocabularyPath("/Reading/", true), "Reading/生词本.md");
  assert.equal(defaultVocabularyPath("", false), "Qiaomu Reader/Vocabulary.md");
});

test("card text cannot turn into other review-plugin syntax", () => {
  assert.equal(cardText("a::b"), "a: :b");
  assert.equal(cardText("==cloze=="), "= =cloze= =");
  assert.equal(cardText("line\n\nbreak"), "line break");
  assert.equal(cardText("<!--SR:x-->"), "‹!--SR:x-->");
  assert.equal(vocabularyKey("  “Serendipity,” "), "serendipity");
});

test("a new word becomes a multi-line card under the deck frontmatter", () => {
  const { text, status } = addToVocabulary("", entry(), vocabularyHeader(true));
  assert.equal(status, "added");
  assert.match(text, /^---\ntags: \[flashcards\/生词\]\n---\n# 生词本/);
  assert.match(text, /\n\n\*\*serendipity\*\*\n\?\n\/ˌserənˈdɪpəti\/ 意外发现美好事物的运气\n\*n\.\* 机缘巧合\n> A happy serendipity led her home\. — 《Emma》 \[↩\]\(obsidian:/);
  const card = buildVocabularyCard(entry());
  assert.ok(!card.split("\n").some((line) => !line.trim()), "no blank line inside a card");
});

test("the same word gains a new example above its review schedule and never duplicates", () => {
  let { text } = addToVocabulary("", entry());
  text = text.trimEnd() + "\n<!--SR:!2026-10-01,3,250-->\n\n**other**\n?\n别的\n";
  const second = addToVocabulary(text, entry({ context: "Pure serendipity, she said." }));
  assert.equal(second.status, "context");
  const lines = second.text.split("\n");
  const sr = lines.findIndex((line) => line.startsWith("<!--SR:"));
  assert.match(lines[sr - 1], /^> Pure serendipity, she said\./);
  assert.equal(second.text.match(/\*\*serendipity\*\*/g).length, 1);
  assert.match(second.text, /<!--SR:!2026-10-01,3,250-->\n\n\*\*other\*\*/, "schedule stays attached, next card untouched");
  const again = addToVocabulary(second.text, entry({ context: "Pure serendipity, she said." }));
  assert.equal(again.status, "exists");
  assert.equal(again.text, second.text);
  const upper = addToVocabulary(second.text, entry({ term: "Serendipity", lemma: "" , context: "" }));
  assert.equal(upper.status, "exists", "case and missing lemma still match");
});

test("examples are capped per card", () => {
  let { text } = addToVocabulary("", entry({ context: "One serendipity." }));
  for (let i = 0; i < 5; i++) text = addToVocabulary(text, entry({ context: `Case ${i} serendipity.` })).text;
  const { cards } = parseVocabularyCards(text);
  assert.equal(cards[0].back.filter((line) => line.startsWith("> ")).length, MAX_CARD_CONTEXTS);
});

test("user edits and foreign content survive", () => {
  const note = "---\ntags: [flashcards/生词]\n---\n# 生词本\n\n我的说明，不是卡片。\n\n**edited**\n?\n用户自己改的释义\n<!--SR:!2026-11-01,10,270-->\n";
  const { text } = addToVocabulary(note, entry());
  assert.ok(text.startsWith(note.trimEnd()));
  const { cards } = parseVocabularyCards(text);
  assert.deepEqual(cards.map((card) => card.word), ["edited", "serendipity"]);
  assert.equal(cards[0].scheduled, true);
  assert.deepEqual(cards[0].back, ["用户自己改的释义"]);
});

test("anki fields are escaped HTML with safe links only", () => {
  const { cards } = parseVocabularyCards(addToVocabulary("", entry({ meaning: "<b>x</b> & y", backlink: "javascript:alert(1)" })).text);
  const fields = ankiFieldsFromCard(cards[0]);
  assert.equal(fields.Word, "serendipity");
  assert.match(fields.Meaning, /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
  assert.match(fields.Meaning, /<i>n\.<\/i> 机缘巧合/);
  assert.doesNotMatch(fields.Context, /javascript:/i);
  const linked = ankiFieldsFromCard(parseVocabularyCards(addToVocabulary("", entry()).text).cards[0]);
  assert.match(linked.Context, /<a href="obsidian:\/\/qiaomu-reader\?vault=V&amp;file=Emma\.epub">↩<\/a>/);
});

function fakeAnki({ models = [], existing = new Set(), status = 200, fail = null } = {}) {
  const calls = [];
  const post = async (url, body) => {
    calls.push(body);
    if (fail) throw new Error(fail);
    const { action, params } = body;
    const result = action === "modelNames" ? models
      : action === "canAddNotes" ? params.notes.map((note) => !existing.has(note.fields.Word))
      : action === "addNotes" ? params.notes.map((_, i) => i + 1)
      : null;
    return { status, json: { result, error: null } };
  };
  return { post, calls };
}

test("anki: creates deck and model once, adds only new words", async () => {
  const anki = fakeAnki({ existing: new Set(["known"]) });
  const notes = ["fresh", "known"].map((w) => ankiNote("Deck", { Word: w, Meaning: "", Context: "" }));
  const result = await addAnkiNotes(anki.post, "http://x", "Deck", notes);
  assert.deepEqual(result, { added: 1, skipped: 1 });
  const actions = anki.calls.map((c) => c.action);
  assert.deepEqual(actions, ["createDeck", "modelNames", "createModel", "canAddNotes", "addNotes"]);
  assert.equal(anki.calls[2].params.modelName, ANKI_MODEL);
  assert.deepEqual(anki.calls[4].params.notes.map((n) => n.fields.Word), ["fresh"]);
  assert.equal(anki.calls.every((c) => c.version === 6), true);
  const again = fakeAnki({ models: [ANKI_MODEL] });
  await addAnkiNotes(again.post, "http://x", "Deck", notes);
  assert.ok(!again.calls.some((c) => c.action === "createModel"));
});

test("anki: errors carry a recovery reason", async () => {
  await assert.rejects(ankiInvoke(fakeAnki({ fail: "ECONNREFUSED" }).post, "", "version"), (e) => e.qiaomuReaderReason === "ankiunreachable");
  await assert.rejects(ankiInvoke(fakeAnki({ status: 403 }).post, "", "version"), (e) => e.qiaomuReaderReason === "ankiforbidden");
  const apiError = async () => ({ status: 200, json: { result: null, error: "deck was not found" } });
  await assert.rejects(ankiInvoke(apiError, "", "addNotes"), (e) => e.qiaomuReaderReason === "ankiapi" && /deck/.test(e.message));
});
