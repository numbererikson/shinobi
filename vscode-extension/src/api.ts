import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface Project {
  id: number;
  title: string;
  description: string | null;
  workspace: string | null;
  status: string;
  priority: string;
  archived_at: string | null;
}

export interface Subtask {
  id: number;
  project_id: number;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string | null;
  claude_session_id: string | null;
  last_claimed_at: string | null;
  updated_at: string;
}

export interface Decision {
  id: number;
  project_id: number;
  title: string;
  body: string;
  status: 'open' | 'fix_now' | 'fix_later' | 'wontfix' | 'fixed' | 'false_positive';
  created_at: string;
}

export interface DeadEnd {
  id: number;
  project_id: number;
  title: string;
  what_was_tried: string;
  why_it_failed: string;
  created_at: string;
}

export interface ProjectSnapshot {
  project: Project;
  subtasks: Subtask[];
  decisions: Decision[];
  dead_ends: DeadEnd[];
}

function dashboardConfig(): { url: string; token: string } {
  const cfg = vscode.workspace.getConfiguration('shinobi');
  return {
    url: cfg.get<string>('dashboardUrl', 'http://127.0.0.1:8765').replace(/\/$/, ''),
    token: cfg.get<string>('token', ''),
  };
}

function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { url: baseUrl, token } = dashboardConfig();
  const full = new URL(baseUrl + path);
  const isHttps = full.protocol === 'https:';
  const client = isHttps ? https : http;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts: http.RequestOptions = {
    method: init.method ?? 'GET',
    headers,
  };
  const body = init.body !== undefined ? JSON.stringify(init.body) : null;
  return new Promise((resolve, reject) => {
    const req = client.request(full, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          return;
        }
        if (text.length === 0) {
          resolve(undefined as unknown as T);
          return;
        }
        try {
          resolve(JSON.parse(text) as T);
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export function listProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects?sort=active');
}

export function getSnapshot(projectId: number): Promise<ProjectSnapshot> {
  return request<ProjectSnapshot>(`/api/projects/${projectId}/snapshot`);
}

export function patchSubtaskStatus(
  id: number,
  status: 'todo' | 'in_progress' | 'done',
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/subtasks/${id}`, {
    method: 'PATCH',
    body: { status },
  });
}

export function dashboardUrlForProject(projectId: number): string {
  return `${dashboardConfig().url}/projects/${projectId}`;
}

export function dashboardUrlForSubtask(projectId: number, subtaskId: number): string {
  return `${dashboardConfig().url}/projects/${projectId}#subtask-${subtaskId}`;
}
