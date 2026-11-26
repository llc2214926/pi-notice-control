import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, Text, TruncatedText, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { ToolDisplayConfig } from "./rules.ts";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type BaseComponents = { call?: Component; result?: Component };

function plainText(text: string): string {
  return stripVTControlCharacters(text).replace(/\p{Cc}/gu, (char) => char === "\t" || char === "\n" ? char : "");
}

function resultText(result: AgentToolResult<unknown>, warning?: string): string {
  let text = result.content.filter((block) => block.type === "text").map((block) => plainText(block.text)).join("\n");
  const footer = text.lastIndexOf("\n\n[");
  if (warning && footer !== -1 && text.endsWith("]") && text.slice(footer).replace(/\s+/g, " ").includes(warning)) text = text.slice(0, footer).trimEnd();
  return text;
}

export function fullOutputWarning(result: { details?: unknown } | undefined): string | undefined {
  const details = result?.details;
  if (!details || typeof details !== "object" || !("fullOutputError" in details) || typeof details.fullOutputError !== "string") return undefined;
  const error = plainText(details.fullOutputError).replace(/\s+/g, " ").trim();
  return error ? `Could not save the full output: ${error}` : undefined;
}

function isSearchTool(toolName: string): boolean {
  return toolName === "search" || toolName.endsWith("_search") || toolName.startsWith("search_");
}

function compactCall(toolName: string, value: unknown, theme: Theme): Component | undefined {
  const args = (value ?? {}) as Record<string, unknown>;
  if (isSearchTool(toolName)) {
    const queries = Array.isArray(args.queries) ? args.queries.filter((query): query is string => typeof query === "string") : [];
    const query = queries[0] ?? args.query ?? args.pattern;
    if (typeof query !== "string") return undefined;
    const suffix = queries.length > 1 ? theme.fg("muted", ` … (+${queries.length - 1} queries)`) : "";
    return new TruncatedText(`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("accent", plainText(query).replace(/\s+/g, " "))}${suffix}`, 0, 0);
  }
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? plainText(args.command) : "";
    const lines = command.split("\n");
    const suffix = lines.length > 1 ? theme.fg("muted", ` … (+${lines.length - 1} lines)`) : "";
    return new TruncatedText(theme.fg("toolTitle", theme.bold(`$ ${lines[0].trimEnd() || "..."}`)) + suffix, 0, 0);
  }
  const path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "";
  const symbol = typeof args.symbol === "string" ? ` ${args.symbol}` : "";
  return new TruncatedText(`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("accent", plainText(path + symbol).replace(/\s+/g, " "))}`, 0, 0);
}

// Count wrapped terminal rows; save warnings and exit status stay visible even with a smaller budget.
function limitLines(component: Component, maxLines: number, keepEnd: boolean, theme: Theme, context: RenderContext, status?: string, warning?: string): Component {
  return {
    render(width) {
      const rendered = component.render(width);
      let start = 0;
      let end = rendered.length;
      while (start < end && !stripVTControlCharacters(rendered[start]).trim()) start++;
      while (end > start && !stripVTControlCharacters(rendered[end - 1]).trim()) end--;
      const lines = rendered.slice(start, end);
      let statusText = status ?? "";
      if (statusText.length > width) statusText = statusText.replace("Command exited with code ", "exit ");
      if (statusText.length > width) statusText = statusText.replace(/^exit /, "");
      const footer = [
        ...(warning ? [truncateToWidth(theme.fg("warning", warning), width)] : []),
        ...(status ? [truncateToWidth(theme.fg("error", statusText), width)] : []),
      ];
      const available = maxLines - footer.length;
      if (lines.length <= available) return [...lines, ...footer];
      if (available <= 0) return footer;
      if (available === 1) return [keepEnd ? lines[lines.length - 1] : lines[0], ...footer];
      const count = available - 1;
      const hint = truncateToWidth(theme.fg("muted", `… (${lines.length - count} lines hidden; ${context.keyText("app.tools.expand")} to expand)`), width);
      const kept = count === 0 ? [] : keepEnd ? lines.slice(-count) : lines.slice(0, count);
      return keepEnd ? [hint, ...kept, ...footer] : [...kept, hint, ...footer];
    },
    invalidate() { component.invalidate(); },
  };
}

