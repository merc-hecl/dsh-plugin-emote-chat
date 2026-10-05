/**
 * [INPUT]: Node VM/fs 与生成的客户端 bundle
 * [OUTPUT]: loadBundle、DOM 树和文本检查工具
 * [POS]: 测试共享夹具；模拟 ModuleLoader 与 React，不提供业务实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");

/** Load the browser bundle in a VM and return its exports. */
function loadBundle() {
  let registration;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => (registration = def) } },
    document: {
      head: { appendChild() {} },
      body: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
      createTextNode: (value) => makeText(value),
    },
    require: (spec) => {
      if (spec === "react") {
        return {
          createElement: () => null,
          useState: (v) => [v, () => {}],
          useEffect: () => {},
          useRef: () => ({ current: null }),
          useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        };
      }
      if (spec === "@deepseek-ai/dsh-client-ui-primitives") {
        // The bundle uses the shipped Switch / Button / icon primitives. The vm
        // has no DOM to mount them into, so the stub only has to exist and be
        // callable; the real elements are the harness's own components.
        const passthrough = (tag) => (props) => ({ tag, props });
        return {
          Switch: passthrough("button"),
          Button: passthrough("button"),
          Input: passthrough("input"),
          IconCloseOutlineRegular: passthrough("svg"),
          IconPlusOutlineRegular: passthrough("svg"),
        };
      }
      if (spec === "react/jsx-runtime")
        return { jsx: () => null, jsxs: () => null };
      throw new Error(`unexpected require("${spec}")`);
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    NodeFilter: { SHOW_TEXT: 4 },
    console,
  };
  sandbox.AbortController = AbortController;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(bundlePath, "utf8"), sandbox, {
    filename: "lib/client.js",
  });
  return { exports: registration.factory(sandbox.require), sandbox };
}

// ───────────────────────────── a very small DOM ──────────────────────────────

