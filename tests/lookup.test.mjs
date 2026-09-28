import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  isLookupTerm, cleanLookupTerm, sentenceAround, rangeContext, buildTranslateMessages, buildLookupMessages,
  parseLookupAnswer, parseGoogleLookup, googleDetectedLanguage, sameLanguage, fallbackTarget,
  looksLikeLanguage, lookupEngine, lookupSessionKey, lookupCacheKey, createLookupCache,
} from "../src/lookup.js";

test("short selections are looked up, passages are translated", () => {
  assert.equal(isLookupTerm("serendipity"), true);
  assert.equal(isLookupTerm("serendipity,"), true, "a trailing comma from double-click is ignored");
  assert.equal(isLookupTerm("take off"), true);
  assert.equal(isLookupTerm("mother-in-law's"), true);
  assert.equal(isLookupTerm("意外之喜"), true);
  assert.equal(isLookupTerm("这是一个很长的句子"), false);
  assert.equal(isLookupTerm("She said, quietly, that it was over."), false);
  assert.equal(isLookupTerm("one two three four"), false);
  assert.equal(isLookupTerm("12345"), false);
  assert.equal(cleanLookupTerm("  “Serendipity.” "), "Serendipity");
});

test("context is the sentence around the selection, bounded in length", () => {
  const text = "First one. The quick fox jumps! Last.";
  const start = text.indexOf("quick");
  assert.equal(sentenceAround(text, start, start + 5), "The quick fox jumps!");
  assert.equal(sentenceAround("一句。第二句里有词！结尾", 5, 6), "第二句里有词！");
  assert.ok(sentenceAround("a".repeat(2000), 1000, 1001, 100).length <= 202);
});

test("range context walks up to the paragraph", () => {
  const { window } = new JSDOM("<p>Before. He felt a <em>serendipity</em> today. After.</p>");
  const em = window.document.querySelector("em");
  const range = window.document.createRange();
  range.selectNodeContents(em);
  assert.equal(rangeContext(range), "He felt a serendipity today.");
});

test("prompts carry target, fallback, book and context as data", () => {
  const t = buildTranslateMessages({ text: "Hello", context: "Hello there.", book: "Dune", target: "zh-CN" });
  assert.match(t[0].content, /简体中文/);
  assert.match(t[0].content, /English/, "same-language fallback is spelled out");
  assert.equal(t.length, 1, "every request is self-contained for reused CLI sessions");
  assert.equal(t[0].role, "user");
  assert.match(t[0].content, /《Dune》/);
  assert.match(t[0].content, /Hello there\./);
  const w = buildLookupMessages({ term: "spice", sentence: "The spice must flow.", target: "ja" });
  assert.match(w[0].content, /日本語/);
  assert.match(w[0].content, /JSON/);
  assert.match(w[0].content, /The spice must flow\./);
});

test("model answers are parsed defensively", () => {
  const answer = 'Sure:\n```json\n{"lemma":"run","phonetic":"/rʌn/","meaning":"经营","senses":[{"pos":"v.","def":"跑"},{"pos":"v.","def":""}],"note":1}\n```';
  const card = parseLookupAnswer(answer);
  assert.equal(card.lemma, "run");
  assert.equal(card.meaning, "经营");
  assert.deepEqual(card.senses, [{ pos: "v.", def: "跑" }]);
  assert.equal(card.note, "");
  assert.equal(parseLookupAnswer("not json"), null);
  assert.equal(parseLookupAnswer('{"lemma":"x"}'), null);
});

test("google dictionary payloads and detected language", () => {
  const payload = [[["意外发现", "serendipity", null, null]], [["noun", ["机缘巧合", "意外发现"]]], "en"];
  const card = parseGoogleLookup(payload);
  assert.equal(card.meaning, "意外发现");
  assert.deepEqual(card.senses, [{ pos: "noun", def: "机缘巧合；意外发现" }]);
  assert.equal(googleDetectedLanguage(payload), "en");
  assert.equal(parseGoogleLookup([[]]), null);
});

test("language rules follow common selection translators", () => {
  assert.equal(sameLanguage("zh-CN", "zh"), true);
  assert.equal(sameLanguage("zh-CN", "zh-TW"), false);
  assert.equal(sameLanguage("en", "en-US"), true);
  assert.equal(fallbackTarget("zh-CN"), "en");
  assert.equal(fallbackTarget("zh-TW"), "en");
  assert.equal(fallbackTarget("en"), "zh-CN");
  assert.equal(looksLikeLanguage("这是中文", "zh-CN"), true);
  assert.equal(looksLikeLanguage("これは日本語です", "zh-CN"), false);
  assert.equal(looksLikeLanguage("hello", "zh-CN"), false);
});

test("AI engine is used only when chosen and ready", () => {
  assert.equal(lookupEngine({ translateEngine: "ai" }, true), "ai");
  assert.equal(lookupEngine({ translateEngine: "ai" }, false), "google");
  assert.equal(lookupEngine({}, true), "google");
});

test("cache keys separate engines, targets and AI word contexts", () => {
  const a = lookupCacheKey("word", "ai", "zh-CN", "Run", "He runs a shop.");
  assert.notEqual(a, lookupCacheKey("word", "ai", "zh-CN", "run", "He runs fast."));
  assert.equal(lookupCacheKey("word", "google", "zh-CN", "Run", "x"), lookupCacheKey("word", "google", "zh-CN", "run", "y"));
  assert.notEqual(a, lookupCacheKey("word", "ai", "en", "Run", "He runs a shop."));
  const cache = createLookupCache(2);
  cache.set("a", 1); cache.set("b", 2); cache.get("a"); cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.size, 2);
});

test("CLI session keys separate kinds and rotate", () => {
  assert.notEqual(lookupSessionKey("word", 1), lookupSessionKey("text", 1));
  assert.equal(lookupSessionKey("word", 1), lookupSessionKey("word", 11));
  assert.notEqual(lookupSessionKey("word", 1), lookupSessionKey("word", 12));
});
