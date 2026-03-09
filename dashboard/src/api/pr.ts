import { execFile } from 'child_process'
import type { ViteDevServer } from 'vite'

export function registerPrRoutes(server: ViteDevServer) {
  // GET /api/pr-status — fetch PR status from GitHub
  server.middlewares.use('/api/pr-status', (req, res) => {
    const url = new URL(req.url || '', 'http://localhost')
    const prUrl = url.searchParams.get('url')
    if (!prUrl) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing url param' })); return }

    // Extract owner/repo/number from GitHub PR URL
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'unknown', url: prUrl }))
      return
    }

    const [, owner, repo, number] = match
    execFile('gh', ['pr', 'view', number, '--repo', `${owner}/${repo}`, '--json', 'state,reviewDecision,statusCheckRollup,mergeable,title,additions,deletions,changedFiles,reviews,createdAt,updatedAt'], { timeout: 15000 }, (err, stdout) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.end(JSON.stringify({ state: 'unknown', url: prUrl, error: 'Failed to fetch PR status' }))
        return
      }
      try {
        const pr = JSON.parse(stdout)
        const reviews = (pr.reviews || []).map((r: { state: string; author: { login: string } }) => ({
          state: r.state,
          author: r.author?.login,
        }))
        const checks = (pr.statusCheckRollup || []).map((c: { name: string; status: string; conclusion: string }) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion,
        }))
        const checksPass = checks.length > 0 && checks.every((c: { conclusion: string }) => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
        const checksFail = checks.some((c: { conclusion: string }) => c.conclusion === 'FAILURE')
        const checksPending = checks.some((c: { status: string }) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED')

        res.end(JSON.stringify({
          state: pr.state,
          reviewDecision: pr.reviewDecision || null,
          mergeable: pr.mergeable,
          title: pr.title,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
          reviews,
          checksPass,
          checksFail,
          checksPending,
          checksTotal: checks.length,
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
          url: prUrl,
        }))
      } catch {
        res.end(JSON.stringify({ state: 'unknown', url: prUrl }))
      }
    })
  })

  // GET /api/pr-stack — fetch status for all PRs in a Graphite stack
  server.middlewares.use('/api/pr-stack', (req, res) => {
    const url = new URL(req.url || '', 'http://localhost')
    const prUrl = url.searchParams.get('url')
    const basePr = url.searchParams.get('base')
    if (!prUrl && !basePr) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing url or base param' })); return }

    // Extract owner/repo from URL, or use base PR number
    let owner = '', repo = '', baseNumber = basePr || ''
    if (prUrl) {
      const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
      if (match) {
        owner = match[1]; repo = match[2]; baseNumber = match[3]
      }
    }

    // Use gh to find PRs from the same author whose branch starts with the same prefix
    execFile('gh', ['pr', 'view', baseNumber, '--repo', `${owner}/${repo}`, '--json', 'headRefName,author'], { timeout: 10000 }, (err, stdout) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) { res.end(JSON.stringify({ prs: [], error: 'Failed to fetch base PR' })); return }

      try {
        const basePrData = JSON.parse(stdout)
        const branch = basePrData.headRefName || ''
        const author = basePrData.author?.login || ''
        // Extract the branch prefix (e.g., "user/project/name" from "user/project/name/1/description")
        const parts = branch.split('/')
        const prefix = parts.length > 3 ? parts.slice(0, 3).join('/') : branch

        execFile('gh', ['pr', 'list', '--repo', `${owner}/${repo}`, '--author', author, '--search', `is:pr head:${prefix}`, '--state', 'all', '--json', 'number,title,state,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,headRefName,isDraft', '--limit', '20'], { timeout: 15000 }, (err2, stdout2) => {
          if (err2) { res.end(JSON.stringify({ prs: [], error: 'Failed to list stack PRs' })); return }

          try {
            const prs = JSON.parse(stdout2)
              .sort((a: { number: number }, b: { number: number }) => a.number - b.number)
              .map((pr: Record<string, unknown>) => {
                const checks = ((pr.statusCheckRollup || []) as { conclusion: string; status: string }[])
                const checksPass = checks.length > 0 && checks.every(c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
                const checksFail = checks.some(c => c.conclusion === 'FAILURE')
                return {
                  number: pr.number,
                  title: pr.title,
                  state: pr.state,
                  reviewDecision: pr.reviewDecision || null,
                  additions: pr.additions,
                  deletions: pr.deletions,
                  changedFiles: pr.changedFiles,
                  branch: pr.headRefName,
                  checksPass,
                  checksFail,
                  url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
                }
              })

            const graphiteStackUrl = prs.length > 0
              ? `https://app.graphite.dev/github/pr/${owner}/${repo}/${prs[0].number}`
              : null

            res.end(JSON.stringify({ prs, graphiteStackUrl, prefix }))
          } catch { res.end(JSON.stringify({ prs: [] })) }
        })
      } catch { res.end(JSON.stringify({ prs: [] })) }
    })
  })
}
