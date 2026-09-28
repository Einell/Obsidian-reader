/** Track the active view in one host window; release listeners and state on unload. */
export function watchReaderStatusBar(workspace, document) {
  let stopped = false;
  let queued = false;
  const types = new Set(["qiaomu-reader", "qiaomu-reader-library", "qiaomu-book-reader-ai-chat"]);
  const update = () => {
    queued = false;
    if (stopped) return;
    const active = document.querySelector(".workspace-leaf.mod-active > .workspace-leaf-content");
    document.body.classList.toggle("qiaomu-reader-active-view", types.has(active?.getAttribute("data-type")));
  };
  const schedule = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(update);
  };
  const refs = [workspace.on("active-leaf-change", schedule), workspace.on("layout-change", schedule)];
  update();
  return () => {
    stopped = true;
    refs.forEach(ref => workspace.offref(ref));
    document.body.classList.remove("qiaomu-reader-active-view");
  };
}
