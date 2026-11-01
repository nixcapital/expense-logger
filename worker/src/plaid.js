// Thin Plaid client. `fetchFn` is injected so tests never touch the network.
export function plaidBase(env) {
  return env.PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
}

export async function plaidCall(env, fetchFn, path, body) {
  var res = await fetchFn(plaidBase(env) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET }, body))
  });
  var data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok || !data) {
    var err = new Error('plaid_error');
    err.plaidCode = data && data.error_code ? String(data.error_code) : 'unknown';
    err.status = res.status;
    throw err;
  }
  return data;
}

export function createLinkToken(env, fetchFn) {
  return plaidCall(env, fetchFn, '/link/token/create', {
    client_name: 'Expense Logger',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: 'single-user' },
    products: ['transactions'],
    transactions: { days_requested: 730 },
    redirect_uri: env.REDIRECT_URI
  });
}

// Update mode: re-authenticate an existing Item. The access_token itself does not change.
export function createUpdateLinkToken(env, fetchFn, accessToken) {
  return plaidCall(env, fetchFn, '/link/token/create', {
    client_name: 'Expense Logger',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: 'single-user' },
    access_token: accessToken,
    redirect_uri: env.REDIRECT_URI
  });
}

export function exchangePublicToken(env, fetchFn, publicToken) {
  return plaidCall(env, fetchFn, '/item/public_token/exchange', { public_token: publicToken });
}
