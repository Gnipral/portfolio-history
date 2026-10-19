/**
 * Prints today's author from .github/authors.json (round-robin by UTC day number)
 * and exposes it as step outputs `name`, `email` and `username` in GitHub Actions.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickAuthor, type Author } from './lib/snapshot.ts'

const authors = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.github', 'authors.json'), 'utf8')) as Author[]
const author = pickAuthor(authors, new Date())

console.log(`${author.name} <${author.email}>`)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `name=${author.name}\nemail=${author.email}\nusername=${author.username}\n`)
}
