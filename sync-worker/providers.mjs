export const PROVIDERS = {
  max: { name: 'MAX', fields: ['username', 'password'] },
  visaCal: { name: 'כאל', fields: ['username', 'password'] },
  isracard: { name: 'ישראכרט', fields: ['id', 'card6Digits', 'password'] },
  amex: { name: 'אמריקן אקספרס', fields: ['id', 'card6Digits', 'password'] },
}
export function validateCredentials(provider, input) {
  if (!Object.hasOwn(PROVIDERS, provider) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_INPUT')
  const fields = PROVIDERS[provider].fields
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('INVALID_INPUT')
  for (const field of fields) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 200) throw new Error('INVALID_INPUT')
  }
  if (input.id && !/^\d{9}$/.test(input.id)) throw new Error('INVALID_INPUT')
  if (input.card6Digits && !/^\d{6}$/.test(input.card6Digits)) throw new Error('INVALID_INPUT')
  return Object.fromEntries(fields.map(field => [field, input[field]]))
}
