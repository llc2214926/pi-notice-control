import { stripVTControlCharacters } from "node:util";
import { AssistantMessageComponent, SkillInvocationMessageComponent, UserMessageComponent, ToolExecutionComponent, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, MouseRegion, Spacer, Text, okhslColor, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TUI } from "@earendil-works/pi-tui";
import type { ToolDisplayConfig } from "./rules.ts";

type ToolState = { toolName: string; toolCallId?: string; isPartial: boolean; outputPad: number; argsPending: boolean; result?: { isError: boolean } };
type Member = { component: ToolExecutionComponent; state: ToolState };

// shortcut: Pi has no transcript-group API; isolate and validate its 1.5 tool-row fields here.
function toolState(component: ToolExecutionComponent): ToolState | undefined {
  // SAFETY: only host ToolExecutionComponent instances reach here; validate every private field before use.
  const value = component as unknown as ToolState;
  if (typeof value.toolName !== "string" || (value.toolCallId !== undefined && typeof value.toolCallId !== "string")
    || typeof value.isPartial !== "boolean" || !Number.isSafeInteger(value.outputPad) || value.outputPad < 0
    || typeof value.argsPending !== "boolean"
    || (value.result !== undefined && typeof value.result?.isError !== "boolean")) return undefined;
  return value;
}

function persistentComponentId(component: Component): string | undefined {
  if (component instanceof ToolExecutionComponent) {
    const id = toolState(component)?.toolCallId;
    return id ? `tool:${id}` : undefined;
  }
  if (component instanceof AssistantMessageComponent || component instanceof UserMessageComponent) {
    // SAFETY: validated Pi message components carry the session entry ID in this private field.
    const id = (component as unknown as { messageId?: unknown }).messageId;
    return typeof id === "string" && id ? `message:${id}` : undefined;
  }
  return undefined;
}

function category(name: string): string {
  if (name === "read") return "read";
  if (name === "edit" || name === "write") return "edit/write";
  return "tool calls";
}

type GroupKind = "tools" | "process";
type AssistantPart = { component: Component; body: boolean; slot: number; outputPad: number; visible?: boolean };
type FoldState = { sessionId: string; expandedById: Map<string, boolean> };
const FOLD_STATE_KEY = Symbol.for("pi-notice-control.fold-state.v1");
const PROCESS_BACKGROUNDS = { dark: okhslColor(85, 0.65, 0.23), light: okhslColor(85, 0.65, 0.91) };

function foldStateFor(sessionId: string): Map<string, boolean> {
  const shared = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const state = shared[FOLD_STATE_KEY] as FoldState | undefined;
  if (state?.sessionId === sessionId) return state.expandedById;
  const next = { sessionId, expandedById: new Map<string, boolean>() };
  shared[FOLD_STATE_KEY] = next;
  return next.expandedById;
}

class Indent extends Container {
  private columns: number;

  constructor(component: Component, columns: number) {
    super();
    this.columns = columns;
    this.addChild(component);
  }

  private padding(width: number): number {
    return Math.min(this.columns, Math.max(0, width - 1));
  }

  render(width: number): string[] {
    const pad = this.padding(width);
    const innerWidth = Math.max(1, width - pad);
    return super.render(innerWidth).map((line) => " ".repeat(pad) + truncateToWidth(line, innerWidth));
  }

  handleMouse(event: TuiMouseEvent) {
    const pad = this.padding(event.width);
    if (event.x < pad || event.x >= event.width) return undefined;
    return super.handleMouse({ ...event, x: event.x - pad, width: Math.max(1, event.width - pad) });
  }
}

// shortcut: Pi exposes no notice-row type; use its 1.5 class name until a public type is available.
function isPiNotice(component: Component): boolean {
  if (!(component instanceof Text)) return false;
  for (let prototype: object | null = Object.getPrototypeOf(component); prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (prototype.constructor?.name === "ThemedText") return true;
  }
  return false;
}

