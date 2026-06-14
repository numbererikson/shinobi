import { recordActivity } from '../../models/activity.js';
import { sendPushSafe, type PushPayload } from '../../services/push/web-push.js';
import { getNumber, getString, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

const KINDS = ['task_completed', 'blocked', 'info'] as const;
type NotifyKind = (typeof KINDS)[number];

const TITLE_DEFAULTS: Record<NotifyKind, string> = {
  task_completed: 'Shinobi: task done',
  blocked: 'Shinobi: agent blocked',
  info: 'Shinobi',
};

export const notifyTools: ShinobiTool[] = [
  {
    name: 'notify',
    description:
      'Fire-and-forget mobile push to every subscribed device. Unlike request_approval, this does NOT block waiting for a response — use it from a headless / dispatch-loop agent to signal "done while you slept" (kind:"task_completed") or "I am stuck, come look" (kind:"blocked"). Returns a delivery summary; push failures never throw.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...KINDS],
          default: 'info',
          description: 'Signal type — sets a sensible default title and the notification tag.',
        },
        body: { type: 'string', description: 'Notification body text shown on the device.' },
        title: { type: 'string', description: 'Notification title. Defaults per kind.' },
        url: { type: 'string', description: 'Dashboard path opened when the notification is tapped (default "/").' },
        project_id: { type: 'integer', description: 'Project context for the activity timeline (optional).' },
        session_id: { type: 'string' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const kindRaw = getString(args, 'kind') ?? 'info';
      const kind: NotifyKind = (KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as NotifyKind)
        : 'info';
      const body = requireString(args, 'body');
      const title = getString(args, 'title') ?? TITLE_DEFAULTS[kind];
      const url = getString(args, 'url');
      const projectId = getNumber(args, 'project_id');
      const sessionId = getString(args, 'session_id');

      const data: Record<string, unknown> = { kind };
      if (url !== undefined) data['url'] = url;
      const payload: PushPayload = {
        title,
        body: body.length > 160 ? body.slice(0, 160) + '…' : body,
        tag: `notify-${kind}`,
        data,
      };
      if (url !== undefined) payload.url = url;

      recordActivity({
        project_id: projectId ?? null,
        session_id: sessionId ?? null,
        action_type: 'notify',
        action_details: `[${kind}] ${body.slice(0, 160)}`,
        entity_type: 'notification',
        entity_id: null,
      });

      const delivery = await sendPushSafe(payload);
      return {
        kind,
        delivered: {
          total_devices: delivery.total,
          succeeded: delivery.succeeded,
          failed: delivery.failed,
          pruned_endpoints: delivery.pruned_endpoints.length,
          error: delivery.error,
        },
      };
    },
  },
];
