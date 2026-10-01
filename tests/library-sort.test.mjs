import assert from "node:assert/strict";
import test from "node:test";
import { applyVisibleMove, sortLibraryBooks } from "../src/library-sort.js";

const books = [
  { path: "a", basename: "甲" },
  { path: "b", basename: "乙" },
  { path: "c", basename: "丙" },
];
const times = {
  a: { opened: 1, updated: 30, created: 5 },
  b: { opened: 20, updated: 2, created: 9 },
  c: { opened: 10, updated: 15, created: 40 },
};

test("library sort uses newest opened, updated, or created time", () => {
  const timeOf = (book, key) => times[book.path][key];
  assert.deepEqual(sortLibraryBooks(books, "opened", [], timeOf).map((book) => book.path), ["b", "c", "a"]);
  assert.deepEqual(sortLibraryBooks(books, "updated", [], timeOf).map((book) => book.path), ["a", "c", "b"]);
  assert.deepEqual(sortLibraryBooks(books, "created", [], timeOf).map((book) => book.path), ["c", "b", "a"]);
});

test("custom library order keeps unknown books after the saved sequence", () => {
  const ordered = sortLibraryBooks(books, "custom", ["c", "a"], () => 0);
  assert.deepEqual(ordered.map((book) => book.path), ["c", "a", "b"]);
});

test("dragging a visible book leaves hidden books in their slots", () => {
  assert.deepEqual(applyVisibleMove(["a", "b", "c", "d"], ["a", "c"], "c", "a"), ["c", "b", "a", "d"]);
  assert.deepEqual(applyVisibleMove(["a", "b", "c"], ["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
});
