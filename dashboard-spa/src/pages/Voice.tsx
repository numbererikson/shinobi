import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Square, Loader2, Trash2, Save, Sparkles, CheckCircle2, AlertCircle, Upload, Users } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { listProjects } from '../lib/api';
import { processMeetingFile, saveVoiceNote, startRecording, transcribeBlob, voiceExtractDecisions, type MeetingProcessResult } from '../lib/voice';
import type { Project } from '../lib/types';

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number; recorder: MediaRecorder }
  | { kind: 'recorded'; blob: Blob; durationMs: number }
  | { kind: 'transcribing' }
  | { kind: 'transcribed'; blob: Blob; text: string; provider: string; model: string; durationMs: number }
  | { kind: 'saving' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

export function Voice() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tags, setTags] = useState('voice');
  const [editText, setEditText] = useState('');
  const timerRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    listProjects({ sort: 'active' }).then((p) => {
      setProjects(p);
      const stored = localStorage.getItem('voice-project-id');
      if (stored && p.some((x) => String(x.id) === stored)) setProjectId(Number(stored));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (phase.kind === 'recording') {
      timerRef.current = window.setInterval(() => setTick((t) => t + 1), 250);
    } else if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [phase.kind]);

  function onProjectChange(id: number | null) {
    setProjectId(id);
    if (id !== null) localStorage.setItem('voice-project-id', String(id));
    else localStorage.removeItem('voice-project-id');
  }

  async function start() {
    try {
      const recorder = await startRecording((blob, durationMs) => {
        setPhase({ kind: 'recorded', blob, durationMs });
      });
      setPhase({ kind: 'recording', startedAt: Date.now(), recorder });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function stop() {
    if (phase.kind !== 'recording') return;
    phase.recorder.stop();
  }

  function discard() {
    setPhase({ kind: 'idle' });
    setEditText('');
  }

  async function transcribe() {
    if (phase.kind !== 'recorded') return;
    setPhase({ kind: 'transcribing' });
    try {
      const ext = phase.blob.type.includes('mp4') ? 'mp4' : phase.blob.type.includes('ogg') ? 'ogg' : 'webm';
      const res = await transcribeBlob(phase.blob, `recording.${ext}`);
      if (!res.ok || !res.text) {
        setPhase({ kind: 'error', message: res.error ?? 'transcription returned empty' });
        return;
      }
      setEditText(res.text);
      setPhase({
        kind: 'transcribed',
        blob: phase.blob,
        text: res.text,
        provider: res.provider ?? 'unknown',
        model: res.model ?? 'unknown',
        durationMs: phase.durationMs,
      });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function saveAsNote() {
    if (phase.kind !== 'transcribed' || editText.trim() === '') return;
    setPhase({ kind: 'saving' });
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const result = await saveVoiceNote({
        project_id: projectId ?? undefined,
        text: editText.trim(),
        tags: tagList.length > 0 ? tagList : ['voice'],
      });
      if (!result.ok) {
        setPhase({ kind: 'error', message: result.error ?? 'save failed' });
        return;
      }
      setPhase({ kind: 'done', message: `note #${result.note?.id} saved${projectId ? ` to project #${projectId}` : ' to inbox'}` });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function saveAsDrafts() {
    if (phase.kind !== 'transcribed' || editText.trim() === '' || projectId === null) {
      if (projectId === null) setPhase({ kind: 'error', message: 'pick a project to extract decisions into' });
      return;
    }
    setPhase({ kind: 'saving' });
    try {
      const result = await voiceExtractDecisions({ project_id: projectId, text: editText.trim() });
      if (!result.ok) {
        setPhase({ kind: 'error', message: result.error ?? 'extract failed' });
        return;
      }
      setPhase({
        kind: 'done',
        message: `${result.drafts_extracted ?? 0} draft(s) created via ${result.provider}:${result.model} — open project Drafts tab to review`,
      });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function reset() {
    setPhase({ kind: 'idle' });
    setEditText('');
  }

  const elapsedSec = phase.kind === 'recording' ? Math.floor((Date.now() - phase.startedAt) / 1000) : 0;
  void tick;

  return (
    <div className="max-w-2xl mx-auto">
      <header className="border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text flex items-center gap-2"><Mic className="w-6 h-6 text-accent" /> Voice capture</h1>
        <p className="text-text-muted text-xs mt-1">
          Record audio → Whisper transcribe → save as note or extract decisions into drafts for review.
        </p>
      </header>

      <div className="bg-panel border border-border rounded-lg p-6 mb-4">
        <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-2">Project</label>
        <select
          value={projectId ?? ''}
          onChange={(e) => onProjectChange(e.target.value ? Number(e.target.value) : null)}
          className="w-full bg-panel-2 border border-border rounded px-3 py-2 text-sm text-text"
        >
          <option value="">(inbox — no project)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.workspace ? `[${p.workspace}] ` : ''}{p.title}
            </option>
          ))}
        </select>

        <div className="flex flex-col items-center my-8">
          {phase.kind === 'idle' && (
            <Button variant="primary" onClick={() => void start()} className="w-32 h-32 rounded-full flex items-center justify-center text-base">
              <Mic className="w-12 h-12" />
            </Button>
          )}
          {phase.kind === 'recording' && (
            <>
              <Button variant="danger" onClick={stop} className="w-32 h-32 rounded-full flex items-center justify-center animate-pulse">
                <Square className="w-12 h-12" />
              </Button>
              <div className="mt-3 text-warning text-sm font-mono">recording {elapsedSec}s</div>
            </>
          )}
          {phase.kind === 'recorded' && (
            <>
              <div className="text-text text-sm">recorded {Math.floor(phase.durationMs / 1000)}s</div>
              <audio controls className="my-3" src={URL.createObjectURL(phase.blob)} />
              <div className="flex gap-2">
                <Button variant="default" onClick={discard}><Trash2 className="w-4 h-4" /></Button>
                <Button variant="primary" onClick={() => void transcribe()}>Transcribe</Button>
              </div>
            </>
          )}
          {phase.kind === 'transcribing' && (
            <div className="text-warning text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> transcribing...</div>
          )}
          {phase.kind === 'transcribed' && (
            <div className="w-full">
              <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-2">Transcript (edit before saving)</label>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
                className="w-full bg-panel-2 border border-border rounded px-3 py-2 text-sm text-text font-mono"
              />
              <div className="text-text-dim text-[10px] mt-1">via {phase.provider}:{phase.model} · {Math.floor(phase.durationMs / 1000)}s audio</div>

              <label className="block text-[11px] uppercase tracking-wider text-text-muted mt-4 mb-2">Tags (comma-separated, applied to note only)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full bg-panel-2 border border-border rounded px-3 py-2 text-sm text-text font-mono"
              />

              <div className="flex gap-2 mt-4 flex-wrap">
                <Button variant="default" onClick={reset}><Trash2 className="w-4 h-4 mr-1" /> Discard</Button>
                <Button variant="primary" onClick={() => void saveAsNote()} className="flex items-center"><Save className="w-4 h-4 mr-1" /> Save as note</Button>
                <Button variant="primary" onClick={() => void saveAsDrafts()} disabled={projectId === null} className="flex items-center" title={projectId === null ? 'pick a project first' : 'extract decisions to drafts'}>
                  <Sparkles className="w-4 h-4 mr-1" /> Extract decisions
                </Button>
              </div>
            </div>
          )}
          {phase.kind === 'saving' && (
            <div className="text-warning text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> saving...</div>
          )}
          {phase.kind === 'done' && (
            <div className="text-success text-sm flex items-center gap-2 flex-col">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {phase.message}</div>
              <Button variant="primary" onClick={reset} className="mt-3">Record another</Button>
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="text-danger text-sm flex items-center gap-2 flex-col">
              <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {phase.message}</div>
              <Button variant="default" onClick={reset} className="mt-3">Reset</Button>
            </div>
          )}
        </div>
      </div>

      <MeetingUploader projects={projects} defaultProjectId={projectId} />

      <div className="text-text-muted text-xs mt-6">
        <p>Requires a transcription provider: <code>SHINOBI_TRANSCRIPTION_PROVIDER</code> in <Link to="/settings" className="text-accent underline">Settings</Link> (or canonical <code>GROQ_API_KEY</code> / <code>OPENAI_API_KEY</code>).</p>
        <p className="mt-1">Install as PWA on mobile via browser's "Add to home screen" — works offline for read-only.</p>
      </div>
    </div>
  );
}

interface MeetingUploaderProps {
  projects: Project[];
  defaultProjectId: number | null;
}

function MeetingUploader({ projects, defaultProjectId }: MeetingUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<number | null>(defaultProjectId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MeetingProcessResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setProjectId(defaultProjectId); }, [defaultProjectId]);

  async function upload() {
    if (!file || projectId === null) {
      setErr('pick an audio file and a project');
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const opts: Parameters<typeof processMeetingFile>[0] = { file, project_id: projectId };
      if (title.trim()) opts.title = title.trim();
      const r = await processMeetingFile(opts);
      if (!r.ok) {
        setErr(r.error ?? 'meeting processing failed');
        return;
      }
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setTitle('');
    setResult(null);
    setErr(null);
  }

  return (
    <div className="bg-panel border border-border rounded-lg p-6 mt-6">
      <h2 className="text-sm text-text mb-2 flex items-center gap-2">
        <Users className="w-4 h-4 text-accent" /> Meeting capture (upload longer audio)
      </h2>
      <p className="text-text-muted text-xs mb-4">
        Upload a meeting recording (.mp3 / .m4a / .wav / .webm, max ~25 MB on Groq free tier). Whisper transcribes
        → transcript saved as a note tagged <code>meeting</code> → decision extractor runs → review drafts on the project's Drafts tab.
      </p>

      <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-2">Project</label>
      <select
        value={projectId ?? ''}
        onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
        className="w-full bg-panel-2 border border-border rounded px-3 py-2 text-sm text-text mb-3"
      >
        <option value="">(pick a project — required for meetings)</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.workspace ? `[${p.workspace}] ` : ''}{p.title}</option>
        ))}
      </select>

      <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-2">Title (optional)</label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Standup 2026-05-24"
        className="w-full bg-panel-2 border border-border rounded px-3 py-2 text-sm text-text mb-3"
      />

      <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-2">Audio file</label>
      <input
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent file:text-bg file:cursor-pointer mb-3"
      />
      {file && (
        <div className="text-text-dim text-[11px] mb-3">
          {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          {file.size > 25 * 1024 * 1024 && <span className="text-warning ml-2">⚠️ over 25 MB — Groq/OpenAI will reject. Pre-split with ffmpeg.</span>}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void upload()} disabled={busy || !file || projectId === null}>
          {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
          {busy ? 'processing...' : 'Process meeting'}
        </Button>
        {(result || err) && (
          <Button variant="default" onClick={reset}>Reset</Button>
        )}
      </div>

      {err && (
        <div className="mt-4 px-3 py-2 rounded text-sm flex items-center gap-2 bg-danger/20 text-danger border border-danger/40">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}
      {result && (
        <div className="mt-4 px-3 py-2 rounded text-sm bg-success/20 text-success border border-success/40">
          <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4" /> Meeting processed</div>
          <div className="text-xs text-text grid grid-cols-[8rem_1fr] gap-y-1">
            <div className="text-text-muted">title</div><div>{result.title}</div>
            <div className="text-text-muted">transcript</div><div>{result.transcript_chars?.toLocaleString()} chars · {result.audio_duration_seconds?.toFixed(0) ?? '?'}s audio · via {result.transcription_provider}:{result.transcription_model}</div>
            <div className="text-text-muted">drafts extracted</div><div>{result.drafts_extracted ?? 0} via {result.extractor_provider}:{result.extractor_model}</div>
            <div className="text-text-muted">note id</div><div>#{result.note_id}</div>
          </div>
          {projectId !== null && (
            <Link to={`/projects/${projectId}/decision-drafts`} className="inline-block mt-2 text-accent hover:underline text-xs">
              → Review drafts on project Drafts tab
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