/** Create a stub element. */
function makeElement(tag) {
  const classes = new Set();
  const element = {
    tagName: String(tag).toUpperCase(),
    /** A real element node. Declared so mixed content can be inspected by type. */
    nodeType: 1,
    childNodes: [],
    attributes: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    // `className` and `classList` are two views of one set, like a real element:
    // the painter assigns `className` while the tests (and `dispose`) read
    // `classList`.
    get className() {
      return [...classes].join(" ");
    },
    set className(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/u))
        if (name !== "") classes.add(name);
    },
    style: { setProperty() {} },
    get parentElement() {
      return element.__parent ?? null;
    },
    get isConnected() {
      let node = element;
      while (node) {
        if (node.__document) return true;
        node = node.__parent;
      }
      return false;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    hasAttribute(name) {
      return Object.hasOwn(element.attributes, name);
    },
    getAttribute(name) {
      return Object.hasOwn(element.attributes, name)
        ? element.attributes[name]
        : null;
    },
    appendChild(child) {
      child.__parent = element;
      element.childNodes.push(child);
      return child;
    },
    insertBefore(child, before) {
      // A fragment contributes its children, not itself.
      if (child.nodeType === 11) {
        for (const inner of [...child.childNodes])
          element.insertBefore(inner, before);
        return child;
      }
      // Moving a node detaches it from where it was, exactly like the real DOM.
      // Without this the same node sits in two parents at once, so hoisting an image
      // to the row left a duplicate behind in the bubble.
      if (child.__parent != null && child.__parent !== element) {
        child.__parent.childNodes = child.__parent.childNodes.filter(
          (c) => c !== child,
        );
      }
      child.__parent = element;
      const at = element.childNodes.indexOf(before);
      if (at === -1) element.childNodes.push(child);
      else element.childNodes.splice(at, 0, child);
      return child;
    },
    append(...children) {
      for (const child of children) element.appendChild(child);
      return undefined;
    },
    after(sibling) {
      const parent = element.parentElement;
      if (parent === null) return;
      parent.insertBefore(sibling, element.nextSibling());
    },
    before(sibling) {
      const parent = element.parentElement;
      if (parent === null) return;
      parent.insertBefore(sibling, element);
    },
    nextSibling() {
      const parent = element.parentElement;
      if (parent === null) return null;
      const at = parent.childNodes.indexOf(element);
      return parent.childNodes[at + 1] ?? null;
    },
    remove() {
      const parent = element.parentElement;
      if (parent === null) return;
      parent.childNodes = parent.childNodes.filter(
        (child) => child !== element,
      );
      // Detach completely. Leaving __parent set made a removed node still answer
      // parentElement, which defeated every "is it still attached?" check.
      element.__parent = null;
    },
    replaceChildren(...children) {
      element.childNodes = [];
      for (const child of children) element.appendChild(child);
    },
    replaceChild(next, previous) {
      const at = element.childNodes.indexOf(previous);
      if (at === -1) return previous;
      previous.__parent = null;
      const incoming = next.nodeType === 11 ? [...next.childNodes] : [next];
      for (const inner of incoming) inner.__parent = element;
      element.childNodes.splice(at, 1, ...incoming);
      return previous;
    },
    addEventListener() {},
    set textContent(value) {
      element.childNodes = [];
      if (value !== "") element.appendChild(makeText(value));
    },
    get textContent() {
      return element.childNodes
        .map((child) => child.textContent ?? "")
        .join("");
    },
    get firstChild() {
      return element.childNodes[0] ?? null;
    },
    get firstElementChild() {
      return (
        element.childNodes.find((child) => child.tagName !== undefined) ?? null
      );
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      // Real traversal for the one selector this code looks up: descendants by
      // tag name. Answering everything with an empty list silently disabled
      // findClassFragment, so a host lookup that should have found the bubble
      // always took its fallback branch instead.
      const tag = String(selector).toUpperCase();
      return allElements(element).filter(
        (node) => typeof node.tagName === "string" && node.tagName === tag,
      );
    },
    closest(selector) {
      // The painter's lookups, in the selectors it actually uses. Anything else
      // must miss, like a real DOM with no matching ancestor.
      if (selector === "p") {
        let node = element;
        while (node !== null && node !== undefined) {
          if (node.tagName === "P") return node;
          node = node.__parent ?? null;
        }
        return null;
      }
      const attributeOf = (node) => {
        if (selector === "pre, code")
          return node.tagName === "PRE" || node.tagName === "CODE"
            ? node
            : undefined;
        if (selector === "[data-chat-flow-kind]")
          return node.hasAttribute?.("data-chat-flow-kind") ? node : undefined;
        if (selector === "[data-emote-sticker]")
          return node.hasAttribute?.("data-emote-sticker") ? node : undefined;
        if (selector === "[data-emote-chips]")
          return node.hasAttribute?.("data-emote-chips") ? node : undefined;
        if (selector === 'div[class*="_userStack"]') {
          return typeof node.className === "string" &&
            node.className.includes("_userStack")
            ? node
            : undefined;
        }
        // The non-message region list, plus the tool-card anchor prefix.
        if (selector.includes("data-step-process")) {
          for (const name of [
            "data-step-process",
            "data-step-process-body",
            "data-step-process-content",
          ]) {
            if (node.hasAttribute?.(name)) return node;
          }
          return undefined;
        }
        if (selector.includes("data-chat-anchor-key")) {
          const anchor = node.getAttribute?.("data-chat-anchor-key");
          return typeof anchor === "string" && anchor.startsWith("call:")
            ? node
            : undefined;
        }
        return undefined;
      };
      let node = element;
      while (node !== null) {
        const hit = attributeOf(node);
        if (hit !== undefined) return hit;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      // The stub keeps an explicit child tree; a descendant sweep covers every
      // selector the painters use.
      for (const child of allElements(element)) {
        if (selector === "div") {
          if (child.tagName === "DIV") return child;
          continue;
        }
        if (
          selector === "[data-emote-sticker]" &&
          child.hasAttribute?.("data-emote-sticker")
        )
          return child;
        if (
          selector === "[data-emote-chips]" &&
          child.hasAttribute?.("data-emote-chips")
        )
          return child;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== "div") return [];
      return allElements(element).filter((child) => child.tagName === "DIV");
    },
  };
  element.ownerDocument = null;
  return element;
}

