import { stripVTControlCharacters } from "node:util";
import { AssistantMessageComponent, SkillInvocationMessageComponent, UserMessageComponent, ToolExecutionComponent, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, MouseRegion, Spacer, Text, okhslColor, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TUI } from "@earendil-works/pi-tui";
import type { ToolDisplayConfig } from "./rules.ts";
import { toolDisplayRenderer } from "./tool-display.ts";

type ToolState = { toolName: string; toolCallId?: string; isPartial: boolean; outputPad: number; argsPending: boolean; expanded: boolean; toolDefinition?: ToolRenderers; result?: { isError: boolean } };
type Member = { component: ToolExecutionComponent; state: ToolState };

// shortcut: Pi has no transcript-group API; isolate and validate its 1.5 tool-row fields here.
function toolState(component: ToolExecutionComponent): ToolState | undefined {
  // SAFETY: only host ToolExecutionComponent instances reach here; validate every private field before use.
  const value = component as unknown as ToolState;
  if (typeof value.toolName !== "string" || (value.toolCallId !== undefined && typeof value.toolCallId !== "string")
    || typeof value.isPartial !== "boolean" || !Number.isSafeInteger(value.outputPad) || value.outputPad < 0
    || typeof value.argsPending !== "boolean" || typeof value.expanded !== "boolean"
    || (value.toolDefinition !== undefined && (!value.toolDefinition || typeof value.toolDefinition !== "object"))
    || (value.result !== undefined && typeof value.result?.isError !== "boolean")) return undefined;
  return value;
}

function persistentComponentId(component: Component): string | undefined {
  if (component instanceof ToolExecutionComponent) {
    const id = toolState(component)?.toolCallId;
    return id ? `tool:${id}` : undefined;
  }
  if (component instanceof AssistantMessageComponent || component instanceof UserMessageComponent || isPiCompactionSummary(component)) {
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

type GroupKind = "tools" | "process" | "history";
type AssistantPart = { component: Component; body: boolean; slot: number; outputPad: number; visible?: boolean; thinkingCount?: number };
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
  private rail?: string;

  constructor(component: Component, columns: number, rail?: string) {
    super();
    this.columns = columns;
    this.rail = rail;
    this.addChild(component);
  }

  private padding(width: number): number {
    return Math.min(this.columns, Math.max(0, width - 1));
  }

  render(width: number): string[] {
    const pad = this.padding(width);
    const innerWidth = Math.max(1, width - pad);
    return super.render(innerWidth).map((line) => {
      // Scrollbar anchors can precede Pi's markers; keep OSC133 before both anchors and indentation.
      let prefix = "";
      const content = line.replace(/\x1b\]133;[ABC](?:\x07|\x1b\\)/g, (marker) => { prefix += marker; return ""; });
      const indent = this.rail && pad ? this.rail + " ".repeat(pad - 1) : " ".repeat(pad);
      return prefix + indent + truncateToWidth(content, innerWidth);
    });
  }

  handleMouse(event: TuiMouseEvent) {
    const pad = this.padding(event.width);
    if (event.x < pad || event.x >= event.width) return undefined;
    return super.handleMouse({ ...event, x: event.x - pad, width: Math.max(1, event.width - pad) });
  }
}

// shortcut: Pi exposes no notice-row type; use its 1.5 ThemedText/DynamicBorder classes until a public type is available.
function isPiNotice(component: Component): boolean {
  for (let prototype: object | null = Object.getPrototypeOf(component); prototype; prototype = Object.getPrototypeOf(prototype)) {
    const name = prototype.constructor?.name;
    if (name === "ThemedText" || name === "DynamicBorder") return true;
  }
  return false;
}

function isPiCompactionSummary(component: Component): boolean {
  for (let prototype: object | null = Object.getPrototypeOf(component); prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (prototype.constructor?.name === "CompactionSummaryMessageComponent") return true;
  }
  return false;
}

// shortcut: pi-visible-scrollbar has no transcript projection API; unwrap only its validated archive/chunk containers.
function isArchivedTranscript(component: Component): component is Container & { readonly isPending: boolean } {
  return component instanceof Container && component.constructor.name === "ArchivedHistory"
    && typeof (component as Container & { isPending?: unknown }).isPending === "boolean"
    && component.children.every((child) => child instanceof Container && child.constructor.name === "ArchivedChunk");
}