// Reuse native nodes, including thinking mouse handlers and OSC transcript markers.
function assistantParts(source: AssistantMessageComponent, width: number): AssistantPart[] {
  // SAFETY: source is a host assistant row; validate its native container and padding before projecting.
  const state = source as unknown as { contentContainer: unknown; outputPad: number; hasToolCalls: unknown };
  const fallback = () => source.render(width).length
    ? [{ component: source, body: true, slot: 0, outputPad: 1 }]
    : [];
  const content = state.contentContainer;
  if (!(content instanceof Container) || source.children.length !== 1 || source.children[0] !== content
    || !Number.isSafeInteger(state.outputPad) || state.outputPad < 0
    || typeof state.hasToolCalls !== "boolean"
    || !content.children.every((child) => child instanceof Spacer || child instanceof Markdown || child instanceof MouseRegion || child instanceof Text)) {
    return fallback();
  }
  const outputPad = state.outputPad;
  if (!content.children.length) return [];
  const bodyCount = content.children.filter((child) => child instanceof Markdown).length;
  const visible = content.children.some((child) => !(child instanceof Spacer));
  if (!bodyCount || content.children.every((child) => child instanceof Spacer || child instanceof Markdown)) {
    return [{ component: source, body: bodyCount > 0, slot: bodyCount - 1, outputPad, visible }];
  }
  // Match the host's OSC predicate without rendering all Markdown just to inspect its markers.
  const zoneStart = "\x1b]133;A\x07";
  const zoneEnd = "\x1b]133;B\x07\x1b]133;C\x07";
  const hasZone = !state.hasToolCalls;
  const parts: AssistantPart[] = [];
  let children: Component[] = [];
  let slot = 0;
  for (const child of content.children) {
    children.push(child);
    if (child instanceof Spacer) continue;
    const part = new Container();
    part.children = children;
    const render = part.render;
    const body = child instanceof Markdown;
    part.render = (partWidth) => {
      // Render native nodes at the actual indented width to keep wrapping and mouse geometry intact.
      const rendered = [...render.call(part, partWidth)];
      if (hasZone && body && rendered.length) {
        rendered[0] = zoneStart + rendered[0];
        rendered[rendered.length - 1] += zoneEnd;
      }
      return rendered;
    };
    parts.push({ component: part, body, slot: body ? slot++ : -1, outputPad, visible: children.some((child) => !(child instanceof Spacer)) });
    children = [];
  }
  if (children.length) {
    parts.push({
      component: Object.assign(new Container(), { children }), body: false, slot: -1, outputPad,
      visible: children.some((child) => !(child instanceof Spacer)),
    });
  }
  return parts;
}

class FoldGroup extends Container {
  members: Member[] = [];
  content: Component[] = [];
  outputPad = 1;
  expanded: boolean;
  private kind: GroupKind;
  private header: MouseRegion;
  private ui: ExtensionUIContext;
  private tui: TUI;
  private onExpanded?: (expanded: boolean) => void;

