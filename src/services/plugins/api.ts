import type { Context } from '../../models/context.js';
import type { DeadEnd } from '../../models/dead_ends.js';
import type { Decision } from '../../models/decisions.js';
import type { Note } from '../../models/notes.js';
import type { Project } from '../../models/projects.js';
import type { Subtask } from '../../models/subtasks.js';
import { getContext } from '../../models/context.js';
import { checkDeadEnds, listDeadEnds } from '../../models/dead_ends.js';
import { listDecisions, searchDecisions } from '../../models/decisions.js';
import { listNotes, searchNotes } from '../../models/notes.js';
import { getProject, listProjects, projectsMatchingTargetPath } from '../../models/projects.js';
import {
  getSubtask,
  listSubtasks,
  searchSubtasks,
} from '../../models/subtasks.js';
import { listActivity, type ActivityRow } from '../../models/activity.js';

export interface ShinobiApi {
  listProjects(options?: { includeArchived?: boolean; status?: Project['status'] }): Project[];
  getProject(id: number): Project | null;
  projectsMatchingTargetPath(filePath: string): Project[];

  listSubtasks(options?: { projectId?: number; status?: Subtask['status']; sessionId?: string }): Subtask[];
  getSubtask(id: number): Subtask | null;
  searchSubtasks(query: string, projectId?: number, limit?: number): Subtask[];

  searchDecisions(query: string, projectId?: number, limit?: number): Decision[];
  listDecisions(options?: { projectId?: number; subtaskId?: number; status?: Decision['status']; limit?: number }): Decision[];

  checkDeadEnds(input: { approach: string; files?: string[]; projectId?: number; limit?: number }): DeadEnd[];
  listDeadEnds(options?: { projectId?: number; limit?: number }): DeadEnd[];

  searchNotes(query: string, projectId?: number, limit?: number): Note[];
  listNotes(options?: { projectId?: number; limit?: number }): Note[];

  getContext(projectId: number): Context | null;
  listActivity(options?: Parameters<typeof listActivity>[0]): ActivityRow[];

  getProjectSnapshot(projectId: number): {
    project: Project | null;
    subtasks: Subtask[];
    recent_decisions: Decision[];
    recent_dead_ends: DeadEnd[];
    context: Context | null;
  };
}

export function createApi(): ShinobiApi {
  return {
    listProjects,
    getProject,
    projectsMatchingTargetPath,
    listSubtasks,
    getSubtask,
    searchSubtasks,
    searchDecisions,
    listDecisions,
    checkDeadEnds,
    listDeadEnds,
    searchNotes,
    listNotes,
    getContext,
    listActivity,
    getProjectSnapshot(projectId: number) {
      return {
        project: getProject(projectId),
        subtasks: listSubtasks({ projectId }),
        recent_decisions: listDecisions({ projectId, limit: 20 }),
        recent_dead_ends: listDeadEnds({ projectId, limit: 20 }),
        context: getContext(projectId),
      };
    },
  };
}
