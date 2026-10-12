/**
 * [INPUT]: 依赖 Node 文件系统与路径处理
 * [OUTPUT]: buildCatalog、findStickerById、MAX_STICKER_BYTES
 * [POS]: 贴纸索引唯一所有者；拒绝同名根目录，HTTP 与工具共享完整 ID
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { promises as fs } from "node:fs";
import { extname, join, relative, sep } from "node:path";
const IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
]);

/** 单个贴纸文件的大小上限。 */
export const MAX_STICKER_BYTES = 12 * 1024 * 1024;

/** 限制扫描深度、目录项、包数和每包素材数量。 */
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_ENTRIES = 4000;
const MAX_PACKS = 60;
const MAX_STICKERS_PER_PACK = 400;

function stickerId(pack, sticker) {
  return `${pack}/${sticker}`;
}

/** 路径片段归一化为稳定可读标签。 */
function labelOf(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/** 读取 SVG 显式尺寸或 viewBox；没有固有尺寸时不入目录。 */
function hasSvgSize(buffer) {
  const head = buffer.subarray(0, 4096).toString("utf8");
  const tag = /<svg\b[^>]*>/iu.exec(head)?.[0];
  if (tag === undefined) return false;
  const number = (name) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu").exec(
      tag,
    );
    if (match === null) return undefined;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|pc|cm|mm|in|q)?$/iu.test(match[1].trim())) return undefined;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const declared = { width: number("width"), height: number("height") };
  if (declared.width !== undefined && declared.height !== undefined)
    return true;
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
  if (viewBox === undefined) return false;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return false;
  const [, , width, height] = parts;
  return width > 0 && height > 0;
}

/** Depth-first walk with depth/entry bounds, returning image file paths. */
async function collectImages(root, state) {
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && state.entries < MAX_SCAN_ENTRIES) {
    const { dir, depth } = stack.pop();
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (state.entries >= MAX_SCAN_ENTRIES) break;
      state.entries += 1;
      const full = join(dir, child.name);
      if (child.isDirectory()) {
        if (depth + 1 <= MAX_SCAN_DEPTH && !child.name.startsWith(".")) {
          stack.push({ dir: full, depth: depth + 1 });
        }
        continue;
      }
      if (!child.isFile()) continue;
      const extension = extname(child.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) continue;
      found.push({ path: full, relativePath: relative(root, full), extension });
    }
  }
  found.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return found;
}

/** 根目录形成包，子目录形成子包；达到包数上限后将路径扁平到素材名。 */
async function buildCatalog(settings) {
  const packs = [];
  const errors = [];
  const packRoots = new Map();
  for (const root of settings.paths) {
    if (packs.length >= MAX_PACKS) break;
    let stat;
    try {
      stat = await fs.stat(root);
    } catch {
      errors.push({ path: root, reason: "missing" });
      continue;
    }
    if (!stat.isDirectory()) {
      errors.push({ path: root, reason: "not-directory" });
      continue;
    }
    const state = { entries: 0 };
    const images = await collectImages(root, state);
    /** @type {Map<string, {name: string, images: Array}>} */
    const groups = new Map();
    const baseName = labelOf(
      root.split(/[\\/]/u).filter(Boolean).pop() ?? root,
    );
    if (packRoots.has(baseName)) {
      errors.push({ path: root, reason: "duplicate-pack" });
      continue;
    }
    packRoots.set(baseName, root);
    for (const image of images) {
      const segments = image.relativePath.split(sep).filter(Boolean);
      const fileLabel = labelOf(
        segments.pop()?.replace(/\.[^.]+$/u, "") ?? "sticker",
      );
      const nested = segments.map(labelOf).filter(Boolean);
      const nestedName = `${baseName}/${nested.join("/")}`;
      const wanted =
        groups.has(nestedName) || packs.length + groups.size + 1 < MAX_PACKS;
      const groupName =
        wanted && nested.length > 0
          ? `${baseName}/${nested.join("/")}`
          : baseName;
      const stickerName =
        wanted && nested.length > 0
          ? fileLabel
          : [...nested, fileLabel].join("-");
      const group = groups.get(groupName) ?? {
        name: groupName,
        images: [],
      };
      group.images.push({ name: stickerName, ...image });
      groups.set(groupName, group);
    }
    for (const group of groups.values()) {
      const stickers = [];
      const used = new Set();
      for (const image of group.images.slice(0, MAX_STICKERS_PER_PACK)) {
        let stickerName = image.name;
        let suffix = 2;
        while (used.has(stickerName)) stickerName = `${image.name}-${suffix++}`;
        used.add(stickerName);
        let handle;
        try {
          handle = await fs.open(image.path, "r");
          const stat = await handle.stat();
          if (stat.size > MAX_STICKER_BYTES) continue;
          if (image.extension === ".svg" && !hasSvgSize(await handle.readFile()))
            continue;
        } catch {
          continue;
        } finally {
          await handle?.close();
        }
        stickers.push({
          id: stickerId(group.name, stickerName),
          name: stickerName,
          mime: IMAGE_EXTENSIONS.get(image.extension),
          file: image.path,
        });
      }
      if (stickers.length === 0) continue;
      packs.push({
        id: group.name,
        name: group.name,
        stickers,
      });
    }
  }
  return { packs, errors };
}

/** 按完整 ID 查找，嵌套包与根包使用相同规则。 */
function findStickerById(catalog, id) {
  const wanted = String(id ?? "");
  if (wanted === "") return undefined;
  for (const pack of catalog?.packs ?? []) {
    for (const sticker of pack.stickers ?? []) {
      if (sticker.id === wanted) return sticker;
    }
  }
  return undefined;
}

export { buildCatalog, findStickerById };
