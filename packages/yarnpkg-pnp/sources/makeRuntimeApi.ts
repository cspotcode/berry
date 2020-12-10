import {npath, PortablePath}      from '@yarnpkg/fslib';
import type {FakeFS}              from '@yarnpkg/fslib';

import {generateSerializedState}  from './generateSerializedState';
import {hydrateRuntimeState}      from './loader/hydrateRuntimeState';
import {makeApi}                  from './loader/makeApi';
import type {PnpSettings, PnpApi} from "./types";

export const makeRuntimeApi = (settings: PnpSettings, basePath: string, fakeFs: FakeFS<PortablePath>): PnpApi => {
  const data = generateSerializedState(settings);
  const state = hydrateRuntimeState(data, {basePath});

  const pnpapiResolution = npath.join(basePath, `.pnp.js`);

  return makeApi(state, {fakeFs, pnpapiResolution});
};