function isUserBoundary(component: Component): boolean {
  if (component instanceof UserMessageComponent || component instanceof SkillInvocationMessageComponent) return true;
  if (component.constructor !== Container) return false;
  const children = (component as Container).children;
  return children.some((child) => !(child instanceof Spacer))
    && children.every((child) => child instanceof Spacer || child instanceof UserMessageComponent || child instanceof SkillInvocationMessageComponent);
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
    return [{ component: source, body: bodyCount > 0, slot: bodyCount - 1, outputPad, visible, thinkingCount: content.children.filter((child) => child instanceof MouseRegion).length }];
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
        rendered[rendered.length - 1] = zoneEnd + rendered[rendered.length - 1];
      }
      return rendered;
    };
    const thinkingCount = children.filter((child) => child instanceof MouseRegion).length;
    parts.push({ component: part, body, slot: body ? slot++ : -1, outputPad, visible: children.some((child) => !(child instanceof Spacer)), thinkingCount });
    children = [];
  }
  if (children.length) {
    parts.push({
      component: Object.assign(new Container(), { children }), body: false, slot: -1, outputPad,
      visible: children.some((child) => !(child instanceof Spacer)),
      thinkingCount: children.filter((child) => child instanceof MouseRegion).length,
    });
  }
  return parts;
}

