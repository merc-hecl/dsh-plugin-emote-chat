/**
 * [INPUT]: shared 的标记解析和素材定位，dom 的容器查找
 * [OUTPUT]: createStickerPainter
 * [POS]: 可逆 DOM 投影；图片与隐藏原文并存，卸载恢复宿主文本和显示状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import {
  TOKEN_OPEN,
  TOKEN_CLOSE,
  MESSAGE_FLOW_KINDS,
  NON_MESSAGE_REGIONS,
  stickerUrl,
  findSticker,
  splitTokens,
} from "./shared.js";
import { findClassFragment } from "./dom.js";
function sideOf(element, flow) {
  const owner =
    flow ??
    element?.closest?.("[data-chat-flow-kind]") ??
    element?.parentElement?.closest?.("[data-chat-flow-kind]") ??
    null;
  const kind = owner?.getAttribute?.("data-chat-flow-kind") ?? null;
  return kind === "user" || kind === "steering" ? "right" : "left";
}

function rowOf(element) {
  return (
    element?.closest?.(
      "[data-time-hover-root], [data-chat-flow-kind], [data-chat-flow-key]",
    ) ?? null
  );
}

function textWithoutGhosts(element) {
  let out = "";
  for (const child of element.childNodes ?? []) {
    if (child.nodeType === 3) {
      out += child.nodeValue ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (
      child.getAttribute?.("data-emote-hidden") !== null &&
      child.getAttribute?.("data-emote-hidden") !== undefined
    )
      continue;
    out += textWithoutGhosts(child);
  }
  return out;
}

function isGhost(node) {
  return (
    node?.nodeType === 1 && node.getAttribute?.("data-emote-hidden") != null
  );
}

function trimOuterWhitespace(container) {
  const hide = (node, leading) => {
    const value = node.nodeValue ?? "";
    const removed = leading
      ? /^[\r\n]+/u.exec(value)?.[0]
      : /[\r\n]+$/u.exec(value)?.[0];
    if (!removed) return;
    const ghost = document.createElement("span");
    ghost.setAttribute("data-emote-hidden", "1");
    ghost.style.display = "none";
    ghost.textContent = removed;
    if (leading) {
      container.insertBefore(ghost, node);
      node.nodeValue = value.slice(removed.length);
    } else {
      node.nodeValue = value.slice(0, -removed.length);
      node.after ? node.after(ghost) : container.appendChild(ghost);
    }
  };
  const first = [...container.childNodes].find((node) => !isGhost(node));
  const last = [...container.childNodes]
    .reverse()
    .find((node) => !isGhost(node));
  if (first?.nodeType === 3) hide(first, true);
  if (last?.nodeType === 3) hide(last, false);
}

function stickerAnchor(inside, row) {
  let element = inside;
  while (element !== null && element !== row) {
    if (
      findClassFragment(element, "userstack") !== null ||
      findClassFragment(element, "bubble") !== null
    ) {
      return element;
    }
    element = element.parentElement;
  }
  const bubble = inside?.closest?.("[class*='bubble']") ?? null;
  if (bubble?.parentElement != null) return bubble.parentElement;
  return row;
}

function buildSticker(id, t) {
  const figure = document.createElement("figure");
  figure.setAttribute("data-emote-sticker", id);
  const image = document.createElement("img");
  image.src = stickerUrl(id);
  image.alt = t("sticker.alt", { name: id });
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () =>
    figure.setAttribute("data-failed", "1"),
  );
  // 标记只保留在隐藏原文里，图注不重复标记，避免改变 textContent。
  figure.append(image);
  return figure;
}

function createStickerPainter({ getCatalog, t, isEnabled }) {
  const ghosts = new Set();
  const hiddenElements = new Map();

  let placedInThisPass = false;

  const ghostFor = (raw, stickerId) => {
    const ghost = document.createElement("span");
    ghost.setAttribute("data-emote-hidden", "1");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("data-emote-token", stickerId);
    ghost.style.display = "none";
    ghost.style.position = "absolute";
    ghost.style.width = "0";
    ghost.style.height = "0";
    ghost.style.overflow = "hidden";
    ghost.textContent = raw;
    ghosts.add(ghost);
    return ghost;
  };

  const reconcile = () => {
    for (const ghost of [...ghosts]) {
      // 宿主已重建文本节点；下一轮扫描重新投影。
      if (ghost.parentElement === null || ghost.isConnected === false) {
        ghosts.delete(ghost);
        continue;
      }
      const id = ghost.getAttribute("data-emote-token");
      if (id === null || id === "") continue;
      const row = rowOf(ghost);
      if (row === null) continue;
      const figures = [...row.querySelectorAll("[data-emote-sticker]")].filter(
        (figure) => figure.getAttribute("data-emote-sticker") === id,
      );
      // 图片被回收或重复创建时，修复为恰好一个投影。
      if (figures.length === 1) continue;
      for (const extra of figures.slice(1)) extra.remove();
      if (figures.length >= 1) {
        placedInThisPass = true;
        continue;
      }
      const figure = buildSticker(id, t);
      figure.setAttribute("data-side", sideOf(ghost, row));
      const anchor = stickerAnchor(ghost.parentElement ?? row, row);
      anchor.insertBefore(figure, anchor.firstChild);
      placedInThisPass = true;
    }
  };

  const scan = () => {
    if (!isEnabled()) {
      restore();
      return;
    }
    const catalog = getCatalog();
    if (catalog === undefined) return;
    placedInThisPass = false;

    const roots = document.querySelectorAll("[data-chat-flow-kind]");
    for (const root of roots) {
      if (
        !MESSAGE_FLOW_KINDS.has(root.getAttribute("data-chat-flow-kind") ?? "")
      )
        continue;
      const row = rowOf(root) ?? root;
      // 已投影标记位于隐藏节点，不重复处理。
      const carriers = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) !== null) {
        const parent = node.parentElement;
        if (parent === null) continue;
        // 跳过隐藏原文，避免对插件自己的投影再次加工。
        if (parent.closest("[data-emote-hidden]") !== null) continue;
        if (parent.closest("[data-emote-sticker]") !== null) continue;
        // 只投影消息正文；排除推理、过程、代码块和工具卡片。
        if (parent.closest("pre, code") !== null) continue;
        if (parent.closest(NON_MESSAGE_REGIONS) !== null) continue;
        const value = node.nodeValue ?? "";
        if (value.indexOf(TOKEN_OPEN) === -1) continue;
        if (splitTokens(value).every((segment) => segment.token === undefined))
          continue;
        carriers.push(node);
      }

      for (const carrier of carriers) {
        const segments = splitTokens(carrier.nodeValue ?? "");
        const placeable = segments.filter(
          (segment) =>
            segment.token !== undefined &&
            findSticker(catalog, segment.token) !== undefined,
        );
        if (placeable.length === 0) continue;
        const parent = carrier.parentElement;
        if (parent === null) continue;
        const side = sideOf(carrier, root);
        // 原文与标记保留在文本位置；图片独立移到宿主消息容器，textContent 不变。
        const fragment = document.createDocumentFragment();
        const figures = [];
        for (const segment of segments) {
          if (segment.token === undefined) {
            if (segment.text === "") continue;
            // 前导空白移入隐藏节点，保留原文且不产生可见空行。
            const previous =
              fragment.childNodes[fragment.childNodes.length - 1];
            const followsGhost =
              previous !== undefined &&
              previous.getAttribute?.("data-emote-hidden") != null;
            const whitespace = followsGhost
              ? (/^[\s\u00a0]+/u.exec(segment.text)?.[0] ?? "")
              : "";
            if (whitespace) fragment.appendChild(ghostFor(whitespace, ""));
            fragment.appendChild(
              document.createTextNode(segment.text.slice(whitespace.length)),
            );
            continue;
          }
          const raw = segment.raw ?? TOKEN_OPEN + segment.token + TOKEN_CLOSE;
          if (findSticker(catalog, segment.token) === undefined) {
            // 素材不可用时保留原始标记，避免吞掉用户文本。
            fragment.appendChild(document.createTextNode(raw));
            continue;
          }
          fragment.appendChild(ghostFor(raw, segment.token));
          const figure = buildSticker(segment.token, t);
          figure.setAttribute("data-side", side);
          figures.push(figure);
        }
        parent.replaceChild(fragment, carrier);
        if (figures.length === 0) continue;
        // 统一隐藏容器边缘空白，兼容宿主拆分文本节点。
        trimOuterWhitespace(parent);

        // 图片进入宿主对齐容器；用户侧使用 userStack 的 flex-end 对齐。
        const anchor = stickerAnchor(parent, row);
        for (const figure of figures) {
          anchor.insertBefore(figure, anchor.firstChild);
        }
        placedInThisPass = true;

        // 隐藏只剩标记和空白的容器；卸载恢复原始显示状态。
        let element = parent;
        while (element !== null && element !== row) {
          if (textWithoutGhosts(element).trim() === "") {
            if (!hiddenElements.has(element))
              hiddenElements.set(element, element.style.display);
            element.style.display = "none";
          }
          element = element.parentElement;
        }
      }
    }
    reconcile();
  };

  function restore() {
    for (const figure of document.querySelectorAll("[data-emote-sticker]"))
      figure.remove();
    for (const ghost of document.querySelectorAll("[data-emote-hidden]")) {
      ghost.parentElement?.replaceChild(
        document.createTextNode(ghost.textContent ?? ""),
        ghost,
      );
    }
    for (const [element, display] of hiddenElements)
      element.style.display = display;
    hiddenElements.clear();
    ghosts.clear();
  }
  return { hasWork: () => placedInThisPass, scan, dispose: restore };
}
export { createStickerPainter };
