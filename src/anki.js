// AnkiConnect client. The transport is injected so the reader can use
// Obsidian's requestUrl (no CORS) and tests can use a fake.
// https://git.foosoft.net/alex/anki-connect

export const ANKI_DEFAULT_URL = "http://127.0.0.1:8765";
export const ANKI_DEFAULT_DECK = "Qiaomu Reader";
export const ANKI_MODEL = "Qiaomu Reader Vocabulary";
export const ANKI_ADDON_CODE = "2055492159";

// Colours are left to Anki so its light and night modes both work.
const MODEL_CSS = ".card{font-family:-apple-system,system-ui,sans-serif;font-size:20px;line-height:1.55;text-align:left;}"
  + ".word{font-size:28px;font-weight:600;letter-spacing:-0.01em;}.ctx{margin-top:14px;font-size:16px;opacity:.65;}.ctx a{color:inherit;}";

function ankiError(reason, message) {
  const error = new Error(message || reason);
  error.qiaomuReaderReason = reason;
  return error;
}

// post(url, body) resolves { status, json } or rejects when unreachable.
export async function ankiInvoke(post, url, action, params = {}) {
  let res;
  try {
    res = await post(url || ANKI_DEFAULT_URL, { action, version: 6, params });
  } catch (error) {
    throw ankiError("ankiunreachable", error?.message || "AnkiConnect is unreachable");
  }
  if (res?.status === 403) throw ankiError("ankiforbidden", "AnkiConnect refused the request");
  if (!res || res.status < 200 || res.status >= 300) throw ankiError("ankiunreachable", `AnkiConnect http ${res?.status}`);
  const data = res.json;
  if (!data || typeof data !== "object" || !("result" in data)) throw ankiError("ankiapi", "Unexpected AnkiConnect response");
  if (data.error) throw ankiError("ankiapi", String(data.error));
  return data.result;
}

export { MODEL_CSS };
export async function ensureAnkiSetup(post, url, deck) {
  await ankiInvoke(post, url, "createDeck", { deck });
  const models = await ankiInvoke(post, url, "modelNames");
  if (!Array.isArray(models) || !models.includes(ANKI_MODEL)) {
    await ankiInvoke(post, url, "createModel", {
      modelName: ANKI_MODEL,
      inOrderFields: ["Word", "Meaning", "Context"],
      css: MODEL_CSS,
      cardTemplates: [{
        Name: "Recognize",
        Front: '<div class="word">{{Word}}</div>',
        Back: '<div class="word">{{Word}}</div><hr id="answer">{{Meaning}}<div class="ctx">{{Context}}</div>',
      }],
    });
  }
}

export function ankiNote(deck, fields, tags = []) {
  return {
    deckName: deck,
    modelName: ANKI_MODEL,
    fields,
    options: { allowDuplicate: false, duplicateScope: "deck" },
    tags: ["qiaomu-reader", ...tags.map((tag) => String(tag).replace(/\s+/g, "_")).filter(Boolean)],
  };
}

// Adds what Anki does not have yet. Duplicates (same word in the deck) are
// counted, not treated as failures, so syncing twice is harmless.
export async function addAnkiNotes(post, url, deck, notes) {
  if (!notes.length) return { added: 0, skipped: 0 };
  await ensureAnkiSetup(post, url, deck);
  const allowed = await ankiInvoke(post, url, "canAddNotes", { notes });
  const fresh = notes.filter((_, i) => Array.isArray(allowed) && allowed[i]);
  if (fresh.length) await ankiInvoke(post, url, "addNotes", { notes: fresh });
  return { added: fresh.length, skipped: notes.length - fresh.length };
}
