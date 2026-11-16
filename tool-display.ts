import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, Text, TruncatedText, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { ToolDisplayConfig } from "./rules.ts";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type BaseComponents = { call?: Component; result?: Component };

function plainText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content.filter((block) => block.type === "text").map((block) => plainText(block.text)).join("\n");
}

function compactCall(toolName: string, value: unknown, theme: Theme): Component {
  const args = (value ?? {}) as Record<string, unknown>;
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? plainText(args.command) : "";
    const lines = command.split("\n");
    const suffix = lines.length > 1 ? theme.fg("muted", ` … (+${lines.length - 1} lines)`) : "";
    return new TruncatedText(theme.fg("toolTitle", theme.bold(`$ ${lines[0].trimEnd() || "..."}`)) + suffix, 0, 0);
  }
  const path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "";
  return new TruncatedText(`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("accent", plainText(path).replace(/\n/g, " "))}`, 0, 0);
}

// Count wrapped terminal rows, including the hint and the optional pinned exit status.
function limitLines(component: Component, maxLines: number, keepEnd: boolean, theme: Theme, context: RenderContext, status?: string): Component {
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
      const footer = status ? [truncateToWidth(theme.fg("error", statusText), width)] : [];
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

export function registerToolDisplay(pi: ExtensionAPI, getConfig: () => ToolDisplayConfig | undefined): void {
  pi.registerToolRenderer((toolName, next) => {
    const base = next();
    if (!base) return undefined;
    const compact = toolName === "write" || toolName === "edit" || toolName === "bash";
    const shell = toolName === "bash" || toolName === "powershell";
    const components = new WeakMap<object, BaseComponents>();
    function state(context: RenderContext): BaseComponents {
      let value = components.get(context.state);
      if (!value) components.set(context.state, value = {});
      return value;
    }

    return {
      ...base,
      renderCall: base.renderCall ? (args, theme, context) => {
        const previous = state(context);
        // Even hidden renderers must receive updates: shell renderers maintain execution timers.
        previous.call = base.renderCall!(args, theme, { ...context, lastComponent: previous.call });
        if (getConfig()?.enabled && !context.expanded && compact) return compactCall(toolName, args ?? {}, theme);
        return previous.call;
      } : undefined,
      get renderResult(): ToolRenderers["renderResult"] {
        if (!getConfig()?.enabled && !base.renderResult) return undefined;
        return (result, options, theme, context) => {
          const config = getConfig();
          const folded = config?.enabled && !options.expanded;
          const limitedSuccess = folded && !context.isError && config.maxLines > 0;
          const previous = state(context);
          const fullOptions = limitedSuccess ? { ...options, expanded: true } : options;
          previous.result = base.renderResult?.(result, fullOptions, theme, {
            ...context, expanded: fullOptions.expanded, lastComponent: previous.result,
          });
          const component = previous.result ?? new Text(theme.fg("toolOutput", resultText(result)), 0, 0);
          if (!folded) return component;
          if (context.isError) {
            if (!shell || !config.collapseCommandErrors) return component;
            const lines = resultText(result).trim().split("\n");
            const lastLine = lines[lines.length - 1].trim();
            const status = /^Command exited with code -?\d+$/.test(lastLine) ? lines.pop()!.trim() : undefined;
            return limitLines(new Text(theme.fg("toolOutput", lines.join("\n")), 0, 0), config.errorMaxLines, true, theme, context, status);
          }
          if (config.maxLines === 0) return new Container();
          return limitLines(component, config.maxLines, shell, theme, context);
        };
      },
    };
  });
}
