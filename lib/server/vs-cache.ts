export const VS_REVALIDATE_SECONDS = 15;

export const VS_CACHE_HEADERS = {
  "Cache-Control": `s-maxage=${VS_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
};
