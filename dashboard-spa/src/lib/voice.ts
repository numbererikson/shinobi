import type { Note } from './types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface TranscribeResponse {
  ok: boolean;
  text?: string;
  provider?: string;
  model?: string;
  duration_seconds?: number | null;
  error?: string;
}

export async function transcribeBlob(blob: Blob, filename = 'recording.webm'): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append('audio', blob, filename);
  const res = await fetch('/api/audio/transcribe', { method: 'POST', body: form });
  return (await res.json()) as TranscribeResponse;
}

export function saveVoiceNote(input: { project_id?: number; text: string; tags?: string[]; session_id?: string }): Promise<{ ok: boolean; note?: Note; error?: string }> {
  return jsonFetch('/api/voice/save-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function voiceExtractDecisions(input: { project_id: number; text: string; session_id?: string }): Promise<{ ok: boolean; provider?: string; model?: string; drafts_extracted?: number; persisted_draft_ids?: number[]; error?: string }> {
  return jsonFetch('/api/voice/extract-decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export interface MeetingProcessResult {
  ok: boolean;
  note_id?: number;
  title?: string;
  transcript_chars?: number;
  audio_size_bytes?: number;
  audio_duration_seconds?: number | null;
  transcription_provider?: string;
  transcription_model?: string;
  extractor_provider?: string;
  extractor_model?: string;
  drafts_extracted?: number;
  draft_ids?: number[];
  error?: string;
}

export async function processMeetingFile(input: { file: File; project_id: number; title?: string; session_id?: string }): Promise<MeetingProcessResult> {
  const form = new FormData();
  form.append('audio', input.file);
  form.append('project_id', String(input.project_id));
  if (input.title) form.append('title', input.title);
  if (input.session_id) form.append('session_id', input.session_id);
  const res = await fetch('/api/voice/meeting/process', { method: 'POST', body: form });
  return (await res.json()) as MeetingProcessResult;
}

export type Recording =
  | { kind: 'idle' }
  | { kind: 'recording'; recorder: MediaRecorder; startedAt: number; chunks: Blob[] }
  | { kind: 'recorded'; blob: Blob; durationMs: number }
  | { kind: 'error'; message: string };

export async function startRecording(onStop: (blob: Blob, durationMs: number) => void): Promise<MediaRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('mic API unavailable in this browser');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });
  recorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    onStop(blob, Date.now() - startedAt);
    stream.getTracks().forEach((t) => t.stop());
  });
  recorder.start();
  return recorder;
}
