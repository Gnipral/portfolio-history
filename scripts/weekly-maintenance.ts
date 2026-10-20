/**
 * Weekly maintenance: writes the data-quality report public/data/report.json and
 * regenerates CHANGELOG.md from the merged pull requests.
 * Run with: node scripts/weekly-maintenance.ts
 * Needs GITHUB_REPOSITORY (owner/name, defaults to Gnipral/portfolio-history); GITHUB_TOKEN is optional locally.
 * Writes the commit message to $COMMIT_MESSAGE_FILE when set (used by the workflow).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCHMARKS, FX_FILE, META_FILE, benchmarkFile } from './lib/config.ts'
import {
  benchmarkReport,
  fxReport,
  maintenanceCommitMessage,
  qualityReport,
  renderChangelog,
  type FileReport,
  type MergedPullRequest,
} from './lib/maintenance.ts'
import type { BenchmarkFile, FxFile, MetaFile } from './lib/snapshot.ts'

const ROOT = join(import.meta.dirname, '..')
const DATA_DIR = join(ROOT, 'public', 'data')
const REPORT_FILE = 'report.json'
const CHANGELOG = join(ROOT, 'CHANGELOG.md')

function readJson<T>(file: string): T | null {
  const path = join(DATA_DIR, file)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
}

interface PullResponse {
  number: number
  title: string
  merged_at: string | null
  user: { login: string } | null
}

async function fetchMergedPulls(repo: string, token: string | undefined): Promise<MergedPullRequest[]> {
  const pulls: MergedPullRequest[] = []
  for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!response.ok) throw new Error(`GitHub API ${response.status} ${response.statusText}`)
    const batch = (await response.json()) as PullResponse[]
    for (const pr of batch) {
      if (pr.merged_at) pulls.push({ number: pr.number, title: pr.title, author: pr.user?.login ?? 'ghost', mergedAt: pr.merged_at })
    }
    if (batch.length < 100) return pulls
  }
}

async function main() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  const files: Record<string, FileReport> = {}
  const fx = readJson<FxFile>(FX_FILE)
  if (fx) files[FX_FILE] = fxReport(fx, today)
  for (const benchmark of BENCHMARKS) {
    const file = readJson<BenchmarkFile>(benchmarkFile(benchmark.id))
    if (file) files[benchmarkFile(benchmark.id)] = benchmarkReport(file, today)
  }
  const report = qualityReport(files, readJson<MetaFile>(META_FILE), now)
  writeFileSync(join(DATA_DIR, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`)

  const repo = process.env.GITHUB_REPOSITORY ?? 'Gnipral/portfolio-history'
  const changelog = renderChangelog(await fetchMergedPulls(repo, process.env.GITHUB_TOKEN))
  const changelogChanged = !existsSync(CHANGELOG) || readFileSync(CHANGELOG, 'utf8') !== changelog
  if (changelogChanged) writeFileSync(CHANGELOG, changelog)

  const message = maintenanceCommitMessage(today, report, changelogChanged)
  if (process.env.COMMIT_MESSAGE_FILE) writeFileSync(process.env.COMMIT_MESSAGE_FILE, message)
  console.log(message)
  for (const warning of report.warnings) console.log(`::warning::${warning}`)
}

await main()