  constructor(kind: GroupKind, expanded: boolean, ui: ExtensionUIContext, tui: TUI, onExpanded?: (expanded: boolean) => void) {
    super();
    this.kind = kind;
    this.expanded = expanded;
    this.ui = ui;
    this.tui = tui;
    this.onExpanded = onExpanded;
    this.header = new MouseRegion({
      render: (width) => {
        const pad = Math.min(this.outputPad, Math.max(0, Math.floor((width - 1) / 2)));
        const failed = this.members.some(({ state }) => state.result?.isError);
        const pending = this.members.some(({ state }) => state.isPartial);
        let color: "toolTitle" | "warning" | "error" = "toolTitle";
        if (pending) color = "warning";
        if (failed) color = "error";
        const line = " ".repeat(pad) + truncateToWidth(this.ui.theme.fg(color, this.label())
          + this.ui.theme.fg("muted", ` · /${this.kind === "process" ? "task-process" : "tool-groups"}`), Math.max(0, width - pad));
        if (this.kind !== "process") return [line];
        const bg = this.ui.theme.appearance === "light" ? PROCESS_BACKGROUNDS.light : PROCESS_BACKGROUNDS.dark;
        return [this.ui.theme.style(line + " ".repeat(Math.max(0, width - visibleWidth(line))), { bg })];
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
    const kind = this.kind === "process" ? "task process" : category(this.members[0].state.toolName);
    const status = `${failed ? ` · failed ${failed}` : ""}${pending ? ` · running ${pending}` : ""}`;
    const tools = kind === "tool calls" ? `（${[...names].map(([name, count]) => `${name} × ${count}`).join("、")}）` : "";
    const count = this.kind === "tools" ? ` × ${this.members.length}` : "";
    return stripVTControlCharacters(`${this.expanded ? "▼" : "▶"} ${kind}${count}${status}${tools}`)
      .replace(/\p{Cc}/gu, " ");
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.onExpanded?.(expanded);
  }

  toggle(): void {
    this.setExpanded(!this.expanded);
    this.tui.requestRender();
  }

  render(width: number): ReturnType<Container["render"]> {
    this.children = [new Spacer(1), this.header];
    if (this.expanded) {
      for (const component of this.content) {
        const columns = this.kind === "process" && component instanceof ToolExecutionComponent ? 4 : 2;
        this.children.push(new Indent(component, columns));
      }
    }
    return super.render(width);
  }
}

export function attachToolGroups(
  chat: Container,
  ui: ExtensionUIContext,
  tui: TUI,
  getConfig: () => ToolDisplayConfig | undefined,
  expandedById = new Map<string, boolean>(),
) {
  const originalRender = chat.render;
  const originalMouse = chat.handleMouse;
  const projection = new Container();
  let byFirst = new WeakMap<ToolExecutionComponent, FoldGroup>();
  let byBoundary = new WeakMap<Component, Map<number, FoldGroup>>();
  let groups: FoldGroup[] = [];
  let processes: FoldGroup[] = [];
  let globalExpanded = ui.getToolsExpanded();
  let defaultExpanded = globalExpanded;
  let defaultProcessExpanded = globalExpanded;
  let disposed = false;
  const enabled = () => !disposed && getConfig()?.enabled && (getConfig()?.collapseConsecutive || getConfig()?.collapseTaskProcess);

  const render = (width: number): ReturnType<Container["render"]> => {
    if (disposed) return originalRender.call(chat, width);
    const expanded = ui.getToolsExpanded();
    if (expanded !== globalExpanded) {
      globalExpanded = expanded;
      defaultExpanded = defaultProcessExpanded = expanded;
      expandedById.clear();
      byFirst = new WeakMap();
      byBoundary = new WeakMap();
    }
    groups = [];
    processes = [];
    projection.clear();
    const config = getConfig();
    if (!enabled() || !config) return originalRender.call(chat, width);
    let run: Member[] = [];
    let boundary: Component | undefined;
    let boundarySlot = 0;
    let process: Component[] = [];
    let processMembers: Member[] = [];
    let processVisible = false;
    let processPad = 1;
    const add = (component: Component, members: Member[] = [], pad = 1, visibleHint?: boolean) => {
      if (!config.collapseTaskProcess || !boundary) {
        projection.addChild(new Indent(component, component instanceof ToolExecutionComponent ? 4 : 2));
        return;
      }
      const visible = members.length > 0 || (visibleHint ?? (!(component instanceof Spacer)
        && component.render(width).some((line) => stripVTControlCharacters(line).trim())));
      if (!processVisible && visible) processPad = pad;
      processVisible ||= visible;
      process.push(component);
      for (const member of members) processMembers.push(member);
    };
    const flushProcess = () => {
      const trailing: Component[] = [];
      while (process[process.length - 1] instanceof Spacer) trailing.push(process.pop()!);
      if (processVisible && boundary) {
        let slots = byBoundary.get(boundary);
        if (!slots) {
          slots = new Map();
          byBoundary.set(boundary, slots);
        }
        let group = slots.get(boundarySlot);
        if (!group) {
          const memberIds = processMembers.map(({ state }) => state.toolCallId);
          const id = persistentComponentId(boundary);
          const stateKey = memberIds.length && memberIds.every((id): id is string => typeof id === "string" && id.length > 0)
            ? JSON.stringify(["process-tools", ...memberIds])
            : id && JSON.stringify(["process", id, boundarySlot]);
          group = new FoldGroup("process", stateKey ? (expandedById.get(stateKey) ?? defaultProcessExpanded) : defaultProcessExpanded, ui, tui,
            stateKey ? (expanded) => expandedById.set(stateKey, expanded) : undefined);
          slots.set(boundarySlot, group);
        }
        group.content = process;
        group.members = processMembers;
        group.outputPad = processPad;
        processes.push(group);
        projection.addChild(group);
      } else {
        for (const component of process) projection.addChild(component);
      }
      for (const component of trailing.reverse()) projection.addChild(component);
      process = [];
      processMembers = [];
      processVisible = false;
    };
    const flush = () => {
      if (config.collapseConsecutive && run.length > 1) {
        const first = run[0];
        const stateKey = first.state.toolCallId && JSON.stringify(["tools", first.state.toolCallId]);
        let group = byFirst.get(first.component);
        if (!group) {
          group = new FoldGroup("tools", stateKey ? (expandedById.get(stateKey) ?? defaultExpanded) : defaultExpanded, ui, tui,
            stateKey ? (expanded) => expandedById.set(stateKey, expanded) : undefined);
          byFirst.set(first.component, group);
        }
        group.members = run;
        group.content = run.map(({ component }) => component);
        group.outputPad = run[0].state.outputPad;
        groups.push(group);
        add(group, run, group.outputPad);
      } else {
        for (const member of run) add(member.component, [member], member.state.outputPad);
      }
      run = [];
    };
    for (const child of chat.children) {
      if (child instanceof ToolExecutionComponent) {
        const state = toolState(child);
        if (state) {
          // Hidden rows still apply streamed argument updates and renderer lifecycle work.
          if (state.argsPending) child.render(width);
          if (state.toolName === "todo") {
            flush();
            flushProcess();
            projection.addChild(child);
            boundary = child;
            boundarySlot = 0;
            continue;
          }
          if (run.length && category(run[0].state.toolName) !== category(state.toolName)) flush();
          run.push({ component: child, state });
          continue;
        }
      }
      if (child instanceof AssistantMessageComponent) {
        for (const part of assistantParts(child, width)) {
          flush();
          if (part.body) {
            flushProcess();
            projection.addChild(part.component);
            boundary = child;
            boundarySlot = part.slot;
          } else add(part.component, [], part.outputPad, part.visible);
        }
        continue;
      }
      flush();
      if (child instanceof UserMessageComponent || child instanceof SkillInvocationMessageComponent || isPiNotice(child)) {
        flushProcess();
        projection.addChild(child);
        boundary = child;
        boundarySlot = 0;
      } else add(child);
    }
    flush();
    flushProcess();
    return projection.render(width);
  };
  const mouse: Container["handleMouse"] = (event) => enabled() ? projection.handleMouse(event) : originalMouse.call(chat, event);
  chat.render = render;
  chat.handleMouse = mouse;

  return {
    list(kind: GroupKind = "tools") { chat.render(tui.terminal.columns); return [...(kind === "process" ? processes : groups)]; },
    setExpanded(expanded: boolean, kind: GroupKind = "tools") {
      if (kind === "process") defaultProcessExpanded = expanded;
      else defaultExpanded = expanded;
      for (const group of kind === "process" ? processes : groups) group.setExpanded(expanded);
      tui.requestRender();
    },
    collapseAll() {
      ui.setToolsExpanded(false);
      globalExpanded = false;
      defaultExpanded = defaultProcessExpanded = false;
      expandedById.clear();
      byFirst = new WeakMap();
      byBoundary = new WeakMap();
      for (const child of chat.children) {
        if (child instanceof ToolExecutionComponent) child.setExpanded(false);
      }
      chat.render(tui.terminal.columns);
      for (const group of [...groups, ...processes]) group.setExpanded(false);
      tui.requestRender();
    },
    refresh() { chat.invalidate(); tui.requestRender(); },
    dispose() {
      disposed = true;
      byFirst = new WeakMap();
      byBoundary = new WeakMap();
      if (chat.render === render) chat.render = originalRender;
      if (chat.handleMouse === mouse) chat.handleMouse = originalMouse;
      projection.clear();
      groups = [];
      processes = [];
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

  for (const [name, kind, setting, title] of [
    ["tool-groups", "tools", "collapseConsecutive", "连续工具组"],
    ["task-process", "process", "collapseTaskProcess", "task process"],
  ] as const) {
    pi.registerCommand(name, {
      description: `选择${title}并切换折叠；expand/collapse 展开或折叠全部组`,
      getArgumentCompletions: (prefix) => ["expand", "collapse"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
      handler: async (args, ctx) => {
        if (ctx.mode !== "tui") return;
        const command = args.trim();
        if (command && command !== "expand" && command !== "collapse") {
          ctx.ui.notify(`用法：/${name} [expand|collapse]`, "info");
          return;
        }
        if (!active || !getConfig()?.enabled || !getConfig()?.[setting]) {
          ctx.ui.notify(`${title}折叠未启用，请检查 toolDisplay.enabled 和 toolDisplay.${setting}。`, "info");
          return;
        }
        const current = active;
        const groups = current.list(kind);
        if (!groups.length) {
          ctx.ui.notify(kind === "tools" ? "暂无连续工具组（至少两条同类别调用）。" : "暂无 task process。", "info");
          return;
        }
        if (command) {
          current.setExpanded(command === "expand", kind);
          return;
        }
        const choices = groups.map((group, index) => `#${index + 1} ${group.label()}`);
        const selected = await ctx.ui.select(`${title}（选择后展开/折叠）`, choices);
        if (active !== current || !selected) return;
        const group = groups[choices.indexOf(selected)];
        if (group && current.list(kind).includes(group)) group.toggle();
      },
    });
  }

  pi.registerCommand("fold-all", {
    description: "重新计算聊天分组并折叠所有工具输出",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      if (!active || !getConfig()?.enabled) {
        ctx.ui.notify("工具折叠未启用，请检查 toolDisplay.enabled。", "info");
        return;
      }
      active.collapseAll();
    },
  });

  return {
    start(ctx: ExtensionContext) {
      stop();
      if (ctx.mode !== "tui") return;
      const sessionId = ctx.sessionManager?.getSessionId?.();
      const expandedById = sessionId ? foldStateFor(sessionId) : new Map<string, boolean>();
      ctx.ui.setWidget("notice-control-tool-groups", (tui) => {
        // shortcut: Pi 1.5 mounts [header, resources, chat] as its first document container; replace with a public transcript API when available.
        const document = tui.children[0];
        if (document instanceof Container && document.children.length === 3 && document.children.every((child) => child instanceof Container)) {
          active = attachToolGroups(document.children[2] as Container, ctx.ui, tui, getConfig, expandedById);
        } else if (getConfig()?.enabled && (getConfig()?.collapseConsecutive || getConfig()?.collapseTaskProcess)) {
          ctx.ui.notify("[notice-control] 无法接入当前 Pi 的二/三级折叠，保留单条工具显示。", "warning");
        }
        return new Container();
      }, { placement: "belowEditor" });
      clearWidget = () => ctx.ui.setWidget("notice-control-tool-groups", undefined);
    },
    stop,
    refresh() { active?.refresh(); },
  };
}
