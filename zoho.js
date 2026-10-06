/**
 * Zoho Campaigns list subscribe for coupon opt-ins.
 * Credentials and list keys are Worker secrets. Nothing here is hardcoded.
 * A missing secret skips that call. A Zoho error is swallowed so Resend and
 * Google Sheets can still succeed.
 *
 * ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN refresh an
 * access token. ZOHO_LIST_KEY_DESTIN is the Destin list. ZOHO_LIST_KEY_30A
 * is the 30A list used by account checkboxes.
 */

export const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
export const ZOHO_LISTSUBSCRIBE_URL = "https://campaigns.zoho.com/api/v1.1/json/listsubscribe";
export const ZOHO_SOURCE_SUBSCRIBE = "eatingindestin-subscribe";
export const ZOHO_SOURCE_ACCOUNT = "eatingindestin-account";

const LIST_KEYS = {
  destin: "ZOHO_LIST_KEY_DESTIN",
  "30a": "ZOHO_LIST_KEY_30A",
};

function secret(env, name) {
  const value = env && env[name];
  return value ? String(value) : "";
}

function zohoReady(env) {
  const clientId = secret(env, "ZOHO_CLIENT_ID");
  const clientSecret = secret(env, "ZOHO_CLIENT_SECRET");
  const refreshToken = secret(env, "ZOHO_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function listKey(env, list) {
  const name = LIST_KEYS[list];
  return name ? secret(env, name) : "";
}

function contactInfo(email) {
  if (/[{},\r\n]/.test(email)) return "";
  return `{Contact Email:${email}}`;
}

async function refreshAccessToken(ready, fetchImpl) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ready.clientId,
    client_secret: ready.clientSecret,
    refresh_token: ready.refreshToken,
  });
  const response = await fetchImpl(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) return "";
  let data;
  try {
    data = await response.json();
  } catch {
    return "";
  }
  const token = data && typeof data === "object" && !Array.isArray(data) && data.access_token;
  return token ? String(token) : "";
}

async function postListSubscribe(accessToken, key, email, source, fetchImpl) {
  const info = contactInfo(email);
  if (!info) return;
  const params = new URLSearchParams({
    resfmt: "JSON",
    listkey: key,
    contactinfo: info,
    source,
  });
  const response = await fetchImpl(`${ZOHO_LISTSUBSCRIBE_URL}?${params.toString()}`, {
    method: "POST",
    headers: { authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  await response.body?.cancel();
}

export async function subscribeZohoLists(env, email, lists, source, fetchImpl = fetch) {
  try {
    const ready = zohoReady(env);
    const address = String(email || "").trim();
    if (!ready || !address) return;
    const keys = [];
    for (const list of lists || []) {
      const key = listKey(env, list);
      if (key && !keys.includes(key)) keys.push(key);
    }
    if (!keys.length) return;
    const accessToken = await refreshAccessToken(ready, fetchImpl);
    if (!accessToken) return;
    await Promise.all(keys.map((key) => postListSubscribe(accessToken, key, address, source, fetchImpl).catch(() => {})));
  } catch {
    // A Zoho miss must not fail signup, sign-in, or a My places opt-in.
  }
}
