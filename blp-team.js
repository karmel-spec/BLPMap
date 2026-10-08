/* Who may sign in to the Store Map — the only copy of this rule.
 *
 * Loaded by the browser (script tag in index.html, before app.js) and by
 * the Netlify functions. server.py reads the three arrays below so local
 * dev cannot drift.
 *
 * After lowercasing, a Google account is on the team when:
 *   - the email ends with @brighamlarsonpianos.com, or
 *   - the email ends with .blp@gmail.com (the shop's Gmail accounts), or
 *   - the email is listed in EXTRA_EMAILS
 * Comparison is case-insensitive. Gmail dots and +tags are not stripped;
 * that is how the map has always compared these addresses.
 *
 * Adding someone:
 *   - a new @brighamlarsonpianos.com mailbox, or a new name.blp@gmail.com
 *     shop account, is already allowed. Nothing to edit.
 *   - any other address: add it to EXTRA_EMAILS (lowercase) and deploy.
 * Removing someone:
 *   - delete an extra address from EXTRA_EMAILS, or
 *   - narrow DOMAIN_SUFFIXES / GMAIL_SUFFIXES if a whole pattern has to stop.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.blpAccount = api.blpAccount;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EXTRA_EMAILS = ["brighamlarson@gmail.com"];
  const DOMAIN_SUFFIXES = ["@brighamlarsonpianos.com"];
  const GMAIL_SUFFIXES = [".blp@gmail.com"];

  function isTeamEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return false;
    if (EXTRA_EMAILS.indexOf(e) !== -1) return true;
    for (let i = 0; i < DOMAIN_SUFFIXES.length; i++) {
      if (e.endsWith(DOMAIN_SUFFIXES[i])) return true;
    }
    for (let i = 0; i < GMAIL_SUFFIXES.length; i++) {
      if (e.endsWith(GMAIL_SUFFIXES[i])) return true;
    }
    return false;
  }

  // PIN sign-in has no email. The map treats that as a session for
  // attribution; piano-data reads use isTeamEmail, which rejects a blank.
  function blpAccount(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return true;
    return isTeamEmail(e);
  }

  return { blpAccount, isTeamEmail, EXTRA_EMAILS, DOMAIN_SUFFIXES, GMAIL_SUFFIXES };
});