export function toolDisplayRenderer(toolName: string, base: ToolRenderers | undefined, getConfig: () => ToolDisplayConfig | undefined): ToolRenderers | undefined {
  if (!base || toolName === "todo") return base;
  const search = isSearchTool(toolName);
  const compact = toolName === "write" || toolName === "edit" || toolName === "bash" || search;
  const shell = toolName === "bash" || toolName === "powershell";
  const foldErrors = shell || search || toolName === "agent_browser" || toolName.startsWith("agent_browser_")
    || toolName === "fetch" || toolName.startsWith("fetch_") || toolName.endsWith("_fetch") || toolName === "get_search_content";
  const components = new WeakMap<object, BaseComponents>();
  function state(context: RenderContext): BaseComponents {
    let value = components.get(context.state);
    if (!value) components.set(context.state, value = {});
    return value;
  }

  return {
    ...base,
    get renderCall(): ToolRenderers["renderCall"] {
      if (!base.renderCall && !getConfig()?.enabled) return undefined;
      return (args, theme, context) => {
        const previous = state(context);
        // Even hidden renderers must receive updates: shell renderers maintain execution timers.
        previous.call = base.renderCall
          ? base.renderCall(args, theme, { ...context, lastComponent: previous.call })
          : new Text(`${theme.fg("toolTitle", theme.bold(toolName))}\n${theme.fg("muted", JSON.stringify(args ?? {}, null, 2))}`, 0, 0);
        if (getConfig()?.enabled && !context.expanded && !(search && context.isError)) {
          const fallback = compactCall(toolName, args ?? {}, theme) ?? previous.call;
          if (compact || !base.renderCall) return fallback;
          const call = limitLines(previous.call, 1, false, theme, context);
          return {
            render(width) {
              const lines = call.render(width);
              return lines.length ? lines : fallback.render(width);
            },
            invalidate() { call.invalidate(); fallback.invalidate(); },
          };
        }
        return previous.call;
      };
    },
    get renderResult(): ToolRenderers["renderResult"] {
      if (!getConfig()?.enabled && !base.renderResult) return undefined;
      return (result, options, theme, context) => {
        const config = getConfig();
        const folded = config?.enabled && !options.expanded;
        const limitedSuccess = folded && !context.isError && config.maxLines > 0;
        const limitedError = folded && context.isError && foldErrors && config.collapseCommandErrors;
        const previous = state(context);
        const fullOptions = limitedSuccess || (limitedError && !shell) ? { ...options, expanded: true } : options;
        previous.result = base.renderResult?.(result, fullOptions, theme, {
          ...context, expanded: fullOptions.expanded, lastComponent: previous.result,
        });
        const component = previous.result ?? new Text(theme.fg("toolOutput", resultText(result)), 0, 0);
        if (!folded) return component;
        const warning = shell ? fullOutputWarning(result) : undefined;
        if (context.isError) {
          if (!limitedError) return component;
          if (!shell) return limitLines(component, config.errorMaxLines, false, theme, context);
          const lines = resultText(result, warning).trim().split("\n");
          const lastLine = lines[lines.length - 1].trim();
          const status = /^Command exited with code -?\d+$/.test(lastLine) ? lines.pop()!.trim() : undefined;
          return limitLines(new Text(theme.fg("toolOutput", lines.join("\n")), 0, 0), config.errorMaxLines, true, theme, context, status, warning);
        }
        if (warning) return limitLines(new Text(theme.fg("toolOutput", resultText(result, warning)), 0, 0), config.maxLines, true, theme, context, undefined, warning);
        if (config.maxLines === 0) return new Container();
        return limitLines(component, config.maxLines, shell, theme, context);
      };
    },
  };
}

export function registerToolDisplay(pi: ExtensionAPI, getConfig: () => ToolDisplayConfig | undefined): void {
  pi.registerToolRenderer((toolName, next) => toolDisplayRenderer(toolName, next(), getConfig));
}
