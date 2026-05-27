export interface ShinobiTool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}
