/**
 * Request id for one attribute-batch submission.
 *
 * The id identifies the submission, not its content: a fresh nonce per click
 * means a later identical selection is a new request (and can be proposed
 * again after an earlier one was blocked or rolled back), while a replay of
 * the same request reuses its records. Identical open proposals are merged
 * on the server by the open-proposal key, not by this id.
 * The content digest prefix only helps when reading logs.
 */
export async function attributeBatchRequestId(
  items: Array<{ name: string; value: unknown }>,
  nonce: string = crypto.randomUUID(),
): Promise<string> {
  const payload = items.map((item) => `${item.name}:${JSON.stringify(item.value)}`).sort().join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `attr-${hex.slice(0, 24)}-${nonce.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
}
