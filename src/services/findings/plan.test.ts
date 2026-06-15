import { describe, expect, it } from 'vitest';

import { planFindings, severityToPriority, type Finding } from './plan.js';

describe('severityToPriority', () => {
  it('maps known severities', () => {
    expect(severityToPriority('critical')).toBe('urgent');
    expect(severityToPriority('High')).toBe('high');
    expect(severityToPriority('MEDIUM')).toBe('medium');
    expect(severityToPriority('moderate')).toBe('medium');
    expect(severityToPriority('low')).toBe('low');
    expect(severityToPriority('info')).toBe('low');
  });
  it('falls back to medium for unknown / missing', () => {
    expect(severityToPriority('spicy')).toBe('medium');
    expect(severityToPriority(undefined)).toBe('medium');
  });
});

describe('planFindings', () => {
  it('maps severity to priority and prefixes the title', () => {
    const planned = planFindings([{ title: 'SQL injection', severity: 'Critical', file: 'src/db.ts' }]);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.input.priority).toBe('urgent');
    expect(planned[0]!.input.title).toBe('[critical] SQL injection');
    expect(planned[0]!.file).toBe('src/db.ts');
  });

  it('folds description + remediation + file into the task description', () => {
    const planned = planFindings([
      { title: 'XSS', description: 'unescaped output', remediation: 'escape it', file: 'src/view.ts' },
    ]);
    const desc = planned[0]!.input.description ?? '';
    expect(desc).toContain('unescaped output');
    expect(desc).toContain('Remediation: escape it');
    expect(desc).toContain('File: src/view.ts');
  });

  it('chains findings on the same file and leaves different files independent', () => {
    const findings: Finding[] = [
      { title: 'a1', file: 'src/a.ts' },
      { title: 'b1', file: 'src/b.ts' },
      { title: 'a2', file: 'src/a.ts' },
      { title: 'a3', file: 'src/a.ts' },
    ];
    const planned = planFindings(findings);

    expect(planned[0]!.dependsOnIndex).toBeNull(); // first a.ts
    expect(planned[1]!.dependsOnIndex).toBeNull(); // b.ts independent
    expect(planned[2]!.dependsOnIndex).toBe(0); // a2 waits on a1
    expect(planned[3]!.dependsOnIndex).toBe(2); // a3 waits on a2
  });

  it('groups same-file findings regardless of path spelling (normalized)', () => {
    const planned = planFindings([
      { title: 'x1', file: 'src/x.ts' },
      { title: 'x2', file: './src/x.ts' },
    ]);
    expect(planned[0]!.dependsOnIndex).toBeNull();
    expect(planned[1]!.dependsOnIndex).toBe(0);
  });

  it('does not chain when chainSameFile is false', () => {
    const planned = planFindings(
      [
        { title: 'a1', file: 'src/a.ts' },
        { title: 'a2', file: 'src/a.ts' },
      ],
      { chainSameFile: false },
    );
    expect(planned[1]!.dependsOnIndex).toBeNull();
  });

  it('leaves file-less findings unchained and stamps the project id', () => {
    const planned = planFindings([{ title: 'no file' }, { title: 'also none' }], { projectId: 42 });
    expect(planned[0]!.file).toBeNull();
    expect(planned[1]!.dependsOnIndex).toBeNull();
    expect(planned[0]!.input.project_id).toBe(42);
  });
});
