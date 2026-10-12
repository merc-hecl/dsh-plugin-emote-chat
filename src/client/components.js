/**
 * [INPUT]: React、宿主 UI primitives 与 shared 的配置和素材工具
 * [OUTPUT]: 分组目录与贴纸双栏选择器、SettingsSection 和宿主 Toast 提示
 * [POS]: 当前 Desktop 原语与输入接口；写入后读取有效配置，刷新失败不显示成功
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import * as React from "react";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";
import {
  API,
  TOKEN_OPEN,
  TOKEN_CLOSE,
  STORE_LIMIT,
  PREVIEW_LIMIT,
  mountLog,
  useStore,
  splitLines,
  stickerUrl,
  postJson,
} from "./shared.js";
const h = React.createElement;
function StickerGlyph({ size = 16 }) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
      stroke: "currentColor",
      strokeWidth: 1.3,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    // 贴纸外轮廓为折角留空。
    h("path", {
      d: "M13 8.5V3.5C13 2.67157 12.3284 2 11.5 2H4.5C3.67157 2 3 2.67157 3 3.5V12.5C3 13.3284 3.67157 14 4.5 14H8.5",
    }),
    // 绘制折角。
    h("path", { d: "M13 8.5H9.5C9.22386 8.5 9 8.72386 9 9V14" }),
    h("path", { d: "M13 8.5L9 14" }),
    // 表情符号让入口同时表达 emoji 功能。
    h("path", { d: "M5.9 6.6H5.91" }),
    h("path", { d: "M8.9 6.6H8.91" }),
    h("path", { d: "M5.9 8.9C6.2 9.3 6.6 9.5 7.1 9.5C7.6 9.5 8 9.3 8.3 8.9" }),
  );
}

function Switch({ checked, disabled, onToggle, label }) {
  return h(primitives.Switch, {
    checked,
    disabled: disabled === true,
    label,
    onChange: (next) => onToggle(next),
  });
}

function Item({ title, description, control, children }) {
  const [id] = React.useState(
    () => "ec-item-" + Math.random().toString(36).slice(2, 9),
  );
  return h(
    "div",
    {
      "data-item": "",
      ...(children === undefined ? {} : { "data-stacked": "true" }),
    },
    h(
      "div",
      { className: "ec-head-row" },
      h(
        "div",
        { className: "ec-head" },
        h("div", { className: "ec-title", id }, title),
        h("div", { className: "ec-desc", id: id + "-desc" }, description),
      ),
      control,
    ),
    children === undefined
      ? null
      : h(
          "div",
          {
            className: "ec-drawer",
            role: "group",
            "aria-labelledby": id,
            "aria-describedby": id + "-desc",
          },
          children,
        ),
  );
}

function Button({ children, onClick, disabled, variant }) {
  return h(
    primitives.Button,
    {
      variant: variant ?? "ghost",
      size: "md",
      disabled: disabled === true,
      onClick,
    },
    children,
  );
}

function StickerPicker({ inputActions, t, catalog }) {
  const snapshot = useStore(catalog.store);
  const [open, setOpen] = React.useState(false);
  const [packId, setPackId] = React.useState(null);
  const rootRef = React.useRef(null);
  const gridRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target))
        setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      // 方向键按贴纸顺序移动焦点。
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      const grid = gridRef.current;
      if (grid === null) return;
      const cells = [...grid.querySelectorAll("button")];
      if (cells.length === 0) return;
      const at = cells.indexOf(document.activeElement);
      if (at === -1) return;
      event.preventDefault();
      const step =
        event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const next = (at + step + cells.length) % cells.length;
      cells[next].focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const packs = snapshot.data?.packs ?? [];
  const groups = new Map();
  for (const pack of packs) {
    const [root, ...children] = pack.name.split("/");
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push({ pack, label: children.join("/") || root });
  }
  const active = packs.find((pack) => pack.id === packId) ?? packs[0];
  const stickers = active?.stickers ?? [];

  const insert = (sticker) => {
    const token = TOKEN_OPEN + sticker.id + TOKEN_CLOSE;
    try {
      const span = inputActions.captureInsertion();
      inputActions.insertText(token, span);
    } catch {
      /* the composer refuses edits while it is submitting; nothing to do */
    }
    setOpen(false);
  };

  return h(
    "div",
    { className: "ec-picker-root", ref: rootRef },
    h(
      "button",
      {
        type: "button",
        className: "ec-trigger",
        "aria-label": t("picker.open"),
        title: t("picker.open"),
        "aria-expanded": open ? "true" : "false",
        onClick: () => {
          setOpen((value) => !value);
          if (!open) void catalog.load();
        },
      },
      h(StickerGlyph, null),
    ),
    open
      ? h(
          "div",
          {
            className: "ec-popover",
            role: "dialog",
            "aria-label": t("picker.title"),
          },
          h(
            "div",
            { className: "ec-popover-head" },
            h("span", { className: "ec-popover-title" }, t("picker.title")),
            h(
              "button",
              {
                type: "button",
                className: "ec-close",
                "aria-label": t("picker.close"),
                title: t("picker.close"),
                onClick: () => setOpen(false),
              },
              h(primitives.IconCloseOutlineRegular, { size: 14 }),
            ),
          ),
          snapshot.status === "loading" && snapshot.data === undefined
            ? h("div", { className: "ec-note" }, t("picker.loading"))
            : snapshot.status === "error"
              ? h(
                  "div",
                  { className: "ec-note" },
                  t("picker.failed", { message: snapshot.error ?? "" }),
                )
              : packs.length === 0
                ? h("div", { className: "ec-note" }, t("picker.empty"))
                : h(
                    "div",
                    { className: "ec-picker-body" },
                    h(
                      "nav",
                      { className: "ec-packs", "aria-label": t("picker.packs") },
                      ...[...groups].map(([root, children]) =>
                        h(
                          "div",
                          { className: "ec-pack-group", key: root },
                          h("div", { className: "ec-pack-root", title: root }, root),
                          ...children.map(({ pack, label }) =>
                            h(
                              "button",
                              {
                                key: pack.id,
                                type: "button",
                                className: "ec-pack",
                                title: pack.name,
                                "aria-label": pack.name,
                                "aria-pressed": active?.id === pack.id ? "true" : "false",
                                onClick: () => {
                                  setPackId(pack.id);
                                  if (gridRef.current !== null) gridRef.current.scrollTop = 0;
                                },
                              },
                              label,
                            ),
                          ),
                        ),
                      ),
                    ),
                    h(
                      "div",
                      { className: "ec-picker-content" },
                      h("div", { className: "ec-pack-title", title: active.name }, active.name),
                      h(
                        "div",
                        { className: "ec-grid", key: active.id, ref: gridRef },
                        ...stickers.map((sticker) =>
                          h(
                            "button",
                            {
                              key: sticker.id,
                              type: "button",
                              className: "ec-cell",
                              title: sticker.id,
                              "aria-label": t("sticker.alt", {
                                name: sticker.id,
                              }),
                              onClick: () => insert(sticker),
                            },
                            h("img", {
                              src: stickerUrl(sticker.id),
                              alt: "",
                              loading: "lazy",
                            }),
                            h("span", null, sticker.name),
                          ),
                        ),
                      ),
                    ),
                  ),
        )
      : null,
  );
}

