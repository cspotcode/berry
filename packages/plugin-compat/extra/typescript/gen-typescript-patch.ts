import { sync as spawn } from 'cross-spawn';
import { mkdirSync, existsSync as exists, rmdirSync, statSync as stat, writeFileSync as writeFile} from 'fs';
import { chdir as cd } from 'process';
import { xfs } from '@yarnpkg/fslib';
const {createPatch} = require('../createPatch');

function mkdir(path: string) {
  return mkdirSync(path, { recursive: true });
}
function rmrf(path: string) {
  return rmdirSync(path, { recursive: true });
}
function _exec(command: string[], opts = {}) {
  if(!Array.isArray(command)) throw new Error('usage');
  const commandStr = command.map(c => `"${c}"`).join(' ');
  const [first, ...rest] = command;
  console.error(`+ ${commandStr}`); //bash -x-style logging
  return {commandStr, result: spawn(first, rest, {
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8'
    input: '',
    ...options
  })};
}
function execIt(command: string[], opts = {}) {
  const {result, commandStr} = _exec(command);
  if(result.status) {
    throw new Error(`${commandStr} failed with exit code ${result.status}`);
  }
}
function execItCond(command: string[], opts = {}) {
  const {result, commandStr} = _exec(command);
  return result.status === 0;
}
function execItCapture(command: string[], opts = {}): string {
  const {result, commandStr} = _exec(command, {
    ...opts,
    stdio: ['pipe', 'pipe', 'inherit']
  });
  if(result.status) {
    throw new Error(`${commandStr} failed with exit code ${result.status}`);
  }
  return result.stdout;
}
function cp(source: string, destination: string) {
  xfs.copySync(destination, source);
}

const THIS_DIR = __dirname;
const TEMP_DIR = "/tmp/ts-repo"
const MIRROR_DIR = `${TEMP_DIR}/mirror`;
const CLONE_DIR = `${TEMP_DIR}/clone`;
const YARN_LOCK_CACHES_DIR = `${TEMP_DIR}/yarn_lock_cache`;
const USE_YARN_2 = false

const PATCHFILE = `${TEMP_DIR}/patch.tmp`
const JSPATCH = `${THIS_DIR}/../../sources/patches/typescript.patch.ts`

const FIRST_PR_COMMIT = "5d50de3"

// Set both of the following to `null` to skip applying local cherrypick
// Added as `local` remote
const LOCAL_REMOTE = `https://github.com/cspotcode/TypeScript`
// LOCAL_REMOTE=/d/Personal-dev/@yarnpkg/berry/TypeScript
const ADDITIONAL_CHERRYPICK = `6dbdd2f2c3177cde0d2cc3afd26fee07e0060a0f..local/ab/fix-typesVersions`

// Defines which commits need to be cherry-picked onto which other commit to
// generate a patch suitable for the specified range.
const HASHES = [
  //# From    # To      # Onto    # Ranges
  ["5d50de3", "426f5a7", "e39bdc3", ">=3.2 <3.5"],
  ["5d50de3", "426f5a7", "cf7b2d4", ">=3.5 <=3.6"],
  ["5d50de3", "426f5a7", "cda54b8", ">3.6 <3.7"],
  ["5d50de3", "2f85932", "e39bdc3", ">=3.7 <3.9"],
  ["5d50de3", "3af06df", "551f0dd", ">=3.9 <4.0"],
  ["6dbdd2f", "6dbdd2f", "56865f7", ">=4.0 <4.1"],
  ["746d79b", "746d79b", "69972a3", ">=4.1"],
].map(row => {
  const [from, to, onto, ranges] = row;
  return { from, to, onto, ranges };
});

mkdir(TEMP_DIR);
// This local mirror makes subsequent clone faster when I want to `rm -rf /tmp/ts-repo/clone` because things are failing for mysterious reasons
// Could also be accomplished with git worktrees or `git clean -xdf`, but this is the hammer I knew how to use
if (!exists(MIRROR_DIR)) {
  execIt(`git clone --bare https://github.com/arcanis/typescript "${MIRROR_DIR}"`);
  cd(MIRROR_DIR)
  execIt(`git remote add upstream https://github.com/microsoft/typescript`);
}
cd(MIRROR_DIR)
execIt(`git fetch origin`);
execIt(`git fetch upstream`);
if (!exists(CLONE_DIR)) {
  execIt(`git clone --bare --reference "${MIRROR_DIR}" https://github.com/arcanis/typescript "${CLONE_DIR}"`);
  cd(CLONE_DIR)
  execIt(`git remote add upstream https://github.com/microsoft/typescript`);
  if (LOCAL_REMOTE != null) {
    execIt(`git remote add local "${LOCAL_REMOTE}"`);
  }
}

rmrf(`${TEMP_DIR}/builds`)
cd(CLONE_DIR)

execIt(`git config user.email "you@example.com"`);
execIt(`git config user.name "Your Name"`);

execIt(`git fetch origin`);
execIt(`git fetch upstream`);
if (LOCAL_REMOTE != null) {
  execIt(`git fetch local`);
}

