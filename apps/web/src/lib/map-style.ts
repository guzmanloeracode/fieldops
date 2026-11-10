/**
 * MapLibre style for the site and board maps. The Docker build passes the variable through an empty build
 * argument when it isn't set, so an empty string counts as unset and falls back to OpenFreeMap.
 */
export const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
