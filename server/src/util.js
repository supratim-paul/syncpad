export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function validate(schema, data, res) {
  const r = schema.safeParse(data);
  if (!r.success) {
    res.status(400).json({ error: r.error.issues[0]?.message || 'Invalid input' });
    return null;
  }
  return r.data;
}
