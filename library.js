// 先生の端末に保存するクイズ（問題は localStorage、画像は IndexedDB）
(function () {
  const KEY = "quiz-library-v1";
  let memory = null; // localStorage が使えないときの代わり（ページを閉じると消える）

  function load() {
    if (memory) return memory;
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : { quizzes: [] };
    } catch {
      memory = { quizzes: [] };
      return memory;
    }
  }
  function store(data) {
    if (memory) { memory = data; return; }
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { memory = data; UI.toast("この端末に保存できません。ページを閉じると消えます"); }
  }

  const list = () => load().quizzes;
  const get = (id) => list().find((q) => q.id === id) || null;
  function save(quiz) {
    const data = load();
    const i = data.quizzes.findIndex((q) => q.id === quiz.id);
    if (i >= 0) data.quizzes[i] = quiz; else data.quizzes.unshift(quiz);
    store(data);
  }
  function remove(id) {
    const data = load();
    data.quizzes = data.quizzes.filter((q) => q.id !== id);
    store(data);
  }

  // ---- 画像（IndexedDB） ----
  let dbp = null;
  const memImages = new Map();
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve) => {
        try {
          const req = indexedDB.open("quiz-images", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("images");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    if (!d) return fn(null);
    return new Promise((resolve, reject) => {
      const t = d.transaction("images", mode);
      const r = fn(t.objectStore("images"));
      t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  async function putImage(id, dataUrl) {
    memImages.set(id, dataUrl);
    await tx("readwrite", (s) => s && s.put(dataUrl, id)).catch(() => {});
  }
  async function getImage(id) {
    if (memImages.has(id)) return memImages.get(id);
    const v = await tx("readonly", (s) => s && s.get(id)).catch(() => undefined);
    if (v) memImages.set(id, v);
    return v || null;
  }
  async function deleteImage(id) {
    memImages.delete(id);
    await tx("readwrite", (s) => s && s.delete(id)).catch(() => {});
  }
  async function getImages(ids) {
    const out = {};
    for (const id of ids) { const v = await getImage(id); if (v) out[id] = v; }
    return out;
  }

  // 長い辺を max px に縮めた JPEG の dataURL にする
  async function shrinkImage(file, max = 1280) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  }

  window.Library = { list, get, save, remove, putImage, getImage, deleteImage, getImages, shrinkImage };
})();
