import { buildGuideAssetMirrorApiUrl } from "./guideAssets.mjs";

const REQUEST_TIMEOUT_MS = 60_000;

function isRedirect(response) {
  return response.status >= 300 && response.status < 400 && response.status !== 304;
}

function describeUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

/** Check both the mirror endpoint and any public asset URL it redirects to. */
export async function mirrorGuideAssetThroughApi(assetKey, sourceUrl, mirrorApiOrigin, fetchImpl = fetch) {
  const apiUrl = buildGuideAssetMirrorApiUrl(assetKey, sourceUrl, mirrorApiOrigin);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const existingAssetUrl = new URL(apiUrl);
  existingAssetUrl.search = "";
  const existingAssetResponse = await fetchImpl(existingAssetUrl, {
    method: "HEAD",
    redirect: "manual",
    signal,
  });

  if (existingAssetResponse.ok) return "already-available";

  if (isRedirect(existingAssetResponse)) {
    const location = existingAssetResponse.headers.get("location");
    if (!location) {
      throw new Error(
        `Mirror API returned HTTP ${existingAssetResponse.status} without a Location header for ${assetKey} at ${existingAssetUrl.pathname}`,
      );
    }

    const publicUrl = new URL(location, existingAssetUrl).toString();
    const publicResponse = await fetchImpl(publicUrl, {
      method: "HEAD",
      signal,
    });
    if (publicResponse.ok) return "already-available";
    if (publicResponse.status !== 404) {
      const finalUrl = publicResponse.url || publicUrl;
      throw new Error(
        `Existing mirror API route returned HTTP ${existingAssetResponse.status} for ${assetKey}; `
        + `public target returned HTTP ${publicResponse.status} at ${describeUrl(finalUrl)}`,
      );
    }
  } else if (existingAssetResponse.status !== 404) {
    throw new Error(
      `Mirror API returned HTTP ${existingAssetResponse.status} while checking existing asset ${assetKey} at ${existingAssetUrl.pathname}`,
    );
  }

  const apiResponse = await fetchImpl(apiUrl, {
    method: "HEAD",
    redirect: "manual",
    signal,
  });

  if (isRedirect(apiResponse)) {
    const location = apiResponse.headers.get("location");
    if (!location) {
      throw new Error(
        `Mirror API returned HTTP ${apiResponse.status} without a Location header for ${assetKey} at ${new URL(apiUrl).pathname}`,
      );
    }

    const publicUrl = new URL(location, apiUrl).toString();
    const publicResponse = await fetchImpl(publicUrl, {
      method: "HEAD",
      signal,
    });
    if (!publicResponse.ok) {
      const finalUrl = publicResponse.url || publicUrl;
      throw new Error(
        `Mirror API returned HTTP ${apiResponse.status} for ${assetKey} at ${new URL(apiUrl).pathname}; `
        + `redirect target returned HTTP ${publicResponse.status} at ${describeUrl(finalUrl)}`,
      );
    }
    return "mirrored";
  }

  if (!apiResponse.ok) {
    throw new Error(`Mirror API returned HTTP ${apiResponse.status} for ${assetKey} at ${new URL(apiUrl).pathname}`);
  }

  return "mirrored";
}
