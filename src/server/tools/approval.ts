import { recordActivity } from '../../models/activity.js';
import { createApproval, waitForApprovalResponse } from '../../models/approvals.js';
import { sendPushToAll } from '../../services/push/web-push.js';
import { getNumber, getString, getStringArray, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

export const approvalTools: ShinobiTool[] = [
  {
    name: 'request_approval',
    description:
      'Block waiting for the user to approve a decision via mobile push notification. Creates an approval row, fires web push to all subscribed devices with action buttons, and polls until the user responds (or timeout). Use when the agent hits a decision point that requires human judgment ("ship to prod?", "drop this feature?", "pick library X or Y?").',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Question shown to the user on push notification + dashboard.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Response choices. Default ["yes","no"]. Custom values (e.g. ["X","Y","Z"]) become buttons.',
          default: ['yes', 'no'],
        },
        project_id: { type: 'integer', description: 'Project context (optional but recommended).' },
        session_id: { type: 'string' },
        timeout_seconds: {
          type: 'integer',
          default: 300,
          description: 'Max wait time before returning timeout response. Default 5 minutes.',
        },
        expires_at: {
          type: 'string',
          description: 'Optional ISO timestamp after which the approval auto-expires server-side.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const prompt = requireString(args, 'prompt');
      const options = getStringArray(args, 'options') ?? ['yes', 'no'];
      const projectId = getNumber(args, 'project_id');
      const sessionId = getString(args, 'session_id');
      const timeoutSeconds = getNumber(args, 'timeout_seconds') ?? 300;
      const expiresAt = getString(args, 'expires_at');

      const createInput: Parameters<typeof createApproval>[0] = {
        prompt,
        options,
      };
      if (projectId !== undefined) createInput.project_id = projectId;
      if (sessionId !== undefined) createInput.session_id = sessionId;
      if (expiresAt !== undefined) createInput.expires_at = expiresAt;
      const approval = createApproval(createInput);

      recordActivity({
        project_id: projectId ?? null,
        session_id: sessionId ?? null,
        action_type: 'request_approval',
        action_details: `[${options.join('/')}] ${prompt.slice(0, 160)}`,
        entity_type: 'approval',
        entity_id: approval.id,
      });

      const push = await sendPushToAll({
        title: 'Shinobi approval needed',
        body: prompt.length > 160 ? prompt.slice(0, 160) + '…' : prompt,
        tag: `approval-${approval.id}`,
        url: `/approvals#approval-${approval.id}`,
        approval_id: approval.id,
        actions: options.slice(0, 3).map((opt) => ({ action: `respond:${opt}`, title: opt })),
        data: { approval_id: approval.id, options },
      });

      const responded = await waitForApprovalResponse(approval.id, timeoutSeconds * 1000);

      const timedOut = responded.status === 'pending';
      if (!timedOut && responded.response_value) {
        recordActivity({
          project_id: projectId ?? null,
          session_id: sessionId ?? null,
          action_type: 'approval_responded',
          action_details: `${responded.response_value}${responded.response_note ? ' — ' + responded.response_note : ''}`,
          entity_type: 'approval',
          entity_id: approval.id,
        });
      }

      return {
        approval_id: approval.id,
        status: responded.status,
        response_value: responded.response_value,
        response_note: responded.response_note,
        responded_at: responded.responded_at,
        timed_out: timedOut,
        push: {
          total_devices: push.total,
          succeeded: push.succeeded,
          failed: push.failed,
          pruned_endpoints: push.pruned_endpoints.length,
        },
      };
    },
  },
];
