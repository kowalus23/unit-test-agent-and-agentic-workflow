// Renders a Vitest `json-summary` coverage report as a Markdown table.
// Usage: node scripts/ci/coverage-summary.ts <title> <path/to/coverage-summary.json>
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Metric = { total: number; covered: number; pct: number | 'Unknown' };
type FileSummary = Record<'statements' | 'branches' | 'functions' | 'lines', Metric>;

const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;

function formatPct(metric: Metric): string {
  return metric.pct === 'Unknown' ? 'n/a' : `${metric.pct.toFixed(2)}%`;
}

export function renderCoverageSummary(title: string, summary: Record<string, FileSummary>, root: string): string {
  const header = `| File | ${METRICS.map((m) => m[0].toUpperCase() + m.slice(1)).join(' | ')} |`;
  const divider = `|---|${METRICS.map(() => '---:').join('|')}|`;
  const row = (name: string, file: FileSummary) => `| ${name} | ${METRICS.map((m) => formatPct(file[m])).join(' | ')} |`;
  const files = Object.entries(summary)
    .filter(([name]) => name !== 'total')
    .map(([name, file]) => row(name.startsWith(root) ? name.slice(root.length) : name, file))
    .sort();
  return [
    `### ${title} coverage`,
    '',
    header,
    divider,
    row('**All files**', summary.total),
    '',
    '<details><summary>Per file</summary>',
    '',
    header,
    divider,
    ...files,
    '',
    '</details>',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [title, file] = process.argv.slice(2);
  if (!title || !file) {
    console.error('Usage: coverage-summary.ts <title> <coverage-summary.json>');
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.log(`### ${title} coverage\n\nNo coverage report was produced.\n`);
  } else {
    const summary = JSON.parse(readFileSync(file, 'utf8')) as Record<string, FileSummary>;
    console.log(renderCoverageSummary(title, summary, `${process.cwd()}/`));
  }
}
