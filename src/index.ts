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
  [date: string]: PRInfo[]
} => {
  const file = fs.readFileSync('./src/pr.yml', 'utf8')
  let doc: Document
  if (!file) {
    doc = new Document(
      data.reduce((pre, curr) => {
        pre[formatDate(curr.mergedAt)] ??= []
        pre[formatDate(curr.mergedAt)].push(curr)

        return pre
      }, {})
    )
  } else {
    doc = parseDocument(file)
    const json: {
      [key: string]: PRInfo[]
    } = doc.toJSON()
    data.forEach((curr) => {
      json[formatDate(curr.mergedAt)] ??= []
      json[formatDate(curr.mergedAt)].push(curr)
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
  if (!Array.isArray(urls)) return process.exit(0)

  const data = await Promise.allSettled(
    urls.map(async (item) => await getPRInfo(item))
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
  const data = await getAllPRInfo(newPRUrls)
  const unorderedData = updatePRUrlYaml(data)
  const orderedData = Object.keys(unorderedData)
    .sort((a, b) => {
      return dayjs(a).isBefore(b) ? 1 : -1
    })
    .reduce((obj, key) => {
      obj[key] = unorderedData[key]
      return obj
    }, {})

  let md = `# List of my contributions\n`

  for (const date in orderedData) {
    const items = orderedData[date]
    let subMd = `## ${date}\n`

    for (const item of items) {
      subMd += `- ${item.owner}/${item.repo} - [${item.title}](${item.url})\n`
    }

    md += subMd
  }

  fs.writeFileSync('readme.md', md)
  fs.writeFileSync('./src/pr_url.yml', '')
})()
