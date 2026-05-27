import { getDb } from '../lib/db.js';

export type ProjectRole = 'member' | 'viewer';

export interface ProjectMember {
  project_id: number;
  user_id: number;
  role: ProjectRole;
  joined_at: string;
}

export interface ProjectMemberDetail extends ProjectMember {
  email: string;
  name: string | null;
  global_role: string;
}

export function addMember(input: { project_id: number; user_id: number; role?: ProjectRole }): ProjectMember {
  getDb()
    .prepare(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES (?, ?, COALESCE(?, 'member'))
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(input.project_id, input.user_id, input.role ?? null);
  return getMember(input.project_id, input.user_id)!;
}

export function removeMember(projectId: number, userId: number): boolean {
  return (
    getDb().prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId).changes > 0
  );
}

export function getMember(projectId: number, userId: number): ProjectMember | null {
  return (
    getDb()
      .prepare<[number, number], ProjectMember>(
        'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
      )
      .get(projectId, userId) ?? null
  );
}

export function listMembers(projectId: number): ProjectMemberDetail[] {
  return getDb()
    .prepare<[number], ProjectMemberDetail>(
      `SELECT pm.*, u.email, u.name, u.role AS global_role
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY pm.joined_at ASC`,
    )
    .all(projectId);
}

export function listProjectsForUser(userId: number): number[] {
  return getDb()
    .prepare<[number], { project_id: number }>(
      'SELECT project_id FROM project_members WHERE user_id = ?',
    )
    .all(userId)
    .map((r) => r.project_id);
}
