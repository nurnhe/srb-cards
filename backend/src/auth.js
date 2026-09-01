// Single shared password gating every /api/* data route (not /api/health or
// /api/login itself). Not per-user accounts — this is a personal app for one
// household of users, matching the "acceptable trade-off for a low-stakes
// personal app" philosophy already used everywhere else in this codebase
// (see CLAUDE.md). A plain string compare is fine at this scale; no need for
// a timing-safe comparison or hashing here.
//
// Now that the browser never sees the service_role key (it only ever talks
// to this backend), a password check here is real protection, not just a
// client-side deterrent — unlike the old direct-to-Supabase setup, there is
// no embedded key a determined visitor could use to bypass it.
export function requireAppPassword(req, res, next) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    console.error('[auth] APP_PASSWORD is not set — refusing all API requests');
    return res.status(500).json({ error: 'Server misconfigured: APP_PASSWORD not set' });
  }
  if (req.get('X-App-Password') !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Lets the frontend verify a typed password before storing it, with a clear
// success/failure signal, rather than inferring success from a side effect
// of some other endpoint.
export function login(req, res) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: 'Server misconfigured: APP_PASSWORD not set' });
  }
  if ((req.body || {}).password !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ ok: true });
}
