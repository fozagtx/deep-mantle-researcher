import messages from "@/messages/copy.json";

type MessageValue = string | number | boolean | null | undefined;
type MessageValues = Record<string, MessageValue>;

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function formatMessage(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function translate(
  namespace: string,
  key: string,
  values?: MessageValues
): string {
  const value = readPath(messages, `${namespace}.${key}`);
  if (typeof value !== "string") {
    return key;
  }
  return formatMessage(value, values);
}

export function useTranslations(namespace: string) {
  return (key: string, values?: MessageValues) => translate(namespace, key, values);
}

export function useMessages() {
  return messages;
}

export async function getTranslations({
  namespace,
}: {
  namespace: string;
}) {
  return (key: string, values?: MessageValues) => translate(namespace, key, values);
}

export { messages };
