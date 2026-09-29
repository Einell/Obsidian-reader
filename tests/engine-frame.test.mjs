import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

const code = (await transform(fs.readFileSync(new URL("../src/engine-frame.js", import.meta.url), "utf8"), { format: "cjs" })).code;
function evaluate(dom) {
    dom.window.module = { exports: {} };
    vm.runInContext(`(function () { ${code}\n})();`, dom.getInternalVMContext());
    return dom.window.module.exports;
}

const chapter = '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="blob:book-style"/></head><body><p id="chapter">正文<br/>下一行</p><img src="blob:book-image"/></body></html>';
function fixture(t) {
    const dom = new JSDOM("<main></main>", { runScripts: "outside-only" });
    dom.window.URL.createObjectURL = URL.createObjectURL;
    dom.window.URL.revokeObjectURL = URL.revokeObjectURL;
    const api = evaluate(dom);
    const { configureEngineFrames, createEngineObjectURL, revokeEngineObjectURL } = api;
    t.after(() => { configureEngineFrames(false); dom.window.close(); });
    // JSDOM has no srcdoc navigation. Simulate only that boundary; retain real
    // document parsing, DOM lifecycle, shadow roots and MutationObservers.
    const frame = dom.window.document.createElement("div");
    dom.window.document.querySelector("main").append(frame);
    let source = "", url = "";
    Object.defineProperties(frame, {
        srcdoc: { get: () => source, set(value) { source = value; } },
        src: { get: () => url, set(value) { url = value; } },
    });
    const loaded = (html = source, location = "about:srcdoc") => {
        const doc = new dom.window.DOMParser().parseFromString(html, "text/html");
        Object.defineProperty(doc, "URL", { value: location });
        frame.contentDocument = doc;
        frame.dispatchEvent(new dom.window.Event("load"));
    };
    const objectURL = (content = chapter, type = "application/xhtml+xml") => {
        const value = createEngineObjectURL(new Blob([content], { type }));
        t.after(() => revokeEngineObjectURL(value));
        return value;
    };
    return { dom, frame, loaded, objectURL, ...api };
}

test("Android renders a chapter without navigating to its blocked Blob URL and retains resource URLs and anchors", async t => {
    const { frame, loaded, objectURL, configureEngineFrames, loadEngineFrame } = fixture(t);
    configureEngineFrames(true);
    const pending = loadEngineFrame(frame, objectURL(), doc => doc);
    await new Promise(setImmediate);
    assert.equal(frame.src, "");
    assert.match(frame.srcdoc, /<!doctype html>/i);
    loaded();
    const doc = await pending;
    assert.equal(doc.getElementById("chapter").textContent, "正文下一行");
    assert.equal(doc.querySelector("img").getAttribute("src"), "blob:book-image");
    assert.equal(doc.querySelector("link").getAttribute("href"), "blob:book-style");
    assert.equal(doc.querySelectorAll("br").length, 1);
});

test("desktop keeps URL navigation and clears stale srcdoc; an initial blank load is ignored", async t => {
    const { frame, loaded, objectURL, configureEngineFrames, loadEngineFrame } = fixture(t);
    configureEngineFrames(false);
    frame.setAttribute("srcdoc", "old chapter");
    const url = objectURL();
    let calls = 0;
    const pending = loadEngineFrame(frame, url, () => ++calls);
    assert.equal(frame.src, url);
    assert.equal(frame.hasAttribute("srcdoc"), false);
    loaded("", "about:blank");
    assert.equal(calls, 0);
    loaded(chapter, url);
    assert.equal(await pending, 1);
    loaded(chapter, url);
    assert.equal(calls, 1);
});

test("a silently blocked chapter rejects on timeout instead of waiting forever", async t => {
    const { frame, objectURL, configureEngineFrames, loadEngineFrame } = fixture(t);
    configureEngineFrames(false);
    await assert.rejects(loadEngineFrame(frame, objectURL(), () => {}, 15), /timed out/);
});

test("frame errors and rendering exceptions reject the pending load", async t => {
    const { dom, frame, loaded, objectURL, loadEngineFrame } = fixture(t);
    const failed = loadEngineFrame(frame, objectURL(), () => {});
    frame.dispatchEvent(new dom.window.Event("error"));
    await assert.rejects(failed, /Could not load/);
    const render = loadEngineFrame(frame, objectURL(), () => { throw new Error("layout failed"); });
    loaded();
    await assert.rejects(render, /layout failed/);
});

test("closing a frame inside nested shadow roots cancels immediately and removes listeners", async t => {
    const { dom, frame, loaded, objectURL, loadEngineFrame } = fixture(t);
    const outer = dom.window.document.createElement("section");
    dom.window.document.body.append(outer);
    const middle = dom.window.document.createElement("section");
    outer.attachShadow({ mode: "open" }).append(middle);
    middle.attachShadow({ mode: "open" }).append(frame);
    let calls = 0;
    const pending = loadEngineFrame(frame, objectURL(), () => ++calls);
    middle.remove();
    await assert.rejects(pending, { name: "AbortError" });
    loaded();
    assert.equal(calls, 0);
    await assert.rejects(loadEngineFrame(frame, objectURL(), () => {}), { name: "AbortError" });
});

test("invalid chapter XHTML rejects without leaving a hidden frame pending", async t => {
    const { frame, objectURL, configureEngineFrames, loadEngineFrame } = fixture(t);
    configureEngineFrames(true);
    await assert.rejects(loadEngineFrame(frame, objectURL("<html><p>broken"), () => {}), /Invalid chapter XHTML/);
});

test("HTML chapters use srcdoc, while non-chapter and revoked URLs use the URL path", async t => {
    const { frame, loaded, objectURL, configureEngineFrames, loadEngineFrame, revokeEngineObjectURL } = fixture(t);
    configureEngineFrames(true);
    const html = "<body><img src='blob:comic-page'></body>";
    const pending = loadEngineFrame(frame, objectURL(html, "text/html"), () => {});
    await new Promise(setImmediate);
    assert.equal(frame.srcdoc, html);
    loaded(); await pending;
    const revoked = objectURL();
    revokeEngineObjectURL(revoked);
    for (const url of [objectURL("image", "image/png"), revoked]) {
        const load = loadEngineFrame(frame, url, () => {});
        assert.equal(frame.src, url);
        loaded(chapter, url); await load;
    }
});

test("old custom-element loaders can read chapter blobs created after a same-build reload", async t => {
    const { dom, frame, loaded, loadEngineFrame } = fixture(t);
    const reloaded = evaluate(dom);
    reloaded.configureEngineFrames(true);
    const url = reloaded.createEngineObjectURL(new Blob([chapter], { type: "application/xhtml+xml" }));
    t.after(() => reloaded.revokeEngineObjectURL(url));
    const pending = loadEngineFrame(frame, url, () => {});
    await new Promise(setImmediate);
    assert.ok(frame.srcdoc.includes("正文"));
    loaded(); await pending;
});
