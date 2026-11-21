import { stripVTControlCharacters } from "node:util";
import { AssistantMessageComponent, ToolExecutionComponent, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, Spacer, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import type { ToolDisplayConfig } from "./rules.ts";

type ToolState = { toolName: string; isPartial: boolean; outputPad: number; argsPending: boolean; result?: { isError: boolean } };
type Member = { component: ToolExecutionComponent; state: ToolState };

// shortcut: Pi has no transcript-group API; isolate and validate its 1.5 tool-row fields here.
function toolState(component: ToolExecutionComponent): ToolState | undefined {
  // SAFETY: only host ToolExecutionComponent instances reach here; validate every private field before use.
  const value = component as unknown as ToolState;
  if (typeof value.toolName !== "string" || typeof value.isPartial !== "boolean"
    || !Number.isSafeInteger(value.outputPad) || value.outputPad < 0 || typeof value.argsPending !== "boolean"
    || (value.result !== undefined && typeof value.result?.isError !== "boolean")) return undefined;
  return value;
}

function category(name: string): string {
  return name === "read" ? "read" : name === "edit" || name === "write" ? "edit/write" : "工具调用";
}

class ToolGroup extends Container {
  members: Member[] = [];
  expanded: boolean;
  private header: MouseRegion;
  private ui: ExtensionUIContext;
  private tui: TUI;

  constructor(expanded: boolean, ui: ExtensionUIContext, tui: TUI) {
    super();
    this.expanded = expanded;
    this.ui = ui;
    this.tui = tui;
    this.header = new MouseRegion({
      render: (width) => {
        const pad = Math.min(this.members[0].state.outputPad, Math.max(0, Math.floor((width - 1) / 2)));
        const failed = this.members.some(({ state }) => state.result?.isError);
        const pending = this.members.some(({ state }) => state.isPartial);
        const color = failed ? "error" : pending ? "warning" : "toolTitle";
        return [" ".repeat(pad) + truncateToWidth(this.ui.theme.fg(color, this.label())
          + this.ui.theme.fg("muted", " · /tool-groups"), Math.max(0, width - pad))];
      },
      invalidate() {},
    }, (event) => {
      if (event.type !== "click" || event.button !== "left") return undefined;
      this.toggle();
      return { handled: true };
    });
  }

  label(): string {
    const names = new Map<string, number>();
    let pending = 0;
    let failed = 0;
    for (const { state } of this.members) {
      names.set(state.toolName, (names.get(state.toolName) ?? 0) + 1);
      if (state.isPartial) pending++;
      if (state.result?.isError) failed++;
    }
    const kind = category(this.members[0].state.toolName);
    const status = `${failed ? ` · 失败 ${failed}` : ""}${pending ? ` · 运行中 ${pending}` : ""}`;
    const tools = kind === "工具调用" ? `（${[...names].map(([name, count]) => `${name} × ${count}`).join("、")}）` : "";
    return stripVTControlCharacters(`${this.expanded ? "▼" : "▶"} ${kind} × ${this.members.length}${status}${tools}`)
      .replace(/\p{Cc}/gu, " ");
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    this.children = [new Spacer(1), this.header];
    // Errors stay visible even when successful siblings are grouped away.
    for (const { component, state } of this.members) {
      if (this.expanded || state.result?.isError) this.children.push(component);
    }
    return super.render(width);
  }
}

export function attachToolGroups(chat: Container, ui: ExtensionUIContext, tui: TUI, getConfig: () => ToolDisplayConfig | undefined) {
  const originalRender = chat.render;
  const originalMouse = chat.handleMouse;
  const projection = new Container();
  let byFirst = new WeakMap<ToolExecutionComponent, ToolGroup>();
  let groups: ToolGroup[] = [];
  let globalExpanded = ui.getToolsExpanded();
  let defaultExpanded = globalExpanded;
  let disposed = false;
  const enabled = () => !disposed && getConfig()?.enabled && getConfig()?.collapseConsecutive;

  const render = (width: number): string[] => {
    if (disposed) return originalRender.call(chat, width);
    const expanded = ui.getToolsExpanded();
    if (expanded !== globalExpanded) {
      globalExpanded = expanded;
      defaultExpanded = expanded;
      byFirst = new WeakMap();
    }
    groups = [];
    projection.clear();
    if (!enabled()) return originalRender.call(chat, width);
    let run: Member[] = [];
    const flush = () => {
      if (run.length === 1) projection.addChild(run[0].component);
      if (run.length > 1) {
        const first = run[0].component;
        let group = byFirst.get(first);
        if (!group) byFirst.set(first, group = new ToolGroup(defaultExpanded, ui, tui));
        group.members = run;
        groups.push(group);
        projection.addChild(group);
      }
      run = [];
    };
    for (const child of chat.children) {
      if (child instanceof ToolExecutionComponent) {
        const state = toolState(child);
        if (state) {
          // Hidden rows still apply streamed argument updates and renderer lifecycle work.
          if (state.argsPending) child.render(width);
          if (run.length && category(run[0].state.toolName) !== category(state.toolName)) flush();
          run.push({ component: child, state });
          continue;
        }
      }
      // Tool-only assistant messages render nothing; visible text/thinking is a boundary.
      if (child instanceof AssistantMessageComponent && child.render(width).length === 0) continue;
      flush();
      projection.addChild(child);
    }
    flush();
    return projection.render(width);
  };
  const mouse: Container["handleMouse"] = (event) => enabled() ? projection.handleMouse(event) : originalMouse.call(chat, event);
  chat.render = render;
  chat.handleMouse = mouse;

  return {
    list() { chat.render(tui.terminal.columns); return [...groups]; },
    setExpanded(expanded: boolean) {
      defaultExpanded = expanded;
      for (const group of groups) group.expanded = expanded;
      tui.requestRender();
    },
    refresh() { chat.invalidate(); tui.requestRender(); },
    dispose() {
      disposed = true;
      byFirst = new WeakMap();
      if (chat.render === render) chat.render = originalRender;
      if (chat.handleMouse === mouse) chat.handleMouse = originalMouse;
      projection.clear();
      groups = [];
      tui.requestRender();
    },
  };
}

export function registerToolGroups(pi: ExtensionAPI, getConfig: () => ToolDisplayConfig | undefined) {
  let active: ReturnType<typeof attachToolGroups> | undefined;
  let clearWidget: (() => void) | undefined;
  const stop = () => {
    active?.dispose();
    active = undefined;
    clearWidget?.();
    clearWidget = undefined;
  };

  pi.registerCommand("tool-groups", {
    description: "选择连续工具组并切换折叠；expand/collapse 展开或折叠全部组",
    getArgumentCompletions: (prefix) => ["expand", "collapse"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const command = args.trim();
      if (command && command !== "expand" && command !== "collapse") {
        ctx.ui.notify("用法：/tool-groups [expand|collapse]", "info");
        return;
      }
      if (!active || !getConfig()?.enabled || !getConfig()?.collapseConsecutive) {
        ctx.ui.notify("二级折叠未启用，请检查 toolDisplay.enabled 和 toolDisplay.collapseConsecutive。", "info");
        return;
      }
      const current = active;
      const groups = current.list();
      if (!groups.length) {
        ctx.ui.notify("暂无连续工具组（至少两条同类别调用）。", "info");
        return;
      }
      if (command) {
        current.setExpanded(command === "expand");
        return;
      }
      const choices = groups.map((group, index) => `#${index + 1} ${group.label()}`);
      const selected = await ctx.ui.select("连续工具组（选择后展开/折叠）", choices);
      if (active !== current || !selected) return;
      const group = groups[choices.indexOf(selected)];
      if (group && current.list().includes(group)) group.toggle();
    },
  });

  return {
    start(ctx: ExtensionContext) {
      stop();
      if (ctx.mode !== "tui") return;
      ctx.ui.setWidget("notice-control-tool-groups", (tui) => {
        // shortcut: Pi 1.5 mounts [header, resources, chat] as its first document container; replace with a public transcript API when available.
        const document = tui.children[0];
        if (document instanceof Container && document.children.length === 3 && document.children.every((child) => child instanceof Container)) {
          active = attachToolGroups(document.children[2] as Container, ctx.ui, tui, getConfig);
        } else if (getConfig()?.enabled && getConfig()?.collapseConsecutive) {
          ctx.ui.notify("[notice-control] 无法接入当前 Pi 的二级折叠，保留单条工具显示。", "warning");
        }
        return new Container();
      }, { placement: "belowEditor" });
      clearWidget = () => ctx.ui.setWidget("notice-control-tool-groups", undefined);
    },
    stop,
    refresh() { active?.refresh(); },
  };
}
