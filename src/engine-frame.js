// Keep chapter Blobs available when Android WebView cannot navigate an iframe
// to their object URLs. Images, fonts and other resources retain their URLs.
// Custom element classes survive plugin reloads: their old loader and the new
// book parser must share the same registry for an identical engine build.
const frameStateKey = Symbol.for(`${typeof __QBR_ENGINE_VIEW_TAG__ === "string"
    ? __QBR_ENGINE_VIEW_TAG__ : "qiaomu-reader-engine"}:chapter-frames`);
// This registry belongs to the module realm where the retained custom-element
// classes live, not whichever popout is active. Frame DOM/timers use ownerDocument.
function frameState() {
    if (!window[frameStateKey]) {
        Object.defineProperty(window, frameStateKey, {
            value: { android: false, blobs: new Map() },
        });
    }
    return window[frameStateKey];
}

export function configureEngineFrames(android) {
    frameState().android = !!android;
}

export function createEngineObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    const state = frameState();
    if (state.android && /^(text\/html|application\/xhtml\+xml)(;|$)/i.test(blob.type)) {
        state.blobs.set(url, blob);
    }
    return url;
}

export function revokeEngineObjectURL(url) {
    frameState().blobs.delete(url);
    URL.revokeObjectURL(url);
}

async function chapterSource(blob, win) {
    const source = await blob.text();
    if (!blob.type.toLowerCase().startsWith("application/xhtml+xml")) return source;
    const xml = new win.DOMParser().parseFromString(source, "application/xhtml+xml");
    if (xml.querySelector("parsererror")) throw new Error("Invalid chapter XHTML");
    // srcdoc is parsed as HTML, so serialize with HTML void-element rules.
    const html = win.document.implementation.createHTMLDocument("");
    html.replaceChild(html.importNode(xml.documentElement, true), html.documentElement);
    return "<!doctype html>" + html.documentElement.outerHTML;
}

export function loadEngineFrame(frame, src, afterLoad, timeoutMs = 10_000) {
    const win = frame.ownerDocument.defaultView;
    const state = frameState();
    const blob = state.android ? state.blobs.get(src) : null;
    return new Promise((resolve, reject) => {
        let settled = false, started = false, observer;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            win.clearTimeout(timer);
            observer?.disconnect();
            frame.removeEventListener("load", onLoad);
            frame.removeEventListener("error", onError);
            if (error) reject(error);
            else resolve(result);
        };
        const onError = () => finish(new Error("Could not load the chapter frame"));
        const onLoad = () => {
            if (!started || settled) return;
            try {
                const doc = frame.contentDocument;
                // Ignore the initial blank document's load before navigation.
                if (doc?.URL === "about:blank" && src !== "about:blank") return;
                if (!doc) throw new Error("Chapter frame is not accessible");
                finish(null, afterLoad(doc));
            } catch (error) { finish(error); }
        };
        const abort = () => finish(Object.assign(new Error("Reader closed"), { name: "AbortError" }));
        const timer = win.setTimeout(() => finish(new Error("Chapter loading timed out")), timeoutMs);
        frame.addEventListener("load", onLoad);
        frame.addEventListener("error", onError);
        if (!frame.isConnected) { abort(); return; }
        observer = new win.MutationObserver(() => { if (!frame.isConnected) abort(); });
        // Include every containing shadow root, not just the document: closing
        // a view can remove its host inside another custom element's shadow DOM.
        let root = frame.getRootNode();
        while (root) {
            observer.observe(root, { childList: true, subtree: true });
            root = root.host?.getRootNode();
        }
        void (async () => {
            if (blob) {
                const source = await chapterSource(blob, win);
                if (settled) return;
                started = true;
                frame.srcdoc = source;
            } else {
                started = true;
                frame.removeAttribute("srcdoc");
                frame.src = src;
            }
        })().catch(error => finish(error));
    });
}
