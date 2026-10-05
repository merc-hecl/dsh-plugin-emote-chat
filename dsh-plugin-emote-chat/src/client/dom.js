/**
 * [INPUT]: 宿主消息 DOM 的 CSS module 类名
 * [OUTPUT]: findClassFragment
 * [POS]: 宿主 DOM 结构适配点；两种 painter 共用类名片段查找
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
function findClassFragment(root, fragment) {
  for (const node of root.querySelectorAll("div")) {
    if (
      typeof node.className === "string" &&
      node.className.toLowerCase().includes(fragment)
    )
      return node;
  }
  return null;
}

export { findClassFragment };
