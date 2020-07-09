const child_process = require('child_process');
const process = require('process');
const { readFile } = require('fs').promises;

const core = require('@actions/core');
const fetch = require('node-fetch');

const GITHUB_API = 'https://api.github.com';

const xhr = (baseUrl, headers) => Object.fromEntries(['get', 'put', 'post', 'delete', 'patch']
  .map(verb => [verb, async (url, body) => {
    const res = await fetch(baseUrl + url, {
      method: verb.toUpperCase(),
      body: body && JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
    });

    if (!res.ok) {
      throw new Error(res.statusText);
    }

    return res.json();
  }])
);

function repoFiles() {
  return child_process.execSync('md5sum $(find . -type f ! -path "*/.*")')
    .toString()
    .trim()
    .split('\n')
    .map(line => {
      const [hash, p] = line.trim().split(/\s+/);
      return {
        path: p.slice(1),
        hash
      };
    });
}

function getContentType(id) {
  if (/\.(js|ellx)$/.test(id)) {
    return 'text/javascript';
  }
  if (/\.(md)$/.test(id)) {
    return 'text/plain';
  }
  return 'text/plain';
}

async function sync() {
  const repo = process.env.GITHUB_REPOSITORY;
  const targetSha = process.env.GITHUB_SHA;
  const currentRef = process.env.GITHUB_REF;
  const ellxUrl = core.getInput('ellx-url');
  const token = core.getInput('github-token');

  const tagName = 'ellx-sync/' + (/^refs\/heads\/(.+)/.exec(currentRef) || [, 'latest'])[1];
  const releaseVersion = (/^refs\/heads\/release\/(.+)/.exec(currentRef) || [])[1];
  const suffix = releaseVersion ? '@' + releaseVersion : '';

  const files = repoFiles();

  const ghApi = xhr(GITHUB_API, {
    authorization: `Bearer ${ token }`
  });

  const ellxApi = xhr(ellxUrl);

  // Check repo visibility, and whether we have the tag already
  const [meta, ellxTag] = await Promise.all([
    ghApi.get(`/repos/${repo}`),
    ghApi.get(`/repos/${repo}/git/matching-refs/tags/${tagName}`)
  ]);

  const toUpload = await ellxApi.put('/sync/' + repo + suffix, {
    repo,
    token,
    acl: meta.private ? 'private' : 'public',
    description: meta.description,
    targetSha,
    tagName,
    currentSha: ellxTag[0] && ellxTag[0].object.sha,
    files
  });

  const uploads = await Promise.all(
    toUpload.map(
      async ({ path, uploadUrl }) => fetch(uploadUrl, {
        method: 'PUT',
        body: await readFile('.' + path, 'utf8'),
        headers: {
          'Content-Type': getContentType(path),
          'Cache-Control': 'max-age=31536000' // TODO: fix for private projects
        },
      })
    )
  );

  if (uploads.every(i => i.ok)) {
    core.info(['Successfully synced']
      .concat(toUpload.map(({ path }) => path.slice(1)))
      .join('\n')
    );
  }
  else {
    const errIdx = uploads.findIndex(r => !r.ok);
    core.error(`Failed to upload ${toUploads[errIdx].path.slice(1)}: ${r.statusText}`);
  }
}

sync().catch(error => core.setFailed(error.message));