/** Create a stub text node. */
function makeText(value) {
  const node = {
    nodeType: 3,
    /** Text nodes are leaves, but traversal helpers read this uniformly. */
    childNodes: [],
    __parent: null,
    get parentElement() {
      return node.__parent ?? null;
    },
    get textContent() {
      return node.nodeValue;
    },
    nodeValue: value,
  };
  return node;
}

/**
 * Install a document whose `[data-chat-flow-kind]` query returns the given
 * roots, and whose TreeWalker walks each root's text nodes in order.
 */
function chatDocument(roots) {
  for (const root of roots) root.__document = true;
  return {
    querySelectorAll(selector) {
      if (selector === "[data-chat-flow-kind]") return roots;
      if (selector === '[data-chat-flow-kind="user"]') {
        return roots.filter(
          (root) => root.getAttribute("data-chat-flow-kind") === "user",
        );
      }
      if (selector === ".ec-hidden-token") {
        return roots.flatMap((root) => hiddenCarriers(root));
      }
      if (selector === "[data-emote-hidden]")
        return roots.flatMap((root) =>
          allElements(root).filter((node) =>
            node.hasAttribute?.("data-emote-hidden"),
          ),
        );
      if (selector === "[data-emote-sticker]") {
        return roots.flatMap((root) => stickerFigures(root));
      }
      return [];
    },
    createElement: (tag) => makeElement(tag),
    createDocumentFragment() {
      // A fragment is inserted by its children, like the real thing. The painter
      // rebuilds one text node as prose + image + ghost through this.
      const fragment = makeElement("#fragment");
      fragment.nodeType = 11;
      return fragment;
    },

    createTextNode: (value) => makeText(value),
    createTreeWalker(root) {
      const texts = allElements(root).filter((node) => node.nodeType === 3);
      let index = -1;
      return {
        nextNode() {
          index += 1;
          return texts[index] ?? null;
        },
      };
    },
  };
}

/** Every DESCENDANT of one node (the node itself excluded), plus text nodes. */
function allElements(root) {
  const out = [];
  const visit = (node) => {
    for (const child of node.childNodes ?? []) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/**
 * The text a reader sees, with this plugin's hidden ghosts left out.
 *
 * The ghost deliberately keeps the token inside \`textContent\`, so a test that wants
 * to assert "the user does not see the tag" has to exclude it — and a test that wants
 * to assert "textContent is unchanged" must NOT.
 */
function visibleText(element) {
  let out = "";
  for (const child of element.childNodes ?? []) {
    if (child.nodeType === 3) {
      out += child.nodeValue ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.getAttribute?.("data-emote-hidden") !== null) continue;
    out += visibleText(child);
  }
  return out;
}

/** Descendants of one node carrying a sticker figure. */
function stickerFigures(root) {
  return allElements(root).filter((node) =>
    node.hasAttribute?.("data-emote-sticker"),
  );
}

/** Descendants of one node carrying a chip row. */
function chipRows(root) {
  return allElements(root).filter((node) =>
    node.hasAttribute?.("data-emote-chips"),
  );
}

/** Descendants of one node wrapped as a hidden token carrier. */
function hiddenCarriers(root) {
  return allElements(root).filter((node) =>
    node.classList?.contains("ec-hidden-token"),
  );
}

// ─────────────────────────────────── tests ───────────────────────────────────

export {
  loadBundle,
  makeElement,
  makeText,
  chatDocument,
  visibleText,
  stickerFigures,
  chipRows,
  hiddenCarriers,
  allElements,
};
