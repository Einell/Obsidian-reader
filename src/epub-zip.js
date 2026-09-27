// EPUB archives from some web exporters store UTF-8 file names without the
// ZIP "language encoding" flag (general purpose bit 11). zip.js then decodes
// those names as CP437, so Chinese chapter paths in the OPF no longer match any
// entry and only ASCII-named pages (cover, toc) render. OCF requires UTF-8
// names, so a name that is valid UTF-8 is read as UTF-8; anything else keeps
// zip.js's CP437 fallback instead of collapsing into U+FFFD. Foliate's own zip
// loader receives these options through the build patch in
// scripts/foliate-elements.mjs.
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function decodeZipText(bytes, encoding) {
    if (String(encoding || "").trim().toLowerCase() !== "cp437") return undefined;
    try { return utf8.decode(bytes); } catch { return undefined; }
}

export const EPUB_ZIP_OPTIONS = Object.freeze({ decodeText: decodeZipText });
