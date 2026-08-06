const assetModules = import.meta.glob("../assets/**/*", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

const assetsByPath = new Map(
  Object.entries(assetModules).map(([path, url]) => [path.replace("../assets/", ""), url]),
);

export function assetUrl(path: string) {
  if (/^https:\/\//.test(path)) return path;

  const normalized = path
    .replace(/^\/+/, "")
    .replace(/^assets\//, "")
    .replace(/^models\/plates\//, "plates/");
  const url = assetsByPath.get(normalized);
  if (!url) throw new Error(`Unknown Clicky asset: ${path}`);
  return url;
}
