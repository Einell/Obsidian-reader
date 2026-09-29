import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { SectionProgress } from "foliate-js/progress.js";
import { enginePositionModel, parseReaderPosition } from "../src/reader-position.js";

test("reading locations invert Foliate's size mapping, including partial last locations and nonlinear sections", () => {
    const sections = [{ size: 1750 }, { size: 10000, linear: "no" }, { size: 3050 }];
    const model = enginePositionModel({ location: { current: 2 }, fraction: .6 }, { sections, pageList: null });
    assert.equal(model.total, 4); assert.equal(model.current, 3);
    const progress = new SectionProgress(sections, 1500, 1600);
    for (let n = 1; n <= model.total; n++) {
        const { fraction } = parseReaderPosition(String(n), model);
        const [index, within] = progress.getSection(fraction);
        assert.equal(progress.getProgress(index, within).location.current + 1, n);
    }
    assert.equal(parseReaderPosition("4", model).fraction, 4500 / 4800);
    assert.equal(parseReaderPosition("5", model), null);
});

test("original page labels support Roman numerals and sparse labels without guessing duplicate pages", () => {
    const model = enginePositionModel({ pageItem: { label: "42" } }, { pageList: [
        { label: "iv", href: "intro#iv" }, { label: "42", href: "chapter#p42", subitems: [{ label: "90", href: "chapter#p90" }] },
    ] });
    assert.equal(model.kind, "original");
    assert.deepEqual(parseReaderPosition("IV", model), { href: "intro#iv" });
    assert.deepEqual(parseReaderPosition("90", model), { href: "chapter#p90" });
    assert.equal(parseReaderPosition("43", model), null);
    model.pages.push({ label: "42", href: "appendix#p42" });
    assert.equal(parseReaderPosition("42", model), null);
});

test("percent targets accept endpoints and decimals; invalid or zero page numbers never navigate", () => {
    const model = { kind: "page", total: 30 };
    for (const text of ["", "-1", "0", "31", "1.5", "1e1", "NaN", "101%", "-1%"])
        assert.equal(parseReaderPosition(text, model), null, text);
    assert.deepEqual(parseReaderPosition("12.5%", model), { fraction: .125 });
    assert.deepEqual(parseReaderPosition("0", model, "percent"), { fraction: 0 });
    assert.deepEqual(parseReaderPosition("100", model, "percent"), { fraction: 1 });
    assert.equal(enginePositionModel({}, { sections: [] }).kind, "percent");
    assert.equal(enginePositionModel({}, { rendition: { layout: "pre-paginated" }, sections: [{}, {}] }, 1).current, 2);
});

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
test("EPUB picker bypasses the PDF pager, returns to the saved CFI, and rejects a stale book", async () => {
    let submit, returned;
    const start = source.indexOf("function openReaderPagePicker(");
    const code = source.slice(start, source.indexOf("\nfunction syncPdfZoomControls", start));
    const open = vm.runInNewContext(`${code}; openReaderPagePicker`, {
        GoToPageModal: class { constructor(_app, _total, _current, onSubmit) { submit = onSubmit; } open() {} },
        showFootnoteReturn: (_view, anchor) => { returned = anchor.cfi; },
    });
    const targets = [];
    const view = { file: {}, engine: { positionModel: () => ({ total: 10 }), currentLocation: () => ({ cfi: "before" }), goToPosition: async target => targets.push(target) } };
    open(view);
    await submit({ fraction: .5 }); assert.equal(targets.length, 1); assert.equal(returned, "before");
    view.file = {};
    await assert.rejects(submit({ fraction: .8 }), /Reader changed/);
    assert.equal(targets.length, 1);
});

function modalFixture(t, callback = async () => {}) {
    const dom = new JSDOM("<body></body>"); t.after(() => dom.window.close());
    const proto = dom.window.HTMLElement.prototype;
    proto.createEl = function (tag, options = {}) {
        const el = this.ownerDocument.createElement(tag);
        if (options.cls) el.className = options.cls;
        if (options.text) el.textContent = options.text;
        if (options.value !== undefined) el.value = options.value;
        for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
        this.append(el); return el;
    };
    proto.createDiv = function (options = {}) { return this.createEl("div", typeof options === "string" ? { cls: options } : options); };
    proto.createSpan = function (options) { return this.createEl("span", options); };
    proto.addClass = function (...names) { this.classList.add(...names); };
    proto.empty = function () { this.replaceChildren(); };
    proto.setText = function (text) { this.textContent = text; };
    class Modal {
        constructor() { this.modalEl = dom.window.document.body.createDiv(); this.contentEl = this.modalEl.createDiv(); }
        setTitle() {}
        close() { this.closed = true; this.onClose(); }
    }
    const start = source.indexOf("const GoToPageModal =");
    const code = source.slice(start, source.indexOf("// One group per chapter", start));
    const Picker = vm.runInNewContext(`${code}; GoToPageModal`, { Modal, qiaomuReaderTranslate: x => x, qiaomuReaderAutoFocus: el => el.focus(), parseReaderPosition });
    const modal = new Picker({}, 30, 3, callback); modal.onOpen();
    return { modal, dom, input: modal.contentEl.querySelector("input"), mode: modal.contentEl.querySelector("select"), go: modal.contentEl.querySelector(".qiaomu-reader-confirm-yes") };
}

test("jump form validates, respects IME, uses a numeric keyboard, and submits percent mode", async t => {
    const calls = [];
    const { dom, modal, input, mode, go } = modalFixture(t, n => calls.push(n));
    assert.equal(input.getAttribute("inputmode"), "numeric");
    assert.equal(input.getAttribute("aria-label"), null);
    input.value = "31"; go.click(); assert.equal(input.getAttribute("aria-invalid"), "true");
    mode.value = "percent"; mode.dispatchEvent(new dom.window.Event("change")); input.value = "50";
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", isComposing: true }));
    assert.equal(calls.length, 0);
    go.click(); await new Promise(setImmediate);
    assert.deepEqual(calls, [16]); assert.equal(modal.closed, true);
});

test("jump failure retains the typed destination for retry; cancel never submits", async t => {
    let attempts = 0;
    const { modal, input, go } = modalFixture(t, async () => { attempts++; throw new Error("offline"); });
    input.value = "8"; go.click(); await new Promise(setImmediate);
    assert.equal(input.value, "8"); assert.equal(go.disabled, false); assert.equal(modal.closed, undefined);
    assert.equal(modal.contentEl.querySelector('[role="alert"]').textContent, "position-jump-failed");
    modal.contentEl.querySelector("button").click(); assert.equal(attempts, 1); assert.equal(modal.closed, true);
});
