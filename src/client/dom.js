/**
 * [INPUT]: 宿主消息 DOM 的 CSS module 类名
 * [OUTPUT]: findClassFragment
 * [POS]: 当前 Desktop CSS module 后缀匹配；不接受旧的前后包裹式类名
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
function findClassFragment(root, fragment) {
  for (const node of root.querySelectorAll("div")) {
    if (
      typeof node.className === "string" &&
      node.className.split(/\s+/u).some((name) => name.endsWith("_" + fragment))
    )
      return node;
  }
  return null;
}

export { findClassFragment };
