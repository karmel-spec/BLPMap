/* ONE-TIME: copy the three secrets out of Code.gs into Script Properties.
 *
 * Run this ONCE, in the Apps Script editor, while Code.gs STILL HOLDS the real
 * values as constants — i.e. BEFORE pasting the version of DailyReport.gs that
 * reads them from Script Properties. It reads the constants that are already
 * in the file and writes them to the project's properties. Nobody has to read,
 * copy or retype a secret, so none of them passes through a clipboard, a chat
 * window or a screen share.
 *
 * How:
 *   1. Paste this function at the BOTTOM of the current Code.gs. Save (⌘S).
 *   2. Choose `stashSecretsOnce` in the function dropdown and press Run.
 *      Authorize if prompted — it only touches this project's properties.
 *   3. Check the Execution log: it prints WHICH keys it set and how many
 *      characters each value had. It never prints a value.
 *   4. Project Settings → Script properties — three rows should be there.
 *   5. Now paste the new DailyReport.gs and deploy. Delete this function
 *      (the new file does not include it).
 *
 * Doing it in this order means no downtime: the properties are already in
 * place the moment the new code starts reading them.
 */
function stashSecretsOnce() {
  var want = {BRIDGE_SECRET: BRIDGE_SECRET, TEAM_PIN: TEAM_PIN, MOVING_ICS: MOVING_ICS};
  var props = PropertiesService.getScriptProperties();
  var set = [], skipped = [];
  Object.keys(want).forEach(function (k) {
    var v = (want[k] === null || want[k] === undefined) ? '' : String(want[k]).trim();
    if (!v || /^PASTE_.*_HERE$/.test(v)) { skipped.push(k + ' (empty or still a placeholder)'); return; }
    props.setProperty(k, v);
    set.push(k + ' (' + v.length + ' chars)');
  });
  var msg = 'SET: ' + (set.join(', ') || 'nothing')
    + (skipped.length ? '\nSKIPPED: ' + skipped.join(', ') : '')
    + '\nValues are never printed. Check Project Settings → Script properties.';
  Logger.log(msg);
  return msg;
}
