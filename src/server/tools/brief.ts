import { composeBrief, sendBrief } from '../../services/brief/brief.js';
import { getBoolean } from './args.js';
import type { ShinobiTool } from './types.js';

export const briefTools: ShinobiTool[] = [
  {
    name: 'morning_brief',
    description:
      'The daily morning brief the server pushes on its own (SHINOBI_BRIEF_CRON, default 07:45): problems from system_status, ' +
      "plugins' sections (e.g. today's reminders), backups and stalled projects. Returns the text; with send:true it also pushes it now.",
    inputSchema: {
      type: 'object',
      properties: { send: { type: 'boolean', description: 'Also push it to every subscribed device now (default false: preview only).' } },
      additionalProperties: false,
    },
    handler: async (args) => {
      if (getBoolean(args, 'send') === true) {
        const { brief, delivery } = await sendBrief();
        return { ...brief, sent: { devices: delivery.total, succeeded: delivery.succeeded, error: delivery.error } };
      }
      return composeBrief();
    },
  },
];
