export function allowCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function rejectMethod(response) {
  response.statusCode = 405;
  response.end(JSON.stringify({ error: 'Method not allowed' }));
}

export function restStatus() {
  return {
    state: 'delayed',
    provider: 'twelvedata',
    stream: 'rest',
    reason: 'Vercel serves REST snapshots; live WebSocket requires a Node host',
    symbol: 'XAU/USD',
    symbolLabel: 'XAUUSD',
    timeframes: ['1m', '5m', '15m', '30m', '1H', '4H', '1D'],
  };
}

export function fail(response, error) {
  response.statusCode = 502;
  response.end(JSON.stringify({ error: error.message || 'Upstream request failed' }));
}
