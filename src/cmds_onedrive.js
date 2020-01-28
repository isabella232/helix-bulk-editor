/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { OneDrive } = require('@adobe/helix-onedrive-support');
const { info, debug, SimpleInterface } = require('@adobe/helix-log');

const STATE_FILE = '.hlx-blk.json';


let state = {};
async function loadState() {
  try {
    state = await fs.readJson(STATE_FILE);
  } catch {
    // ignore
  }
}
async function saveState() {
  await fs.writeJson(STATE_FILE, state);
}

function createOneDriveClient() {
  const {
    AZURE_WORD2MD_CLIENT_ID: clientId,
    AZURE_WORD2MD_CLIENT_SECRET: clientSecret,
    AZURE_WORD2MD_REFRESH_TOKEN: refreshToken,
  } = process.env;

  let tokens = {};
  try {
    tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf-8'));
  } catch (e) {
    // ignore
  }

  const {
    accessToken,
    expiresOn,
  } = tokens;

  return new OneDrive({
    clientId,
    clientSecret,
    refreshToken,
    accessToken,
    expiresOn,
    log: new SimpleInterface({ level: 'trace' }),
  });
}

function getAuthenticatedClient() {
  const drive = createOneDriveClient();
  if (!drive.authenticated) {
    throw Error('Onedrive client is not authenticated. Login first.');
  }
  return drive;
}

async function me() {
  const od = getAuthenticatedClient();
  const result = await od.me();
  info(chalk`Logged in as: {yellow ${result.displayName}} {grey (${result.mail})}`);
}

async function resolve(args) {
  const od = getAuthenticatedClient();
  const result = await od.getDriveItemFromShareLink(args.link);
  const { id, name, webUrl } = result;
  const { driveId } = result.parentReference;
  const canonicalPath = `/drives/${driveId}/items/${id}`;
  info(chalk`   Name: {yellow ${name}}`);
  info(chalk`     Id: {yellow ${id}}`);
  info(chalk`    URL: {yellow ${webUrl}}`);
  info(chalk`DriveId: {yellow ${driveId}}`);
  state.root = canonicalPath;
  state.cwd = '/';
  await saveState();
  info(chalk`\nroot path updated: {yellow ${canonicalPath}}`);
}

async function getDriveItem(url) {
  // todo: parse better
  const [, , driveId, , id] = url.split('/');
  return {
    id,
    parentReference: {
      driveId,
    },
  };
}

async function ls(args) {
  await loadState();
  if (!state.root) {
    throw Error(chalk`ls needs path. use '{grey ${args.$0} resolve}' to set root.`);
  }
  if (args.path && args.path.startsWith('https://')) {
    throw Error(chalk`ls does not work on share links directly. use '{grey ${args.$0} resolve}' to set root.`);
  }
  const p = path.posix.join(state.cwd, args.path || '');
  const driveItem = await getDriveItem(state.root);
  // console.log(driveItem);
  const od = getAuthenticatedClient();
  const result = await od.listChildren(driveItem, p);
  result.value.forEach((item) => {
    let itemPath = path.posix.join(p, item.name);
    if (item.folder) {
      itemPath += '/';
    }
    process.stdout.write(`${itemPath}\n`);
  });
  // console.log(result);
}

async function processQueue(queue, fn, maxConcurrent = 8) {
  const running = [];
  while (queue.length || running.length) {
    if (running.length < maxConcurrent && queue.length) {
      const task = fn(queue.shift(), queue);
      running.push(task);
      task.finally(() => {
        const idx = running.indexOf(task);
        if (idx >= 0) {
          running.splice(idx, 1);
        }
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(running);
    }
  }
}

async function downloadHandler({
  od, dir, dirPath, driveItem,
}, queue) {
  // console.log(driveItem);
  const dst = path.resolve(dir, driveItem.name);
  const relPath = path.posix.join(dirPath, driveItem.name);
  if (driveItem.file) {
    debug(`saving ${driveItem.webUrl} to ${path.relative('.', dst)}`);
    const result = await od.downloadDriveItem(driveItem);
    await fs.ensureDir(dir);
    await fs.writeFile(dst, result);
    const size = (result.length / 1024).toFixed(2);
    info(`${size.padStart(5, ' ')}kb - ${path.relative('.', dst)}`);
    await fs.writeJson(`${dst}.json`, {
      url: driveItem.webUrl,
      driveId: driveItem.parentReference.driveId,
      it: driveItem.id,
      relPath,
    });
  } else if (driveItem.folder) {
    const result = await od.listChildren(driveItem);
    for (const childItem of result.value) {
      queue.push({
        od, dir: dst, dirPath: relPath, driveItem: childItem,
      });
    }
  }
}

async function downloadRecursively(od, dir, dirPath, driveItem) {
  return processQueue([{
    od, dir, dirPath, driveItem,
  }], downloadHandler);
}

async function download(args) {
  await loadState();
  if (!state.root) {
    throw Error(chalk`get needs path. use '{grey ${args.$0} resolve}' to set root.`);
  }
  const p = path.posix.join(state.cwd, args.path);

  let dst = path.resolve('.', path.posix.basename(p));
  if (args.local) {
    if (await fs.pathExists(args.local) && fs.lstatSync(args.local).isDirectory()) {
      dst = path.resolve(args.local, path.posix.basename(p));
    } else {
      if (args.recursive) {
        throw Error(chalk`Recursive target need to be a directory.`);
      }
      dst = path.resolve('.', args.local);
    }
  }

  if (await fs.pathExists(dst)) {
    throw Error(chalk`Refusing to overwrite {yellow ${dst}}`);
  }
  const driveItem = await getDriveItem(state.root);
  const od = getAuthenticatedClient();
  if (args.recursive) {
    // get 'complete' drive item
    const result = await od.getDriveItem(driveItem, p, false);
    await downloadRecursively(od, path.dirname(dst), args.path, result);
  } else {
    info(chalk`saving to {yellow ${path.relative('.', dst)}}`);
    const result = await od.getDriveItem(driveItem, p, true);
    await fs.writeFile(dst, result);
  }
}

module.exports = {
  me,
  resolve,
  ls,
  download,
};