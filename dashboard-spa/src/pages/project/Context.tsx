import { useOutletContext } from 'react-router-dom';
import type { ProjectOutletCtx } from '../ProjectLayout';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm text-text mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Empty() {
  return <div className="text-text-muted text-sm">(none)</div>;
}

export function Context() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const ctx = snapshot.context;

  if (!ctx) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No context set. Use <code>update_context</code> to record conventions / dont_touch / deploy_notes.
      </div>
    );
  }

  const fileAnnotations = ctx.file_annotations ?? {};
  const annotationEntries = Object.entries(fileAnnotations);

  return (
    <div>
      <Section title="Conventions">
        {ctx.conventions
          ? <pre className="bg-panel border border-border rounded p-3 text-xs font-mono text-text whitespace-pre-wrap">{ctx.conventions}</pre>
          : <Empty />}
      </Section>

      <Section title="Don't touch">
        {ctx.dont_touch && ctx.dont_touch.length > 0
          ? <ul className="list-disc list-inside text-sm text-text">{ctx.dont_touch.map((d) => <li key={d}>{d}</li>)}</ul>
          : <Empty />}
      </Section>

      <Section title="Test patterns">
        {ctx.test_patterns
          ? <pre className="bg-panel border border-border rounded p-3 text-xs font-mono text-text whitespace-pre-wrap">{ctx.test_patterns}</pre>
          : <Empty />}
      </Section>

      <Section title="Deploy notes">
        {ctx.deploy_notes
          ? <pre className="bg-panel border border-border rounded p-3 text-xs font-mono text-text whitespace-pre-wrap">{ctx.deploy_notes}</pre>
          : <Empty />}
      </Section>

      <Section title="File annotations">
        {annotationEntries.length > 0
          ? <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-text-muted text-left"><th className="pb-2 pr-3">Path</th><th className="pb-2">Annotation</th></tr></thead>
              <tbody>
                {annotationEntries.map(([k, v]) => (
                  <tr key={k} className="border-b border-border/40 align-top">
                    <td className="py-2 pr-3 text-text font-mono text-xs">{k}</td>
                    <td className="py-2 text-text-muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          : <Empty />}
      </Section>

      <Section title="Meta">
        <div className="text-xs text-text-muted">
          Last validated commit: {ctx.last_validated_commit ? <code className="text-text">{ctx.last_validated_commit}</code> : '(none)'}<br/>
          Updated: {ctx.updated_at}
        </div>
      </Section>
    </div>
  );
}
