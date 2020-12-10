import {PortablePath, npath, ppath, xfs, Filename} from '@yarnpkg/fslib';
import globby                                      from 'globby';
import semver                                      from 'semver';

import {Manifest}                                  from './Manifest';
import type {Project}                              from './Project';
import {WorkspaceResolver}                         from './WorkspaceResolver';
import * as hashUtils                              from './hashUtils';
import * as structUtils                            from './structUtils';
import type {IdentHash}                            from './types';
import type {Descriptor, Locator}                  from './types';

export class Workspace {
  public readonly project: Project;
  public readonly cwd: PortablePath;

  // @ts-expect-error: This variable is set during the setup process
  public readonly relativeCwd: PortablePath;

  // @ts-expect-error: This variable is set during the setup process
  public readonly anchoredDescriptor: Descriptor;

  // @ts-expect-error: This variable is set during the setup process
  public readonly anchoredLocator: Locator;

  // @ts-expect-error: This variable is set during the setup process
  public readonly locator: Locator;

  // @ts-expect-error: This variable is set during the setup process
  public readonly manifest: Manifest;

  public readonly workspacesCwds: Set<PortablePath> = new Set();

  // Generated at resolution; basically dependencies + devDependencies + child workspaces
  public dependencies: Map<IdentHash, Descriptor> = new Map();

  constructor(workspaceCwd: PortablePath, {project}: {project: Project}) {
    this.project = project;
    this.cwd = workspaceCwd;
  }

  async setup() {
    // @ts-expect-error: It's ok to initialize it now
    this.manifest = xfs.existsSync(ppath.join(this.cwd, Manifest.fileName))
      ? await Manifest.find(this.cwd)
      : new Manifest();

    // We use ppath.relative to guarantee that the default hash will be consistent even if the project is installed on different OS / path
    // @ts-expect-error: It's ok to initialize it now, even if it's readonly (setup is called right after construction)
    this.relativeCwd = ppath.relative(this.project.cwd, this.cwd) || PortablePath.dot;

    const ident = this.manifest.name ? this.manifest.name : structUtils.makeIdent(null, `${this.computeCandidateName()}-${hashUtils.makeHash<string>(this.relativeCwd).substr(0, 6)}`);
    const reference = this.manifest.version ? this.manifest.version : `0.0.0`;

    // @ts-expect-error: It's ok to initialize it now, even if it's readonly (setup is called right after construction)
    this.locator = structUtils.makeLocator(ident, reference);

    // @ts-expect-error: It's ok to initialize it now, even if it's readonly (setup is called right after construction)
    this.anchoredDescriptor = structUtils.makeDescriptor(this.locator, `${WorkspaceResolver.protocol}${this.relativeCwd}`);

    // @ts-expect-error: It's ok to initialize it now, even if it's readonly (setup is called right after construction)
    this.anchoredLocator = structUtils.makeLocator(this.locator, `${WorkspaceResolver.protocol}${this.relativeCwd}`);

    const patterns = this.manifest.workspaceDefinitions.map(({pattern}) => pattern);

    const relativeCwds = await globby(patterns, {
      absolute: true,
      cwd: npath.fromPortablePath(this.cwd),
      expandDirectories: false,
      onlyDirectories: true,
      onlyFiles: false,
      ignore: [`**/node_modules`, `**/.git`, `**/.yarn`],
    });

    // It seems that the return value of globby isn't in any guaranteed order - not even the directory listing order
    relativeCwds.sort();

    for (const relativeCwd of relativeCwds) {
      const candidateCwd = ppath.resolve(this.cwd, npath.toPortablePath(relativeCwd));

      if (xfs.existsSync(ppath.join(candidateCwd, `package.json` as Filename))) {
        this.workspacesCwds.add(candidateCwd);
      }
    }
  }

  accepts(range: string) {
    const protocolIndex = range.indexOf(`:`);

    const protocol = protocolIndex !== -1
      ? range.slice(0, protocolIndex + 1)
      : null;

    const pathname = protocolIndex !== -1
      ? range.slice(protocolIndex + 1)
      : range;

    if (protocol === WorkspaceResolver.protocol && ppath.normalize(pathname as PortablePath) === this.relativeCwd)
      return true;

    if (protocol === WorkspaceResolver.protocol && pathname === `*`)
      return true;

    if (!semver.validRange(pathname))
      return false;

    if (protocol === WorkspaceResolver.protocol)
      return semver.satisfies(this.manifest.version !== null ? this.manifest.version : `0.0.0`, pathname);

    if (!this.project.configuration.get(`enableTransparentWorkspaces`))
      return false;

    if (this.manifest.version !== null)
      return semver.satisfies(this.manifest.version, pathname);

    return false;
  }

  computeCandidateName() {
    if (this.cwd === this.project.cwd) {
      return `root-workspace`;
    } else {
      return `${ppath.basename(this.cwd)}` || `unnamed-workspace`;
    }
  }

  async persistManifest() {
    const data = {};
    this.manifest.exportTo(data);

    const path = ppath.join(this.cwd, Manifest.fileName);
    const content = `${JSON.stringify(data, null, this.manifest.indent)}\n`;

    await xfs.changeFilePromise(path, content, {
      automaticNewlines: true,
    });
  }
}
