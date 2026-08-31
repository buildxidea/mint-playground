import {
  PagedSplats,
  SplatFileType,
  SplatMesh,
  type SplatMeshOptions,
} from '@sparkjsdev/spark';

type PagedRadSplatOptions = Omit<
  SplatMeshOptions,
  'url' | 'fileType' | 'paged' | 'lod' | 'nonLod'
> & {
  url: string;
};

/**
 * Create every remote production splat through Spark's camera-driven RAD pager.
 *
 * `SplatMesh.initialized` only means that the mesh/pager setup has completed;
 * it does not mean every RAD page has downloaded. Callers that need visible
 * readiness must inspect pager residency, as MintWorldLayer does.
 */
export function createPagedRadSplat(
  options: PagedRadSplatOptions,
): SplatMesh {
  const { url, enableLod = true, lodScale = 1, ...meshOptions } = options;
  const paged = new PagedSplats({
    rootUrl: url,
    fileType: SplatFileType.RAD,
  });

  return new SplatMesh({
    ...meshOptions,
    url,
    fileType: SplatFileType.RAD,
    paged,
    enableLod,
    lodScale,
  });
}