function SettingsSection({ t, config, context }) {
  const snapshot = useStore(config.store);
  const [linesDraft, setLinesDraft] = React.useState(null);

  const [alert, setAlert] = React.useState(null);

  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savePending = React.useRef(false);
  const [maintenance, setMaintenance] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const toastSequence = React.useRef(0);

  const showSuccess = (text) => {
    toastSequence.current += 1;
    setToast({ id: toastSequence.current, text });
  };

  // 诊断只记录实际挂载，重复渲染不增加计数。
  React.useEffect(() => {
    mountLog.mounts += 1;
    mountLog.events.push({ at: Date.now(), kind: "mount" });
    if (mountLog.events.length > 24) mountLog.events.shift();
    return () => {
      mountLog.unmounts += 1;
      mountLog.events.push({ at: Date.now(), kind: "unmount" });
      if (mountLog.events.length > 24) mountLog.events.shift();
    };
  }, []);

  React.useEffect(() => {
    void config.load();
  }, [config]);

  const data = snapshot.data;
  const settings = {
    stickerReply: data?.stickerReply === true,
    emojiReply: data?.emojiReply === true,
    emojiRain: data?.emojiRain === true,
  };
  const saved = Array.isArray(data?.paths) ? data.paths : [];
  // 空路径列表显示一个输入行；保存时过滤空行。
  const lines = linesDraft ?? (saved.length === 0 ? [""] : saved);

  const commit = async (next, successKey = "section.saved") => {
    if (savePending.current) return false;
    savePending.current = true;
    setSaving(true);
    try {
      setToast(null);
      const result = await context.update({
        stickerReply: next.stickerReply,
        paths: splitLines((next.lines ?? []).join("\n")),
        emojiReply: next.emojiReply,
        emojiRain: next.emojiReply ? next.emojiRain : false,
      });
      if (!result.ok) {
        // 写入失败显式报错；成功后从宿主重新读取有效配置。
        setAlert(t("section.saveFailed", { message: result.message ?? "" }));
        return false;
      }
      setAlert(null);
      const refreshed = await config.load({ fresh: true });
      if (refreshed === undefined) return false;
      setLinesDraft(null);
      showSuccess(t(successKey));
      return true;
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  const clearAll = async () => {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      await postJson(API + "/clean", {});
      setMaintenance(null);
      showSuccess(t("section.store.cleared"));
    } catch (error) {
      setMaintenance({
        tone: "error",
        text: t("section.store.clearFailed", {
          message: String(error?.message ?? error),
        }),
      });
    } finally {
      setBusy(false);
    }
  };

  const packs = data?.packs ?? [];
  const errors = data?.errors ?? [];
  const stickerCount = packs.reduce(
    (total, pack) => total + (pack.stickers?.length ?? 0),
    0,
  );
  const broken = new Set(errors.map((entry) => entry.path));
  const scanNote =
    packs.length === 0
      ? t("section.scanEmpty")
      : t("section.scanned", { packs: packs.length, stickers: stickerCount });

  if (data === undefined && snapshot.status !== "error") {
    return h(
      "div",
      { className: "ec-page" },
      h("p", { className: "ec-note-line" }, t("section.loading")),
    );
  }

  const pathLine = (value, index) =>
    h(
      "div",
      { className: "ec-path-row", key: "path-" + String(index) },
      h("input", {
        type: "text",
        spellCheck: false,
        value,
        disabled: saving,
        "data-missing": broken.has(value) ? "true" : undefined,
        placeholder: t("section.paths.placeholder"),
        "aria-label": t("section.paths.label"),
        "aria-invalid": broken.has(value) ? "true" : undefined,
        onChange: (event) => {
          const next = [...lines];
          next[index] = event.target.value;
          setLinesDraft(next);
        },
      }),
      h(
        "button",
        {
          type: "button",
          className: "ec-remove",
          disabled: saving || lines.length <= 1,
          "aria-label": t("section.paths.remove"),
          title: t("section.paths.remove"),
          onClick: () => setLinesDraft(lines.filter((_, at) => at !== index)),
        },
        h(primitives.IconCloseOutlineRegular, { size: 14 }),
      ),
    );

  const preview = packs
    .flatMap((pack) => pack.stickers ?? [])
    .slice(0, PREVIEW_LIMIT);

  const drawer = h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "ec-desc", style: { marginTop: "2px" } },
      t("section.paths.hint"),
    ),
    h("div", { className: "ec-lines" }, ...lines.map(pathLine)),
    h(
      "div",
      { className: "ec-path-row" },
      h(
        Button,
        { onClick: () => setLinesDraft([...lines, ""]), disabled: saving },
        t("section.paths.add"),
      ),
    ),
    packs.length > 0
      ? h(
          "div",
          { className: "ec-preview" },
          ...preview.map((sticker) =>
            h(
              "span",
              { className: "ec-tile", key: sticker.id, title: sticker.id },
              h("img", {
                src: stickerUrl(sticker.id),
                alt: sticker.id,
                loading: "lazy",
              }),
            ),
          ),
          stickerCount > preview.length
            ? h(
                "span",
                { className: "ec-tile", "data-more": "" },
                "+" + String(stickerCount - preview.length),
              )
            : null,
        )
      : null,
    h(
      "div",
      { className: "ec-foot" },
      h(
        "p",
        {
          className: "ec-note-line",
          "data-tone": errors.length > 0 ? "error" : undefined,
          role: errors.length > 0 ? "alert" : undefined,
        },
        errors.length > 0
          ? t("section.scanError", {
              paths: errors.map((entry) => entry.path).join(", "),
            })
          : scanNote,
      ),
      h(
        "div",
        { className: "ec-actions" },
        h(
          Button,
          // 重写当前值使 Host 索引失效，再读取扫描结果。
          {
            disabled: saving,
            onClick: () =>
              void commit({ ...settings, lines }, "section.scanCompleted"),
          },
          t("section.scan"),
        ),
        h(
          Button,
          {
            variant: "primary",
            disabled: saving,
            onClick: () => void commit({ ...settings, lines }),
          },
          t("section.save"),
        ),
      ),
    ),
  );

  return h(
    "div",
    { className: "ec-page", "data-emote-settings": "" },
    toast === null
      ? null
      : h(primitives.Toast, {
          key: toast.id,
          text: toast.text,
          tone: "success",
          onDone: () =>
            setToast((current) => (current?.id === toast.id ? null : current)),
        }),
    snapshot.status === "error"
      ? h(
          "p",
          { className: "ec-note-line", "data-tone": "error", role: "alert" },
          t("section.loadFailed", { message: snapshot.error ?? "" }),
        )
      : null,
    alert === null
      ? null
      : h(
          "p",
          { className: "ec-note-line", "data-tone": "error", role: "alert" },
          alert,
        ),
    h(
      Item,
      {
        title: t("section.stickerReply.label"),
        description: t("section.stickerReply.hint"),
        control: h(Switch, {
          label: t("section.stickerReply.label"),
          checked: settings.stickerReply,
          disabled: saving,
          onToggle: (value) =>
            void commit({ ...settings, stickerReply: value, lines }),
        }),
      },
      settings.stickerReply ? drawer : null,
    ),
    h(
      Item,
      {
        title: t("section.emojiReply.label"),
        description: t("section.emojiReply.hint"),
        control: h(Switch, {
          label: t("section.emojiReply.label"),
          checked: settings.emojiReply,
          disabled: saving,
          onToggle: (value) =>
            void commit({
              ...settings,
              lines,
              emojiReply: value,
              emojiRain: value ? settings.emojiRain : false,
            }),
        }),
      },
      settings.emojiReply
        ? h(Item, {
            title: t("section.emojiRain.label"),
            description: t("section.emojiRain.hint"),
            control: h(Switch, {
              label: t("section.emojiRain.label"),
              checked: settings.emojiRain,
              disabled: saving,
              onToggle: (value) =>
                void commit({ ...settings, lines, emojiRain: value }),
            }),
          })
        : null,
    ),
    // 存储由 Host 有界维护；设置页只提供整体清空。
    h(Item, {
      title: t("section.store.label"),
      description: t("section.store.hint", { limit: STORE_LIMIT }),
      control: h(
        "div",
        { className: "ec-actions" },
        h(
          Button,
          { onClick: () => void clearAll(), disabled: busy },
          busy ? t("section.store.busy") : t("section.store.clear"),
        ),
      ),
    }),
    maintenance === null
      ? null
      : h(
          "p",
          {
            className: "ec-note-line",
            "data-tone": maintenance.tone === "error" ? "error" : undefined,
            role: maintenance.tone === "error" ? "alert" : undefined,
          },
          maintenance.text,
        ),
  );
}

export { StickerPicker, SettingsSection };
