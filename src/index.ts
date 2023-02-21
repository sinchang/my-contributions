import { Octokit } from '@octokit/rest'
import type { RestEndpointMethodTypes } from '@octokit/rest'
import fs from 'fs'
import YAML, { parseDocument, Document } from 'yaml'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

const octokit = new Octokit()

type PRInfo = {
  title: string
  mergedAt: string
  url: string
  owner: string
  repo: string
}

const formatDate = (date: string): string => {
  return dayjs.utc(date).format('YYYY-MM-DD')
}

const parsePRUrlYaml = (): string[] => {
  const file = fs.readFileSync('./src/pr_url.yml', 'utf8')
  return YAML.parse(file)
}

const updatePRUrlYaml = (
  data: PRInfo[]
): {
  [key: string]: PRInfo[]
} => {
  const file = fs.readFileSync('./src/pr.yml', 'utf8')
  let doc: Document
  if (!file) {
    doc = new Document(
      data.reduce((pre, curr) => {
        const key = `${curr.owner}/${curr.repo}`
        pre[key] ??= []
        pre[key].push(curr)

        return pre
      }, {})
    )
  } else {
    doc = parseDocument(file)
    const json: {
      [key: string]: PRInfo[]
    } = doc.toJSON()
    data.forEach((curr) => {
      const key = `${curr.owner}/${curr.repo}`
      json[key] ??= []
      json[key].push(curr)
    })
    doc = new Document(json)
  }

  fs.writeFileSync('./src/pr.yml', String(doc))
  return doc.toJSON()
}

const newPRUrls = parsePRUrlYaml()

const getPRInfo = async (
  url: string
): Promise<RestEndpointMethodTypes['pulls']['get']['response']> => {
  const [, , , owner, repo, , pull_number] = url.split('/')
  return await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: Number(pull_number),
  })
}

const getAllPRInfo = async (urls: string[]): Promise<PRInfo[]> => {
  const data = await Promise.allSettled(
    newPRUrls.map(async (item) => await getPRInfo(item))
  )

  const response: PRInfo[] = (
    data.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      RestEndpointMethodTypes['pulls']['get']['response']
    >[]
  ).map((r) => {
    const { title, html_url, merged_at } = r.value.data
    const [, , , owner, repo] = html_url.split('/')
    return {
      title,
      url: html_url,
      mergedAt: merged_at as string,
      owner,
      repo,
    }
  })

  if (!response) {
    const error = (
      data.find((res) => res.status === 'rejected') as
        | PromiseRejectedResult
        | undefined
    )?.reason
    throw new Error(error)
  }

  return response
}

;(async () => {
  // const data = await getAllPRInfo(newPRUrls)
  const data: PRInfo[] = [
    {
      title: "fix1: Can't resolve '@iconify/json/package.json' error",
      url: 'https://github.com/egoist/tailwindcss-icons/pull/10',
      mergedAt: '2023-02-20T07:17:34Z',
      owner: 'egoist',
      repo: 'tailwindcss-icons',
    },
    {
      title: "chore1: Can't resolve '@iconify/json/package.json' error",
      url: 'https://github.com/egoist/tailwindcss-icons/pull/10',
      mergedAt: '2023-02-22T07:17:34Z',
      owner: 'egoist',
      repo: 'tailwindcss-icons',
    },
  ]

  const json = updatePRUrlYaml(data)
  const reorg: {
    [key in string]: PRInfo[]
  } = {}

  for (const key in json) {
    const items = json[key]

    for (const item of items) {
      const date = formatDate(item.mergedAt ?? '')
      reorg[date] ??= []

      reorg[date].push(item)
    }
  }

  console.log(reorg)
  let md = `# List of my contributions\n`

  for (const date in reorg) {
    const items = reorg[date]
    let subMd = `## ${date}\n`

    for (const item of items) {
      subMd += `- ${item.owner}/${item.repo} - [${item.title}](${item.url})\n`
    }

    md += subMd
  }

  console.log(md)
  fs.writeFileSync('readme.md', md)
})()