class FoldGroup extends Container {
  members: Member[] = [];
  content: Component[] = [];
  outputPad = 1;
  expanded: boolean;
  thinkingCount = 0;
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
          + this.ui.theme.fg("muted", ` · /${this.kind === "process" ? "task-process" : this.kind === "history" ? "earlier-history" : "tool-groups"}`), Math.max(0, width - pad));
        if (this.kind === "tools") return [line];
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
    const kind = this.kind === "process" ? "task process" : this.kind === "history" ? "earlier history" : category(this.members[0].state.toolName);
    const details: string[] = [];
    if (failed) details.push(`failed ${failed}`);
    if (pending) details.push(`running ${pending}`);
    if (this.kind !== "tools") {
      details.push(...[...names].map(([name, count]) => `${name} × ${count}`));
      if (this.thinkingCount) details.push(`thinking × ${this.thinkingCount}`);
    } else if (kind === "tool calls") details.push(...[...names].map(([name, count]) => `${name} × ${count}`));
    const count = this.kind === "tools" ? ` × ${this.members.length}` : "";
    return stripVTControlCharacters(`${this.expanded ? "▼" : "▶"} ${kind}${count}${details.length ? ` · ${details.join(", ")}` : ""}`)
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
        const columns = this.kind !== "tools" && component instanceof ToolExecutionComponent ? 4 : 2;
        this.children.push(new Indent(component, columns, this.kind === "history" ? this.ui.theme.fg("accent", "│") : undefined));
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
  let byHistory = new WeakMap<Component, FoldGroup>();
  // Apply defaults once per compaction entry; later renders must not undo manual nested toggles.
  const historyDefaultsApplied = new WeakSet<Component>();
  let groups: FoldGroup[] = [];
  let processes: FoldGroup[] = [];
  let histories: FoldGroup[] = [];
  let globalExpanded = ui.getToolsExpanded();
  let defaultExpanded = globalExpanded;
  let defaultProcessExpanded = globalExpanded;
  let defaultHistoryExpanded = globalExpanded;
  let disposed = false;
  const enabled = () => !disposed && getConfig()?.enabled && (getConfig()?.collapseConsecutive || getConfig()?.collapseTaskProcess);
  type ArchiveView = {
    children: Component[];
    tools: Map<ToolExecutionComponent, { state: ToolState; original: ToolRenderers; wrapped: ToolRenderers }>;
  };
  const archives = new Map<Container, ArchiveView>();
  const releaseArchive = (archive: Container, view: ArchiveView) => {
    for (const [component, { state, original, wrapped }] of view.tools) {
      if (state.toolDefinition !== wrapped) continue;
      state.toolDefinition = original;
      component.setExpanded(state.expanded);
    }
    archive.invalidate();
    archives.delete(archive);
  };
  const transcript = (width: number, expanded?: boolean) => {
    const children: Component[] = [];
    const captions = new Set<Component>();
    const present = new Set<Container>();
    for (const child of chat.children) {
      if (!isArchivedTranscript(child)) { children.push(child); continue; }
      present.add(child);
      let view = archives.get(child);
      if (!view) { view = { children: [], tools: new Map() }; archives.set(child, view); }
      // Keep the archive's own construction/layout lifecycle before projecting its native rows.
      child.render(width);
      const nested = child.children.flatMap((chunk) => (chunk as Container).children);
      let changed = false;
      for (const component of nested) {
        if (!(component instanceof ToolExecutionComponent)) continue;
        const state = toolState(component);
        if (!state || state.toolName === "todo") continue;
        if (!view.tools.has(component) && state.toolDefinition) {
          const original = state.toolDefinition;
          const wrapped = toolDisplayRenderer(state.toolName, original, getConfig);
          if (!wrapped || !Object.getOwnPropertyDescriptor(component, "toolDefinition")?.writable) continue;
          view.tools.set(component, { state, original, wrapped });
          state.toolDefinition = wrapped;
          component.setExpanded(false);
          changed = true;
        }
        if (expanded !== undefined && state.expanded !== expanded) { component.setExpanded(expanded); changed = true; }
      }
      if (changed) child.render(width);
      if (!child.isPending) view.children = nested;
      for (const component of view.children) children.push(component);
      const first = view.children[0], last = view.children.at(-1);
      if (first instanceof Text) captions.add(first);
      if (last instanceof Text) captions.add(last);
    }
    for (const [archive, view] of archives) if (!present.has(archive)) releaseArchive(archive, view);
    return { children, captions };
  };

  const render = (width: number): ReturnType<Container["render"]> => {
    if (disposed) return originalRender.call(chat, width);
    const expanded = ui.getToolsExpanded();
    const expansionChanged = expanded !== globalExpanded;
    if (expansionChanged) {
      globalExpanded = expanded;
      defaultExpanded = defaultProcessExpanded = defaultHistoryExpanded = expanded;
      expandedById.clear();
      byFirst = new WeakMap();
      byBoundary = new WeakMap();
      byHistory = new WeakMap();
    }
    groups = [];
    processes = [];
    histories = [];
    projection.clear();
    const config = getConfig();
    const historyContent = new Container();
    const compactionSummary = chat.children.find(isPiCompactionSummary);
    let inEarlierHistory = Boolean(config?.collapseTaskProcess && compactionSummary);
    let destination = inEarlierHistory ? historyContent : projection;
    const append = (component: Component) => destination.addChild(component);
    const historyMembers: Member[] = [];
    const historyGroups: FoldGroup[] = [];
    let historyThinkingCount = 0;
    if (!config?.enabled) return originalRender.call(chat, width);
    const { children, captions } = transcript(width, expansionChanged ? expanded : undefined);
    if (!enabled()) return originalRender.call(chat, width);
    let run: Member[] = [];
    let boundary: Component | undefined;
    let boundarySlot = 0;
    let process: Component[] = [];
    let processMembers: Member[] = [];
    let processThinkingCount = 0;
    let processVisible = false;
    let processPad = 1;
    const add = (component: Component, members: Member[] = [], pad = 1, visibleHint?: boolean) => {
      if (!config.collapseTaskProcess || !boundary) {
        append(inEarlierHistory ? component : new Indent(component, component instanceof ToolExecutionComponent ? 4 : 2));
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
          const completeMemberIds = memberIds.length && memberIds.every((memberId) => memberId && memberId.length > 0)
            ? memberIds
            : undefined;
          const id = persistentComponentId(boundary);
          // Boundary identity survives later tool calls; warning-only boundaries fall back to the first tool ID.
          const firstMemberId = memberIds.find((memberId) => memberId && memberId.length > 0);
          const stateKey = id
            ? JSON.stringify(["process", id, boundarySlot])
            : firstMemberId && JSON.stringify(["process-tools", firstMemberId]);
          const previousKey = completeMemberIds && JSON.stringify(["process-tools", ...completeMemberIds]);
          let expanded = defaultProcessExpanded;
          const saved = stateKey ? expandedById.get(stateKey) : undefined;
          if (saved !== undefined) expanded = saved;
          else if (previousKey) expanded = expandedById.get(previousKey) ?? expanded;
          group = new FoldGroup("process", expanded, ui, tui,
            stateKey ? (expanded) => expandedById.set(stateKey, expanded) : undefined);
          slots.set(boundarySlot, group);
        }
        group.content = process;
        group.members = processMembers;
        group.thinkingCount = processThinkingCount;
        group.outputPad = processPad;
        processes.push(group);
        if (inEarlierHistory) historyGroups.push(group);
        append(group);
      } else {
        for (const component of process) append(component);
      }
      for (const component of trailing.reverse()) append(component);
      process = [];
      processMembers = [];
      processThinkingCount = 0;
      processVisible = false;
    };
    const flush = () => {
      if (inEarlierHistory) historyMembers.push(...run);
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
        if (inEarlierHistory) historyGroups.push(group);
        add(group, run, group.outputPad);
      } else {
        for (const member of run) add(member.component, [member], member.state.outputPad);
      }
      run = [];
    };
    for (const child of children) {
      if (captions.has(child)) {
        flush();
        flushProcess();
        append(child);
        boundary = undefined;
        boundarySlot = 0;
        continue;
      }
      if (child instanceof ToolExecutionComponent) {
        const state = toolState(child);
        if (state) {
          // Hidden rows still apply streamed argument updates and renderer lifecycle work.
          if (state.argsPending) child.render(width);
          if (state.toolName === "todo") {
            flush();
            flushProcess();
            if (inEarlierHistory) historyMembers.push({ component: child, state });
            append(child);
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
            append(part.component);
            boundary = child;
            boundarySlot = part.slot;
          } else {
            add(part.component, [], part.outputPad, part.visible);
            if (inEarlierHistory) historyThinkingCount += part.thinkingCount ?? 0;
            if (config.collapseTaskProcess && boundary) processThinkingCount += part.thinkingCount ?? 0;
          }
        }
        continue;
      }
      if (isPiCompactionSummary(child)) {
        flush();
        flushProcess();
        if (inEarlierHistory) {
          const hasHistory = historyContent.children.some((component) => !(component instanceof Spacer)
            && component.render(width).some((line) => stripVTControlCharacters(line).trim()));
          destination = projection;
          if (hasHistory) {
            let group = byHistory.get(child);
            if (!group) {
              if (!historyDefaultsApplied.has(child)) {
                for (const { component, state } of historyMembers) if (state.expanded) component.setExpanded(false);
                for (const group of historyGroups) group.setExpanded(false);
                historyDefaultsApplied.add(child);
              }
              const id = persistentComponentId(child);
              const stateKey = id && JSON.stringify(["history", id]);
              group = new FoldGroup("history", stateKey ? (expandedById.get(stateKey) ?? defaultHistoryExpanded) : defaultHistoryExpanded,
                ui, tui, stateKey ? (expanded) => expandedById.set(stateKey, expanded) : undefined);
              byHistory.set(child, group);
            }
            group.content = historyContent.children;
            group.members = historyMembers;
            group.thinkingCount = historyThinkingCount;
            histories.push(group);
            append(group);
            append(new Spacer(1));
          } else {
            for (const component of historyContent.children) append(component);
          }
        }
        append(child);
        inEarlierHistory = false;
        boundary = child;
        boundarySlot = 0;
        continue;
      }
      flush();
      if (isUserBoundary(child) || isPiNotice(child)) {
        flushProcess();
        append(child);
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
    list(kind: GroupKind = "tools") { chat.render(tui.terminal.columns); return [...(kind === "process" ? processes : kind === "history" ? histories : groups)]; },
    setExpanded(expanded: boolean, kind: GroupKind = "tools") {
      if (kind === "process") defaultProcessExpanded = expanded;
      else if (kind === "history") defaultHistoryExpanded = expanded;
      else defaultExpanded = expanded;
      for (const group of kind === "process" ? processes : kind === "history" ? histories : groups) group.setExpanded(expanded);
      tui.requestRender();
    },
    collapseAll() {
      ui.setToolsExpanded(false);
      globalExpanded = false;
      defaultExpanded = defaultProcessExpanded = defaultHistoryExpanded = false;
      expandedById.clear();
      byFirst = new WeakMap();
      byBoundary = new WeakMap();
      byHistory = new WeakMap();
      for (const child of transcript(tui.terminal.columns).children) {
        if (child instanceof ToolExecutionComponent) child.setExpanded(false);
      }
      chat.render(tui.terminal.columns);
      for (const group of [...groups, ...processes, ...histories]) group.setExpanded(false);
      tui.requestRender();
    },
    refresh() { chat.invalidate(); tui.requestRender(); },
    dispose() {
      disposed = true;
      byFirst = new WeakMap();
      byBoundary = new WeakMap();
      byHistory = new WeakMap();
      if (chat.render === render) chat.render = originalRender;
      if (chat.handleMouse === mouse) chat.handleMouse = originalMouse;
      for (const [archive, view] of archives) releaseArchive(archive, view);
      projection.clear();
      groups = [];
      processes = [];
      histories = [];
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
    ["earlier-history", "history", "collapseTaskProcess", "earlier history"],
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
          ctx.ui.notify(kind === "tools" ? "暂无连续工具组（至少两条同类别调用）。" : kind === "process" ? "暂无 task process。" : "暂无 earlier history。", "info");
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