function resetGit(commitish: string) {
  execIt(`git cherry-pick --abort || true`);
  execIt(`git reset --hard "${commitish}"`);
  execIt(`git clean -df`);

  const YARN_LOCK_CACHE_DIR = yarnLockCacheDirFor(commitish);
  const YARN_LOCK_CACHE_FILE = `${YARN_LOCK_CACHE_DIR}/yarn.lock`

  if (!exists(YARN_LOCK_CACHE_FILE) || !USE_YARN_2) {
    execIt(`npm install --before "${execItCapture(`git show -s --format=%ci`)}"`);
    // npm 7 normalizes "bin" entries, which causes merge conflicts later
    execIt(`git checkout -- package.json`);
  }

  if (!exists(YARN_LOCK_CACHE_FILE)) {
    execIt(`yarn set version 1`);
    execIt(`yarn import`);
    mkdir(YARN_LOCK_CACHE_DIR)
    cp(`yarn.lock`, YARN_LOCK_CACHE_FILE);
  } else {
    cp(YARN_LOCK_CACHE_FILE, `yarn.lock`);
  }

  if (USE_YARN_2) {
    execIt(`yarn set version 2`);
    execIt(`yarn config set cacheFolder "${TEMP_DIR}"/yarn_cache`);
    execIt(`yarn`);
    execIt(`yarn add @yarnpkg/pnpify`);
  }
}

function buildDirFor(CHERRYPICK_ONTO: string, CHERRYPICK_TO?: string) {
  let BUILD_DIR = `${TEMP_DIR}/builds/"${CHERRYPICK_ONTO}`

  if (CHERRYPICK_TO != null) {
    BUILD_DIR = `${BUILD_DIR}-${CHERRYPICK_TO}`
  }

  return BUILD_DIR
}

function gitWorktreeNameFor(CHERRYPICK_ONTO: string, CHERRYPICK_TO?: string) {
  let NAME = `worktree_${CHERRYPICK_ONTO}`

  if (CHERRYPICK_TO != null) {
    NAME = `${NAME}-${CHERRYPICK_TO}`
  }

  return NAME;
}

function gitWorktreeDirFor(CHERRYPICK_ONTO: string, CHERRYPICK_TO?: string) {
  return `${TEMP_DIR}/clone/${gitWorktreeNameFor(CHERRYPICK_ONTO, CHERRYPICK_TO)}`;
}

function yarnLockCacheDirFor(CHERRYPICK_ONTO: string) {
  return `${YARN_LOCK_CACHES_DIR}/${CHERRYPICK_ONTO}`
}

function makeBuildFor(CHERRYPICK_ONTO: string, CHERRYPICK_FROM?: string, CHERRYPICK_TO?: string) {

  const BUILD_DIR = buildDirFor(CHERRYPICK_ONTO, CHERRYPICK_TO)
  const WORKTREE_NAME = gitWorktreeNameFor(CHERRYPICK_ONTO, CHERRYPICK_TO)
  const WORKTREE_DIR = gitWorktreeDirFor(CHERRYPICK_ONTO, CHERRYPICK_TO)

  if (!exists(BUILD_DIR)) {
    mkdir(BUILD_DIR)
    cd(CLONE_DIR)
    try { execIt(`git worktree add --detach "${WORKTREE_NAME}"`) } catch { }
    cd(WORKTREE_NAME)
    resetGit(CHERRYPICK_ONTO)

    if (CHERRYPICK_TO != null) {
      if (execItCond(`git merge-base --is-ancestor "${CHERRYPICK_ONTO}" "${CHERRYPICK_TO}"`)) {
        execIt(`git merge --no-edit "${CHERRYPICK_TO}"`);
      } else {
        execIt(`git cherry-pick "${CHERRYPICK_FROM}"^.."${CHERRYPICK_TO}"`);
      }
      if (ADDITIONAL_CHERRYPICK != null) {
        execIt(`git cherry-pick "${ADDITIONAL_CHERRYPICK}"`);
      }
    }

    for (const n of [5, 4, 3, 2, 1]) {
      if (USE_YARN_2) {
        execIt(`yarn pnpify gulp local LKG`);
      } else {
        execIt(`yarn gulp local LKG`);
      }

      if (stat(`lib/typescript.js`).size > 100000) {
        break
      } else {
        console.error("Something is wrong; typescript.js got generated with a stupid size");
        execIt(`cat -e lib/typescript.js`)

        if (n === 1) {
          process.exit(1);
        }

        rmrf('lib');
        execIt(`git reset --hard lib`);
      }
    }

    cp(`lib/`, `${BUILD_DIR}/`);
  }

  return BUILD_DIR;
}

exists(PATCHFILE) && rm(PATCHFILE);
touch(PATCHFILE)
exists(JSPATCH) && rm(JSPATCH);
touch(PATCHFILE)

let PATCHFILECONTENT = '';
for (const hash of HASHES) {
  const { from: CHERRYPICK_FROM, to: CHERRYPICK_TO, onto: CHERRYPICK_ONTO, ranges: RANGE } = hash;

  makeBuildFor(CHERRYPICK_ONTO)
  const ORIG_DIR = buildDirFor(CHERRYPICK_ONTO)

  makeBuildFor(CHERRYPICK_ONTO, CHERRYPICK_FROM, CHERRYPICK_TO)
  const PATCHED_DIR = buildDirFor(CHERRYPICK_ONTO, CHERRYPICK_TO)

  const DIFF = `${THIS_DIR}/patch.${HASH}-on-${BASE}.diff`

  const outA = execItCapture(`git diff --no-index "${ORIG_DIR}" "${PATCHED_DIR}"`);
  const DIFFCONTENT = outA.replace(/^--- /g, _ => `semver exclusivity ${RANGE}\n--- `)
    .replace(new RegExp(`${ ORIG_DIR }/`, 'g'), _ => `/`)
    .replace(new RegExp(`${ PATCHED_DIR }/`, 'g'), _ => `/`)
    .replace(/__spreadArrays/g, _ => `[].concat`);
  writeFile(DIFF, DIFFCONTENT);

  PATCHFILECONTENT += DIFFCONTENT;
}
writeFile(PATCHFILE, PATCHFILECONTENT);

createPatch(PATCHFILE, JSPATCH);
