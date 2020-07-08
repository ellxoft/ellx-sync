const child_process = require('child_process');
const process = require('process');

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


// function getContentType(id) {
//   if (/\.(js|ellx)$/.test(id)) {
//     return 'text/javascript';
//   }
//   if (/\.(md)$/.test(id)) {
//     return 'text/plain';
//   }
//   return 'text/plain';
// }



// async function sync()  {
//   const repo = process.env.GITHUB_REPOSITORY;
//   const [owner, project] = repo.split('/');
//   const server = core.getInput('ellx-url');
//   const key = core.getInput('key');

//   const files = walk('.')
//     .filter(name => !name.startsWith('./.git'))
//     .map(path => ({
//       path: serverPath(path),
//       hash: hashAndCache(path),
//     }));

//   const authorization = `${owner},${repo.replace('/', '-')},${key}`;
//   const acl = await getAcl();

//   const res = await fetch(
//     server + `/sync/${repo}`,
//     {
//       method: 'PUT',
//       body: JSON.stringify({ files, title: project, acl }),
//       // TODO: auth header from env
//       // for now need to copy valid token from client
//       headers: {
//         authorization,
//         'Content-Type': 'application/json',
//       },
//     }
//   );

//   if (!res.ok) {
//     const error = await res.json();
//     console.log(error);
//     throw new Error(`Sync error`);
//   }

//   const urls = await res.json();

//   const uploads = await Promise.all(
//     urls.map(
//       async ({ path, uploadUrl }) => fetch(uploadUrl, {
//         method: 'PUT',
//         body: contents.get(path),
//         headers: {
//           'Content-Type': getContentType(path),
//           'Cache-Control': 'max-age=31536000' // TODO: fix for private projects
//         },
//       })
//     )
//   );

//   if (uploads.every(i => i.ok)) {
//     console.log(
//       'Synced following files successfully:\n',
//     );

//     console.log(urls.map(({ path }) => path.slice(1)));
//   } else {
//     throw new Error(
//       `Error uploading files: ${uploads.filter(r => !r.ok).map(async r => r.json())}`
//     );
//   }
// }

async function sync() {
  const repo = process.env.GITHUB_REPOSITORY;
  const ellxUrl = core.getInput('ellx-url');
  const token = core.getInput('github-token');

  const files = repoFiles();

  const ghApi = xhr(GITHUB_API, {
    authorization: `Bearer ${ token }`
  });

  const ellxApi = xhr(ellxUrl);

  // Check repo visibility, master sha, and whether we have ellx_latest tag already
  const [meta, master, ellxTag] = await Promise.all([
    ghApi.get(`/repos/${repo}`),
    ghApi.get(`/repos/${repo}/git/matching-refs/heads/master`),
    ghApi.get(`/repos/${repo}/git/matching-refs/tags/ellx_latest`)
  ]);

  const res = await ellxApi.put('/sync/' + repo, {
    repo,
    token,
    acl: meta.private ? 'private' : 'public',
    description: meta.description,
    master: master[0] && master[0].object.sha,
    ellxTag: ellxTag[0] && ellxTag[0].object.sha,
    files
  });

  core.info(res.success || res.error);
}

sync().catch(error => core.setFailed(error.message));
