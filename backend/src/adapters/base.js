export function createUnconfiguredAdapter(name, capabilities, reason = 'No credentials configured') {
  const fail = () => {
    throw new Error(`${name} adapter is not configured: ${reason}`);
  };

  return {
    name,
    capabilities,
    configured: false,
    fetchCandles: fail,
    fetchQuote: fail,
    connect: fail,
  };
}
