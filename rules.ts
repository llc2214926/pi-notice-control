export type NoticeType = "info" | "warning" | "error";
export type Rule = {
  id: string;
  enabled: boolean;
  match: { type?: NoticeType; exact?: string; contains?: string };
  action: "hide" | "show";
};
export type Config = { enabled: boolean; rules: Rule[] };

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${label} 含未知字段：${key}`);
  }
  return value as Record<string, unknown>;
}

function enabled(value: unknown): boolean {
  if (value !== undefined && typeof value !== "boolean") throw new Error("enabled 必须是布尔值");
  return value ?? true;
}

export function parseConfig(value: unknown): Config {
  const config = object(value, ["enabled", "rules"], "配置");
  if (!Array.isArray(config.rules)) throw new Error("rules 必须是数组");
  const ids = new Set<string>();
  const rules = config.rules.map((value, index): Rule => {
    const label = `rules[${index}]`;
    const rule = object(value, ["id", "enabled", "match", "action"], label);
    if (typeof rule.id !== "string" || !rule.id.trim() || rule.id.length > 64 || ids.has(rule.id)) {
      throw new Error(`${label}.id 必须唯一且为 1–64 字符的非空文字`);
    }
    ids.add(rule.id);
    if (rule.action !== "hide" && rule.action !== "show") throw new Error(`${label}.action 必须是 hide 或 show`);
    const match = object(rule.match, ["type", "exact", "contains"], `${label}.match`);
    if ((match.exact !== undefined) === (match.contains !== undefined)) {
      throw new Error(`${label}.match 必须且只能设置 exact 或 contains 之一`);
    }
    const text = match.exact ?? match.contains;
    if (typeof text !== "string" || !text.trim()) throw new Error(`${label} 的匹配文字不能为空`);
    if (match.type !== undefined && match.type !== "info" && match.type !== "warning" && match.type !== "error") {
      throw new Error(`${label}.match.type 必须是 info、warning 或 error`);
    }
    return {
      id: rule.id,
      enabled: enabled(rule.enabled),
      action: rule.action,
      match: { type: match.type, ...(match.exact !== undefined ? { exact: text } : { contains: text }) },
    };
  });
  return { enabled: enabled(config.enabled), rules };
}

export function findRule(rules: Rule[], message: string, type: NoticeType): Rule | undefined {
  return rules.find((rule) => rule.enabled && (!rule.match.type || rule.match.type === type)
    && (rule.match.exact !== undefined ? message === rule.match.exact : message.includes(rule.match.contains!)));
}
