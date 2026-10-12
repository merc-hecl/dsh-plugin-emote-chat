/**
 * [INPUT]: Node VM/fs、可覆盖的 React/宿主原语和生成的客户端 bundle
 * [OUTPUT]: loadBundle、DOM 树和文本检查工具
 * [POS]: 测试共享fixture；模拟 ModuleLoader 与 React，不提供业务实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");

/** Load the browser bundle in a VM and return its exports. */
function loadBundle({ react = {}, primitives = {}, ...overrides } = {}) {
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
          ...react,
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
          Toast: passthrough("div"),
          IconCloseOutlineRegular: passthrough("svg"),
          IconPlusOutlineRegular: passthrough("svg"),
          ...primitives,
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
    ...overrides,
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

/** Match the tag, class and attribute selectors used by the actual painters. */
function matchesSelector(node, selector) {
  if (node.nodeType !== 1) return false;
  return selector.split(",").some((part) => {
    const simple = part.trim();
    if (simple.startsWith(".")) return node.classList.contains(simple.slice(1));
    const match = /^([a-z][\w-]*)?(?:\[([\w-]+)(?:(\*=|\^=|=)["']([^"']*)["'])?\])?$/iu.exec(simple);
    if (!match || (!match[1] && !match[2])) return false;
    const [, tag, attr, operator, expected] = match;
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    if (!attr) return true;
    const value = attr === "class" ? node.className : node.getAttribute(attr);
    if (value === null) return false;
    if (!operator) return attr === "class" || node.hasAttribute(attr);
    if (operator === "*=") return value.includes(expected);
    if (operator === "^=") return value.startsWith(expected);
    return value === expected;
  });
}

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
    querySelector(selector) {
      return element.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return allElements(element).filter((node) => matchesSelector(node, selector));
    },
    closest(selector) {
      let node = element;
      while (node !== null) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
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

// ─────────────────────────────────── tests ───────────────────────────────────

export {
  loadBundle,
  makeElement,
  makeText,
  chatDocument,
  visibleText,
  stickerFigures,
  chipRows,
  allElements,
};
