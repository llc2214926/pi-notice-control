import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { getAgentDir, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { findRule, parseConfig, type Config, type NoticeType } from "./rules.ts";

type Notice = { id: number; time: string; message: string; type: NoticeType; action: "hide" | "show"; rule?: string };
const HISTORY_LIMIT = 100;
const MESSAGE_LIMIT = 4096;

function displayText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export default function noticeControl(pi: ExtensionAPI): void {
  const configPath = join(getAgentDir(), "notice-control.json");
  let config: Config | undefined;
  let enabled = false;
  let history: Notice[] = [];
  let nextId = 0;
  let restore: (() => void) | undefined;
  let notify: ExtensionUIContext["notify"] | undefined;

  function reloadConfig(): void {
    try {
      config = parseConfig(JSON.parse(readFileSync(configPath, "utf8")));
      enabled = config.enabled && restore !== undefined;
    } catch (error) {
      config = undefined;
      enabled = false;
      notify?.(`[notice-control] 规则加载失败，已停止过滤。${String(error)}`, "warning");
    }
  }

  pi.on("session_start", (_event, ctx) => {
    restore?.();
    restore = undefined;
    notify = undefined;
    config = undefined;
    enabled = false;
    history = [];
    nextId = 0;
    if (!ctx.hasUI) return;
    const ui = ctx.ui;
    const original = ui.notify;
    notify = (message, type) => original.call(ui, message, type);
    let active = true;
    const wrapper: ExtensionUIContext["notify"] = (message, type) => {
      if (!active) return original.call(ui, message, type);
      let hide = false;
      try {
        const level = type ?? "info";
        const rule = enabled && config ? findRule(config.rules, message, level) : undefined;
        history.push({
          id: ++nextId,
          time: new Date().toISOString(),
          message: message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT)}…（已截断）` : message,
          type: level,
          action: rule?.action ?? "show",
          rule: rule?.id,
        });
        if (history.length > HISTORY_LIMIT) history.shift();
        hide = rule?.action === "hide";
      } catch (error) {
        enabled = false;
        notify?.(`[notice-control] 过滤异常，已停止过滤。${String(error)}`, "warning");
      }
      if (!hide) original.call(ui, message, type);
    };
    // shortcut: Pi 1.4 共用可写 ui；官方提供通知中间件后替换此包装。
    try {
      ui.notify = wrapper;
      if (ui.notify !== wrapper) throw new Error("ctx.ui.notify 不可替换");
    } catch (error) {
      active = false;
      enabled = false;
      notify(`[notice-control] 无法安装通知过滤，原通知不受影响。${String(error)}`, "warning");
      return;
    }
    restore = () => {
      active = false;
      // 后装的包装可能仍引用 wrapper；停用它，但不覆盖别人的包装。
      if (ui.notify === wrapper) ui.notify = original;
    };
    reloadConfig();
  });

  pi.on("session_shutdown", () => {
    restore?.();
    restore = undefined;
    notify = undefined;
    history = [];
  });

  pi.registerCommand("notices", {
    description: "查看扩展通知记录；on/off 临时开关；reload 重载规则",
    getArgumentCompletions: (prefix) => ["on", "off", "reload"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (!ctx.hasUI || !notify) return;
      const command = args.trim();
      if (command === "reload") {
        reloadConfig();
        if (config) notify(`[notice-control] 已载入 ${config.rules.length} 条规则，过滤${enabled ? "开启" : "关闭"}。`, "info");
        return;
      }
      if (command === "on" || command === "off") {
        enabled = command === "on" && config !== undefined && restore !== undefined;
        notify(`[notice-control] 过滤${enabled ? "开启" : "关闭"}。${!config ? "请修复配置后运行 /notices reload。" : ""}`, "info");
        return;
      }
      if (command) {
        notify("用法：/notices [on|off|reload]", "info");
        return;
      }
      const records = [...history].reverse();
      if (!records.length) {
        notify(`[notice-control] 暂无通知记录。配置：${configPath}`, "info");
        return;
      }
      const choices = records.map((record) => `#${record.id} ${record.action === "hide" ? "隐藏" : "显示"} [${record.type}] ${displayText(record.message).replace(/\s+/g, " ").slice(0, 100)}`);
      const send = notify;
      const selected = await ctx.ui.select(`通知记录（最近 ${records.length}/${HISTORY_LIMIT} 条；过滤${enabled ? "开启" : "关闭"}）`, choices);
      if (!selected || notify !== send) return;
      const record = records[choices.indexOf(selected)];
      if (!record) return;
      send([
        `通知 #${record.id} · ${record.time}`,
        `等级：${record.type}；处理：${record.action}；规则：${record.rule ?? "无（未命中或过滤关闭）"}`,
        displayText(record.message),
      ].join("\n"), "info");
    },
  });
}
