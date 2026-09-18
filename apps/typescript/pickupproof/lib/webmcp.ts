export function registerCaseNavigation(
  select: (id: string) => void,
  exists: (id: string) => boolean,
) {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (
          tool: unknown,
          options: { signal: AbortSignal },
        ) => void | Promise<void>;
      };
    }
  ).modelContext;
  if (!context) return;
  const lifecycle = new AbortController();
  Promise.resolve(
    context.registerTool(
      {
        name: 'open_recovery_case',
        description:
          'Open an existing recovery case for review. Does not approve or place a call.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input: unknown) {
          const id = (input as { id?: unknown })?.id;
          if (typeof id !== 'string' || !exists(id))
            throw Error('Unknown recovery case');
          select(id);
          return { id, opened: true };
        },
      },
      { signal: lifecycle.signal },
    ),
  ).catch(() => {});
  return () => lifecycle.abort();
}
