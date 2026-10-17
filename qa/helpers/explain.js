const assert = require('node:assert/strict');

async function explainQuery(model, filter, sort, limit = 30) {
  const command = { explain: { find: model.collection.name, filter, sort, limit }, verbosity: 'executionStats' };
  let result;
  let metadataEncodingWarning = false;
  try {
    result = await model.db.db.command(command);
  } catch (error) {
    if (!error.message.includes('Invalid UTF-8')) throw error;
    // Diagnostic exception is local to explain; production BSON validation stays enabled.
    result = await model.db.db.command(command, { enableUtf8Validation: false });
    const invalid = [];
    function visit(value, key = '') {
      if (typeof value === 'string' && value.includes('\uFFFD')) invalid.push(key);
      else if (value && typeof value === 'object') for (const [field, child] of Object.entries(value)) visit(child, key ? `${key}.${field}` : field);
    }
    visit(result);
    assert.ok(invalid.length > 0 && invalid.every((key) => key === 'serverInfo.host'), `Invalid encoding outside server hostname: ${invalid.join(', ')}`);
    metadataEncodingWarning = true;
  }
  assert.equal(result.executionStats.executionSuccess, true);
  return { metadataEncodingWarning, queryPlanner: result.queryPlanner.winningPlan, stats: result.executionStats };
}

module.exports = { explainQuery };
